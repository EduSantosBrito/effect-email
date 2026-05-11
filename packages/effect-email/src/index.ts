import { Config, Context, Data, Effect, Layer, Redacted, Ref, Schema } from "effect";

export const EmailAddress = Schema.String.pipe(Schema.brand("EmailAddress"));
export type EmailAddress = typeof EmailAddress.Type;
export const DisplayName = Schema.String.pipe(Schema.brand("DisplayName"));
export type DisplayName = typeof DisplayName.Type;
export const MediaType = Schema.String.pipe(Schema.brand("MediaType"));
export type MediaType = typeof MediaType.Type;

export interface Mailbox {
  readonly address: EmailAddress;
  readonly displayName?: DisplayName;
}

export interface RecipientLists {
  readonly to: readonly Mailbox[];
  readonly cc?: readonly Mailbox[];
  readonly bcc?: readonly Mailbox[];
}

export interface Attachment {
  readonly name: string;
  readonly mediaType: MediaType;
  readonly content: Uint8Array;
}

export type MessageBody = Data.TaggedEnum<{
  TextOnly: { readonly text: string };
  HtmlOnly: { readonly html: string };
  TextAndHtml: { readonly text: string; readonly html: string };
}>;
export const MessageBody = Data.taggedEnum<MessageBody>();

export interface EmailMessage {
  readonly from: Mailbox;
  readonly to: readonly Mailbox[];
  readonly cc?: readonly Mailbox[];
  readonly bcc?: readonly Mailbox[];
  readonly replyTo?: readonly Mailbox[];
  readonly subject: string;
  readonly body: MessageBody;
  readonly attachments?: readonly Attachment[];
}

export interface SendReceipt {
  readonly provider: "test" | "resend";
  readonly messageId: string;
}

export class MailboxValidationFailure extends Schema.TaggedErrorClass<MailboxValidationFailure>()(
  "MailboxValidationFailure",
  {
    reason: Schema.Literals([
      "InvalidEmailAddress",
      "InvalidDisplayName",
      "EmptyRecipients",
      "DuplicateRecipient",
    ]),
  },
) {}

export class MessageContentValidationFailure extends Schema.TaggedErrorClass<MessageContentValidationFailure>()(
  "MessageContentValidationFailure",
  {
    reason: Schema.Literals([
      "InvalidSubject",
      "EmptyBody",
      "InvalidAttachmentName",
      "InvalidMediaType",
      "InvalidAttachmentContent",
    ]),
  },
) {}

export class SendPolicyViolation extends Schema.TaggedErrorClass<SendPolicyViolation>()(
  "SendPolicyViolation",
  {
    reason: Schema.Literals([
      "TooManyRecipients",
      "EmptyRecipients",
      "EmptyBody",
      "SubjectTooLarge",
      "TextBodyTooLarge",
      "HtmlBodyTooLarge",
      "TooManyAttachments",
      "AttachmentTooLarge",
      "TotalAttachmentsTooLarge",
    ]),
    limit: Schema.Number,
    retryable: Schema.Literal(false),
  },
) {}

export class AuthenticationFailure extends Schema.TaggedErrorClass<AuthenticationFailure>()(
  "AuthenticationFailure",
  { provider: Schema.Literal("resend"), retryable: Schema.Literal(false) },
) {}

export class RateLimitFailure extends Schema.TaggedErrorClass<RateLimitFailure>()(
  "RateLimitFailure",
  { provider: Schema.Literal("resend"), retryable: Schema.Literal(true) },
) {}

export class RejectedMessageFailure extends Schema.TaggedErrorClass<RejectedMessageFailure>()(
  "RejectedMessageFailure",
  { provider: Schema.Literal("resend"), retryable: Schema.Literal(false) },
) {}

export class TransportUnavailableFailure extends Schema.TaggedErrorClass<TransportUnavailableFailure>()(
  "TransportUnavailableFailure",
  { provider: Schema.Literal("resend"), retryable: Schema.Literal(true) },
) {}

export class ProviderProtocolFailure extends Schema.TaggedErrorClass<ProviderProtocolFailure>()(
  "ProviderProtocolFailure",
  { provider: Schema.Literal("resend"), retryable: Schema.Literal(false) },
) {}

