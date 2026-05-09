import { assert, describe, it } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import {
  AuthBoundaryLive,
  emailNotVerified,
  normalizeEmail,
  normalizePassword,
  unauthorized,
} from "./domain";
import { makeMockAuthEmail, AuthEmailFailure } from "./email";
import { NativeScryptPasswordHasher, SecureDefaultPasswordPolicy } from "./password";
import {
  RateLimitExceeded,
  UnsafePermissiveRateLimiter,
  type RateLimiterShape,
} from "./rate-limit";
import { makeDevMemoryStorage } from "./storage";
import { AuthTokenLive } from "./token";
import { makeEmailPasswordWorkflows, type EmailPasswordWorkflowDeps } from "./workflows";

const makeDeps = Effect.gen(function* () {
  const storage = yield* makeDevMemoryStorage;
  const email = yield* makeMockAuthEmail;
  const deps: EmailPasswordWorkflowDeps = {
    authEmail: email.authEmail,
    authToken: AuthTokenLive,
    boundary: AuthBoundaryLive,
    passwordHasher: NativeScryptPasswordHasher,
    passwordPolicy: SecureDefaultPasswordPolicy,
    rateLimiter: UnsafePermissiveRateLimiter,
    storage,
  };

  return { deps, email, storage };
});

const makeWorkflows = Effect.map(makeDeps, ({ deps, email, storage }) => ({
  email,
  storage,
  workflows: makeEmailPasswordWorkflows(deps),
}));

const requireValue = <A>(value: A | undefined): Effect.Effect<A> =>
  value === undefined ? Effect.die("Expected value to exist") : Effect.succeed(value);

