import { Clock, Context, Effect, Layer } from "effect";
import {
  AuthBoundary,
  type BoundaryParseError,
  emailNotVerified,
  type NormalizedEmail,
  type PasswordText,
  type PublicAuthError,
  type SessionToken,
  unauthorized,
} from "./domain";
import { AuthEmail, type AuthEmailFailure } from "./email";
import {
  PasswordHasher,
  type PasswordHashFailure,
  PasswordPolicy,
  type PasswordPolicyFailure,
} from "./password";
import { RateLimiter, type RateLimitAttempt, type RateLimitExceeded } from "./rate-limit";
import {
  AuthStorage,
  type AuthStorageFailure,
  type AuthUser,
  type EmailPasswordCredentialLookup,
  type StoredSession,
} from "./storage";
import { AuthToken, type TokenGenerationFailure } from "./token";

export interface SignUpInput {
  readonly email: unknown;
  readonly password: unknown;
  readonly callbackUrl: URL;
  readonly ip?: string;
}

export interface SignUpResult {
  readonly user: AuthUser;
}

export interface VerifyEmailInput {
  readonly token: import("./domain").VerificationToken;
  readonly now?: number;
}

export interface VerifyEmailResult {
  readonly verified: true;
}

export interface ResendVerificationInput {
  readonly email: NormalizedEmail;
  readonly callbackUrl: URL;
  readonly ip?: string;
}

export interface SignInInput {
  readonly email: NormalizedEmail;
  readonly password: PasswordText;
  readonly ip?: string;
}

export interface SignInResult {
  readonly user: AuthUser;
  readonly sessionToken: SessionToken;
}

export type TokenRotationDecision =
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Rotated"; readonly token: SessionToken };

export interface SessionLookupResult {
  readonly session: StoredSession;
  readonly tokenRotation: TokenRotationDecision;
}

export interface CurrentSessionInput {
  readonly token: SessionToken;
  readonly now?: number;
}

export interface SignOutInput {
  readonly token: SessionToken;
  readonly now?: number;
}

export interface EmailPasswordWorkflowsShape {
  readonly signUp: (
    input: SignUpInput,
  ) => Effect.Effect<
    SignUpResult,
    | PublicAuthError
    | BoundaryParseError
    | PasswordPolicyFailure
    | PasswordHashFailure
    | AuthStorageFailure
    | TokenGenerationFailure
    | AuthEmailFailure
    | RateLimitExceeded
  >;
  readonly verifyEmail: (
    input: VerifyEmailInput,
  ) => Effect.Effect<
    VerifyEmailResult,
    PublicAuthError | AuthStorageFailure | TokenGenerationFailure
  >;
  readonly resendVerification: (
    input: ResendVerificationInput,
  ) => Effect.Effect<
    void,
    | PublicAuthError
    | AuthStorageFailure
    | TokenGenerationFailure
    | AuthEmailFailure
    | RateLimitExceeded
  >;
  readonly signIn: (
    input: SignInInput,
  ) => Effect.Effect<
    SignInResult,
    | PublicAuthError
    | PasswordHashFailure
    | AuthStorageFailure
    | TokenGenerationFailure
    | RateLimitExceeded
  >;
}

export class EmailPasswordWorkflows extends Context.Service<
  EmailPasswordWorkflows,
  EmailPasswordWorkflowsShape
>()("effect-auth/workflows/EmailPasswordWorkflows") {}

export interface SessionWorkflowsShape {
  readonly currentSession: (
    input: CurrentSessionInput,
  ) => Effect.Effect<
    SessionLookupResult,
    PublicAuthError | AuthStorageFailure | TokenGenerationFailure
  >;
  readonly signOut: (
    input: SignOutInput,
  ) => Effect.Effect<void, PublicAuthError | AuthStorageFailure>;
}

export class SessionWorkflows extends Context.Service<SessionWorkflows, SessionWorkflowsShape>()(
  "effect-auth/workflows/SessionWorkflows",
) {}

