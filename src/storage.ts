import { Context, Effect, Layer, Redacted, Ref, Schema } from "effect";
import type { NormalizedEmail, PasswordHash, TokenHash } from "./domain";

export const AuthUserId = Schema.String.pipe(Schema.brand("AuthUserId"));
export type AuthUserId = typeof AuthUserId.Type;

export const AuthSessionId = Schema.String.pipe(Schema.brand("AuthSessionId"));
export type AuthSessionId = typeof AuthSessionId.Type;

export type VerificationTokenPurpose = "EmailVerification" | "PasswordReset";

export interface AuthUser {
  readonly id: AuthUserId;
}

export interface EmailPasswordCredential {
  readonly userId: AuthUserId;
  readonly email: NormalizedEmail;
  readonly passwordHash: PasswordHash;
  readonly emailVerified: boolean;
}

export interface StoredVerificationToken {
  readonly userId: AuthUserId;
  readonly email: NormalizedEmail;
  readonly hash: TokenHash;
  readonly purpose: VerificationTokenPurpose;
  readonly expiresAt: number;
  readonly consumedAt: number | undefined;
}

export interface StoredSession {
  readonly id: AuthSessionId;
  readonly userId: AuthUserId;
  readonly tokenHash: TokenHash;
  readonly expiresAt: number;
  readonly revokedAt: number | undefined;
}

export interface EmailPasswordCredentialLookup {
  readonly user: AuthUser;
  readonly credential: EmailPasswordCredential;
}

export interface StoredSessionLookup {
  readonly user: AuthUser;
  readonly session: StoredSession;
}

export type ConsumedVerificationToken = StoredVerificationToken;

export interface CreateUserWithCredential {
  readonly email: NormalizedEmail;
  readonly passwordHash: PasswordHash;
  readonly emailVerified?: boolean;
}

export interface StoreVerificationToken {
  readonly userId: AuthUserId;
  readonly email: NormalizedEmail;
  readonly hash: TokenHash;
  readonly purpose: VerificationTokenPurpose;
  readonly expiresAt: number;
}

export interface ConsumeVerificationToken {
  readonly hash: TokenHash;
  readonly now: number;
}

export interface CreateSession {
  readonly userId: AuthUserId;
  readonly tokenHash: TokenHash;
  readonly expiresAt: number;
}

export interface RotateSessionToken {
  readonly previousHash: TokenHash;
  readonly nextHash: TokenHash;
  readonly expiresAt: number;
  readonly now: number;
}

export interface RevokeSession {
  readonly tokenHash: TokenHash;
  readonly now: number;
}

export interface RevokeOtherSessions {
  readonly userId: AuthUserId;
  readonly currentSessionId: AuthSessionId;
  readonly now: number;
}

export interface RevokeAllUserSessions {
  readonly userId: AuthUserId;
  readonly now: number;
}

export interface UpdatePasswordHash {
  readonly userId: AuthUserId;
  readonly passwordHash: PasswordHash;
}

export class AuthStorageFailure extends Schema.TaggedErrorClass<AuthStorageFailure>()(
  "AuthStorageFailure",
  {
    reason: Schema.Literals([
      "Conflict",
      "NotFound",
      "TokenExpired",
      "TokenConsumed",
      "SessionExpired",
      "BackendUnavailable",
    ]),
  },
) {}

export interface AuthStorageShape {
  readonly createUserWithEmailPasswordCredential: (
    input: CreateUserWithCredential,
  ) => Effect.Effect<AuthUser, AuthStorageFailure>;
  readonly findCredentialByEmail: (
    email: NormalizedEmail,
  ) => Effect.Effect<EmailPasswordCredentialLookup, AuthStorageFailure>;
  readonly storeVerificationToken: (
    input: StoreVerificationToken,
  ) => Effect.Effect<void, AuthStorageFailure>;
  readonly consumeVerificationToken: (
    input: ConsumeVerificationToken,
  ) => Effect.Effect<ConsumedVerificationToken, AuthStorageFailure>;
  readonly createSession: (
    input: CreateSession,
  ) => Effect.Effect<StoredSession, AuthStorageFailure>;
  readonly findSessionByTokenHash: (
    hash: TokenHash,
    now: number,
  ) => Effect.Effect<StoredSessionLookup, AuthStorageFailure>;
  readonly rotateSessionToken: (
    input: RotateSessionToken,
  ) => Effect.Effect<StoredSession, AuthStorageFailure>;
  readonly revokeSession: (input: RevokeSession) => Effect.Effect<void, AuthStorageFailure>;
  readonly revokeOtherSessions: (
    input: RevokeOtherSessions,
  ) => Effect.Effect<void, AuthStorageFailure>;
  readonly revokeAllUserSessions: (
    input: RevokeAllUserSessions,
  ) => Effect.Effect<void, AuthStorageFailure>;
  readonly updatePasswordHash: (
    input: UpdatePasswordHash,
  ) => Effect.Effect<void, AuthStorageFailure>;
}

