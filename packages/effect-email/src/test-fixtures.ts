import { EmailMessage, type EmailMessageInput } from "./index";

export const makeMessage = (input: Partial<EmailMessageInput> = {}) =>
  EmailMessage.make({
    from: "Sender <sender@example.com>",
    to: "you@example.com",
    subject: "Hello",
    text: "Plain",
    ...input,
  });
