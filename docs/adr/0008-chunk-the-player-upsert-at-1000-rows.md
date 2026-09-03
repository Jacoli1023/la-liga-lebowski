---
status: accepted
date: 2026-08-11
---

# Chunk the player upsert at 1,000 rows

## Context and Problem Statement

The sync writes roughly 4,030 rows per run in a single `INSERT ... ON CONFLICT`.
A Postgres statement counts its parameters in a 16-bit field, so 65,535 is the
hard maximum. This insert sends 12 parameters per row (`id` costs none, it goes
over as the literal DEFAULT), which puts the wall at 5,461 rows: 5,461 succeeds,
5,462 fails. Today's payload would therefore fit in one statement, at 74% of the
ceiling.

## Considered Options

* One statement, no chunking. Fits today.
* Chunk at 5,461, the measured maximum.
* Chunk at 1,000.

## Decision Outcome

Chosen option: "chunk at 1,000", because the ceiling is a function of the column
count, not of the row count. Add columns and 5,461 silently becomes the wrong
number, while 1,000 survives adding another fifty. Not chunking at all was
rejected for the same reason plus a worse one: the error on crossing the ceiling
names nothing. PGlite reports `Invalid array length` at 5,462 rows and
`Maximum call stack size exceeded` at 12,200, and neither message mentions
parameters.

### Consequences

* Good, because a schema change cannot quietly reintroduce the failure.
* Good, because it avoids an error class rather than relying on someone
  diagnosing it later from an unhelpful message.
* Bad, because 1,000 is a magic number, and this project otherwise rejects
  those. It is admissible only because it errs safe in the direction it can be
  wrong: too small costs a few extra round trips and nothing else. A minimum-row
  health-check floor was rejected precisely because it is wrong in both
  directions.
* Bad, because it turns one statement into four or five, which is what
  ADR-0009 then has to answer for.
