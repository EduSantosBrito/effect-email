import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Predicate, Redacted, Ref, Result, Schema } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  Attachment,
  DisplayName,
  Email,
  EmailHeader,
  EmailHeaders,
  EmailHeaderName,
  EmailHeaderValue,
  EmailAddress,
  EmailMessage,
  Mailbox,
  MediaType,
  MessageBody,
  SendPolicy,
  type EmailHeaders as EmailHeadersShape,
  type EmailMessageInput,
} from "./index";
import { requestBody } from "./internal/resend-request";
import * as Resend from "./resend";
import * as TestEmail from "./test";

const makeMessage = (input: Partial<EmailMessageInput> = {}) =>
  EmailMessage.make({
    from: "Sender <sender@example.com>",
    to: "you@example.com",
    subject: "Hello",
    text: "Plain",
    ...input,
  });

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
      }),
    ),
  ),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const decodeResendRequestBody = Schema.decodeUnknownEffect(ResendRequestBodySchema);
const decodeEmailAddress = Schema.decodeUnknownEffect(EmailAddress);
const decodeDisplayName = Schema.decodeUnknownEffect(DisplayName);
const decodeEmailHeaderName = Schema.decodeUnknownEffect(EmailHeaderName);
const decodeEmailHeaderValue = Schema.decodeUnknownEffect(EmailHeaderValue);
const decodeMediaType = Schema.decodeUnknownEffect(MediaType);

