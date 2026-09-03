---
status: accepted
date: 2026-09-03
---

# The March 1 rollover inserts rows; it does not update salaries in place

## Context and Problem Statement

Slice 1 designs `contracts`, and the shape of that table decides what the annual
rollover can be. On March 1 every kept salary rises 20% and the cap rises 5%.
The cheap implementation is an UPDATE: multiply the column, keep one row per
contract forever. Recording the decision now, before the rollover slice exists,
is deliberate - the alternative is unrecoverable, so it cannot be left to be
discovered by whoever builds it.

Two later rules read the past. Dead money is "50% of its single-season value
when you dropped him", a figure from a season that has already rolled. Holdouts
compare a salary against "the average salary of the relevant group" at the end
of the season just played. An UPDATE answers neither, because the values they
need have been multiplied away.

## Considered Options

* Insert a row per contract per season; the current season is a WHERE clause.
* Update salaries in place, and separately snapshot whatever a past-reading rule
  turns out to need at the moment it needs it.
* Update in place, and reconstruct history by dividing by 1.2 per elapsed year.

## Decision Outcome

Chosen option: "insert per season", because the alternatives lose or corrupt the
data the ruleset reads. Reconstruction by division is arithmetically wrong the
moment any rule other than the standard raise touches a salary, and several do:
an extension applies 20% plus a $10 floor, an accepted holdout jumps to 75% of a
group average "in lieu of the standard 20% raise", a tag sets 120% or a top-five
average. None of those are invertible from the final number. Snapshotting on
demand is the same decision made late and piecemeal, with a different shape per
rule and no single place to look.

This ADR fixes the direction, not the schema. Slice 1 adds no season column at
all, because reading one team's current cap needs one number and
`docs/la-liga-rules.txt` is authoritative for it. What this rules out is
arriving at the rollover slice and reaching for `UPDATE contracts SET
salary_cents = ...`.

### Consequences

* Good, because every past-reading rule - dead money, holdouts, tag baselines -
  becomes a query rather than a migration, and none of them needs its own
  bespoke history mechanism.
* Good, because a season's figures stop changing once that season rolls, which
  makes a wrong number diagnosable instead of merely present.
* Bad, because `contracts` grows by roughly one row per player per season, and
  every query that means "now" acquires a season predicate. Forgetting one is a
  silent wrong answer, not an error.
* Bad, because "the contract" stops being a row and becomes a set of rows, so
  contract identity needs something the season rows share. That is a decision
  this ADR does not make and the rollover slice must.
* Bad, because slice 1 through slice 4 pay none of this and get none of it. The
  decision is recorded here on the strength of the ruleset, not of running code,
  and the first slice that tests it is not scheduled.
