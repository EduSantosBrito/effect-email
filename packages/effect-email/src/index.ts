import { Context, Data, DateTime, Effect, Match, Option, Schema } from "effect";

const addressPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const mediaTypePattern =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:\s*;\s*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*$/;
const contentIdPattern = /^[^\s<>@]+@[^\s<>@]+$/u;
const headerNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const idempotencyKeyPattern = /^[!-~]{1,256}$/;
const printableAsciiPattern = /^[ -~]+$/;
const canonicalHttpDatePattern =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
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

const weekDays: readonly string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const months: readonly string[] = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const twoDigits = (value: number): string => value.toString().padStart(2, "0");
const isCanonicalHttpDate = (value: string): boolean =>
  Option.match(DateTime.make(value), {
    onNone: () => false,
    onSome: (dateTime) => {
      const parts = DateTime.toPartsUtc(dateTime);
      const weekDay = weekDays[parts.weekDay];
      const month = months[parts.month - 1];
      return (
        parts.millisecond === 0 &&
        weekDay !== undefined &&
        month !== undefined &&
        `${weekDay}, ${twoDigits(parts.day)} ${month} ${parts.year.toString().padStart(4, "0")} ${twoDigits(parts.hour)}:${twoDigits(parts.minute)}:${twoDigits(parts.second)} GMT` ===
          value
      );
    },
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
export const ContentId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isPattern(contentIdPattern),
  Schema.makeFilter(
    (value: string) => [...value].every((character) => character.charCodeAt(0) < 128),
    {
      expected: "an ASCII content ID",
    },
  ),
  Schema.makeFilter((value: string) => !hasControlCharacter(value), {
    expected: "a content ID with no control characters",
  }),
).pipe(Schema.brand("ContentId"));
export type ContentId = typeof ContentId.Type;
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
export const Subject = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter((value: string) => value.trim().length > 0, {
    expected: "a non-blank subject",
  }),
  Schema.makeFilter((value: string) => !value.includes("\r") && !value.includes("\n"), {
    expected: "a single-line subject",
  }),
  Schema.makeFilter((value: string) => !hasControlCharacter(value), {
    expected: "a subject with no control characters",
  }),
).pipe(Schema.brand("Subject"));
export type Subject = typeof Subject.Type;
export const TextBody = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter((value: string) => value.trim().length > 0, {
    expected: "a non-blank text body",
  }),
).pipe(Schema.brand("TextBody"));
export type TextBody = typeof TextBody.Type;
export const HtmlBody = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter((value: string) => value.trim().length > 0, {
    expected: "a non-blank HTML body",
  }),
).pipe(Schema.brand("HtmlBody"));
export type HtmlBody = typeof HtmlBody.Type;
export const IdempotencyKey = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(idempotencyKeyPattern),
).pipe(Schema.brand("IdempotencyKey"));
export type IdempotencyKey = typeof IdempotencyKey.Type;

export interface Mailbox {
  readonly address: EmailAddress;
  readonly displayName?: DisplayName;
}

export interface Attachment {
  readonly name: string;
  readonly mediaType: MediaType;
  readonly content: Uint8Array;
  readonly contentId?: ContentId;
}

export interface EmailHeader {
  readonly name: EmailHeaderName;
  readonly value: EmailHeaderValue;
}

const EmailHeadersTypeId = "~effect-email/EmailHeaders";
export interface EmailHeaders {
  readonly [EmailHeadersTypeId]: typeof EmailHeadersTypeId;
  readonly values: readonly [EmailHeader, ...EmailHeader[]];
}

export type MessageBody = Data.TaggedEnum<{
  TextOnly: { readonly text: TextBody };
  HtmlOnly: { readonly html: HtmlBody };
  TextAndHtml: { readonly text: TextBody; readonly html: HtmlBody };
}>;

const MessageBodyVariants = Data.taggedEnum<MessageBody>();

