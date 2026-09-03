# CLAUDE.md

Guidance for Claude Code when working in this repository.

A line belongs in this file only if it would change your behaviour on an
arbitrary task here, and is not derivable from git, the issue tracker, or a file
you would read anyway. Progress, decisions, measurements and roadmap have their
own homes; see "Where things live" below. This file stays plain: no bold, no
italics, no decorative prose.

## What this is

A configurable NFL fantasy-football simulator implementing a custom league
ruleset: salary cap, multi-year contracts, blind-bid free agency, keepers,
holdouts, franchise and transition tags, season rollover. It will eventually be
used by a real friend group.

It is primarily a learning project. Jacob is using it to learn back-end
fundamentals: data modeling, persistence, API design, architecture. Optimize for
his understanding, not for shipping speed.

## Where things live

| What | Where |
| --- | --- |
| Cross-slice decisions | `docs/adr/`, MADR minimal, one file per decision |
| In-slice decisions | a Decisions section at the end of the slice's spec, as Y-statements |
| Intent for one ticket | `specs/NNN-<slug>.md`, thin and ticket-scoped |
| Progress and roadmap | GitHub milestones (one per slice) and issues (one per ticket) |
| Domain vocabulary | `CONTEXT.md` |
| Facts we measured ourselves | `docs/notes/measured.md` |
| Authoritative rule values | `docs/la-liga-rules.txt` |
| How a tool behaves | that tool's documentation - look it up, do not infer |

Never restate any of the above in this file. Read the source.

Citing a decision: use its slug (`docs/adr/0006-inject-the-fetch-seam.md`),
never a number from a spec. Reversing one: set the old ADR's status to
`superseded by ADR-NNNN` and write a new file. Never edit a decision.

Classifying a new decision: ask whether a future ticket would be wrong without
knowing it. If yes it is an ADR; if no it stays in the spec and dies with the
ticket. Specs never cross-reference each other - a decision two specs need is an
ADR by that test.

## Jacob's experience level

Jacob is solid on TypeScript fundamentals and domain modeling. He is new to
databases and HTTP. He has barely touched SQL, ORMs, migrations, or web servers.
Drizzle, PGlite, Hono and Zod are all foreign to him. He is not a beginner
programmer; explain the unfamiliar layer and assume competence everywhere else.

Concretely, in this repo:

- Define every term before using it. Migration, upsert, transaction, foreign
  key, index, middleware, status code, idempotency, serialization: assume none
  of these are known.
- Show the SQL. When you write a Drizzle query, show the SQL it generates and
  walk through it. Drizzle was chosen so Jacob learns SQL; do not let the ORM
  hide it. `.toSQL()` returns `{ sql, params }` without executing.
- Explain HTTP semantics as they arise. Why POST and not GET. Why 422 and not
  400. Why PATCH and not PUT. What idempotent means, and why the sync is and the
  bid endpoint is not.
- Teach the error. A constraint violation, a connection failure, a type
  mismatch at the DB boundary: say what the database is complaining about before
  fixing it.
- Prefer the boring explicit version. A verbose query he can read beats a terse
  one he cannot.
- Teaching happens in conversation, not in files. Docblocks and ADRs are not
  places to teach concepts.

## Stack

Locked. No tool debates until slice 2 ships; Jacob's known trap is
over-structuring, and tool-shopping is that trap in disguise.

- TypeScript on Node.
- PGlite: real Postgres compiled to WASM, in-process. No Docker, no connection
  string. Swap the driver for real Postgres later; schema and queries do not
  change.
- Drizzle: SQL-first ORM, schema in TypeScript, no codegen. Chosen so Jacob
  learns SQL rather than a query DSL.
- Hono: web-standards HTTP framework, with `zValidator` middleware.
- Zod: runtime validation at every external boundary.
- Vitest: red, green, refactor.

## Commands

Package manager is pnpm, with mise pinning node and pnpm (see `mise.toml`).
Never run `npm install` here; it would write a second lockfile beside
`pnpm-lock.yaml`.

- `pnpm test` / `pnpm test:watch` - Vitest
- `pnpm typecheck` - `tsc --noEmit`
- `pnpm db:generate` - generate a Drizzle migration by diffing `schema.ts`
- `pnpm sync:players` - pull the Sleeper player pool
- `pnpm dev` - start the Hono server

## Architecture

Two ADRs govern the shape of this codebase. Read them before adding a layer.

- `docs/adr/0001-functional-core-imperative-shell.md` - calculations and rules
  are pure functions over plain data; entities, repositories and handlers do the
  I/O. The operative rule: no rule is ever computed inside a route handler or a
  query. A handler loads, calls the core, and serializes. Cap math in a Hono
  handler is a bug.
- `docs/adr/0002-three-translations-we-own.md` - four shapes, three
  translations. Sleeper JSON, the mirror table, domain objects, API JSON. Never
  return a raw database row from a route.

Where an invariant is enforced:

| Kind of rule | Enforced by |
| --- | --- |
| Uniqueness, foreign keys, NOT NULL, CHECK | Postgres. Declarative, atomic, race-proof. |
| Aggregate rules, such as committed cap under the league cap | Our code, inside a transaction. No column constraint can express a SUM across rows. |

Knowing which is which is the core skill of this phase. Teach it explicitly.

## Hard conventions

- Source code is ASCII-only. No emoji, em dashes or arrow glyphs anywhere under
  `src/` or `scripts/`, including comments and JSDoc. Use `-` and `->`.
- Money is always integer cents. See `docs/adr/0003-money-as-integer-cents.md`.
- `as` is not validation. A type assertion is a lie to the compiler with zero
  runtime enforcement. Every external boundary gets a Zod schema.
- Derive, do not store. A roster is a query over contracts by status, never a
  stored array. Cap used is computed, never cached.
- Fixed-value fields are unions, never magic strings.
- Status is data, not type. Never subclass to represent a bucket a thing moves
  between.
- The sync is idempotent. Upsert on a stable external key. Partial failure is
  fixed by rerunning, not by rolling back.
- Single source of truth. Never add a second way to answer the same question.
- Docblocks address a developer who has never seen this codebase. They say what
  the code does and why it exists. A docblock over roughly eight lines is a
  decision record in the wrong file; move it to an ADR and leave a pointer.
- Two strings in this repo are contracts, not presentation, and the tests that
  pin them are deliberate. `serialize`'s field list is the only thing stopping
  internal columns reaching a client. The sync's two abort messages exist to
  tell one diagnosis from another, so a test must match the phrase unique to
  each. See docs/adr/0002-three-translations-we-own.md and
  docs/adr/0010-zero-rows-written-is-fatal.md.
- Do not add a table, a column, or an endpoint until the current ticket needs it.
- Fix the spec before the code when behaviour is wrong.

## Agent skills

- Issue tracker: GitHub issues on `Jacoli1023/la-liga-lebowski` via the `gh`
  CLI. See `docs/agents/issue-tracker.md`.
- Triage labels: five canonical roles, each label string equal to its name. See
  `docs/agents/triage-labels.md`.
- Domain docs: single context, `CONTEXT.md` and `docs/adr/` at the root. See
  `docs/agents/domain.md`.

## The ruleset

The authoritative custom rules are in `docs/la-liga-rules.txt`. When
implementing any rule, read it there. Never infer a value from memory, and never
copy one into another file.
