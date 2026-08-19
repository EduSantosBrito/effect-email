import { Context, Data, Effect, Layer, Ref } from "effect";
import {
  AmbiguousSendFailure,
  Email,
  type EmailMessage,
  type IdempotencyKey,
  RateLimitFailure,
  RejectedMessageFailure,
  type RetryAfter,
  SendPolicy,
  type SendFailure,
  type SendOptions,
  type SendReceipt,
  TransportUnavailableFailure,
} from "./index.js";

export interface TestEmailAttempt {
  readonly message: EmailMessage;
  readonly options?: SendOptions;
}

export type TestEmailOutcome = Data.TaggedEnum<{
  readonly Accept: {};
  readonly RateLimit: { readonly retryAfter?: RetryAfter };
  readonly TimeoutBeforeAcceptance: {};
  readonly FailAfterPossibleAcceptance: {};
  readonly PermanentFailure: {};
}>;

export const TestEmailOutcome = Data.taggedEnum<TestEmailOutcome>();

interface DeduplicationEntry {
  readonly messageFingerprint: string;
  readonly receipt: SendReceipt;
}

interface TestEmailState {
  readonly script: readonly TestEmailOutcome[];
  readonly attempts: readonly TestEmailAttempt[];
  readonly accepted: readonly EmailMessage[];
  readonly deduplication: ReadonlyMap<IdempotencyKey, DeduplicationEntry>;
  readonly nextReceiptId: number;
}

const initialState = (): TestEmailState => ({
  script: [],
  attempts: [],
  accepted: [],
  deduplication: new Map(),
  nextReceiptId: 1,
});

const messageFingerprint = (message: EmailMessage): string =>
  JSON.stringify({
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.replyTo,
    subject: message.subject,
    body: message.body,
    attachments: message.attachments?.map((attachment) => ({
      name: attachment.name,
      mediaType: attachment.mediaType,
      content: Array.from(attachment.content),
      contentId: attachment.contentId,
    })),
    headers: message.headers?.values,
  });

class TestEmailStateService extends Context.Service<
  TestEmailStateService,
  { readonly state: Ref.Ref<TestEmailState> }
>()("@effect-email/TestEmailStateService") {}

export class TestEmailInspection extends Context.Service<
  TestEmailInspection,
  {
    readonly attempts: Effect.Effect<readonly TestEmailAttempt[]>;
    readonly accepted: Effect.Effect<readonly EmailMessage[]>;
    readonly sent: Effect.Effect<readonly EmailMessage[]>;
    readonly takeSent: Effect.Effect<readonly EmailMessage[]>;
    readonly clear: Effect.Effect<void>;
    readonly record: (message: EmailMessage) => Effect.Effect<void>;
  }
>()("@effect-email/TestEmailInspection") {
  static readonly layer = (input: { readonly state: Ref.Ref<readonly EmailMessage[]> }) => {
    const accepted = Ref.get(input.state);
    return makeInspection({
      attempts: accepted.pipe(Effect.map((messages) => messages.map((message) => ({ message })))),
      accepted,
      takeAccepted: Ref.getAndSet(input.state, []),
      clearAccepted: Ref.set(input.state, []),
      record: (message) => Ref.update(input.state, (messages) => [...messages, message]),
    });
  };
}

const makeInspection = (input: {
  readonly attempts: Effect.Effect<readonly TestEmailAttempt[]>;
  readonly accepted: Effect.Effect<readonly EmailMessage[]>;
  readonly takeAccepted: Effect.Effect<readonly EmailMessage[]>;
  readonly clearAccepted: Effect.Effect<void>;
  readonly record: (message: EmailMessage) => Effect.Effect<void>;
}): typeof TestEmailInspection.Service =>
  TestEmailInspection.of({
    attempts: input.attempts,
    accepted: input.accepted,
    sent: input.accepted,
    takeSent: input.takeAccepted,
    clear: input.clearAccepted,
    record: input.record,
  });

export class TestEmailControl extends Context.Service<
  TestEmailControl,
  {
    readonly enqueue: (...outcomes: readonly TestEmailOutcome[]) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
  }
>()("@effect-email/TestEmailControl") {}

export class TestEmailAdapter extends Context.Service<
  TestEmailAdapter,
  {
    readonly send: (
      message: EmailMessage,
      options?: SendOptions,
    ) => Effect.Effect<SendReceipt, SendFailure>;
  }
>()("@effect-email/TestEmailAdapter") {
  static readonly layer = (input: { readonly inspection: typeof TestEmailInspection.Service }) =>
    TestEmailAdapter.of({
      send: (message, _options) =>
        input.inspection
          .record(message)
          .pipe(
            Effect.as({ provider: "test", messageId: "test-message-id" } satisfies SendReceipt),
          ),
    });
}

const testEmailStateLayer = Layer.effect(
  TestEmailStateService,
  Ref.make(initialState()).pipe(
    Effect.map((state) => TestEmailStateService.of({ state })),
    Effect.annotateLogs({ service: "@effect-email/TestEmailStateService" }),
  ),
);

