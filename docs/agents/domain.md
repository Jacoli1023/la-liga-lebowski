# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **single-context** repo: one `CONTEXT.md` and one `docs/adr/`, both at the root.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the domain glossary.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-<slug>.md
│   └── 0002-<slug>.md
└── src/
```

If this repo ever splits into multiple bounded contexts, the convention is a root `CONTEXT-MAP.md` pointing at one `CONTEXT.md` per context, with context-scoped ADRs under `src/<context>/docs/adr/`. Re-run `/setup-matt-pocock-skills` if that day comes.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## The glossary is not the ruleset

`CONTEXT.md` defines **vocabulary**: what a term names in this codebase, and which synonyms to avoid. `docs/la-liga-rules.txt` is **authoritative for values** - thresholds, multipliers, roster limits, deadlines. Never copy a number out of the ruleset into the glossary; name the concept and let the ruleset hold the figure. A restated value is a second source of truth, and it drifts silently.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
