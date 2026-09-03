---
status: accepted
date: 2026-09-03
---

# Contract liveness is its own column, not a member of RosterStatus

## Context and Problem Statement

ADR-0007 assumed a `DROPPED` member of `RosterStatus` and built the partial
unique index on `status <> 'DROPPED'`. Slice 1 is the ticket that has to declare
that index, and reading `docs/la-liga-rules.txt` while designing the table
showed the assumption loses information the ruleset needs. Part 2 charges a
dropped player at full salary for the current season, but a player dropped off
the Practice Squad "remains only 25% of the Practice Squad player's current
salary". One `DROPPED` status holds one multiplier and cannot express both,
because the fact it overwrites is what the player was dropped FROM.

The underlying problem is that a status column is a partition: every member must
answer the same question about the same axis. ACTIVE, IR and PRACTICE_SQUAD all
answer "which roster bucket". DROPPED answers "does this contract still bind",
which is a second question sharing one column with the first.

## Considered Options

* Liveness as its own column: `dropped_at timestamptz NULL`, `RosterStatus`
  unchanged at three members, index partial on `dropped_at IS NULL`.
* Keep ADR-0007: `DROPPED` joins `RosterStatus`, one multiplier for all drops.
* `DROPPED` joins `RosterStatus` plus a second column recording the bucket the
  contract was dropped from.
* A separate `cap_charges` table; dropping ends the contract and inserts a
  charge row.

## Decision Outcome

Chosen option: "liveness as its own column", because it leaves the cap
calculation exactly as it was - salary weighted by roster status - while making
a dropped contract keep saying which bucket it was in. The 25%-versus-100%
question then answers itself with no extra column and no branch. It also erases
both costs ADR-0007 recorded against itself: the index no longer depends on the
literal string `'DROPPED'`, so renaming a status no longer forces a migration.

The third option reaches the same answers by storing the bucket twice, once
live and once historical, and then has to keep them consistent. The fourth is
the right shape if cap charges ever outlive contracts - retained salary in a
trade would do it - and nothing in slices 1 through 4 needs that.

### Consequences

* Good, because `capHit` stays a single multiplication with no knowledge of
  whether a contract is live, and slice 4 adds the dead-money table rather than
  a schema correction.
* Good, because the partial index states the rule in the rule's own terms: at
  most one live contract per player per team.
* Bad, because slice 1 carries a column it never reads. Every `dropped_at` is
  null until slice 4, and the only thing that consumes it is the index.
* Bad, because liveness now has two possible causes and the column names only
  one. A contract also ends by expiring at rollover, and `dropped_at` cannot
  record that. Whoever builds the rollover must decide between a second column
  and an `ended_at` plus reason pair, and `dropped_at IS NULL` will stop meaning
  "live" on that day.

## Confirmation

Confirmed when the slice 1 migration declares
`CREATE UNIQUE INDEX ... ON contracts (team_id, player_id) WHERE dropped_at IS NULL`,
`RosterStatus` still has exactly three members, and a test inserts a dropped
contract plus a live contract for the same team and player and expects both to
succeed while a second live one is rejected.
