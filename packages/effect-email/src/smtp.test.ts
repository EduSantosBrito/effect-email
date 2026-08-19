import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Layer, Predicate, Redacted, Ref, Schema } from "effect";
import { Email, SendOptions, SendPolicy } from "./index";
import * as Smtp from "./smtp";
import { makeMessage } from "./test-fixtures";

const throwUnexpectedDefect = Schema.decodeUnknownSync(Schema.Never);

const provideSmtp = (
  transporter: Parameters<typeof Smtp.SmtpClient.layer>[0]["transporter"],
  policy: Layer.Layer<SendPolicy> = Layer.succeed(SendPolicy)(SendPolicy.defaultLayer),
): Layer.Layer<Email> =>
  Smtp.layer.pipe(
    Layer.provide(Layer.succeed(Smtp.SmtpClient)(Smtp.SmtpClient.layer({ transporter }))),
    Layer.provide(policy),
  );

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

  it.effect("accepts Send Options without adding SMTP idempotency semantics", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<readonly unknown[]>([]);
      const transporter = {
        sendMail: (mail: unknown) =>
          Ref.update(seen, (messages) => [...messages, mail]).pipe(
            Effect.as({ messageId: "<smtp-id@example.com>" }),
            Effect.runPromise,
          ),
      };
      const message = yield* makeMessage();
      const options = yield* SendOptions.make({ idempotencyKey: "same-attempt-key" });

      yield* Effect.gen(function* () {
        const email = yield* Email;
        yield* email.send(message, options);
        yield* email.send(message, options);
      }).pipe(Effect.provide(provideSmtp(transporter)));

      assert.deepStrictEqual(yield* Ref.get(seen), [
        {
          from: "Sender <sender@example.com>",
          to: ["you@example.com"],
          subject: "Hello",
          text: "Plain",
        },
        {
          from: "Sender <sender@example.com>",
          to: ["you@example.com"],
          subject: "Hello",
          text: "Plain",
        },
      ]);
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

  it.effect("keeps unexpected SMTP client errors in the defect channel", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();

      for (const sendMail of [
        () => throwUnexpectedDefect("unexpected synchronous defect"),
        () => Effect.failCause(Cause.die("unexpected asynchronous defect")).pipe(Effect.runPromise),
        () => Effect.fail({ code: "ERR_ASSERTION" }).pipe(Effect.runPromise),
      ]) {
        const exit = yield* Effect.gen(function* () {
          const email = yield* Email;
          return yield* email.send(message);
        }).pipe(Effect.provide(provideSmtp({ sendMail })), Effect.exit);

        assert.ok(Exit.hasDies(exit));
      }
    }),
  );

  it.effect("preserves interruption while an SMTP send is pending", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      const pending = new Promise<never>(() => undefined);
      const send = Effect.gen(function* () {
        const email = yield* Email;
        return yield* email.send(message);
      }).pipe(Effect.provide(provideSmtp({ sendMail: () => pending })));

      const fiber = yield* Effect.forkChild(send);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.join(fiber).pipe(Effect.exit);

      assert.ok(Exit.hasInterrupts(exit));
    }),
  );

  it.effect("classifies SMTP failures through send", () =>
    Effect.gen(function* () {
      const message = yield* makeMessage();
      const cases: ReadonlyArray<readonly [unknown, string, boolean]> = [
        [{ code: "EAUTH" }, "AuthenticationFailure", false],
        [{ responseCode: 535 }, "AuthenticationFailure", false],
        [{ responseCode: 450 }, "TransportUnavailableFailure", true],
        [{ responseCode: 550 }, "RejectedMessageFailure", false],
        [{ code: "ESOCKET", command: "EHLO" }, "TransportUnavailableFailure", true],
        [{ code: "ECONNECTION", command: "MAIL FROM" }, "TransportUnavailableFailure", true],
        [{ code: "ETLS", command: "STARTTLS" }, "TransportUnavailableFailure", true],
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

      for (const error of [
        { code: "ETIMEDOUT", command: "CONN" },
        { code: "ESOCKET", command: "CONN" },
        { code: "ECONNECTION", command: "CONN" },
        { code: "ETLS", command: "CONN" },
        { code: "ETIMEDOUT", command: "DATA" },
        { code: "EMESSAGE", command: "DATA" },
        { code: "ETIMEDOUT", command: "VERIFY" },
        { code: "ETIMEDOUT" },
      ]) {
        const transporter = {
          sendMail: () => Effect.fail(error).pipe(Effect.runPromise),
        };
        const failure = yield* Effect.gen(function* () {
          const email = yield* Email;
          return yield* email.send(message);
        }).pipe(Effect.provide(provideSmtp(transporter)), Effect.flip);

        assert.ok(Predicate.isTagged(failure, "AmbiguousSendFailure"));
        assert.strictEqual(failure.provider, "smtp");
        assert.strictEqual(failure.disposition, "ambiguous");
        assert.strictEqual(failure.retryable, false);
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

        assert.ok(Predicate.isTagged(failure, "AmbiguousSendFailure"));
        assert.strictEqual(failure.provider, "smtp");
        assert.strictEqual(failure.retryable, false);
        assert.strictEqual(failure.disposition, "ambiguous");
      }
    }),
  );
});
