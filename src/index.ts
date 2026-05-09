import { Effect } from "effect";

export interface EmailAddress {
  readonly value: string;
}

export interface EmailMessage {
  readonly from: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly subject: string;
  readonly text: string;
}

export interface EffectEmailClient {
  readonly send: (message: EmailMessage) => Effect.Effect<void>;
}

export const emailAddress = (value: string): EmailAddress => ({ value });

export const createEffectEmailClient = (): EffectEmailClient => ({
  send: () => Effect.void,
});