export class AuthStorage extends Context.Service<AuthStorage, AuthStorageShape>()(
  "effect-auth/storage/AuthStorage",
) {}

interface StorageState {
  readonly nextUserId: number;
  readonly nextSessionId: number;
  readonly users: ReadonlyMap<AuthUserId, AuthUser>;
  readonly credentialsByEmail: ReadonlyMap<NormalizedEmail, EmailPasswordCredential>;
  readonly tokensByHash: ReadonlyMap<string, StoredVerificationToken>;
  readonly sessionsById: ReadonlyMap<AuthSessionId, StoredSession>;
  readonly sessionIdByHash: ReadonlyMap<string, AuthSessionId>;
}

type StorageResult<A> =
  | { readonly _tag: "Ok"; readonly value: A }
  | { readonly _tag: "Err"; readonly error: AuthStorageFailure };

const ok = <A>(value: A): StorageResult<A> => ({ _tag: "Ok", value });
const err = (reason: AuthStorageFailure["reason"]): StorageResult<never> => ({
  _tag: "Err",
  error: new AuthStorageFailure({ reason }),
});

const intoEffect = <A>(result: StorageResult<A>): Effect.Effect<A, AuthStorageFailure> =>
  result._tag === "Ok" ? Effect.succeed(result.value) : Effect.fail(result.error);

type StateChange<A> = readonly [StorageResult<A>, StorageState];

const change = <A>(result: StorageResult<A>, state: StorageState): StateChange<A> => [
  result,
  state,
];

const emptyState: StorageState = {
  credentialsByEmail: new Map(),
  nextSessionId: 1,
  nextUserId: 1,
  sessionIdByHash: new Map(),
  sessionsById: new Map(),
  tokensByHash: new Map(),
  users: new Map(),
};

const hashKey = (hash: TokenHash): string => Redacted.value(hash);

const makeAuthUserId = (value: string): AuthUserId => Schema.decodeSync(AuthUserId)(value);

const makeAuthSessionId = (value: string): AuthSessionId => Schema.decodeSync(AuthSessionId)(value);

