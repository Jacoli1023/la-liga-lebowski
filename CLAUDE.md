# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# La Liga Lebowski — Project Memory

## What this is
A configurable NFL fantasy-football simulator implementing a custom league ruleset
(salary cap, multi-year contracts, blind-bid free agency, keepers, holdouts,
franchise/transition tags, season rollover). It will eventually be used by a real
friend group.

This is primarily a **learning project**. The owner (Jacob) is using it to learn
back-end fundamentals: data modeling, persistence, API design, and architecture.
**Optimize for Jacob's understanding, not for shipping speed.**

---

## ⚠️ Read this first: Jacob's experience level

Jacob is **solid on TypeScript fundamentals and domain modeling.** He is **new to
databases and HTTP.** He has barely touched SQL, ORMs, migrations, or web servers.
Drizzle, PGlite, Hono, and Zod are all foreign to him.

**This means you are doing significant teaching, not just coding.** Concretely:

- **Never introduce a term without defining it.** Migration, upsert, transaction,
  foreign key, index, connection, middleware, status code, idempotency, serialization
  — assume none of these are load-bearing knowledge yet.
- **Show the SQL.** When you write a Drizzle query, show the SQL it generates and
  walk through it. Drizzle was chosen *specifically* so Jacob learns SQL. Do not let
  the ORM hide it from him.
- **Explain HTTP semantics as they come up.** Why `POST` and not `GET`. Why `422` and
  not `400`. Why `PATCH` and not `PUT`. What "idempotent" means and why the sync
  script is and the bid endpoint isn't.
- **When something errors, teach the error.** A constraint violation, a connection
  failure, a type mismatch at the DB boundary — these are lessons, not obstacles.
  Explain what the DB is actually complaining about before fixing it.
- **Rationale before code, always.** He wants *why*. If he can't explain the diff back
  to you, you went too fast — stop and explain.
- **Prefer the boring, explicit version.** Clever abstractions cost him understanding.
  A verbose query he can read beats a terse one he can't.

He is *not* a beginner programmer. Don't condescend. Explain the unfamiliar layer,
assume competence everywhere else.

---

## Current state (2026-08-11)
**Vertical slices. Slice 0 (spec 002): implementation underway — steps 1–3 done, step 4's
*pure half* done. 30 tests green, `tsc` clean. Nothing touches the database or the network
yet. Resume at the ⟶ OPEN DECISION below (zero-row policy), then build the write side.**

Prior work: an in-memory domain core with `RosterStatus`, `CAP_MULTIPLIER_PCT`,
`Contract.calcCapHit()`, `Team.calcCapUsed()`, and 6 green Vitest tests. **All of that
survives** — it becomes the pure functional core. It was built with no consumer, which
is exactly the trap the pivot is correcting.

**Slice 0 — the walking skeleton.** Sleeper API → Zod → Drizzle → PGlite → `GET /players`.
The stack is installed. Every decision is locked in `specs/002-player-sync.md` — the
original seven plus decision 5 (`syncedAt`), which surfaced during implementation — each
with its rationale *and its cost*. **Read that spec before touching slice 0 code.**

The headline decision: the sync mirrors only the **~4,030 QB/RB/WR/TE rows** of Sleeper's
12,200, because `docs/la-liga-rules.txt:6` makes La Liga offense-only. That is what lets
the Zod schema be strict — the payload's nullability chaos lives almost entirely in rows
this league can never roster. It also forces the pipeline order: **filter, then validate.**

**Build order — data-flow, one new layer per step. Currently: step 4.**
1. ✅ `POSITIONS` / `Position` / `isLeaguePosition` in `rules.ts` — pure, no new tools
2. ✅ `src/db/schema.ts` + migration `0000_create_players` (the `CHECK` on `position` is
   generated from `POSITIONS`). `src/db/client.ts` — `createDb(path?)` factory applies it
   (PGlite + Drizzle + `migrate`); one factory, two callers (disk vs in-memory).
3. ✅ Zod schema + mapper — the anti-corruption boundary. `src/sync/sleeper.ts` holds the
   strict `sleeperPlayerSchema` and `mapSleeperPlayer(player, syncedAt)`. Jacob wrote the
   six tests in `sleeper.test.ts`; fixtures live in `sleeper.fixtures.ts`.
4. The sync — split into a pure half and an I/O half. ← *here, half done*
   - ✅ **Pure pipeline.** `mapSleeperPayload(payload: unknown, syncedAt): NewPlayer[]` in
     `src/sync/sleeper.ts` — envelope parse (`z.record`), filter, strict Zod, map. Jacob
     wrote all five tests, including the architecture-critical filter-before-validate one.
     *(Decided: extract the pure middle rather than inline it in the script. The filter
     test then needs no network double, and the fixtures it uses were already written.)*
   - ☐ `src/db/players.ts` — `upsertPlayers(db, rows)`. `onConflictDoUpdate` on
     `sleeper_id` (**upsert**), chunked. New ground: why chunking is needed, and why
     abort-on-bad-row is safe *because* the upsert is idempotent.
   - ☐ `scripts/sync-players.ts` — `fetchPlayerPool()` + orchestration + the zero-row
     policy. **Must export a `syncPlayers(...)` function with only a thin entry point at
     the bottom** — a script that works at import time cannot be tested, and importing it
     would fetch 14.6MB.
   - ☐ Spec tests still red: the `CHECK` constraint rejecting a direct `position: 'LB'`
     insert, and run-twice idempotency.
   - **Nothing in the suite calls `createDb()` yet** — step 2 is committed but unproven by
     the bar. The `CHECK` test is the cheapest fix, since it needs a real DB to mean
     anything. Do it first; it is also the first test to touch PGlite at all.
   - Also still missing: the `sync:players` npm script.
