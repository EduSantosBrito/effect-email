import { describe, effect, expect } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { normalizeEmail, VerificationToken } from "./domain";
import { makeMockAuthEmail } from "./email";

const verificationToken = (value: string) => Schema.decodeSync(VerificationToken)(value);

const redactedJson = (value: unknown) => {
  if (typeof value !== "object" || value === null) return undefined;
  const toJson = Reflect.get(value, "toJSON");
  return typeof toJson === "function" ? toJson.call(value) : undefined;
};

describe("mock auth email", () => {
  effect("records email verification commands for inspection", () =>
    Effect.gen(function* () {
      const mock = yield* makeMockAuthEmail;
      const token = verificationToken("raw-verification-token");

      yield* mock.authEmail.sendEmailVerification({
        callbackUrl: new URL("https://app.example.test/verify"),
        to: normalizeEmail("USER@example.com"),
        token,
      });

      const sent = yield* mock.inspection.sent;

      expect(sent).toHaveLength(1);
      expect(sent[0]?.kind).toBe("EmailVerification");
      expect(sent[0]?.to).toBe("user@example.com");
      expect(String(sent[0]?.token)).toBe("<redacted:VerificationToken>");
    }),
  );

  effect("records password reset commands for inspection", () =>
    Effect.gen(function* () {
      const mock = yield* makeMockAuthEmail;

      yield* mock.authEmail.sendPasswordReset({
        callbackUrl: new URL("https://app.example.test/reset"),
        to: normalizeEmail("user@example.com"),
        token: verificationToken("raw-reset-token"),
      });

      const sent = yield* mock.inspection.sent;

      expect(sent).toHaveLength(1);
      expect(sent[0]?.kind).toBe("PasswordReset");
      expect(sent[0]?.callbackUrl.toString()).toBe("https://app.example.test/reset");
    }),
  );

  effect("can clear recorded messages", () =>
    Effect.gen(function* () {
      const mock = yield* makeMockAuthEmail;

      yield* mock.authEmail.sendEmailVerification({
        callbackUrl: new URL("https://app.example.test/verify"),
        to: normalizeEmail("user@example.com"),
        token: verificationToken("raw-token"),
      });
      yield* mock.inspection.clear;
      const sent = yield* mock.inspection.sent;

      expect(sent).toHaveLength(0);
    }),
  );

  effect("does not expose raw tokens through string or JSON inspection", () =>
    Effect.gen(function* () {
      const mock = yield* makeMockAuthEmail;

      yield* mock.authEmail.sendPasswordReset({
        callbackUrl: new URL("https://app.example.test/reset"),
        to: normalizeEmail("user@example.com"),
        token: verificationToken("raw-reset-token"),
      });

      const sent = yield* mock.inspection.sent;

      expect(String(sent[0]?.token)).toBe("<redacted:VerificationToken>");
      expect(redactedJson(sent[0]?.token)).toBe("<redacted:VerificationToken>");
    }),
  );
});
