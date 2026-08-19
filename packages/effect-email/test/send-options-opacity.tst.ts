import { expect, test } from "tstyche";
import type { IdempotencyKey, SendOptions } from "effect-email";

test("SendOptions is constructor-only", () => {
  expect({}).type.not.toBeAssignableTo<SendOptions>();
  expect({
    idempotencyKey: "attempt-1" as IdempotencyKey,
  }).type.not.toBeAssignableTo<SendOptions>();
});