describe("email password workflows", () => {
  it.effect("signs up without issuing a session and sends a verification email", () =>
    Effect.gen(function* () {
      const { email, workflows } = yield* makeWorkflows;

      const result = yield* workflows.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "USER@example.com",
        password: "correct horse",
      });
      const sent = yield* email.inspection.sent;

      assert.strictEqual(result.user.id, "user_1");
      assert.strictEqual("sessionToken" in result, false);
      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0]?.kind, "EmailVerification");
      assert.strictEqual(sent[0]?.to, "user@example.com");
    }),
  );

  it.effect("rejects duplicate sign-up emails", () =>
    Effect.gen(function* () {
      const { workflows } = yield* makeWorkflows;
      const input = {
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      };

      yield* workflows.signUp(input);
      const duplicate = yield* workflows.signUp(input).pipe(Effect.flip);

      assert.strictEqual(duplicate._tag, "AuthStorageFailure");
      if (duplicate._tag === "AuthStorageFailure") {
        assert.strictEqual(duplicate.reason, "Conflict");
      }
    }),
  );

  it.effect("verifies email by consuming exactly one valid token", () =>
    Effect.gen(function* () {
      const { email, storage, workflows } = yield* makeWorkflows;
      yield* workflows.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      });
      const sent = yield* email.inspection.sent;
      const token = yield* requireValue(sent[0]?.token);

      const verified = yield* workflows.verifyEmail({ token, now: 1 });
      const consumedAgain = yield* workflows.verifyEmail({ token, now: 1 }).pipe(Effect.flip);
      const credential = yield* storage.findCredentialByEmail(normalizeEmail("user@example.com"));

      assert.strictEqual(verified.verified, true);
      assert.strictEqual(consumedAgain._tag, "AuthStorageFailure");
      if (consumedAgain._tag === "AuthStorageFailure") {
        assert.strictEqual(consumedAgain.reason, "TokenConsumed");
      }
      assert.strictEqual(credential.credential.emailVerified, true);
    }),
  );

  it.effect("resends verification with a fresh token and email", () =>
    Effect.gen(function* () {
      const { email, workflows } = yield* makeWorkflows;
      yield* workflows.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      });

      yield* workflows.resendVerification({
        callbackUrl: new URL("https://app.example.test/verify-again"),
        email: normalizeEmail("user@example.com"),
      });
      const sent = yield* email.inspection.sent;

      assert.strictEqual(sent.length, 2);
      assert.notStrictEqual(
        Redacted.value(yield* requireValue(sent[0]?.token)),
        Redacted.value(yield* requireValue(sent[1]?.token)),
      );
      assert.strictEqual(sent[1]?.callbackUrl.toString(), "https://app.example.test/verify-again");
    }),
  );

  it.effect("propagates email delivery failures from sign-up", () =>
    Effect.gen(function* () {
      const { deps } = yield* makeDeps;
      const workflows = makeEmailPasswordWorkflows({
        ...deps,
        authEmail: {
          sendEmailVerification: () =>
            Effect.fail(new AuthEmailFailure({ reason: "DeliveryUnavailable" })),
          sendPasswordReset: deps.authEmail.sendPasswordReset,
        },
      });

      const failure = yield* workflows
        .signUp({
          callbackUrl: new URL("https://app.example.test/verify"),
          email: "user@example.com",
          password: "correct horse",
        })
        .pipe(Effect.flip);

      assert.strictEqual(failure._tag, "AuthEmailFailure");
      if (failure._tag === "AuthEmailFailure") {
        assert.strictEqual(failure.reason, "DeliveryUnavailable");
      }
    }),
  );

  it.effect("propagates SDK rate-limit failures", () =>
    Effect.gen(function* () {
      const { deps } = yield* makeDeps;
      const rateLimiter: RateLimiterShape = {
        check: (attempt) =>
          Effect.fail(
            new RateLimitExceeded({
              bucket: attempt.bucket,
              retryAfterMillis: 1_000,
            }),
          ),
      };
      const workflows = makeEmailPasswordWorkflows({ ...deps, rateLimiter });

      const failure = yield* workflows
        .signUp({
          callbackUrl: new URL("https://app.example.test/verify"),
          email: "user@example.com",
          password: "correct horse",
        })
        .pipe(Effect.flip);

      assert.strictEqual(failure._tag, "RateLimitExceeded");
      if (failure._tag === "RateLimitExceeded") {
        assert.strictEqual(failure.retryAfterMillis, 1_000);
      }
    }),
  );

  it.effect("signs in verified credentials and creates a server-side session", () =>
    Effect.gen(function* () {
      const { email, storage, workflows } = yield* makeWorkflows;
      yield* workflows.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      });
      const sent = yield* email.inspection.sent;
      const token = yield* requireValue(sent[0]?.token);
      yield* workflows.verifyEmail({ token, now: 1 });

      const signedIn = yield* workflows.signIn({
        email: normalizeEmail("user@example.com"),
        password: normalizePassword("correct horse"),
      });
      const sessionHash = yield* AuthTokenLive.hashToken(signedIn.sessionToken);
      const session = yield* storage.findSessionByTokenHash(sessionHash, 1);

      assert.strictEqual(signedIn.user.id, "user_1");
      assert.strictEqual(session.session.userId, signedIn.user.id);
    }),
  );

  it.effect("returns generic unauthorized for missing or wrong credentials", () =>
    Effect.gen(function* () {
      const { workflows } = yield* makeWorkflows;
      const missing = yield* workflows
        .signIn({
          email: normalizeEmail("missing@example.com"),
          password: normalizePassword("correct horse"),
        })
        .pipe(Effect.flip);

      yield* workflows.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      });
      const wrong = yield* workflows
        .signIn({
          email: normalizeEmail("user@example.com"),
          password: normalizePassword("wrong horse"),
        })
        .pipe(Effect.flip);

      assert.deepStrictEqual(missing, unauthorized);
      assert.deepStrictEqual(wrong, unauthorized);
    }),
  );

  it.effect("returns EmailNotVerified only after correct password proof", () =>
    Effect.gen(function* () {
      const { workflows } = yield* makeWorkflows;
      yield* workflows.signUp({
        callbackUrl: new URL("https://app.example.test/verify"),
        email: "user@example.com",
        password: "correct horse",
      });

      const failure = yield* workflows
        .signIn({
          email: normalizeEmail("user@example.com"),
          password: normalizePassword("correct horse"),
        })
        .pipe(Effect.flip);

      assert.deepStrictEqual(failure, emailNotVerified);
    }),
  );
});
