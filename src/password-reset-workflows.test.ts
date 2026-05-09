import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { AuthBoundaryLive, invalidToken, normalizeEmail, normalizePassword } from "./domain";
import { makeMockAuthEmail } from "./email";
import {
  NativeScryptPasswordHasher,
  PasswordHashFailure,
  SecureDefaultPasswordPolicy,
} from "./password";
import {
  RateLimitExceeded,
  UnsafePermissiveRateLimiter,
  type RateLimiterShape,
} from "./rate-limit";
import { makeDevMemoryStorage } from "./storage";
import { AuthTokenLive } from "./token";
import {
  makeEmailPasswordWorkflows,
  makePasswordRecoveryWorkflows,
  type PasswordRecoveryWorkflowDeps,
} from "./workflows";

const setup = Effect.gen(function* () {
  const storage = yield* makeDevMemoryStorage;
  const email = yield* makeMockAuthEmail;
  const deps: PasswordRecoveryWorkflowDeps = {
    authEmail: email.authEmail,
    authToken: AuthTokenLive,
    passwordHasher: NativeScryptPasswordHasher,
    passwordPolicy: SecureDefaultPasswordPolicy,
    rateLimiter: UnsafePermissiveRateLimiter,
    storage,
  };
  const emailPassword = makeEmailPasswordWorkflows({
    authEmail: email.authEmail,
    authToken: AuthTokenLive,
    boundary: AuthBoundaryLive,
    passwordHasher: NativeScryptPasswordHasher,
    passwordPolicy: SecureDefaultPasswordPolicy,
    rateLimiter: UnsafePermissiveRateLimiter,
    storage,
  });

  return {
    deps,
    email,
    emailPassword,
    recovery: makePasswordRecoveryWorkflows(deps),
    storage,
  };
});

