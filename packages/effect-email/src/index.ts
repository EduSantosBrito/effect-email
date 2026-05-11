import { Context, Data, Effect, Match, Option, Schema } from "effect";

const addressPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const mediaTypePattern =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*$/;
const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const forbiddenHeaderNames = new Set([
  "bcc",
  "cc",
  "content-disposition",
  "content-id",
  "content-transfer-encoding",
  "content-type",
  "date",
  "dkim-signature",
  "from",
  "in-reply-to",
  "message-id",
  "mime-version",
  "received",
  "references",
  "reply-to",
  "return-path",
  "sender",
  "subject",
  "to",
]);

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

export const EmailAddress = Schema.String.check(
  Schema.isMaxLength(254),
  Schema.isPattern(addressPattern),
).pipe(Schema.brand("EmailAddress"));
export type EmailAddress = typeof EmailAddress.Type;
export const DisplayName = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isTrimmed(),
  Schema.makeFilter((value: string) => !hasControlCharacter(value), {
    expected: "a string with no control characters",
  }),
).pipe(Schema.brand("DisplayName"));
export type DisplayName = typeof DisplayName.Type;
export const MediaType = Schema.String.check(Schema.isPattern(mediaTypePattern)).pipe(
  Schema.brand("MediaType"),
);
export type MediaType = typeof MediaType.Type;
export const EmailHeaderName = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isPattern(headerNamePattern),
  Schema.makeFilter((value: string) => !hasControlCharacter(value), {
    expected: "a header token with no control characters",
  }),
).pipe(Schema.brand("EmailHeaderName"));
export type EmailHeaderName = typeof EmailHeaderName.Type;
export const EmailHeaderValue = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter((value: string) => value.trim().length > 0, {
    expected: "a non-blank header value",
  }),
  Schema.makeFilter((value: string) => !hasControlCharacter(value), {
    expected: "a single-line header value with no control characters",
  }),
).pipe(Schema.brand("EmailHeaderValue"));
export type EmailHeaderValue = typeof EmailHeaderValue.Type;

export interface Mailbox {
  readonly address: EmailAddress;
  readonly displayName?: DisplayName;
}

export interface Attachment {
  readonly name: string;
  readonly mediaType: MediaType;
  readonly content: Uint8Array;
}

export interface EmailHeader {
  readonly name: EmailHeaderName;
  readonly value: EmailHeaderValue;
}

export type MessageBody = Data.TaggedEnum<{
  TextOnly: { readonly text: string };
  HtmlOnly: { readonly html: string };
  TextAndHtml: { readonly text: string; readonly html: string };
}>;

const MessageBodyVariants = Data.taggedEnum<MessageBody>();

export interface EmailMessage {
  readonly messageType: "EmailMessage";
  readonly from: Mailbox;
  readonly to: readonly [Mailbox, ...Mailbox[]];
  readonly cc?: readonly [Mailbox, ...Mailbox[]];
  readonly bcc?: readonly [Mailbox, ...Mailbox[]];
  readonly replyTo?: readonly [Mailbox, ...Mailbox[]];
  readonly subject: string;
  readonly body: MessageBody;
  readonly attachments?: readonly [Attachment, ...Attachment[]];
  readonly headers?: readonly [EmailHeader, ...EmailHeader[]];
}

const MailboxSchema = Schema.declare<Mailbox>(
  (input): input is Mailbox => typeof input === "object" && input !== null,
);
const MailboxListSchema = Schema.declare<readonly [Mailbox, ...Mailbox[]]>(
  (input): input is readonly [Mailbox, ...Mailbox[]] => Array.isArray(input) && input.length > 0,
);
const AttachmentListSchema = Schema.declare<readonly [Attachment, ...Attachment[]]>(
  (input): input is readonly [Attachment, ...Attachment[]] =>
    Array.isArray(input) && input.length > 0,
);
const EmailHeaderListSchema = Schema.declare<readonly [EmailHeader, ...EmailHeader[]]>(
  (input): input is readonly [EmailHeader, ...EmailHeader[]] =>
    Array.isArray(input) && input.length > 0,
);
const MessageBodySchema = Schema.declare<MessageBody>(
  (input): input is MessageBody =>
    MessageBodyVariants.$is("TextOnly")(input) ||
    MessageBodyVariants.$is("HtmlOnly")(input) ||
    MessageBodyVariants.$is("TextAndHtml")(input),
);
const ParsedEmailMessage = Schema.Struct({
  messageType: Schema.Literal("EmailMessage"),
  from: MailboxSchema,
  to: MailboxListSchema,
  cc: Schema.OptionFromOptionalKey(MailboxListSchema),
  bcc: Schema.OptionFromOptionalKey(MailboxListSchema),
  replyTo: Schema.OptionFromOptionalKey(MailboxListSchema),
  subject: Schema.String,
  body: MessageBodySchema,
  attachments: Schema.OptionFromOptionalKey(AttachmentListSchema),
  headers: Schema.OptionFromOptionalKey(EmailHeaderListSchema),
});
type ParsedEmailMessage = typeof ParsedEmailMessage.Type;
const encodeEmailMessage = Schema.encodeUnknownSync(ParsedEmailMessage);

