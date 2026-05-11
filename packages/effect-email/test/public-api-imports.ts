import {
  Attachment,
  AuthenticationFailure,
  Email,
  EmailMessage,
  EmailMessageValidationFailure,
  Mailbox,
  MailboxValidationFailure,
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
  type DisplayName,
  type EmailAddress,
  type EmailMessage as EmailMessageShape,
  type EmailMessageInput,
  type EmailSend,
  type Mailbox as MailboxShape,
  type MailboxInput,
  type MediaType,
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
  makeConfig,
  policyConfig,
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
    | typeof Email
    | typeof EmailMessage
    | typeof EmailMessageValidationFailure
    | typeof Mailbox
    | typeof MailboxValidationFailure
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
    | DisplayName
    | EmailAddress
    | EmailMessageShape
    | EmailMessageInput
    | EmailSend
    | MailboxShape
    | MailboxInput
    | MediaType
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
    | typeof makeConfig
    | typeof policyConfig
    | ResendConfigInput
    | ResendConfigShape;
  readonly test: typeof TestEmailInspection | typeof testDefaultLayer | typeof testLayer;
};

export type { PublicApiContract };
