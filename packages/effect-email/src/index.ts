import { Context, Data, Effect, Option, Schema } from "effect";

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

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
};

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

const isOptionInput = (input: unknown): input is Option.Option<unknown> => Option.isOption(input);

const optionalValue = (input: unknown): unknown | undefined => {
  if (input === undefined) return undefined;
  if (isOptionInput(input)) return Option.isNone(input) ? undefined : input.value;
  return input;
};

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
    const value = optionalValue(input);
    const array = Array.isArray(value) ? value : value === undefined ? [] : [value];
    if (array.length === 0) {
      return yield* new MailboxValidationFailure({ reason: "EmptyRecipients" });
    }
    const head = yield* parseMailbox(array[0]);
    const tail = yield* Effect.all(array.slice(1).map(parseMailbox));
    return [head, ...tail];
  },
);

const nonEmptyAttachmentArray: (
  input: unknown,
) => Effect.Effect<readonly [Attachment, ...Attachment[]], MessageContentValidationFailure> =
  Effect.fnUntraced(function* (input) {
    const value = optionalValue(input);
    const array = Array.isArray(value) ? value : value === undefined ? [] : [value];
    if (array.length === 0) {
      return yield* new MessageContentValidationFailure({ reason: "InvalidAttachmentContent" });
    }
    const head = yield* parseAttachment(array[0]);
    const tail = yield* Effect.all(array.slice(1).map(parseAttachment));
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
  const value = optionalValue(input);
  if (value === undefined) return undefined;
  const rawHeaders = Array.isArray(value)
    ? value
    : Object.entries(
        yield* decodeEmailHeadersRecordInput(value).pipe(
          Effect.mapError(() => new EmailHeaderValidationFailure({ reason: "InvalidHeaderName" })),
        ),
      ).map(([name, headerValue]) => ({ name, value: headerValue }));
  if (rawHeaders.length === 0) return undefined;
  const head = yield* parseEmailHeader(rawHeaders[0]);
  const tail = yield* Effect.all(rawHeaders.slice(1).map(parseEmailHeader));
  const headers: readonly [EmailHeader, ...EmailHeader[]] = [head, ...tail];
  const seen = new Set<string>();
  for (const header of headers) {
    const key = header.name.toLowerCase();
    if (seen.has(key)) {
      return yield* new EmailHeaderValidationFailure({ reason: "DuplicateHeaderName" });
    }
    seen.add(key);
  }
  return headers;
});

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

