import { Effect, Layer, Redacted, Result } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, it } from "@effect/vitest";
import { Email, EmailMessage, SendOptions, SendPolicy } from "effect-email";
import * as Resend from "effect-email/resend";
import * as Test from "effect-email/test";

const makeMessage = () =>
  EmailMessage.make({
    from: "Workers Sender <sender@example.com>",
    to: "recipient@example.com",
    subject: "Cloudflare qualification",
    text: "Provider-neutral content.",
    attachments: {
      name: "bytes.bin",
      mediaType: "application/octet-stream",
      content: new Uint8Array([0, 1, 2, 3]),
    },
  });

describe("Cloudflare Workers package boundary", () => {
  it.effect("constructs, sends, inspects, and deduplicates with the Test Adapter", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      const options = yield* SendOptions.make({ idempotencyKey: "workers-attempt-1" });
      const email = yield* Email;
      const inspection = yield* Test.TestEmailInspection;

      const first = yield* email.send(message, options);
      const second = yield* email.send(message, options);
      const attempts = yield* inspection.attempts;
      const accepted = yield* inspection.accepted;

      expect(first).toEqual({ provider: "test", messageId: "test-message-1" });
      expect(second).toEqual(first);
      expect(attempts).toHaveLength(2);
      expect(accepted).toEqual([message]);
    }).pipe(Effect.provide(Test.defaultLayer)),
  );

  it.effect("executes one Resend request through an injected Web HTTP seam", () => {
    const requests: Request[] = [];
    const client = HttpClient.make((request) =>
      Result.match(HttpClientRequest.toWebResult(request), {
        onFailure: Effect.die,
        onSuccess: (webRequest) =>
          Effect.sync(() => {
            requests.push(webRequest);
            return HttpClientResponse.fromWeb(
              request,
              new Response('{"id":"workers-resend-id"}', { status: 200 }),
            );
          }),
      }),
    );
    const resendClient = Resend.ResendClient.layer({
      client,
      resend: Resend.ResendConfig.of({ apiKey: Redacted.make("worker-secret") }),
    });
    const resendLayer = Resend.layer.pipe(
      Layer.provide(Layer.succeed(Resend.ResendClient)(resendClient)),
      Layer.provide(Layer.succeed(SendPolicy)(SendPolicy.defaultLayer)),
    );

    return Effect.gen(function* () {
      const message = yield* makeMessage();
      const options = yield* SendOptions.make({ idempotencyKey: "workers-resend-attempt" });
      const email = yield* Email;
      const receipt = yield* email.send(message, options);

      expect(receipt).toEqual({ provider: "resend", messageId: "workers-resend-id" });
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request).toBeDefined();
      expect(request?.url).toBe("https://api.resend.com/emails");
      expect(request?.method).toBe("POST");
      expect(request?.headers.get("authorization")).toBe("Bearer worker-secret");
      expect(request?.headers.get("Idempotency-Key")).toBe("workers-resend-attempt");
      const body = yield* Effect.promise(() => request?.clone().text() ?? Promise.resolve(""));
      expect(body).toContain('"content":"AAECAw=="');
    }).pipe(Effect.provide(resendLayer));
  });
});
