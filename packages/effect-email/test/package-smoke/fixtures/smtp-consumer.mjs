import assert from "node:assert/strict";
import * as Smtp from "effect-email/smtp";

assert.equal(typeof Smtp.SmtpClient, "function");
assert.equal(typeof Smtp.clientLayer, "object");
assert.equal(typeof Smtp.makeConfig, "function");