export interface EmailPasswordWorkflowDeps {
  readonly boundary: import("./domain").AuthBoundaryShape;
  readonly passwordPolicy: import("./password").PasswordPolicyShape;
  readonly passwordHasher: import("./password").PasswordHasherShape;
  readonly authToken: import("./token").AuthTokenShape;
  readonly storage: import("./storage").AuthStorageShape;
  readonly authEmail: import("./email").AuthEmailShape;
  readonly rateLimiter: import("./rate-limit").RateLimiterShape;
}

export interface EmailPasswordWorkflowConfig {
  readonly verificationTokenTtlMillis: number;
  readonly sessionTtlMillis: number;
  readonly sessionUpdateAgeMillis: number;
}

export const DefaultEmailPasswordWorkflowConfig: EmailPasswordWorkflowConfig = {
  sessionTtlMillis: 7 * 24 * 60 * 60 * 1_000,
  sessionUpdateAgeMillis: 24 * 60 * 60 * 1_000,
  verificationTokenTtlMillis: 24 * 60 * 60 * 1_000,
};

const rateLimitAttempt = (
  bucket: RateLimitAttempt["bucket"],
  email: NormalizedEmail,
  ip: string | undefined,
): RateLimitAttempt => (ip === undefined ? { bucket, email } : { bucket, email, ip });

export const makeEmailPasswordWorkflows = (
  deps: EmailPasswordWorkflowDeps,
  config: EmailPasswordWorkflowConfig = DefaultEmailPasswordWorkflowConfig,
): EmailPasswordWorkflowsShape => ({
  signUp: (input) =>
    Effect.gen(function* () {
      const email = yield* deps.boundary.parseEmail(input.email);
      const password = yield* deps.boundary.parsePassword(input.password);
      yield* deps.rateLimiter.check(rateLimitAttempt("SignUp", email, input.ip));
      yield* deps.passwordPolicy.validate({ email, password });
      const passwordHash = yield* deps.passwordHasher.hash(password);
      const user = yield* deps.storage.createUserWithEmailPasswordCredential({
        email,
        passwordHash,
      });
      const issued = yield* deps.authToken.makeVerificationToken;
      const now = yield* Clock.currentTimeMillis;
      yield* deps.storage.storeVerificationToken({
        email,
        expiresAt: now + config.verificationTokenTtlMillis,
        hash: issued.hash,
        purpose: "EmailVerification",
        userId: user.id,
      });
      yield* deps.authEmail.sendEmailVerification({
        callbackUrl: input.callbackUrl,
        to: email,
        token: issued.token,
      });
      return { user };
    }),
  verifyEmail: (input) =>
    Effect.gen(function* () {
      const now = input.now ?? (yield* Clock.currentTimeMillis);
      const hash = yield* deps.authToken.hashToken(input.token);
      yield* deps.storage.consumeVerificationToken({ hash, now });
      const result: VerifyEmailResult = { verified: true };
      return result;
    }),
  resendVerification: (input) =>
    Effect.gen(function* () {
      yield* deps.rateLimiter.check(rateLimitAttempt("ResendVerification", input.email, input.ip));
      const lookup = yield* deps.storage.findCredentialByEmail(input.email);
      const issued = yield* deps.authToken.makeVerificationToken;
      const now = yield* Clock.currentTimeMillis;
      yield* deps.storage.storeVerificationToken({
        email: input.email,
        expiresAt: now + config.verificationTokenTtlMillis,
        hash: issued.hash,
        purpose: "EmailVerification",
        userId: lookup.user.id,
      });
      yield* deps.authEmail.sendEmailVerification({
        callbackUrl: input.callbackUrl,
        to: input.email,
        token: issued.token,
      });
    }),
  signIn: (input) =>
    Effect.gen(function* () {
      yield* deps.rateLimiter.check(rateLimitAttempt("SignIn", input.email, input.ip));
      const lookup = yield* deps.storage
        .findCredentialByEmail(input.email)
        .pipe(
          Effect.catchTag(
            "AuthStorageFailure",
            (
              error,
            ): Effect.Effect<
              EmailPasswordCredentialLookup,
              PublicAuthError | PasswordHashFailure | AuthStorageFailure
            > =>
              error.reason === "NotFound"
                ? deps.passwordHasher
                    .hash(input.password)
                    .pipe(Effect.flatMap(() => Effect.fail(unauthorized)))
                : Effect.fail(error),
          ),
        );
      const verified = yield* deps.passwordHasher.verify({
        hash: lookup.credential.passwordHash,
        password: input.password,
      });
      if (!verified) {
        return yield* unauthorized;
      }
      if (!lookup.credential.emailVerified) {
        return yield* emailNotVerified;
      }
      const issued = yield* deps.authToken.makeSessionToken;
      const now = yield* Clock.currentTimeMillis;
      yield* deps.storage.createSession({
        expiresAt: now + config.sessionTtlMillis,
        tokenHash: issued.hash,
        userId: lookup.user.id,
      });
      return {
        sessionToken: issued.token,
        user: lookup.user,
      };
    }),
});

