import { Effect } from "effect";
import { EmailMessage } from "effect-email";

export default {
  fetch(): Promise<Response> {
    return EmailMessage.make({
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Cloudflare root entrypoint",
      text: "Constructed inside a Worker bundle.",
    }).pipe(
      Effect.map((message) => new Response(message.subject)),
      Effect.runPromise,
    );
  },
};