export type SendFailure =
  | SendPolicyViolation
  | AuthenticationFailure
  | RateLimitFailure
  | RejectedMessageFailure
  | TransportUnavailableFailure
  | ProviderProtocolFailure;

export interface SendPolicy {
  readonly maxRecipients: number;
  readonly maxSubjectBytes: number;
  readonly maxTextBodyBytes: number;
  readonly maxHtmlBodyBytes: number;
  readonly maxAttachments: number;
  readonly maxAttachmentBytes: number;
  readonly maxTotalAttachmentBytes: number;
}

export const defaultSendPolicy: SendPolicy = {
  maxRecipients: 50,
  maxSubjectBytes: 998,
  maxTextBodyBytes: 1_000_000,
  maxHtmlBodyBytes: 1_000_000,
  maxAttachments: 10,
  maxAttachmentBytes: 10_000_000,
  maxTotalAttachmentBytes: 40_000_000,
};

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const hasText = (value: string) => value.trim().length > 0;
const addressPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const mediaTypePattern =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*$/;

const normalizeAddress = (address: string): string => address.toLowerCase();
const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
};

const RawMailbox = Schema.Struct({
  address: Schema.Unknown,
  displayName: Schema.optional(Schema.Unknown),
});
const RawRecipients = Schema.Struct({
  to: Schema.optional(Schema.Array(Schema.Unknown)),
  cc: Schema.optional(Schema.Array(Schema.Unknown)),
  bcc: Schema.optional(Schema.Array(Schema.Unknown)),
});
const RawBody = Schema.Struct({
  text: Schema.optional(Schema.Unknown),
  html: Schema.optional(Schema.Unknown),
});
const RawAttachment = Schema.Struct({
  name: Schema.Unknown,
  mediaType: Schema.Unknown,
  content: Schema.Unknown,
  path: Schema.optional(Schema.Unknown),
  url: Schema.optional(Schema.Unknown),
  base64: Schema.optional(Schema.Unknown),
});
const decodeEmailAddress = Schema.decodeUnknownEffect(EmailAddress);
const decodeDisplayName = Schema.decodeUnknownEffect(DisplayName);
const decodeMediaType = Schema.decodeUnknownEffect(MediaType);
const decodeRawMailbox = Schema.decodeUnknownEffect(RawMailbox);
const decodeRawRecipients = Schema.decodeUnknownEffect(RawRecipients);
const decodeRawBody = Schema.decodeUnknownEffect(RawBody);
const decodeRawAttachment = Schema.decodeUnknownEffect(RawAttachment);

const formatAddress = (mailbox: Mailbox): string =>
  mailbox.displayName === undefined
    ? mailbox.address
    : `${mailbox.displayName} <${mailbox.address}>`;

const bodyHasContent = MessageBody.$match({
  TextOnly: ({ text }) => hasText(text),
  HtmlOnly: ({ html }) => hasText(html),
  TextAndHtml: ({ text, html }) => hasText(text) || hasText(html),
});

const textBodyBytes = MessageBody.$match({
  TextOnly: ({ text }) => utf8Bytes(text),
  HtmlOnly: () => 0,
  TextAndHtml: ({ text }) => utf8Bytes(text),
});

const htmlBodyBytes = MessageBody.$match({
  TextOnly: () => 0,
  HtmlOnly: ({ html }) => utf8Bytes(html),
  TextAndHtml: ({ html }) => utf8Bytes(html),
});

export interface MailboxParserShape {
  readonly emailAddress: (input: unknown) => Effect.Effect<EmailAddress, MailboxValidationFailure>;
  readonly address: (input: unknown) => Effect.Effect<EmailAddress, MailboxValidationFailure>;
  readonly displayName: (input: unknown) => Effect.Effect<DisplayName, MailboxValidationFailure>;
  readonly mailbox: (input: unknown) => Effect.Effect<Mailbox, MailboxValidationFailure>;
  readonly recipients: (input: unknown) => Effect.Effect<RecipientLists, MailboxValidationFailure>;
}

