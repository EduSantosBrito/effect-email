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

## Usage

```ts
import { ConfigProvider, Effect, Layer } from "effect";
import { Email, MailboxParser, MessageContentParser, parserLayer } from "effect-email";
import { defaultLayer as ResendLayer } from "effect-email/resend";

const program = Effect.gen(function* () {
  const mailbox = yield* MailboxParser;
  const content = yield* MessageContentParser;
  const email = yield* Email;

  const from = yield* mailbox.mailbox({ address: "sender@example.com", displayName: "Sender" });
  const recipients = yield* mailbox.recipients({ to: [{ address: "you@example.com" }] });
  const subject = yield* content.subject("Hello");
  const body = yield* content.body({ text: "World" });

  return yield* email.send({ from, ...recipients, subject, body });
}).pipe(
  Effect.provide(parserLayer),
  Effect.provide(
    ResendLayer.pipe(
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { RESEND_API_KEY: "re_..." } })),
      ),
    ),
  ),
);
```

`effect-email/resend` is trusted-runtime only. Do not import provider-backed adapters into browser code or other runtimes where provider secrets can be exposed.

## Test Adapter

```ts
import { Effect } from "effect";
import { Email } from "effect-email";
import { TestEmailInspection, layer as TestEmailLayer } from "effect-email/test";

const assertEmail = Effect.gen(function* () {
  const email = yield* Email;
  const inspection = yield* TestEmailInspection;

  yield* email.send(message);

  const sent = yield* inspection.takeSent;
  return sent.length;
}).pipe(Effect.provide(TestEmailLayer));
```
