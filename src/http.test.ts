import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { AuthBoundaryLive, AuthBoundaryLiveLayer, SessionToken } from "./domain";
import {
  AuthApi,
  AuthApiGroup,
  AuthSessionCookieName,
  TrustedOriginPolicy,
  UnsafeAllowAllTrustedOriginPolicy,
  makeExpiredSessionCookie,
  makeSessionCookie,
  makeTrustedOriginPolicy,
  parseTrustedCallbackUrl,
} from "./http";

describe("auth http api", () => {
  it.effect("defines the email password and session endpoints", () =>
    Effect.sync(() => {
      const endpoints = Object.keys(AuthApiGroup.endpoints).sort();
      const groups = Object.keys(AuthApi.groups);

      assert.deepStrictEqual(groups, ["auth"]);
      assert.deepStrictEqual(endpoints, [
        "changePassword",
        "completePasswordReset",
        "currentSession",
        "requestPasswordReset",
        "resendVerification",
        "signInEmail",
        "signOut",
        "signUpEmail",
        "verifyEmail",
      ]);
    }),
  );

  it.effect("uses secure http-only lax session cookies by default", () =>
    Effect.gen(function* () {
      const token = yield* Schema.decodeEffect(SessionToken)("session_secret");
      const cookie = makeSessionCookie(token, { secure: true });
      const expired = makeExpiredSessionCookie({ secure: true });

      assert.strictEqual(cookie.name, AuthSessionCookieName);
      assert.strictEqual(cookie.value, "session_secret");
      assert.strictEqual(cookie.httpOnly, true);
      assert.strictEqual(cookie.sameSite, "lax");
      assert.strictEqual(cookie.path, "/");
      assert.strictEqual(cookie.secure, true);
      assert.strictEqual(expired.maxAge, 0);
      assert.strictEqual(expired.value, "");
    }),
  );

  it.effect("allows only configured trusted origins", () =>
    Effect.gen(function* () {
      const allowedOrigin = yield* AuthBoundaryLive.parseTrustedOrigin("https://app.example.test");
      const rejectedOrigin = yield* AuthBoundaryLive.parseTrustedOrigin("https://evil.example.test");
      const policy = makeTrustedOriginPolicy(new Set([allowedOrigin]));
      const allowed = yield* policy.allows(allowedOrigin);
      const rejected = yield* policy.allows(rejectedOrigin);
      const unsafe = yield* UnsafeAllowAllTrustedOriginPolicy.allows(rejectedOrigin);

      assert.strictEqual(allowed, true);
      assert.strictEqual(rejected, false);
      assert.strictEqual(unsafe, true);
    }),
  );

  it.effect("accepts only http callback URLs from trusted origins", () =>
    Effect.gen(function* () {
      const allowedOrigin = yield* AuthBoundaryLive.parseTrustedOrigin("https://app.example.test");
      const policy = makeTrustedOriginPolicy(new Set([allowedOrigin]));
      const layers = AuthBoundaryLiveLayer.pipe(
        Layer.provideMerge(Layer.succeed(TrustedOriginPolicy, TrustedOriginPolicy.of(policy))),
      );

      const accepted = yield* parseTrustedCallbackUrl(
        "https://app.example.test/auth/callback?token=abc",
      ).pipe(Effect.provide(layers));
      const rejectedOrigin = yield* parseTrustedCallbackUrl(
        "https://evil.example.test/auth/callback",
      ).pipe(Effect.provide(layers), Effect.flip);
      const rejectedProtocol = yield* parseTrustedCallbackUrl(
        "javascript:alert(1)",
      ).pipe(Effect.provide(layers), Effect.flip);

      assert.strictEqual(accepted.origin, "https://app.example.test");
      assert.strictEqual(rejectedOrigin.code, "InvalidCredentials");
      assert.strictEqual(rejectedProtocol.code, "InvalidCredentials");
    }),
  );
});
