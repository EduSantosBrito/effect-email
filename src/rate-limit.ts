import { Clock, Context, Effect, Layer, Ref, Schema } from "effect";
import type { NormalizedEmail } from "./domain";

export const RateLimitBucket = Schema.Literals([
  "SignIn",
  "SignUp",
  "ResendVerification",
  "PasswordReset",
  "PasswordChange",
]);
export type RateLimitBucket = typeof RateLimitBucket.Type;

export class RateLimitExceeded extends Schema.TaggedErrorClass<RateLimitExceeded>()(
  "RateLimitExceeded",
  {
    bucket: RateLimitBucket,
    retryAfterMillis: Schema.Number,
  },
) {}

export interface RateLimitAttempt {
  readonly bucket: RateLimitBucket;
  readonly email?: NormalizedEmail;
  readonly ip?: string;
}

export interface RateLimiterShape {
  readonly check: (attempt: RateLimitAttempt) => Effect.Effect<void, RateLimitExceeded>;
}

export class RateLimiter extends Context.Service<RateLimiter, RateLimiterShape>()(
  "effect-auth/rate-limit/RateLimiter",
) {}

export interface RateLimitConfig {
  readonly limit: number;
  readonly windowMillis: number;
}

interface RateLimitEntry {
  readonly count: number;
  readonly windowStartedAt: number;
}

type RateLimitDecision =
  | { readonly _tag: "Allowed" }
  | { readonly _tag: "Exceeded"; readonly retryAfterMillis: number };

type RateLimitStateChange = readonly [RateLimitDecision, ReadonlyMap<string, RateLimitEntry>];

export const DefaultRateLimitConfig: RateLimitConfig = {
  limit: 100,
  windowMillis: 10_000,
};

export const deriveRateLimitKey = (attempt: RateLimitAttempt): string => {
  const email = attempt.email ?? "_";
  const ip = attempt.ip ?? "_";
  return `${attempt.bucket}:email=${encodeURIComponent(email)}:ip=${encodeURIComponent(ip)}`;
};

export const makeDevMemoryRateLimiter = (
  config: RateLimitConfig = DefaultRateLimitConfig,
): Effect.Effect<RateLimiterShape> =>
  Effect.gen(function* () {
    const attemptsRef = yield* Ref.make<ReadonlyMap<string, RateLimitEntry>>(new Map());

    return {
      check: (attempt) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const key = deriveRateLimitKey(attempt);
          const result = yield* Ref.modify(attemptsRef, (attempts) => {
            const current = attempts.get(key);
            const isNewWindow =
              current === undefined || now - current.windowStartedAt >= config.windowMillis;
            const nextEntry: RateLimitEntry = isNewWindow
              ? { count: 1, windowStartedAt: now }
              : { ...current, count: current.count + 1 };
            const retryAfterMillis = isNewWindow
              ? config.windowMillis
              : Math.max(0, config.windowMillis - (now - current.windowStartedAt));

            const decision: RateLimitDecision =
              nextEntry.count > config.limit
                ? { _tag: "Exceeded", retryAfterMillis }
                : { _tag: "Allowed" };
            const stateChange: RateLimitStateChange = [
              decision,
              new Map(attempts).set(key, nextEntry),
            ];
            return stateChange;
          });

          if (result._tag === "Exceeded") {
            return yield* new RateLimitExceeded({
              bucket: attempt.bucket,
              retryAfterMillis: result.retryAfterMillis,
            });
          }
        }),
    };
  });

export const DevMemoryRateLimiterLayer = Layer.effect(
  RateLimiter,
  makeDevMemoryRateLimiter().pipe(Effect.map((rateLimiter) => RateLimiter.of(rateLimiter))),
);

export const makeBoundedDevMemoryRateLimiterLayer = (config: RateLimitConfig) =>
  Layer.effect(
    RateLimiter,
    makeDevMemoryRateLimiter(config).pipe(Effect.map((rateLimiter) => RateLimiter.of(rateLimiter))),
  );

export const UnsafePermissiveRateLimiter: RateLimiterShape = {
  check: () => Effect.void,
};

export const UnsafePermissiveRateLimiterLayer = Layer.succeed(
  RateLimiter,
  RateLimiter.of(UnsafePermissiveRateLimiter),
);
