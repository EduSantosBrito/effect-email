import { Context, Effect, Layer, Ref, Schema } from "effect";
import type { NormalizedEmail, VerificationToken } from "./domain";

export class AuthEmailFailure extends Schema.TaggedErrorClass<AuthEmailFailure>()(
  "AuthEmailFailure",
  {
    reason: Schema.Literals(["DeliveryUnavailable", "InvalidRecipient"]),
  },
) {}

export interface SentAuthEmail {
  readonly kind: "EmailVerification" | "PasswordReset";
  readonly to: NormalizedEmail;
  readonly token: VerificationToken;
  readonly callbackUrl: URL;
}

export interface AuthEmailShape {
  readonly sendEmailVerification: (input: {
    readonly to: NormalizedEmail;
    readonly token: VerificationToken;
    readonly callbackUrl: URL;
  }) => Effect.Effect<void, AuthEmailFailure>;
  readonly sendPasswordReset: (input: {
    readonly to: NormalizedEmail;
    readonly token: VerificationToken;
    readonly callbackUrl: URL;
  }) => Effect.Effect<void, AuthEmailFailure>;
}

export class AuthEmail extends Context.Service<AuthEmail, AuthEmailShape>()(
  "effect-auth/email/AuthEmail",
) {}

export interface MockAuthEmailInspectionShape {
  readonly sent: Effect.Effect<ReadonlyArray<SentAuthEmail>>;
  readonly clear: Effect.Effect<void>;
}

export class MockAuthEmailInspection extends Context.Service<
  MockAuthEmailInspection,
  MockAuthEmailInspectionShape
>()("effect-auth/email/mock/MockAuthEmailInspection") {}

export const makeMockAuthEmail = Effect.gen(function* () {
  const sentRef = yield* Ref.make<ReadonlyArray<SentAuthEmail>>([]);

  const record = (message: SentAuthEmail) => Ref.update(sentRef, (sent) => [...sent, message]);

  const authEmail: AuthEmailShape = {
    sendEmailVerification: (input) =>
      record({
        ...input,
        kind: "EmailVerification",
      }),
    sendPasswordReset: (input) =>
      record({
        ...input,
        kind: "PasswordReset",
      }),
  };

  const inspection: MockAuthEmailInspectionShape = {
    clear: Ref.set(sentRef, []),
    sent: Ref.get(sentRef),
  };

  return { authEmail, inspection };
});

export const MockAuthEmailLayer = Layer.effect(
  AuthEmail,
  makeMockAuthEmail.pipe(Effect.map(({ authEmail }) => AuthEmail.of(authEmail))),
);

export const MockAuthEmailInspectableLayer = Layer.effectContext(
  makeMockAuthEmail.pipe(
    Effect.map(({ authEmail, inspection }) =>
      Context.make(AuthEmail, AuthEmail.of(authEmail)).pipe(
        Context.add(MockAuthEmailInspection, MockAuthEmailInspection.of(inspection)),
      ),
    ),
  ),
);

export const MockAuthEmailWithInspectionLayer = MockAuthEmailInspectableLayer;
