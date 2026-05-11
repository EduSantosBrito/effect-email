# Effect Email

Effect Email is a TypeScript SDK for sending email through Effect services and Layers while keeping transport-specific behavior behind adapters.

## Language

**Email Message**:
A provider-neutral typed request to send one email with sender, recipients, reply-to, subject, text or HTML content, and attachments.

**Mailbox**:
A structured email identity made from an email address and an optional display name.
Raw mailbox strings are accepted only at constructor boundaries such as `Mailbox.make` and `EmailMessage.make`; stored domain state is always structured.
_Avoid_: Raw mailbox string as stored domain state

**Email Address**:
A strict ASCII mailbox address used inside a **Mailbox**.
_Avoid_: Internationalized email address, quoted local part, comment syntax

**Display Name**:
Unicode-safe user-facing text attached to a **Mailbox**.
_Avoid_: Raw header text

**Email Service**:
The application-facing capability for sending an **Email Message**.
_Avoid_: Client

**Email Layer**:
An Effect Layer that provides the **Email Service** using a **Transport Adapter**.
_Avoid_: Client factory

**Transport Adapter**:
A provider-specific implementation of the **Email Service**.
_Avoid_: Provider layer, driver

**Resend Adapter**:
The MVP **Transport Adapter** that sends email through Resend over HTTP.

**Provider Secret**:
A redacted credential used by a **Transport Adapter** to authenticate with its provider.
_Avoid_: API key string

**Trusted Runtime**:
A server-side environment where **Provider Secrets** can be used without exposing them to end users.
_Avoid_: Browser provider adapter

**Provider-Specific Option**:
A transport-only setting that is not part of the provider-neutral **Email Message** contract.
_Avoid_: Core field

**Attachment**:
A named content part included with an **Email Message**.

**Attachment Content**:
Caller-supplied in-memory bytes for an **Attachment**.
_Avoid_: Attachment file path, attachment URL, base64 attachment string

**Media Type**:
A parsed MIME type that identifies **Attachment Content**.
_Avoid_: Content-type string

**Parsed Email Field**:
A security-sensitive email value that has been decoded and validated before an **Email Message** is sent.
_Avoid_: Raw string

**HTML Body**:
Caller-owned HTML content included in an **Email Message** without SDK sanitization.

**Test Adapter**:
A **Transport Adapter** used by tests to inspect requested email sends through Effect state without contacting an external provider.

**Send Receipt**:
Proof that a **Transport Adapter** accepted an **Email Message** for delivery.
_Avoid_: Delivery receipt

**Send Failure**:
A classified failure that prevented a **Transport Adapter** from accepting an **Email Message**.
_Avoid_: Raw provider error

**Duplicate Send**:
An unintended second acceptance of the same **Email Message** by a transport.

**Email PII**:
Message data that can identify a sender, recipient, subject, body, attachment name, or provider payload.

**Send Policy**:
Configurable local limits that constrain an **Email Message** before it reaches a **Transport Adapter**.
_Avoid_: Provider-only validation

**SMTP Adapter**:
A deferred **Transport Adapter** for direct SMTP delivery, intentionally excluded from the MVP.

## Relationships

- An **Email Service** sends **Email Messages** through exactly one **Transport Adapter** at runtime.
- An **Email Layer** provides the **Email Service** to an Effect program.
- An **Email Message** uses **Mailboxes** for sender, recipients, and reply-to.
- A **Mailbox** contains an **Email Address** and optional display name.
- A **Display Name** allows Unicode text but rejects header-control characters and raw mailbox delimiters.
- The MVP **Email Address** syntax is strict ASCII addr-spec only.
- An **Email Message** has at least one recipient across to, cc, and bcc.
- An **Email Message** rejects duplicate recipients across to, cc, and bcc.
- Sending an **Email Message** returns a **Send Receipt** when the transport accepts it.
- Sending an **Email Message** can fail with a **Send Failure**.
- The SDK does not retry sending automatically because retries can cause a **Duplicate Send**.
- SDK-authored telemetry does not include **Email PII** by default.
- The MVP includes a **Resend Adapter** and a **Test Adapter**.
- The MVP excludes the **SMTP Adapter** because direct SMTP has larger security and protocol surface area.
- A **Test Adapter** exposes sent **Email Messages** for assertions without global state.
- A **Provider-Specific Option** does not belong in the core **Email Message** contract.
- A **Provider Secret** is supplied as redacted Effect configuration, not as a plain string.
- A provider-backed **Transport Adapter** runs only in a **Trusted Runtime**.
- The MVP **Email Message** surface includes from, to, cc, bcc, reply-to, subject, text, HTML, and **Attachments**.
- The MVP excludes custom headers, tags, scheduling, batch sending, templates, idempotency keys, webhooks, and provider metadata.
- An **Email Message** has at least one non-empty body: text, HTML, or both.
- An **Email Message** contains **Parsed Email Fields**, not raw external input.
- A **Parsed Email Field** is created through Effect-returning decoding, not through throwing constructors.
- An **HTML Body** is not sanitized by the SDK.
- A **Send Policy** enforces local limits for recipients, subject length, body size, attachment count, and attachment bytes.
- An **Attachment** contains **Attachment Content**, not a file path or URL for the SDK to read.
- **Attachment Content** is raw bytes; base64 and MIME encoding are adapter concerns.
- An **Attachment** declares a **Media Type**, not an arbitrary content-type string.

