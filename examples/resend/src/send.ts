import { Config, Effect } from "effect";
import {
  Email,
  MailboxParser,
  MessageContentParser,
  parserLayer,
  type EmailMessage,
} from "effect-email";
import * as Resend from "effect-email/resend";

const emailDomain = Config.nonEmptyString("EMAIL_DOMAIN");

const program = Effect.gen(function* () {
  const domain = yield* emailDomain;
  const mailbox = yield* MailboxParser;
  const content = yield* MessageContentParser;
  const email = yield* Email;
  const message: EmailMessage = {
    from: yield* mailbox.mailbox({ address: `onboarding@${domain}` }),
    to: [yield* mailbox.mailbox({ address: `delivered@${domain}` })],
    subject: yield* content.subject("Hello from effect-email"),
    body: yield* content.body({ text: "Sent with effect-email and Effect." }),
  };

  const receipt = yield* email.send(message);

  yield* Effect.logInfo(`sent ${receipt.provider}:${receipt.messageId}`);
});

Effect.runPromise(program.pipe(Effect.provide(Resend.defaultLayer), Effect.provide(parserLayer)));
