import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer, Redacted, Ref, Result, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import {
  Email,
  MailboxParser,
  MessageContentParser,
  SendPolicyService,
  defaultSendPolicy,
  defaultPolicyLayer,
  parserLayer,
  policyLayer,
  testLayer,
} from "./index";
import * as Resend from "./resend";
import { TestEmailInspection, layer as testSubpathLayer } from "./test";

const parsedMessage = Effect.gen(function* () {
  const mailbox = yield* MailboxParser;
  const content = yield* MessageContentParser;
  const from = yield* mailbox.mailbox({ address: "sender@example.com", displayName: "Sender" });
  const recipients = yield* mailbox.recipients({
    to: [{ address: "you@example.com" }],
    cc: [{ address: "cc@example.com" }],
    bcc: [{ address: "bcc@example.com" }],
  });
  const replyTo = yield* mailbox.mailbox({ address: "reply@example.com" });
  const subject = yield* content.subject("Hello");
  const body = yield* content.body({ text: "Plain", html: "<strong>Plain</strong>" });
  const attachment = yield* content.attachment({
    name: "report.txt",
    mediaType: "text/plain",
    content: new Uint8Array([104, 105]),
  });
  return { from, ...recipients, replyTo: [replyTo], subject, body, attachments: [attachment] };
}).pipe(Effect.provide(parserLayer));

