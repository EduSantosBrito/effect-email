import { assert, describe, effect } from "@effect/vitest";
import { Effect, Inspectable, Schema } from "effect";
import { normalizeEmail, VerificationToken } from "./domain";
import { makeMockAuthEmail } from "./email";

const verificationToken = (value: string) => Schema.decodeSync(VerificationToken)(value);

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

      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0]?.kind, "EmailVerification");
      assert.strictEqual(sent[0]?.to, "user@example.com");
      assert.strictEqual(String(sent[0]?.token), "<redacted:VerificationToken>");
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

      assert.strictEqual(sent.length, 1);
      assert.strictEqual(sent[0]?.kind, "PasswordReset");
      assert.strictEqual(sent[0]?.callbackUrl.toString(), "https://app.example.test/reset");
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

      assert.strictEqual(sent.length, 0);
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

      assert.strictEqual(String(sent[0]?.token), "<redacted:VerificationToken>");
      assert.strictEqual(Inspectable.toJson(sent[0]?.token), "<redacted:VerificationToken>");
    }),
  );
});