export interface SendReceipt {
  readonly provider: string;
  readonly messageId: string;
}

export const MailboxInput = Schema.Struct({
  address: Schema.Unknown,
  displayName: Schema.optional(Schema.Unknown),
});
export type MailboxInput = typeof MailboxInput.Type;

export const MessageBodyInput = Schema.Struct({
  text: Schema.optional(Schema.Unknown),
  html: Schema.optional(Schema.Unknown),
});
export type MessageBodyInput = typeof MessageBodyInput.Type;

export const AttachmentInput = Schema.Struct({
  name: Schema.Unknown,
  mediaType: Schema.Unknown,
  content: Schema.Unknown,
  path: Schema.optional(Schema.Unknown),
  url: Schema.optional(Schema.Unknown),
  base64: Schema.optional(Schema.Unknown),
});
export type AttachmentInput = typeof AttachmentInput.Type;

export const EmailHeaderInput = Schema.Struct({
  name: Schema.Unknown,
  value: Schema.Unknown,
});
export type EmailHeaderInput = typeof EmailHeaderInput.Type;

export const EmailHeadersRecordInput = Schema.Record(Schema.String, Schema.Unknown);
export type EmailHeadersRecordInput = typeof EmailHeadersRecordInput.Type;

export const EmailMessageInput = Schema.Struct({
  messageType: Schema.optional(Schema.Unknown),
  from: Schema.Unknown,
  to: Schema.Unknown,
  cc: Schema.optional(Schema.Unknown),
  bcc: Schema.optional(Schema.Unknown),
  replyTo: Schema.optional(Schema.Unknown),
  subject: Schema.Unknown,
  body: Schema.optional(Schema.Unknown),
  text: Schema.optional(Schema.Unknown),
  html: Schema.optional(Schema.Unknown),
  attachments: Schema.optional(Schema.Unknown),
  headers: Schema.optional(Schema.Unknown),
});
export type EmailMessageInput = typeof EmailMessageInput.Type;

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
      "InvalidTextBody",
      "InvalidHtmlBody",
      "InvalidAttachmentName",
      "InvalidMediaType",
      "InvalidAttachmentContent",
    ]),
  },
) {}

export class EmailMessageValidationFailure extends Schema.TaggedErrorClass<EmailMessageValidationFailure>()(
  "EmailMessageValidationFailure",
  {
    field: Schema.Literals([
      "from",
      "to",
      "cc",
      "bcc",
      "replyTo",
      "subject",
      "body",
      "attachments",
      "headers",
    ]),
    reason: Schema.Literals([
      "InvalidEmailAddress",
      "InvalidDisplayName",
      "EmptyRecipients",
      "DuplicateRecipient",
      "InvalidSubject",
      "EmptyBody",
      "InvalidTextBody",
      "InvalidHtmlBody",
      "InvalidAttachmentName",
      "InvalidMediaType",
      "InvalidAttachmentContent",
      "InvalidHeaderName",
      "ForbiddenHeaderName",
      "DuplicateHeaderName",
      "InvalidHeaderValue",
    ]),
  },
) {}

export class EmailHeaderValidationFailure extends Schema.TaggedErrorClass<EmailHeaderValidationFailure>()(
  "EmailHeaderValidationFailure",
  {
    reason: Schema.Literals([
      "InvalidHeaderName",
      "ForbiddenHeaderName",
      "DuplicateHeaderName",
      "InvalidHeaderValue",
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
      "TooManyHeaders",
      "HeaderNameTooLarge",
      "HeaderValueTooLarge",
      "TotalHeadersTooLarge",
    ]),
    limit: Schema.Number,
    retryable: Schema.Literal(false),
  },
) {}