const testInspectionLayer = Layer.effect(
  TestEmailInspection,
  Effect.gen(function* () {
    const { state } = yield* TestEmailStateService;
    const accepted = Ref.get(state).pipe(Effect.map((current) => current.accepted));
    return makeInspection({
      attempts: Ref.get(state).pipe(Effect.map((current) => current.attempts)),
      accepted,
      takeAccepted: Ref.modify(state, (current) => [
        current.accepted,
        { ...current, accepted: [] },
      ]),
      clearAccepted: Ref.update(state, (current) => ({ ...current, accepted: [] })),
      record: (message) =>
        Ref.update(state, (current) => ({
          ...current,
          accepted: [...current.accepted, message],
        })),
    });
  }).pipe(Effect.annotateLogs({ service: "@effect-email/TestEmailInspection" })),
);

const testControlLayer = Layer.effect(
  TestEmailControl,
  Effect.gen(function* () {
    const { state } = yield* TestEmailStateService;
    return TestEmailControl.of({
      enqueue: (...outcomes) =>
        Ref.update(state, (current) => ({
          ...current,
          script: [...current.script, ...outcomes],
        })),
      reset: Ref.set(state, initialState()),
    });
  }).pipe(Effect.annotateLogs({ service: "@effect-email/TestEmailControl" })),
);

const testEmailAdapterLayer = Layer.effect(
  TestEmailAdapter,
  Effect.gen(function* () {
    const { state } = yield* TestEmailStateService;
    return TestEmailAdapter.of({
      send: (message, options) =>
        Ref.modify(state, (current) => {
          const attempt = options === undefined ? { message } : { message, options };
          const attempted: TestEmailState = {
            ...current,
            attempts: [...current.attempts, attempt],
          };
          const idempotencyKey = options?.idempotencyKey;
          const fingerprint = messageFingerprint(message);
          const previous =
            idempotencyKey === undefined ? undefined : current.deduplication.get(idempotencyKey);

          if (previous !== undefined) {
            const result: Effect.Effect<SendReceipt, SendFailure> =
              previous.messageFingerprint === fingerprint
                ? Effect.succeed(previous.receipt)
                : Effect.fail(
                    new RejectedMessageFailure({
                      provider: "test",
                      disposition: "permanent",
                      retryable: false,
                    }),
                  );
            return [result, attempted];
          }

          const [outcome = TestEmailOutcome.Accept(), ...script] = current.script;
          const scripted: TestEmailState = { ...attempted, script };
          const receipt = {
            provider: "test",
            messageId: `test-message-${current.nextReceiptId}`,
          } satisfies SendReceipt;
          const accepted = (): TestEmailState => ({
            ...scripted,
            accepted: [...current.accepted, message],
            deduplication:
              idempotencyKey === undefined
                ? current.deduplication
                : new Map(current.deduplication).set(idempotencyKey, {
                    messageFingerprint: fingerprint,
                    receipt,
                  }),
            nextReceiptId: current.nextReceiptId + 1,
          });
          let result: Effect.Effect<SendReceipt, SendFailure>;
          let next: TestEmailState = scripted;

          switch (outcome._tag) {
            case "Accept":
              result = Effect.succeed(receipt);
              next = accepted();
              break;
            case "RateLimit":
              result = Effect.fail(
                new RateLimitFailure({
                  provider: "test",
                  metadata:
                    outcome.retryAfter === undefined
                      ? { status: 429 }
                      : { status: 429, retryAfter: outcome.retryAfter },
                  disposition: "retryable",
                  retryable: true,
                }),
              );
              break;
            case "TimeoutBeforeAcceptance":
              result = Effect.fail(
                new TransportUnavailableFailure({
                  provider: "test",
                  disposition: "retryable",
                  retryable: true,
                }),
              );
              break;
            case "FailAfterPossibleAcceptance":
              result = Effect.fail(
                new AmbiguousSendFailure({
                  provider: "test",
                  disposition: "ambiguous",
                  retryable: false,
                }),
              );
              next = accepted();
              break;
            case "PermanentFailure":
              result = Effect.fail(
                new RejectedMessageFailure({
                  provider: "test",
                  disposition: "permanent",
                  retryable: false,
                }),
              );
              break;
          }

          return [result, next];
        }).pipe(Effect.flatten),
    });
  }).pipe(Effect.annotateLogs({ service: "@effect-email/TestEmailAdapter" })),
);

const testServicesLayer = Layer.mergeAll(
  testInspectionLayer,
  testControlLayer,
  testEmailAdapterLayer,
).pipe(Layer.provide(testEmailStateLayer));

const testEmailLayer = Layer.effect(
  Email,
  Effect.gen(function* () {
    const adapter = yield* TestEmailAdapter;
    const policy = yield* SendPolicy;
    return Email.layer({ policy, send: adapter.send });
  }).pipe(Effect.annotateLogs({ service: "@effect-email/Email" })),
);

export const policyConfig: SendPolicy.Config = SendPolicy.defaultConfig;

export const policyLayer: Layer.Layer<SendPolicy> = Layer.succeed(
  SendPolicy,
  SendPolicy.layer(policyConfig),
);

export const layer: Layer.Layer<
  Email | TestEmailAdapter | TestEmailControl | TestEmailInspection,
  never,
  SendPolicy
> = testEmailLayer.pipe(Layer.provideMerge(testServicesLayer));

export const defaultLayer: Layer.Layer<
  Email | TestEmailAdapter | TestEmailControl | TestEmailInspection | SendPolicy
> = layer.pipe(Layer.provideMerge(policyLayer));
