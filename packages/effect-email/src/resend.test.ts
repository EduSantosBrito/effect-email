import { assert, describe, it } from "@effect/vitest";
import { Data, Effect, Exit, Layer, Predicate, Redacted, Ref, Result, Schema } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { Email, RetryAfter, SendOptions, SendPolicy } from "./index";
import { requestBody } from "./internal/resend-request";
import * as Resend from "./resend";
import { makeMessage } from "./test-fixtures";

const ResendRequestBodySchema = Schema.Struct({
  from: Schema.String,
  to: Schema.Array(Schema.String),
  cc: Schema.optional(Schema.Array(Schema.String)),
  bcc: Schema.optional(Schema.Array(Schema.String)),
  reply_to: Schema.optional(Schema.Array(Schema.String)),
  subject: Schema.String,
  text: Schema.String,
  html: Schema.optional(Schema.String),
  attachments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        filename: Schema.String,
        content_type: Schema.String,
        content: Schema.String,
        content_id: Schema.optional(Schema.String),
      }),
    ),
  ),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const decodeResendRequestBody = Schema.decodeUnknownEffect(ResendRequestBodySchema);
const decodeResendRequestJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ResendRequestBodySchema),
);
const RetryAfterVariants = Data.taggedEnum<RetryAfter>();

const provideResend = (
  client: HttpClient.HttpClient,
  policy: Layer.Layer<SendPolicy> = Layer.succeed(SendPolicy)(SendPolicy.defaultLayer),
): Layer.Layer<Email> =>
  Resend.layer.pipe(
    Layer.provide(
      Layer.effect(
        Resend.ResendClient,
        Effect.gen(function* () {
          const httpClient = yield* HttpClient.HttpClient;
          const resend = yield* Resend.ResendConfig;
          return Resend.ResendClient.layer({ client: httpClient, resend });
        }).pipe(Effect.annotateLogs({ service: "@effect-email/ResendClient" })),
      ),
    ),
    Layer.provide(Resend.ResendConfig.layer({ apiKey: Redacted.make("secret") })),
    Layer.provide(Layer.succeed(HttpClient.HttpClient)(client)),
    Layer.provide(policy),
  );

