import { assert, describe, it } from "@effect/vitest";
import { Data, Effect, Layer, Predicate } from "effect";
import {
  AmbiguousSendFailure,
  Email,
  EmailHeaders,
  EmailMessage,
  RateLimitFailure,
  RejectedMessageFailure,
  RetryAfter,
  SendOptions,
  SendPolicy,
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

const RetryAfterVariants = Data.taggedEnum<RetryAfter>();

const headerValues = (headers: EmailHeadersShape | undefined) => {
  assert.ok(headers);
  return EmailHeaders.toReadonlyArray(headers);
};

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
