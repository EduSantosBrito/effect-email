import { describe, effect, expect, it } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
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

      expect(email).toBe("user@example.com");
    }),
  );

  effect("rejects invalid email input with a typed parse failure", () =>
    Effect.gen(function* () {
      const result = yield* AuthBoundaryLive.parseEmail("not-an-email").pipe(Effect.flip);

      expect(result).toBeInstanceOf(BoundaryParseError);
      expect(result.field).toBe("email");
    }),
  );

  effect("normalizes passwords with NFKC without trimming or lowercasing", () =>
    Effect.gen(function* () {
      const password = yield* AuthBoundaryLive.parsePassword(" e\u0301XAMPLE ");

      expect(Redacted.value(password)).toBe(" \u00e9XAMPLE ");
    }),
  );

  it("redacts password text in string and JSON output", () => {
    const password = normalizePassword("super-secret-password");

    expect(String(password)).toBe("<redacted:PasswordText>");
    expect(JSON.stringify(password)).toBe('"<redacted:PasswordText>"');
  });

  effect("parses callback URLs and trusted origins", () =>
    Effect.gen(function* () {
      const callbackUrl = yield* AuthBoundaryLive.parseCallbackUrl(
        "https://app.example.test/auth/callback?x=1",
      );
      const origin = yield* AuthBoundaryLive.parseTrustedOrigin("https://app.example.test");

      expect(callbackUrl).toBe("https://app.example.test/auth/callback?x=1");
      expect(origin).toBe("https://app.example.test");
    }),
  );

  effect("rejects trusted origins with paths", () =>
    Effect.gen(function* () {
      const result = yield* AuthBoundaryLive.parseTrustedOrigin(
        "https://app.example.test/path",
      ).pipe(Effect.flip);

      expect(result).toBeInstanceOf(BoundaryParseError);
      expect(result.field).toBe("origin");
    }),
  );

  it("keeps secret auth values redacted", () => {
    const sessionToken = Schema.decodeSync(SessionToken)("raw-session-token");
    const passwordHash = Schema.decodeSync(PasswordHash)("stored-password-hash");

    expect(String(sessionToken)).toBe("<redacted:SessionToken>");
    expect(JSON.stringify(passwordHash)).toBe('"<redacted:PasswordHash>"');
  });

  it("exposes safe public auth errors", () => {
    expect(invalidCredentials).toBeInstanceOf(PublicAuthError);
    expect(invalidCredentials.code).toBe("InvalidCredentials");
    expect(invalidCredentials.message).not.toContain("user");
  });
});
