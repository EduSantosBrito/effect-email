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

export type MessageBody =
  | { readonly _tag: "TextOnly"; readonly text: string }
  | { readonly _tag: "HtmlOnly"; readonly html: string }
  | { readonly _tag: "TextAndHtml"; readonly text: string; readonly html: string };

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

export class MailboxValidationFailure extends Data.TaggedError("MailboxValidationFailure")<{
  readonly reason:
    | "InvalidEmailAddress"
    | "InvalidDisplayName"
    | "EmptyRecipients"
    | "DuplicateRecipient";
}> {}

export class MessageContentValidationFailure extends Data.TaggedError(
  "MessageContentValidationFailure",
)<{
  readonly reason:
    | "InvalidSubject"
    | "EmptyBody"
    | "InvalidAttachmentName"
    | "InvalidMediaType"
    | "InvalidAttachmentContent";
}> {}

export class SendPolicyViolation extends Data.TaggedError("SendPolicyViolation")<{
  readonly reason:
    | "TooManyRecipients"
    | "EmptyRecipients"
    | "EmptyBody"
    | "SubjectTooLarge"
    | "TextBodyTooLarge"
    | "HtmlBodyTooLarge"
    | "TooManyAttachments"
    | "AttachmentTooLarge"
    | "TotalAttachmentsTooLarge";
  readonly limit: number;
  readonly retryable: false;
}> {}

export class AuthenticationFailure extends Data.TaggedError("AuthenticationFailure")<{
  readonly provider: "resend";
  readonly retryable: false;
}> {}

export class RateLimitFailure extends Data.TaggedError("RateLimitFailure")<{
  readonly provider: "resend";
  readonly retryable: true;
}> {}

export class RejectedMessageFailure extends Data.TaggedError("RejectedMessageFailure")<{
  readonly provider: "resend";
  readonly retryable: false;
}> {}

export class TransportUnavailableFailure extends Data.TaggedError("TransportUnavailableFailure")<{
  readonly provider: "resend";
  readonly retryable: true;
}> {}

export class ProviderProtocolFailure extends Data.TaggedError("ProviderProtocolFailure")<{
  readonly provider: "resend";
  readonly retryable: false;
}> {}

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
const getProperty = (input: object, key: string): unknown => Reflect.get(input, key);

const formatAddress = (mailbox: Mailbox): string =>
  mailbox.displayName === undefined
    ? mailbox.address
    : `${mailbox.displayName} <${mailbox.address}>`;

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

