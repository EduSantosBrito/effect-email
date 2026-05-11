import { Context, Effect, Layer, Ref, Schema } from "effect";
import { Email, type EmailMessage, SendPolicy, type SendFailure, type SendReceipt } from "./index";

const TestEmailInspectionState = Schema.declare<Ref.Ref<readonly EmailMessage[]>>(
  (input): input is Ref.Ref<readonly EmailMessage[]> =>
    typeof input === "object" && input !== null && Object.hasOwn(input, "ref"),
);

const TestEmailInspectionInput = Schema.Struct({
  state: TestEmailInspectionState,
});

const SendPolicyInstance = Schema.declare<typeof SendPolicy.Service>(
  (input): input is typeof SendPolicy.Service =>
    typeof input === "object" && input !== null && Object.hasOwn(input, "validate"),
);

const TestEmailInspectionInstance = Schema.declare<typeof TestEmailInspection.Service>(
  (input): input is typeof TestEmailInspection.Service =>
    typeof input === "object" && input !== null && Object.hasOwn(input, "record"),
);

const TestEmailAdapterInput = Schema.Struct({
  inspection: TestEmailInspectionInstance,
  policy: SendPolicyInstance,
});

export class TestEmailInspection extends Context.Service<
  TestEmailInspection,
  {
    readonly sent: Effect.Effect<readonly EmailMessage[]>;
    readonly takeSent: Effect.Effect<readonly EmailMessage[]>;
    readonly clear: Effect.Effect<void>;
    readonly record: (message: EmailMessage) => Effect.Effect<void>;
  }
>()("TestEmailInspection") {
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
>()("TestEmailAdapter") {
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
  }),
);

const testEmailLayer = Layer.effect(
  Email,
  Effect.gen(function* () {
    const adapter = yield* TestEmailAdapter;
    return Email.layer(adapter);
  }),
).pipe(Layer.provideMerge(testEmailAdapterLayer));

export const policyConfig = SendPolicy.defaultConfig;
export const policyLayer: Layer.Layer<SendPolicy> = Layer.succeed(
  SendPolicy,
  SendPolicy.layer(policyConfig),
);
export const layer: Layer.Layer<Email | TestEmailInspection, never, SendPolicy> =
  testEmailLayer.pipe(Layer.provideMerge(testInspectionLayer));
export const defaultLayer: Layer.Layer<Email | TestEmailInspection | SendPolicy> =
  layer.pipe(Layer.provideMerge(policyLayer));