describe("password reset workflows", () => {
  it.effect("requests reset only for existing credentials while preserving generic success", () =>
    Effect.gen(function* () {
      const { email, emailPassword, recovery } = yield* setup;

      yield* recovery.requestPasswordReset({
        callbackUrl: new URL("https://app.example.test/reset"),
        email: normalizeEmail("missing@example.com"),
      });
      let sent = yield* email.inspection.sent;
      assert.strictEqual(sent.length, 0);

      yield* emailPassword.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      });
      yield* recovery.requestPasswordReset({
        callbackUrl: new URL("https://app.example.test/reset"),
        email: normalizeEmail("user@example.com"),
      });
      sent = yield* email.inspection.sent;

      assert.strictEqual(sent.length, 2);
      assert.strictEqual(sent[1]?.kind, "PasswordReset");
      assert.strictEqual(sent[1]?.to, "user@example.com");
    }),
  );

  it.effect("resets a password with a valid one-time token and revokes sessions", () =>
    Effect.gen(function* () {
      const { email, emailPassword, recovery, storage } = yield* setup;
      yield* emailPassword.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      });
      const verification = yield* email.inspection.sent;
      const verificationToken = verification[0]?.token;
      if (verificationToken === undefined) return yield* Effect.die("Expected verification token");
      yield* emailPassword.verifyEmail({ now: 1, token: verificationToken });
      const signIn = yield* emailPassword.signIn({
        email: normalizeEmail("user@example.com"),
        password: normalizePassword("correct horse"),
      });

      yield* recovery.requestPasswordReset({
        callbackUrl: new URL("https://app.example.test/reset"),
        email: normalizeEmail("user@example.com"),
      });
      const sent = yield* email.inspection.sent;
      const resetToken = sent[1]?.token;
      if (resetToken === undefined) return yield* Effect.die("Expected reset token");

      yield* recovery.resetPassword({
        now: 2,
        password: normalizePassword("new correct horse"),
        token: resetToken,
      });
      const oldSessionHash = yield* AuthTokenLive.hashToken(signIn.sessionToken);
      const oldSession = yield* storage.findSessionByTokenHash(oldSessionHash, 2).pipe(Effect.flip);
      const oldPassword = yield* emailPassword
        .signIn({
          email: normalizeEmail("user@example.com"),
          password: normalizePassword("correct horse"),
        })
        .pipe(Effect.flip);
      const newPassword = yield* emailPassword.signIn({
        email: normalizeEmail("user@example.com"),
        password: normalizePassword("new correct horse"),
      });

      assert.strictEqual(oldSession.reason, "NotFound");
      assert.strictEqual(oldPassword._tag, "PublicAuthError");
      assert.strictEqual(newPassword.user.id, signIn.user.id);
    }),
  );

  it.effect("rejects expired and consumed reset tokens with a generic public error", () =>
    Effect.gen(function* () {
      const { email, emailPassword, recovery } = yield* setup;
      yield* emailPassword.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      });
      yield* recovery.requestPasswordReset({
        callbackUrl: new URL("https://app.example.test/reset"),
        email: normalizeEmail("user@example.com"),
      });
      const sent = yield* email.inspection.sent;
      const resetToken = sent[1]?.token;
      if (resetToken === undefined) return yield* Effect.die("Expected reset token");

      const expired = yield* recovery
        .resetPassword({
          now: 15 * 60 * 1_000,
          password: normalizePassword("new correct horse"),
          token: resetToken,
        })
        .pipe(Effect.flip);
      assert.deepStrictEqual(expired, invalidToken);

      yield* recovery.requestPasswordReset({
        callbackUrl: new URL("https://app.example.test/reset"),
        email: normalizeEmail("user@example.com"),
      });
      const resent = yield* email.inspection.sent;
      const freshToken = resent[2]?.token;
      if (freshToken === undefined) return yield* Effect.die("Expected fresh reset token");
      yield* recovery.resetPassword({
        now: 1,
        password: normalizePassword("new correct horse"),
        token: freshToken,
      });
      const consumed = yield* recovery
        .resetPassword({
          now: 1,
          password: normalizePassword("another correct horse"),
          token: freshToken,
        })
        .pipe(Effect.flip);

      assert.deepStrictEqual(consumed, invalidToken);
    }),
  );

  it.effect("rejects tokens issued for another auth purpose", () =>
    Effect.gen(function* () {
      const { email, emailPassword, recovery } = yield* setup;
      yield* emailPassword.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      });
      const verification = yield* email.inspection.sent;
      const verificationToken = verification[0]?.token;
      if (verificationToken === undefined) return yield* Effect.die("Expected verification token");

      const resetWithVerificationToken = yield* recovery
        .resetPassword({
          now: 1,
          password: normalizePassword("new correct horse"),
          token: verificationToken,
        })
        .pipe(Effect.flip);
      assert.deepStrictEqual(resetWithVerificationToken, invalidToken);

      yield* recovery.requestPasswordReset({
        callbackUrl: new URL("https://app.example.test/reset"),
        email: normalizeEmail("user@example.com"),
      });
      const sent = yield* email.inspection.sent;
      const resetToken = sent[1]?.token;
      if (resetToken === undefined) return yield* Effect.die("Expected reset token");
      const verifyWithResetToken = yield* emailPassword
        .verifyEmail({ now: 1, token: resetToken })
        .pipe(Effect.flip);
      assert.deepStrictEqual(verifyWithResetToken, invalidToken);
    }),
  );

  it.effect("propagates password policy, hash, and rate-limit failures", () =>
    Effect.gen(function* () {
      const { deps, email, emailPassword } = yield* setup;
      yield* emailPassword.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      });
      yield* makePasswordRecoveryWorkflows(deps).requestPasswordReset({
        callbackUrl: new URL("https://app.example.test/reset"),
        email: normalizeEmail("user@example.com"),
      });
      const sent = yield* email.inspection.sent;
      const resetToken = sent[1]?.token;
      if (resetToken === undefined) return yield* Effect.die("Expected reset token");

      const policy = yield* makePasswordRecoveryWorkflows(deps)
        .resetPassword({
          now: 1,
          password: normalizePassword("too-short"),
          token: resetToken,
        })
        .pipe(Effect.flip);
      assert.strictEqual(policy._tag, "PasswordPolicyFailure");

      const failingHashDeps: PasswordRecoveryWorkflowDeps = {
        ...deps,
        passwordHasher: {
          hash: () => Effect.fail(new PasswordHashFailure({ reason: "HashingFailed" })),
          verify: deps.passwordHasher.verify,
        },
      };
      yield* makePasswordRecoveryWorkflows(deps).requestPasswordReset({
        callbackUrl: new URL("https://app.example.test/reset"),
        email: normalizeEmail("user@example.com"),
      });
      const resent = yield* email.inspection.sent;
      const nextToken = resent[2]?.token;
      if (nextToken === undefined) return yield* Effect.die("Expected reset token");
      const hash = yield* makePasswordRecoveryWorkflows(failingHashDeps)
        .resetPassword({
          now: 1,
          password: normalizePassword("new correct horse"),
          token: nextToken,
        })
        .pipe(Effect.flip);
      assert.strictEqual(hash._tag, "PasswordHashFailure");

      const rateLimiter: RateLimiterShape = {
        check: (attempt) =>
          Effect.fail(new RateLimitExceeded({ bucket: attempt.bucket, retryAfterMillis: 1_000 })),
      };
      const rateLimited = yield* makePasswordRecoveryWorkflows({
        ...deps,
        rateLimiter,
      })
        .requestPasswordReset({
          callbackUrl: new URL("https://app.example.test/reset"),
          email: normalizeEmail("user@example.com"),
        })
        .pipe(Effect.flip);
      assert.strictEqual(rateLimited._tag, "RateLimitExceeded");
    }),
  );
});