export class AuthenticationFailure extends Schema.TaggedErrorClass<AuthenticationFailure>()(
  "AuthenticationFailure",
  { provider: Schema.String, retryable: Schema.Literal(false) },
) {}

export class RateLimitFailure extends Schema.TaggedErrorClass<RateLimitFailure>()(
  "RateLimitFailure",
  { provider: Schema.String, retryable: Schema.Literal(true) },
) {}

export class RejectedMessageFailure extends Schema.TaggedErrorClass<RejectedMessageFailure>()(
  "RejectedMessageFailure",
  { provider: Schema.String, retryable: Schema.Literal(false) },
) {}

export class TransportUnavailableFailure extends Schema.TaggedErrorClass<TransportUnavailableFailure>()(
  "TransportUnavailableFailure",
  { provider: Schema.String, retryable: Schema.Literal(true) },
) {}

export class ProviderProtocolFailure extends Schema.TaggedErrorClass<ProviderProtocolFailure>()(
  "ProviderProtocolFailure",
  { provider: Schema.String, retryable: Schema.Literal(false) },
) {}

export type SendFailure =
  | SendPolicyViolation
  | AuthenticationFailure
  | RateLimitFailure
  | RejectedMessageFailure
  | TransportUnavailableFailure
  | ProviderProtocolFailure;

export const SendPolicyConfigInput = Schema.Struct({
  maxRecipients: Schema.Number,
  maxSubjectBytes: Schema.Number,
  maxTextBodyBytes: Schema.Number,
  maxHtmlBodyBytes: Schema.Number,
  maxAttachments: Schema.Number,
  maxAttachmentBytes: Schema.Number,
  maxTotalAttachmentBytes: Schema.Number,
  maxHeaders: Schema.Number,
  maxHeaderNameBytes: Schema.Number,
  maxHeaderValueBytes: Schema.Number,
  maxTotalHeaderBytes: Schema.Number,
});

export type SendPolicyConfig = typeof SendPolicyConfigInput.Type;

export type EmailSend = (message: EmailMessage) => Effect.Effect<SendReceipt, SendFailure>;
const EmailSendSchema = Schema.declare<EmailSend>(
  (input): input is EmailSend => typeof input === "function",
);
const EmailInput = Schema.Struct({
  send: EmailSendSchema,
});

const decodeEmailAddress = Schema.decodeUnknownEffect(EmailAddress);
const decodeDisplayName = Schema.decodeUnknownEffect(DisplayName);
const decodeMediaType = Schema.decodeUnknownEffect(MediaType);
const decodeEmailHeaderName = Schema.decodeUnknownEffect(EmailHeaderName);
const decodeEmailHeaderValue = Schema.decodeUnknownEffect(EmailHeaderValue);
const decodeMailboxInput = Schema.decodeUnknownEffect(MailboxInput);
const decodeMessageBodyInput = Schema.decodeUnknownEffect(MessageBodyInput);
const decodeAttachmentInput = Schema.decodeUnknownEffect(AttachmentInput);
const decodeEmailHeaderInput = Schema.decodeUnknownEffect(EmailHeaderInput);
const decodeEmailHeadersRecordInput = Schema.decodeUnknownEffect(EmailHeadersRecordInput);
const decodeEmailMessageInput = Schema.decodeUnknownEffect(EmailMessageInput);

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const hasText = (value: string) => value.trim().length > 0;
const stringMailboxPattern = /^([^<>,;@]+)<([^<>]+)>$/u;

const normalizeAddress = (address: string): string => address.toLowerCase();

const isForbiddenHeaderName = (name: string): boolean => {
  const key = name.toLowerCase();
  return forbiddenHeaderNames.has(key) || key.startsWith("resend-") || key.startsWith("x-resend-");
};

const firstDuplicateBy = <A>(values: readonly A[], key: (value: A) => string): Option.Option<A> =>
  Option.fromUndefinedOr(
    values.find(
      (value, index) => values.findIndex((candidate) => key(candidate) === key(value)) !== index,
    ),
  );

