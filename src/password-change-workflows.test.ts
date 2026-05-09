import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { AuthBoundaryLive, normalizeEmail, normalizePassword, unauthorized } from "./domain";
import { makeMockAuthEmail } from "./email";
import { NativeScryptPasswordHasher, SecureDefaultPasswordPolicy } from "./password";
import {
  RateLimitExceeded,
  UnsafePermissiveRateLimiter,
  type RateLimiterShape,
} from "./rate-limit";
import { makeDevMemoryStorage } from "./storage";
import { AuthTokenLive } from "./token";
import { makeEmailPasswordWorkflows, makePasswordRecoveryWorkflows } from "./workflows";

const setup = Effect.gen(function* () {
  const storage = yield* makeDevMemoryStorage;
  const email = yield* makeMockAuthEmail;
  const deps = {
    authEmail: email.authEmail,
    authToken: AuthTokenLive,
    passwordHasher: NativeScryptPasswordHasher,
    passwordPolicy: SecureDefaultPasswordPolicy,
    rateLimiter: UnsafePermissiveRateLimiter,
    storage,
  };
  const emailPassword = makeEmailPasswordWorkflows({
    ...deps,
    boundary: AuthBoundaryLive,
  });
  const recovery = makePasswordRecoveryWorkflows(deps);

  yield* emailPassword.signUp({
    callbackUrl: new URL("https://app.example.test/verify"),
    email: "user@example.com",
    password: "correct horse",
  });
  const sent = yield* email.inspection.sent;
  const verificationToken = sent[0]?.token;
  if (verificationToken === undefined) return yield* Effect.die("Expected verification token");
  yield* emailPassword.verifyEmail({ now: 1, token: verificationToken });
  const firstSignIn = yield* emailPassword.signIn({
    email: normalizeEmail("user@example.com"),
    password: normalizePassword("correct horse"),
  });
  const secondSignIn = yield* emailPassword.signIn({
    email: normalizeEmail("user@example.com"),
    password: normalizePassword("correct horse"),
  });

  return { emailPassword, firstSignIn, recovery, secondSignIn, storage };
});

describe("password change workflows", () => {
  it.effect("changes password, revokes other sessions, and rotates current session", () =>
    Effect.gen(function* () {
      const { emailPassword, firstSignIn, recovery, secondSignIn, storage } = yield* setup;

      const result = yield* recovery.changePassword({
        currentPassword: normalizePassword("correct horse"),
        currentSessionToken: firstSignIn.sessionToken,
        email: normalizeEmail("user@example.com"),
        newPassword: normalizePassword("new correct horse"),
        now: 2,
      });
      const oldCurrentHash = yield* AuthTokenLive.hashToken(firstSignIn.sessionToken);
      const newCurrentHash = yield* AuthTokenLive.hashToken(result.currentSessionToken);
      const otherHash = yield* AuthTokenLive.hashToken(secondSignIn.sessionToken);
      const oldCurrent = yield* storage.findSessionByTokenHash(oldCurrentHash, 2).pipe(Effect.flip);
      const newCurrent = yield* storage.findSessionByTokenHash(newCurrentHash, 2);
      const other = yield* storage.findSessionByTokenHash(otherHash, 2).pipe(Effect.flip);
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

      assert.strictEqual(oldCurrent.reason, "NotFound");
      assert.strictEqual(newCurrent.session.userId, firstSignIn.user.id);
      assert.strictEqual(other.reason, "NotFound");
      assert.deepStrictEqual(oldPassword, unauthorized);
      assert.strictEqual(newPassword.user.id, firstSignIn.user.id);
    }),
  );

  it.effect("rejects expired sessions and wrong current passwords", () =>
    Effect.gen(function* () {
      const { firstSignIn, recovery } = yield* setup;

      const expired = yield* recovery
        .changePassword({
          currentPassword: normalizePassword("correct horse"),
          currentSessionToken: firstSignIn.sessionToken,
          email: normalizeEmail("user@example.com"),
          newPassword: normalizePassword("new correct horse"),
          now: 7 * 24 * 60 * 60 * 1_000,
        })
        .pipe(Effect.flip);
      const wrongPassword = yield* recovery
        .changePassword({
          currentPassword: normalizePassword("wrong horse"),
          currentSessionToken: firstSignIn.sessionToken,
          email: normalizeEmail("user@example.com"),
          newPassword: normalizePassword("new correct horse"),
          now: 2,
        })
        .pipe(Effect.flip);

      assert.deepStrictEqual(expired, unauthorized);
      assert.deepStrictEqual(wrongPassword, unauthorized);
    }),
  );

  it.effect("propagates policy and rate-limit failures", () =>
    Effect.gen(function* () {
      const { firstSignIn, recovery, storage } = yield* setup;

      const policy = yield* recovery
        .changePassword({
          currentPassword: normalizePassword("correct horse"),
          currentSessionToken: firstSignIn.sessionToken,
          email: normalizeEmail("user@example.com"),
          newPassword: normalizePassword("too-short"),
          now: 2,
        })
        .pipe(Effect.flip);
      assert.strictEqual(policy._tag, "PasswordPolicyFailure");

      const rateLimiter: RateLimiterShape = {
        check: (attempt) =>
          Effect.fail(new RateLimitExceeded({ bucket: attempt.bucket, retryAfterMillis: 1_000 })),
      };
      const rateLimited = yield* makePasswordRecoveryWorkflows({
        authEmail: (yield* makeMockAuthEmail).authEmail,
        authToken: AuthTokenLive,
        passwordHasher: NativeScryptPasswordHasher,
        passwordPolicy: SecureDefaultPasswordPolicy,
        rateLimiter,
        storage,
      })
        .changePassword({
          currentPassword: normalizePassword("correct horse"),
          currentSessionToken: firstSignIn.sessionToken,
          email: normalizeEmail("user@example.com"),
          newPassword: normalizePassword("new correct horse"),
          now: 2,
        })
        .pipe(Effect.flip);

      assert.strictEqual(rateLimited._tag, "RateLimitExceeded");
    }),
  );
});
