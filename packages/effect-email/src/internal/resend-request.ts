import { Option } from "effect";
import { MessageBody, type EmailMessage, type Mailbox } from "../index";

const encodeAttachment = (content: Uint8Array): string => Buffer.from(content).toString("base64");

const encodeBody = MessageBody.$match({
  TextOnly: ({ text }) => ({ text }),
  HtmlOnly: ({ html }) => ({ html }),
  TextAndHtml: ({ text, html }) => ({ text, html }),
});

const formatMailbox = (mailbox: Mailbox): string =>
  mailbox.displayName === undefined
    ? mailbox.address
    : `${mailbox.displayName} <${mailbox.address}>`;

export const requestBody = (message: EmailMessage) => ({
  from: formatMailbox(message.from),
  to: message.to.map(formatMailbox),
  ...(message.cc !== undefined ? { cc: message.cc.map(formatMailbox) } : {}),
  ...(message.bcc !== undefined ? { bcc: message.bcc.map(formatMailbox) } : {}),
  ...(message.replyTo !== undefined ? { reply_to: message.replyTo.map(formatMailbox) } : {}),
  subject: message.subject,
  ...encodeBody(message.body),
  ...(message.attachments !== undefined
    ? {
        attachments: message.attachments.map((attachment) => ({
          filename: attachment.name,
          content_type: attachment.mediaType,
          content: encodeAttachment(attachment.content),
        })),
      }
    : {}),
  ...Option.match(Option.fromUndefinedOr(message.headers), {
    onNone: () => ({}),
    onSome: (headers) => ({
      headers: Object.fromEntries(headers.map((header) => [header.name, header.value])),
    }),
  }),
});
