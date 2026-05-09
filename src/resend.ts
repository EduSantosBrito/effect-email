import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  AuthenticationFailure,
  Email,
  type EmailMessage,
  ProviderProtocolFailure,
  RateLimitFailure,
  RejectedMessageFailure,
  type ResendConfig,
  resendConfig,
  type EmailShape,
  type SendFailure,
  type SendReceipt,
  SendPolicyService,
  TransportUnavailableFailure,
  defaultPolicyLayer,
  unsafeFormatMailboxForAdapter,
  unsafeRedactedValueForAdapter,
} from "./index";

export type { ResendConfig };
export { resendConfig as config };

const ResendSuccess = Schema.Struct({ id: Schema.String });
const decodeResendSuccess = Schema.decodeUnknownEffect(ResendSuccess);

export class ResendAdapter extends Context.Service<ResendAdapter, EmailShape>()(
  "effect-email/ResendAdapter",
) {}

const encodeAttachment = (content: Uint8Array): string => Buffer.from(content).toString("base64");

const requestBody = (message: EmailMessage) => ({
  from: unsafeFormatMailboxForAdapter(message.from),
  to: message.to.map(unsafeFormatMailboxForAdapter),
  ...(message.cc !== undefined ? { cc: message.cc.map(unsafeFormatMailboxForAdapter) } : {}),
  ...(message.bcc !== undefined ? { bcc: message.bcc.map(unsafeFormatMailboxForAdapter) } : {}),
  ...(message.replyTo !== undefined
    ? { reply_to: message.replyTo.map(unsafeFormatMailboxForAdapter) }
    : {}),
  subject: message.subject,
  ...(message.body._tag === "TextOnly" || message.body._tag === "TextAndHtml"
    ? { text: message.body.text }
    : {}),
  ...(message.body._tag === "HtmlOnly" || message.body._tag === "TextAndHtml"
    ? { html: message.body.html }
    : {}),
  ...(message.attachments !== undefined
    ? {
        attachments: message.attachments.map((attachment) => ({
          filename: attachment.name,
          content_type: attachment.mediaType,
          content: encodeAttachment(attachment.content),
        })),
      }
    : {}),
});

const classifyStatus = (status: number): SendFailure => {
  if (status === 401 || status === 403) {
    return new AuthenticationFailure({ provider: "resend", retryable: false });
  }
  if (status === 429) {
    return new RateLimitFailure({ provider: "resend", retryable: true });
  }
  if (status >= 400 && status < 500) {
    return new RejectedMessageFailure({ provider: "resend", retryable: false });
  }
  if (status >= 500) {
    return new TransportUnavailableFailure({ provider: "resend", retryable: true });
  }
  return new ProviderProtocolFailure({ provider: "resend", retryable: false });
};

const makeAdapter = (
  resend: ResendConfig,
): Effect.Effect<EmailShape["send"], never, HttpClient.HttpClient | SendPolicyService> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const policy = yield* SendPolicyService;
    const token = unsafeRedactedValueForAdapter(resend.apiKey);
    return (message) =>
      policy.validate(message).pipe(
        Effect.flatMap((accepted) =>
          HttpClientRequest.post("https://api.resend.com/emails").pipe(
            HttpClientRequest.bearerToken(token),
            HttpClientRequest.acceptJson,
            HttpClientRequest.bodyJson(requestBody(accepted)),
            Effect.flatMap(client.execute),
            Effect.mapError(
              () =>
                new TransportUnavailableFailure({
                  provider: "resend",
                  retryable: true,
                }),
            ),
          ),
        ),
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? HttpClientResponse.schemaBodyJson(ResendSuccess)(response).pipe(
                Effect.flatMap(decodeResendSuccess),
                Effect.map(
                  (body): SendReceipt => ({
                    provider: "resend",
                    messageId: body.id,
                  }),
                ),
                Effect.mapError(
                  () =>
                    new ProviderProtocolFailure({
                      provider: "resend",
                      retryable: false,
                    }),
                ),
              )
            : Effect.fail(classifyStatus(response.status)),
        ),
      );
  });

const emailFromResendLayer = Layer.effect(Email)(
  Effect.gen(function* () {
    const adapter = yield* ResendAdapter;
    return { send: adapter.send };
  }),
);

export const layer = (
  resend: ResendConfig,
): Layer.Layer<Email | ResendAdapter, never, HttpClient.HttpClient> => {
  const resendLayer = Layer.effect(ResendAdapter)(
    makeAdapter(resend).pipe(Effect.map((send) => ({ send }))),
  ).pipe(Layer.provideMerge(defaultPolicyLayer));

  return emailFromResendLayer.pipe(Layer.provideMerge(resendLayer));
};

export const defaultLayer: Layer.Layer<Email | ResendAdapter, Config.ConfigError> =
  emailFromResendLayer.pipe(
    Layer.provideMerge(
      Layer.effect(ResendAdapter)(
        resendConfig.asEffect().pipe(
          Effect.flatMap((resend) => makeAdapter(resend)),
          Effect.map((send) => ({ send })),
        ),
      ).pipe(Layer.provideMerge(defaultPolicyLayer), Layer.provide(FetchHttpClient.layer)),
    ),
  );

export const makeConfig = (apiKey: string): ResendConfig => ({
  apiKey: Redacted.make(apiKey),
});
