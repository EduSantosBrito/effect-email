# effect-email

Effect-first email SDK with provider-neutral core APIs, trusted-runtime Resend support, and an inspectable Test adapter.

## Install

```sh
bun install
```

## Scripts

```sh
bun run build
bun run check
bun run test
```

## Minimal Resend Send

```ts
import { Effect } from "effect";
import { Email, EmailMessage } from "effect-email";
import * as Resend from "effect-email/resend";

const program = Effect.gen(function* () {
  const email = yield* Email;
  const message = yield* EmailMessage.make({
    from: "Acme <onboarding@example.com>",
    to: "user@example.com",
    subject: "Hello",
    text: "World",
  });

  return yield* email.send(message);
});

await Effect.runPromise(program.pipe(Effect.provide(Resend.defaultLayer)));
```

`effect-email/resend` is trusted-runtime only. Do not import provider-backed adapters into browser code or other runtimes where provider secrets can be exposed.

## Custom Policy

```ts
import { Effect, Layer } from "effect";
import { Email, EmailMessage, SendPolicy } from "effect-email";
import * as Resend from "effect-email/resend";
import { FetchHttpClient } from "effect/unstable/http";

const EmailLive = Resend.layer.pipe(
  Layer.provide(Resend.clientLayer),
  Layer.provide(
    Layer.succeed(
      SendPolicy,
      SendPolicy.layer({
        ...Resend.policyConfig,
        maxRecipients: 10,
      }),
    ),
  ),
  Layer.provide(FetchHttpClient.layer),
);

const program = Effect.gen(function* () {
  const email = yield* Email;
  const message = yield* EmailMessage.make({
    from: "Acme <onboarding@example.com>",
    to: "user@example.com",
    subject: "Hello",
    text: "World",
  });

  return yield* email.send(message);
});

await Effect.runPromise(program.pipe(Effect.provide(EmailLive)));
```

## Test Adapter

```ts
import { Effect } from "effect";
import { Email, EmailMessage } from "effect-email";
import * as TestEmail from "effect-email/test";

const assertEmail = Effect.gen(function* () {
  const email = yield* Email;
  const message = yield* EmailMessage.make({
    from: "Acme <onboarding@example.com>",
    to: "user@example.com",
    subject: "Hello",
    text: "World",
  });

  yield* email.send(message);

  const inspection = yield* TestEmail.TestEmailInspection;
  const sent = yield* inspection.takeSent;
  return sent.length;
}).pipe(Effect.provide(TestEmail.defaultLayer));
```
