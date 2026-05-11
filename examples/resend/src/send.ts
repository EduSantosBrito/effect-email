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
    headers: { "X-Campaign-ID": "example" },
  });

  const receipt = yield* email.send(message);

  yield* Effect.logInfo(`sent ${receipt.provider}:${receipt.messageId}`);
});

Effect.runPromise(program.pipe(Effect.provide(Resend.defaultLayer)));
