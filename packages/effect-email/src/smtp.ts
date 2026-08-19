import nodemailer from "nodemailer";
import { Cause, Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import {
  AmbiguousSendFailure,
  AuthenticationFailure,
  Email,
  type EmailMessage,
  RejectedMessageFailure,
  type SendFailure,
  type SendOptions,
  SendPolicy,
  type SendReceipt,
  TransportUnavailableFailure,
} from "./index.js";
import { mailOptions, type SmtpMailOptions } from "./internal/smtp-mail-options.js";

const SmtpPort = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0));

export const SmtpConfigInput = Schema.Struct({
  host: Schema.String.check(Schema.isNonEmpty()),
  port: SmtpPort,
  secure: Schema.Boolean,
  user: Schema.String.check(Schema.isNonEmpty()),
  password: Schema.Redacted(Schema.String),
});
export type SmtpConfigInput = typeof SmtpConfigInput.Type;

export interface SmtpConfigShape {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user: string;
  readonly password: Redacted.Redacted<string>;
}

export const config: Config.Config<SmtpConfigInput> = Config.all({
  host: Config.nonEmptyString("SMTP_HOST"),
  port: Config.number("SMTP_PORT"),
  secure: Config.boolean("SMTP_SECURE"),
  user: Config.nonEmptyString("SMTP_USER"),
  password: Config.map(Config.nonEmptyString("SMTP_PASSWORD"), Redacted.make),
}).pipe(Config.map(SmtpConfigInput.make));

export const makeConfig = (
  input: Omit<SmtpConfigInput, "password"> & { readonly password: string },
): SmtpConfigInput => SmtpConfigInput.make({ ...input, password: Redacted.make(input.password) });

interface SmtpSentMessageInfo {
  readonly messageId?: unknown;
}

interface SmtpTransporter {
  readonly sendMail: (options: SmtpMailOptions) => PromiseLike<SmtpSentMessageInfo>;
}

const SmtpTransporterInput = Schema.declare<SmtpTransporter>(
  (input): input is SmtpTransporter => input !== undefined && input !== null,
);

const SmtpClientInput = Schema.Struct({
  transporter: SmtpTransporterInput,
});

type NodemailerErrorLike = {
  readonly code?: unknown;
  readonly command?: unknown;
  readonly responseCode?: unknown;
};

type SmtpClientError = {
  readonly cause: unknown;
};

const transientSmtpErrorCodes = new Set(["ECONNECTION", "EDNS", "ESOCKET", "ETIMEDOUT", "ETLS"]);
const phaseAwareSmtpErrorCodes = new Set([...transientSmtpErrorCodes, "EMESSAGE", "EPROTOCOL"]);
const beforeDataCommands = new Set(["EHLO", "HELO", "LHLO", "MAIL FROM", "RCPT TO", "STARTTLS"]);

const isBeforeDataCommand = (command: unknown): boolean =>
  typeof command === "string" && (beforeDataCommands.has(command) || command.startsWith("AUTH "));

export class SmtpConfig extends Context.Service<
  SmtpConfig,
  {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly user: string;
    readonly password: Redacted.Redacted<string>;
  }
>()("@effect-email/SmtpConfig") {
  static readonly layer = (input: typeof SmtpConfigInput.Type) =>
    Layer.succeed(SmtpConfig)(SmtpConfigInput.make(input));
}

export class SmtpClient extends Context.Service<
  SmtpClient,
  {
    readonly send: (
      message: EmailMessage,
      options?: SendOptions,
    ) => Effect.Effect<SendReceipt, SendFailure>;
  }
>()("@effect-email/SmtpClient") {
  static readonly layer = (input: typeof SmtpClientInput.Type) => {
    const config = SmtpClientInput.make(input);
    return SmtpClient.of({
      ...config,
      send: (message, options) => executeSmtpSend(config.transporter, message, options),
    });
  };
}

