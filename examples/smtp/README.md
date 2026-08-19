# SMTP effect-email example

Sends one email through SMTP with the same Effect beta used by the SDK.

Requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_DOMAIN` in `.env`.

```sh
bun install
cp .env.example .env
bun run send
```

`src/send.ts` intentionally keeps the source-compatible one-argument `Email.send(message)` call. SMTP also accepts parsed Send Options as a second argument for interface compatibility, but it ignores the Idempotency Key and provides no deduplication or safe-retry guarantee.

Edit `src/send.ts` to change sender, recipient, subject, body, provider-neutral headers, or the inline attachment referenced from HTML with `cid:logo@example.com`.
