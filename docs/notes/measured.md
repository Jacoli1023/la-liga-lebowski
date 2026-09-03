# Measured facts

Things we found out by running this stack, which are in no vendor documentation.
Anything answerable by reading the docs does not belong here - look it up
instead.

Append-only, newest at the bottom, each entry dated.

---

## 2026-08-11 - a Postgres statement is capped at 65,535 parameters

A 16-bit field. Our players insert sends 12 parameters per row (`id` costs none,
it goes over as the literal DEFAULT), so the wall is at 5,461 rows: 5,461
succeeds, 5,462 fails. The failure names nothing useful - PGlite reports
`Invalid array length` at 5,462 rows and `Maximum call stack size exceeded` at
12,200. Neither mentions parameters.

## 2026-08-12 - PGlite on disk must be closed, or the NEXT run hangs forever

`db.$client.close()`. PGlite persists a real Postgres data directory, and
exiting without closing leaves an unclean shutdown. Run 1 is fine; run 2 never
returns. The run that breaks is not the run that misbehaved, which is what makes
this expensive to diagnose. Every disk-backed entry point closes in a `finally`.

## 2026-08-12 - PGlite's own mkdir is not recursive

`./.data/players` fails with `ENOENT` when `./.data` does not exist, so it fails
on every fresh clone. Worse, the error names the wrong layer: it arrives as
`Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"`. The truth was on
`err.cause`.

## 2026-08-26 - Drizzle's `.where()` is a setter, not an accumulator

A second `.where()` call REPLACES the first and silently drops the earlier
filter. No error, no warning, wrong rows. Collect conditions into an array and
combine them with a single `and(...)`.

## 2026-09-02 - selectivity, not indexing, decides the plan on this table

`position = 'RB'` matches roughly 23% of the players table, and Postgres
sequentially scans rather than doing 928 scattered heap fetches. A `sleeper_id`
lookup is one row out of 4,038 and uses its index every time. Related: `LIMIT`
bounds the response, not the work - `ORDER BY full_name, sleeper_id LIMIT 20`
over a position filter sorts all 928 matching rows and discards 908. Only a
composite index on `(position, full_name, sleeper_id)` lets the scan stop early,
which is why column order in a composite index matters.

## 2026-09-02 - two mutation traps in the sync's abort tests

Both zero-row abort messages end with the same sentence, so a regex over the
shared half passes for either abort - the one failure those tests exist to
catch. Match a phrase unique to each message.

The 500-response stub's body must contain no digits. Node's JSON parse error
quotes its input, so a body containing `500` leaves the test green after
deleting the `res.ok` check, because the resulting `SyntaxError` message happens
to match too.

## 2026-09-02 - Sleeper's payload, measured against the live feed

12,200 entries in, 4,038 rows out at QB/RB/WR/TE. QB=474, RB=928, TE=845,
WR=1791. Of those 4,038: 3,044 have a null `team`, 9 have a null `years_exp`,
3,838 have a null `injury_status`. The July figures were 3,062 / 9 / 3,868, so
a few dozen rows drift in a month. That drift is the reason no minimum-row floor
was adopted as a health check.
