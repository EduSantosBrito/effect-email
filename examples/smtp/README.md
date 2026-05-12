# SMTP effect-email example

Sends one email through SMTP with the same Effect beta used by the SDK.

Requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_DOMAIN` in `.env`.

```sh
bun install
cp .env.example .env
bun run send
```

Edit `src/send.ts` to change sender, recipient, subject, body, provider-neutral headers, or the inline attachment referenced from HTML with `cid:logo@example.com`.