describe("effect-email Resend adapter", () => {
  it.effect("maps rich request fields without HTTP", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage({
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        replyTo: "reply@example.com",
        html: "<strong>Plain</strong>",
        attachments: {
          name: "report.txt",
          mediaType: "text/plain",
          content: new Uint8Array([104, 105]),
        },
        headers: [
          { name: "X-Trace-ID", value: "  keep spacing  " },
          { name: "X-Campaign-ID", value: "spring-2026" },
        ],
      });

      const body = yield* decodeResendRequestBody(requestBody(message));

      assert.strictEqual(body.from, "Sender <sender@example.com>");
      assert.deepStrictEqual(body.to, ["you@example.com"]);
      assert.deepStrictEqual(body.cc, ["cc@example.com"]);
      assert.deepStrictEqual(body.bcc, ["bcc@example.com"]);
      assert.deepStrictEqual(body.reply_to, ["reply@example.com"]);
      assert.strictEqual(body.subject, "Hello");
      assert.strictEqual(body.text, "Plain");
      assert.strictEqual(body.html, "<strong>Plain</strong>");
      assert.deepStrictEqual(body.attachments, [
        { filename: "report.txt", content_type: "text/plain", content: "aGk=" },
      ]);
      assert.deepStrictEqual(body.headers, {
        "X-Trace-ID": "  keep spacing  ",
        "X-Campaign-ID": "spring-2026",
      });

      const bodyWithoutHeaders = yield* decodeResendRequestBody(requestBody(yield* makeMessage()));
      assert.strictEqual(bodyWithoutHeaders.headers, undefined);
    }),
  );

  it.effect("maps inline attachment content IDs to Resend payloads", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage({
        html: '<img src="cid:logo@example.com" alt="logo">',
        attachments: [
          {
            name: "logo.png",
            mediaType: "image/png",
            content: new Uint8Array([1]),
            contentId: "logo@example.com",
          },
          {
            name: "report.txt",
            mediaType: "text/plain",
            content: new Uint8Array([104, 105]),
          },
        ],
      });

      const body = yield* decodeResendRequestBody(requestBody(message));

      assert.deepStrictEqual(body.attachments, [
        {
          filename: "logo.png",
          content_type: "image/png",
          content: "AQ==",
          content_id: "logo@example.com",
        },
        { filename: "report.txt", content_type: "text/plain", content: "aGk=" },
      ]);
    }),
  );

  it.effect("encodes attachment bytes without a global Buffer", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<typeof ResendRequestBodySchema.Type | undefined>(undefined);
      const client = HttpClient.make((request) =>
        Result.match(HttpClientRequest.toWebResult(request), {
          onFailure: (cause) =>
            Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.EncodeError({ request, cause }),
              }),
            ),
          onSuccess: (web) =>
            Effect.promise(() => web.text()).pipe(
              Effect.flatMap(decodeResendRequestJson),
              Effect.tap((body) => Ref.set(seen, body)),
              Effect.as(
                HttpClientResponse.fromWeb(
                  request,
                  new Response('{"id":"resend-id"}', { status: 200 }),
                ),
              ),
              Effect.mapError(
                (cause) =>
                  new HttpClientError.HttpClientError({
                    reason: new HttpClientError.EncodeError({ request, cause }),
                  }),
              ),
            ),
        }),
      );
      const vectors = [
        [],
        [0],
        [0, 1],
        [0, 1, 2],
        [0, 1, 2, 3],
        [0, 1, 2, 3, 4],
        [0, 1, 2, 3, 4, 5],
        [255, 254, 253],
      ];
      const message = yield* makeMessage({
        attachments: vectors.map((content, index) => ({
          name: `vector-${index.toString()}.bin`,
          mediaType: "application/octet-stream",
          content: new Uint8Array(content),
        })),
      });

      const body = yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
          Reflect.deleteProperty(globalThis, "Buffer");
          return descriptor;
        }),
        () =>
          Effect.gen(function* () {
            const email = yield* Email;
            yield* email.send(message);
            return yield* Ref.get(seen);
          }).pipe(Effect.provide(provideResend(client))),
        (descriptor) =>
          Effect.sync(() => {
            if (descriptor !== undefined) {
              Object.defineProperty(globalThis, "Buffer", descriptor);
            }
          }),
      );

      assert.deepStrictEqual(
        body?.attachments?.map((attachment) => attachment.content),
        ["", "AA==", "AAE=", "AAEC", "AAECAw==", "AAECAwQ=", "AAECAwQF", "//79"],
      );
    }),
  );

  it.effect("decodes success and does not retry", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const seen = yield* Ref.make<Request | undefined>(undefined);
      const client = HttpClient.make((request) =>
        Effect.gen(function* () {
          yield* Ref.update(attempts, (n) => n + 1);
          const web = yield* Result.match(HttpClientRequest.toWebResult(request), {
            onFailure: (cause) =>
              Effect.fail(
                new HttpClientError.HttpClientError({
                  reason: new HttpClientError.EncodeError({ request, cause }),
                }),
              ),
            onSuccess: Effect.succeed,
          });
          yield* Ref.set(seen, web);
          return HttpClientResponse.fromWeb(
            request,
            new Response('{"id":"resend-id"}', { status: 200 }),
          );
        }),
      );
      const message = yield* makeMessage({
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        replyTo: "reply@example.com",
        html: "<strong>Plain</strong>",
        attachments: {
          name: "report.txt",
          mediaType: "text/plain",
          content: new Uint8Array([104, 105]),
        },
      });

      const receipt = yield* Effect.gen(function* () {
        const email = yield* Email;
        return yield* email.send(message);
      }).pipe(Effect.provide(provideResend(client)));

      assert.deepStrictEqual(receipt, { provider: "resend", messageId: "resend-id" });
      assert.strictEqual(yield* Ref.get(attempts), 1);
      const request = yield* Ref.get(seen);
      assert.ok(request);
      assert.strictEqual(request.url, "https://api.resend.com/emails");
      assert.strictEqual(request.method, "POST");
      assert.strictEqual(request.headers.get("authorization"), "Bearer secret");
    }),
  );

  it.effect("forwards an Idempotency Key only through its HTTP header", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<readonly Request[]>([]);
      const client = HttpClient.make((request) =>
        Result.match(HttpClientRequest.toWebResult(request), {
          onFailure: (cause) =>
            Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.EncodeError({ request, cause }),
              }),
            ),
          onSuccess: (web) =>
            Ref.update(seen, (requests) => [...requests, web]).pipe(
              Effect.as(
                HttpClientResponse.fromWeb(
                  request,
                  new Response('{"id":"resend-id"}', { status: 200 }),
                ),
              ),
            ),
        }),
      );
      const message = yield* makeMessage();
      const options = yield* SendOptions.make({ idempotencyKey: "attempt-123" });

      yield* Effect.gen(function* () {
        const email = yield* Email;
        yield* email.send(message, options);
        yield* email.send(message);
      }).pipe(Effect.provide(provideResend(client)));

      const requests = yield* Ref.get(seen);
      const firstRequest = requests[0];
      assert.ok(firstRequest);
      assert.strictEqual(firstRequest.headers.get("Idempotency-Key"), "attempt-123");
      assert.strictEqual(requests[1]?.headers.has("Idempotency-Key"), false);
      const body = yield* Effect.promise(() => firstRequest.clone().text());
      assert.ok(!body.includes("idempotencyKey"));
    }),
  );

  it.effect("enforces policy before invoking ResendClient", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const client = HttpClient.make((request) =>
        Ref.update(attempts, (n) => n + 1).pipe(
          Effect.as(
            HttpClientResponse.fromWeb(request, new Response('{"id":"x"}', { status: 200 })),
          ),
        ),
      );
      const message = yield* makeMessage({ to: ["one@example.com", "two@example.com"] });
      const failure = yield* Effect.gen(function* () {
        const email = yield* Email;
        return yield* email.send(message);
      }).pipe(
        Effect.provide(
          provideResend(client, Layer.succeed(SendPolicy)(SendPolicy.layer({ maxRecipients: 1 }))),
        ),
        Effect.flip,
      );
      assert.ok(Predicate.isTagged(failure, "SendPolicyViolation"));
      assert.strictEqual(yield* Ref.get(attempts), 0);
    }),
  );

  it.effect("classifies safe failures and config", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      const cases: ReadonlyArray<readonly [number, string, "permanent" | "retryable"]> = [
        [401, "AuthenticationFailure", "permanent"],
        [403, "AuthenticationFailure", "permanent"],
        [429, "RateLimitFailure", "retryable"],
        [400, "RejectedMessageFailure", "permanent"],
        [422, "RejectedMessageFailure", "permanent"],
        [499, "RejectedMessageFailure", "permanent"],
        [500, "TransportUnavailableFailure", "retryable"],
        [503, "TransportUnavailableFailure", "retryable"],
        [599, "TransportUnavailableFailure", "retryable"],
        [302, "ProviderProtocolFailure", "permanent"],
      ];
      for (const [status, tag, disposition] of cases) {
        const client = HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response("secret sender@example.com Subject report.txt", { status }),
            ),
          ),
        );
        const failure = yield* Effect.gen(function* () {
          const email = yield* Email;
          return yield* email.send(message);
        }).pipe(Effect.provide(provideResend(client)), Effect.flip);
        const rendered = String(failure);
        assert.strictEqual(failure.disposition, disposition);
        if (!Predicate.isTagged(failure, "SendPolicyViolation")) {
          assert.deepStrictEqual(failure.metadata, { status });
        }
        assert.ok(rendered.includes(tag));
        assert.ok(!rendered.includes("sender@example.com"));
        assert.ok(!rendered.includes("secret"));
        assert.ok(!rendered.includes("report.txt"));
      }

      for (const body of ["{}", '{"id":""}', '{"id":" "}', '{"id":123}', "not-json", ""]) {
        const malformedClient = HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status: 200 }))),
        );
        const malformedFailure = yield* Effect.gen(function* () {
          const email = yield* Email;
          return yield* email.send(message);
        }).pipe(Effect.provide(provideResend(malformedClient)), Effect.flip);
        assert.ok(Predicate.isTagged(malformedFailure, "AmbiguousSendFailure"));
        assert.strictEqual(malformedFailure.disposition, "ambiguous");
        assert.deepStrictEqual(malformedFailure.metadata, { status: 200 });
      }

      const config = yield* Effect.gen(function* () {
        return yield* Resend.ResendConfig;
      }).pipe(Effect.provide(Resend.ResendConfig.layer({ apiKey: Redacted.make("secret") })));
      assert.deepStrictEqual(config.apiKey, Redacted.make("secret"));
    }),
  );

  it.effect("extracts only approved bounded response metadata", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      const failWithHeaders = (headers: HeadersInit) =>
        Effect.gen(function* () {
          const email = yield* Email;
          return yield* email.send(message);
        }).pipe(
          Effect.provide(
            provideResend(
              HttpClient.make((request) =>
                Effect.succeed(
                  HttpClientResponse.fromWeb(
                    request,
                    new Response("private provider body", { status: 429, headers }),
                  ),
                ),
              ),
            ),
          ),
          Effect.flip,
        );

      const delayFailure = yield* failWithHeaders({
        "Retry-After": "120",
        "X-Request-ID": "request-123",
        Authorization: "secret",
        "X-Private": "sender@example.com",
      });
      assert.deepStrictEqual(delayFailure.metadata, {
        status: 429,
        retryAfter: RetryAfterVariants.DelaySeconds({ seconds: 120 }),
        requestId: "request-123",
      });

      for (const retryAfter of [
        "Sun, 06 Nov 1994 08:49:37 GMT",
        "Sunday, 06-Nov-94 08:49:37 GMT",
        "Sun Nov  6 08:49:37 1994",
      ]) {
        const dateFailure = yield* failWithHeaders({ "Retry-After": retryAfter });
        assert.deepStrictEqual(dateFailure.metadata, {
          status: 429,
          retryAfter: RetryAfterVariants.HttpDate({
            value: "Sun, 06 Nov 1994 08:49:37 GMT",
          }),
        });
      }

      for (const invalidRetryAfter of ["9007199254740992", "2026-08-19", "not-a-date"]) {
        const invalidFailure = yield* failWithHeaders({
          "Retry-After": invalidRetryAfter,
          "X-Request-ID": "é".repeat(256),
          "Request-ID": "not-approved",
        });
        assert.deepStrictEqual(invalidFailure.metadata, { status: 429 });
      }
      assert.ok(!String(delayFailure).includes("secret"));
      assert.ok(!String(delayFailure).includes("sender@example.com"));
      assert.ok(!String(delayFailure).includes("private provider body"));
    }),
  );

  it.effect("keeps transport uncertainty, defects, and interruption distinct", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      const sendWith = (client: HttpClient.HttpClient) =>
        Effect.gen(function* () {
          const email = yield* Email;
          return yield* email.send(message);
        }).pipe(Effect.provide(provideResend(client)));
      const transportClient = HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request }),
          }),
        ),
      );
      const encodeClient = HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.EncodeError({ request }),
          }),
        ),
      );
      const interruptedClient = HttpClient.make(() => Effect.interrupt);

      const transportFailure = yield* sendWith(transportClient).pipe(Effect.flip);
      assert.ok(Predicate.isTagged(transportFailure, "AmbiguousSendFailure"));
      assert.strictEqual(transportFailure.disposition, "ambiguous");
      assert.strictEqual(transportFailure.metadata, undefined);
      assert.ok(Exit.hasDies(yield* sendWith(encodeClient).pipe(Effect.exit)));
      assert.ok(Exit.hasInterrupts(yield* sendWith(interruptedClient).pipe(Effect.exit)));
    }),
  );
});
