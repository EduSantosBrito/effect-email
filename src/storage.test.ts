import { describe, effect, expect } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import { normalizeEmail, PasswordHash, TokenHash } from "./domain";
import { makeDevMemoryStorage, AuthStorageFailure } from "./storage";

const passwordHash = (value: string) => Schema.decodeSync(PasswordHash)(value);
const tokenHash = (value: string) => Schema.decodeSync(TokenHash)(value);

describe("dev memory auth storage", () => {
  effect("enforces unique normalized email credentials", () =>
    Effect.gen(function* () {
      const storage = yield* makeDevMemoryStorage;
      const email = normalizeEmail("user@example.com");
      const user = yield* storage.createUserWithEmailPasswordCredential({
        email,
        passwordHash: passwordHash("hash-1"),
      });
      const duplicate = yield* storage
        .createUserWithEmailPasswordCredential({
          email,
          passwordHash: passwordHash("hash-2"),
        })
        .pipe(Effect.flip);

      expect(user.id).toBe("user_1");
      expect(duplicate).toBeInstanceOf(AuthStorageFailure);
      expect(duplicate.reason).toBe("Conflict");
    }),
  );

  effect("consumes verification tokens exactly once and verifies credentials", () =>
    Effect.gen(function* () {
      const storage = yield* makeDevMemoryStorage;
      const email = normalizeEmail("user@example.com");
      const user = yield* storage.createUserWithEmailPasswordCredential({
        email,
        passwordHash: passwordHash("hash-1"),
      });
      const hash = tokenHash("verification-hash");

      yield* storage.storeVerificationToken({
        email,
        expiresAt: 200,
        hash,
        purpose: "EmailVerification",
        userId: user.id,
      });

      const consumed = yield* storage.consumeVerificationToken({ hash, now: 100 });
      const second = yield* storage.consumeVerificationToken({ hash, now: 100 }).pipe(Effect.flip);
      const lookup = yield* storage.findCredentialByEmail(email);

      expect(consumed.consumedAt).toBe(100);
      expect(second.reason).toBe("TokenConsumed");
      expect(lookup.credential.emailVerified).toBe(true);
    }),
  );

  effect("rejects expired tokens", () =>
    Effect.gen(function* () {
      const storage = yield* makeDevMemoryStorage;
      const email = normalizeEmail("user@example.com");
      const user = yield* storage.createUserWithEmailPasswordCredential({
        email,
        passwordHash: passwordHash("hash-1"),
      });
      const hash = tokenHash("expired-hash");

      yield* storage.storeVerificationToken({
        email,
        expiresAt: 100,
        hash,
        purpose: "PasswordReset",
        userId: user.id,
      });

      const result = yield* storage.consumeVerificationToken({ hash, now: 100 }).pipe(Effect.flip);

      expect(result.reason).toBe("TokenExpired");
    }),
  );

  effect("rotates session token hashes atomically", () =>
    Effect.gen(function* () {
      const storage = yield* makeDevMemoryStorage;
      const user = yield* storage.createUserWithEmailPasswordCredential({
        email: normalizeEmail("user@example.com"),
        passwordHash: passwordHash("hash-1"),
      });
      const oldHash = tokenHash("old-session");
      const nextHash = tokenHash("next-session");
      const session = yield* storage.createSession({
        expiresAt: 200,
        tokenHash: oldHash,
        userId: user.id,
      });

      const rotated = yield* storage.rotateSessionToken({
        expiresAt: 300,
        nextHash,
        now: 100,
        previousHash: oldHash,
      });
      const oldLookup = yield* storage.findSessionByTokenHash(oldHash, 100).pipe(Effect.flip);
      const nextLookup = yield* storage.findSessionByTokenHash(nextHash, 100);

      expect(rotated.id).toBe(session.id);
      expect(oldLookup.reason).toBe("NotFound");
      expect(nextLookup.session.expiresAt).toBe(300);
    }),
  );

  effect("revokes current, other, and all user sessions", () =>
    Effect.gen(function* () {
      const storage = yield* makeDevMemoryStorage;
      const user = yield* storage.createUserWithEmailPasswordCredential({
        email: normalizeEmail("user@example.com"),
        passwordHash: passwordHash("hash-1"),
      });
      const firstHash = tokenHash("session-1");
      const secondHash = tokenHash("session-2");
      const first = yield* storage.createSession({
        expiresAt: 200,
        tokenHash: firstHash,
        userId: user.id,
      });
      yield* storage.createSession({
        expiresAt: 200,
        tokenHash: secondHash,
        userId: user.id,
      });

      yield* storage.revokeOtherSessions({ currentSessionId: first.id, now: 100, userId: user.id });
      const firstLookup = yield* storage.findSessionByTokenHash(firstHash, 100);
      const secondLookup = yield* storage.findSessionByTokenHash(secondHash, 100).pipe(Effect.flip);

      yield* storage.revokeAllUserSessions({ now: 101, userId: user.id });
      const firstAfterAll = yield* storage.findSessionByTokenHash(firstHash, 101).pipe(Effect.flip);

      expect(firstLookup.session.id).toBe(first.id);
      expect(secondLookup.reason).toBe("NotFound");
      expect(firstAfterAll.reason).toBe("NotFound");
    }),
  );

  effect("updates password hashes without exposing generic CRUD", () =>
    Effect.gen(function* () {
      const storage = yield* makeDevMemoryStorage;
      const email = normalizeEmail("user@example.com");
      const user = yield* storage.createUserWithEmailPasswordCredential({
        email,
        passwordHash: passwordHash("old-hash"),
      });

      yield* storage.updatePasswordHash({
        passwordHash: passwordHash("new-hash"),
        userId: user.id,
      });
      const lookup = yield* storage.findCredentialByEmail(email);

      expect(Redacted.value(lookup.credential.passwordHash)).toBe("new-hash");
    }),
  );

  effect("rejects expired session lookups", () =>
    Effect.gen(function* () {
      const storage = yield* makeDevMemoryStorage;
      const user = yield* storage.createUserWithEmailPasswordCredential({
        email: normalizeEmail("user@example.com"),
        passwordHash: passwordHash("hash-1"),
      });
      const hash = tokenHash("session");
      yield* storage.createSession({ expiresAt: 100, tokenHash: hash, userId: user.id });

      const result = yield* storage.findSessionByTokenHash(hash, 100).pipe(Effect.flip);

      expect(result.reason).toBe("SessionExpired");
    }),
  );
});
