---
status: accepted
date: 2026-07-15
---

# Money is always integer cents

## Context and Problem Statement

La Liga's salary cap is $1,006 per team, and the ruleset weights salaries by
roster status: 50% for Injured Reserve, 25% for Practice Squad. Those
multipliers produce fractions of a cent on ordinary salaries, so the
representation of money has to be settled before any cap math is written.

## Considered Options

* Integer cents everywhere, with integer-only arithmetic.
* Floating-point dollars. Rejected without serious consideration; accumulated
  rounding error in money is a known defect class, and a cap comparison is an
  equality-sensitive operation.
* A decimal library. Correct, but it puts a dependency and a wrapper type
  between the reader and every salary in a project whose purpose is learning the
  layers underneath.

## Decision Outcome

Chosen option: "integer cents everywhere", computed as
`Math.floor(salaryCents * pct / 100)` - multiply first, divide last, so no float
ever touches money. Multipliers are stored as integer percents (100 / 50 / 25)
in a `Record` keyed by the full `RosterStatus` union, which makes `tsc` reject a
new status that has no multiplier.

### Consequences

* Good, because cap comparisons are exact integer comparisons, including at the
  boundary, where at the cap is legal.
* Good, because a missing multiplier is a compile error rather than a silent
  zero contribution to cap used.
* Bad, because every display of money needs a formatting step, and every
  external number needs a conversion at the boundary.
* Bad, because flooring is a policy, not a rounding accident: a half-cent case
  truncates down, so a discounted player counts at no more than his share. That
  is a deliberate choice in the league's favour and has to stay pinned by a test
  with an odd-cent salary.
