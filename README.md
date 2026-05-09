# effect-email

TypeScript SDK scaffold for `effect-email`, built with Bun.

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
import { createEffectEmailClient, emailAddress } from "effect-email";
import { Effect } from "effect";

const client = createEffectEmailClient();

await Effect.runPromise(
  client.send({
    from: emailAddress("hello@example.com"),
    to: [emailAddress("you@example.com")],
    subject: "Hello",
    text: "World",
  }),
);
```
