import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Predicate, Redacted, Ref, Result, Schema } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  Attachment,
  Email,
  EmailMessage,
  EmailMessageInput,
  Mailbox,
  MessageBody,
  SendPolicy,
} from "./index";
import * as Resend from "./resend";
import * as TestEmail from "./test";

const makeMessage = (input: Partial<typeof EmailMessageInput.Type> = {}) =>
  EmailMessage.make({
    from: "Sender <sender@example.com>",
    to: "you@example.com",
    subject: "Hello",
    text: "Plain",
    ...input,
  });

const provideResend = (
  client: HttpClient.HttpClient,
  policy: Layer.Layer<SendPolicy> = Resend.policyLayer,
): Layer.Layer<Email> =>
  Resend.layer.pipe(
    Layer.provide(
      Layer.effect(
        Resend.ResendClient,
        Effect.gen(function* () {
          const httpClient = yield* HttpClient.HttpClient;
          const resend = yield* Resend.ResendConfig;
          return Resend.ResendClient.layer({ client: httpClient, resend });
        }),
      ),
    ),
    Layer.provide(Layer.succeed(Resend.ResendConfig)(Resend.makeConfig("secret"))),
    Layer.provide(Layer.succeed(HttpClient.HttpClient)(client)),
    Layer.provide(policy),
  );

describe("effect-email constructors", () => {
  it.effect("builds a validated message and sends through the test layer", () =>
    Effect.gen(function* () {
      const message = yield* EmailMessage.make({
        from: " Sender <Sender@Example.COM> ",
        to: [{ address: "You@Example.COM" }],
        cc: "copy@example.com",
        bcc: [{ address: "blind@example.com", displayName: "Ops, Inc; Team @ Acme" }],
        replyTo: "you@example.com",
        subject: "Hello",
        body: { text: "Plain", html: "<strong>Plain</strong>" },
        attachments: {
          name: "report.txt",
          mediaType: "text/plain",
          content: new Uint8Array([104, 105]),
        },
      });
      assert.strictEqual(message.from.address, "sender@example.com");
      assert.strictEqual(message.from.displayName, "Sender");
      assert.strictEqual(message.to[0].address, "you@example.com");
      assert.strictEqual(message.bcc?.[0]?.displayName, "Ops, Inc; Team @ Acme");
      assert.deepStrictEqual(
        message.body,
        MessageBody.TextAndHtml({ text: "Plain", html: "<strong>Plain</strong>" }),
      );

      const receipt = yield* Effect.gen(function* () {
        const email = yield* Email;
        const inspection = yield* TestEmail.TestEmailInspection;
        const sentReceipt = yield* email.send(message);
        assert.deepStrictEqual(yield* inspection.sent, [message]);
        return sentReceipt;
      }).pipe(Effect.provide(TestEmail.defaultLayer));

      assert.deepStrictEqual(receipt, { provider: "test", messageId: "test-message-id" });
    }),
  );

  it.effect("fails fast with top-level field and reason", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<
        readonly [Partial<typeof EmailMessageInput.Type>, string, string]
      > = [
        [{ from: "bad(comment)@example.com" }, "from", "InvalidEmailAddress"],
        [{ to: [] }, "to", "EmptyRecipients"],
        [{ to: ["a@example.com"], cc: ["A@example.com"] }, "cc", "DuplicateRecipient"],
        [{ subject: "bad\nsubject" }, "subject", "InvalidSubject"],
        [{ text: "" }, "body", "InvalidTextBody"],
        [{ html: " " }, "body", "InvalidHtmlBody"],
        [
          { attachments: { name: "../x", mediaType: "text/plain", content: new Uint8Array() } },
          "attachments",
          "InvalidAttachmentName",
        ],
        [
          { attachments: { name: "x", mediaType: "not-a-type", content: new Uint8Array() } },
          "attachments",
          "InvalidMediaType",
        ],
        [
          { attachments: { name: "x", mediaType: "text/plain", content: "aGk=" } },
          "attachments",
          "InvalidAttachmentContent",
        ],
      ];

      for (const [input, field, reason] of cases) {
        const failure = yield* makeMessage(input).pipe(Effect.flip);
        assert.strictEqual(failure.field, field);
        assert.strictEqual(failure.reason, reason);
      }

      const withReplyToDuplicate = yield* makeMessage({ replyTo: "you@example.com" });
      assert.strictEqual(withReplyToDuplicate.replyTo?.[0]?.address, "you@example.com");
    }),
  );

  it.effect("keeps component constructors usable without layers", () =>
    Effect.gen(function* () {
      const mailbox = yield* Mailbox.make("Jane Doe <JANE@Example.COM>");
      assert.strictEqual(mailbox.address, "jane@example.com");
      assert.strictEqual(mailbox.displayName, "Jane Doe");
      assert.deepStrictEqual(
        yield* MessageBody.make({ html: "<p>x</p>" }),
        MessageBody.HtmlOnly({ html: "<p>x</p>" }),
      );
      const attachment = yield* Attachment.make({
        name: "safe.pdf",
        mediaType: "application/pdf",
        content: new Uint8Array([1]),
      });
      assert.strictEqual(attachment.mediaType, "application/pdf");
    }),
  );
});