const parseEmailAddress = (input: unknown): Effect.Effect<EmailAddress, MailboxValidationFailure> =>
  Effect.suspend(() => {
    if (
      typeof input !== "string" ||
      input.length > 254 ||
      [...input].some((character) => character.charCodeAt(0) > 127) ||
      input.includes('"') ||
      input.includes("(") ||
      input.includes(")") ||
      !addressPattern.test(input)
    ) {
      return Effect.fail(new MailboxValidationFailure({ reason: "InvalidEmailAddress" }));
    }
    return Schema.decodeUnknownEffect(EmailAddress)(normalizeAddress(input)).pipe(
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
      return Schema.decodeUnknownEffect(DisplayName)(input).pipe(
        Effect.mapError(() => new MailboxValidationFailure({ reason: "InvalidDisplayName" })),
      );
    }),
  mailbox: (input) =>
    Effect.gen(function* () {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return yield* new MailboxValidationFailure({ reason: "InvalidEmailAddress" });
      }
      const addressInput = getProperty(input, "address");
      const displayNameInput = getProperty(input, "displayName");
      const address = yield* mailboxParser.emailAddress(addressInput);
      if (displayNameInput === undefined) {
        return { address };
      }
      const displayName = yield* mailboxParser.displayName(displayNameInput);
      return { address, displayName };
    }),
  recipients: (input) =>
    Effect.gen(function* () {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return yield* new MailboxValidationFailure({ reason: "EmptyRecipients" });
      }
      const empty: readonly Mailbox[] = [];
      const decodeList = (value: unknown) =>
        value === undefined
          ? Effect.succeed(empty)
          : Array.isArray(value)
            ? Effect.all(value.map((entry) => mailboxParser.mailbox(entry)))
            : Effect.fail(new MailboxValidationFailure({ reason: "EmptyRecipients" }));
      const to = yield* decodeList(getProperty(input, "to"));
      const cc = yield* decodeList(getProperty(input, "cc"));
      const bcc = yield* decodeList(getProperty(input, "bcc"));
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
    typeof input === "string" &&
    hasText(input) &&
    !input.includes("\r") &&
    !input.includes("\n") &&
    !hasControlCharacter(input)
      ? Effect.succeed(input)
      : Effect.fail(new MessageContentValidationFailure({ reason: "InvalidSubject" })),
  body: (input) =>
    Effect.gen(function* () {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return yield* new MessageContentValidationFailure({ reason: "EmptyBody" });
      }
      const textInput = getProperty(input, "text");
      const htmlInput = getProperty(input, "html");
      const text = typeof textInput === "string" && hasText(textInput) ? textInput : undefined;
      const html = typeof htmlInput === "string" && hasText(htmlInput) ? htmlInput : undefined;
      if (text !== undefined && html !== undefined) return { _tag: "TextAndHtml", text, html };
      if (text !== undefined) return { _tag: "TextOnly", text };
      if (html !== undefined) return { _tag: "HtmlOnly", html };
      return yield* new MessageContentValidationFailure({ reason: "EmptyBody" });
    }),
  attachment: (input) =>
    Effect.gen(function* () {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return yield* new MessageContentValidationFailure({ reason: "InvalidAttachmentContent" });
      }
      const name = getProperty(input, "name");
      const mediaType = getProperty(input, "mediaType");
      const content = getProperty(input, "content");
      if (
        getProperty(input, "path") !== undefined ||
        getProperty(input, "url") !== undefined ||
        getProperty(input, "base64") !== undefined
      ) {
        return yield* new MessageContentValidationFailure({ reason: "InvalidAttachmentContent" });
      }
      if (
        typeof name !== "string" ||
        !hasText(name) ||
        name.includes("/") ||
        name.includes("\\") ||
        name.includes("..") ||
        hasControlCharacter(name) ||
        /[<>:"|?*]/u.test(name)
      ) {
        return yield* new MessageContentValidationFailure({ reason: "InvalidAttachmentName" });
      }
      if (typeof mediaType !== "string" || !mediaTypePattern.test(mediaType)) {
        return yield* new MessageContentValidationFailure({ reason: "InvalidMediaType" });
      }
      if (!(content instanceof Uint8Array)) {
        return yield* new MessageContentValidationFailure({ reason: "InvalidAttachmentContent" });
      }
      return {
        name,
        mediaType: yield* Schema.decodeUnknownEffect(MediaType)(mediaType.toLowerCase()).pipe(
          Effect.mapError(
            () => new MessageContentValidationFailure({ reason: "InvalidMediaType" }),
          ),
        ),
        content,
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
      if (
        (message.body._tag === "TextOnly" && !hasText(message.body.text)) ||
        (message.body._tag === "HtmlOnly" && !hasText(message.body.html)) ||
        (message.body._tag === "TextAndHtml" &&
          !hasText(message.body.text) &&
          !hasText(message.body.html))
      ) {
        return yield* new SendPolicyViolation({ reason: "EmptyBody", limit: 1, retryable: false });
      }
      if (utf8Bytes(message.subject) > policy.maxSubjectBytes) {
        return yield* new SendPolicyViolation({
          reason: "SubjectTooLarge",
          limit: policy.maxSubjectBytes,
          retryable: false,
        });
      }
      if (
        (message.body._tag === "TextOnly" || message.body._tag === "TextAndHtml") &&
        utf8Bytes(message.body.text) > policy.maxTextBodyBytes
      ) {
        return yield* new SendPolicyViolation({
          reason: "TextBodyTooLarge",
          limit: policy.maxTextBodyBytes,
          retryable: false,
        });
      }
      if (
        (message.body._tag === "HtmlOnly" || message.body._tag === "TextAndHtml") &&
        utf8Bytes(message.body.html) > policy.maxHtmlBodyBytes
      ) {
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
