import { Option } from "effect";
import { MessageBody, type EmailMessage, type Mailbox } from "../index";

interface SmtpAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Buffer<ArrayBufferLike>;
  readonly cid?: string;
}

export interface SmtpMailOptions {
  readonly from: string;
  readonly to: string[];
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly attachments?: SmtpAttachment[];
}

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

export const mailOptions = (message: EmailMessage): SmtpMailOptions => ({
  from: formatMailbox(message.from),
  to: message.to.map(formatMailbox),
  subject: message.subject,
  ...Option.match(bodyText(message.body), {
    onNone: () => ({}),
    onSome: (text) => ({ text }),
  }),
  ...Option.match(bodyHtml(message.body), {
    onNone: () => ({}),
    onSome: (html) => ({ html }),
  }),
  ...Option.match(Option.fromUndefinedOr(message.attachments), {
    onNone: () => ({}),
    onSome: (attachments) => ({
      attachments: attachments.map((attachment) => ({
        filename: attachment.name,
        contentType: attachment.mediaType,
        content: Buffer.from(attachment.content),
        ...(attachment.contentId !== undefined ? { cid: attachment.contentId } : {}),
      })),
    }),
  }),
});
