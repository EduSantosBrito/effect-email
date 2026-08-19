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

**SMTP Credential**:
A redacted **Provider Secret** used by the **SMTP Adapter** to authenticate with an SMTP server.
_Avoid_: SMTP password string

**SMTP Password Authentication**:
The first **SMTP Adapter** authentication mode, using a username and redacted **SMTP Credential**.
_Avoid_: OAuth2, token refresh

**SMTP Secure Mode**:
The **SMTP Adapter** setting for implicit TLS on connection, not a guarantee that STARTTLS is disabled.
_Avoid_: No TLS flag

**SMTP Connection Settings**:
The minimal non-secret connection configuration for the first **SMTP Adapter** slice: host, port, and **SMTP Secure Mode**.
_Avoid_: Nodemailer options bag

**Trusted Runtime**:
A server-side environment where **Provider Secrets** can be used without exposing them to end users.
_Avoid_: Browser provider adapter

**Provider-Specific Option**:
A transport-only setting that is not part of the provider-neutral **Email Message** contract.
_Avoid_: Core field

**Send Attempt**:
One invocation of the **Email Service** with an **Email Message** and optional parsed **Send Options**.
_Avoid_: Email Message mutation

**Send Options**:
Provider-neutral parsed state that configures one **Send Attempt** without becoming part of the **Email Message**.
_Avoid_: Provider options bag

**Idempotency Key**:
An optional visible-ASCII identifier on **Send Options** that a capable **Transport Adapter** may use to deduplicate repeated attempts within its declared guarantee.
_Avoid_: Email Header, SMTP Message ID, universal retry guarantee

**Attachment**:
A named content part included with an **Email Message**.

**Inline Attachment**:
An **Attachment** with a validated **Content ID** that an **HTML Body** may reference using a `cid:` URL.
_Avoid_: Provider-specific inline option

**Attachment Content**:
Caller-supplied in-memory bytes for an **Attachment**.
_Avoid_: Attachment file path, attachment URL, base64 attachment string

**Content ID**:
A strict ASCII identifier for an **Inline Attachment**.
_Avoid_: Raw Content-ID header

**Email Header**:
A validated provider-neutral header field on an **Email Message** that is not controlled by addressing, content, MIME, authentication, or transport delivery semantics.
_Avoid_: Raw header, provider header option

**Email Header Name**:
A strict ASCII token identifying an **Email Header**.
_Avoid_: Header line, colon-prefixed name

**Email Header Value**:
A single-line text value for an **Email Header**.
_Avoid_: Folded header value, multi-line header value

**Media Type**:
A parsed MIME type that identifies **Attachment Content**.
_Avoid_: Content-type string

**Parsed Email Field**:
A security-sensitive email value that has been decoded and validated before an **Email Message** is sent.
_Avoid_: Raw string

**HTML Body**:
Caller-owned HTML content included in an **Email Message** without SDK sanitization.

**Test Adapter**:
A deterministic fake **Transport Adapter** used to script send outcomes and inspect attempts and accepted **Email Messages** through Effect state without contacting an external provider.

**Test Control**:
The public test capability that enqueues deterministic **Test Adapter** outcomes and resets its Layer-local state.

**Send Receipt**:
Proof that a **Transport Adapter** accepted an **Email Message** for delivery.
_Avoid_: Delivery receipt

**SMTP Message ID**:
The message identifier reported by the **SMTP Adapter** after provider acceptance.
_Avoid_: Delivery proof, dedupe key

**Send Failure**:
A closed classified failure from a **Send Attempt**, with a permanent, retryable, or ambiguous disposition.
_Avoid_: Raw provider error, defect, interruption

**Ambiguous Send Failure**:
A **Send Failure** where provider acceptance may have occurred but no valid **Send Receipt** is available.
_Avoid_: Retryable failure

**Send Failure Metadata**:
Bounded operational metadata containing only a validated HTTP status, structured Retry-After value, or limited request ID.
_Avoid_: Raw provider body, generic headers, cause, credential, Email PII

**SMTP Failure Mapping**:
Classification of Nodemailer failures into the existing provider-neutral **Send Failure** taxonomy.
_Avoid_: Raw Nodemailer error

**Duplicate Send**:
An unintended second acceptance of the same **Email Message** by a transport.

**Email PII**:
Message data that can identify a sender, recipient, subject, body, attachment name, or provider payload.

**Send Policy**:
Configurable local limits that constrain an **Email Message** before it reaches a **Transport Adapter**.
_Avoid_: Provider-only validation

**SMTP Adapter**:
A provider-neutral **Transport Adapter** for direct SMTP delivery, exposed as `effect-email/smtp`, implemented with Nodemailer, and using the existing **Email Message** surface before new message capabilities are added.
_Avoid_: Nodemailer adapter