## Example Dialogue

> **Dev:** "Should v0 include an SMTP layer?"
> **Domain expert:** "No. The MVP should prove the Effect service and adapter shape with Resend and testing support first. SMTP comes later."

> **Dev:** "Can the core send type expose Resend-only fields?"
> **Domain expert:** "No. The core message must stay provider-neutral so adapter swapping stays meaningful."

> **Dev:** "Does 'full email surface' mean tags, scheduling, and webhooks?"
> **Domain expert:** "No. For v0 it means the common mail surface: recipients, reply-to, subject, text, HTML, and attachments."

> **Dev:** "Can an adapter validate email addresses itself?"
> **Domain expert:** "No. Security-sensitive fields must already be parsed before an adapter receives the message."

> **Dev:** "Can users pass `Jane <jane@example.com>` directly?"
> **Domain expert:** "Only to constructor-boundary helpers. Stored messages contain structured Mailboxes so display names and addresses are validated separately."

> **Dev:** "Do we expose `createClient()` for users who do not use Effect?"
> **Domain expert:** "No. The MVP is Effect-first and exposes services, helpers, and Layers only."

> **Dev:** "Can Resend take an API key string directly?"
> **Domain expert:** "No. Provider secrets are redacted values or loaded through Effect Config."

> **Dev:** "Can the Resend adapter run in a browser?"
> **Domain expert:** "No. Provider adapters run in trusted runtimes so provider secrets are not exposed to end users."

> **Dev:** "Does a successful send mean the recipient received the email?"
> **Domain expert:** "No. It means the transport accepted the email and returned a Send Receipt."

> **Dev:** "Can users inspect the raw Resend error body?"
> **Domain expert:** "No, not by default. Send failures expose classified, safe details because raw provider bodies can leak email content or addresses."

> **Dev:** "Can an attachment point to `/tmp/report.pdf`?"
> **Domain expert:** "No. The SDK receives bytes only; callers decide how files or URLs are loaded."

> **Dev:** "Can attachment content type be any string?"
> **Domain expert:** "No. It must decode to a strict Media Type."

> **Dev:** "Should callers pass base64 attachments?"
> **Domain expert:** "No. Callers pass raw bytes and adapters encode for their transport."

> **Dev:** "Can we let Resend reject oversized emails?"
> **Domain expert:** "No. The SDK enforces a local Send Policy before calling the transport."

> **Dev:** "How do tests assert an email was sent?"
> **Domain expert:** "They use the Test Adapter's inspectable Effect service, not logs or globals."

> **Dev:** "Does the SDK make arbitrary HTML safe?"
> **Domain expert:** "No. HTML is caller-owned content; the SDK validates transport safety, not content safety."

> **Dev:** "Should transient failures be retried automatically?"
> **Domain expert:** "No. Users opt into retries explicitly because retrying can create duplicate sends."

> **Dev:** "Does Effect tracing mean we can log message details?"
> **Domain expert:** "No. Effect traces should identify operations, while SDK annotations and logs avoid Email PII by default."

> **Dev:** "What happens when an email address is invalid?"
> **Domain expert:** "Decoding fails in Effect; constructors should not throw in the secure path."

> **Dev:** "Can a message have neither text nor HTML?"
> **Domain expert:** "No. A message must have at least one non-empty body."

> **Dev:** "Can the same address appear in both to and cc?"
> **Domain expert:** "No. Duplicate recipients are rejected instead of silently deduped."

> **Dev:** "Do we support unicode email addresses in v0?"
> **Domain expert:** "No. v0 accepts strict ASCII mailbox addresses only."

> **Dev:** "Can a display name contain non-English text?"
> **Domain expert:** "Yes, but it is validated as safe display text, not raw header syntax."

## Flagged Ambiguities

- "layer" was used to mean provider implementation; resolved: canonical term is **Transport Adapter**, exposed through Effect Layers.
- "full email surface" was used broadly; resolved: the core **Email Message** surface is provider-neutral, not Resend-shaped.
- "delivery" was used ambiguously; resolved: v0 only models provider acceptance as a **Send Receipt**.
