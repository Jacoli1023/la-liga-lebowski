---
status: accepted
date: 2026-07-15
---

# Functional core, imperative shell

## Context and Problem Statement

La Liga's interesting logic is calculation: cap hits, dead money, holdout
thresholds, salary escalation, legality checks. That logic has to be reachable
from a database and an HTTP handler without becoming entangled with either.
An earlier version of this project's guidance said "the domain has no I/O,
ever," which produced correct, well-tested code that could not leave memory -
six green tests and no consumer.

## Considered Options

* Functional core, imperative shell: calculations are pure functions over plain
  data; entities, repositories and handlers do the I/O at the edges.
* Strict no-I/O domain: no domain type may touch persistence at all, so loading
  and saving live entirely outside the domain vocabulary.
* Active Record: entities load and save themselves, and rules live on the
  entities alongside the persistence.

## Decision Outcome

Chosen option: "functional core, imperative shell", because it keeps every rule
unit-testable without a database while still allowing entity classes and
repositories to load and save. The rule that carries the weight is narrower than
the old one and easier to check: no rule is ever computed inside a route handler
or a query. A handler loads, calls the core, and serializes.

### Consequences

* Good, because cap math is testable with plain objects and no fixtures, and it
  stays testable when the persistence layer changes.
* Good, because it gives a mechanical review question. If cap math appears in a
  Hono handler, that is a bug, not a style preference.
* Bad, because the split has to be re-decided at every new seam. Slice 0 spent
  real time deciding that the zero-row policy belonged to the shell rather than
  to the pure pipeline, and that `syncedAt` had to be injected rather than read.
* Bad, because "orchestration" in the shell has no test of its own unless one is
  written deliberately. Slice 0 shipped `src/sync/run.ts` with no test sibling
  for three weeks, which meant the zero-row aborts had never once executed.
