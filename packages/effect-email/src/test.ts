import { Context, Effect, Layer, Ref, Schema } from "effect";
import { Email, type EmailMessage, SendPolicy, type SendFailure, type SendReceipt } from "./index";

const TestEmailInspectionState = Schema.declare<Ref.Ref<readonly EmailMessage[]>>(
  (input): input is Ref.Ref<readonly EmailMessage[]> => input !== undefined && input !== null,
);

const TestEmailInspectionInput = Schema.Struct({
  state: TestEmailInspectionState,
});

const SendPolicyInput = Schema.declare<typeof SendPolicy.Service>(
  (input): input is typeof SendPolicy.Service => input !== undefined && input !== null,
);

const TestEmailInspectionServiceInput = Schema.declare<typeof TestEmailInspection.Service>(
  (input): input is typeof TestEmailInspection.Service => input !== undefined && input !== null,
);

const TestEmailAdapterInput = Schema.Struct({
  inspection: TestEmailInspectionServiceInput,
  policy: SendPolicyInput,
});

export class TestEmailInspection extends Context.Service<
  TestEmailInspection,
  {
    readonly sent: Effect.Effect<readonly EmailMessage[]>;
    readonly takeSent: Effect.Effect<readonly EmailMessage[]>;
    readonly clear: Effect.Effect<void>;
    readonly record: (message: EmailMessage) => Effect.Effect<void>;
  }
>()("@effect-email/TestEmailInspection") {
  static readonly layer = (input: typeof TestEmailInspectionInput.Type) => {
    const config = TestEmailInspectionInput.make(input);
    return TestEmailInspection.of({
      ...config,
      sent: Ref.get(config.state),
      takeSent: Ref.getAndSet(config.state, []),
      clear: Ref.set(config.state, []),
      record: (message) => Ref.update(config.state, (messages) => [...messages, message]),
    });
  };
}

export class TestEmailAdapter extends Context.Service<
  TestEmailAdapter,
  {
    readonly send: (message: EmailMessage) => Effect.Effect<SendReceipt, SendFailure>;
  }
>()("@effect-email/TestEmailAdapter") {
  static readonly layer = (input: typeof TestEmailAdapterInput.Type) => {
    const config = TestEmailAdapterInput.make(input);
    return TestEmailAdapter.of({
      ...config,
      send: (message) =>
        config.policy.validate(message).pipe(
          Effect.tap((accepted) => config.inspection.record(accepted)),
          Effect.as({ provider: "test", messageId: "test-message-id" } satisfies SendReceipt),
        ),
    });
  };
}

const testInspectionLayer = Layer.effect(
  TestEmailInspection,
  Ref.make<readonly EmailMessage[]>([]).pipe(
    Effect.map((state) => TestEmailInspection.layer({ state })),
  ),
);

const testEmailAdapterLayer = Layer.effect(
  TestEmailAdapter,
  Effect.gen(function* () {
    const policy = yield* SendPolicy;
    const inspection = yield* TestEmailInspection;
    return TestEmailAdapter.layer({ policy, inspection });
  }).pipe(Effect.annotateLogs({ service: "@effect-email/TestEmailAdapter" })),
);

const testEmailLayer = Layer.effect(
  Email,
  Effect.gen(function* () {
    const adapter = yield* TestEmailAdapter;
    return Email.layer(adapter);
  }).pipe(Effect.annotateLogs({ service: "@effect-email/Email" })),
).pipe(Layer.provideMerge(testEmailAdapterLayer));

export const policyConfig: SendPolicy.Config = SendPolicy.defaultConfig;

export const policyLayer: Layer.Layer<SendPolicy> = Layer.succeed(
  SendPolicy,
  SendPolicy.layer(policyConfig),
);
export const layer: Layer.Layer<Email | TestEmailInspection, never, SendPolicy> =
  testEmailLayer.pipe(Layer.provideMerge(testInspectionLayer));
export const defaultLayer: Layer.Layer<Email | TestEmailInspection | SendPolicy> = layer.pipe(
  Layer.provideMerge(policyLayer),
);