**SMTP Client Service**:
The subpath-local Effect service that performs SMTP sends for the **SMTP Adapter**.
_Avoid_: Public root client

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
- Each **Send Attempt** may include parsed **Send Options**; omitting them or their **Idempotency Key** creates a non-idempotent attempt.
- **Send Options** are validated through Effect before **Send Policy** evaluation or **Transport Adapter** effects.
- An **Idempotency Key** belongs to the **Send Attempt**, not the **Email Message**.
- Sending an **Email Message** can fail with a **Send Failure**.
- Every **Send Failure** has exactly one disposition: permanent, retryable, or ambiguous.
- An **Ambiguous Send Failure** is not generally safe to retry; a separately declared adapter deduplication guarantee may reduce **Duplicate Send** risk.
- The deprecated `retryable` compatibility field is true only for retryable disposition and false for permanent and ambiguous dispositions.
- **Send Failure Metadata** is optional and allowlisted; it never exposes raw bodies, generic headers, causes, credentials, or **Email PII**.
- Defects and fiber interruption remain outside the **Send Failure** channel.
- The **SMTP Adapter** maps Nodemailer errors into the existing **Send Failure** classes instead of adding SMTP-specific public error types.
- **SMTP Failure Mapping** treats authentication errors as permanent **AuthenticationFailure**.
- **SMTP Failure Mapping** treats SMTP 4xx rejection as retryable **TransportUnavailableFailure** when non-acceptance is known, and SMTP 5xx rejection other than authentication as permanent **RejectedMessageFailure**.
- **SMTP Failure Mapping** treats connection, TLS, and timeout failures as retryable **TransportUnavailableFailure** only when they are known to occur before DATA.
- **SMTP Failure Mapping** treats failures during or after DATA, failures with an unknown command or phase, and resolved sends without a valid **SMTP Message ID** as **Ambiguous Send Failures**.
- The **SMTP Adapter** returns `provider: "smtp"` in its **Send Receipt**.
- The **SMTP Adapter** uses the transport-reported **SMTP Message ID** as the **Send Receipt** message ID.
- An **SMTP Message ID** is not proof of recipient delivery and is not a duplicate-send prevention key.
- The SDK does not retry sending automatically because retries can cause a **Duplicate Send**.
- SDK-authored telemetry does not include **Email PII**.
- The supported **Transport Adapters** are the **Resend Adapter**, **SMTP Adapter**, and **Test Adapter**.
- The **SMTP Adapter** is supported in Node and excluded from the Cloudflare Workers compatibility promise.
- The **SMTP Adapter** supports the whole current **Email Message** surface: text body, HTML body, attachments, inline attachments, and **Email Headers**.
- The second real **Transport Adapter** proves the core contract before provider-shaped capabilities such as tags, scheduling, templates, webhooks, or provider metadata are added.
- The **SMTP Adapter** subpath is named for the provider-neutral capability (`effect-email/smtp`), not the implementation library.
- The **SMTP Adapter** is implemented with Nodemailer because SMTP protocol maturity is more important than TypeScript-native internals.
- The **SMTP Adapter** exports an **SMTP Client Service** from `effect-email/smtp` for testability and custom Layer composition.
- The **SMTP Client Service** is not exported from the provider-neutral root API.
- A **Test Adapter** exposes attempts and accepted **Email Messages** separately for assertions without global state.
- **Test Control** scripts acceptance, rate limiting, timeout before acceptance, ambiguous failure after possible acceptance, and permanent failure; an exhausted script accepts by default.
- A **Test Adapter** deduplication hit returns the original **Send Receipt** without consuming a scripted outcome or recording a second acceptance.
- A **Test Adapter** reset clears its script, attempts, acceptances, receipt sequence, and Layer-local deduplication state.
- A **Provider-Specific Option** does not belong in the core **Email Message** contract.
- **Idempotency Key** is provider-neutral **Send Options** state, but each **Transport Adapter** declares its own guarantee.
- The **Resend Adapter** provides provider-backed deduplication only within Resend's documented retention window.
- The **Test Adapter** provides deterministic deduplication for the lifetime of its Layer.
- The **SMTP Adapter** accepts common **Send Options** but does not deduplicate or translate the **Idempotency Key** into SMTP state.
- The SDK owns no persistent idempotency coordinator and performs no automatic retry.
- A **Provider Secret** is supplied as redacted Effect configuration, not as a plain string.
- A provider-backed **Transport Adapter** runs only in a **Trusted Runtime**.
- An **SMTP Credential** is supplied as redacted Effect configuration, while non-secret SMTP connection settings such as host, port, and secure mode are regular Effect configuration.
- The first **SMTP Adapter** slice exposes minimal **SMTP Connection Settings**, **SMTP Password Authentication**, and no general Nodemailer options bag.
- SMTP pool, proxy, DKIM, DSN, and TLS override settings are deferred until they are modeled as provider-neutral concepts or explicit subpath-local SMTP options.
- The first **SMTP Adapter** slice supports **SMTP Password Authentication** only.
- OAuth2 and advanced SMTP authentication are deferred until the basic **SMTP Adapter** contract is proven.
- **SMTP Secure Mode** follows Nodemailer semantics: enabled means implicit TLS on connect, disabled still allows STARTTLS upgrade when the server supports it.
- The MVP **Email Message** surface includes from, to, cc, bcc, reply-to, subject, text, HTML, and **Attachments**.
- The MVP excludes tags, scheduling, batch sending, templates, webhooks, and provider metadata.
- An **Email Message** has at least one non-empty body: text, HTML, or both.
- An **Email Message** may contain **Email Headers** as an ordered list.
- An **Email Message** contains **Parsed Email Fields**, not raw external input.
- A **Parsed Email Field** is created through Effect-returning decoding, not through throwing constructors.
- An **HTML Body** is not sanitized by the SDK.
- A **Send Policy** enforces local limits for recipients, subject length, body size, attachment count, and attachment bytes.
- A **Send Policy** enforces local limits for **Email Header** count, header name bytes, header value bytes, and total header bytes.
- An **Attachment** contains **Attachment Content**, not a file path or URL for the SDK to read.
- **Attachment Content** is raw bytes; base64 and MIME encoding are adapter concerns.
- An **Attachment** declares a **Media Type**, not an arbitrary content-type string.
- An **Inline Attachment** is still an **Attachment**; the **Content ID** only makes it referenceable from an **HTML Body**.
- A **Content ID** is stored without angle brackets and adapters format it for their transport.
- **Content ID** is a core **Attachment** field, not a **Provider-Specific Option**.
- The v0 **Content ID** shape is the unbracketed RFC msg-id body: ASCII, non-empty, no whitespace, no control characters, no angle brackets, and exactly one `@`.
- An **Inline Attachment** does not require the **HTML Body** to reference its **Content ID**.
- An **Email Message** rejects duplicate **Content IDs** across **Attachments**.
- The v0 **Inline Attachment** surface does not expose attachment disposition; adapters infer transport disposition from **Content ID** when needed.
- An **Email Header** is allowed only when it does not override structured **Email Message** fields or transport-controlled behavior.
- An **Email Header** has one **Email Header Name** and one **Email Header Value**.
- An **Email Message** rejects duplicate **Email Header Names**.
- An **Email Header Name** cannot be a structured message field, MIME control field, authentication field, delivery trace field, or provider-reserved field.
- An **Email Header Name** is stored trimmed with caller casing preserved, but duplicate and forbidden-name checks use a lowercase comparison key.
- An **Email Header Value** preserves caller text but must be non-blank and single-line.
- Raw **Email Header** input may be a convenience record or ordered list, but stored **Email Message** state is always an ordered list.

