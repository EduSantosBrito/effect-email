# Issue tracker: Linear

Work for this repository lives in Linear. Use the official Linear MCP server as
the primary interface.

Read `.agents/issue-tracker.local.md` before accessing Linear. It contains the
selected workspace, team, project, workflow states, actor, and non-secret IDs.

Never write OAuth credentials or API keys to repository files.

## Repository scope

- Project: EffectKit
- Package label: `effect-email`
- Every issue created for this repository must belong to EffectKit and carry the
  `effect-email` label.

## Workflow labels

- `wayfinder:map`
- `wayfinder:research`
- `wayfinder:prototype`
- `wayfinder:grilling`
- `wayfinder:task`
- `agent:spec`

## Conventions

- Use the configured BritoLab team and EffectKit project.
- Use native parent/sub-issue hierarchy.
- Use native blocking and blocked-by relations.
- Use Linear comments for durable decisions and resolution notes.
- Re-read issues after claiming or mutating them.
- Specifications use `agent:spec`.
- Implementation tickets are sub-issues of their specification.
- Wayfinder maps use `wayfinder:map`; their decision tickets are sub-issues.
- Claim work by assigning it to the configured actor and moving it to the
  configured started state.
- Keep credentials in the MCP client's secret store.
