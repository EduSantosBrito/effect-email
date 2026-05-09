import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { normalizeEmail, normalizePassword, unauthorized } from "./domain";
import { makeMockAuthEmail } from "./email";
import { NativeScryptPasswordHasher, SecureDefaultPasswordPolicy } from "./password";
import { UnsafePermissiveRateLimiter } from "./rate-limit";
import { makeDevMemoryStorage } from "./storage";
import { AuthTokenLive } from "./token";
import { AuthBoundaryLive } from "./domain";
import { makeEmailPasswordWorkflows, makeSessionWorkflows } from "./workflows";

const setupVerifiedSession = Effect.gen(function* () {
  const storage = yield* makeDevMemoryStorage;
  const email = yield* makeMockAuthEmail;
  const emailPassword = makeEmailPasswordWorkflows({
    authEmail: email.authEmail,
    authToken: AuthTokenLive,
    boundary: AuthBoundaryLive,
    passwordHasher: NativeScryptPasswordHasher,
    passwordPolicy: SecureDefaultPasswordPolicy,
    rateLimiter: UnsafePermissiveRateLimiter,
    storage,
  });
  const sessions = makeSessionWorkflows({ authToken: AuthTokenLive, storage });

  yield* emailPassword.signUp({
    callbackUrl: new URL("https://app.example.test/verify"),
    email: "user@example.com",
    password: "correct horse",
  });
  const sent = yield* email.inspection.sent;
  const verificationToken = sent[0]?.token;
  if (verificationToken === undefined) {
    return yield* Effect.die("Expected verification token");
  }
  yield* emailPassword.verifyEmail({ now: 1, token: verificationToken });
  const signIn = yield* emailPassword.signIn({
    email: normalizeEmail("user@example.com"),
    password: normalizePassword("correct horse"),
  });

  return { sessions, signIn, storage };
});

describe("session workflows", () => {
  it.effect("returns unchanged current sessions before rolling refresh is due", () =>
    Effect.gen(function* () {
      const { sessions, signIn } = yield* setupVerifiedSession;

      const result = yield* sessions.currentSession({
        now: 60 * 60 * 1_000,
        token: signIn.sessionToken,
      });

      assert.strictEqual(result.session.userId, signIn.user.id);
      assert.strictEqual(result.tokenRotation._tag, "Unchanged");
    }),
  );

  it.effect("rotates current sessions after the update age", () =>
    Effect.gen(function* () {
      const { sessions, signIn, storage } = yield* setupVerifiedSession;

      const result = yield* sessions.currentSession({
        now: 25 * 60 * 60 * 1_000,
        token: signIn.sessionToken,
      });

      assert.strictEqual(result.tokenRotation._tag, "Rotated");
      if (result.tokenRotation._tag === "Rotated") {
        const oldHash = yield* AuthTokenLive.hashToken(signIn.sessionToken);
        const nextHash = yield* AuthTokenLive.hashToken(result.tokenRotation.token);
        const oldLookup = yield* storage
          .findSessionByTokenHash(oldHash, 25 * 60 * 60 * 1_000)
          .pipe(Effect.flip);
        const nextLookup = yield* storage.findSessionByTokenHash(nextHash, 25 * 60 * 60 * 1_000);

        assert.strictEqual(oldLookup.reason, "NotFound");
        assert.strictEqual(nextLookup.session.id, result.session.id);
      }
    }),
  );

  it.effect("maps missing and expired sessions to public unauthorized", () =>
    Effect.gen(function* () {
      const issued = yield* AuthTokenLive.makeSessionToken;
      const storage = yield* makeDevMemoryStorage;
      const sessions = makeSessionWorkflows({ authToken: AuthTokenLive, storage });

      const missing = yield* sessions
        .currentSession({ now: 1, token: issued.token })
        .pipe(Effect.flip);

      assert.deepStrictEqual(missing, unauthorized);
    }),
  );

  it.effect("signs out by revoking the current session", () =>
    Effect.gen(function* () {
      const { sessions, signIn } = yield* setupVerifiedSession;

      yield* sessions.signOut({ now: 1, token: signIn.sessionToken });
      const afterSignOut = yield* sessions
        .currentSession({ now: 1, token: signIn.sessionToken })
        .pipe(Effect.flip);

      assert.deepStrictEqual(afterSignOut, unauthorized);
    }),
  );
});
