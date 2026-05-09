import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { AuthBoundaryLive } from "./domain";
import {
  AuthApi,
  AuthApiGroup,
  AuthSessionCookieName,
  UnsafeAllowAllTrustedOriginPolicy,
  makeExpiredSessionCookie,
  makeSessionCookie,
  makeTrustedOriginPolicy,
} from "./http";
import { SessionToken } from "./domain";
import { Schema } from "effect";

describe("auth http api", () => {
  it.effect("defines the email password and session endpoints", () =>
    Effect.sync(() => {
      const endpoints = Object.keys(AuthApiGroup.endpoints).sort();
      const groups = Object.keys(AuthApi.groups);

      assert.deepStrictEqual(groups, ["auth"]);
      assert.deepStrictEqual(endpoints, [
        "currentSession",
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
});
