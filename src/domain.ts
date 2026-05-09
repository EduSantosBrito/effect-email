import { Context, Effect, Layer, Schema } from "effect";

export const NormalizedEmail = Schema.String.pipe(Schema.brand("NormalizedEmail"));
export type NormalizedEmail = typeof NormalizedEmail.Type;

export const PasswordText = Schema.RedactedFromValue(Schema.String, {
  label: "PasswordText",
});
export type PasswordText = typeof PasswordText.Type;

export const CallbackUrl = Schema.String.pipe(Schema.brand("CallbackUrl"));
export type CallbackUrl = typeof CallbackUrl.Type;

export const TrustedOrigin = Schema.String.pipe(Schema.brand("TrustedOrigin"));
export type TrustedOrigin = typeof TrustedOrigin.Type;

export const VerificationToken = Schema.RedactedFromValue(Schema.String, {
  label: "VerificationToken",
});
export type VerificationToken = typeof VerificationToken.Type;

export const ResetToken = Schema.RedactedFromValue(Schema.String, {
  label: "ResetToken",
});
export type ResetToken = typeof ResetToken.Type;

export const SessionToken = Schema.RedactedFromValue(Schema.String, {
  label: "SessionToken",
});
export type SessionToken = typeof SessionToken.Type;

export const TokenHash = Schema.RedactedFromValue(Schema.String, {
  label: "TokenHash",
});
export type TokenHash = typeof TokenHash.Type;

export const PasswordHash = Schema.RedactedFromValue(Schema.String, {
  label: "PasswordHash",
});
export type PasswordHash = typeof PasswordHash.Type;

export class BoundaryParseError extends Schema.TaggedErrorClass<BoundaryParseError>()(
  "BoundaryParseError",
  {
    field: Schema.String,
    reason: Schema.String,
  },
) {}

export class PublicAuthError extends Schema.TaggedErrorClass<PublicAuthError>()("PublicAuthError", {
  code: Schema.Literals([
    "InvalidCredentials",
    "EmailNotVerified",
    "InvalidToken",
    "RateLimited",
    "Unauthorized",
  ]),
  message: Schema.String,
}) {}

export class InternalAuthError extends Schema.TaggedErrorClass<InternalAuthError>()(
  "InternalAuthError",
  {
    code: Schema.String,
    message: Schema.String,
  },
) {}

export interface AuthBoundaryShape {
  readonly parseEmail: (input: unknown) => Effect.Effect<NormalizedEmail, BoundaryParseError>;
  readonly parsePassword: (input: unknown) => Effect.Effect<PasswordText, BoundaryParseError>;
  readonly parseCallbackUrl: (input: unknown) => Effect.Effect<CallbackUrl, BoundaryParseError>;
  readonly parseTrustedOrigin: (input: unknown) => Effect.Effect<TrustedOrigin, BoundaryParseError>;
}

export class AuthBoundary extends Context.Service<AuthBoundary, AuthBoundaryShape>()(
  "effect-auth/domain/AuthBoundary",
) {}

const decodeString = (field: string, input: unknown) =>
  Schema.decodeUnknownEffect(Schema.String)(input).pipe(
    Effect.mapErrorEager(
      () =>
        new BoundaryParseError({
          field,
          reason: "Expected string",
        }),
    ),
  );

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const normalizeEmail = (value: string): NormalizedEmail => {
  return Schema.decodeSync(NormalizedEmail)(value.trim().toLowerCase());
};

export const normalizePassword = (value: string): PasswordText => {
  return Schema.decodeSync(PasswordText)(value.normalize("NFKC"));
};

const parseEmail = (input: unknown): Effect.Effect<NormalizedEmail, BoundaryParseError> =>
  decodeString("email", input).pipe(
    Effect.flatMap((value) => {
      const email = normalizeEmail(value);
      return emailPattern.test(email)
        ? Effect.succeed(email)
        : Effect.fail(
            new BoundaryParseError({
              field: "email",
              reason: "Invalid email address",
            }),
          );
    }),
  );

const parsePassword = (input: unknown): Effect.Effect<PasswordText, BoundaryParseError> =>
  decodeString("password", input).pipe(Effect.map((value) => normalizePassword(value)));

const parseCallbackUrl = (input: unknown): Effect.Effect<CallbackUrl, BoundaryParseError> =>
  decodeString("callbackUrl", input).pipe(
    Effect.flatMap((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:"
          ? Effect.succeed(Schema.decodeSync(CallbackUrl)(url.toString()))
          : Effect.fail(
              new BoundaryParseError({
                field: "callbackUrl",
                reason: "Expected http or https URL",
              }),
            );
      } catch {
        return Effect.fail(
          new BoundaryParseError({
            field: "callbackUrl",
            reason: "Invalid URL",
          }),
        );
      }
    }),
  );

const parseTrustedOrigin = (input: unknown): Effect.Effect<TrustedOrigin, BoundaryParseError> =>
  decodeString("origin", input).pipe(
    Effect.flatMap((value) => {
      try {
        const url = new URL(value);
        const isOrigin =
          url.origin === value && url.pathname === "/" && url.search === "" && url.hash === "";
        return isOrigin && (url.protocol === "https:" || url.protocol === "http:")
          ? Effect.succeed(Schema.decodeSync(TrustedOrigin)(url.origin))
          : Effect.fail(
              new BoundaryParseError({
                field: "origin",
                reason: "Expected URL origin",
              }),
            );
      } catch {
        return Effect.fail(
          new BoundaryParseError({
            field: "origin",
            reason: "Invalid URL origin",
          }),
        );
      }
    }),
  );

export const AuthBoundaryLive: AuthBoundaryShape = {
  parseCallbackUrl,
  parseEmail,
  parsePassword,
  parseTrustedOrigin,
};

export const AuthBoundaryLiveLayer = Layer.succeed(AuthBoundary, AuthBoundary.of(AuthBoundaryLive));

export const invalidCredentials = new PublicAuthError({
  code: "InvalidCredentials",
  message: "Invalid email or password",
});

export const emailNotVerified = new PublicAuthError({
  code: "EmailNotVerified",
  message: "Email is not verified",
});

export const invalidToken = new PublicAuthError({
  code: "InvalidToken",
  message: "Invalid or expired token",
});

export const unauthorized = new PublicAuthError({
  code: "Unauthorized",
  message: "Authentication is required",
});
