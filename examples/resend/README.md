# Resend effect-email example

Sends one email through Resend with the qualified Effect 4.0.0-rc.110 used by the SDK. The `effect-email/resend` entrypoint is supported in Node and Cloudflare Workers when its Provider Secret remains in a trusted runtime.

Requires `RESEND_API_KEY` and `EMAIL_DOMAIN` in `.env`.

```sh
bun install
cp .env.example .env
bun run send
```

`src/send.ts` constructs parsed Send Options and passes them as the optional second argument to `Email.send`. Reusing its Idempotency Key for the same logical send is provider-deduplicated only within Resend's currently documented 24-hour window. Change the key when you change the logical email.

Edit `src/send.ts` to change sender, recipient, subject, body, provider-neutral headers, or the inline attachment referenced from HTML with `cid:logo@example.com`.