const mapHeaderFailure = Effect.mapError(
  (failure: EmailHeaderValidationFailure) =>
    new EmailMessageValidationFailure({ field: "headers", reason: failure.reason }),
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

const parseMessageHeaders: (
  input: unknown,
) => Effect.Effect<
  readonly [EmailHeader, ...EmailHeader[]] | undefined,
  EmailMessageValidationFailure
> = Effect.fnUntraced(function* (input) {
  return yield* parseEmailHeaders(input).pipe(mapHeaderFailure);
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
    const from = yield* parseMailbox(raw.from).pipe(mapMailboxFailure("from"));
    const to = yield* nonEmptyMailboxArray(raw.to).pipe(mapMailboxFailure("to"));
    const cc = yield* parseMessageMailboxList("cc", raw.cc);
    const bcc = yield* parseMessageMailboxList("bcc", raw.bcc);
    const replyTo = yield* parseMessageMailboxList("replyTo", raw.replyTo);
    const seen = new Set<string>();
    const checkDuplicates = Effect.fnUntraced(function* (
      field: "to" | "cc" | "bcc",
      list: readonly Mailbox[] | undefined,
    ) {
      for (const mailbox of list ?? []) {
        if (seen.has(mailbox.address)) {
          return yield* new EmailMessageValidationFailure({ field, reason: "DuplicateRecipient" });
        }
        seen.add(mailbox.address);
      }
    });
    yield* checkDuplicates("to", to);
    yield* checkDuplicates("cc", cc);
    yield* checkDuplicates("bcc", bcc);
    const subject = yield* parseSubject(raw.subject).pipe(mapContentFailure("subject"));
    const bodyInput = raw.body === undefined ? { text: raw.text, html: raw.html } : raw.body;
    const body = yield* parseMessageBody(bodyInput).pipe(mapContentFailure("body"));
    const attachments = yield* parseAttachments(raw.attachments);
    const headers = yield* parseMessageHeaders(raw.headers);
    return {
      messageType: "EmailMessage",
      from,
      to,
      ...(cc !== undefined ? { cc } : {}),
      ...(bcc !== undefined ? { bcc } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
      subject,
      body,
      ...(attachments !== undefined ? { attachments } : {}),
      ...(headers !== undefined ? { headers } : {}),
    };
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
          if (recipientCount > config.maxRecipients) {
            return yield* new SendPolicyViolation({
              reason: "TooManyRecipients",
              limit: config.maxRecipients,
              retryable: false,
            });
          }
          if (isBodyEmpty(message.body)) {
            return yield* new SendPolicyViolation({
              reason: "EmptyBody",
              limit: 1,
              retryable: false,
            });
          }
          if (utf8Bytes(message.subject) > config.maxSubjectBytes) {
            return yield* new SendPolicyViolation({
              reason: "SubjectTooLarge",
              limit: config.maxSubjectBytes,
              retryable: false,
            });
          }
          if (textBodyBytes(message.body) > config.maxTextBodyBytes) {
            return yield* new SendPolicyViolation({
              reason: "TextBodyTooLarge",
              limit: config.maxTextBodyBytes,
              retryable: false,
            });
          }
          if (htmlBodyBytes(message.body) > config.maxHtmlBodyBytes) {
            return yield* new SendPolicyViolation({
              reason: "HtmlBodyTooLarge",
              limit: config.maxHtmlBodyBytes,
              retryable: false,
            });
          }
          const attachments = message.attachments ?? [];
          if (attachments.length > config.maxAttachments) {
            return yield* new SendPolicyViolation({
              reason: "TooManyAttachments",
              limit: config.maxAttachments,
              retryable: false,
            });
          }
          let total = 0;
          for (const attachment of attachments) {
            if (attachment.content.byteLength > config.maxAttachmentBytes) {
              return yield* new SendPolicyViolation({
                reason: "AttachmentTooLarge",
                limit: config.maxAttachmentBytes,
                retryable: false,
              });
            }
            total += attachment.content.byteLength;
          }
          if (total > config.maxTotalAttachmentBytes) {
            return yield* new SendPolicyViolation({
              reason: "TotalAttachmentsTooLarge",
              limit: config.maxTotalAttachmentBytes,
              retryable: false,
            });
          }
          const headers = message.headers ?? [];
          if (headers.length > config.maxHeaders) {
            return yield* new SendPolicyViolation({
              reason: "TooManyHeaders",
              limit: config.maxHeaders,
              retryable: false,
            });
          }
          let totalHeaderBytes = 0;
          for (const header of headers) {
            const nameBytes = utf8Bytes(header.name);
            if (nameBytes > config.maxHeaderNameBytes) {
              return yield* new SendPolicyViolation({
                reason: "HeaderNameTooLarge",
                limit: config.maxHeaderNameBytes,
                retryable: false,
              });
            }
            const valueBytes = utf8Bytes(header.value);
            if (valueBytes > config.maxHeaderValueBytes) {
              return yield* new SendPolicyViolation({
                reason: "HeaderValueTooLarge",
                limit: config.maxHeaderValueBytes,
                retryable: false,
              });
            }
            totalHeaderBytes += nameBytes + valueBytes;
          }
          if (totalHeaderBytes > config.maxTotalHeaderBytes) {
            return yield* new SendPolicyViolation({
              reason: "TotalHeadersTooLarge",
              limit: config.maxTotalHeaderBytes,
              retryable: false,
            });
          }
          return message;
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
