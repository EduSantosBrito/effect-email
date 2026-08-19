.repos/effect is used as reference to check Effect v4 API implementations and documentations. Always use this before deciding on which Effect API to use. Read the TSDocs properly.

.repos/resend and .repos/nodemailer are used as reference to check which email features we need to implement

.repos/opencode and .repos/t3code are used as reference of big applications that uses Effect in production.

Every public API change must consider whether these also need updates:

- README.md
- examples
- packages/effect-email/test/public-api-imports.ts

Every package version bump must update packages/effect-email/CHANGELOG.md.

## Agent skills

### Workflow

Start every piece of work with the `wayfinder` skill. See `.agents/workflow.md`.

### Issue tracker

Work is tracked in Linear under the EffectKit project, using the `effect-email` label. See `.agents/issue-tracker.md`.

### Triage labels

Use the canonical triage label vocabulary. See `.agents/triage-labels.md`.

### Domain docs

This repository uses a single domain context. See `.agents/domain.md`.
