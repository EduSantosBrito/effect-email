import { Context, Effect, Layer, Redacted, Schema } from "effect";
import { PasswordHash, type NormalizedEmail, type PasswordText } from "./domain";

export class PasswordPolicyFailure extends Schema.TaggedErrorClass<PasswordPolicyFailure>()(
  "PasswordPolicyFailure",
  {
    reason: Schema.Literals(["TooShort", "TooLong", "MatchesEmail", "MatchesEmailLocalPart"]),
  },
) {}

export class PasswordHashFailure extends Schema.TaggedErrorClass<PasswordHashFailure>()(
  "PasswordHashFailure",
  {
    reason: Schema.Literals(["UnsupportedRuntime", "MalformedHash", "HashingFailed"]),
  },
) {}

export interface PasswordPolicyShape {
  readonly validate: (input: {
    readonly email: NormalizedEmail;
    readonly password: PasswordText;
  }) => Effect.Effect<void, PasswordPolicyFailure>;
}

export interface PasswordHasherShape {
  readonly hash: (password: PasswordText) => Effect.Effect<PasswordHash, PasswordHashFailure>;
  readonly verify: (input: {
    readonly password: PasswordText;
    readonly hash: PasswordHash;
  }) => Effect.Effect<boolean, PasswordHashFailure>;
}

export class PasswordPolicy extends Context.Service<PasswordPolicy, PasswordPolicyShape>()(
  "effect-auth/password/PasswordPolicy",
) {}

export class PasswordHasher extends Context.Service<PasswordHasher, PasswordHasherShape>()(
  "effect-auth/password/PasswordHasher",
) {}

export const ScryptParams = {
  N: 16_384,
  dkLen: 64,
  maxmem: 64 * 1024 * 1024,
  p: 1,
  r: 16,
};

export const SecureDefaultPasswordPolicy: PasswordPolicyShape = {
  validate: ({ email, password }) => {
    const value = Redacted.value(password);
    const localPart = email.slice(0, email.indexOf("@"));

    if (value.length < 12) {
      return Effect.fail(new PasswordPolicyFailure({ reason: "TooShort" }));
    }
    if (value.length > 128) {
      return Effect.fail(new PasswordPolicyFailure({ reason: "TooLong" }));
    }
    if (value === email) {
      return Effect.fail(new PasswordPolicyFailure({ reason: "MatchesEmail" }));
    }
    if (value === localPart) {
      return Effect.fail(new PasswordPolicyFailure({ reason: "MatchesEmailLocalPart" }));
    }

    return Effect.void;
  },
};

export const SecureDefaultPasswordPolicyLayer = Layer.succeed(
  PasswordPolicy,
  PasswordPolicy.of(SecureDefaultPasswordPolicy),
);

interface ParsedPasswordHash {
  readonly algorithm: "scrypt";
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly dkLen: number;
  readonly salt: string;
  readonly derivedKey: string;
}

const malformedHash = new PasswordHashFailure({ reason: "MalformedHash" });
const hashingFailed = new PasswordHashFailure({ reason: "HashingFailed" });
const unsupportedRuntime = new PasswordHashFailure({ reason: "UnsupportedRuntime" });

const base64UrlEncode = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const randomSalt = Effect.sync(() => {
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  return base64UrlEncode(salt);
});

const parseHash = (hash: PasswordHash): Effect.Effect<ParsedPasswordHash, PasswordHashFailure> =>
  Effect.try({
    try: () => {
      const [empty, algorithm, paramsPart, salt, derivedKey] = Redacted.value(hash).split("$");
      if (
        empty !== "" ||
        algorithm !== "scrypt" ||
        paramsPart === undefined ||
        salt === undefined ||
        derivedKey === undefined
      ) {
        throw new Error("MalformedHash");
      }

      const params = Object.fromEntries(paramsPart.split(",").map((part) => part.split("=")));
      const N = Number(params["n"]);
      const r = Number(params["r"]);
      const p = Number(params["p"]);
      const dkLen = Number(params["dkLen"]);

      if (
        !Number.isSafeInteger(N) ||
        !Number.isSafeInteger(r) ||
        !Number.isSafeInteger(p) ||
        !Number.isSafeInteger(dkLen) ||
        salt.length === 0 ||
        derivedKey.length === 0
      ) {
        throw new Error("MalformedHash");
      }

      return {
        N,
        algorithm: "scrypt",
        derivedKey,
        dkLen,
        p,
        r,
        salt,
      };
    },
    catch: () => malformedHash,
  });

const deriveScrypt = (
  password: PasswordText,
  salt: string,
  params: typeof ScryptParams | ParsedPasswordHash,
): Effect.Effect<string, PasswordHashFailure> =>
  Effect.callback<string, PasswordHashFailure>((resume) => {
    import("node:crypto").then(
      (crypto) => {
        crypto.scrypt(
          Redacted.value(password),
          salt,
          params.dkLen,
          {
            N: params.N,
            maxmem: ScryptParams.maxmem,
            p: params.p,
            r: params.r,
          },
          (error, derivedKey) => {
            if (error != null) {
              resume(Effect.fail(hashingFailed));
              return;
            }
            resume(Effect.succeed(derivedKey.toString("base64url")));
          },
        );
      },
      () => {
        resume(Effect.fail(unsupportedRuntime));
      },
    );
  });

const formatHash = (salt: string, derivedKey: string): PasswordHash =>
  Schema.decodeSync(PasswordHash)(
    `$scrypt$n=${ScryptParams.N},r=${ScryptParams.r},p=${ScryptParams.p},dkLen=${ScryptParams.dkLen}$${salt}$${derivedKey}`,
  );

export const NativeScryptPasswordHasher: PasswordHasherShape = {
  hash: (password) =>
    Effect.gen(function* () {
      if (globalThis.crypto?.getRandomValues === undefined) {
        return yield* unsupportedRuntime;
      }

      const salt = yield* randomSalt;
      const derivedKey = yield* deriveScrypt(password, salt, ScryptParams);
      return formatHash(salt, derivedKey);
    }),
  verify: ({ hash, password }) =>
    Effect.gen(function* () {
      const parsed = yield* parseHash(hash);
      const derivedKey = yield* deriveScrypt(password, parsed.salt, parsed);
      return derivedKey === parsed.derivedKey;
    }),
};

export const NativeScryptPasswordHasherLayer = Layer.succeed(
  PasswordHasher,
  PasswordHasher.of(NativeScryptPasswordHasher),
);
