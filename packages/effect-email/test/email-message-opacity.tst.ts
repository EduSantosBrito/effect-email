import { expect, test } from "tstyche";
import type { EmailMessage } from "effect-email";

test("EmailMessage is constructor-only", () => {
  expect({
    messageType: "EmailMessage" as const,
    from: undefined as never,
    to: undefined as never,
    subject: undefined as never,
    body: undefined as never,
  }).type.not.toBeAssignableTo<EmailMessage>();
});
