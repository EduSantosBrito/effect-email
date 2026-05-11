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
  MessageBody,
  ProviderProtocolFailure,
  RateLimitFailure,
  RejectedMessageFailure,
  type ResendConfig,
  resendConfig,
  type SendFailure,
  type SendPolicyServiceShape,
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

export const ResendAdapterInput = Schema.Struct({
  apiKey: Schema.Redacted(Schema.String),
  client: Schema.declare<HttpClient.HttpClient>(
    (input): input is HttpClient.HttpClient =>
      typeof input === "object" && input !== null && Object.hasOwn(input, "execute"),
  ),
  policy: Schema.declare<SendPolicyServiceShape>(
    (input): input is SendPolicyServiceShape =>
      typeof input === "object" && input !== null && Object.hasOwn(input, "validate"),
  ),
});

export class ResendAdapter extends Context.Service<
  ResendAdapter,
  {
    readonly send: (message: EmailMessage) => Effect.Effect<SendReceipt, SendFailure>;
  }
>()("ResendAdapter") {
  static readonly layer = (input: typeof ResendAdapterInput.Type) => {
    const config = ResendAdapterInput.make(input);
    return ResendAdapter.of({
      ...config,
      send: (message) =>
        config.policy.validate(message).pipe(
          Effect.flatMap((accepted) =>
            HttpClientRequest.post("https://api.resend.com/emails").pipe(
              HttpClientRequest.bearerToken(unsafeRedactedValueForAdapter(config.apiKey)),
              HttpClientRequest.acceptJson,
              HttpClientRequest.bodyJson(requestBody(accepted)),
              Effect.flatMap(config.client.execute),
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
        ),
    });
  };
}

const encodeAttachment = (content: Uint8Array): string => Buffer.from(content).toString("base64");

const encodeBody = MessageBody.$match({
  TextOnly: ({ text }) => ({ text }),
  HtmlOnly: ({ html }) => ({ html }),
  TextAndHtml: ({ text, html }) => ({ text, html }),
});

const requestBody = (message: EmailMessage) => ({
  from: unsafeFormatMailboxForAdapter(message.from),
  to: message.to.map(unsafeFormatMailboxForAdapter),
  ...(message.cc !== undefined ? { cc: message.cc.map(unsafeFormatMailboxForAdapter) } : {}),
  ...(message.bcc !== undefined ? { bcc: message.bcc.map(unsafeFormatMailboxForAdapter) } : {}),
  ...(message.replyTo !== undefined
    ? { reply_to: message.replyTo.map(unsafeFormatMailboxForAdapter) }
    : {}),
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

const emailFromResendLayer = Layer.effect(Email)(
  Effect.gen(function* () {
    const adapter = yield* ResendAdapter;
    return Email.layer({ send: adapter.send });
  }),
);

export const layer = (
  resend: ResendConfig,
): Layer.Layer<Email | ResendAdapter, never, HttpClient.HttpClient | SendPolicyService> => {
  const resendLayer = Layer.effect(ResendAdapter)(
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const policy = yield* SendPolicyService;
      return ResendAdapter.layer({ ...resend, client, policy });
    }),
  );

  return emailFromResendLayer.pipe(Layer.provideMerge(resendLayer));
};

export const defaultPolicyLayerFor = (
  resend: ResendConfig,
): Layer.Layer<Email | ResendAdapter | SendPolicyService, never, HttpClient.HttpClient> =>
  layer(resend).pipe(Layer.provideMerge(defaultPolicyLayer));

export const defaultLayer: Layer.Layer<Email | ResendAdapter, Config.ConfigError> =
  emailFromResendLayer.pipe(
    Layer.provideMerge(
      Layer.effect(ResendAdapter)(
        resendConfig.asEffect().pipe(
          Effect.flatMap((resend) =>
            Effect.gen(function* () {
              const client = yield* HttpClient.HttpClient;
              const policy = yield* SendPolicyService;
              return ResendAdapter.layer({ ...resend, client, policy });
            }),
          ),
        ),
      ).pipe(Layer.provideMerge(defaultPolicyLayer), Layer.provide(FetchHttpClient.layer)),
    ),
  );

export const makeConfig = (apiKey: string): ResendConfig => ({
  apiKey: Redacted.make(apiKey),
});
