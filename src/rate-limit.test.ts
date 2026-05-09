import { describe, effect, expect } from "@effect/vitest";
import { Effect } from "effect";
import { normalizeEmail } from "./domain";
import {
  DefaultRateLimitConfig,
  deriveRateLimitKey,
  makeDevMemoryRateLimiter,
  type RateLimitAttempt,
  RateLimitExceeded,
  UnsafePermissiveRateLimiter,
} from "./rate-limit";

describe("rate limiter", () => {
  effect("derives deterministic SDK-owned keys from bucket and dimensions", () =>
    Effect.sync(() => {
      const attempt: RateLimitAttempt = {
        bucket: "SignIn",
        email: normalizeEmail("USER@example.com"),
        ip: "127.0.0.1",
      };

      expect(deriveRateLimitKey(attempt)).toBe("SignIn:email=user%40example.com:ip=127.0.0.1");
      expect(deriveRateLimitKey(attempt)).toBe(deriveRateLimitKey({ ...attempt }));
    }),
  );

  effect("uses broad production-style defaults", () =>
    Effect.sync(() => {
      expect(DefaultRateLimitConfig.limit).toBe(100);
      expect(DefaultRateLimitConfig.windowMillis).toBe(10_000);
    }),
  );

  effect("allows attempts within a bounded window and rejects excess attempts", () =>
    Effect.gen(function* () {
      const limiter = yield* makeDevMemoryRateLimiter({ limit: 2, windowMillis: 10_000 });
      const attempt: RateLimitAttempt = {
        bucket: "PasswordReset",
        email: normalizeEmail("user@example.com"),
        ip: "127.0.0.1",
      };

      yield* limiter.check(attempt);
      yield* limiter.check(attempt);
      const exceeded = yield* limiter.check(attempt).pipe(Effect.flip);

      expect(exceeded).toBeInstanceOf(RateLimitExceeded);
      expect(exceeded.bucket).toBe("PasswordReset");
      expect(exceeded.retryAfterMillis).toBeGreaterThan(0);
    }),
  );

  effect("isolates counters by bucket and dimensions", () =>
    Effect.gen(function* () {
      const limiter = yield* makeDevMemoryRateLimiter({ limit: 1, windowMillis: 10_000 });

      yield* limiter.check({ bucket: "SignIn", email: normalizeEmail("a@example.com") });
      yield* limiter.check({ bucket: "SignIn", email: normalizeEmail("b@example.com") });
      yield* limiter.check({ bucket: "SignUp", email: normalizeEmail("a@example.com") });
      const exceeded = yield* limiter
        .check({
          bucket: "SignIn",
          email: normalizeEmail("a@example.com"),
        })
        .pipe(Effect.flip);

      expect(exceeded.bucket).toBe("SignIn");
    }),
  );

  effect("provides an explicit unsafe permissive non-production limiter", () =>
    Effect.gen(function* () {
      yield* UnsafePermissiveRateLimiter.check({ bucket: "PasswordChange" });
      yield* UnsafePermissiveRateLimiter.check({ bucket: "PasswordChange" });
    }),
  );
});