export class MailboxParser extends Context.Service<MailboxParser, MailboxParserShape>()(
  "effect-email/MailboxParser",
) {}

const parseEmailAddress: (input: unknown) => Effect.Effect<EmailAddress, MailboxValidationFailure> =
  Effect.fnUntraced(function* (input) {
    if (
      typeof input !== "string" ||
      input.length > 254 ||
      [...input].some((character) => character.charCodeAt(0) > 127) ||
      input.includes('"') ||
      input.includes("(") ||
      input.includes(")") ||
      !addressPattern.test(input)
    ) {
      return yield* new MailboxValidationFailure({ reason: "InvalidEmailAddress" });
    }
    return yield* decodeEmailAddress(normalizeAddress(input)).pipe(
      Effect.mapError(() => new MailboxValidationFailure({ reason: "InvalidEmailAddress" })),
    );
  });

const mailboxParser: MailboxParserShape = {
  emailAddress: parseEmailAddress,
  address: parseEmailAddress,
  displayName: (input) =>
    Effect.suspend(() => {
      if (
        typeof input !== "string" ||
        input.trim().length === 0 ||
        hasControlCharacter(input) ||
        /[<>,;@]/u.test(input)
      ) {
        return Effect.fail(new MailboxValidationFailure({ reason: "InvalidDisplayName" }));
      }
      return decodeDisplayName(input).pipe(
        Effect.mapError(() => new MailboxValidationFailure({ reason: "InvalidDisplayName" })),
      );
    }),
  mailbox: (input) =>
    Effect.gen(function* () {
      const raw = yield* decodeRawMailbox(input).pipe(
        Effect.mapError(() => new MailboxValidationFailure({ reason: "InvalidEmailAddress" })),
      );
      const address = yield* mailboxParser.emailAddress(raw.address);
      if (raw.displayName === undefined) {
        return { address };
      }
      const displayName = yield* mailboxParser.displayName(raw.displayName);
      return { address, displayName };
    }),
  recipients: (input) =>
    Effect.gen(function* () {
      const raw = yield* decodeRawRecipients(input).pipe(
        Effect.mapError(() => new MailboxValidationFailure({ reason: "EmptyRecipients" })),
      );
      const empty: readonly Mailbox[] = [];
      const decodeList: (
        value: unknown,
      ) => Effect.Effect<readonly Mailbox[], MailboxValidationFailure> = Effect.fnUntraced(
        function* (value) {
          if (value === undefined) return empty;
          if (Array.isArray(value))
            return yield* Effect.all(value.map((entry) => mailboxParser.mailbox(entry)));
          return yield* new MailboxValidationFailure({ reason: "EmptyRecipients" });
        },
      );
      const to = yield* decodeList(raw.to);
      const cc = yield* decodeList(raw.cc);
      const bcc = yield* decodeList(raw.bcc);
      const all = [...to, ...cc, ...bcc];
      if (all.length === 0) {
        return yield* new MailboxValidationFailure({ reason: "EmptyRecipients" });
      }
      const seen = new Set<string>();
      for (const mailbox of all) {
        if (seen.has(mailbox.address)) {
          return yield* new MailboxValidationFailure({ reason: "DuplicateRecipient" });
        }
        seen.add(mailbox.address);
      }
      return { to, ...(cc.length > 0 ? { cc } : {}), ...(bcc.length > 0 ? { bcc } : {}) };
    }),
};

export interface MessageContentParserShape {
  readonly subject: (input: unknown) => Effect.Effect<string, MessageContentValidationFailure>;
  readonly body: (input: unknown) => Effect.Effect<MessageBody, MessageContentValidationFailure>;
  readonly attachment: (
    input: unknown,
  ) => Effect.Effect<Attachment, MessageContentValidationFailure>;
}

export class MessageContentParser extends Context.Service<
  MessageContentParser,
  MessageContentParserShape
>()("effect-email/MessageContentParser") {}