describe("effect-email core", () => {
  it.effect("parses strict mailboxes and rejects unsafe recipient lists", () =>
    Effect.gen(function* () {
      const mailbox = yield* MailboxParser;
      const valid = yield* mailbox.mailbox({
        address: "Jane.Doe+test@Example.COM",
        displayName: "Jane Doe",
      });
      assert.strictEqual(valid.address, "jane.doe+test@example.com");
      assert.strictEqual(
        (yield* mailbox.mailbox({ address: "bad(comment)@example.com" }).pipe(Effect.exit))._tag,
        "Failure",
      );
      assert.strictEqual(
        (yield* mailbox.mailbox({ address: "jane@例.com" }).pipe(Effect.exit))._tag,
        "Failure",
      );
      assert.strictEqual(
        (yield* mailbox.mailbox({ address: '"jane"@example.com' }).pipe(Effect.exit))._tag,
        "Failure",
      );
      assert.strictEqual(
        (yield* mailbox
          .mailbox({ address: "jane@example.com", displayName: "Jane <jane>" })
          .pipe(Effect.exit))._tag,
        "Failure",
      );
      assert.strictEqual((yield* mailbox.recipients({ to: [] }).pipe(Effect.exit))._tag, "Failure");
      assert.strictEqual(
        (yield* mailbox
          .recipients({ to: [{ address: "a@example.com" }], cc: [{ address: "A@example.com" }] })
          .pipe(Effect.exit))._tag,
        "Failure",
      );
    }).pipe(Effect.provide(parserLayer)),
  );

  it.effect("parses body variants and preserves caller-owned html", () =>
    Effect.gen(function* () {
      const content = yield* MessageContentParser;
      assert.deepStrictEqual(yield* content.body({ text: "Text" }), {
        _tag: "TextOnly",
        text: "Text",
      });
      assert.deepStrictEqual(yield* content.body({ html: "<p>x</p>" }), {
        _tag: "HtmlOnly",
        html: "<p>x</p>",
      });
      assert.deepStrictEqual(yield* content.body({ text: "Text", html: "<p>x</p>" }), {
        _tag: "TextAndHtml",
        text: "Text",
        html: "<p>x</p>",
      });
      assert.strictEqual((yield* content.body({ text: " " }).pipe(Effect.exit))._tag, "Failure");
    }).pipe(Effect.provide(parserLayer)),
  );

  it.effect("parses attachment bytes and rejects unsafe attachment authority", () =>
    Effect.gen(function* () {
      const content = yield* MessageContentParser;
      const attachment = yield* content.attachment({
        name: "safe.pdf",
        mediaType: "application/pdf",
        content: new Uint8Array([1]),
      });
      assert.strictEqual(attachment.content.byteLength, 1);
      for (const input of [
        { name: "../x", mediaType: "text/plain", content: new Uint8Array() },
        { name: "x", mediaType: "not-a-type", content: new Uint8Array() },
        { name: "x", mediaType: "text/plain", path: "/tmp/x", content: new Uint8Array() },
        {
          name: "x",
          mediaType: "text/plain",
          url: "https://example.com/x",
          content: new Uint8Array(),
        },
        { name: "x", mediaType: "text/plain", base64: "aGk=", content: "aGk=" },
      ]) {
        assert.strictEqual((yield* content.attachment(input).pipe(Effect.exit))._tag, "Failure");
      }
    }).pipe(Effect.provide(parserLayer)),
  );

  it.effect("sends through scoped test layer and does not leak global state", () =>
    Effect.gen(function* () {
      const message = yield* parsedMessage;
      const program = Effect.gen(function* () {
        const email = yield* Email;
        const inspection = yield* TestEmailInspection;
        const receipt = yield* email.send(message);
        const sent = yield* inspection.sent;
        assert.deepStrictEqual(receipt, { provider: "test", messageId: "test-message" });
        assert.strictEqual(sent.length, 1);
      });
      yield* program.pipe(Effect.provide(testLayer));
      yield* Effect.gen(function* () {
        const inspection = yield* TestEmailInspection;
        assert.deepStrictEqual(yield* inspection.sent, []);
      }).pipe(Effect.provide(testSubpathLayer));
    }),
  );

  it.effect("enforces default and custom send policies before recording", () =>
    Effect.gen(function* () {
      const message = yield* parsedMessage;
      const validateWith = (policy: Parameters<typeof policyLayer>[0], candidate = message) =>
        Effect.gen(function* () {
          const service = yield* SendPolicyService;
          return yield* service.validate(candidate).pipe(
            Effect.flip,
            Effect.map((failure) => failure.reason),
          );
        }).pipe(Effect.provide(policyLayer(policy)));
      assert.strictEqual(
        yield* validateWith({ ...defaultSendPolicy, maxRecipients: 1 }),
        "TooManyRecipients",
      );
      assert.strictEqual(
        yield* validateWith({ ...defaultSendPolicy, maxSubjectBytes: 1 }),
        "SubjectTooLarge",
      );
      assert.strictEqual(
        yield* validateWith({ ...defaultSendPolicy, maxTextBodyBytes: 1 }),
        "TextBodyTooLarge",
      );
      assert.strictEqual(
        yield* validateWith({ ...defaultSendPolicy, maxHtmlBodyBytes: 1 }),
        "HtmlBodyTooLarge",
      );
      assert.strictEqual(
        yield* validateWith({ ...defaultSendPolicy, maxAttachments: 0 }),
        "TooManyAttachments",
      );
      assert.strictEqual(
        yield* validateWith({ ...defaultSendPolicy, maxAttachmentBytes: 1 }),
        "AttachmentTooLarge",
      );
      assert.strictEqual(
        yield* validateWith({ ...defaultSendPolicy, maxTotalAttachmentBytes: 1 }),
        "TotalAttachmentsTooLarge",
      );
      assert.strictEqual(
        yield* validateWith(defaultSendPolicy, { ...message, to: [], cc: [], bcc: [] }),
        "EmptyRecipients",
      );
      assert.strictEqual(
        yield* validateWith(defaultSendPolicy, {
          ...message,
          body: { _tag: "TextOnly", text: "" },
        }),
        "EmptyBody",
      );
      yield* Effect.gen(function* () {
        const policy = yield* SendPolicyService;
        assert.deepStrictEqual(yield* policy.validate(message), message);
      }).pipe(Effect.provide(defaultPolicyLayer));
      yield* Effect.gen(function* () {
        const email = yield* Email;
        const inspection = yield* TestEmailInspection;
        assert.strictEqual(
          (yield* email.send({ ...message, to: [], cc: [], bcc: [] }).pipe(Effect.exit))._tag,
          "Failure",
        );
        assert.deepStrictEqual(yield* inspection.sent, []);
      }).pipe(Effect.provide(testLayer));
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
          const web = yield* Effect.sync(() => {
            const result = HttpClientRequest.toWebResult(request);
            if (Result.isFailure(result)) {
              throw result.failure;
            }
            return result.success;
          });
          yield* Ref.set(seen, web);
          return HttpClientResponse.fromWeb(
            request,
            new Response('{"id":"resend-id"}', { status: 200 }),
          );
        }),
      );
      const message = yield* parsedMessage;
      const receipt = yield* Effect.gen(function* () {
        const email = yield* Email;
        return yield* email.send(message);
      }).pipe(
        Effect.provide(
          Resend.layer(Resend.makeConfig("secret")).pipe(
            Layer.provide(Layer.succeed(HttpClient.HttpClient)(client)),
          ),
        ),
      );
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

  it.effect("classifies safe failures and does not expose raw provider body or secrets", () =>
    Effect.gen(function* () {
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
        const message = yield* parsedMessage;
        const exit = yield* Effect.gen(function* () {
          const email = yield* Email;
          return yield* email.send(message);
        }).pipe(
          Effect.provide(
            Resend.layer(Resend.makeConfig("super-secret")).pipe(
              Layer.provide(Layer.succeed(HttpClient.HttpClient)(client)),
            ),
          ),
          Effect.exit,
        );
        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const rendered = String(exit.cause);
          assert.ok(rendered.includes(tag));
          assert.ok(!rendered.includes("sender@example.com"));
          assert.ok(!rendered.includes("super-secret"));
          assert.ok(!rendered.includes("report.txt"));
        }
      }
    }),
  );

  it.effect("loads redacted config and fails safely for empty config", () =>
    Effect.gen(function* () {
      const config = yield* Resend.config
        .asEffect()
        .pipe(
          Effect.provide(
            ConfigProvider.layer(ConfigProvider.fromEnv({ env: { RESEND_API_KEY: "secret" } })),
          ),
        );
      assert.deepStrictEqual(config.apiKey, Redacted.make("secret"));
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
