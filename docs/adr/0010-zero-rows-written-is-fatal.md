---
status: accepted
date: 2026-08-11
---

# Zero rows written is fatal, and is checked in two places

## Context and Problem Statement

The sync can finish having written no rows by two different routes, and their
remedies are opposites:

| What happened | Entries in | Rows out | Whose problem |
| --- | --- | --- | --- |
| Empty, failed, or wrong-URL response | 0 | 0 | Sleeper's - re-run later |
| Sleeper renamed positions or changed the field's type | 12,200 | 0 | Ours - the filter is stale, code must change |
| Truncated or partial response | ~2,000 | ~700 | Sleeper's - re-run later |

The second row is the dangerous one: the fetch succeeds, the JSON parses, the
envelope validates, every row is politely skipped, nothing is written, and the
process exits 0. A failure that looks like success. A check on `rows.length`
alone cannot tell it apart from the first row, and the two need opposite
responses.

## Considered Options

* Zero is fatal, checked in two places: abort if the payload has no entries,
  and abort separately if entries arrived but none survived the filter, with a
  message naming which.
* The above plus a minimum-row floor, say 3,000, which would also catch a
  truncated payload.
* No check. Print the counts and let a human notice.

## Decision Outcome

Chosen option: "zero is fatal, checked in two places", because zero is the only
threshold that is not a guess. Any positive floor is either too low to catch
anything real or too high and breaks on a slow day, and the number would have to
be re-defended every time the pool moves - which it does, by a few dozen rows a
month against the live feed. No check at all is defensible only while a human
runs the sync by hand and reads its output, so it is a policy that expires
silently the day the sync is scheduled.

The value is the message rather than the abort. One check could only say
"produced nothing"; two turn that into a diagnosis.

### Consequences

* Good, because the one failure in this area that would otherwise look like
  success - exit 0 having written nothing - is now loud.
* Good, because it introduces no constant that can rot.
* Bad, because a truncated payload still passes. The honest form of that check
  is relative, comparing today's yield against what the table already holds,
  which needs the database and belongs to a later slice.
* Bad, because the two messages share a trailing sentence, so a test matching
  the shared half passes for either abort - the exact failure those tests exist
  to catch. See docs/notes/measured.md.

## Confirmation

Both aborts are exercised by `src/sync/run.test.ts`. When the relative check
arrives, it supersedes this ADR rather than editing it: a minimum-row floor was
rejected here, and re-adding one as `if (rows.length < 3000) throw` would
reintroduce the option this decision turned down.
