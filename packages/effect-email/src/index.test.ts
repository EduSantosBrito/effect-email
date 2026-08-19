import { assert, describe, it } from "@effect/vitest";
import { Cause, Data, Effect, Exit, Layer, Predicate, Redacted, Ref, Result, Schema } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  AmbiguousSendFailure,
  Attachment,
  AuthenticationFailure,
  ContentId,
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
  ProviderProtocolFailure,
  RateLimitFailure,
  RejectedMessageFailure,
  RetryAfter,
  SendFailureMetadata,
  SendOptions,
  SendPolicy,
  SendPolicyViolation,
  TransportUnavailableFailure,
  type EmailHeaders as EmailHeadersShape,
  type EmailMessageInput,
} from "./index";
import { requestBody } from "./internal/resend-request";
import * as Resend from "./resend";
import * as Smtp from "./smtp";
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
const decodeEmailAddress = Schema.decodeUnknownEffect(EmailAddress);
const decodeDisplayName = Schema.decodeUnknownEffect(DisplayName);
const decodeEmailHeaderName = Schema.decodeUnknownEffect(EmailHeaderName);
const decodeEmailHeaderValue = Schema.decodeUnknownEffect(EmailHeaderValue);
const decodeMediaType = Schema.decodeUnknownEffect(MediaType);
const decodeContentId = Schema.decodeUnknownEffect(ContentId);
const decodeSendFailureMetadata = Schema.decodeUnknownEffect(SendFailureMetadata);
const decodeRetryAfter = Schema.decodeUnknownEffect(RetryAfter);
const RetryAfterVariants = Data.taggedEnum<RetryAfter>();

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

const provideSmtp = (
  transporter: Parameters<typeof Smtp.SmtpClient.layer>[0]["transporter"],
  policy: Layer.Layer<SendPolicy> = Layer.succeed(SendPolicy)(SendPolicy.defaultLayer),
): Layer.Layer<Email> =>
  Smtp.layer.pipe(
    Layer.provide(Layer.succeed(Smtp.SmtpClient)(Smtp.SmtpClient.layer({ transporter }))),
    Layer.provide(policy),
  );

