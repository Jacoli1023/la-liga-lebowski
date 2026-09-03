---
status: accepted
date: 2026-07-15
---

# Sleeper identifiers and Sleeper's lifecycle stop at the mirror table

## Context and Problem Statement

The `players` table mirrors Sleeper's player pool, and league data - contracts
above all - has to reference a player. Two questions follow from that, and they
have the same answer: which identifier do league rows carry, and what happens to
league rows when a synced player disappears from Sleeper's feed?

## Considered Options

* Natural key: `sleeper_id` as the primary key, referenced directly by
  `contracts`. Paired with `onDelete: CASCADE` on the player relation, which is
  what the reference demo does.
* Surrogate key: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` plus
  `sleeper_id text NOT NULL UNIQUE`, with `contracts` referencing `players.id`
  and `onDelete: RESTRICT`.

## Decision Outcome

Chosen option: "surrogate key with RESTRICT", because a natural key propagates
a third party's identifier into `contracts` and out through our API forever,
which contradicts ADR-0002 in the one place it is cheapest to honour. RESTRICT
follows for the same reason from the other direction: a third-party feed must
never be able to destroy league history. Under CASCADE, a player dropping out of
Sleeper's response would silently delete the contracts that reference him.

### Consequences

* Good, because Sleeper can renumber, and league history does not move.
* Good, because it costs the sync nothing. `onConflictDoUpdate` targets any
  unique constraint, not necessarily the primary key, so the upsert aims at
  `sleeper_id` and stays a single statement.
* Bad, because debugging a contract row means a join to see a name, rather than
  reading `4034` and querying Sleeper directly.
* Bad, because it creates an invariant the sync must never break: a player's
  uuid has to survive every sync forever, or contracts orphan silently. `id` is
  therefore deliberately absent from the upsert's `set` clause, and a test
  asserts uuid stability across two runs.

## Confirmation

The uuid half is implemented and pinned by the run-twice test in
`src/db/players.test.ts`. The RESTRICT half is not yet built - `contracts` does
not exist until slice 1 - and is confirmed when that table's foreign key
declares `onDelete: RESTRICT` against `players.id`.
