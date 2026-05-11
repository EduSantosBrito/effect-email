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
  type SendFailure,
  SendPolicy,
  type SendReceipt,
  TransportUnavailableFailure,
} from "./index";
import { requestBody } from "./internal/resend-request";

const ResendConfigInput = Schema.Struct({
  apiKey: Schema.Redacted(Schema.String),
});
export type ResendConfigInput = typeof ResendConfigInput.Type;

export interface ResendConfigShape {
  readonly apiKey: Redacted.Redacted<string>;
}

const config: Config.Config<ResendConfigInput> = Config.map(
  Config.nonEmptyString("RESEND_API_KEY"),
  (apiKey) => ({ apiKey: Redacted.make(apiKey) }),
);

const HttpClientInput = Schema.declare<HttpClient.HttpClient>((input): input is HttpClient.HttpClient =>
  input !== undefined && input !== null,
);

const ResendConfigServiceInput = Schema.declare<typeof ResendConfig.Service>(
  (input): input is typeof ResendConfig.Service => input !== undefined && input !== null,
);

const ResendClientInput = Schema.Struct({
  client: HttpClientInput,
  resend: ResendConfigServiceInput,
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

const policyLayer: Layer.Layer<SendPolicy> = Layer.succeed(
  SendPolicy,
  SendPolicy.defaultLayer,
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
