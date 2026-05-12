# Resend effect-email example

Sends one email through Resend with the same Effect beta used by the SDK.

Requires `RESEND_API_KEY` and `EMAIL_DOMAIN` in `.env`.

```sh
bun install
cp .env.example .env
bun run send
```

Edit `src/send.ts` to change sender, recipient, subject, body, provider-neutral headers, or the inline attachment referenced from HTML with `cid:logo@example.com`.
