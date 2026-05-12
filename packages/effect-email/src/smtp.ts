import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import {
  Email,
  type EmailMessage,
  ProviderProtocolFailure,
  type SendFailure,
  SendPolicy,
  type SendReceipt,
} from "./index";
import { mailOptions, type SmtpMailOptions } from "./internal/smtp-mail-options";

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

interface SmtpTransporter {
  readonly sendMail: (options: SmtpMailOptions) => PromiseLike<SMTPTransport.SentMessageInfo>;
}

const SmtpTransporterInput = Schema.declare<SmtpTransporter>(
  (input): input is SmtpTransporter => input !== undefined && input !== null,
);

const SmtpClientInput = Schema.Struct({
  transporter: SmtpTransporterInput,
});

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
    readonly send: (message: EmailMessage) => Effect.Effect<SendReceipt, SendFailure>;
  }
>()("@effect-email/SmtpClient") {
  static readonly layer = (input: typeof SmtpClientInput.Type) => {
    const config = SmtpClientInput.make(input);
    return SmtpClient.of({
      ...config,
      send: (message) => executeSmtpSend(config.transporter, message),
    });
  };
}

const receiptFromInfo = (
  info: SMTPTransport.SentMessageInfo,
): Effect.Effect<SendReceipt, SendFailure> =>
  typeof info.messageId === "string" && info.messageId.length > 0
    ? Effect.succeed({ provider: "smtp", messageId: info.messageId })
    : Effect.fail(new ProviderProtocolFailure({ provider: "smtp", retryable: false }));

const executeSmtpSend = (
  transporter: SmtpTransporter,
  message: EmailMessage,
): Effect.Effect<SendReceipt, SendFailure> =>
  Effect.tryPromise({
    try: () => transporter.sendMail(mailOptions(message)),
    catch: () => new ProviderProtocolFailure({ provider: "smtp", retryable: false }),
  }).pipe(Effect.flatMap(receiptFromInfo));

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
      transporter: { sendMail: (options) => transporter.sendMail(options) },
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
      Layer.provide(
        Layer.unwrap(config.asEffect().pipe(Effect.map((input) => SmtpConfig.layer(input)))),
      ),
    ),
  ),
);
