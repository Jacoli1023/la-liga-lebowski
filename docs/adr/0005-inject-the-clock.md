---
status: accepted
date: 2026-07-22
---

# Inject the clock into the sync rather than reading it

## Context and Problem Statement

Every mirrored player row carries a `synced_at` timestamp recording when the
sync last touched it. The mapper that builds those rows has to get that
timestamp from somewhere, and reading the clock is I/O.

## Considered Options

* Inject: `syncedAt` is a parameter of `mapSleeperPlayer(player, syncedAt)`, and
  the caller supplies it.
* Read it in the mapper: call `new Date()` inside `mapSleeperPlayer`.
* Let the database supply it: `synced_at timestamptz DEFAULT now()`.

## Decision Outcome

Chosen option: "inject", with the sync script minting one `new Date()` per run
and passing it for every row. The clock is I/O and belongs to the imperative
shell (ADR-0001); a mapper that reads it is no longer a pure function of its
input and cannot be tested without freezing time. Reading it per row would also
spread a single run across thousands of distinct timestamps, and a database
default would do the same while additionally putting the value out of the
mapper's reach.

### Consequences

* Good, because one run produces exactly one timestamp. That is directly
  testable, and it was: two consecutive full runs each produced one distinct
  `synced_at` across all 4,038 rows, which proves the second run refreshed every
  row rather than a subset.
* Good, because it buys the stale-row seam for free. Rows not touched by the
  current run are exactly `WHERE synced_at < :runStartedAt`, which is only
  meaningful because the run has a single timestamp.
* Bad, because the timestamp has to be threaded through every layer of the sync
  by hand, and any new entry point has to remember to mint one.
