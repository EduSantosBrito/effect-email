# effect-email

Effect-first email SDK with provider-neutral core APIs, trusted-runtime Resend support, and an inspectable test adapter.

## Install

For an application consuming the package:

```sh
bun add effect-email effect
```

For this repository:

```sh
bun install
```

## Examples

- [Resend example](https://github.com/EduSantosBrito/effect-email/tree/main/examples/resend)
- Test adapter example below

## Setup

Create a Resend API key and expose it as `RESEND_API_KEY` in the trusted runtime that sends email.

```sh
RESEND_API_KEY=re_xxxx
```

`effect-email/resend` reads `RESEND_API_KEY` through Effect Config. Keep this adapter out of browser bundles and any runtime where provider secrets can be exposed.

> [!NOTE]
> To send from your own domain, verify that domain in Resend first.

## Usage

Send your first email:

```ts
import { Effect } from "effect";
import { Email, EmailMessage } from "effect-email";
import * as Resend from "effect-email/resend";

const program = Effect.gen(function* () {
  const email = yield* Email;
  const message = yield* EmailMessage.make({
    from: "Acme <onboarding@example.com>",
    to: "user@example.com",
    subject: "Hello from effect-email",
    text: "Sent with Effect.",
  });

  const receipt = yield* email.send(message);

  yield* Effect.logInfo(`sent ${receipt.provider}:${receipt.messageId}`);
});

await Effect.runPromise(program.pipe(Effect.provide(Resend.defaultLayer)));
```

## Send HTML

Pass `html` for HTML-only email, or pass both `text` and `html` for a multipart body.

```ts
const program = Effect.gen(function* () {
  const email = yield* Email;
  const message = yield* EmailMessage.make({
    from: "Acme <onboarding@example.com>",
    to: "user@example.com",
    subject: "Welcome",
    text: "Welcome to Acme.",
    html: "<strong>Welcome to Acme.</strong>",
  });

  yield* email.send(message);
});
```

## Send Attachments

Attachments are provider-neutral: pass a filename, media type, and bytes. The Resend adapter encodes them for the Resend API.

```ts
const program = Effect.gen(function* () {
  const email = yield* Email;
  const message = yield* EmailMessage.make({
    from: "Acme <onboarding@example.com>",
    to: "user@example.com",
    subject: "Invoice",
    text: "Your invoice is attached.",
    attachments: [
      {
        name: "invoice.txt",
        mediaType: "text/plain",
        content: new TextEncoder().encode("invoice #123"),
      },
    ],
  });

  yield* email.send(message);
});
```

## Send Headers

Email Headers are provider-neutral custom fields on the message. Use a record for common cases:

```ts
const message = yield* EmailMessage.make({
  from: "Acme <onboarding@example.com>",
  to: "user@example.com",
  subject: "Hello",
  text: "Plain",
  headers: { "X-Campaign-ID": "spring-2026" },
});
```

Use an ordered list when order, casing, or spacing matters. Header names are trimmed and casing is preserved. Header values are preserved exactly, except blank, multiline, and control-character values are rejected.

```ts
const message = yield* EmailMessage.make({
  from: "Acme <onboarding@example.com>",
  to: "user@example.com",
  subject: "Hello",
  text: "Plain",
  headers: [{ name: " X-Trace-ID ", value: "  keep spacing  " }],
});
```

Email Headers are not raw MIME escape hatches. Structured fields such as `From`, `To`, `Reply-To`, and `Subject`; MIME, authentication, and delivery fields such as `Content-Type`, `Message-ID`, `DKIM-Signature`, and `Received`; duplicate names; and provider-reserved `Resend-*` / `X-Resend-*` names are rejected before send.

Every adapter also enforces local header limits through `SendPolicy`: 20 headers, 128 bytes per header name, 998 bytes per header value, and 8000 total header bytes by default. The Resend adapter maps accepted headers to Resend's `headers` object and omits it when no headers are present.

## Test Adapter

Use `effect-email/test` when application code should send email but tests need inspection instead of network I/O.

```ts
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Email, EmailMessage } from "effect-email";
import * as TestEmail from "effect-email/test";

describe("email", () => {
  it.effect("records sent messages", () =>
    Effect.gen(function* () {
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

      assert.strictEqual(sent.length, 1);
    }).pipe(Effect.provide(TestEmail.defaultLayer)),
  );
});
```

## Custom Policy

Every adapter validates messages through `SendPolicy`. Override limits by providing your own policy layer.

```ts
import { Layer } from "effect";
import { SendPolicy } from "effect-email";
import * as Resend from "effect-email/resend";
import { FetchHttpClient } from "effect/unstable/http";

const EmailLive = Resend.layer.pipe(
  Layer.provide(Resend.clientLayer),
  Layer.provide(
    Layer.succeed(SendPolicy)(
      SendPolicy.layer({
        ...Resend.policyConfig,
        maxRecipients: 10,
      }),
    ),
  ),
  Layer.provide(FetchHttpClient.layer),
);
```

## Development

```sh
bun run build
bun run check
bun run test
```

## Contributing

Issues and PRs are welcome.

For non-trivial features, new providers, or API changes, please open an issue first. PRs that do not fit the project direction, maintenance budget, or current scope may be closed even if the implementation is correct.

Small bug fixes, docs fixes, examples, tests, and clearly scoped improvements are the easiest to review and merge. See [CONTRIBUTING.md](https://github.com/EduSantosBrito/effect-email/blob/main/CONTRIBUTING.md).

## Security

Please do not open public issues for suspected vulnerabilities. Report them privately through GitHub security advisories for this repository. See [SECURITY.md](https://github.com/EduSantosBrito/effect-email/blob/main/SECURITY.md).
