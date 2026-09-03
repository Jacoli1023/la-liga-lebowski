---
status: accepted
date: 2026-08-11
---

# The player upsert runs without a transaction

## Context and Problem Statement

ADR-0008 splits the sync's write into four or five statements. A crash between
them leaves some players refreshed to today's data and the rest holding
yesterday's. The question is whether to wrap the chunks in one transaction so
the write is all-or-nothing.

## Considered Options

* Wrap every chunk in a single transaction.
* No transaction; let a partial write stand.

## Decision Outcome

Chosen option: "no transaction", because nothing in the mirror table spans rows.
Each row is an independent mirror of one Sleeper entry, so a partly-finished
sync is partly old, not corrupt, and rerunning fixes it. Wrapping it would hold
locks over 4,030 rows to buy atomicity nothing needs.

### Consequences

* Good, because no lock is held across the whole write.
* Good, because it states the general rule for this table plainly: partial
  failure is fixed by rerunning, not by rolling back. That is what makes the
  sync safe to run again at any time.
* Bad, because a half-refreshed table is observable. Any future code that reads
  `synced_at` as "the whole table is current as of T" would be wrong; the column
  is per-row for exactly this reason.
* Bad, because this must not be cited as precedent for league writes. Slice 2's
  rule that committed cap stays at or under the league cap is an invariant ACROSS
  rows, and no column constraint can express a SUM. That case genuinely requires
  a transaction. The contrast is the useful part of this decision, not the
  conclusion.