const EmailMessageTypeId = "~effect-email/EmailMessage";
export interface EmailMessage {
  readonly [EmailMessageTypeId]: typeof EmailMessageTypeId;
  readonly messageType: "EmailMessage";
  readonly from: Mailbox;
  readonly to: readonly [Mailbox, ...Mailbox[]];
  readonly cc?: readonly [Mailbox, ...Mailbox[]];
  readonly bcc?: readonly [Mailbox, ...Mailbox[]];
  readonly replyTo?: readonly [Mailbox, ...Mailbox[]];
  readonly subject: Subject;
  readonly body: MessageBody;
  readonly attachments?: readonly [Attachment, ...Attachment[]];
  readonly headers?: EmailHeaders;
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
const EmailHeadersSchema = Schema.declare<EmailHeaders>(
  (input): input is EmailHeaders =>
    typeof input === "object" && input !== null && EmailHeadersTypeId in input,
);
const MessageBodySchema = Schema.declare<MessageBody>(
  (input): input is MessageBody =>
    MessageBodyVariants.$is("TextOnly")(input) ||
    MessageBodyVariants.$is("HtmlOnly")(input) ||
    MessageBodyVariants.$is("TextAndHtml")(input),
);
const ParsedEmailMessage = Schema.Struct({
  [EmailMessageTypeId]: Schema.Literal(EmailMessageTypeId),
  messageType: Schema.Literal("EmailMessage"),
  from: MailboxSchema,
  to: MailboxListSchema,
  cc: Schema.OptionFromOptionalKey(MailboxListSchema),
  bcc: Schema.OptionFromOptionalKey(MailboxListSchema),
  replyTo: Schema.OptionFromOptionalKey(MailboxListSchema),
  subject: Subject,
  body: MessageBodySchema,
  attachments: Schema.OptionFromOptionalKey(AttachmentListSchema),
  headers: Schema.OptionFromOptionalKey(EmailHeadersSchema),
});
type ParsedEmailMessage = typeof ParsedEmailMessage.Type;
const encodeEmailMessage = Schema.encodeUnknownSync(ParsedEmailMessage);

const SendOptionsTypeId = "~effect-email/SendOptions";
export interface SendOptions {
  readonly [SendOptionsTypeId]: typeof SendOptionsTypeId;
  readonly idempotencyKey?: IdempotencyKey;
}

export interface SendReceipt {
  readonly provider: string;
  readonly messageId: string;
}

export const SendFailureDisposition = Schema.Literals(["permanent", "retryable", "ambiguous"]);
export type SendFailureDisposition = typeof SendFailureDisposition.Type;

const HttpStatus = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isBetween({ minimum: 100, maximum: 599 }),
);
const RetryAfterSeconds = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  Schema.makeFilter(Number.isSafeInteger, { expected: "a safe integer" }),
);
const RetryAfterHttpDate = Schema.String.check(
  Schema.isPattern(canonicalHttpDatePattern),
  Schema.makeFilter(isCanonicalHttpDate, { expected: "a canonical HTTP date" }),
);

export const RetryAfter = Schema.Union([
  Schema.TaggedStruct("DelaySeconds", { seconds: RetryAfterSeconds }),
  Schema.TaggedStruct("HttpDate", { value: RetryAfterHttpDate }),
]);
export type RetryAfter = typeof RetryAfter.Type;

export const SendFailureMetadata = Schema.Struct({
  status: Schema.optional(HttpStatus),
  retryAfter: Schema.optional(RetryAfter),
  requestId: Schema.optional(
    Schema.String.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(256),
      Schema.isPattern(printableAsciiPattern),
    ),
  ),
});
export type SendFailureMetadata = typeof SendFailureMetadata.Type;

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
  contentId: Schema.optional(Schema.Unknown),
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

export const SendOptionsInput = Schema.Struct({
  idempotencyKey: Schema.optional(Schema.Unknown),
});
export type SendOptionsInput = typeof SendOptionsInput.Type;

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

export class MailboxValidationFailure extends Schema.TaggedError<MailboxValidationFailure>()(
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

export class MessageContentValidationFailure extends Schema.TaggedError<MessageContentValidationFailure>()(
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
      "InvalidContentId",
    ]),
  },
) {}

export class EmailMessageValidationFailure extends Schema.TaggedError<EmailMessageValidationFailure>()(
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
      "InvalidContentId",
      "DuplicateContentId",
      "InvalidHeaderName",
      "ForbiddenHeaderName",
      "DuplicateHeaderName",
      "InvalidHeaderValue",
    ]),
  },
) {}

