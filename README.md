# La Liga Lebowski

A configurable NFL fantasy-football simulator that implements a custom, real-world
league ruleset — salary cap, multi-year contracts, blind-bid free agency, keepers,
holdouts, franchise/transition tags, and an annual season rollover. The MVP is a
terminal application covering drafting, roster management, and player acquisition,
built to eventually run a real friend group's league.

## Why this project exists

This is primarily a **learning project.** I'm using it to build back-end fundamentals
from the ground up — deliberately, one layer at a time:

- **Domain modeling** — turning a messy, human-written ruleset into a clean set of
  entities and invariants.
- **Architecture** — enforcing strict boundaries so the business logic doesn't leak
  into the interface or the database.
- **Persistence** — starting in-memory, then moving to SQLite, then Postgres, so I
  understand each layer before depending on it.
- **Test-driven development** — every rule is pinned by a failing test before it's
  implemented.

The goal is understanding, not shipping speed. I'm optimizing for code I can fully
explain.

## Architecture

The project follows a **ports-and-adapters (hexagonal)** structure. The domain core
is pure and has no idea what's driving it:

```
src/
├── domain/       # Pure business logic: entities + rules. No I/O, no framework, no DB.
├── cli/          # Terminal adapter — one way to drive the core.
└── persistence/  # Storage adapter — swappable (in-memory → SQLite → Postgres).
```

The terminal and the database are just adapters plugged into the core. New interfaces
or storage backends are added **without modifying the domain logic** — the whole point
of the boundary.

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

**Current:** The in-memory domain core is under active TDD. The salary-cap calculation
is done — `Team.calcCapUsed()` computes status-weighted, floor-rounded committed cap
across a team's contracts.

**Next up:**

- Cap-legality invariant (`committed cap ≤ league cap`) and the `League` entity
- Dead-money handling for dropped players
- Blind-bid free agency and player acquisition
- Keepers, holdout resolution, and franchise/transition tags
- The full season-rollover cascade
- Persistence beyond in-memory (SQLite → Postgres)
- The terminal (CLI) adapter

## Tech stack

- **TypeScript / Node.js**
- **Vitest** for testing, worked red-green-refactor
- No external APIs in the MVP — the player pool is static seed data. Real NFL stat
  integration is a deliberate later module, not a dependency.

## How it's built

- **Outer loop:** a short, hand-written spec per feature in [`specs/`](specs/),
  capturing the decisions and tradeoffs before any code.
- **Inner loop:** test-driven development on the domain core — red, green, refactor.

The authoritative league rules live in [`docs/la-liga-rules.txt`](docs/la-liga-rules.txt).
