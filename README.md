# La Liga Lebowski

A configurable NFL fantasy-football simulator that implements a custom, real-world
league ruleset — salary cap, multi-year contracts, blind-bid free agency, keepers,
holdouts, franchise/transition tags, and an annual season rollover. The MVP is an **HTTP
API** covering drafting, roster management, and player acquisition, built to eventually run
a real friend group's league. Every increment is demoable with `curl`.

## Why this project exists

This is primarily a **learning project.** I'm using it to build back-end fundamentals
from the ground up — deliberately, one layer at a time:

- **Domain modeling** — turning a messy, human-written ruleset into a clean set of
  entities and invariants.
- **Architecture** — enforcing strict boundaries so the business logic doesn't leak
  into the interface or the database.
- **Persistence** — real Postgres from day one via PGlite (Postgres compiled to WASM,
  running in-process), with an ORM chosen specifically so I read the SQL rather than hide
  from it.
- **HTTP** — status codes, validation at the boundary, and what belongs in a route handler
  versus behind it.
- **Test-driven development** — every rule is pinned by a failing test before it's
  implemented.

The goal is understanding, not shipping speed. I'm optimizing for code I can fully
explain.

## Architecture

**Functional core, imperative shell.** All *calculations and rules* are pure functions over
plain data; all I/O lives at the edges. An earlier version of this README described a strict
ports-and-adapters layout with a rule that the domain could never touch I/O. That was a good
instinct applied too rigidly — it produced code that was beautiful and could not leave
memory. This is the correction.

```
src/
├── domain/   # Pure: rules, cap math, position unions. No I/O, ever.
├── db/       # Schema, migrations, and queries (Drizzle over PGlite).
├── sync/     # The Sleeper mirror: Zod validation + mappers, and its imperative shell.
└── http/     # Hono routes. Load, delegate, serialize - no rules computed here.
```

**No rule is ever computed inside a route handler or a query.** The handler loads, calls the
core, and serializes. If cap math shows up in an HTTP handler, that's a bug.

### The four shapes

```
Sleeper JSON  →[validate + map]→  players table  →[load]→  Domain objects  →[serialize]→  API JSON
  theirs                            my mirror                 my rules                    my contract
```

Four distinct shapes, three translations, each one code I own. Sleeper's field names and IDs
stop at the mirror table; the database's column names stop at `serialize()`. If Sleeper
renames a field, exactly one mapper breaks — not the domain, and not the API contract.

### Where invariants live

| Kind of rule | Enforced by |
| --- | --- |
| Uniqueness, foreign keys, `NOT NULL`, `CHECK` | **Postgres.** Declarative, atomic, race-proof. |
| Aggregate rules (committed cap ≤ league cap) | **My code, inside a transaction.** No column constraint can express a SUM across rows. |

Knowing which is which turned out to be the central skill of this phase.

### Domain model

```
League 1 ──*  Team 1 ──*  Contract 1 ──1  Player
```

- **League** — owns the teams and league-wide rules (salary cap, annual cap growth,
  the ordered season-rollover cascade).
- **Team** — owns many contracts. A team's active roster is **not stored**; it's a
  *query* over its contracts by status.
- **Contract** — the team↔player relationship: status, salary, contract term, years
  remaining. It carries the roster status; the player does not.
- **Player** — the global NFL human. Exists with or without a contract (free agents
  have none) and holds real-world facts only.

## Theory → practice

Alongside the code I'm working through **SICP** (*Structure and Interpretation of
Computer Programs*) — reading the chapters and doing the exercises. Half the fun is
watching its ideas turn into real conventions here instead of staying abstract. The
ones the codebase leans on hardest:

- **Derive, don't store** *(data abstraction — SICP §2.1).* Cap usage, the current
  roster, and roster counts are never stored; they're computed from a team's contracts
  on demand. That's data abstraction in SICP's sense — the rest of the system reaches a
  team through selectors and never touches how the roster is represented. One source of
  truth, nothing to keep in sync.

- **Status is data, not a subclass** *(data-directed programming — SICP §2.4–2.5).* A
  player's roster status (Active / IR / Practice Squad) is a field that maps to a
  salary-cap multiplier, not a class hierarchy. The cap math looks the multiplier up in
  a small table keyed by status — SICP's data-directed dispatch in miniature. A new
  status is a new row, not new branching logic.

- **Everything sits behind an abstraction barrier** *(SICP §2.1.2).* The domain core
  lives behind an interface, with the CLI and the database on the far side of it. Just
  as SICP builds rational-number arithmetic that doesn't care whether a number is
  stored as a pair, the league rules here don't care whether a terminal or Postgres is
  driving them.

A couple of the core conventions are just domain discipline rather than anything from a
book:

- **Money is always integer cents** — never floating point.
- **One central invariant** — committed cap ≤ league cap, always, checked at the moment
  of every mutation.

## Status & roadmap

Work is organized into **vertical slices**: each one is narrow in scope, complete in depth,
and demoable with `curl`. If it can't be demoed, it isn't a slice. No table, column, or
endpoint gets added until a slice needs it.

**Current — Slice 0, the walking skeleton:** Sleeper API → Zod → Drizzle → PGlite →
`GET /players`. Code complete; the end-to-end demo against freshly synced data is the last
step. The sync mirrors only the ~4,000 QB/RB/WR/TE rows out of Sleeper's 12,200, because the
league is offense-only — which is what lets the validation schema be strict.

Proven so far: two consecutive real syncs wrote **4,038 rows from 12,200 entries**, all
sharing a single `synced_at` — idempotency at full scale against the live feed, not a
fixture.

**The slices ahead:**

| | Slice | Delivers |
| --- | --- | --- |
| 1 | Read the cap | `leagues`, `teams`, `contracts`; `GET /teams/:id/cap` |
| 2 | First mutation | `POST /teams/:id/contracts` — sign a free agent, `422` if it breaks the cap. **The transaction boundary appears here.** |
| 3 | Move a player | `PATCH /contracts/:id` → IR / practice squad, with capacity limits |
| 4 | Drop a player | `DROPPED` status and the dead-money table |

Deferred until their slice arrives: holdouts, franchise/transition tags, the March-1
rollover cascade, trades, blind-bid periods, scoring, any UI, real Postgres, auth.

## Tech stack

- **TypeScript / Node.js** (pnpm, with mise pinning the toolchain)
- **PGlite** — real Postgres compiled to WASM, running in-process. No Docker, no server, no
  connection string, but real Postgres semantics rather than SQLite pretending. Swapping in
  a networked Postgres later leaves the schema and queries unchanged.
- **Drizzle** — a SQL-first ORM whose schema is TypeScript and which generates SQL I can
  read. Chosen so I learn SQL, not a query DSL.
- **Hono** — web-standards HTTP framework. An app is a fetch handler, so endpoint tests need
  no port and no HTTP client.
- **Zod** — runtime validation at every external boundary. A type assertion is a lie to the
  compiler with zero runtime enforcement; every boundary gets a schema instead.
- **Vitest** — red-green-refactor.

The player pool comes from the **Sleeper API**, mirrored into a local table by an idempotent
sync. An earlier draft of this README planned static seed data; mirroring a real third-party
feed turned out to be the more instructive version, and the anti-corruption boundary it
forced is now one of the load-bearing ideas in the codebase.

## How it's built

- **Outer loop:** a short, hand-written spec per feature in [`specs/`](specs/),
  capturing the decisions and tradeoffs before any code.
- **Inner loop:** test-driven development on the domain core — red, green, refactor.

The authoritative league rules live in [`docs/la-liga-rules.txt`](docs/la-liga-rules.txt).
