---
status: accepted
date: 2026-09-03
---

# isCapLegal reports a comparison; it does not enforce a rule

## Context and Problem Statement

`GET /teams/:id/cap` publishes an `isCapLegal` field, and slice 2 rejects a
signing with 422 when it would break the cap. Both look like the same question,
so it is tempting to have one answer serve both. They are not the same question.
`docs/la-liga-rules.txt` says teams must stay at or under the cap during the
season, and that after NFL Week 17 "Teams can exceed salary cap". So whether an
over-cap team is doing something wrong depends on the date, which needs the
clock injected by ADR-0005.

## Considered Options

* `isCapLegal` is the unconditional comparison `capUsed <= capTotal`, and the
  calendar lives in whatever code enforces.
* `isCapLegal` is phase-aware: it consults the clock and returns true for an
  over-cap team in the offseason.
* The endpoint omits the field and returns only the three figures, leaving the
  comparison to clients.

## Decision Outcome

Chosen option: "unconditional comparison", because the reader and the enforcer
want different things from it. A team owner looking at the cap page in December
wants to see that they are over, not to be told everything is fine; the rule
they are relieved of is permission to stay over, not a change to the arithmetic.
Making the field phase-aware means the number and the flag disagree on screen,
which is the confusing outcome.

Enforcement therefore owns the calendar. Slice 2 asks two things - would this
signing put the team over, and does the calendar forbid being over right now -
and only both together produce a 422.

### Consequences

* Good, because slice 1 needs no clock, and the cap core stays a pure function
  of contracts and one integer.
* Good, because the calendar appears in exactly one place when it appears, next
  to the rejection that depends on it, rather than being smuggled in through a
  read endpoint.
* Bad, because a client reading `isCapLegal: false` cannot tell whether that is
  a problem without knowing the date, and nothing in the response tells it. The
  field is a fact about arithmetic wearing a word that sounds like a verdict.
* Bad, because the name will invite exactly the wrong assumption in slice 2. A
  reader who sees `isCapLegal` and skips the calendar check ships a bug that
  only fires in December.
