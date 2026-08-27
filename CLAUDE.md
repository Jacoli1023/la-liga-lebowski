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

## Current state (2026-08-27, end of session)
**Vertical slices. Slice 0 (spec 002): steps 1–5 are CODE COMPLETE. The sync runs end to end
against the real Sleeper API and is idempotent in production; the HTTP layer is written,
tested, and lifecycle-verified. 40 tests green, `tsc` clean.**

**⟶ RESUME HERE:** the slice-0 demo — the one thing left, and deliberately left for Jacob
to run himself:

```
pnpm sync:players
pnpm dev
curl "http://localhost:3000/players?position=RB&team=DAL&limit=5"
```

Every layer is verified in isolation: `GET /players` against in-memory PGlite in the test
suite, and against a real disk-backed database in a scripted start/curl/SIGINT/restart cycle
(2026-08-27). What has **not** happened yet is the two together — 4,038 real Sleeper rows
served over HTTP. That is the whole demo, and it closes the slice.

**Also owed, both prose, both small:** record the `serialize` mutation in spec 002's test
plan next to the other three, and close or re-park the named `fetchPlayerPool` gap.

**Two rules from decision 8 worth carrying past this slice:** *a validator checks the
request; the database answers existence — never let a validator read the database* (slice
2's `422` is the apparent exception that proves it), and *`LIMIT` without `ORDER BY` is
nondeterministic*.

**Proven end to end 2026-08-12** by two consecutive real runs of `pnpm sync:players`:
- **4,038 rows** written from 12,200 entries. QB=474, RB=928, TE=845, WR=1791.
- **One distinct `synced_at` across all 4,038 rows.** This is the strongest evidence in the
  project: it proves decision 5's "one run = one timestamp" *and* that the second run
  refreshed **every** row rather than a subset. Idempotency at full scale, against the live
  feed rather than a 3-row fixture.
- Nullability re-measured live: 3,044 free agents, 9 null `years_exp`, 3,838 null
  `injury_status`. Spec 002's July figures were 3,062 / 9 / 3,868 — a few dozen rows of
  drift in one month, which is quiet vindication of decision 6's refusal to pick a
  minimum-row floor.

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

**Build order — data-flow, one new layer per step. Currently: step 5.**
1. ✅ `POSITIONS` / `Position` / `isLeaguePosition` in `rules.ts` — pure, no new tools
2. ✅ `src/db/schema.ts` + migration `0000_create_players` (the `CHECK` on `position` is
   generated from `POSITIONS`). `src/db/client.ts` — `createDb(path?)` factory applies it
   (PGlite + Drizzle + `migrate`); one factory, two callers (disk vs in-memory).
3. ✅ Zod schema + mapper — the anti-corruption boundary. `src/sync/sleeper.ts` holds the
   strict `sleeperPlayerSchema` and `mapSleeperPlayer(player, syncedAt)`. Jacob wrote the
   six tests in `sleeper.test.ts`; fixtures live in `sleeper.fixtures.ts`.
4. ✅ The sync — split into a pure half and an I/O half. **Done 2026-08-12.**
   - ✅ **Pure pipeline.** `mapSleeperPayload(payload: unknown, syncedAt): NewPlayer[]` in
     `src/sync/sleeper.ts` — envelope parse (`z.record`), filter, strict Zod, map. Jacob
     wrote all five tests, including the architecture-critical filter-before-validate one.
     *(Decided: extract the pure middle rather than inline it in the script. The filter
     test then needs no network double, and the fixtures it uses were already written.)*
   - ✅ **`CHECK` test** — `src/db/schema.test.ts`, the first test in the suite to boot
     PGlite. Mutation-verified: delete the `CHECK` from the migration and it goes red.
     Ships with a positive control (a legal row inserts, `gen_random_uuid()` fires, the
     row round-trips) so that "the bad insert failed" can't stay green when *every* insert
     fails. **This closed the "nothing calls `createDb()`" gap** — step 2 is now proven by
     the bar, not smoke-checked. Cost: the suite went ~180ms → ~3s.
   - ✅ **`src/db/players.ts` — `upsertPlayers(db, rows)`.** `onConflictDoUpdate` targeting
     `sleeper_id` (not the PK — our uuid is fresh every attempt, so a PK conflict never fires),
     chunked at 1,000. No transaction, deliberately. Full reasoning is in the file's
     docblock; the short version is in spec 002 near decision 1.
   - ✅ **Idempotency tests — Jacob's**, in `src/db/players.test.ts`. Run-twice (four
     claims, of which *uuid stability* protects slice 1's contracts) and the chunk boundary
     at 2,500 rows. Mutation-verified: dropping the final partial chunk turns the second
     one red. Two mutations survive *correctly* — overlapping chunks (idempotent, nothing
     observable changes) and no chunking at all (2,500 is under the 5,461 wall). Recorded
     in spec 002 so neither is later mistaken for a hole.
   - ✅ **`src/sync/run.ts` — the sync's imperative shell.** `fetchPlayerPool()` and
     `syncPlayers(db, fetchPool, syncedAt)` with decision 6's two aborts. Its pure sibling
     `sleeper.ts` keeps the Zod and the mappers; **that split is why they are two files.**
   - ✅ **`scripts/sync-players.ts` — wiring only.** Opens the db, mints one `new Date()`,
     prints, sets an exit code, closes in a `finally`. No logic. Because the testable half
     lives in `src/`, no `import.meta.url` guard is needed — a file with no top-level
     statements cannot run at import time.
   - ✅ `sync:players` npm script. `tsconfig` now includes `scripts/` and declares
     `"types": ["node"]`.
   - ✅ The envelope test, **Jacob's** — `[]`, `null`, `"oops"`, `42` all rejected, as an
     `it.each`. Asserts `toThrow(z.ZodError)` rather than matching the message, and is
     mutation-verified. See the `ZodError` fact below for why that distinction mattered.
5. ✅ **The HTTP layer** — written 2026-08-27, with decision 8 having settled its four
   shape questions before any code was written. That front-loading worked: no design
   question came up mid-implementation.
   - ✅ **`findPlayers(db, filters)`** in `src/db/players.ts`. The first query in the project
     whose SQL *text* — not just its parameters — varies with runtime input. Conditions are
     collected into an array and combined with a single `and(...)`, because **Drizzle's
     `.where()` is a setter, not an accumulator**: a second `.where()` REPLACES the first and
     silently drops a filter (measured 2026-08-26).
   - ✅ **`src/http/players.ts`** — `querySchema` (enum derived from `POSITIONS`, `team` as a
     shape regex, `z.coerce.number()` for `limit`), `PlayerResponse`, `serialize`, and the
     `createPlayersApp(db)` factory.
   - ✅ **Both owed tests — Jacob's**, in `src/http/players.test.ts`. Rows are seeded in
     reverse-alphabetical order so the `ORDER BY` assertion is a real claim rather than an
     accident of insertion. **Mutation-verified 2026-08-27:** rewriting `serialize` as
     `{ ...player }` turns the field-list assertion red — and that mutation *compiles clean*,
     which is why the assertion has to exist.
   - ✅ **`scripts/dev.ts` + the `dev` npm script**, with graceful shutdown on `SIGINT` and
     `SIGTERM`. Verified 2026-08-27 by a scripted start → curl → SIGINT → **restart**, the
     restart being the run that used to hang.
   - ⬜ **The `curl` demo against real synced data.** ← *here*

**✓ SETTLED (2026-07-22) — `mapSleeperPlayer` timestamp sourcing: inject.** `syncedAt` is a
parameter, keeping the mapper pure (functional core; the clock is I/O and belongs to the
shell). The sync script mints `new Date()` once per run and passes it for every row — one
run = one timestamp, which also buys the stale-row seam (`WHERE synced_at < :runStart`) for
free later. Full rationale + rejected alternatives in `specs/002-player-sync.md` decision 5.
**Step 4 owes this decision its half of the bargain:** one `new Date()` per run, threaded.

**✓ SETTLED (2026-08-11) — the zero-row policy: (A), zero is fatal, checked twice.**
`syncPlayers` aborts if the payload has no entries *("Sleeper returned an empty pool" —
theirs, re-run)* and aborts **separately** if entries exist but none survived the filter
*("12,200 entries, 0 matched QB/RB/WR/TE" — ours, the filter is stale)*. The value is the
two-message split: it turns "produced nothing" into a diagnosis, and it catches the one
failure in this slice that would otherwise **look like success** — exit `0` having written
nothing. Rejected a minimum-row floor (an arbitrary constant, wrong in both directions) and
no-check-at-all (a policy that silently expires the day the sync is scheduled). Known gap,
accepted: a *truncated* payload still passes. The honest form of that check is relative
("the table holds 4,030, today yielded 700"), needs the DB, and belongs to a later slice.
Full rationale in spec 002, decision 6.

**Where it lives:** `syncPlayers` (the shell). `mapSleeperPayload` keeps returning `[]` for
an empty payload and is right to — "zero rows is a catastrophe" is a *policy*, not a
property of a pure transform. That line is already pinned by a test.

**✓ SETTLED (2026-08-12) — the fetch seam: hand it over.** `syncPlayers(db, fetchPool,
syncedAt)`, not `vi.stubGlobal`. **The reframe that settled it:** two stacked functions want
a seam and their subjects differ. `fetchPlayerPool`'s subject is the HTTP call; `syncPlayers`'
is *policy*. A test of the first wants a fake `Response`; a test of the second wants a plain
object — and swapping `fetch` to serve the second means stringifying an object so
`fetchPlayerPool` can parse it back, a round trip to nowhere in every policy test. The
question was never "which technique," it was "at which level do I cut." **This is the
slice's one honest test double**, and it earns its place by provoking failures the real API
cannot be asked for (an empty pool, a malformed RB), not by "isolating units." Note what is
*not* mocked: the database. In-memory PGlite is real Postgres, injected. `fetchPlayerPool()`
returns the *validated envelope* (`Promise<Record<string, unknown>>`) so `syncPlayers` can
count entries for decision 6's first abort; values stay `unknown`, so trust still starts at
the strict schema. Full rationale + cost in spec 002, decision 7.

**⟶ NAMED GAP (open) — `fetchPlayerPool` has no test.** The cost of the line above: the
function you replace is the function you do not test, so its URL, its `res.ok` check, and
its envelope parse ship unexercised. Closing it needs its own small file swapping global
`fetch` — the right tool at the right level. Two assertions owed, listed in spec 002's test
plan. Not urgent: the real endpoint has now been hit successfully twice.

**Hard-won facts about this stack that will recur:**
- **Drizzle wraps driver errors.** `err.message` is Drizzle's `Failed query: insert into
  ...`; the Postgres message and its SQLSTATE are on **`err.cause`**. So
  `.rejects.toThrow(/constraint_name/)` fails, and worse, a loose matcher can pass by
  matching the *SQL text* in the wrapper rather than the error. Assert on `err.cause`.
  (`23` is the integrity-violation class: `23502` not-null, `23503` FK, `23505` unique,
  `23514` check.)
- **A statement is capped at 65,535 parameters** (a 16-bit field). At 12 params/row that
  is 5,461 rows — measured, not guessed. Crossing it produces `Invalid array length`,
  which names nothing. Hence chunking at 1,000.
- **PGlite on disk MUST be closed** (`db.$client.close()`). It persists a real Postgres data
  directory; exiting without closing leaves an unclean shutdown and **the next run hangs
  forever**. Measured 2026-08-12: run 1 fine, run 2 never returns. The run that breaks is
  not the run that misbehaved, which is what makes it vicious. Every disk-backed entry point
  closes in a `finally`.
- **PGlite's own mkdir is not recursive.** `./.data/players` fails with `ENOENT` when
  `./.data` does not exist — i.e. on every fresh clone. `createDb` now does
  `mkdir(path, { recursive: true })` first, which also makes it idempotent (no `EEXIST`).
- **`lib` and `types` in tsconfig answer different questions.** `lib` = what the JavaScript
  *language* provides (`Array`, `Promise`, `Map`). `types` = what the *host runtime*
  provides (`console`, `process`, `fetch`). None of those three are JavaScript. When tsc
  says `Cannot find name 'fetch'` it suggests adding `dom` to `lib` — **that advice is
  wrong here**: it would make `document` and `window` typecheck in a program where they do
  not exist. The fix is `"types": ["node"]`.
- **`err.cause` is where the truth lives, and this keeps recurring.** Both bugs found on
  2026-08-12 arrived disguised: a missing directory presented as
  `Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"`. When this stack's error names the
  wrong layer, read `.cause` before believing it.
- **A `ZodError`'s `message` is `JSON.stringify(issues, null, 2)`** — pretty-printed JSON,
  not prose. A regex over it pins Zod's *formatting* rather than its behavior. Assert
  `toThrow(z.ZodError)`, or read `err.issues` (`code`, `expected`, `path`). Same shape as the
  `err.cause` trap above: when an error carries structured data, the message is a rendering
  and the structure is the API.
- **`.parse()` does double duty — runtime check *and* type narrowing** (`unknown` →
  `Record<string, unknown>`). So deleting a parse to mutation-test it will not compile
  without an `as` cast, which is the Norms' "`as` is not validation" rule arriving from the
  other direction: the cast asserts the shape, the parse proves it.

- **A signal is not an exception, so `finally` never runs.** Ctrl+C sends `SIGINT`, whose
  default action terminates the process on the spot — nothing is thrown, so nothing unwinds.
  `scripts/sync-players.ts` gets its `db.$client.close()` for free from a `finally` because
  it *finishes*; a server does not, and needs `process.on("SIGINT"|"SIGTERM", ...)`.
  Registering a handler **replaces** the default, so the handler now owns exiting — and if
  it fails to exit, Ctrl+C is disarmed. Verified 2026-08-27: with the handler, the process
  ends `code: 0, signal: null` (shut down), not `signal: SIGINT` (killed).
- **`server.close()` is callback-based, not awaitable.** It returns the `Server`, not a
  Promise, so `await server.close()` is a no-op that silently reorders your shutdown. Wrap
  it in `new Promise`. The general shape, worth recognizing by sight: **if a function takes
  a callback as its last argument, awaiting the function does nothing** — and `await`
  accepts any value, so TypeScript will not complain.
- **Types are erased; only code enforces.** `const x: PlayerResponse = row` compiles clean
  and publishes every extra field, because TypeScript is *structurally* typed. The excess
  property check fires **only on keys spelled out in a fresh object literal** — so
  `return { ...player }` also compiles clean and also leaks. The guarantee in `serialize` is
  therefore the **explicit field list**, not the function boundary and not the return type.
  An explicit list fails loudly when a field goes missing; a spread fails silently when one
  is added.
- **`toEqual` rejects extra properties; `expect.objectContaining` allows them.** So an exact
  `toEqual` is the leak detector for a response contract — and it takes `unknown` as the
  actual value, so no cast is needed to use it.
- **`res.json()` is `unknown` here, not `any`** — a consequence of `"types": ["node"]`.
  Node's fetch typings return `Promise<unknown>` where the browser DOM lib returns
  `Promise<any>`. The stricter one is the better one: it refuses indexing until the shape is
  proven. Assert with `toEqual` rather than reaching for `as`, which in a test that exists to
  verify a shape would assume the very thing under test.
- **Query params are always strings.** `?limit=5` arrives as `"5"` — HTTP is text on a wire
  and has no types. `z.coerce.number()`, never `z.number()`. Measured edges: `""` coerces to
  `0` and fails `min(1)`; `"abc"` becomes `NaN`; `"20.5"` fails `.int()`. All reject, which
  is the only acceptable behavior at a boundary.

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
**Package manager is pnpm** (with mise pinning node + pnpm; see `mise.toml`). Never
`npm install` here — it would write a second lockfile alongside `pnpm-lock.yaml`.
- `pnpm test` / `pnpm test:watch` — Vitest
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm db:generate` — generate a Drizzle migration by diffing `schema.ts`
- `pnpm sync:players` — pull the Sleeper player pool
- (to be added in slice 0, step 5) `pnpm dev` — start the Hono server

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
