import { Effect } from "effect";
import { Email, EmailMessage } from "effect-email";
import { TestEmailInspection, defaultLayer } from "effect-email/test";

export default {
  fetch(): Promise<Response> {
    return Effect.gen(function* () {
      const message = yield* EmailMessage.make({
        from: "sender@example.com",
        to: "recipient@example.com",
        subject: "Cloudflare Test Adapter entrypoint",
        text: "Sent and inspected inside a Worker bundle.",
      });
      const email = yield* Email;
      const inspection = yield* TestEmailInspection;
      yield* email.send(message);
      const accepted = yield* inspection.accepted;
      return new Response(accepted.length.toString());
    }).pipe(Effect.provide(defaultLayer), Effect.runPromise);
  },
};
