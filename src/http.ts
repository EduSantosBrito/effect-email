import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpEffect, HttpServerResponse } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  HttpApiSecurity,
} from "effect/unstable/httpapi";
import {
  AuthBoundary,
  PublicAuthError,
  SessionToken,
  type TrustedOrigin,
  VerificationToken,
  invalidCredentials,
  invalidToken,
  unauthorized,
} from "./domain";
import { EmailPasswordWorkflows, SessionWorkflows } from "./workflows";

export const AuthSessionCookieName = "effect_auth_session";

export const AuthSessionCookieSecurity = HttpApiSecurity.apiKey({
  in: "cookie",
  key: AuthSessionCookieName,
});

export interface AuthHttpCookieOptions {
  readonly secure: boolean;
}

export interface AuthHttpCookie {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly secure: boolean;
  readonly maxAge?: number;
}

export const makeSessionCookie = (
  token: SessionToken,
  options: AuthHttpCookieOptions,
): AuthHttpCookie => ({
  httpOnly: true,
  name: AuthSessionCookieName,
  path: "/",
  sameSite: "lax",
  secure: options.secure,
  value: Redacted.value(token),
});

export const makeExpiredSessionCookie = (options: AuthHttpCookieOptions): AuthHttpCookie => ({
  httpOnly: true,
  maxAge: 0,
  name: AuthSessionCookieName,
  path: "/",
  sameSite: "lax",
  secure: options.secure,
  value: "",
});

export interface TrustedOriginPolicyShape {
  readonly allows: (origin: TrustedOrigin) => Effect.Effect<boolean>;
}

export class TrustedOriginPolicy extends Context.Service<
  TrustedOriginPolicy,
  TrustedOriginPolicyShape
>()("effect-auth/http/TrustedOriginPolicy") {}

export const makeTrustedOriginPolicy = (
  origins: ReadonlySet<TrustedOrigin>,
): TrustedOriginPolicyShape => ({
  allows: (origin) => Effect.succeed(origins.has(origin)),
});

export const UnsafeAllowAllTrustedOriginPolicy: TrustedOriginPolicyShape = {
  allows: () => Effect.succeed(true),
};

export const UnsafeAllowAllTrustedOriginPolicyLayer = Layer.succeed(
  TrustedOriginPolicy,
  TrustedOriginPolicy.of(UnsafeAllowAllTrustedOriginPolicy),
);

export class AuthHttpError extends Schema.TaggedErrorClass<AuthHttpError>()("AuthHttpError", {
  code: Schema.Literals([
    "InvalidCredentials",
    "EmailNotVerified",
    "InvalidToken",
    "RateLimited",
    "Unauthorized",
  ]),
  message: Schema.String,
}) {}

export const SignUpEmailPayload = Schema.Struct({
  callbackUrl: Schema.String,
  email: Schema.String,
  password: Schema.String,
});

export const VerifyEmailPayload = Schema.Struct({
  token: Schema.String,
});

export const ResendVerificationPayload = Schema.Struct({
  callbackUrl: Schema.String,
  email: Schema.String,
});

export const SignInEmailPayload = Schema.Struct({
  email: Schema.String,
  password: Schema.String,
});

export const EmptySuccess = Schema.Struct({
  ok: Schema.Boolean,
});

export const UserSuccess = Schema.Struct({
  id: Schema.String,
});

export const SignInSuccess = Schema.Struct({
  user: UserSuccess,
});

export const CurrentSessionSuccess = Schema.Struct({
  rotated: Schema.Boolean,
  session: Schema.Struct({
    expiresAt: Schema.Number,
    id: Schema.String,
    userId: Schema.String,
  }),
});

const authHttpError = (error: PublicAuthError): AuthHttpError =>
  new AuthHttpError({ code: error.code, message: error.message });

const hasTag = (value: unknown, tag: string): boolean =>
  typeof value === "object" && value !== null && "_tag" in value && value._tag === tag;

const mapHttpError = (error: unknown) => {
  if (Schema.is(PublicAuthError)(error)) {
    return authHttpError(error);
  }
  if (hasTag(error, "BoundaryParseError")) {
    return authHttpError(invalidCredentials);
  }
  if (hasTag(error, "RateLimitExceeded")) {
    return new AuthHttpError({
      code: "RateLimited",
      message: "Too many attempts",
    });
  }
  return authHttpError(invalidToken);
};

const authErrorResponse = AuthHttpError.pipe(
  HttpApiSchema.status("BadRequest"),
  HttpApiSchema.asJson(),
);

const emptySuccess = { ok: true };

export const AuthApiGroup = HttpApiGroup.make("auth", { topLevel: true }).add(
  HttpApiEndpoint.post("signUpEmail", "/auth/sign-up/email", {
    error: authErrorResponse,
    payload: SignUpEmailPayload,
    success: EmptySuccess,
  }),
  HttpApiEndpoint.post("verifyEmail", "/auth/verify-email", {
    error: authErrorResponse,
    payload: VerifyEmailPayload,
    success: EmptySuccess,
  }),
  HttpApiEndpoint.post("resendVerification", "/auth/resend-verification", {
    error: authErrorResponse,
    payload: ResendVerificationPayload,
    success: EmptySuccess,
  }),
  HttpApiEndpoint.post("signInEmail", "/auth/sign-in/email", {
    error: authErrorResponse,
    payload: SignInEmailPayload,
    success: SignInSuccess,
  }),
  HttpApiEndpoint.get("currentSession", "/auth/session", {
    error: authErrorResponse,
    success: CurrentSessionSuccess,
  }),
  HttpApiEndpoint.post("signOut", "/auth/sign-out", {
    error: authErrorResponse,
    success: EmptySuccess,
  }),
);