describe("effect-email policy and test adapter", () => {
  it.effect("merges default policy config and rejects before recording", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      yield* Effect.gen(function* () {
        const policy = yield* SendPolicy;
        assert.strictEqual(policy.maxRecipients, SendPolicy.defaultConfig.maxRecipients);
        assert.deepStrictEqual(yield* policy.validate(message), message);
      }).pipe(Effect.provide(Layer.succeed(SendPolicy)(SendPolicy.layer({}))));

      yield* Effect.gen(function* () {
        const email = yield* Email;
        const inspection = yield* TestEmail.TestEmailInspection;
        const failure = yield* email.send(message).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "SendPolicyViolation");
        if (Predicate.isTagged(failure, "SendPolicyViolation")) {
          assert.strictEqual(failure.reason, "TooManyRecipients");
        }
        assert.deepStrictEqual(yield* inspection.sent, []);
      }).pipe(
        Effect.provide(
          TestEmail.layer.pipe(
            Layer.provide(Layer.succeed(SendPolicy)(SendPolicy.layer({ maxRecipients: 0 }))),
          ),
        ),
      );
    }),
  );

  it.effect("supports sent, takeSent, and clear inspection APIs", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      yield* Effect.gen(function* () {
        const email = yield* Email;
        const inspection = yield* TestEmail.TestEmailInspection;
        yield* email.send(message);
        assert.strictEqual((yield* inspection.sent).length, 1);
        assert.strictEqual((yield* inspection.takeSent).length, 1);
        assert.deepStrictEqual(yield* inspection.sent, []);
        yield* email.send(message);
        yield* inspection.clear;
        assert.deepStrictEqual(yield* inspection.sent, []);
      }).pipe(Effect.provide(TestEmail.defaultLayer));
    }),
  );
});

describe("effect-email Resend adapter", () => {
  it.effect("maps rich request fields, decodes success, and does not retry", () =>
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
      const body = yield* Effect.promise(() => request.json()).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Struct({
              from: Schema.String,
              to: Schema.Array(Schema.String),
              cc: Schema.Array(Schema.String),
              bcc: Schema.Array(Schema.String),
              reply_to: Schema.Array(Schema.String),
              subject: Schema.String,
              text: Schema.String,
              html: Schema.String,
              attachments: Schema.Array(
                Schema.Struct({
                  filename: Schema.String,
                  content_type: Schema.String,
                  content: Schema.String,
                }),
              ),
            }),
          ),
        ),
      );
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
      const message = yield* makeMessage();
      const failure = yield* Effect.gen(function* () {
        const email = yield* Email;
        return yield* email.send(message);
      }).pipe(
        Effect.provide(
          provideResend(client, Layer.succeed(SendPolicy)(SendPolicy.layer({ maxRecipients: 0 }))),
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
      const cases: ReadonlyArray<readonly [number, string]> = [
        [401, "AuthenticationFailure"],
        [429, "RateLimitFailure"],
        [422, "RejectedMessageFailure"],
        [503, "TransportUnavailableFailure"],
        [302, "ProviderProtocolFailure"],
      ];
      for (const [status, tag] of cases) {
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
        assert.ok(rendered.includes(tag));
        assert.ok(!rendered.includes("sender@example.com"));
        assert.ok(!rendered.includes("secret"));
        assert.ok(!rendered.includes("report.txt"));
      }

      const malformedClient = HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 }))),
      );
      const malformedFailure = yield* Effect.gen(function* () {
        const email = yield* Email;
        return yield* email.send(message);
      }).pipe(Effect.provide(provideResend(malformedClient)), Effect.flip);
      assert.ok(Predicate.isTagged(malformedFailure, "ProviderProtocolFailure"));

      const config = yield* Resend.config
        .asEffect()
        .pipe(
          Effect.provide(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: { RESEND_API_KEY: "secret" } })),
          ),
        );
      assert.deepStrictEqual(config, { apiKey: Redacted.make("secret") });
      assert.strictEqual(
        (yield* Resend.config
          .asEffect()
          .pipe(
            Effect.provide(
              ConfigProvider.layer(ConfigProvider.fromEnv({ env: { RESEND_API_KEY: "" } })),
            ),
            Effect.exit,
          ))._tag,
        "Failure",
      );
    }),
  );
});
