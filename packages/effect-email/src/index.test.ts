import { assert, describe, it } from "@effect/vitest";
import { Cause, Data, Effect, Exit, Logger, Predicate, Ref, Schema, Tracer } from "effect";
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
import * as TestEmail from "./test";

const makeMessage = (input: Partial<EmailMessageInput> = {}) =>
  EmailMessage.make({
    from: "Sender <sender@example.com>",
    to: "you@example.com",
    subject: "Hello",
    text: "Plain",
    ...input,
  });

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

const captureTelemetry = <A, E, R>(effect: Effect.Effect<A, E, R>) => {
  const spans: Tracer.NativeSpan[] = [];
  const logs: Array<ReturnType<typeof Logger.formatStructured.log>> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const logger = Logger.make<unknown, void>((options) => {
    logs.push(Logger.formatStructured.log(options));
  });
  return effect.pipe(
    Effect.provideService(Tracer.Tracer, tracer),
    Effect.provide(Logger.layer([logger])),
    Effect.exit,
    Effect.map((exit) => ({ exit, logs, spans })),
  );
};

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

  it.effect("creates one public send span with only low-cardinality outcome attributes", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage({ to: ["one@example.com", "two@example.com"] });
      const cases = [
        {
          email: Email.layer({
            policy: SendPolicy.defaultLayer,
            send: () => Effect.succeed({ provider: "test", messageId: "receipt-private-id" }),
          }),
          expected: {
            "effect_email.provider": "test",
            "effect_email.outcome": "accepted",
          },
        },
        {
          email: Email.layer({
            policy: SendPolicy.defaultLayer,
            send: () =>
              Effect.fail(
                new RejectedMessageFailure({
                  provider: "test",
                  metadata: { status: 422 },
                  disposition: "permanent",
                  retryable: false,
                }),
              ),
          }),
          expected: {
            "effect_email.provider": "test",
            "effect_email.outcome": "permanent_failure",
            "effect_email.failure_type": "RejectedMessageFailure",
            "http.response.status_code": 422,
          },
        },
        {
          email: Email.layer({
            policy: SendPolicy.defaultLayer,
            send: () =>
              Effect.fail(
                new RateLimitFailure({
                  provider: "test",
                  metadata: { status: 429 },
                  disposition: "retryable",
                  retryable: true,
                }),
              ),
          }),
          expected: {
            "effect_email.provider": "test",
            "effect_email.outcome": "retryable_failure",
            "effect_email.failure_type": "RateLimitFailure",
            "http.response.status_code": 429,
          },
        },
        {
          email: Email.layer({
            policy: SendPolicy.defaultLayer,
            send: () =>
              Effect.fail(
                new AmbiguousSendFailure({
                  provider: "test",
                  metadata: { status: 202 },
                  disposition: "ambiguous",
                  retryable: false,
                }),
              ),
          }),
          expected: {
            "effect_email.provider": "test",
            "effect_email.outcome": "ambiguous_failure",
            "effect_email.failure_type": "AmbiguousSendFailure",
            "http.response.status_code": 202,
          },
        },
        {
          email: Email.layer({
            policy: SendPolicy.layer({ maxRecipients: 1 }),
            send: () => Effect.succeed({ provider: "test", messageId: "not-sent" }),
          }),
          expected: {
            "effect_email.outcome": "permanent_failure",
            "effect_email.failure_type": "SendPolicyViolation",
          },
        },
      ];

      for (const telemetryCase of cases) {
        const capture = yield* captureTelemetry(telemetryCase.email.send(message));
        const sdkSpans = capture.spans.filter((span) => span.name === "effect-email.send");
        assert.strictEqual(sdkSpans.length, 1);
        assert.deepStrictEqual(
          Object.fromEntries(sdkSpans[0]?.attributes ?? []),
          telemetryCase.expected,
        );
      }
    }),
  );

  it.effect("does not author Email PII, secrets, or high-cardinality identifiers", () =>
    Effect.gen(function* () {
      const attachmentContent = new TextEncoder().encode("attachment-private-content");
      const message = yield* makeMessage({
        from: "Private Sender <private-sender@example.com>",
        to: "private-to@example.com",
        cc: "private-cc@example.com",
        bcc: "private-bcc@example.com",
        replyTo: "private-reply@example.com",
        subject: "private-subject",
        text: "private-text-body",
        html: "<p>private-html-body</p>",
        headers: { "X-Private-Header": "private-header-value" },
        attachments: {
          name: "private-attachment.txt",
          mediaType: "text/plain",
          content: attachmentContent,
          contentId: "private-content@example.com",
        },
      });
      const options = yield* SendOptions.make({ idempotencyKey: "private-idempotency-key" });
      const providerSecret = "private-provider-secret";
      const providerPayload = "private-provider-payload";
      const accepted = Email.layer({
        policy: SendPolicy.defaultLayer,
        send: () =>
          Effect.sync(() => providerSecret.length + providerPayload.length).pipe(
            Effect.as({ provider: "test", messageId: "private-receipt-id" }),
          ),
      });
      const failed = Email.layer({
        policy: SendPolicy.defaultLayer,
        send: () =>
          Effect.fail(
            new RateLimitFailure({
              provider: "test",
              metadata: {
                status: 429,
                retryAfter: RetryAfterVariants.DelaySeconds({ seconds: 37 }),
                requestId: "private-request-id",
              },
              disposition: "retryable",
              retryable: true,
            }),
          ),
      });

      const acceptedCapture = yield* captureTelemetry(accepted.send(message, options));
      const failedCapture = yield* captureTelemetry(failed.send(message, options));
      const authoredTelemetry = JSON.stringify({
        attributes: [...acceptedCapture.spans, ...failedCapture.spans].map((span) => [
          ...span.attributes,
        ]),
        events: [...acceptedCapture.spans, ...failedCapture.spans].flatMap((span) => span.events),
        logs: [...acceptedCapture.logs, ...failedCapture.logs],
      });
      const forbiddenValues = [
        "Private Sender",
        "private-sender@example.com",
        "private-to@example.com",
        "private-cc@example.com",
        "private-bcc@example.com",
        "private-reply@example.com",
        "private-subject",
        "private-text-body",
        "private-html-body",
        "X-Private-Header",
        "private-header-value",
        "private-attachment.txt",
        "private-content@example.com",
        "private-idempotency-key",
        "private-receipt-id",
        "private-request-id",
        providerSecret,
        providerPayload,
        Array.from(attachmentContent).join(","),
      ];

      assert.deepStrictEqual(acceptedCapture.logs, []);
      assert.deepStrictEqual(failedCapture.logs, []);
      for (const forbiddenValue of forbiddenValues) {
        assert.ok(!authoredTelemetry.includes(forbiddenValue));
      }
    }),
  );

  it.effect("preserves defect and interruption span termination without invented outcomes", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      const cases = [
        {
          email: Email.layer({
            policy: SendPolicy.defaultLayer,
            send: () => Effect.failCause(Cause.die("adapter defect")),
          }),
          hasExpectedCause: Exit.hasDies,
        },
        {
          email: Email.layer({
            policy: SendPolicy.defaultLayer,
            send: () => Effect.interrupt,
          }),
          hasExpectedCause: Exit.hasInterrupts,
        },
      ];

      for (const telemetryCase of cases) {
        const capture = yield* captureTelemetry(telemetryCase.email.send(message));
        const sdkSpans = capture.spans.filter((span) => span.name === "effect-email.send");
        assert.strictEqual(sdkSpans.length, 1);
        const span = sdkSpans[0];
        assert.ok(span);
        assert.ok(Predicate.isTagged(span.status, "Ended"));
        if (Predicate.isTagged(span.status, "Ended")) {
          assert.ok(telemetryCase.hasExpectedCause(span.status.exit));
        }
        assert.deepStrictEqual(Object.fromEntries(span.attributes), {});
        assert.deepStrictEqual(capture.logs, []);
      }
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