export const makeDevMemoryStorage = Effect.gen(function* () {
  const stateRef = yield* Ref.make<StorageState>(emptyState);

  const findUser = (state: StorageState, userId: AuthUserId) => state.users.get(userId);

  const service: AuthStorageShape = {
    createUserWithEmailPasswordCredential: (input) =>
      Ref.modify(stateRef, (state) => {
        if (state.credentialsByEmail.has(input.email)) {
          return change(err("Conflict"), state);
        }
        const user: AuthUser = { id: makeAuthUserId(`user_${state.nextUserId}`) };
        const credential: EmailPasswordCredential = {
          email: input.email,
          emailVerified: input.emailVerified ?? false,
          passwordHash: input.passwordHash,
          userId: user.id,
        };
        return change(ok(user), {
          ...state,
          credentialsByEmail: new Map(state.credentialsByEmail).set(input.email, credential),
          nextUserId: state.nextUserId + 1,
          users: new Map(state.users).set(user.id, user),
        });
      }).pipe(Effect.flatMap(intoEffect)),
    findCredentialByEmail: (email) =>
      Ref.get(stateRef).pipe(
        Effect.flatMap((state) => {
          const credential = state.credentialsByEmail.get(email);
          const user = credential === undefined ? undefined : findUser(state, credential.userId);
          return intoEffect(
            credential !== undefined && user !== undefined
              ? ok({ credential, user })
              : err("NotFound"),
          );
        }),
      ),
    storeVerificationToken: (input) =>
      Ref.update(stateRef, (state) => ({
        ...state,
        tokensByHash: new Map(state.tokensByHash).set(hashKey(input.hash), {
          ...input,
          consumedAt: undefined,
        }),
      })),
    consumeVerificationToken: (input) =>
      Ref.modify(stateRef, (state) => {
        const key = hashKey(input.hash);
        const token = state.tokensByHash.get(key);
        if (token === undefined) return change(err("NotFound"), state);
        if (token.consumedAt !== undefined) return change(err("TokenConsumed"), state);
        if (token.expiresAt <= input.now) return change(err("TokenExpired"), state);

        const consumed = { ...token, consumedAt: input.now };
        const nextCredentials = new Map(state.credentialsByEmail);
        if (token.purpose === "EmailVerification") {
          const credential = nextCredentials.get(token.email);
          if (credential !== undefined) {
            nextCredentials.set(token.email, { ...credential, emailVerified: true });
          }
        }
        return change(ok(consumed), {
          ...state,
          credentialsByEmail: nextCredentials,
          tokensByHash: new Map(state.tokensByHash).set(key, consumed),
        });
      }).pipe(Effect.flatMap(intoEffect)),
    createSession: (input) =>
      Ref.modify(stateRef, (state) => {
        if (!state.users.has(input.userId)) return change(err("NotFound"), state);
        const session: StoredSession = {
          expiresAt: input.expiresAt,
          id: makeAuthSessionId(`session_${state.nextSessionId}`),
          revokedAt: undefined,
          tokenHash: input.tokenHash,
          userId: input.userId,
        };
        return change(ok(session), {
          ...state,
          nextSessionId: state.nextSessionId + 1,
          sessionIdByHash: new Map(state.sessionIdByHash).set(
            hashKey(session.tokenHash),
            session.id,
          ),
          sessionsById: new Map(state.sessionsById).set(session.id, session),
        });
      }).pipe(Effect.flatMap(intoEffect)),
    findSessionByTokenHash: (hash, now) =>
      Ref.get(stateRef).pipe(
        Effect.flatMap((state) => {
          const sessionId = state.sessionIdByHash.get(hashKey(hash));
          const session = sessionId === undefined ? undefined : state.sessionsById.get(sessionId);
          const user = session === undefined ? undefined : findUser(state, session.userId);
          if (session === undefined || user === undefined || session.revokedAt !== undefined) {
            return intoEffect(err("NotFound"));
          }
          if (session.expiresAt <= now) return intoEffect(err("SessionExpired"));
          return intoEffect(ok({ session, user }));
        }),
      ),
    rotateSessionToken: (input) =>
      Ref.modify(stateRef, (state) => {
        const previousKey = hashKey(input.previousHash);
        const sessionId = state.sessionIdByHash.get(previousKey);
        const session = sessionId === undefined ? undefined : state.sessionsById.get(sessionId);
        if (session === undefined || session.revokedAt !== undefined)
          return change(err("NotFound"), state);
        if (session.expiresAt <= input.now) return change(err("SessionExpired"), state);

        const rotated = { ...session, expiresAt: input.expiresAt, tokenHash: input.nextHash };
        const nextHashIndex = new Map(state.sessionIdByHash);
        nextHashIndex.delete(previousKey);
        nextHashIndex.set(hashKey(input.nextHash), session.id);
        return change(ok(rotated), {
          ...state,
          sessionIdByHash: nextHashIndex,
          sessionsById: new Map(state.sessionsById).set(rotated.id, rotated),
        });
      }).pipe(Effect.flatMap(intoEffect)),
    revokeSession: (input) =>
      Ref.modify(stateRef, (state) => {
        const sessionId = state.sessionIdByHash.get(hashKey(input.tokenHash));
        const session = sessionId === undefined ? undefined : state.sessionsById.get(sessionId);
        if (session === undefined) return change(err("NotFound"), state);
        return change(ok(undefined), {
          ...state,
          sessionsById: new Map(state.sessionsById).set(session.id, {
            ...session,
            revokedAt: input.now,
          }),
        });
      }).pipe(Effect.flatMap(intoEffect)),
    revokeOtherSessions: (input) =>
      Ref.update(stateRef, (state) => ({
        ...state,
        sessionsById: new Map(
          [...state.sessionsById].map(([id, session]) => [
            id,
            session.userId === input.userId && session.id !== input.currentSessionId
              ? { ...session, revokedAt: input.now }
              : session,
          ]),
        ),
      })),
    revokeAllUserSessions: (input) =>
      Ref.update(stateRef, (state) => ({
        ...state,
        sessionsById: new Map(
          [...state.sessionsById].map(([id, session]) => [
            id,
            session.userId === input.userId ? { ...session, revokedAt: input.now } : session,
          ]),
        ),
      })),
    updatePasswordHash: (input) =>
      Ref.modify(stateRef, (state) => {
        const credential = [...state.credentialsByEmail.values()].find(
          (item) => item.userId === input.userId,
        );
        if (credential === undefined) return change(err("NotFound"), state);
        return change(ok(undefined), {
          ...state,
          credentialsByEmail: new Map(state.credentialsByEmail).set(credential.email, {
            ...credential,
            passwordHash: input.passwordHash,
          }),
        });
      }).pipe(Effect.flatMap(intoEffect)),
  };

  return service;
});

export const DevMemoryAuthStorageLayer = Layer.effect(AuthStorage, makeDevMemoryStorage);