const recipientEntry =
  (field: "to" | "cc" | "bcc") =>
  (mailbox: Mailbox): { readonly field: "to" | "cc" | "bcc"; readonly mailbox: Mailbox } => ({
    field,
    mailbox,
  });

const isOptionInput = (input: unknown): input is Option.Option<unknown> => Option.isOption(input);

const optionalValue = (input: unknown): unknown | undefined => {
  if (input === undefined) return undefined;
  if (isOptionInput(input)) return Option.isNone(input) ? undefined : input.value;
  return input;
};

const arrayFromOptionalInput = (input: unknown): readonly unknown[] =>
  Option.match(Option.fromUndefinedOr(optionalValue(input)), {
    onNone: () => [],
    onSome: (value) => (Array.isArray(value) ? value : [value]),
  });

const optionalLength = <A>(input: readonly A[] | undefined): number =>
  Option.match(Option.fromUndefinedOr(input), {
    onNone: () => 0,
    onSome: (value) => value.length,
  });

const parseEmailAddress: (input: unknown) => Effect.Effect<EmailAddress, MailboxValidationFailure> =
  Effect.fnUntraced(function* (input) {
    if (
      typeof input !== "string" ||
      input.length > 254 ||
      [...input].some((character) => character.charCodeAt(0) > 127) ||
      input.includes('"') ||
      input.includes("(") ||
      input.includes(")") ||
      !addressPattern.test(input.trim())
    ) {
      return yield* new MailboxValidationFailure({ reason: "InvalidEmailAddress" });
    }
    return yield* decodeEmailAddress(normalizeAddress(input.trim())).pipe(
      Effect.mapError(() => new MailboxValidationFailure({ reason: "InvalidEmailAddress" })),
    );
  });

const parseDisplayName: (
  input: unknown,
  options: { readonly allowObjectDelimiters: boolean },
) => Effect.Effect<DisplayName, MailboxValidationFailure> = Effect.fnUntraced(
  function* (input, options) {
    if (typeof input !== "string") {
      return yield* new MailboxValidationFailure({ reason: "InvalidDisplayName" });
    }
    const displayName = input.trim();
    const delimiterPattern = options.allowObjectDelimiters ? /[<>]/u : /[<>,;@]/u;
    if (
      displayName.length === 0 ||
      hasControlCharacter(displayName) ||
      delimiterPattern.test(displayName)
    ) {
      return yield* new MailboxValidationFailure({ reason: "InvalidDisplayName" });
    }
    return yield* decodeDisplayName(displayName).pipe(
      Effect.mapError(() => new MailboxValidationFailure({ reason: "InvalidDisplayName" })),
    );
  },
);

const parseMailboxString: (input: string) => Effect.Effect<Mailbox, MailboxValidationFailure> =
  Effect.fnUntraced(function* (input) {
    const value = input.trim();
    const match = stringMailboxPattern.exec(value);
    if (match === null) {
      return { address: yield* parseEmailAddress(value) };
    }
    const displayName = yield* parseDisplayName(match[1], { allowObjectDelimiters: false });
    const address = yield* parseEmailAddress(match[2]);
    return { address, displayName };
  });

const parseMailbox: (input: unknown) => Effect.Effect<Mailbox, MailboxValidationFailure> =
  Effect.fnUntraced(function* (input) {
    if (typeof input === "string") {
      return yield* parseMailboxString(input);
    }
    const raw = yield* decodeMailboxInput(input).pipe(
      Effect.mapError(() => new MailboxValidationFailure({ reason: "InvalidEmailAddress" })),
    );
    const address = yield* parseEmailAddress(raw.address);
    const displayNameInput = optionalValue(raw.displayName);
    if (displayNameInput === undefined) return { address };
    const displayName = yield* parseDisplayName(displayNameInput, { allowObjectDelimiters: true });
    return { address, displayName };
  });

const nonEmptyMailboxArray: (
  input: unknown,
) => Effect.Effect<readonly [Mailbox, ...Mailbox[]], MailboxValidationFailure> = Effect.fnUntraced(
  function* (input) {
    const array = arrayFromOptionalInput(input);
    if (array.length === 0) {
      return yield* new MailboxValidationFailure({ reason: "EmptyRecipients" });
    }
    const [head, ...tail] = yield* Effect.forEach(array, parseMailbox, {
      concurrency: "unbounded",
    });
    if (head === undefined) {
      return yield* new MailboxValidationFailure({ reason: "EmptyRecipients" });
    }
    return [head, ...tail];
  },
);

