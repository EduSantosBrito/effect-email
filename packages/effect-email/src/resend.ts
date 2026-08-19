import {
  Cause,
  Config,
  Context,
  Data,
  DateTime,
  Effect,
  Layer,
  Option,
  Predicate,
  Redacted,
  Schema,
} from "effect";
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  AmbiguousSendFailure,
  AuthenticationFailure,
  Email,
  type EmailMessage,
  ProviderProtocolFailure,
  RateLimitFailure,
  RejectedMessageFailure,
  RetryAfter,
  type RetryAfter as RetryAfterShape,
  type SendFailure,
  type SendFailureMetadata,
  type SendOptions,
  SendPolicy,
  type SendReceipt,
  TransportUnavailableFailure,
} from "./index.js";
import { formatHttpDate } from "./internal/http-date.js";
import { requestBody } from "./internal/resend-request.js";

export const ResendConfigInput = Schema.Struct({
  apiKey: Schema.Redacted(Schema.String),
});
export type ResendConfigInput = typeof ResendConfigInput.Type;

export interface ResendConfigShape {
  readonly apiKey: Redacted.Redacted<string>;
}

export const config: Config.Config<ResendConfigInput> = Config.map(
  Config.nonEmptyString("RESEND_API_KEY"),
  (apiKey) => ({ apiKey: Redacted.make(apiKey) }),
);

export const makeConfig = (apiKey: string): ResendConfigInput =>
  ResendConfigInput.make({ apiKey: Redacted.make(apiKey) });

const HttpClientInput = Schema.declare<HttpClient.HttpClient>(
  (input): input is HttpClient.HttpClient => input !== undefined && input !== null,
);

const ResendConfigServiceInput = Schema.declare<typeof ResendConfig.Service>(
  (input): input is typeof ResendConfig.Service => input !== undefined && input !== null,
);

const ResendClientInput = Schema.Struct({
  client: HttpClientInput,
  resend: ResendConfigServiceInput,
});

const ResendSuccess = Schema.Struct({
  id: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.makeFilter((value: string) => value.trim().length > 0, {
      expected: "a non-blank Resend message ID",
    }),
  ),
});
const decodeResendSuccess = Schema.decodeUnknownEffect(ResendSuccess);

export class ResendConfig extends Context.Service<
  ResendConfig,
  {
    readonly apiKey: Redacted.Redacted<string>;
  }
>()("@effect-email/ResendConfig") {
  static readonly layer = (input: typeof ResendConfigInput.Type) =>
    Layer.succeed(ResendConfig)(ResendConfigInput.make(input));
}

export class ResendClient extends Context.Service<
  ResendClient,
  {
    readonly send: (
      message: EmailMessage,
      options?: SendOptions,
    ) => Effect.Effect<SendReceipt, SendFailure>;
  }
>()("@effect-email/ResendClient") {
  static readonly layer = (input: typeof ResendClientInput.Type) => {
    const config = ResendClientInput.make(input);
    return ResendClient.of({
      ...config,
      send: (message, options) =>
        executeResendSend(config.client, Redacted.value(config.resend.apiKey), message, options),
    });
  };
}

const delaySecondsPattern = /^\d+$/;
const imfFixdatePattern =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (?:0[1-9]|[12]\d|3[01]) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const rfc850DatePattern =
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (?:0[1-9]|[12]\d|3[01])-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$/;
const asctimeDatePattern =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: [1-9]|[12]\d|3[01]) \d{2}:\d{2}:\d{2} \d{4}$/;
const printableRequestIdPattern = /^[ -~]{1,256}$/;
const decodeRetryAfter = Schema.decodeUnknownOption(RetryAfter);
const RetryAfterVariants = Data.taggedEnum<RetryAfterShape>();

