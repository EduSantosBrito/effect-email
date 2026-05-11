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
  type EmailSend,
  type SendFailure,
  type SendPolicyConfig,
  type SendReceipt,
} from "effect-email";
import {
  ResendClient,
  ResendConfig,
  ResendConfigInput,
  clientLayer,
  config,
  defaultLayer,
  layer,
  makeConfig,
  policyConfig,
  policyLayer,
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

export const rootApi = [
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
];

export const resendApi = [
  ResendClient,
  ResendConfig,
  ResendConfigInput,
  clientLayer,
  config,
  defaultLayer,
  layer,
  makeConfig,
  policyConfig,
  policyLayer,
];

export const testApi = [
  TestEmailAdapter,
  TestEmailInspection,
  testDefaultLayer,
  testLayer,
  testPolicyConfig,
  testPolicyLayer,
];

export type PublicApiTypes = {
  readonly emailSend: EmailSend;
  readonly resendConfig: ResendConfigShape;
  readonly sendFailure: SendFailure;
  readonly sendPolicyConfig: SendPolicyConfig;
  readonly sendReceipt: SendReceipt;
};
