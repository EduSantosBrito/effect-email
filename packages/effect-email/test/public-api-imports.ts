import {
  Attachment,
  AuthenticationFailure,
  DisplayName,
  Email,
  EmailAddress,
  EmailMessage,
  EmailMessageValidationFailure,
  Mailbox,
  MailboxValidationFailure,
  MediaType,
  MessageBody,
  MessageContentValidationFailure,
  ProviderProtocolFailure,
  RateLimitFailure,
  RejectedMessageFailure,
  SendPolicy,
  SendPolicyViolation,
  TransportUnavailableFailure,
  type Attachment as AttachmentShape,
  type AttachmentInput,
  type DisplayName as DisplayNameShape,
  type EmailAddress as EmailAddressShape,
  type EmailMessage as EmailMessageShape,
  type EmailMessageInput,
  type EmailSend,
  type Mailbox as MailboxShape,
  type MailboxInput,
  type MediaType as MediaTypeShape,
  type MessageBody as MessageBodyShape,
  type MessageBodyInput,
  type SendFailure,
  type SendPolicyConfig,
  type SendReceipt,
} from "effect-email";
import {
  ResendClient,
  ResendConfig,
  clientLayer,
  defaultLayer,
  layer,
  type ResendConfigInput,
  type ResendConfigShape,
} from "effect-email/resend";
import {
  TestEmailInspection,
  defaultLayer as testDefaultLayer,
  layer as testLayer,
} from "effect-email/test";

type PublicApiContract = {
  readonly root:
    | typeof Attachment
    | typeof AuthenticationFailure
    | typeof DisplayName
    | typeof Email
    | typeof EmailAddress
    | typeof EmailMessage
    | typeof EmailMessageValidationFailure
    | typeof Mailbox
    | typeof MailboxValidationFailure
    | typeof MediaType
    | typeof MessageBody
    | typeof MessageContentValidationFailure
    | typeof ProviderProtocolFailure
    | typeof RateLimitFailure
    | typeof RejectedMessageFailure
    | typeof SendPolicy
    | typeof SendPolicyViolation
    | typeof TransportUnavailableFailure
    | AttachmentShape
    | AttachmentInput
    | DisplayNameShape
    | EmailAddressShape
    | EmailMessageShape
    | EmailMessageInput
    | EmailSend
    | MailboxShape
    | MailboxInput
    | MediaTypeShape
    | MessageBodyShape
    | MessageBodyInput
    | SendFailure
    | SendPolicyConfig
    | SendReceipt;
  readonly resend:
    | typeof ResendClient
    | typeof ResendConfig
    | typeof clientLayer
    | typeof defaultLayer
    | typeof layer
    | ResendConfigInput
    | ResendConfigShape;
  readonly test: typeof TestEmailInspection | typeof testDefaultLayer | typeof testLayer;
};

export type { PublicApiContract };
