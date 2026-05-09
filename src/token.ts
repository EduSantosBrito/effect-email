import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { SessionToken, TokenHash, VerificationToken } from "./domain";

export class TokenGenerationFailure extends Schema.TaggedErrorClass<TokenGenerationFailure>()(
  "TokenGenerationFailure",
  {
    reason: Schema.Literals(["UnavailableEntropy", "HashingFailed"]),
  },
) {}

export interface AuthTokenShape {
  readonly makeVerificationToken: Effect.Effect<
    { readonly token: VerificationToken; readonly hash: TokenHash },
    TokenGenerationFailure
  >;
  readonly makeSessionToken: Effect.Effect<
    { readonly token: SessionToken; readonly hash: TokenHash },
    TokenGenerationFailure
  >;
  readonly hashToken: (
    token: VerificationToken | SessionToken,
  ) => Effect.Effect<TokenHash, TokenGenerationFailure>;
}

export class AuthToken extends Context.Service<AuthToken, AuthTokenShape>()(
  "effect-auth/token/AuthToken",
) {}

const unavailableEntropy = new TokenGenerationFailure({ reason: "UnavailableEntropy" });
const hashingFailed = new TokenGenerationFailure({ reason: "HashingFailed" });

const base64UrlEncode = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const makeRawToken = Effect.try({
  try: () => {
    if (globalThis.crypto?.getRandomValues === undefined) {
      throw new Error("UnavailableEntropy");
    }
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
  },
  catch: () => unavailableEntropy,
});

const hashToken = (
  token: VerificationToken | SessionToken,
): Effect.Effect<TokenHash, TokenGenerationFailure> =>
  Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(Redacted.value(token))),
    catch: () => hashingFailed,
  }).pipe(
    Effect.map(
      (digest) =>
        Schema.decodeSync(TokenHash)(base64UrlEncode(new Uint8Array(digest))),
    ),
  );

const makeVerificationToken = Effect.gen(function* () {
  const rawToken = yield* makeRawToken;
  const token = yield* Schema.decodeEffect(VerificationToken)(rawToken).pipe(
    Effect.mapError(() => hashingFailed),
  );
  const hash = yield* hashToken(token);
  return { hash, token };
});

const makeSessionToken = Effect.gen(function* () {
  const rawToken = yield* makeRawToken;
  const token = yield* Schema.decodeEffect(SessionToken)(rawToken).pipe(
    Effect.mapError(() => hashingFailed),
  );
  const hash = yield* hashToken(token);
  return { hash, token };
});

export const AuthTokenLive: AuthTokenShape = {
  hashToken,
  makeSessionToken,
  makeVerificationToken,
};

export const AuthTokenLiveLayer = Layer.succeed(AuthToken, AuthToken.of(AuthTokenLive));
