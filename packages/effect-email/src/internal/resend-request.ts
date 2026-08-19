import { Option, Schema, SchemaTransformation } from "effect";
import { MessageBody, type EmailMessage, type Mailbox } from "../index.js";

const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const asciiDecoder = new TextDecoder();

const encodeAttachment = (content: Uint8Array): string => {
  const encoded = new Uint8Array(Math.ceil(content.byteLength / 3) * 4);
  for (let inputIndex = 0, outputIndex = 0; inputIndex < content.byteLength; inputIndex += 3) {
    const first = content[inputIndex] ?? 0;
    const second = content[inputIndex + 1] ?? 0;
    const third = content[inputIndex + 2] ?? 0;
    encoded[outputIndex++] = base64Alphabet.charCodeAt(first >> 2);
    encoded[outputIndex++] = base64Alphabet.charCodeAt(((first & 0x03) << 4) | (second >> 4));
    encoded[outputIndex++] =
      inputIndex + 1 < content.byteLength
        ? base64Alphabet.charCodeAt(((second & 0x0f) << 2) | (third >> 6))
        : 61;
    encoded[outputIndex++] =
      inputIndex + 2 < content.byteLength ? base64Alphabet.charCodeAt(third & 0x3f) : 61;
  }
  return asciiDecoder.decode(encoded);
};

const ResendAttachment = Schema.Struct({
  filename: Schema.String,
  content_type: Schema.String,
  content: Schema.String,
  content_id: Schema.optionalKey(Schema.String),
});

const ResendRequestBody = Schema.Struct({
  from: Schema.String,
  to: Schema.Array(Schema.String),
  cc: Schema.optionalKey(Schema.Array(Schema.String)).pipe(
    Schema.decodeTo(
      Schema.Option(Schema.Array(Schema.String)),
      SchemaTransformation.optionFromOptionalKey(),
    ),
  ),
  bcc: Schema.optionalKey(Schema.Array(Schema.String)).pipe(
    Schema.decodeTo(
      Schema.Option(Schema.Array(Schema.String)),
      SchemaTransformation.optionFromOptionalKey(),
    ),
  ),
  reply_to: Schema.optionalKey(Schema.Array(Schema.String)).pipe(
    Schema.decodeTo(
      Schema.Option(Schema.Array(Schema.String)),
      SchemaTransformation.optionFromOptionalKey(),
    ),
  ),
  subject: Schema.String,
  text: Schema.optionalKey(Schema.String).pipe(
    Schema.decodeTo(Schema.Option(Schema.String), SchemaTransformation.optionFromOptionalKey()),
  ),
  html: Schema.optionalKey(Schema.String).pipe(
    Schema.decodeTo(Schema.Option(Schema.String), SchemaTransformation.optionFromOptionalKey()),
  ),
  attachments: Schema.optionalKey(Schema.Array(ResendAttachment)).pipe(
    Schema.decodeTo(
      Schema.Option(Schema.Array(ResendAttachment)),
      SchemaTransformation.optionFromOptionalKey(),
    ),
  ),
  headers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)).pipe(
    Schema.decodeTo(
      Schema.Option(Schema.Record(Schema.String, Schema.String)),
      SchemaTransformation.optionFromOptionalKey(),
    ),
  ),
});

type ResendRequestBody = typeof ResendRequestBody.Type;

const encodeResendRequestBody = Schema.encodeUnknownSync(ResendRequestBody);

const bodyText = MessageBody.$match({
  TextOnly: ({ text }) => Option.some(text),
  HtmlOnly: () => Option.none<string>(),
  TextAndHtml: ({ text }) => Option.some(text),
});

const bodyHtml = MessageBody.$match({
  TextOnly: () => Option.none<string>(),
  HtmlOnly: ({ html }) => Option.some(html),
  TextAndHtml: ({ html }) => Option.some(html),
});

const formatMailbox = (mailbox: Mailbox): string =>
  Option.getOrElse(
    Option.map(
      Option.fromUndefinedOr(mailbox.displayName),
      (displayName) => `${displayName} <${mailbox.address}>`,
    ),
    () => mailbox.address,
  );

const toResendRequestBody = (message: EmailMessage): ResendRequestBody => ({
  from: formatMailbox(message.from),
  to: message.to.map(formatMailbox),
  cc: Option.map(Option.fromUndefinedOr(message.cc), (cc) => cc.map(formatMailbox)),
  bcc: Option.map(Option.fromUndefinedOr(message.bcc), (bcc) => bcc.map(formatMailbox)),
  reply_to: Option.map(Option.fromUndefinedOr(message.replyTo), (replyTo) =>
    replyTo.map(formatMailbox),
  ),
  subject: message.subject,
  text: bodyText(message.body),
  html: bodyHtml(message.body),
  attachments: Option.map(Option.fromUndefinedOr(message.attachments), (attachments) =>
    attachments.map((attachment) => ({
      filename: attachment.name,
      content_type: attachment.mediaType,
      content: encodeAttachment(attachment.content),
      ...(attachment.contentId !== undefined ? { content_id: attachment.contentId } : {}),
    })),
  ),
  headers: Option.map(Option.fromUndefinedOr(message.headers), (headers) =>
    Object.fromEntries(headers.values.map((header) => [header.name, header.value])),
  ),
});

export const requestBody = (message: EmailMessage) =>
  encodeResendRequestBody(toResendRequestBody(message));