export const AuthApi = HttpApi.make("auth").add(AuthApiGroup);

const header = (headers: Readonly<Record<string, string | undefined>>, name: string) =>
  Option.fromUndefinedOr(headers[name]);

const requestOrigin = (headers: Readonly<Record<string, string | undefined>>) =>
  header(headers, "origin").pipe(Option.orElse(() => header(headers, "referer")));

const parseCallbackUrl = (value: string) => Effect.try({ try: () => new URL(value), catch: () => invalidCredentials });

const requireTrustedOrigin = (origin: Option.Option<string>) =>
  Effect.gen(function* () {
    const boundary = yield* AuthBoundary;
    const policy = yield* TrustedOriginPolicy;
    const rawOrigin = yield* Effect.fromOption(origin).pipe(Effect.mapError(() => unauthorized));
    const trustedOrigin = yield* boundary.parseTrustedOrigin(rawOrigin).pipe(Effect.mapError(() => unauthorized));
    const allowed = yield* policy.allows(trustedOrigin);
    if (!allowed) {
      return yield* unauthorized;
    }
  });

const sessionCookieFromRequest = (cookies: Readonly<Record<string, string | undefined>>) =>
  Option.fromUndefinedOr(cookies[AuthSessionCookieName]).pipe(
    Effect.fromOption,
    Effect.mapError(() => unauthorized),
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(SessionToken)(value).pipe(Effect.mapError(() => unauthorized))
    ),
  );

const setSessionCookie = (token: SessionToken) =>
  HttpApiBuilder.securitySetCookie(AuthSessionCookieSecurity, Redacted.value(token), {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
  });

const clearSessionCookie = HttpEffect.appendPreResponseHandler((_request, response) =>
  HttpServerResponse.expireCookie(response, AuthSessionCookieName, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: true,
  }).pipe(Effect.orDie),
);

export const AuthApiLive = HttpApiBuilder.group(AuthApi, "auth", (handlers) =>
  Effect.gen(function* () {
    const boundary = yield* AuthBoundary;
    const emailPassword = yield* EmailPasswordWorkflows;
    const sessions = yield* SessionWorkflows;

    return handlers
      .handle("signUpEmail", (ctx) =>
        Effect.gen(function* () {
          yield* requireTrustedOrigin(requestOrigin(ctx.request.headers));
          const callbackUrl = yield* parseCallbackUrl(ctx.payload.callbackUrl);
          yield* emailPassword.signUp({
            callbackUrl,
            email: ctx.payload.email,
            password: ctx.payload.password,
          });
          return emptySuccess;
        }).pipe(Effect.mapError(mapHttpError)),
      )
      .handle("verifyEmail", (ctx) =>
        Effect.gen(function* () {
          yield* requireTrustedOrigin(requestOrigin(ctx.request.headers));
          const token = yield* Schema.decodeUnknownEffect(VerificationToken)(ctx.payload.token).pipe(
            Effect.mapError(() => invalidToken),
          );
          yield* emailPassword.verifyEmail({ token });
          return emptySuccess;
        }).pipe(Effect.mapError(mapHttpError)),
      )
      .handle("resendVerification", (ctx) =>
        Effect.gen(function* () {
          yield* requireTrustedOrigin(requestOrigin(ctx.request.headers));
          const callbackUrl = yield* parseCallbackUrl(ctx.payload.callbackUrl);
          const email = yield* boundary.parseEmail(ctx.payload.email);
          yield* emailPassword.resendVerification({ callbackUrl, email });
          return emptySuccess;
        }).pipe(Effect.mapError(mapHttpError)),
      )
      .handle("signInEmail", (ctx) =>
        Effect.gen(function* () {
          yield* requireTrustedOrigin(requestOrigin(ctx.request.headers));
          const email = yield* boundary.parseEmail(ctx.payload.email);
          const password = yield* boundary.parsePassword(ctx.payload.password);
          const result = yield* emailPassword.signIn({ email, password });
          yield* setSessionCookie(result.sessionToken);
          return {
            user: {
              id: result.user.id,
            },
          };
        }).pipe(Effect.mapError(mapHttpError)),
      )
      .handle("currentSession", (ctx) =>
        Effect.gen(function* () {
          const token = yield* sessionCookieFromRequest(ctx.request.cookies);
          const result = yield* sessions.currentSession({ token });
          if (result.tokenRotation._tag === "Rotated") {
            yield* setSessionCookie(result.tokenRotation.token);
          }
          return {
            rotated: result.tokenRotation._tag === "Rotated",
            session: {
              expiresAt: result.session.expiresAt,
              id: result.session.id,
              userId: result.session.userId,
            },
          };
        }).pipe(Effect.mapError(mapHttpError)),
      )
      .handle("signOut", (ctx) =>
        Effect.gen(function* () {
          yield* requireTrustedOrigin(requestOrigin(ctx.request.headers));
          const token = yield* sessionCookieFromRequest(ctx.request.cookies);
          yield* sessions.signOut({ token });
          yield* clearSessionCookie;
          return emptySuccess;
        }).pipe(Effect.mapError(mapHttpError)),
      );
  }),
);
