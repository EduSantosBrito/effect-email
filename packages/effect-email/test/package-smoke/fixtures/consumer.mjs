import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { Email, EmailMessage } from "effect-email";
import * as Resend from "effect-email/resend";
import * as Test from "effect-email/test";

assert.equal(typeof Resend.ResendClient, "function");
assert.equal(typeof Resend.layer, "object");
assert.equal(typeof Test.TestEmailInspection, "function");
assert.equal(typeof Test.defaultLayer, "object");

const message = await Effect.runPromise(
  EmailMessage.make({
    from: "sender@example.com",
    to: "recipient@example.com",
    subject: "Packed package smoke",
    text: "Context Service and Layer interoperate through the tarball.",
  }),
);

const program = Effect.gen(function* () {
  const email = yield* Email;
  const inspection = yield* Test.TestEmailInspection;
  const receipt = yield* email.send(message);
  const sent = yield* inspection.sent;
  return { receipt, sent };
});

const result = await Effect.runPromise(program.pipe(Effect.provide(Test.defaultLayer)));
assert.deepEqual(result.receipt, { provider: "test", messageId: "test-message-id" });
assert.equal(result.sent.length, 1);
assert.equal(result.sent[0], message);

const consumerRequire = createRequire(import.meta.url);
const packageEntry = fileURLToPath(import.meta.resolve("effect-email"));
const packageRequire = createRequire(join(dirname(dirname(packageEntry)), "package.json"));
assert.equal(
  realpathSync(consumerRequire.resolve("effect")),
  realpathSync(packageRequire.resolve("effect")),
  "consumer and effect-email must resolve one Effect runtime identity",
);