export class EmailHeaderValidationFailure extends Schema.TaggedError<EmailHeaderValidationFailure>()(
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

export class SendOptionsValidationFailure extends Schema.TaggedError<SendOptionsValidationFailure>()(
  "SendOptionsValidationFailure",
  {
    reason: Schema.Literals(["InvalidSendOptions", "InvalidIdempotencyKey"]),
  },
) {}

export class SendPolicyViolation extends Schema.TaggedError<SendPolicyViolation>()(
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
    disposition: Schema.Literal("permanent"),
    /** @deprecated Use `disposition` instead. */
    retryable: Schema.Literal(false),
  },
) {}

const PermanentProviderFailureFields = {
  provider: Schema.String,
  metadata: Schema.optional(SendFailureMetadata),
  disposition: Schema.Literal("permanent"),
  /** @deprecated Use `disposition` instead. */
  retryable: Schema.Literal(false),
};

export class AuthenticationFailure extends Schema.TaggedError<AuthenticationFailure>()(
  "AuthenticationFailure",
  PermanentProviderFailureFields,
) {}

export class RateLimitFailure extends Schema.TaggedError<RateLimitFailure>()("RateLimitFailure", {
  provider: Schema.String,
  metadata: Schema.optional(SendFailureMetadata),
  disposition: Schema.Literal("retryable"),
  /** @deprecated Use `disposition` instead. */
  retryable: Schema.Literal(true),
}) {}

export class RejectedMessageFailure extends Schema.TaggedError<RejectedMessageFailure>()(
  "RejectedMessageFailure",
  PermanentProviderFailureFields,
) {}

export class TransportUnavailableFailure extends Schema.TaggedError<TransportUnavailableFailure>()(
  "TransportUnavailableFailure",
  {
    provider: Schema.String,
    metadata: Schema.optional(SendFailureMetadata),
    disposition: Schema.Literal("retryable"),
    /** @deprecated Use `disposition` instead. */
    retryable: Schema.Literal(true),
  },
) {}

export class ProviderProtocolFailure extends Schema.TaggedError<ProviderProtocolFailure>()(
  "ProviderProtocolFailure",
  PermanentProviderFailureFields,
) {}

export class AmbiguousSendFailure extends Schema.TaggedError<AmbiguousSendFailure>()(
  "AmbiguousSendFailure",
  {
    provider: Schema.String,
    metadata: Schema.optional(SendFailureMetadata),
    disposition: Schema.Literal("ambiguous"),
    /** @deprecated Use `disposition` instead. */
    retryable: Schema.Literal(false),
  },
) {}

export type SendFailure =
  | SendPolicyViolation
  | AuthenticationFailure
  | RateLimitFailure
  | RejectedMessageFailure
  | TransportUnavailableFailure
  | ProviderProtocolFailure
  | AmbiguousSendFailure;

const SendPolicyLimit = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThan(0),
);

export const SendPolicyConfigInput = Schema.Struct({
  maxRecipients: SendPolicyLimit,
  maxSubjectBytes: SendPolicyLimit,
  maxTextBodyBytes: SendPolicyLimit,
  maxHtmlBodyBytes: SendPolicyLimit,
  maxAttachments: SendPolicyLimit,
  maxAttachmentBytes: SendPolicyLimit,
  maxTotalAttachmentBytes: SendPolicyLimit,
  maxHeaders: SendPolicyLimit,
  maxHeaderNameBytes: SendPolicyLimit,
  maxHeaderValueBytes: SendPolicyLimit,
  maxTotalHeaderBytes: SendPolicyLimit,
});

export type SendPolicyConfig = typeof SendPolicyConfigInput.Type;

export type EmailSend = (
  message: EmailMessage,
  options?: SendOptions,
) => Effect.Effect<SendReceipt, SendFailure>;
const EmailSendSchema = Schema.declare<EmailSend>(
  (input): input is EmailSend => typeof input === "function",
);

