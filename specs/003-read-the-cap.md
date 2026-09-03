# Spec 003 - Read the cap

**Status:** in progress
**Ticket:** #1, #2, #3, #4
**Slice:** Slice 1 - read the cap

## Problem

The league has a player pool and no league. There is nowhere to record that a
team holds a player at a salary, so the central figure of the whole ruleset -
how much cap a team has committed - cannot be asked, let alone answered. Spec
001's cap arithmetic exists but has no caller and no data.

## Solution

An owner can ask what their team has committed and how much room is left, and
get a straight answer: `GET /teams/:id/cap`. The three tables the rest of the
league hangs off - leagues, teams, contracts - exist, with the database refusing
the states that are not legal. Nothing writes a contract yet; that is slice 2.

## Done when

- [ ] `pnpm sync:players && pnpm seed:league && pnpm dev`, then
      `curl localhost:3000/teams/<id>/cap` returns the four figures for a real
      seeded team.
- [ ] The seeded over-cap team returns `isCapLegal: false` with a negative
      `capSpaceCents`.
- [ ] A well-formed but unknown team id returns 404; a malformed one returns 400.
- [ ] No cap arithmetic appears in a route handler or a SQL query.
- [ ] `src/domain/contract.ts` and `src/domain/team.ts` no longer exist.

Per-ticket done-when and test plans live on issues #1 through #4.

## Decisions

- In the context of representing contracts and teams in the domain, facing a
  choice between the entity classes spec 001 introduced and plain data with pure
  functions, we decided for plain data and neglected the classes, to achieve a
  core the repository can hand rows to directly, accepting that there is no
  longer any object to hang future contract behaviour on. What forced it: a
  `Contract` class protects no invariant, because every integer salary is
  constructible and legality is a sum across rows that no single contract can
  check; and `Team` holding a `Contract[]` is exactly the stored roster
  `CONTEXT.md` forbids.

- In the context of weighting a salary by roster status, facing multipliers of
  50% and 25% that produce fractions of a cent, we decided for
  `Math.floor(salaryCents * pct / 100)` with integer percents and neglected
  rounding and float arithmetic, to achieve money math no float ever touches,
  accepting that a discounted player counts at up to one cent less than his
  exact share. Carried forward from spec 001, which is now deleted.

- In the context of the status-to-multiplier table, facing the risk that a new
  roster status silently contributes zero, we decided for
  `Record<RosterStatus, number>` keyed by the full union and neglected a lookup
  function with a default, to achieve a compile error when a status has no
  multiplier, accepting that the table cannot be loaded from the database and so
  is not per-league configurable yet. Carried forward from spec 001.

- In the context of loading what the cap endpoint needs, facing a choice between
  one query joining down to contracts and two separate queries, we decided for
  two and neglected the join, to achieve an unambiguous answer to "does this team
  exist" that does not depend on inspecting a NULL, accepting a second round
  trip. It costs nothing measurable against in-process PGlite: no network, no
  connection pool. Aggregating with SQL `SUM()` was never on the table - that is
  the cap rule inside a query, which ADR-0001 forbids.

- In the context of naming the fields of the cap response, facing the fact that
  every figure is integer cents, we decided for a `Cents` suffix on all three
  and neglected the bare names the milestone proposed, to achieve a unit a
  client can actually see, accepting three longer field names. `capUsed: 100600`
  invites a client to render "$100,600" - wrong by a factor of 100, silently.

- In the context of where the cap total lives, facing a single league whose cap
  is fixed at one figure today, we decided for a `leagues` table with one row and
  neglected a constant in `rules.ts`, to achieve a cap the rollover can UPDATE
  and a league for `teams` to hang off, accepting a table with one row in it. The
  cap is not a constant: it grows 5% a year.

- In the context of the `status` and `position` columns, facing a choice between
  a Postgres `ENUM` type and `text` with a `CHECK`, we decided for text and
  CHECK and neglected the enum, to achieve consistency with the `players` table
  and a one-line constraint swap when a value changes, accepting that the
  database will not offer the values by name to a client tool.

## Out of scope

- Writing a contract. Slice 2, `POST /teams/:id/contracts`, where the
  transaction boundary first appears.
- Contract term. No `years_total`, no `years_remaining` - slice 2 is the first
  ticket that needs one, because a blind bid is automatically a 1-year deal.
- Dropping, dead money, and what `dropped_at` is for. Slice 4. This slice adds
  the column because the partial unique index needs it; see ADR-0011.
- Any notion of season in the schema. Deferred until the rollover slice, whose
  shape ADR-0013 constrains.
- Roster limits, position eligibility, and cross-team exclusivity. Nothing here
  stops two teams holding live contracts for the same player. That is roster
  eligibility, it needs team state, and `CONTEXT.md` reserves the name
  `isRosterable` for it.
- Enforcing the cap. `isCapLegal` reports a comparison; see ADR-0012.

## Test plan

Enumerated per ticket on issues #1 through #4, so that each ticket's red-first
list sits with the ticket rather than in a second copy here.

The two edges worth naming at slice level, because they cut across tickets:

- [ ] A dropped contract and a live contract, same team and same player, both
      insert. This is ADR-0011's confirmation and the whole reason `dropped_at`
      exists in slice 1.
- [ ] The cap response carries exactly four fields. Per ADR-0002 the explicit
      field list is the only thing stopping internal columns reaching a client,
      so this assertion is strict on purpose.
