import { Option } from "effect";
import { MessageBody, type EmailMessage, type Mailbox } from "../index";

const encodeAttachment = (content: Uint8Array): string => Buffer.from(content).toString("base64");

const encodeBody = MessageBody.$match({
  TextOnly: ({ text }) => ({ text }),
  HtmlOnly: ({ html }) => ({ html }),
  TextAndHtml: ({ text, html }) => ({ text, html }),
});

const formatMailbox = (mailbox: Mailbox): string =>
  Option.match(Option.fromUndefinedOr(mailbox.displayName), {
    onNone: () => mailbox.address,
    onSome: (displayName) => `${displayName} <${mailbox.address}>`,
  });

export const requestBody = (message: EmailMessage) => ({
  from: formatMailbox(message.from),
  to: message.to.map(formatMailbox),
  ...Option.match(Option.fromUndefinedOr(message.cc), {
    onNone: () => ({}),
    onSome: (cc) => ({ cc: cc.map(formatMailbox) }),
  }),
  ...Option.match(Option.fromUndefinedOr(message.bcc), {
    onNone: () => ({}),
    onSome: (bcc) => ({ bcc: bcc.map(formatMailbox) }),
  }),
  ...Option.match(Option.fromUndefinedOr(message.replyTo), {
    onNone: () => ({}),
    onSome: (replyTo) => ({ reply_to: replyTo.map(formatMailbox) }),
  }),
  subject: message.subject,
  ...encodeBody(message.body),
  ...Option.match(Option.fromUndefinedOr(message.attachments), {
    onNone: () => ({}),
    onSome: (attachments) => ({
      attachments: attachments.map((attachment) => ({
        filename: attachment.name,
        content_type: attachment.mediaType,
        content: encodeAttachment(attachment.content),
      })),
    }),
  }),
  ...Option.match(Option.fromUndefinedOr(message.headers), {
    onNone: () => ({}),
    onSome: (headers) => ({
      headers: Object.fromEntries(headers.map((header) => [header.name, header.value])),
    }),
  }),
});
