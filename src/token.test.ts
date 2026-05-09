import { assert, describe, effect, it } from "@effect/vitest";
import { Effect, Inspectable, Redacted } from "effect";
import { AuthTokenLive } from "./token";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const hashPattern = /^[A-Za-z0-9_-]{43}$/u;

describe("auth token service", () => {
  effect("generates 32-byte base64url verification tokens with storage hashes", () =>
    Effect.gen(function* () {
      const result = yield* AuthTokenLive.makeVerificationToken;

      assert.match(Redacted.value(result.token), tokenPattern);
      assert.match(Redacted.value(result.hash), hashPattern);
      assert.strictEqual(String(result.token), "<redacted:VerificationToken>");
      assert.strictEqual(String(result.hash), "<redacted:TokenHash>");
    }),
  );

  effect("generates 32-byte base64url session tokens with storage hashes", () =>
    Effect.gen(function* () {
      const result = yield* AuthTokenLive.makeSessionToken;

      assert.match(Redacted.value(result.token), tokenPattern);
      assert.match(Redacted.value(result.hash), hashPattern);
      assert.strictEqual(String(result.token), "<redacted:SessionToken>");
    }),
  );

  effect("hashes tokens deterministically without exposing raw values", () =>
    Effect.gen(function* () {
      const result = yield* AuthTokenLive.makeVerificationToken;
      const hash = yield* AuthTokenLive.hashToken(result.token);

      assert.strictEqual(Redacted.value(hash), Redacted.value(result.hash));
      assert.strictEqual(Inspectable.toJson(hash), "<redacted:TokenHash>");
    }),
  );

  effect("uses fresh entropy for each token", () =>
    Effect.gen(function* () {
      const first = yield* AuthTokenLive.makeSessionToken;
      const second = yield* AuthTokenLive.makeSessionToken;

      assert.notStrictEqual(Redacted.value(first.token), Redacted.value(second.token));
      assert.notStrictEqual(Redacted.value(first.hash), Redacted.value(second.hash));
    }),
  );

  it.effect("does not expose raw token values through JSON", () =>
    Effect.sync(() => {
      const token = Redacted.make("secret-token", { label: "VerificationToken" });

      assert.strictEqual(Inspectable.toJson(token), "<redacted:VerificationToken>");
    }),
  );
});