const nonEmptyAttachmentArray: (
  input: unknown,
) => Effect.Effect<readonly [Attachment, ...Attachment[]], MessageContentValidationFailure> =
  Effect.fnUntraced(function* (input) {
    const array = arrayFromOptionalInput(input);
    if (array.length === 0) {
      return yield* new MessageContentValidationFailure({ reason: "InvalidAttachmentContent" });
    }
    const [head, ...tail] = yield* Effect.forEach(array, parseAttachment, {
      concurrency: "unbounded",
    });
    if (head === undefined) {
      return yield* new MessageContentValidationFailure({ reason: "InvalidAttachmentContent" });
    }
    return [head, ...tail];
  });

const parseSubject: (input: unknown) => Effect.Effect<string, MessageContentValidationFailure> =
  Effect.fnUntraced(function* (input) {
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
  });

const parseMessageBody: (
  input: unknown,
) => Effect.Effect<MessageBody, MessageContentValidationFailure> = Effect.fnUntraced(
  function* (input) {
    const raw = yield* decodeMessageBodyInput(input).pipe(
      Effect.mapError(() => new MessageContentValidationFailure({ reason: "EmptyBody" })),
    );
    const textInput = optionalValue(raw.text);
    const htmlInput = optionalValue(raw.html);
    const textSupplied = textInput !== undefined;
    const htmlSupplied = htmlInput !== undefined;
    if (!textSupplied && !htmlSupplied) {
      return yield* new MessageContentValidationFailure({ reason: "EmptyBody" });
    }
    if (textSupplied && (typeof textInput !== "string" || !hasText(textInput))) {
      return yield* new MessageContentValidationFailure({ reason: "InvalidTextBody" });
    }
    if (htmlSupplied && (typeof htmlInput !== "string" || !hasText(htmlInput))) {
      return yield* new MessageContentValidationFailure({ reason: "InvalidHtmlBody" });
    }
    if (textSupplied && htmlSupplied) {
      return MessageBodyVariants.TextAndHtml({ text: textInput, html: htmlInput });
    }
    if (textSupplied) return MessageBodyVariants.TextOnly({ text: textInput });
    if (typeof htmlInput === "string") return MessageBodyVariants.HtmlOnly({ html: htmlInput });
    return yield* new MessageContentValidationFailure({ reason: "InvalidHtmlBody" });
  },
);

const parseAttachment: (
  input: unknown,
) => Effect.Effect<Attachment, MessageContentValidationFailure> = Effect.fnUntraced(
  function* (input) {
    const raw = yield* decodeAttachmentInput(input).pipe(
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
        Effect.mapError(() => new MessageContentValidationFailure({ reason: "InvalidMediaType" })),
      ),
      content: raw.content,
    };
  },
);

const parseEmailHeaderName: (
  input: unknown,
) => Effect.Effect<EmailHeaderName, EmailHeaderValidationFailure> = Effect.fnUntraced(
  function* (input) {
    if (typeof input !== "string") {
      return yield* new EmailHeaderValidationFailure({ reason: "InvalidHeaderName" });
    }
    const name = input.trim();
    if (!headerNamePattern.test(name) || hasControlCharacter(name)) {
      return yield* new EmailHeaderValidationFailure({ reason: "InvalidHeaderName" });
    }
    if (isForbiddenHeaderName(name)) {
      return yield* new EmailHeaderValidationFailure({ reason: "ForbiddenHeaderName" });
    }
    return yield* decodeEmailHeaderName(name).pipe(
      Effect.mapError(() => new EmailHeaderValidationFailure({ reason: "InvalidHeaderName" })),
    );
  },
);

const parseEmailHeaderValue: (
  input: unknown,
) => Effect.Effect<EmailHeaderValue, EmailHeaderValidationFailure> = Effect.fnUntraced(
  function* (input) {
    if (
      typeof input !== "string" ||
      !hasText(input) ||
      input.includes("\r") ||
      input.includes("\n") ||
      hasControlCharacter(input)
    ) {
      return yield* new EmailHeaderValidationFailure({ reason: "InvalidHeaderValue" });
    }
    return yield* decodeEmailHeaderValue(input).pipe(
      Effect.mapError(() => new EmailHeaderValidationFailure({ reason: "InvalidHeaderValue" })),
    );
  },
);

