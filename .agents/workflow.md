# Agent workflow

## Entry point

Start every piece of work with `wayfinder`. Use `/wayfinder` in Pi.

The installed custom `wayfinder`, `explore`, `you-lost-me`, `setup-skills`,
`product-design`, and `code-review` skills take precedence over conflicting
global skills.

## Main build flow

wayfinder → to-spec → to-tickets → implement → code-review

Enter at a later stage when the work is already defined, specified, ticketed,
implemented, or ready for review.

## Stage ownership

- Wayfinder owns the problem, outcome, actors, language, scope, authority,
  constraints, material risk, and human decisions.
- `to-spec` owns behavior, contracts, states, failures, non-functional
  requirements, and testing seams.
- `to-tickets` owns vertical slices, dependencies, migration, and delivery order.
- `implement` owns local technical choices consistent with the specification and
  repository standards.

## Research

Research factual unknowns automatically and prefer primary sources. Real-browser
automation requires explicit user authorization.

## Review

`code-review` uses Hunk. Resolve its skill with `hunk skill path` and preserve
the independent Standards and Spec review axes.