const receiptFromInfo = (info: SmtpSentMessageInfo): Effect.Effect<SendReceipt, SendFailure> =>
  typeof info.messageId === "string" && info.messageId.trim().length > 0
    ? Effect.succeed({ provider: "smtp", messageId: info.messageId })
    : Effect.fail(
        new AmbiguousSendFailure({
          provider: "smtp",
          disposition: "ambiguous",
          retryable: false,
        }),
      );

const classifySmtpError = ({ cause }: SmtpClientError): Effect.Effect<never, SendFailure> => {
  const value: NodemailerErrorLike = typeof cause === "object" && cause !== null ? cause : {};

  if (value.responseCode === 535 || value.code === "EAUTH") {
    return Effect.fail(
      new AuthenticationFailure({
        provider: "smtp",
        disposition: "permanent",
        retryable: false,
      }),
    );
  }

  if (
    typeof value.responseCode === "number" &&
    value.responseCode >= 400 &&
    value.responseCode < 500
  ) {
    return Effect.fail(
      new TransportUnavailableFailure({
        provider: "smtp",
        disposition: "retryable",
        retryable: true,
      }),
    );
  }

  if (
    typeof value.responseCode === "number" &&
    value.responseCode >= 500 &&
    value.responseCode < 600
  ) {
    return Effect.fail(
      new RejectedMessageFailure({
        provider: "smtp",
        disposition: "permanent",
        retryable: false,
      }),
    );
  }

  if (
    typeof value.code === "string" &&
    transientSmtpErrorCodes.has(value.code) &&
    isBeforeDataCommand(value.command)
  ) {
    return Effect.fail(
      new TransportUnavailableFailure({
        provider: "smtp",
        disposition: "retryable",
        retryable: true,
      }),
    );
  }

  if (typeof value.code === "string" && phaseAwareSmtpErrorCodes.has(value.code)) {
    return Effect.fail(
      new AmbiguousSendFailure({
        provider: "smtp",
        disposition: "ambiguous",
        retryable: false,
      }),
    );
  }

  return Effect.failCause(Cause.die(cause));
};

const executeSmtpSend = (
  transporter: SmtpTransporter,
  message: EmailMessage,
  _options?: SendOptions,
): Effect.Effect<SendReceipt, SendFailure> =>
  Effect.tryPromise({
    try: () => transporter.sendMail(mailOptions(message)),
    catch: (cause): SmtpClientError => ({ cause }),
  }).pipe(
    Effect.matchEffect({
      onFailure: classifySmtpError,
      onSuccess: receiptFromInfo,
    }),
  );

export const policyConfig: SendPolicy.Config = SendPolicy.defaultConfig;

export const policyLayer: Layer.Layer<SendPolicy> = Layer.succeed(
  SendPolicy,
  SendPolicy.layer(policyConfig),
);

export const clientLayer: Layer.Layer<SmtpClient, never, SmtpConfig> = Layer.effect(
  SmtpClient,
  Effect.gen(function* () {
    const smtp = yield* SmtpConfig;
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: Redacted.value(smtp.password),
      },
    });
    return SmtpClient.layer({
      transporter: {
        sendMail: (options) => {
          const { attachments, ...rest } = options;
          return transporter.sendMail(
            attachments === undefined
              ? rest
              : {
                  ...rest,
                  attachments: attachments.map((attachment) => ({
                    ...attachment,
                    content: Buffer.from(attachment.content),
                  })),
                },
          );
        },
      },
    });
  }).pipe(Effect.annotateLogs({ service: "@effect-email/SmtpClient" })),
);

export const layer: Layer.Layer<Email, never, SmtpClient | SendPolicy> = Layer.effect(
  Email,
  Effect.gen(function* () {
    const smtp = yield* SmtpClient;
    const policy = yield* SendPolicy;
    return Email.layer({ policy, send: smtp.send });
  }).pipe(Effect.annotateLogs({ service: "@effect-email/Email" })),
);

export const defaultLayer: Layer.Layer<Email, Config.ConfigError> = layer.pipe(
  Layer.provide(policyLayer),
  Layer.provide(
    clientLayer.pipe(
      Layer.provide(Layer.unwrap(Effect.map(config, (input) => SmtpConfig.layer(input)))),
    ),
  ),
);