export const EmailPasswordWorkflowsLayer = Layer.effect(
  EmailPasswordWorkflows,
  Effect.gen(function* () {
    const boundary = yield* AuthBoundary;
    const passwordPolicy = yield* PasswordPolicy;
    const passwordHasher = yield* PasswordHasher;
    const authToken = yield* AuthToken;
    const storage = yield* AuthStorage;
    const authEmail = yield* AuthEmail;
    const rateLimiter = yield* RateLimiter;
    return EmailPasswordWorkflows.of(
      makeEmailPasswordWorkflows({
        authEmail,
        authToken,
        boundary,
        passwordHasher,
        passwordPolicy,
        rateLimiter,
        storage,
      }),
    );
  }),
);

export interface SessionWorkflowDeps {
  readonly authToken: import("./token").AuthTokenShape;
  readonly storage: import("./storage").AuthStorageShape;
}

export const makeSessionWorkflows = (
  deps: SessionWorkflowDeps,
  config: Pick<
    EmailPasswordWorkflowConfig,
    "sessionTtlMillis" | "sessionUpdateAgeMillis"
  > = DefaultEmailPasswordWorkflowConfig,
): SessionWorkflowsShape => ({
  currentSession: (input) =>
    Effect.gen(function* () {
      const now = input.now ?? (yield* Clock.currentTimeMillis);
      const hash = yield* deps.authToken.hashToken(input.token);
      const lookup = yield* deps.storage
        .findSessionByTokenHash(hash, now)
        .pipe(
          Effect.catchTag(
            "AuthStorageFailure",
            (
              error,
            ): Effect.Effect<
              import("./storage").StoredSessionLookup,
              PublicAuthError | AuthStorageFailure
            > =>
              error.reason === "NotFound" || error.reason === "SessionExpired"
                ? Effect.fail(unauthorized)
                : Effect.fail(error),
          ),
        );
      const refreshDueAt =
        lookup.session.expiresAt - config.sessionTtlMillis + config.sessionUpdateAgeMillis;
      if (now < refreshDueAt) {
        const tokenRotation: TokenRotationDecision = { _tag: "Unchanged" };
        return { session: lookup.session, tokenRotation };
      }

      const issued = yield* deps.authToken.makeSessionToken;
      const rotated = yield* deps.storage.rotateSessionToken({
        expiresAt: now + config.sessionTtlMillis,
        nextHash: issued.hash,
        now,
        previousHash: hash,
      });
      const tokenRotation: TokenRotationDecision = {
        _tag: "Rotated",
        token: issued.token,
      };
      return { session: rotated, tokenRotation };
    }),
  signOut: (input) =>
    Effect.gen(function* () {
      const now = input.now ?? (yield* Clock.currentTimeMillis);
      const hash = yield* deps.authToken
        .hashToken(input.token)
        .pipe(Effect.mapError(() => unauthorized));
      yield* deps.storage
        .revokeSession({ now, tokenHash: hash })
        .pipe(
          Effect.catchTag(
            "AuthStorageFailure",
            (error): Effect.Effect<void, PublicAuthError | AuthStorageFailure> =>
              error.reason === "NotFound" ? Effect.fail(unauthorized) : Effect.fail(error),
          ),
        );
    }),
});

export const SessionWorkflowsLayer = Layer.effect(
  SessionWorkflows,
  Effect.gen(function* () {
    const authToken = yield* AuthToken;
    const storage = yield* AuthStorage;
    return SessionWorkflows.of(makeSessionWorkflows({ authToken, storage }));
  }),
);
