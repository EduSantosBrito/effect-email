import {
  SmtpClient,
  SmtpConfig,
  clientLayer,
  makeConfig,
  type SmtpConfigInput,
} from "effect-email/smtp";

const config: SmtpConfigInput = makeConfig({
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: "user",
  password: "secret",
});
void config;
void SmtpConfig;
void clientLayer;
