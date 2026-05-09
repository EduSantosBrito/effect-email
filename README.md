# effect-email

Effect-native authentication services and HTTP adapter, built with Bun.

Uses `effect@beta`.

## Install

```sh
bun install
```

## Scripts

```sh
bun run build
bun run check
bun test
```

## Usage

```ts
import { Effect, Layer } from "effect";
import { AuthBoundaryLiveLayer } from "effect-email/domain";
import { MockAuthEmailLayer } from "effect-email/email/mock";
import { AuthApi, AuthApiLive, UnsafeAllowAllTrustedOriginPolicyLayer } from "effect-email/http";
import { NativeScryptPasswordHasher, SecureDefaultPasswordPolicy } from "effect-email/password";
import { UnsafePermissiveRateLimiterLayer } from "effect-email/rate-limit";
import { DevMemoryAuthStorageLayer } from "effect-email/storage/dev-memory";
import { AuthTokenLive } from "effect-email/token";
import {
  EmailPasswordWorkflows,
  makeEmailPasswordWorkflows,
} from "effect-email/workflows";

const CoreAuthLive = Layer.mergeAll(
  AuthBoundaryLiveLayer,
  DevMemoryAuthStorageLayer,
  MockAuthEmailLayer,
  UnsafePermissiveRateLimiterLayer,
  Layer.succeed(EmailPasswordWorkflows, EmailPasswordWorkflows.of(makeEmailPasswordWorkflows)),
);
```

Use `AuthApi` for schema-first clients and `AuthApiLive` when wiring the HTTP
adapter into an Effect HTTP server. `DevMemoryAuthStorageLayer`,
`MockAuthEmailLayer`, `UnsafePermissiveRateLimiterLayer`, and
`UnsafeAllowAllTrustedOriginPolicyLayer` are non-production development helpers.