describe("effect-email send attempt contracts", () => {
  it.effect("parses Idempotency Keys and Send Options at their public boundary", () =>
    Effect.gen(function* () {
      for (const value of ["a", "!visible~", "x".repeat(256)]) {
        const options = yield* SendOptions.make({ idempotencyKey: value });
        assert.strictEqual(options.idempotencyKey, value);
      }
      assert.strictEqual((yield* SendOptions.make({})).idempotencyKey, undefined);

      for (const value of ["", "x".repeat(257), "has space", "tab\t", "line\n", "café"]) {
        const failure = yield* SendOptions.make({ idempotencyKey: value }).pipe(Effect.flip);
        assert.strictEqual(failure._tag, "SendOptionsValidationFailure");
        assert.strictEqual(failure.reason, "InvalidIdempotencyKey");
      }

      const malformed = yield* SendOptions.make(null).pipe(Effect.flip);
      assert.strictEqual(malformed.reason, "InvalidSendOptions");
    }),
  );

  it.effect("passes optional parsed Send Options after policy validation", () =>
    Effect.gen(function* () {
      const policyCalls = yield* Ref.make(0);
      const adapterOptions = yield* Ref.make<readonly unknown[]>([]);
      const message = yield* makeMessage();
      const options = yield* SendOptions.make({ idempotencyKey: "attempt-1" });
      const policy = SendPolicy.of({
        ...SendPolicy.defaultConfig,
        validate: (candidate) =>
          Ref.update(policyCalls, (count) => count + 1).pipe(Effect.as(candidate)),
      });
      const email = Email.layer({
        policy,
        send: (_candidate, candidateOptions) =>
          Ref.update(adapterOptions, (seen) => [...seen, candidateOptions]).pipe(
            Effect.as({ provider: "test", messageId: "receipt" }),
          ),
      });

      yield* email.send(message, options);
      yield* email.send(message);

      assert.strictEqual(yield* Ref.get(policyCalls), 2);
      assert.deepStrictEqual(yield* Ref.get(adapterOptions), [options, undefined]);
    }),
  );

  it.effect("stops invalid Send Options before policy or Transport Adapter effects", () =>
    Effect.gen(function* () {
      const policyCalls = yield* Ref.make(0);
      const adapterCalls = yield* Ref.make(0);
      const message = yield* makeMessage();
      const policy = SendPolicy.of({
        ...SendPolicy.defaultConfig,
        validate: (candidate) =>
          Ref.update(policyCalls, (count) => count + 1).pipe(Effect.as(candidate)),
      });
      const email = Email.layer({
        policy,
        send: () =>
          Ref.update(adapterCalls, (count) => count + 1).pipe(
            Effect.as({ provider: "test", messageId: "receipt" }),
          ),
      });

      const failure = yield* SendOptions.make({ idempotencyKey: "not valid" }).pipe(
        Effect.flatMap((options) => email.send(message, options)),
        Effect.flip,
      );

      assert.strictEqual(failure._tag, "SendOptionsValidationFailure");
      assert.strictEqual(yield* Ref.get(policyCalls), 0);
      assert.strictEqual(yield* Ref.get(adapterCalls), 0);
    }),
  );

  it.effect("exposes bounded operational Send Failure metadata", () =>
    Effect.gen(function* () {
      const delay = RetryAfterVariants.DelaySeconds({ seconds: 30 });
      const httpDate = RetryAfterVariants.HttpDate({
        value: "Sun, 06 Nov 1994 08:49:37 GMT",
      });
      const metadata = yield* decodeSendFailureMetadata({
        status: 429,
        retryAfter: delay,
        requestId: "request-123",
      });
      assert.deepStrictEqual(metadata, {
        status: 429,
        retryAfter: delay,
        requestId: "request-123",
      });
      assert.deepStrictEqual(yield* decodeSendFailureMetadata({ retryAfter: httpDate }), {
        retryAfter: httpDate,
      });
      assert.deepStrictEqual(
        yield* decodeSendFailureMetadata({
          status: 500,
          body: "sender@example.com",
          headers: { authorization: "secret" },
          cause: "provider payload",
          credential: "secret",
        }),
        { status: 500 },
      );

      for (const input of [
        { status: 99 },
        { status: 600 },
        { status: 200.5 },
        { retryAfter: RetryAfterVariants.DelaySeconds({ seconds: -1 }) },
        {
          retryAfter: RetryAfterVariants.DelaySeconds({
            seconds: Number.MAX_SAFE_INTEGER + 1,
          }),
        },
        {
          retryAfter: RetryAfterVariants.HttpDate({
            value: "Sunday, 06-Nov-94 08:49:37 GMT",
          }),
        },
        { requestId: "" },
        { requestId: "x".repeat(257) },
      ]) {
        yield* decodeSendFailureMetadata(input).pipe(Effect.flip);
      }

      yield* decodeRetryAfter(httpDate);
    }),
  );

  it.effect("classifies the closed Send Failure union with three dispositions", () =>
    Effect.gen(function* () {
      const permanent = [
        new SendPolicyViolation({
          reason: "EmptyRecipients",
          limit: 1,
          disposition: "permanent",
          retryable: false,
        }),
        new AuthenticationFailure({
          provider: "resend",
          disposition: "permanent",
          retryable: false,
        }),
        new RejectedMessageFailure({
          provider: "resend",
          disposition: "permanent",
          retryable: false,
        }),
        new ProviderProtocolFailure({
          provider: "resend",
          disposition: "permanent",
          retryable: false,
        }),
      ];
      const retryable = [
        new RateLimitFailure({ provider: "resend", disposition: "retryable", retryable: true }),
        new TransportUnavailableFailure({
          provider: "resend",
          disposition: "retryable",
          retryable: true,
        }),
      ];
      const ambiguous = new AmbiguousSendFailure({
        provider: "resend",
        disposition: "ambiguous",
        retryable: false,
        metadata: { status: 202 },
      });

      assert.ok(
        permanent.every((failure) => failure.disposition === "permanent" && !failure.retryable),
      );
      assert.ok(
        retryable.every((failure) => failure.disposition === "retryable" && failure.retryable),
      );
      assert.strictEqual(ambiguous.disposition, "ambiguous");
      assert.strictEqual(ambiguous.retryable, false);
      assert.deepStrictEqual(ambiguous.metadata, { status: 202 });
      yield* Effect.void;
    }),
  );

  it.effect("keeps defects and interruption outside Send Failure", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      const defecting = Email.layer({
        policy: SendPolicy.defaultLayer,
        send: () => Effect.failCause(Cause.die("adapter defect")),
      });
      const interrupted = Email.layer({
        policy: SendPolicy.defaultLayer,
        send: () => Effect.interrupt,
      });

      assert.ok(Exit.hasDies(yield* defecting.send(message).pipe(Effect.exit)));
      assert.ok(Exit.hasInterrupts(yield* interrupted.send(message).pipe(Effect.exit)));
    }),
  );
});

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

      assert.deepStrictEqual(receipt, { provider: "test", messageId: "test-message-1" });
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

  it.effect("parses provider-neutral inline attachment content IDs", () =>
    Effect.gen(function* () {
      const attachment = yield* Attachment.make({
        name: "logo.png",
        mediaType: "image/png",
        content: new Uint8Array([1]),
        contentId: "logo@example.com",
      });
      assert.strictEqual(attachment.contentId, "logo@example.com");
      assert.strictEqual(yield* decodeContentId("logo@example.com"), "logo@example.com");

      const withoutContentId = yield* Attachment.make({
        name: "report.txt",
        mediaType: "text/plain",
        content: new Uint8Array([104, 105]),
      });
      assert.strictEqual(withoutContentId.contentId, undefined);

      const message = yield* makeMessage({
        html: '<img src="cid:logo@example.com" alt="logo">',
        attachments: {
          name: "logo.png",
          mediaType: "image/png",
          content: new Uint8Array([1]),
          contentId: "logo@example.com",
        },
      });
      assert.strictEqual(message.attachments?.[0]?.contentId, "logo@example.com");

      const cases = [
        "<logo@example.com>",
        "logo",
        "logo @example.com",
        "logo@example.com\nnext",
        "logo@exampl\u00e9.com",
      ];
      for (const contentId of cases) {
        const attachmentFailure = yield* Attachment.make({
          name: "logo.png",
          mediaType: "image/png",
          content: new Uint8Array([1]),
          contentId,
        }).pipe(Effect.flip);
        assert.strictEqual(attachmentFailure.reason, "InvalidContentId");

        const messageFailure = yield* makeMessage({
          attachments: {
            name: "logo.png",
            mediaType: "image/png",
            content: new Uint8Array([1]),
            contentId,
          },
        }).pipe(Effect.flip);
        assert.strictEqual(messageFailure.field, "attachments");
        assert.strictEqual(messageFailure.reason, "InvalidContentId");
      }
    }),
  );

  it.effect("rejects duplicate inline attachment content IDs", () =>
    Effect.gen(function* () {
      const duplicateFailure = yield* makeMessage({
        attachments: [
          {
            name: "logo.png",
            mediaType: "image/png",
            content: new Uint8Array([1]),
            contentId: "asset@example.com",
          },
          {
            name: "chart.png",
            mediaType: "image/png",
            content: new Uint8Array([2]),
            contentId: "asset@example.com",
          },
        ],
      }).pipe(Effect.flip);
      assert.strictEqual(duplicateFailure.field, "attachments");
      assert.strictEqual(duplicateFailure.reason, "DuplicateContentId");

      const distinct = yield* makeMessage({
        attachments: [
          {
            name: "logo.png",
            mediaType: "image/png",
            content: new Uint8Array([1]),
            contentId: "logo@example.com",
          },
          {
            name: "chart.png",
            mediaType: "image/png",
            content: new Uint8Array([2]),
            contentId: "chart@example.com",
          },
        ],
      });
      assert.strictEqual(distinct.attachments?.[0]?.contentId, "logo@example.com");
      assert.strictEqual(distinct.attachments?.[1]?.contentId, "chart@example.com");

      const withoutContentIds = yield* makeMessage({
        attachments: [
          {
            name: "logo.png",
            mediaType: "image/png",
            content: new Uint8Array([1]),
          },
          {
            name: "chart.png",
            mediaType: "image/png",
            content: new Uint8Array([2]),
          },
        ],
      });
      assert.strictEqual(withoutContentIds.attachments?.length, 2);
    }),
  );
});