const decodeIdempotencyKey = Schema.decodeUnknownEffect(IdempotencyKey);
const decodeSendOptionsInput = Schema.decodeUnknownEffect(SendOptionsInput);
const decodeEmailAddress = Schema.decodeUnknownEffect(EmailAddress);
const decodeDisplayName = Schema.decodeUnknownEffect(DisplayName);
const decodeMediaType = Schema.decodeUnknownEffect(MediaType);
const decodeContentId = Schema.decodeUnknownEffect(ContentId);
const decodeEmailHeaderName = Schema.decodeUnknownEffect(EmailHeaderName);
const decodeEmailHeaderValue = Schema.decodeUnknownEffect(EmailHeaderValue);
const decodeSubject = Schema.decodeUnknownEffect(Subject);
const decodeTextBody = Schema.decodeUnknownEffect(TextBody);
const decodeHtmlBody = Schema.decodeUnknownEffect(HtmlBody);
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

const parseSendOptions: (
  input: unknown,
) => Effect.Effect<SendOptions, SendOptionsValidationFailure> = Effect.fnUntraced(
  function* (input) {
    const raw = yield* decodeSendOptionsInput(input).pipe(
      Effect.mapError(() => new SendOptionsValidationFailure({ reason: "InvalidSendOptions" })),
    );
    const idempotencyKeyInput = optionalValue(raw.idempotencyKey);
    if (idempotencyKeyInput === undefined) {
      return { [SendOptionsTypeId]: SendOptionsTypeId };
    }
    const idempotencyKey = yield* decodeIdempotencyKey(idempotencyKeyInput).pipe(
      Effect.mapError(() => new SendOptionsValidationFailure({ reason: "InvalidIdempotencyKey" })),
    );
    return { [SendOptionsTypeId]: SendOptionsTypeId, idempotencyKey };
  },
);

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

const parseSubject: (input: unknown) => Effect.Effect<Subject, MessageContentValidationFailure> =
  Effect.fnUntraced(function* (input) {
    if (
      typeof input === "string" &&
      hasText(input) &&
      !input.includes("\r") &&
      !input.includes("\n") &&
      !hasControlCharacter(input)
    ) {
      return yield* decodeSubject(input).pipe(
        Effect.mapError(() => new MessageContentValidationFailure({ reason: "InvalidSubject" })),
      );
    }
    return yield* new MessageContentValidationFailure({ reason: "InvalidSubject" });
  });

const parseTextBody: (input: unknown) => Effect.Effect<TextBody, MessageContentValidationFailure> =
  Effect.fnUntraced(function* (input) {
    if (typeof input !== "string" || !hasText(input)) {
      return yield* new MessageContentValidationFailure({ reason: "InvalidTextBody" });
    }
    return yield* decodeTextBody(input).pipe(
      Effect.mapError(() => new MessageContentValidationFailure({ reason: "InvalidTextBody" })),
    );
  });

