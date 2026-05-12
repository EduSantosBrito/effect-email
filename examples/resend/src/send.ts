import { Config, Effect } from "effect";
import { Email, EmailMessage } from "effect-email";
import * as Resend from "effect-email/resend";

const emailDomain = Config.nonEmptyString("EMAIL_DOMAIN");

const program = Effect.gen(function* () {
  const domain = yield* emailDomain;
  const email = yield* Email;
  const message = yield* EmailMessage.make({
    from: `Effect Email <onboarding@${domain}>`,
    to: `delivered@${domain}`,
    subject: "Hello from effect-email",
    text: "Sent with effect-email and Effect.",
    html: '<p>Sent with effect-email and Effect.</p><img src="cid:logo@example.com" alt="logo">',
    attachments: [
      {
        name: "logo.svg",
        mediaType: "image/svg+xml",
        content: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#111827"/></svg>',
        ),
        contentId: "logo@example.com",
      },
    ],
    headers: { "X-Campaign-ID": "example" },
  });

  const receipt = yield* email.send(message);

  yield* Effect.logInfo(`sent ${receipt.provider}:${receipt.messageId}`);
});

Effect.runPromise(program.pipe(Effect.provide(Resend.defaultLayer)));
