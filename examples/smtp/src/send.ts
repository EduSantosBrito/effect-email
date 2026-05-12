import { Config, Effect } from "effect";
import { Email, EmailMessage } from "effect-email";
import * as Smtp from "effect-email/smtp";

const emailDomain = Config.nonEmptyString("EMAIL_DOMAIN");

const program = Effect.gen(function* () {
  const domain = yield* emailDomain;
  const email = yield* Email;
  const message = yield* EmailMessage.make({
    from: `Effect Email <onboarding@${domain}>`,
    to: `delivered@${domain}`,
    subject: "Hello from effect-email SMTP",
    text: "Sent with effect-email, SMTP, and Effect.",
    html: '<p>Sent with effect-email, SMTP, and Effect.</p><img src="cid:logo@example.com" alt="logo">',
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
    headers: { "X-Campaign-ID": "smtp-example" },
  });

  const receipt = yield* email.send(message);

  yield* Effect.logInfo(`accepted ${receipt.provider}:${receipt.messageId}`);
});

Effect.runPromise(program.pipe(Effect.provide(Smtp.defaultLayer)));
