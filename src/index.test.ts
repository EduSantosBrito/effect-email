import { assert, describe, effect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { createEffectEmailClient, emailAddress } from "./index";

describe("effect-email", () => {
  it.effect("creates email addresses", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(emailAddress("hello@example.com"), {
        value: "hello@example.com",
      });
    }),
  );

  effect("sends email messages", () => {
    const client = createEffectEmailClient();

    return client.send({
      from: emailAddress("hello@example.com"),
      to: [emailAddress("you@example.com")],
      subject: "Hello",
      text: "World",
    });
  });
});