const headerValues = (headers: EmailHeadersShape | undefined) => {
  assert.ok(headers);
  return EmailHeaders.toReadonlyArray(headers);
};

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

  it.effect("parses provider-neutral email headers", () =>
    Effect.gen(function* () {
      const recordMessage = yield* makeMessage({
        headers: { "X-Campaign-ID": "spring-2026" },
      });
      assert.deepStrictEqual(headerValues(recordMessage.headers), [
        { name: "X-Campaign-ID", value: "spring-2026" },
      ]);

      const orderedMessage = yield* makeMessage({
        headers: [
          { name: " X-Trace-ID ", value: "  keep spacing  " },
          { name: "X-Campaign-ID", value: "spring-2026" },
        ],
      });
      assert.deepStrictEqual(headerValues(orderedMessage.headers), [
        { name: "X-Trace-ID", value: "  keep spacing  " },
        { name: "X-Campaign-ID", value: "spring-2026" },
      ]);

      assert.deepStrictEqual(yield* EmailHeader.make({ name: " X-Trace-ID ", value: "value" }), {
        name: "X-Trace-ID",
        value: "value",
      });
      assert.strictEqual(yield* decodeEmailHeaderName("X-Trace-ID"), "X-Trace-ID");
      assert.strictEqual(yield* decodeEmailHeaderValue("  value  "), "  value  ");
    }),
  );

  it.effect("rejects unsafe email headers", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [unknown, string]> = [
        [{ name: "Bad Header", value: "value" }, "InvalidHeaderName"],
        [{ name: "Subject", value: "value" }, "ForbiddenHeaderName"],
        [{ name: "Resend-Tag", value: "value" }, "ForbiddenHeaderName"],
        [{ name: "X-Resend-Tag", value: "value" }, "ForbiddenHeaderName"],
        [{ name: "X-Blank", value: " " }, "InvalidHeaderValue"],
        [{ name: "X-Multiline", value: "one\ntwo" }, "InvalidHeaderValue"],
        [{ name: "X-Control", value: "bad\u0007" }, "InvalidHeaderValue"],
        [{ name: "Bad\u0007", value: "value" }, "InvalidHeaderName"],
      ];

      for (const [input, reason] of cases) {
        const headerFailure = yield* EmailHeader.make(input).pipe(Effect.flip);
        assert.strictEqual(headerFailure.reason, reason);

        const messageFailure = yield* makeMessage({ headers: [input] }).pipe(Effect.flip);
        assert.strictEqual(messageFailure.field, "headers");
        assert.strictEqual(messageFailure.reason, reason);
      }

      yield* decodeEmailHeaderValue(" ").pipe(Effect.flip);

      const duplicateFailure = yield* makeMessage({
        headers: [
          { name: "X-Trace-ID", value: "one" },
          { name: "x-trace-id", value: "two" },
        ],
      }).pipe(Effect.flip);
      assert.strictEqual(duplicateFailure.field, "headers");
      assert.strictEqual(duplicateFailure.reason, "DuplicateHeaderName");
    }),
  );

  it.effect("fails fast with top-level field and reason", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<readonly [Partial<EmailMessageInput>, string, string]> = [
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

      const alreadyBuilt = yield* makeMessage();
      const alreadyBuiltFailure = yield* EmailMessage.make(alreadyBuilt).pipe(Effect.flip);
      assert.strictEqual(alreadyBuiltFailure.field, "body");
      assert.strictEqual(alreadyBuiltFailure.reason, "EmptyBody");
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

      assert.strictEqual(yield* decodeEmailAddress("jane@example.com"), "jane@example.com");
      assert.strictEqual(yield* decodeDisplayName("Jane Doe"), "Jane Doe");
      assert.strictEqual(yield* decodeMediaType("text/plain"), "text/plain");
      yield* decodeEmailAddress("bad(comment)@example.com").pipe(Effect.flip);
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

      const policyCases: ReadonlyArray<readonly [Partial<SendPolicy.Config>, string]> = [
        [{ maxRecipients: 1 }, "TooManyRecipients"],
        [{ maxSubjectBytes: 1 }, "SubjectTooLarge"],
        [{ maxTextBodyBytes: 1 }, "TextBodyTooLarge"],
        [{ maxHtmlBodyBytes: 1 }, "HtmlBodyTooLarge"],
        [{ maxAttachments: 1 }, "TooManyAttachments"],
        [{ maxAttachmentBytes: 1 }, "AttachmentTooLarge"],
        [{ maxTotalAttachmentBytes: 1 }, "TotalAttachmentsTooLarge"],
        [{ maxHeaders: 1 }, "TooManyHeaders"],
        [{ maxHeaderNameBytes: 5 }, "HeaderNameTooLarge"],
        [{ maxHeaderValueBytes: 5 }, "HeaderValueTooLarge"],
        [{ maxTotalHeaderBytes: 10 }, "TotalHeadersTooLarge"],
      ];
      const policyMessage = yield* makeMessage({
        to: ["one@example.com", "two@example.com"],
        html: "Plain html",
        attachments: [
          {
            name: "report.txt",
            mediaType: "text/plain",
            content: new Uint8Array([104, 105]),
          },
          {
            name: "summary.txt",
            mediaType: "text/plain",
            content: new Uint8Array([104, 105]),
          },
        ],
        headers: [
          { name: "X-Trace-ID", value: "trace-value" },
          { name: "X-Campaign-ID", value: "spring-2026" },
        ],
      });
      for (const [config, reason] of policyCases) {
        const failure = yield* Effect.gen(function* () {
          const policy = yield* SendPolicy;
          return yield* policy.validate(policyMessage);
        }).pipe(Effect.provide(Layer.succeed(SendPolicy)(SendPolicy.layer(config))), Effect.flip);
        assert.strictEqual(failure.reason, reason);
      }

      const invalidConfigCases: ReadonlyArray<Partial<SendPolicy.Config>> = [
        { maxRecipients: 0 },
        { maxRecipients: -1 },
        { maxRecipients: 1.5 },
        { maxRecipients: Number.NaN },
        { maxRecipients: Number.POSITIVE_INFINITY },
        { maxRecipients: Number.NEGATIVE_INFINITY },
      ];
      for (const config of invalidConfigCases) {
        assert.throws(() => SendPolicy.layer(config));
      }

      const rejectedMessage = yield* makeMessage({ to: ["one@example.com", "two@example.com"] });
      yield* Effect.gen(function* () {
        const email = yield* Email;
        const inspection = yield* TestEmail.TestEmailInspection;
        const failure = yield* email.send(rejectedMessage).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "SendPolicyViolation");
        if (Predicate.isTagged(failure, "SendPolicyViolation")) {
          assert.strictEqual(failure.reason, "TooManyRecipients");
        }
        assert.deepStrictEqual(yield* inspection.sent, []);
      }).pipe(
        Effect.provide(
          TestEmail.layer.pipe(
            Layer.provide(Layer.succeed(SendPolicy)(SendPolicy.layer({ maxRecipients: 1 }))),
          ),
        ),
      );
    }),
  );

  it.effect("supports sent, takeSent, and clear inspection APIs", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage({ to: ["one@example.com", "two@example.com"] });
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

  it.effect("records accepted headers and skips recording on header policy failure", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage({ headers: { "X-Campaign-ID": "spring-2026" } });
      const rejectedHeadersMessage = yield* makeMessage({
        headers: [
          { name: "X-Trace-ID", value: "trace-value" },
          { name: "X-Campaign-ID", value: "spring-2026" },
        ],
      });
      yield* Effect.gen(function* () {
        const email = yield* Email;
        const inspection = yield* TestEmail.TestEmailInspection;
        yield* email.send(message);
        const sent = yield* inspection.sent;
        const sentMessage = sent[0];
        assert.ok(sentMessage);
        assert.deepStrictEqual(headerValues(sentMessage.headers), [
          { name: "X-Campaign-ID", value: "spring-2026" },
        ]);
      }).pipe(Effect.provide(TestEmail.defaultLayer));

      yield* Effect.gen(function* () {
        const email = yield* Email;
        const inspection = yield* TestEmail.TestEmailInspection;
        const failure = yield* email.send(rejectedHeadersMessage).pipe(Effect.flip);
        assert.ok(Predicate.isTagged(failure, "SendPolicyViolation"));
        if (Predicate.isTagged(failure, "SendPolicyViolation")) {
          assert.strictEqual(failure.reason, "TooManyHeaders");
        }
        assert.deepStrictEqual(yield* inspection.sent, []);
      }).pipe(
        Effect.provide(
          TestEmail.layer.pipe(
            Layer.provide(Layer.succeed(SendPolicy)(SendPolicy.layer({ maxHeaders: 1 }))),
          ),
        ),
      );
    }),
  );
});

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

      const config = yield* Effect.gen(function* () {
        return yield* Resend.ResendConfig;
      }).pipe(Effect.provide(Resend.ResendConfig.layer({ apiKey: Redacted.make("secret") })));
      assert.deepStrictEqual(config.apiKey, Redacted.make("secret"));
    }),
  );
});
