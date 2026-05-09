import { describe, effect, expect, it } from "@effect/vitest";
import { createEffectEmailClient, emailAddress } from "./index";

describe("effect-email", () => {
  it("creates email addresses", () => {
    expect(emailAddress("hello@example.com")).toEqual({
      value: "hello@example.com",
    });
  });

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