const parseEmailHeader: (
  input: unknown,
) => Effect.Effect<EmailHeader, EmailHeaderValidationFailure> = Effect.fnUntraced(
  function* (input) {
    const raw = yield* decodeEmailHeaderInput(input).pipe(
      Effect.mapError(() => new EmailHeaderValidationFailure({ reason: "InvalidHeaderName" })),
    );
    return {
      name: yield* parseEmailHeaderName(raw.name),
      value: yield* parseEmailHeaderValue(raw.value),
    };
  },
);

const parseEmailHeaders: (
  input: unknown,
) => Effect.Effect<
  readonly [EmailHeader, ...EmailHeader[]] | undefined,
  EmailHeaderValidationFailure
> = Effect.fnUntraced(function* (input) {
  return yield* Option.match(Option.fromUndefinedOr(optionalValue(input)), {
    onNone: () => Effect.void.pipe(Effect.as(undefined)),
    onSome: (value) =>
      Effect.gen(function* () {
        const rawHeaders = Array.isArray(value)
          ? value
          : Object.entries(
              yield* decodeEmailHeadersRecordInput(value).pipe(
                Effect.mapError(
                  () => new EmailHeaderValidationFailure({ reason: "InvalidHeaderName" }),
                ),
              ),
            ).map(([name, headerValue]) => ({ name, value: headerValue }));
        const [head, ...tail] = yield* Effect.forEach(rawHeaders, parseEmailHeader, {
          concurrency: "unbounded",
        });
        if (head === undefined) return undefined;
        const headers: readonly [EmailHeader, ...EmailHeader[]] = [head, ...tail];
        if (Option.isSome(firstDuplicateBy(headers, (header) => header.name.toLowerCase()))) {
          return yield* new EmailHeaderValidationFailure({ reason: "DuplicateHeaderName" });
        }
        return headers;
      }),
  });
});

const sendPolicyViolation = (
  message: EmailMessage,
  config: SendPolicyConfig,
): Option.Option<SendPolicyViolation> => {
  const attachments = Option.getOrElse(Option.fromUndefinedOr(message.attachments), () => []);
  const headers = Option.getOrElse(Option.fromUndefinedOr(message.headers), () => []);
  const violation = (reason: SendPolicyViolation["reason"], limit: number) =>
    new SendPolicyViolation({ reason, limit, retryable: false });

  return Match.value({
    recipientCount: message.to.length + optionalLength(message.cc) + optionalLength(message.bcc),
    bodyEmpty: isBodyEmpty(message.body),
    subjectBytes: utf8Bytes(message.subject),
    textBytes: textBodyBytes(message.body),
    htmlBytes: htmlBodyBytes(message.body),
    attachmentCount: attachments.length,
    hasLargeAttachment: attachments.some(
      (attachment) => attachment.content.byteLength > config.maxAttachmentBytes,
    ),
    totalAttachmentBytes: attachments.reduce(
      (total, attachment) => total + attachment.content.byteLength,
      0,
    ),
    headerCount: headers.length,
    hasLargeHeaderName: headers.some(
      (header) => utf8Bytes(header.name) > config.maxHeaderNameBytes,
    ),
    hasLargeHeaderValue: headers.some(
      (header) => utf8Bytes(header.value) > config.maxHeaderValueBytes,
    ),
    totalHeaderBytes: headers.reduce(
      (total, header) => total + utf8Bytes(header.name) + utf8Bytes(header.value),
      0,
    ),
  }).pipe(
    Match.when(
      ({ recipientCount }) => recipientCount === 0,
      () => violation("EmptyRecipients", 1),
    ),
    Match.when(
      ({ recipientCount }) => recipientCount > config.maxRecipients,
      () => violation("TooManyRecipients", config.maxRecipients),
    ),
    Match.when(
      ({ bodyEmpty }) => bodyEmpty,
      () => violation("EmptyBody", 1),
    ),
    Match.when(
      ({ subjectBytes }) => subjectBytes > config.maxSubjectBytes,
      () => violation("SubjectTooLarge", config.maxSubjectBytes),
    ),
    Match.when(
      ({ textBytes }) => textBytes > config.maxTextBodyBytes,
      () => violation("TextBodyTooLarge", config.maxTextBodyBytes),
    ),
    Match.when(
      ({ htmlBytes }) => htmlBytes > config.maxHtmlBodyBytes,
      () => violation("HtmlBodyTooLarge", config.maxHtmlBodyBytes),
    ),
    Match.when(
      ({ attachmentCount }) => attachmentCount > config.maxAttachments,
      () => violation("TooManyAttachments", config.maxAttachments),
    ),
    Match.when(
      ({ hasLargeAttachment }) => hasLargeAttachment,
      () => violation("AttachmentTooLarge", config.maxAttachmentBytes),
    ),
    Match.when(
      ({ totalAttachmentBytes }) => totalAttachmentBytes > config.maxTotalAttachmentBytes,
      () => violation("TotalAttachmentsTooLarge", config.maxTotalAttachmentBytes),
    ),
    Match.when(
      ({ headerCount }) => headerCount > config.maxHeaders,
      () => violation("TooManyHeaders", config.maxHeaders),
    ),
    Match.when(
      ({ hasLargeHeaderName }) => hasLargeHeaderName,
      () => violation("HeaderNameTooLarge", config.maxHeaderNameBytes),
    ),
    Match.when(
      ({ hasLargeHeaderValue }) => hasLargeHeaderValue,
      () => violation("HeaderValueTooLarge", config.maxHeaderValueBytes),
    ),
    Match.when(
      ({ totalHeaderBytes }) => totalHeaderBytes > config.maxTotalHeaderBytes,
      () => violation("TotalHeadersTooLarge", config.maxTotalHeaderBytes),
    ),
    Match.option,
  );
};

