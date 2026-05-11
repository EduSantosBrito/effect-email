import {
  Attachment,
  AttachmentInput,
  AuthenticationFailure,
  DisplayName,
  Email,
  EmailAddress,
  EmailMessage,
  EmailMessageInput,
  EmailMessageValidationFailure,
  Mailbox,
  MailboxInput,
  MailboxValidationFailure,
  MediaType,
  MessageBody,
  MessageBodyInput,
  MessageContentValidationFailure,
  ProviderProtocolFailure,
  RateLimitFailure,
  RejectedMessageFailure,
  SendPolicy,
  SendPolicyConfigInput,
  SendPolicyViolation,
  TransportUnavailableFailure,
  type Attachment as AttachmentShape,
  type AttachmentInput as AttachmentInputShape,
  type DisplayName as DisplayNameShape,
  type EmailAddress as EmailAddressShape,
  type EmailMessage as EmailMessageShape,
  type EmailMessageInput as EmailMessageInputShape,
  type EmailSend,
  type Mailbox as MailboxShape,
  type MailboxInput as MailboxInputShape,
  type MediaType as MediaTypeShape,
  type MessageBody as MessageBodyShape,
  type MessageBodyInput as MessageBodyInputShape,
  type SendFailure,
  type SendPolicyConfig,
  type SendReceipt,
} from "effect-email";
import {
  ResendClient,
  ResendConfig,
  clientLayer,
  config,
  defaultLayer,
  layer,
  makeConfig,
  policyConfig,
  policyLayer,
  type ResendConfigInput,
  type ResendConfigShape,
} from "effect-email/resend";
import {
  TestEmailAdapter,
  TestEmailInspection,
  defaultLayer as testDefaultLayer,
  layer as testLayer,
  policyConfig as testPolicyConfig,
  policyLayer as testPolicyLayer,
} from "effect-email/test";

type PublicApiContract = {
  readonly root:
    | typeof Attachment
    | typeof AttachmentInput
    | typeof AuthenticationFailure
    | typeof DisplayName
    | typeof Email
    | typeof EmailAddress
    | typeof EmailMessage
    | typeof EmailMessageInput
    | typeof EmailMessageValidationFailure
    | typeof Mailbox
    | typeof MailboxInput
    | typeof MailboxValidationFailure
    | typeof MediaType
    | typeof MessageBody
    | typeof MessageBodyInput
    | typeof MessageContentValidationFailure
    | typeof ProviderProtocolFailure
    | typeof RateLimitFailure
    | typeof RejectedMessageFailure
    | typeof SendPolicy
    | typeof SendPolicyConfigInput
    | typeof SendPolicyViolation
    | typeof TransportUnavailableFailure
    | AttachmentShape
    | AttachmentInputShape
    | DisplayNameShape
    | EmailAddressShape
    | EmailMessageShape
    | EmailMessageInputShape
    | EmailSend
    | MailboxShape
    | MailboxInputShape
    | MediaTypeShape
    | MessageBodyShape
    | MessageBodyInputShape
    | SendFailure
    | SendPolicyConfig
    | SendReceipt;
  readonly resend:
    | typeof ResendClient
    | typeof ResendConfig
    | typeof clientLayer
    | typeof config
    | typeof defaultLayer
    | typeof layer
    | typeof makeConfig
    | typeof policyConfig
    | typeof policyLayer
    | ResendConfigInput
    | ResendConfigShape;
  readonly test:
    | typeof TestEmailAdapter
    | typeof TestEmailInspection
    | typeof testDefaultLayer
    | typeof testLayer
    | typeof testPolicyConfig
    | typeof testPolicyLayer;
};

export type { PublicApiContract };