5. `src/http/players.ts` — Hono, `zValidator`, serialize, then `curl` it. Needs the `dev`
   npm script too.

**✓ SETTLED (2026-07-22) — `mapSleeperPlayer` timestamp sourcing: inject.** `syncedAt` is a
parameter, keeping the mapper pure (functional core; the clock is I/O and belongs to the
shell). The sync script mints `new Date()` once per run and passes it for every row — one
run = one timestamp, which also buys the stale-row seam (`WHERE synced_at < :runStart`) for
free later. Full rationale + rejected alternatives in `specs/002-player-sync.md` decision 5.
**Step 4 owes this decision its half of the bargain:** one `new Date()` per run, threaded.

**⟶ OPEN DECISION (resume here next session) — the zero-row policy.** A sync can produce
zero rows two ways, and they need opposite responses: an **empty payload** (Sleeper's
problem — re-run) versus **12,200 entries and none matching QB/RB/WR/TE** (our problem —
the filter is out of date). Options, laid out in full as spec decision 6: **(A)** abort on
each, checked separately so the message names which; **(B)** A plus a minimum-row floor,
which also catches a truncated payload but costs an arbitrary constant; **(C)** no check,
just print counts. Claude recommended **A** — zero is the only threshold that isn't a
guess. **Not yet decided.** Jacob decides on return, records it in the spec, then builds.

Two things follow from it and are also unsettled: `fetchPlayerPool()` likely returns the
*validated envelope* (`Promise<Record<string, unknown>>`) so the script can count entries
without re-parsing; and the fetch has to be swappable somehow (parameter vs
`vi.stubGlobal`) — **this is the one honest test double in the slice.** It exists to
provoke failures that cannot be summoned from the real API (a 500, an empty pool), not to
isolate units. The database is *not* mocked: in-memory PGlite is the real Postgres,
injected.

Data-flow order was chosen over a thinnest-possible-skeleton *deliberately*: nothing is
demoable until step 5, and that cost is accepted because the goal is understanding each
layer, not shipping speed. Revisit for slice 1, once the layers are familiar.

## Stack
- **TypeScript / Node.js**
- **PGlite** — real Postgres compiled to WASM, running in-process. No Docker, no
  server, no connection string. Real Postgres semantics (not SQLite pretending).
  Swap the driver for real Postgres later; schema and queries don't change.
- **Drizzle** — SQL-first ORM. Schema is TypeScript. No DSL, no codegen step.
  Chosen so Jacob learns SQL, not an ORM's query DSL.
- **Hono** — web-standards HTTP framework. TypeScript-first, `zValidator` middleware.
- **Zod** — runtime validation at every external boundary.
- **Vitest** — red-green-refactor.

**This stack is locked.** No further tool debates until slice 2 ships. Jacob's known
trap is over-structuring; tool-shopping is that trap in disguise.

## Commands
- `npm test` / `npm run test:watch` — Vitest
- `npm run typecheck` — `tsc --noEmit`
- `npm run db:generate` — generate a Drizzle migration by diffing `schema.ts`
- (to be added in slice 0) `npm run sync:players` — pull the Sleeper player pool
- (to be added in slice 0) `npm run dev` — start the Hono server

---

## Architecture — functional core, imperative shell

The old `CLAUDE.md` said "domain has no I/O, ever." That was a good instinct applied
too rigidly, and it produced beautiful code that couldn't leave memory. The revision:

- **Functional core (pure, no I/O):** all *calculations* and *rules*. `calcCapHit`,
  `calcCapUsed`, dead-money tables, holdout thresholds, salary escalation, legality
  checks. Plain functions over plain data. Trivially unit-testable. **This is where
  the interesting part of the project lives.**
- **Imperative shell (I/O at the edges):** entity classes and repositories may load and
  save. Route handlers orchestrate. The Sleeper sync script fetches.

**Rule: no rule ever gets computed inside a route handler or a query.** The handler
loads, calls the core, and serializes. If cap math appears in a Hono handler, that's a
bug.

### The four shapes (memorize this)

```
Sleeper JSON  →[validate + map]→  players table  →[load]→  Domain objects  →[serialize]→  API JSON
  theirs                            your mirror              your rules                    your contract
```

Four distinct shapes. Three translations, each of which is **code you own and control.**

- Sleeper's nullability, field names, and IDs **stop at the mirror table.**
- The DB's column names **stop at `serialize()`.** Never return raw DB rows from a route.
- If Sleeper renames a field, exactly one mapper file breaks — not the domain.