const mapMailboxFailure = (field: EmailMessageValidationFailure["field"]) =>
  Effect.mapError(
    (failure: MailboxValidationFailure) =>
      new EmailMessageValidationFailure({ field, reason: failure.reason }),
  );

const mapContentFailure = (field: EmailMessageValidationFailure["field"]) =>
  Effect.mapError(
    (failure: MessageContentValidationFailure) =>
      new EmailMessageValidationFailure({ field, reason: failure.reason }),
  );

const parseMessageMailboxList: (
  field: "to" | "cc" | "bcc" | "replyTo",
  input: unknown,
) => Effect.Effect<readonly [Mailbox, ...Mailbox[]] | undefined, EmailMessageValidationFailure> =
  Effect.fnUntraced(function* (field, input) {
    const value = optionalValue(input);
    if (value === undefined) return undefined;
    return yield* nonEmptyMailboxArray(value).pipe(mapMailboxFailure(field));
  });

const parseAttachments: (
  input: unknown,
) => Effect.Effect<
  readonly [Attachment, ...Attachment[]] | undefined,
  EmailMessageValidationFailure
> = Effect.fnUntraced(function* (input) {
  const value = optionalValue(input);
  if (value === undefined) return undefined;
  return yield* nonEmptyAttachmentArray(value).pipe(mapContentFailure("attachments"));
});

