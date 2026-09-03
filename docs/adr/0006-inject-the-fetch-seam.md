---
status: accepted
date: 2026-08-12
---

# Inject the fetch, and cut the seam at policy rather than transport

## Context and Problem Statement

The sync's shell has to be testable against situations the live Sleeper API
cannot be asked to produce: an empty pool, a payload of 12,200 entries where
none match our positions, a malformed running back. Two stacked functions both
want a seam - `fetchPlayerPool`, whose subject is the HTTP call, and
`syncPlayers`, whose subject is policy.

## Considered Options

* Inject the fetcher: `syncPlayers(db, fetchPool, syncedAt)`, where `fetchPool`
  is a parameter.
* Replace the global: `vi.stubGlobal("fetch", ...)` in the tests, leaving
  `syncPlayers` to call `fetchPlayerPool` directly.
* Mock the database as well, so the shell is tested with no real Postgres.

## Decision Outcome

Chosen option: "inject the fetcher", because the question was never which
technique but at which level to cut. A test of the HTTP call wants a fake
`Response`; a test of policy wants a plain object. Serving the second by swapping
`fetch` means stringifying an object so `fetchPlayerPool` can parse it back - a
round trip to nowhere in every policy test. `fetchPlayerPool` returns the
validated envelope, so `syncPlayers` can count entries without values ever
becoming trusted; they stay `unknown` until the strict schema runs.

The database is deliberately not mocked. In-memory PGlite is real Postgres,
injected the same way.

### Consequences

* Good, because it makes the sync three-for-three on injection - `db`,
  `syncedAt`, `fetchPool` - so nothing in the module graph performs I/O at
  import time.
* Good, because the double exists to provoke failures the real API cannot be
  asked for - an empty pool, a malformed row - rather than to isolate a unit
  from a dependency that works fine.
* Bad, because the function you replace is the function you do not test.
  `fetchPlayerPool` needs its own tests at its own level, and for three weeks it
  had none, which meant the zero-row aborts had never executed.
