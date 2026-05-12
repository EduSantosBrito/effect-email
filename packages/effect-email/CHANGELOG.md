# effect-email

## 0.5.0

- Make `EmailMessage` constructor-only and parse messages into trusted subject, body, and header domain values.
- Reject impossible `SendPolicy` limits at policy construction and centralize policy validation before adapter side effects.

## 0.4.2

- Complete Effect-native email DX public API and provider/test layer exports.

## 0.4.1

- Add package hygiene for npm publishing and OSS contribution flow.

## 0.4.0

- Add provider-neutral email APIs, trusted-runtime Resend support, and inspectable test adapter improvements.
