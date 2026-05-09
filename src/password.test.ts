import { describe, effect, expect, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import { PasswordHash, normalizeEmail, normalizePassword } from "./domain";
import {
  NativeScryptPasswordHasher,
  PasswordHashFailure,
  PasswordPolicyFailure,
  ScryptParams,
  SecureDefaultPasswordPolicy,
} from "./password";

describe("password policy", () => {
  effect("accepts passwords between 12 and 128 chars", () =>
    SecureDefaultPasswordPolicy.validate({
      email: normalizeEmail("user@example.com"),
      password: normalizePassword("correct horse"),
    }),
  );

  effect("rejects short and long passwords", () =>
    Effect.gen(function* () {
      const short = yield* SecureDefaultPasswordPolicy.validate({
        email: normalizeEmail("user@example.com"),
        password: normalizePassword("too-short"),
      }).pipe(Effect.flip);
      const tooLong = yield* SecureDefaultPasswordPolicy.validate({
        email: normalizeEmail("user@example.com"),
        password: normalizePassword("x".repeat(129)),
      }).pipe(Effect.flip);

      expect(short).toBeInstanceOf(PasswordPolicyFailure);
      expect(short.reason).toBe("TooShort");
      expect(tooLong.reason).toBe("TooLong");
    }),
  );

  effect("rejects passwords matching normalized email or local part", () =>
    Effect.gen(function* () {
      const email = normalizeEmail("longusername@example.com");
      const matchesEmail = yield* SecureDefaultPasswordPolicy.validate({
        email,
        password: normalizePassword("longusername@example.com"),
      }).pipe(Effect.flip);
      const matchesLocalPart = yield* SecureDefaultPasswordPolicy.validate({
        email,
        password: normalizePassword("longusername"),
      }).pipe(Effect.flip);

      expect(matchesEmail.reason).toBe("MatchesEmail");
      expect(matchesLocalPart.reason).toBe("MatchesEmailLocalPart");
    }),
  );

  effect("compares policy against NFKC-normalized password text", () =>
    Effect.gen(function* () {
      const result = yield* SecureDefaultPasswordPolicy.validate({
        email: normalizeEmail("\u00e9@example.com"),
        password: normalizePassword("e\u0301@example.com"),
      }).pipe(Effect.flip);

      expect(result.reason).toBe("MatchesEmail");
    }),
  );
});

describe("native scrypt password hasher", () => {
  effect("hashes passwords with self-describing PHC-like scrypt hashes", () =>
    Effect.gen(function* () {
      const hash = yield* NativeScryptPasswordHasher.hash(normalizePassword("correct horse"));
      const value = Redacted.value(hash);

      expect(String(hash)).toBe("<redacted:PasswordHash>");
      expect(value).toMatch(
        new RegExp(
          String.raw`^\$scrypt\$n=${ScryptParams.N},r=${ScryptParams.r},p=${ScryptParams.p},dkLen=${ScryptParams.dkLen}\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$`,
        ),
      );
    }),
  );

  effect("uses random salts for the same password", () =>
    Effect.gen(function* () {
      const first = yield* NativeScryptPasswordHasher.hash(normalizePassword("correct horse"));
      const second = yield* NativeScryptPasswordHasher.hash(normalizePassword("correct horse"));

      expect(Redacted.value(first)).not.toBe(Redacted.value(second));
    }),
  );

  effect("verifies correct passwords and rejects wrong passwords", () =>
    Effect.gen(function* () {
      const hash = yield* NativeScryptPasswordHasher.hash(normalizePassword("correct horse"));
      const correct = yield* NativeScryptPasswordHasher.verify({
        hash,
        password: normalizePassword("correct horse"),
      });
      const wrong = yield* NativeScryptPasswordHasher.verify({
        hash,
        password: normalizePassword("wrong horse"),
      });

      expect(correct).toBe(true);
      expect(wrong).toBe(false);
    }),
  );

  effect("rejects malformed hashes with typed failures", () =>
    Effect.gen(function* () {
      const result = yield* NativeScryptPasswordHasher.verify({
        hash: yield* Schema.decodeEffect(PasswordHash)("not-a-hash"),
        password: normalizePassword("correct horse"),
      }).pipe(Effect.flip);

      expect(result).toBeInstanceOf(PasswordHashFailure);
      expect(result.reason).toBe("MalformedHash");
    }),
  );

  it("redacts password hashes in JSON output", () => {
    const hash = Schema.decodeSync(PasswordHash)("$scrypt$secret");

    expect(JSON.stringify(hash)).toBe('"<redacted:PasswordHash>"');
  });
});
