# effect-email

## 0.7.0

- Qualify the package for Effect `4.0.0-rc.110` and qualify the root, Resend, and Test entrypoints for Node and Cloudflare Workers. SMTP remains Node-only.
- Add parsed Send Options with an optional Idempotency Key while preserving one-argument `Email.send(message)` calls. Resend deduplication is provider-backed and limited to its declared 24-hour window, Test deduplication is Layer-local, and SMTP does not deduplicate.
- Add three-way Send Failure `disposition`, bounded operational metadata, and `AmbiguousSendFailure`; deprecate `retryable`, which is `false` for ambiguous failures. Exhaustive Send Failure matches must handle the new discriminator.
- Add the deterministic Test Adapter script/control surface, phase-aware Resend and SMTP failure mapping, and safe send telemetry.
- Migration: construct options with `SendOptions.make`, pass them only when needed as the second send argument, and move retry decisions from `retryable` to `disposition`. Retry and backoff remain explicit application responsibilities because ambiguous retries can cause a Duplicate Send.

## 0.6.0

- Add `effect-email/smtp`, a trusted-runtime SMTP adapter backed by Nodemailer.
- Support SMTP text, HTML, multipart, recipients, headers, regular attachments, inline CID attachments, and provider-neutral failure classification.

## 0.5.0

- Make `EmailMessage` constructor-only and parse messages into trusted subject, body, and header domain values.
- Reject impossible `SendPolicy` limits at policy construction and centralize policy validation before adapter side effects.

## 0.4.2

- Complete Effect-native email DX public API and provider/test layer exports.

## 0.4.1

- Add package hygiene for npm publishing and OSS contribution flow.

## 0.4.0

- Add provider-neutral email APIs, trusted-runtime Resend support, and inspectable test adapter improvements.