const messageContentParser: MessageContentParserShape = {
  subject: (input) =>
    Effect.gen(function* () {
      if (
        typeof input === "string" &&
        hasText(input) &&
        !input.includes("\r") &&
        !input.includes("\n") &&
        !hasControlCharacter(input)
      ) {
        return input;
      }
      return yield* new MessageContentValidationFailure({ reason: "InvalidSubject" });
    }),
  body: (input) =>
    Effect.gen(function* () {
      const raw = yield* decodeRawBody(input).pipe(
        Effect.mapError(() => new MessageContentValidationFailure({ reason: "EmptyBody" })),
      );
      const text = typeof raw.text === "string" && hasText(raw.text) ? raw.text : undefined;
      const html = typeof raw.html === "string" && hasText(raw.html) ? raw.html : undefined;
      if (text !== undefined && html !== undefined) return MessageBody.TextAndHtml({ text, html });
      if (text !== undefined) return MessageBody.TextOnly({ text });
      if (html !== undefined) return MessageBody.HtmlOnly({ html });
      return yield* new MessageContentValidationFailure({ reason: "EmptyBody" });
    }),
  attachment: (input) =>
    Effect.gen(function* () {
      const raw = yield* decodeRawAttachment(input).pipe(
        Effect.mapError(
          () => new MessageContentValidationFailure({ reason: "InvalidAttachmentContent" }),
        ),
      );
      if (raw.path !== undefined || raw.url !== undefined || raw.base64 !== undefined) {
        return yield* new MessageContentValidationFailure({ reason: "InvalidAttachmentContent" });
      }
      if (
        typeof raw.name !== "string" ||
        !hasText(raw.name) ||
        raw.name.includes("/") ||
        raw.name.includes("\\") ||
        raw.name.includes("..") ||
        hasControlCharacter(raw.name) ||
        /[<>:"|?*]/u.test(raw.name)
      ) {
        return yield* new MessageContentValidationFailure({ reason: "InvalidAttachmentName" });
      }
      if (typeof raw.mediaType !== "string" || !mediaTypePattern.test(raw.mediaType)) {
        return yield* new MessageContentValidationFailure({ reason: "InvalidMediaType" });
      }
      if (!(raw.content instanceof Uint8Array)) {
        return yield* new MessageContentValidationFailure({ reason: "InvalidAttachmentContent" });
      }
      return {
        name: raw.name,
        mediaType: yield* decodeMediaType(raw.mediaType.toLowerCase()).pipe(
          Effect.mapError(
            () => new MessageContentValidationFailure({ reason: "InvalidMediaType" }),
          ),
        ),
        content: raw.content,
      };
    }),
};

export interface SendPolicyServiceShape {
  readonly validate: (message: EmailMessage) => Effect.Effect<EmailMessage, SendPolicyViolation>;
}

export class SendPolicyService extends Context.Service<SendPolicyService, SendPolicyServiceShape>()(
  "effect-email/SendPolicyService",
) {}

const makeSendPolicyService = (policy: SendPolicy): SendPolicyServiceShape => ({
  validate: (message) =>
    Effect.gen(function* () {
      const recipientCount =
        message.to.length + (message.cc?.length ?? 0) + (message.bcc?.length ?? 0);
      if (recipientCount === 0) {
        return yield* new SendPolicyViolation({
          reason: "EmptyRecipients",
          limit: 1,
          retryable: false,
        });
      }
      if (recipientCount > policy.maxRecipients) {
        return yield* new SendPolicyViolation({
          reason: "TooManyRecipients",
          limit: policy.maxRecipients,
          retryable: false,
        });
      }
      if (!bodyHasContent(message.body)) {
        return yield* new SendPolicyViolation({ reason: "EmptyBody", limit: 1, retryable: false });
      }
      if (utf8Bytes(message.subject) > policy.maxSubjectBytes) {
        return yield* new SendPolicyViolation({
          reason: "SubjectTooLarge",
          limit: policy.maxSubjectBytes,
          retryable: false,
        });
      }
      if (textBodyBytes(message.body) > policy.maxTextBodyBytes) {
        return yield* new SendPolicyViolation({
          reason: "TextBodyTooLarge",
          limit: policy.maxTextBodyBytes,
          retryable: false,
        });
      }
      if (htmlBodyBytes(message.body) > policy.maxHtmlBodyBytes) {
        return yield* new SendPolicyViolation({
          reason: "HtmlBodyTooLarge",
          limit: policy.maxHtmlBodyBytes,
          retryable: false,
        });
      }
      const attachments = message.attachments ?? [];
      if (attachments.length > policy.maxAttachments) {
        return yield* new SendPolicyViolation({
          reason: "TooManyAttachments",
          limit: policy.maxAttachments,
          retryable: false,
        });
      }
      let total = 0;
      for (const attachment of attachments) {
        if (attachment.content.byteLength > policy.maxAttachmentBytes) {
          return yield* new SendPolicyViolation({
            reason: "AttachmentTooLarge",
            limit: policy.maxAttachmentBytes,
            retryable: false,
          });
        }
        total += attachment.content.byteLength;
      }
      if (total > policy.maxTotalAttachmentBytes) {
        return yield* new SendPolicyViolation({
          reason: "TotalAttachmentsTooLarge",
          limit: policy.maxTotalAttachmentBytes,
          retryable: false,
        });
      }
      return message;
    }),
});

export interface EmailShape {
  readonly send: (message: EmailMessage) => Effect.Effect<SendReceipt, SendFailure>;
}

export class Email extends Context.Service<Email, EmailShape>()("effect-email/Email") {}

export const parserLayer = Layer.mergeAll(
  Layer.succeed(MailboxParser)(mailboxParser),
  Layer.succeed(MessageContentParser)(messageContentParser),
);

export const policyLayer = (policy: SendPolicy): Layer.Layer<SendPolicyService> =>
  Layer.succeed(SendPolicyService)(makeSendPolicyService(policy));

export const defaultPolicyLayer = policyLayer(defaultSendPolicy);

export interface TestEmailInspectionShape {
  readonly sent: Effect.Effect<readonly EmailMessage[]>;
  readonly takeSent: Effect.Effect<readonly EmailMessage[]>;
  readonly clear: Effect.Effect<void>;
  readonly record: (message: EmailMessage) => Effect.Effect<void>;
}

export class TestEmailInspection extends Context.Service<
  TestEmailInspection,
  TestEmailInspectionShape
>()("effect-email/TestEmailInspection") {}

export class TestEmailAdapter extends Context.Service<TestEmailAdapter, EmailShape>()(
  "effect-email/TestEmailAdapter",
) {}

const makeTestInspection = (state: Ref.Ref<readonly EmailMessage[]>): TestEmailInspectionShape => ({
  sent: Ref.get(state),
  takeSent: Ref.getAndSet(state, []),
  clear: Ref.set(state, []),
  record: (message) => Ref.update(state, (messages) => [...messages, message]),
});

const testInspectionLayer = Layer.effect(TestEmailInspection)(
  Ref.make<readonly EmailMessage[]>([]).pipe(Effect.map(makeTestInspection)),
);

const testEmailLayer = Layer.effect(Email)(
  Effect.gen(function* () {
    const inspection = yield* TestEmailInspection;
    const policy = yield* SendPolicyService;
    return {
      send: (message) =>
        policy.validate(message).pipe(
          Effect.tap((accepted) => inspection.record(accepted)),
          Effect.as({ provider: "test", messageId: "test-message" } satisfies SendReceipt),
        ),
    };
  }),
);

export const testLayer: Layer.Layer<Email | TestEmailInspection, never, SendPolicyService> =
  testEmailLayer.pipe(Layer.provideMerge(testInspectionLayer));

export const defaultTestLayer: Layer.Layer<Email | TestEmailInspection | SendPolicyService> =
  testLayer.pipe(Layer.provideMerge(defaultPolicyLayer));

export interface ResendConfig {
  readonly apiKey: Redacted.Redacted<string>;
}

export const resendConfig: Config.Config<ResendConfig> = Config.map(
  Config.nonEmptyString("RESEND_API_KEY"),
  (apiKey) => ({
    apiKey: Redacted.make(apiKey),
  }),
);

export const unsafeFormatMailboxForAdapter = formatAddress;
export const unsafeRedactedValueForAdapter = Redacted.value;