## Example Dialogue

> **Dev:** "Does the package include an SMTP Adapter?"
> **Domain expert:** "Yes. The SMTP Adapter is supported through `effect-email/smtp` in Node, but not in Cloudflare Workers."

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

> **Dev:** "Does an SMTP Message ID prove delivery or prevent duplicate sends?"
> **Domain expert:** "No. It identifies the accepted message but is not delivery proof or a dedupe key."

> **Dev:** "Can users inspect the raw Resend error body?"
> **Domain expert:** "No. Send failures expose classified, safe details because raw provider bodies can leak email content or addresses."

> **Dev:** "Should the first SMTP Adapter expose Nodemailer errors directly?"
> **Domain expert:** "No. Map them into the existing Send Failure classes unless the provider-neutral taxonomy proves insufficient."

> **Dev:** "Can an attachment point to `/tmp/report.pdf`?"
> **Domain expert:** "No. The SDK receives bytes only; callers decide how files or URLs are loaded."

> **Dev:** "Can attachment content type be any string?"
> **Domain expert:** "No. It must decode to a strict Media Type."

> **Dev:** "Should callers pass base64 attachments?"
> **Domain expert:** "No. Callers pass raw bytes and adapters encode for their transport."

> **Dev:** "Are custom headers the next email surface to add?"
> **Domain expert:** "Yes, if they are validated as Email Headers and cannot override structured message or transport-controlled fields."

> **Dev:** "Are Email Headers a Resend-only option?"
> **Domain expert:** "No. They belong to the core Email Message as ordered provider-neutral message state."

