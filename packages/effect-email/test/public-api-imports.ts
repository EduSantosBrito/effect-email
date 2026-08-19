import {
  AmbiguousSendFailure,
  Attachment,
  AttachmentInput,
  AuthenticationFailure,
  ContentId,
  DisplayName,
  Email,
  EmailAddress,
  EmailHeader,
  EmailHeaders,
  EmailHeaderInput,
  EmailHeaderName,
  EmailHeaderValidationFailure,
  EmailHeadersRecordInput,
  EmailHeaderValue,
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
  HtmlBody,
  IdempotencyKey,
  RetryAfter,
  SendFailureDisposition,
  SendFailureMetadata,
  SendOptions,
  SendOptionsInput,
  SendOptionsValidationFailure,
  TransportUnavailableFailure,
  Subject,
  TextBody,
  type Attachment as AttachmentShape,
  type AttachmentInput as AttachmentInputShape,
  type ContentId as ContentIdShape,
  type DisplayName as DisplayNameShape,
  type EmailAddress as EmailAddressShape,
  type EmailHeader as EmailHeaderShape,
  type EmailHeaderInput as EmailHeaderInputShape,
  type EmailHeaderName as EmailHeaderNameShape,
  type EmailHeaders as EmailHeadersShape,
  type EmailHeadersRecordInput as EmailHeadersRecordInputShape,
  type EmailHeaderValue as EmailHeaderValueShape,
  type EmailMessageInput as EmailMessageInputShape,
  type HtmlBody as HtmlBodyShape,
  type IdempotencyKey as IdempotencyKeyShape,
  type EmailSend,
  type Mailbox as MailboxShape,
  type MailboxInput as MailboxInputShape,
  type MediaType as MediaTypeShape,
  type MessageBody as MessageBodyShape,
  type MessageBodyInput as MessageBodyInputShape,
  type RetryAfter as RetryAfterShape,
  type SendFailure,
  type SendFailureDisposition as SendFailureDispositionShape,
  type SendFailureMetadata as SendFailureMetadataShape,
  type SendOptions as SendOptionsShape,
  type SendOptionsInput as SendOptionsInputShape,
  type SendPolicyConfig,
  type SendReceipt,
  type Subject as SubjectShape,
  type TextBody as TextBodyShape,
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
  SmtpClient,
  SmtpConfig,
  SmtpConfigInput,
  clientLayer as smtpClientLayer,
  config as smtpConfig,
  defaultLayer as smtpDefaultLayer,
  layer as smtpLayer,
  makeConfig as makeSmtpConfig,
  policyConfig as smtpPolicyConfig,
  policyLayer as smtpPolicyLayer,
  type SmtpConfigInput as SmtpConfigInputShape,
  type SmtpConfigShape,
} from "effect-email/smtp";
import {
  TestEmailAdapter,
  TestEmailControl,
  TestEmailInspection,
  TestEmailOutcome,
  defaultLayer as testDefaultLayer,
  layer as testLayer,
  policyConfig as testPolicyConfig,
  policyLayer as testPolicyLayer,
  type TestEmailAttempt,
  type TestEmailOutcome as TestEmailOutcomeShape,
} from "effect-email/test";

type PublicApiContract = {
  readonly root:
    | typeof AmbiguousSendFailure
    | typeof Attachment
    | typeof AttachmentInput
    | typeof AuthenticationFailure
    | typeof ContentId
    | typeof DisplayName
    | typeof Email
    | typeof EmailAddress
    | typeof EmailHeader
    | typeof EmailHeaders
    | typeof EmailHeaderInput
    | typeof EmailHeaderName
    | typeof EmailHeaderValidationFailure
    | typeof EmailHeadersRecordInput
    | typeof EmailHeaderValue
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
    | typeof HtmlBody
    | typeof IdempotencyKey
    | typeof RetryAfter
    | typeof SendFailureDisposition
    | typeof SendFailureMetadata
    | typeof SendOptions
    | typeof SendOptionsInput
    | typeof SendOptionsValidationFailure
    | typeof TransportUnavailableFailure
    | typeof Subject
    | typeof TextBody
    | AttachmentShape
    | AttachmentInputShape
    | ContentIdShape
    | DisplayNameShape
    | EmailAddressShape
    | EmailHeaderShape
    | EmailHeaderInputShape
    | EmailHeaderNameShape
    | EmailHeadersShape
    | EmailHeadersRecordInputShape
    | EmailHeaderValueShape
    | EmailMessageInputShape
    | HtmlBodyShape
    | IdempotencyKeyShape
    | EmailSend
    | MailboxShape
    | MailboxInputShape
    | MediaTypeShape
    | MessageBodyShape
    | MessageBodyInputShape
    | RetryAfterShape
    | SendFailure
    | SendFailureDispositionShape
    | SendFailureMetadataShape
    | SendOptionsShape
    | SendOptionsInputShape
    | SendPolicyConfig
    | SendReceipt
    | SubjectShape
    | TextBodyShape;
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
  readonly smtp:
    | typeof SmtpClient
    | typeof SmtpConfig
    | typeof SmtpConfigInput
    | typeof smtpClientLayer
    | typeof smtpConfig
    | typeof smtpDefaultLayer
    | typeof smtpLayer
    | typeof makeSmtpConfig
    | typeof smtpPolicyConfig
    | typeof smtpPolicyLayer
    | SmtpConfigInputShape
    | SmtpConfigShape;
  readonly test:
    | typeof TestEmailAdapter
    | typeof TestEmailControl
    | typeof TestEmailInspection
    | typeof TestEmailOutcome
    | typeof testDefaultLayer
    | typeof testLayer
    | typeof testPolicyConfig
    | typeof testPolicyLayer
    | TestEmailAttempt
    | TestEmailOutcomeShape;
};

export type { PublicApiContract };