const parseHtmlBody: (input: unknown) => Effect.Effect<HtmlBody, MessageContentValidationFailure> =
  Effect.fnUntraced(function* (input) {
    if (typeof input !== "string" || !hasText(input)) {
      return yield* new MessageContentValidationFailure({ reason: "InvalidHtmlBody" });
    }
    return yield* decodeHtmlBody(input).pipe(
      Effect.mapError(() => new MessageContentValidationFailure({ reason: "InvalidHtmlBody" })),
    );
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
    const text = textSupplied ? yield* parseTextBody(textInput) : undefined;
    const html = htmlSupplied ? yield* parseHtmlBody(htmlInput) : undefined;
    if (textSupplied && htmlSupplied) {
      if (text !== undefined && html !== undefined) {
        return MessageBodyVariants.TextAndHtml({ text, html });
      }
      return yield* new MessageContentValidationFailure({ reason: "EmptyBody" });
    }
    if (text !== undefined) return MessageBodyVariants.TextOnly({ text });
    if (html !== undefined) return MessageBodyVariants.HtmlOnly({ html });
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
    const contentIdInput = optionalValue(raw.contentId);
    const contentId =
      contentIdInput === undefined
        ? undefined
        : yield* decodeContentId(contentIdInput).pipe(
            Effect.mapError(
              () => new MessageContentValidationFailure({ reason: "InvalidContentId" }),
            ),
          );
    return {
      name: raw.name,
      mediaType: yield* decodeMediaType(raw.mediaType.toLowerCase()).pipe(
        Effect.mapError(() => new MessageContentValidationFailure({ reason: "InvalidMediaType" })),
      ),
      content: raw.content,
      ...(contentId !== undefined ? { contentId } : {}),
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

const makeEmailHeaders = (values: readonly [EmailHeader, ...EmailHeader[]]): EmailHeaders => ({
  [EmailHeadersTypeId]: EmailHeadersTypeId,
  values,
});

const parseRequiredEmailHeaders: (
  input: unknown,
) => Effect.Effect<EmailHeaders, EmailHeaderValidationFailure> = Effect.fnUntraced(
  function* (input) {
    const rawHeaders = Array.isArray(input)
      ? input
      : Object.entries(
          yield* decodeEmailHeadersRecordInput(input).pipe(
            Effect.mapError(
              () => new EmailHeaderValidationFailure({ reason: "InvalidHeaderName" }),
            ),
          ),
        ).map(([name, headerValue]) => ({ name, value: headerValue }));
    const [head, ...tail] = yield* Effect.forEach(rawHeaders, parseEmailHeader, {
      concurrency: "unbounded",
    });
    if (head === undefined) {
      return yield* new EmailHeaderValidationFailure({ reason: "InvalidHeaderName" });
    }
    const headers: readonly [EmailHeader, ...EmailHeader[]] = [head, ...tail];
    if (Option.isSome(firstDuplicateBy(headers, (header) => header.name.toLowerCase()))) {
      return yield* new EmailHeaderValidationFailure({ reason: "DuplicateHeaderName" });
    }
    return makeEmailHeaders(headers);
  },
);

const parseEmailHeaders: (
  input: unknown,
) => Effect.Effect<EmailHeaders | undefined, EmailHeaderValidationFailure> = Effect.fnUntraced(
  function* (input) {
    return yield* Option.match(Option.fromUndefinedOr(optionalValue(input)), {
      onNone: () => Effect.void.pipe(Effect.as(undefined)),
      onSome: parseRequiredEmailHeaders,
    });
  },
);

const sendPolicyViolation = (
  message: EmailMessage,
  config: SendPolicyConfig,
): Option.Option<SendPolicyViolation> => {
  const attachments = Option.getOrElse(Option.fromUndefinedOr(message.attachments), () => []);
  const headers = Option.getOrElse(
    Option.map(Option.fromUndefinedOr(message.headers), (emailHeaders) => emailHeaders.values),
    () => [],
  );
  const violation = (reason: SendPolicyViolation["reason"], limit: number) =>
    new SendPolicyViolation({
      reason,
      limit,
      disposition: "permanent",
      retryable: false,
    });

  return Match.value({
    recipientCount: message.to.length + optionalLength(message.cc) + optionalLength(message.bcc),
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
    const duplicateContentId = firstDuplicateBy(
      Option.getOrElse(Option.fromUndefinedOr(attachments), () => []).filter(
        (attachment) => attachment.contentId !== undefined,
      ),
      (attachment) => attachment.contentId ?? "",
    );
    if (Option.isSome(duplicateContentId)) {
      return yield* new EmailMessageValidationFailure({
        field: "attachments",
        reason: "DuplicateContentId",
      });
    }
    const message = encodeEmailMessage({
      [EmailMessageTypeId]: EmailMessageTypeId,
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
    return { ...message, subject };
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

export const EmailHeaders = {
  make: parseRequiredEmailHeaders,
  toReadonlyArray: (headers: EmailHeaders): readonly [EmailHeader, ...EmailHeader[]] =>
    headers.values,
};

export const EmailMessage = {
  make: parseEmailMessage,
};

export const SendOptions = {
  make: parseSendOptions,
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

const SendPolicyInput = Schema.declare<typeof SendPolicy.Service>(
  (input): input is typeof SendPolicy.Service => input !== undefined && input !== null,
);

const EmailInput = Schema.Struct({
  send: EmailSendSchema,
  policy: SendPolicyInput,
});

export class Email extends Context.Service<
  Email,
  {
    readonly send: (
      message: EmailMessage,
      options?: SendOptions,
    ) => Effect.Effect<SendReceipt, SendFailure>;
  }
>()("@effect-email/Email") {
  static readonly layer = (input: typeof EmailInput.Type) => {
    const config = EmailInput.make(input);
    return Email.of({
      ...config,
      send: (message, options) =>
        config.policy
          .validate(message)
          .pipe(Effect.flatMap((validatedMessage) => config.send(validatedMessage, options))),
    });
  };
}