const parseEmailMessage: (
  input: EmailMessageInput,
) => Effect.Effect<EmailMessage, EmailMessageValidationFailure> = Effect.fnUntraced(
  function* (input) {
    const raw = yield* decodeEmailMessageInput(input).pipe(
      Effect.mapError(
        () => new EmailMessageValidationFailure({ field: "from", reason: "InvalidEmailAddress" }),
      ),
    );
    if (raw.messageType === "EmailMessage") {
      return yield* new EmailMessageValidationFailure({ field: "body", reason: "EmptyBody" });
    }
    if (raw.body !== undefined && (raw.text !== undefined || raw.html !== undefined)) {
      return yield* new EmailMessageValidationFailure({ field: "body", reason: "EmptyBody" });
    }
    const bodyInput = raw.body === undefined ? { text: raw.text, html: raw.html } : raw.body;
    const { attachments, bcc, body, cc, from, headers, replyTo, subject, to } = yield* Effect.all(
      {
        from: parseMailbox(raw.from).pipe(mapMailboxFailure("from")),
        to: nonEmptyMailboxArray(raw.to).pipe(mapMailboxFailure("to")),
        cc: parseMessageMailboxList("cc", raw.cc),
        bcc: parseMessageMailboxList("bcc", raw.bcc),
        replyTo: parseMessageMailboxList("replyTo", raw.replyTo),
        subject: parseSubject(raw.subject).pipe(mapContentFailure("subject")),
        body: parseMessageBody(bodyInput).pipe(mapContentFailure("body")),
        attachments: parseAttachments(raw.attachments),
        headers: parseEmailHeaders(raw.headers).pipe(
          Effect.mapError(
            (failure) =>
              new EmailMessageValidationFailure({ field: "headers", reason: failure.reason }),
          ),
        ),
      },
      { concurrency: "unbounded" },
    );
    const recipientEntries = [
      ...to.map(recipientEntry("to")),
      ...Option.getOrElse(Option.fromUndefinedOr(cc), () => []).map(recipientEntry("cc")),
      ...Option.getOrElse(Option.fromUndefinedOr(bcc), () => []).map(recipientEntry("bcc")),
    ];
    const duplicateRecipient = firstDuplicateBy(recipientEntries, ({ mailbox }) => mailbox.address);
    if (Option.isSome(duplicateRecipient)) {
      return yield* new EmailMessageValidationFailure({
        field: duplicateRecipient.value.field,
        reason: "DuplicateRecipient",
      });
    }
    return encodeEmailMessage({
      messageType: "EmailMessage",
      from,
      to,
      cc: Option.fromUndefinedOr(cc),
      bcc: Option.fromUndefinedOr(bcc),
      replyTo: Option.fromUndefinedOr(replyTo),
      subject,
      body,
      attachments: Option.fromUndefinedOr(attachments),
      headers: Option.fromUndefinedOr(headers),
    });
  },
);

export const Mailbox = {
  make: parseMailbox,
};

export const MessageBody = {
  TextOnly: MessageBodyVariants.TextOnly,
  HtmlOnly: MessageBodyVariants.HtmlOnly,
  TextAndHtml: MessageBodyVariants.TextAndHtml,
  $match: MessageBodyVariants.$match,
  make: parseMessageBody,
};

export const Attachment = {
  make: parseAttachment,
};

export const EmailHeader = {
  make: parseEmailHeader,
};

export const EmailMessage = {
  make: parseEmailMessage,
};

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

const isBodyEmpty = MessageBody.$match({
  TextOnly: ({ text }) => !hasText(text),
  HtmlOnly: ({ html }) => !hasText(html),
  TextAndHtml: ({ text, html }) => !hasText(text) && !hasText(html),
});

export class SendPolicy extends Context.Service<
  SendPolicy,
  SendPolicyConfig & {
    readonly validate: (message: EmailMessage) => Effect.Effect<EmailMessage, SendPolicyViolation>;
  }
>()("@effect-email/SendPolicy") {
  static readonly defaultConfig: SendPolicyConfig = {
    maxRecipients: 50,
    maxSubjectBytes: 998,
    maxTextBodyBytes: 1_000_000,
    maxHtmlBodyBytes: 1_000_000,
    maxAttachments: 10,
    maxAttachmentBytes: 10_000_000,
    maxTotalAttachmentBytes: 40_000_000,
    maxHeaders: 20,
    maxHeaderNameBytes: 128,
    maxHeaderValueBytes: 998,
    maxTotalHeaderBytes: 8000,
  };

  static readonly layer = (input: Partial<SendPolicyConfig> = {}) => {
    const config = SendPolicyConfigInput.make({ ...SendPolicy.defaultConfig, ...input });
    return SendPolicy.of({
      ...config,
      validate: (message) =>
        Option.match(sendPolicyViolation(message, config), {
          onNone: () => Effect.succeed(message),
          onSome: Effect.fail,
        }),
    });
  };

  static readonly defaultLayer = SendPolicy.layer(SendPolicy.defaultConfig);
}

export namespace SendPolicy {
  export type Config = SendPolicyConfig;
}

export class Email extends Context.Service<
  Email,
  {
    readonly send: (message: EmailMessage) => Effect.Effect<SendReceipt, SendFailure>;
  }
>()("@effect-email/Email") {
  static readonly layer = (input: typeof EmailInput.Type) => {
    const config = EmailInput.make(input);
    return Email.of({ ...config });
  };
}
