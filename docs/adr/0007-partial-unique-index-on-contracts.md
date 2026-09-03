---
status: superseded by ADR-0011
date: 2026-07-15
---

# Contracts get a partial unique index, not a plain composite unique

## Context and Problem Statement

A team should not hold two live contracts for the same player. The obvious
constraint is a composite unique on `(team_id, player_id)`, which is what the
reference demo uses. La Liga's rules make that wrong: a dropped player's salary
stays on the dropping team's cap for the current season, and dropping does not
bar the same team from reacquiring him. So the legal state includes a DROPPED
contract carrying dead money and a new live contract, same player, same team.

## Considered Options

* Plain composite unique on `(team_id, player_id)`.
* Partial unique index: unique on `(team_id, player_id) WHERE status <>
  'DROPPED'`.
* Season-scoped unique on `(team_id, player_id, season)`.
* No database constraint; enforce in application code.

## Decision Outcome

Chosen option: "partial unique index", because it states the actual rule - at
most one non-dropped contract per player per team - and Postgres enforces it
declaratively and race-free. A plain composite unique makes a legal league state
unrepresentable. Season scoping does not fix it either: a drop and a
reacquisition happen within one season, which is precisely the case.

### Consequences

* Good, because drop-then-reacquire works without the application checking
  anything, and two concurrent signings cannot both win.
* Bad, because the index depends on the literal string `'DROPPED'`, so the
  `RosterStatus` union and the migration are coupled. Renaming a status means a
  migration, exactly as the `CHECK` on `players.position` already does.
* Bad, because it does not constrain across teams. Nothing here stops two teams
  holding live contracts for the same player; that is roster eligibility, needs
  team state, and belongs to slice 2.

## Confirmation

Confirmed when the slice 1 migration creating `contracts` declares the partial
unique index, and a test inserts a DROPPED contract plus a live contract for the
same player and team and expects both to succeed.