> **Dev:** "Can the same Email Header Name appear twice?"
> **Domain expert:** "No, not yet. Resend maps headers as an object, so duplicates are rejected until a provider-neutral duplicate-header story exists."

> **Dev:** "Can users set From, Subject, Message-ID, DKIM-Signature, or Resend-\* through Email Headers?"
> **Domain expert:** "No. Those are structured, MIME, authentication, delivery, or provider-reserved fields, not user Email Headers."

> **Dev:** "Should Email Header Names be lowercased in stored messages?"
> **Domain expert:** "No. Trim and preserve casing for output, but compare using lowercase keys."

> **Dev:** "Should Email Header Values be trimmed?"
> **Domain expert:** "No. Preserve caller text, but reject blank or multi-line values."

> **Dev:** "Can callers pass headers as an object?"
> **Domain expert:** "Yes, as constructor input only. Stored Email Messages use an ordered Email Header list."

> **Dev:** "Do Email Headers only need constructor validation?"
> **Domain expert:** "No. Constructors validate safety and meaning; Send Policy enforces local header count and byte limits before transport."

> **Dev:** "Can we let Resend reject oversized emails?"
> **Domain expert:** "No. The SDK enforces a local Send Policy before calling the transport."

> **Dev:** "How do tests assert an email was sent?"
> **Domain expert:** "They use the Test Adapter's inspectable Effect service, not logs or globals."

> **Dev:** "Does the SDK make arbitrary HTML safe?"
> **Domain expert:** "No. HTML is caller-owned content; the SDK validates transport safety, not content safety."

> **Dev:** "Should transient failures be retried automatically?"
> **Domain expert:** "No. Users opt into retries explicitly because retrying can create duplicate sends."

> **Dev:** "Does Effect tracing mean we can log message details?"
> **Domain expert:** "No. Effect traces should identify operations, while SDK annotations and logs exclude Email PII."

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

> **Dev:** "Is an Idempotency Key a Resend-only option?"
> **Domain expert:** "No. It is provider-neutral Send Options state for one Send Attempt, but each Transport Adapter declares a different deduplication guarantee."

> **Dev:** "Does passing an Idempotency Key make an SMTP retry safe?"
> **Domain expert:** "No. SMTP accepts the common Send Options shape but does not deduplicate or translate the key into Message-ID or an Email Header."

> **Dev:** "Is the SMTP Adapter available in Cloudflare Workers?"
> **Domain expert:** "No. `effect-email/smtp` is Node-only; the root, Resend, and Test entrypoints carry the Workers compatibility promise."

> **Dev:** "Can the first SMTP Adapter skip attachments or Email Headers?"
> **Domain expert:** "No. Current core surface means text, HTML, attachments, inline attachments, and Email Headers."

> **Dev:** "Should the SMTP Adapter be named `effect-email/nodemailer`?"
> **Domain expert:** "No. The public subpath is `effect-email/smtp`; Nodemailer is the implementation library."

> **Dev:** "Should the SMTP Adapter use emailjs because it is TypeScript-native?"
> **Domain expert:** "No. Use Nodemailer because SMTP protocol maturity matters more than TypeScript-native internals."

> **Dev:** "Should the SMTP Adapter export only Layers?"
> **Domain expert:** "No. Export a subpath-local SMTP Client Service too, matching the Resend adapter shape for testability and composition."

> **Dev:** "Can SMTP passwords be passed as plain strings?"
> **Domain expert:** "No. SMTP credentials are Provider Secrets and use redacted Effect configuration."

> **Dev:** "Should the first SMTP Adapter include OAuth2?"
> **Domain expert:** "No. Start with SMTP Password Authentication only; OAuth2 can follow after the adapter shape is proven."

> **Dev:** "Does SMTP secure=false mean the adapter forbids TLS?"
> **Domain expert:** "No. It means no implicit TLS on connect; STARTTLS may still upgrade the connection when the server supports it."

> **Dev:** "Should the first SMTP Adapter expose Nodemailer's full options bag?"
> **Domain expert:** "No. Start with host, port, secure mode, username, and redacted password only."

## Flagged Ambiguities

- "layer" was used to mean provider implementation; resolved: canonical term is **Transport Adapter**, exposed through Effect Layers.
- "full email surface" was used broadly; resolved: the core **Email Message** surface is provider-neutral, not Resend-shaped.
- "delivery" was used ambiguously; resolved: v0 only models provider acceptance as a **Send Receipt**.
- "custom headers" was used broadly; resolved: canonical term is **Email Header**, limited to validated provider-neutral header fields.
- "provider agnostic" was used as an alias; resolved: canonical term is **provider-neutral**.