### Where invariants live
| Kind of rule | Enforced by |
| --- | --- |
| Uniqueness, foreign keys, NOT NULL, CHECK | **Postgres.** Declarative, atomic, race-proof. |
| Aggregate rules (committed cap ≤ league cap) | **Your code, inside a transaction.** No column constraint can express a SUM across rows. |

Knowing which is which is the core skill of this phase. Teach it explicitly.

---

## Slice roadmap
Each slice is **narrow in scope, complete in depth**, and demoable with `curl`.
If you can't demo it, it isn't a slice.

- **Slice 0 — player sync (spec 002).** Sleeper → Zod → Drizzle → PGlite →
  `GET /players`. Only the `players` table. Nothing else. ← *current*
- **Slice 1 — read the cap.** Introduce `leagues`, `teams`, `contracts`.
  `GET /teams/:id/cap` → `{ capUsed, capTotal, capSpace, isCapLegal }`. Spec 001's
  pure core finally gets a caller.
- **Slice 2 — first mutation.** `POST /teams/:id/contracts` (sign a free agent at a
  bid). Reject with `422` if it breaks the cap. **The transaction boundary appears here.**
- **Slice 3 — move a player.** `PATCH /contracts/:id` → IR / practice squad. Capacity
  limits (5 IR, 8 PS), eligibility, the 26-man ceiling.
- **Slice 4 — drop a player.** `DROPPED` status, dead-money table.

**Do not add a table, a column, or an endpoint until the slice needs it.**

---

## Hard conventions
- **Source code is ASCII-only.** No emoji, em dashes, or arrow glyphs anywhere under
  `src/` or `scripts/` — not even in comments and JSDoc. Use `-` and `->`. Emphasis comes
  from wording or CAPS, which the codebase already leans on. Markdown prose is exempt:
  `specs/*.md` and this file use them deliberately (the `⟶ YOU DECIDE` marker is
  load-bearing in the REASONS canvas).
- **Money is always integer cents.** Never floats.
- **`as` is not validation.** A type assertion is a lie to the compiler with zero
  runtime enforcement. Every external boundary (Sleeper, request bodies, query params)
  gets a Zod schema. No exceptions.
- **Derive, don't store.** A team's roster is a *query over contracts by status*, never
  a stored array. Cap used is computed, never cached.
- **Fixed-value fields are unions** (`Position`, `RosterStatus`) — never magic strings.
- **`isRosterable` is reserved** for real roster-eligibility logic — is he on another
  roster? is there a spot? the 26-man ceiling? IR/PS eligibility? That needs `Team` state
  and belongs to slices 2–3. It is **not** a position filter. "Is this a position La Liga
  uses?" is `isLeaguePosition`, over the `Position` union. Don't let a sync-time filter
  squat on a domain name.
- **Status is data, not type.** Never subclass to represent a bucket a thing moves between.
- **The sync is idempotent.** Upsert on a stable external key. Partial failure is fixed
  by rerunning, not by rolling back.
- **Single source of truth.** Never add a second way to answer the same question.

## Known landmines (from the reference demo — do NOT copy these)
The `jdraft` demo is a *shape* to learn from, not code to fork. Three things in it are
actively wrong for La Liga:

1. **`@@unique([teamId, playerId])`** — blocks drop-then-reacquire, which our rules
   allow (a `DROPPED` contract carrying dead money + a new live contract, same player,
   same team). Needs to be a **partial** unique index (`WHERE status <> 'DROPPED'`) or
   season-scoped.
2. **`onDelete: Cascade` on the Player relation** — a Sleeper sync deleting a player
   would silently wipe league contracts. Use **`RESTRICT`**. A third-party feed must
   never destroy league history.
3. **`as Record<string, SleeperPlayer>`** — see the `as` rule above. Zod it.

---

## How to work with Jacob
Jacob stays the architect. You are a **tutor and spotter, not an autocomplete.**
- **Explain before implementing.** (See the experience-level section — this is now the
  most important line in this file.)
- **Architecture-critical code** (schema design, module boundaries, domain API shape,
  cap logic): propose options + tradeoffs, let Jacob decide. **Jacob writes these tests
  himself.**
- **Rules-dictated logic** (cap multipliers, dead-money table, scoring, holdout
  thresholds — fully pinned by the ruleset): you may generate tests *from the ruleset*,
  and Jacob implements to green.
- **Small, reviewable chunks.** Don't advance until he can explain the diff.
- **Don't build ahead of the spec.** Park deferred items until their turn.
- When behavior is wrong, fix the spec first, then the code.

## Methodology
- **Outer loop:** one short spec per *slice* in `/specs` (REASONS-canvas style, by hand),
  written and owned by Jacob.
- **Inner loop:** TDD on the functional core. Red → green → refactor.

## Deferred — do not build yet
Everything not in the current slice. Specifically: holdout resolution, franchise/
transition tags, the March-1 rollover cascade, trades, blind-bid periods, scoring,
lineup slot eligibility, any UI, real Postgres, auth.

## The ruleset
The authoritative custom rules live in `docs/la-liga-rules.txt`. When implementing any
rule, **read it there** — never infer from memory.
