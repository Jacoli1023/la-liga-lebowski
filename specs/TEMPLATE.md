# Spec NNN - [title]

**Status:** draft | in progress | done
**Ticket:** #NN
**Slice:** [milestone name]

## Problem

What is wrong or missing, from the point of view of someone using the league.
Two or three sentences.

## Solution

What will be true when this is done, in the same voice. Not an implementation
plan.

## Done when

- [ ] A concrete, checkable statement. Prefer one that can be demonstrated over
      one that can only be inspected.
- [ ] ...

## Decisions

Decisions made while writing or building this ticket, as Y-statements. If a
decision here would make a future ticket wrong when unknown, it does not belong
in this file - promote it to `docs/adr/` and link it instead.

- In the context of X, facing Y, we decided for Z and neglected W, to achieve V,
  accepting that U.

## Out of scope

What a reader might reasonably expect here and will not find, and where it goes
instead.

## Test plan

Enumerate the cases before writing either the tests or the code. Red first, then
implement to green.

Cover non-trivial branching, the rules this ticket adds, and error-prone edges.
Do not cover framework behaviour, and do not write change-detectors. Assert on
an exact string or shape only where it IS the contract - and when you do, name
that contract in the test's title.

- [ ] ...
