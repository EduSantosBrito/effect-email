import { assert, describe, effect, it } from "@effect/vitest";
import { Effect, Inspectable, Redacted, Schema } from "effect";
import {
  AuthBoundaryLive,
  BoundaryParseError,
  invalidCredentials,
  normalizePassword,
  PasswordHash,
  PublicAuthError,
  SessionToken,
} from "./domain";

describe("domain boundary", () => {
  effect("normalizes email by trimming and lowercasing only", () =>
    Effect.gen(function* () {
      const email = yield* AuthBoundaryLive.parseEmail(" USER@example.COM ");

      assert.strictEqual(email, "user@example.com");
    }),
  );

  effect("rejects invalid email input with a typed parse failure", () =>
    Effect.gen(function* () {
      const result = yield* AuthBoundaryLive.parseEmail("not-an-email").pipe(Effect.flip);

      assert.ok(Schema.is(BoundaryParseError)(result));
      assert.strictEqual(result.field, "email");
    }),
  );

  effect("normalizes passwords with NFKC without trimming or lowercasing", () =>
    Effect.gen(function* () {
      const password = yield* AuthBoundaryLive.parsePassword(" e\u0301XAMPLE ");

      assert.strictEqual(Redacted.value(password), " \u00e9XAMPLE ");
    }),
  );

  it.effect("redacts password text in string and JSON output", () =>
    Effect.sync(() => {
      const password = normalizePassword("super-secret-password");

      assert.strictEqual(String(password), "<redacted:PasswordText>");
      assert.strictEqual(Inspectable.toJson(password), "<redacted:PasswordText>");
    }),
  );

  effect("parses callback URLs and trusted origins", () =>
    Effect.gen(function* () {
      const callbackUrl = yield* AuthBoundaryLive.parseCallbackUrl(
        "https://app.example.test/auth/callback?x=1",
      );
      const origin = yield* AuthBoundaryLive.parseTrustedOrigin("https://app.example.test");

      assert.strictEqual(callbackUrl, "https://app.example.test/auth/callback?x=1");
      assert.strictEqual(origin, "https://app.example.test");
    }),
  );

  effect("rejects trusted origins with paths", () =>
    Effect.gen(function* () {
      const result = yield* AuthBoundaryLive.parseTrustedOrigin(
        "https://app.example.test/path",
      ).pipe(Effect.flip);

      assert.ok(Schema.is(BoundaryParseError)(result));
      assert.strictEqual(result.field, "origin");
    }),
  );

  it.effect("keeps secret auth values redacted", () =>
    Effect.gen(function* () {
      const sessionToken = yield* Schema.decodeEffect(SessionToken)("raw-session-token");
      const passwordHash = yield* Schema.decodeEffect(PasswordHash)("stored-password-hash");

      assert.strictEqual(String(sessionToken), "<redacted:SessionToken>");
      assert.strictEqual(Inspectable.toJson(passwordHash), "<redacted:PasswordHash>");
    }),
  );

  it.effect("exposes safe public auth errors", () =>
    Effect.sync(() => {
      assert.ok(Schema.is(PublicAuthError)(invalidCredentials));
      assert.strictEqual(invalidCredentials.code, "InvalidCredentials");
      assert.ok(!invalidCredentials.message.includes("user"));
    }),
  );
});
