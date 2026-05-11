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
  type Mailbox,
  type EmailMessage,
  MessageBody,
  ProviderProtocolFailure,
  RateLimitFailure,
  RejectedMessageFailure,
  type SendFailure,
  SendPolicy,
  type SendReceipt,
  TransportUnavailableFailure,
} from "./index";

export const ResendConfigInput = Schema.Struct({
  apiKey: Schema.Redacted(Schema.String),
});

export interface ResendConfigShape {
  readonly apiKey: Redacted.Redacted<string>;
}

export const config: Config.Config<typeof ResendConfigInput.Type> = Config.map(
  Config.nonEmptyString("RESEND_API_KEY"),
  (apiKey) => ({ apiKey: Redacted.make(apiKey) }),
);

const HttpClientInstance = Schema.declare<HttpClient.HttpClient>(
  (input): input is HttpClient.HttpClient =>
    typeof input === "object" && input !== null && Object.hasOwn(input, "execute"),
);

const ResendConfigInstance = Schema.declare<typeof ResendConfig.Service>(
  (input): input is typeof ResendConfig.Service =>
    typeof input === "object" && input !== null && Object.hasOwn(input, "apiKey"),
);

const ResendClientInput = Schema.Struct({
  client: HttpClientInstance,
  resend: ResendConfigInstance,
});

const ResendSuccess = Schema.Struct({ id: Schema.String });
const decodeResendSuccess = Schema.decodeUnknownEffect(ResendSuccess);

export class ResendConfig extends Context.Service<
  ResendConfig,
  {
    readonly apiKey: Redacted.Redacted<string>;
  }
>()("ResendConfig") {
  static readonly layer = (input: typeof ResendConfigInput.Type) =>
    Layer.succeed(ResendConfig)(ResendConfigInput.make(input));
}

export const makeConfig = (apiKey: string): ResendConfigShape =>
  ResendConfigInput.make({ apiKey: Redacted.make(apiKey) });

export class ResendClient extends Context.Service<
  ResendClient,
  {
    readonly send: (message: EmailMessage) => Effect.Effect<SendReceipt, SendFailure>;
  }
>()("ResendClient") {
  static readonly layer = (input: typeof ResendClientInput.Type) => {
    const config = ResendClientInput.make(input);
    return ResendClient.of({
      ...config,
      send: (message) =>
        executeResendSend(
          config.client,
          Redacted.value(config.resend.apiKey),
          message,
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

const formatMailbox = (mailbox: Mailbox): string =>
  mailbox.displayName === undefined
    ? mailbox.address
    : `${mailbox.displayName} <${mailbox.address}>`;

const requestBody = (message: EmailMessage) => ({
  from: formatMailbox(message.from),
  to: message.to.map(formatMailbox),
  ...(message.cc !== undefined ? { cc: message.cc.map(formatMailbox) } : {}),
  ...(message.bcc !== undefined ? { bcc: message.bcc.map(formatMailbox) } : {}),
  ...(message.replyTo !== undefined ? { reply_to: message.replyTo.map(formatMailbox) } : {}),
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

const executeResendSend = (
  client: HttpClient.HttpClient,
  token: string,
  message: EmailMessage,
): Effect.Effect<SendReceipt, SendFailure> =>
  HttpClientRequest.post("https://api.resend.com/emails").pipe(
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.acceptJson,
    HttpClientRequest.bodyJson(requestBody(message)),
    Effect.flatMap(client.execute),
    Effect.mapError(
      () =>
        new TransportUnavailableFailure({
          provider: "resend",
          retryable: true,
        }),
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

export const policyConfig: typeof SendPolicy.defaultConfig = SendPolicy.defaultConfig;

export const policyLayer: Layer.Layer<SendPolicy> = Layer.succeed(
  SendPolicy,
  SendPolicy.layer(policyConfig),
);

export const clientLayer: Layer.Layer<ResendClient, Config.ConfigError, HttpClient.HttpClient> =
  Layer.effect(
    ResendClient,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const resend = yield* ResendConfig;
      return ResendClient.layer({ client, resend });
    }),
  ).pipe(
    Layer.provide(
      Layer.unwrap(config.asEffect().pipe(Effect.map((input) => ResendConfig.layer(input)))),
    ),
  );

export const layer: Layer.Layer<Email, never, ResendClient | SendPolicy> = Layer.effect(
  Email,
  Effect.gen(function* () {
    const resend = yield* ResendClient;
    const policy = yield* SendPolicy;
    return Email.layer({
      send: (message) => policy.validate(message).pipe(Effect.flatMap(resend.send)),
    });
  }),
);

export const defaultLayer: Layer.Layer<Email, Config.ConfigError> = layer.pipe(
  Layer.provide(policyLayer),
  Layer.provide(clientLayer),
  Layer.provide(FetchHttpClient.layer),
);