const parseRetryAfter = (value: string | undefined): RetryAfterShape | undefined => {
  if (value === undefined) return undefined;
  if (delaySecondsPattern.test(value)) {
    const seconds = Number(value);
    return Option.getOrUndefined(decodeRetryAfter(RetryAfterVariants.DelaySeconds({ seconds })));
  }
  if (
    !imfFixdatePattern.test(value) &&
    !rfc850DatePattern.test(value) &&
    !asctimeDatePattern.test(value)
  ) {
    return undefined;
  }
  return Option.match(DateTime.make(value), {
    onNone: () => undefined,
    onSome: (dateTime) => {
      const canonical = formatHttpDate(dateTime);
      return canonical === undefined
        ? undefined
        : Option.getOrUndefined(
            decodeRetryAfter(RetryAfterVariants.HttpDate({ value: canonical })),
          );
    },
  });
};

const responseMetadata = (response: HttpClientResponse.HttpClientResponse): SendFailureMetadata => {
  const retryAfter = parseRetryAfter(
    Option.getOrUndefined(Headers.get(response.headers, "retry-after")),
  );
  const rawRequestId = Option.getOrUndefined(Headers.get(response.headers, "x-request-id"));
  const requestId =
    rawRequestId !== undefined && printableRequestIdPattern.test(rawRequestId)
      ? rawRequestId
      : undefined;
  return {
    ...(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
      ? { status: response.status }
      : {}),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(requestId !== undefined ? { requestId } : {}),
  };
};

const classifyStatus = (status: number, metadata: SendFailureMetadata): SendFailure => {
  if (status === 401 || status === 403) {
    return new AuthenticationFailure({
      provider: "resend",
      metadata,
      disposition: "permanent",
      retryable: false,
    });
  }
  if (status === 429) {
    return new RateLimitFailure({
      provider: "resend",
      metadata,
      disposition: "retryable",
      retryable: true,
    });
  }
  if (status >= 400 && status < 500) {
    return new RejectedMessageFailure({
      provider: "resend",
      metadata,
      disposition: "permanent",
      retryable: false,
    });
  }
  if (status >= 500 && status < 600) {
    return new TransportUnavailableFailure({
      provider: "resend",
      metadata,
      disposition: "retryable",
      retryable: true,
    });
  }
  return new ProviderProtocolFailure({
    provider: "resend",
    metadata,
    disposition: "permanent",
    retryable: false,
  });
};

const executeResendSend = (
  client: HttpClient.HttpClient,
  token: string,
  message: EmailMessage,
  options?: SendOptions,
): Effect.Effect<SendReceipt, SendFailure> =>
  HttpClientRequest.post("https://api.resend.com/emails").pipe(
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.acceptJson,
    HttpClientRequest.setHeaders({ "Idempotency-Key": options?.idempotencyKey }),
    HttpClientRequest.bodyJsonUnsafe(requestBody(message)),
    client.execute,
    Effect.catch((error) => {
      if (error.response !== undefined) return Effect.succeed(error.response);
      return Predicate.isTagged(error.reason, "TransportError")
        ? Effect.fail(
            new AmbiguousSendFailure({
              provider: "resend",
              disposition: "ambiguous",
              retryable: false,
            }),
          )
        : Effect.failCause(Cause.die(error));
    }),
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
                new AmbiguousSendFailure({
                  provider: "resend",
                  metadata: responseMetadata(response),
                  disposition: "ambiguous",
                  retryable: false,
                }),
            ),
          )
        : Effect.fail(classifyStatus(response.status, responseMetadata(response))),
    ),
  );

export const policyConfig: SendPolicy.Config = SendPolicy.defaultConfig;

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
    }).pipe(Effect.annotateLogs({ service: "@effect-email/ResendClient" })),
  ).pipe(Layer.provide(Layer.unwrap(Effect.map(config, (input) => ResendConfig.layer(input)))));

export const layer: Layer.Layer<Email, never, ResendClient | SendPolicy> = Layer.effect(
  Email,
  Effect.gen(function* () {
    const resend = yield* ResendClient;
    const policy = yield* SendPolicy;
    return Email.layer({ policy, send: resend.send });
  }).pipe(Effect.annotateLogs({ service: "@effect-email/Email" })),
);

export const defaultLayer: Layer.Layer<Email, Config.ConfigError> = layer.pipe(
  Layer.provide(policyLayer),
  Layer.provide(clientLayer),
  Layer.provide(FetchHttpClient.layer),
);
