import { Effect, Redacted } from "effect";
import { Email, EmailMessage, type SendFailure, type SendReceipt } from "effect-email";
import { ResendClient, type ResendConfigInput } from "effect-email/resend";
import { TestEmailInspection, defaultLayer } from "effect-email/test";

const program = Effect.gen(function* () {
  const message = yield* EmailMessage.make({
    from: "sender@example.com",
    to: "recipient@example.com",
    subject: "Declaration smoke",
    text: "Published declarations resolve.",
  });
  const email = yield* Email;
  return yield* email.send(message);
});

const runnable = program.pipe(Effect.provide(defaultLayer));
const resendConfig: ResendConfigInput = { apiKey: Redacted.make("secret") };
type PublishedSendResult = SendReceipt | SendFailure;

void runnable;
void ResendClient;
void resendConfig;
void TestEmailInspection;
void (null as unknown as PublishedSendResult);