describe("effect-email policy and test adapter", () => {
  it.effect("routes scripted acceptance and exposes attempts separately", () =>
    Effect.gen(function* () {
      const first = yield* makeMessage({ subject: "First" });
      const second = yield* makeMessage({ subject: "Second" });

      yield* Effect.gen(function* () {
        const email = yield* Email;
        const control = yield* TestEmail.TestEmailControl;
        const inspection = yield* TestEmail.TestEmailInspection;
        yield* control.enqueue(TestEmail.TestEmailOutcome.Accept());

        assert.deepStrictEqual(yield* email.send(first), {
          provider: "test",
          messageId: "test-message-1",
        });
        assert.deepStrictEqual(yield* email.send(second), {
          provider: "test",
          messageId: "test-message-2",
        });
        assert.deepStrictEqual(yield* inspection.attempts, [
          { message: first },
          { message: second },
        ]);
        assert.deepStrictEqual(yield* inspection.accepted, [first, second]);
        assert.deepStrictEqual(yield* inspection.sent, [first, second]);
      }).pipe(Effect.provide(TestEmail.defaultLayer));
    }),
  );

  it.effect("routes retryable, ambiguous, and permanent scripted failures in order", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      const retryAfter = RetryAfterVariants.DelaySeconds({ seconds: 30 });

      yield* Effect.gen(function* () {
        const email = yield* Email;
        const control = yield* TestEmail.TestEmailControl;
        const inspection = yield* TestEmail.TestEmailInspection;
        yield* control.enqueue(
          TestEmail.TestEmailOutcome.RateLimit({ retryAfter }),
          TestEmail.TestEmailOutcome.TimeoutBeforeAcceptance(),
          TestEmail.TestEmailOutcome.FailAfterPossibleAcceptance(),
          TestEmail.TestEmailOutcome.PermanentFailure(),
        );

        const rateLimit = yield* email.send(message).pipe(Effect.flip);
        assert.deepStrictEqual(
          rateLimit,
          new RateLimitFailure({
            provider: "test",
            metadata: { status: 429, retryAfter },
            disposition: "retryable",
            retryable: true,
          }),
        );

        const timeout = yield* email.send(message).pipe(Effect.flip);
        assert.deepStrictEqual(
          timeout,
          new TransportUnavailableFailure({
            provider: "test",
            disposition: "retryable",
            retryable: true,
          }),
        );

        const ambiguous = yield* email.send(message).pipe(Effect.flip);
        assert.deepStrictEqual(
          ambiguous,
          new AmbiguousSendFailure({
            provider: "test",
            disposition: "ambiguous",
            retryable: false,
          }),
        );

        const permanent = yield* email.send(message).pipe(Effect.flip);
        assert.deepStrictEqual(
          permanent,
          new RejectedMessageFailure({
            provider: "test",
            disposition: "permanent",
            retryable: false,
          }),
        );

        assert.deepStrictEqual(yield* email.send(message), {
          provider: "test",
          messageId: "test-message-2",
        });
        assert.strictEqual((yield* inspection.attempts).length, 5);
        assert.deepStrictEqual(yield* inspection.accepted, [message, message]);
      }).pipe(Effect.provide(TestEmail.defaultLayer));
    }),
  );

  it.effect("deduplicates structurally equal accepted operations without consuming a step", () =>
    Effect.gen(function* () {
      const messageInput: EmailMessageInput = {
        from: "Sender <sender@example.com>",
        to: "you@example.com",
        subject: "Idempotent",
        html: '<img src="cid:logo@example.com">',
        headers: [{ name: "X-Trace-ID", value: "trace-value" }],
        attachments: [
          {
            name: "logo.png",
            mediaType: "image/png",
            content: new Uint8Array([1, 2, 3]),
            contentId: "logo@example.com",
          },
        ],
      };
      const first = yield* EmailMessage.make(messageInput);
      const structurallyEqual = yield* EmailMessage.make({
        ...messageInput,
        attachments: [
          {
            name: "logo.png",
            mediaType: "image/png",
            content: new Uint8Array([1, 2, 3]),
            contentId: "logo@example.com",
          },
        ],
      });
      const options = yield* SendOptions.make({ idempotencyKey: "operation-1" });

      yield* Effect.gen(function* () {
        const email = yield* Email;
        const control = yield* TestEmail.TestEmailControl;
        const inspection = yield* TestEmail.TestEmailInspection;
        yield* control.enqueue(
          TestEmail.TestEmailOutcome.FailAfterPossibleAcceptance(),
          TestEmail.TestEmailOutcome.PermanentFailure(),
        );

        assert.strictEqual(
          (yield* email.send(first, options).pipe(Effect.flip))._tag,
          "AmbiguousSendFailure",
        );
        assert.deepStrictEqual(yield* email.send(structurallyEqual, options), {
          provider: "test",
          messageId: "test-message-1",
        });
        assert.strictEqual(
          (yield* email.send(first).pipe(Effect.flip))._tag,
          "RejectedMessageFailure",
        );
        assert.strictEqual((yield* inspection.attempts).length, 3);
        assert.deepStrictEqual(yield* inspection.accepted, [first]);
      }).pipe(Effect.provide(TestEmail.defaultLayer));
    }),
  );

  it.effect("rejects an Idempotency Key reused for a different Email Message", () =>
    Effect.gen(function* () {
      const first = yield* makeMessage({ subject: "First" });
      const different = yield* makeMessage({ subject: "Different" });
      const options = yield* SendOptions.make({ idempotencyKey: "operation-2" });

      yield* Effect.gen(function* () {
        const email = yield* Email;
        const control = yield* TestEmail.TestEmailControl;
        const inspection = yield* TestEmail.TestEmailInspection;
        yield* control.enqueue(
          TestEmail.TestEmailOutcome.Accept(),
          TestEmail.TestEmailOutcome.TimeoutBeforeAcceptance(),
        );

        yield* email.send(first, options);
        const conflict = yield* email.send(different, options).pipe(Effect.flip);
        assert.strictEqual(conflict._tag, "RejectedMessageFailure");
        assert.strictEqual(conflict.disposition, "permanent");
        assert.strictEqual(
          (yield* email.send(different).pipe(Effect.flip))._tag,
          "TransportUnavailableFailure",
        );
        assert.strictEqual((yield* inspection.attempts).length, 3);
        assert.deepStrictEqual(yield* inspection.accepted, [first]);
      }).pipe(Effect.provide(TestEmail.defaultLayer));
    }),
  );

  it.effect("resets script, histories, receipts, and deduplication deterministically", () =>
    Effect.gen(function* () {
      const first = yield* makeMessage({ subject: "Before reset" });
      const different = yield* makeMessage({ subject: "After reset" });
      const options = yield* SendOptions.make({ idempotencyKey: "operation-reset" });

      yield* Effect.gen(function* () {
        const email = yield* Email;
        const control = yield* TestEmail.TestEmailControl;
        const inspection = yield* TestEmail.TestEmailInspection;
        yield* control.enqueue(
          TestEmail.TestEmailOutcome.Accept(),
          TestEmail.TestEmailOutcome.PermanentFailure(),
        );
        yield* email.send(first, options);

        yield* control.reset;
        assert.deepStrictEqual(yield* inspection.attempts, []);
        assert.deepStrictEqual(yield* inspection.accepted, []);
        assert.deepStrictEqual(yield* email.send(different, options), {
          provider: "test",
          messageId: "test-message-1",
        });
        assert.deepStrictEqual(yield* inspection.accepted, [different]);
      }).pipe(Effect.provide(TestEmail.defaultLayer));
    }),
  );

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
        assert.deepStrictEqual(yield* inspection.attempts, []);
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
        assert.strictEqual((yield* email.send(message)).messageId, "test-message-1");
        assert.strictEqual((yield* inspection.sent).length, 1);
        assert.strictEqual((yield* inspection.takeSent).length, 1);
        assert.deepStrictEqual(yield* inspection.sent, []);
        assert.strictEqual((yield* email.send(message)).messageId, "test-message-2");
        yield* inspection.clear;
        assert.deepStrictEqual(yield* inspection.sent, []);
        assert.strictEqual((yield* inspection.attempts).length, 2);
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
        assert.deepStrictEqual(yield* inspection.attempts, []);
      }).pipe(
        Effect.provide(
          TestEmail.layer.pipe(
            Layer.provide(Layer.succeed(SendPolicy)(SendPolicy.layer({ maxHeaders: 1 }))),
          ),
        ),
      );
    }),
  );

  it.effect("preserves inline attachment content IDs through inspection", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage({
        html: '<img src="cid:logo@example.com" alt="logo">',
        attachments: {
          name: "logo.png",
          mediaType: "image/png",
          content: new Uint8Array([1]),
          contentId: "logo@example.com",
        },
      });
      yield* Effect.gen(function* () {
        const email = yield* Email;
        const inspection = yield* TestEmail.TestEmailInspection;
        yield* email.send(message);
        const sent = yield* inspection.sent;
        assert.strictEqual(sent[0]?.attachments?.[0]?.contentId, "logo@example.com");
      }).pipe(Effect.provide(TestEmail.defaultLayer));
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

describe("effect-email SMTP adapter", () => {
  it.effect("sends text messages and decodes SMTP receipts", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const seen = yield* Ref.make<unknown>(undefined);
      const transporter = {
        sendMail: (options: unknown) =>
          Ref.update(attempts, (n) => n + 1).pipe(
            Effect.tap(() => Ref.set(seen, options)),
            Effect.as({ messageId: "<smtp-id@example.com>" }),
            Effect.runPromise,
          ),
      };
      const message = yield* makeMessage();

      const receipt = yield* Effect.gen(function* () {
        const email = yield* Email;
        return yield* email.send(message);
      }).pipe(Effect.provide(provideSmtp(transporter)));

      assert.deepStrictEqual(receipt, { provider: "smtp", messageId: "<smtp-id@example.com>" });
      assert.strictEqual(yield* Ref.get(attempts), 1);
      assert.deepStrictEqual(yield* Ref.get(seen), {
        from: "Sender <sender@example.com>",
        to: ["you@example.com"],
        subject: "Hello",
        text: "Plain",
      });
    }),
  );

  it.effect("enforces policy before invoking SmtpClient", () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0);
      const transporter = {
        sendMail: () =>
          Ref.update(attempts, (n) => n + 1).pipe(
            Effect.as({ messageId: "<smtp-id@example.com>" }),
            Effect.runPromise,
          ),
      };
      const message = yield* makeMessage({ to: ["one@example.com", "two@example.com"] });
      const failure = yield* Effect.gen(function* () {
        const email = yield* Email;
        return yield* email.send(message);
      }).pipe(
        Effect.provide(
          provideSmtp(
            transporter,
            Layer.succeed(SendPolicy)(SendPolicy.layer({ maxRecipients: 1 })),
          ),
        ),
        Effect.flip,
      );

      assert.ok(Predicate.isTagged(failure, "SendPolicyViolation"));
      assert.strictEqual(yield* Ref.get(attempts), 0);
    }),
  );

  it.effect("builds redacted SMTP config", () =>
    Effect.gen(function* () {
      const config = yield* Effect.gen(function* () {
        return yield* Smtp.SmtpConfig;
      }).pipe(
        Effect.provide(
          Smtp.SmtpConfig.layer({
            host: "smtp.example.com",
            port: 587,
            secure: false,
            user: "user",
            password: Redacted.make("secret"),
          }),
        ),
      );
      assert.deepStrictEqual(config.password, Redacted.make("secret"));
      assert.deepStrictEqual(
        Smtp.makeConfig({
          host: "smtp.example.com",
          port: 465,
          secure: true,
          user: "user",
          password: "secret",
        }),
        {
          host: "smtp.example.com",
          port: 465,
          secure: true,
          user: "user",
          password: Redacted.make("secret"),
        },
      );
    }),
  );

  it.effect("builds SmtpClient from a caller-provided SmtpConfig layer", () =>
    Effect.gen(function* () {
      const client = yield* Effect.gen(function* () {
        return yield* Smtp.SmtpClient;
      }).pipe(
        Effect.provide(Smtp.clientLayer),
        Effect.provide(
          Smtp.SmtpConfig.layer({
            host: "localhost",
            port: 1025,
            secure: false,
            user: "user",
            password: Redacted.make("secret"),
          }),
        ),
      );

      assert.strictEqual(typeof client.send, "function");
    }),
  );

  it.effect("maps HTML, multipart, recipients, and headers through SMTP send", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<readonly unknown[]>([]);
      const transporter = {
        sendMail: (options: unknown) =>
          Ref.update(seen, (messages) => [...messages, options]).pipe(
            Effect.as({ messageId: "<smtp-id@example.com>" }),
            Effect.runPromise,
          ),
      };

      const htmlOnly = yield* makeMessage({
        text: undefined,
        html: "<strong>Plain</strong>",
      });
      const multipart = yield* makeMessage({
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        replyTo: "reply@example.com",
        html: "<strong>Plain</strong>",
        headers: [
          { name: "X-Trace-ID", value: "  keep spacing  " },
          { name: "X-Campaign-ID", value: "spring-2026" },
        ],
      });

      yield* Effect.gen(function* () {
        const email = yield* Email;
        yield* email.send(htmlOnly);
        yield* email.send(multipart);
      }).pipe(Effect.provide(provideSmtp(transporter)));

      assert.deepStrictEqual(yield* Ref.get(seen), [
        {
          from: "Sender <sender@example.com>",
          to: ["you@example.com"],
          subject: "Hello",
          html: "<strong>Plain</strong>",
        },
        {
          from: "Sender <sender@example.com>",
          to: ["you@example.com"],
          cc: ["cc@example.com"],
          bcc: ["bcc@example.com"],
          replyTo: ["reply@example.com"],
          subject: "Hello",
          text: "Plain",
          html: "<strong>Plain</strong>",
          headers: {
            "X-Trace-ID": "  keep spacing  ",
            "X-Campaign-ID": "spring-2026",
          },
        },
      ]);
    }),
  );

  it.effect("maps regular and inline attachments through SMTP send", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<readonly unknown[]>([]);
      const transporter = {
        sendMail: (options: unknown) =>
          Ref.update(seen, (messages) => [...messages, options]).pipe(
            Effect.as({ messageId: "<smtp-id@example.com>" }),
            Effect.runPromise,
          ),
      };
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

      yield* Effect.gen(function* () {
        const email = yield* Email;
        yield* email.send(message);
      }).pipe(Effect.provide(provideSmtp(transporter)));

      assert.deepStrictEqual(yield* Ref.get(seen), [
        {
          from: "Sender <sender@example.com>",
          to: ["you@example.com"],
          subject: "Hello",
          text: "Plain",
          html: '<img src="cid:logo@example.com" alt="logo">',
          attachments: [
            {
              filename: "logo.png",
              contentType: "image/png",
              content: Buffer.from([1]),
              cid: "logo@example.com",
            },
            {
              filename: "report.txt",
              contentType: "text/plain",
              content: Buffer.from([104, 105]),
            },
          ],
        },
      ]);
    }),
  );

  it.effect("classifies SMTP failures through send", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      const cases: ReadonlyArray<readonly [unknown, string, boolean]> = [
        [{ code: "EAUTH" }, "AuthenticationFailure", false],
        [{ responseCode: 535 }, "AuthenticationFailure", false],
        [{ responseCode: 450 }, "RejectedMessageFailure", false],
        [{ responseCode: 550 }, "RejectedMessageFailure", false],
        [{ code: "ETIMEDOUT" }, "TransportUnavailableFailure", true],
        [{ code: "ESOCKET" }, "TransportUnavailableFailure", true],
        [{ code: "ECONNECTION" }, "TransportUnavailableFailure", true],
        [{ code: "ETLS" }, "TransportUnavailableFailure", true],
      ];

      for (const [error, tag, retryable] of cases) {
        const transporter = {
          sendMail: () => Effect.fail(error).pipe(Effect.runPromise),
        };
        const failure = yield* Effect.gen(function* () {
          const email = yield* Email;
          return yield* email.send(message);
        }).pipe(Effect.provide(provideSmtp(transporter)), Effect.flip);

        assert.strictEqual(failure._tag, tag);
        assert.strictEqual(failure.provider, "smtp");
        assert.strictEqual(failure.retryable, retryable);
        assert.strictEqual(failure.disposition, retryable ? "retryable" : "permanent");
      }

      const malformedCases = [{}, { messageId: "" }, { messageId: " " }, { messageId: 123 }];
      for (const info of malformedCases) {
        const transporter = {
          sendMail: () => Promise.resolve(info),
        };
        const failure = yield* Effect.gen(function* () {
          const email = yield* Email;
          return yield* email.send(message);
        }).pipe(Effect.provide(provideSmtp(transporter)), Effect.flip);

        assert.ok(Predicate.isTagged(failure, "ProviderProtocolFailure"));
        assert.strictEqual(failure.provider, "smtp");
        assert.strictEqual(failure.retryable, false);
        assert.strictEqual(failure.disposition, "permanent");
      }
    }),
  );
});
