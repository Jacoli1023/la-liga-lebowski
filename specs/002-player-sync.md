# Spec 002 — Player Sync (The Walking Skeleton)

**Status:** **In progress (2026-08-12)** — **steps 1–4 DONE, nothing owed**, step 5 (the HTTP
layer) is all that remains. 38 tests green, `tsc` clean. **The network is no longer
untouched:**
`pnpm sync:players` has been run twice against the live Sleeper API, writing **4,038 rows**
(QB=474, RB=928, TE=845, WR=1791) from 12,200 entries. Requirement 1 of the Definition of
Done below is **met and demonstrated**.

**The measurement worth keeping from that run:** after the second run, the table held
**one distinct `synced_at` across all 4,038 rows**. That is decision 5's "one run = one
timestamp" *and* proof that the second run refreshed **every** row rather than a subset —
idempotency demonstrated at full scale against the real feed, not a 3-row fixture.

**Nullability re-measured live (2026-08-12)**, against decision 2's July figures: free
agents 3,044 (was 3,062), null `years_exp` 9 (was 9), null `injury_status` 3,838 (was
3,868). A few dozen rows of drift in one month — quiet vindication of decision 6's refusal
to pick a minimum-row floor, since the number it would have been pinned to is visibly not a
constant. **Nothing is open**: the original seven decisions (2026-07-15), decision 5
(2026-07-22), decision 6's zero-row policy (2026-08-11), and decision 7's fetch seam
(2026-08-12). Each is recorded inline below with its rationale *and its cost*. The ⟶ **YOU
DECIDE** blocks are kept rather than deleted: the question is the context for the answer, and
a decision without its alternatives is just a rule.

**Decision 8 (2026-08-12) settles the read path** — the factory, the `?team=` shape check,
the row order, and what crosses `serialize()` — so step 5 is unblocked from the top.

**Resume at:** step 5, first code chunk — the query Zod schema and `findPlayers(db, filters)`
in `src/db/players.ts`, next to `upsertPlayers`. The SQL for a *conditional* `WHERE` is the
new thing to read there; the route and the `dev` script follow it.

**Two bugs found by the first real runs, both now fixed and both in the persistence
lifecycle rather than the sync logic** — worth recording because neither could have been
caught by the test suite as designed, since the suite uses in-memory PGlite and the entry
point is the one thing no test imports:
1. **PGlite's mkdir is not recursive.** `./.data/players` fails with `ENOENT` when `./.data`
   does not exist, i.e. on every fresh clone. Fixed in `createDb` rather than the script,
   because step 5's dev server opens the same path and the Safeguards below require it to
   start even when the sync has never run.
2. **A disk-backed PGlite must be closed.** Exiting without `db.$client.close()` leaves an
   unclean shutdown, and **the next run hangs forever** - run 1 fine, run 2 never returns.
   That is requirement 1 ("running it twice produces the same result") broken in the
   nastiest available shape, since the run that fails is not the run that misbehaved. The
   entry point now closes in a `finally`, so it happens on the success path, the error path,
   and the createDb-threw path alike.

Both arrived disguised as something else: the missing directory presented as Drizzle's
`Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"`, with the real `ENOENT` on `err.cause`.
Third appearance of that trap in this slice.
**Why this is the slice:** it is the thinnest thing that touches *every layer* — an
external API, validation, a mapper, a schema, a migration, a database, and an HTTP
route. It is deliberately boring. Its job is to prove the wires connect, and to put
real NFL players in your database so that every slice after this one has something to
stand on.

**What this slice is NOT:** it is not the cap, not contracts, not teams. Resist.

---

## R — Requirements / Definition of Done
1. `pnpm sync:players` fetches the Sleeper player pool, validates it, maps it, and
   upserts it into a local PGlite database. Running it twice produces the same result.
2. `pnpm dev` starts a Hono server.
3. `curl 'localhost:3000/players?position=RB&team=DAL'` returns real NFL running backs
   from *your* database as JSON.

That's it. If you can demo those three commands, the slice is done.

## E — Entities involved
**One table: `players`.** A *mirror* of Sleeper — their fields, their nullability.

No `leagues`. No `teams`. No `contracts`. Those arrive in slice 1, when the cap
endpoint actually needs them. Adding them now is horizontal thinking wearing a
vertical hat.

⟶ **YOU DECIDE (0) — Which rows?** *(This decision wasn't in the original draft. It
surfaced once we actually looked at the payload, and it turned out to be the most
consequential one in the slice.)* Sleeper returns **12,200** entries across **29**
`position` values — `OL`, `NT`, `LS`, `K/P`, `ATH`, and 240 rows with `position: null`.
`docs/la-liga-rules.txt:6` starts `1 QB, 2 RB, 3 WR, 1 TE, 1 RB/WR Flex, 1 WR/TE Flex`
— La Liga is **offense-only**. No K, no DEF, no IDP. That is **4,030** relevant rows.

✓ **DECIDED: skill positions only (QB/RB/WR/TE, ~4,030 rows).**

*Why:* it lets the Zod schema be **strict**, and a strict schema is the entire point of
this boundary. Measured against the real payload, the nullability chaos is caused
almost entirely by rows we can never roster. Among the 4,030 skill rows, `full_name`,
`first_name`, `last_name`, `fantasy_positions`, and `status` are **never null**. Only
three fields are genuinely nullable, each for a real-world reason:

| field | nulls | meaning |
| --- | --- | --- |
| `team` | 3,062 | free agent |
| `injury_status` | 3,868 | healthy |
| `years_exp` | 9 | real data gaps |

Mirroring all 12,200 would force `full_name`, `years_exp`, and `status` to be optional
purely to accommodate 32 team defenses — turning a tripwire into a shrug. If Sleeper
ever renames `full_name`, a strict schema fails loudly; a loose one absorbs it.

*Where the rule lives:* "which positions La Liga rosters" is a **league rule**, and
rules do not belong in the imperative shell. It lives in the functional core, in
`src/domain/rules.ts`, as the `Position` union CLAUDE.md always called for:

```ts
export const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type Position = (typeof POSITIONS)[number];
export function isLeaguePosition(value: string | null | undefined): value is Position
```

**Not `isRosterable`.** That name is reserved for the real question it describes — is
he on another roster, is there a spot, does the 26-man ceiling allow it, is he IR- or
PS-eligible. That is `Team`-state domain logic and it belongs to slices 2–3. A sync-time
position filter must not squat on it.

`POSITIONS` is the single source of truth. Three things **derive** from it, none of them
a copy: the Zod enum (`z.enum(POSITIONS)`), the sync's filter, and the `CHECK`
constraint (`schema.ts` imports it). The import direction is correct — shell depends on
core, never the reverse.

*It also makes the query contract honest:* the only positions in the table are exactly
`QB|RB|WR|TE`, so the `?position=` enum is a **complete** description of the column.
Mirroring everything would mean rejecting `?position=LB` while 1,162 linebackers sat
in the table — filter and contract disagreeing.

*What it costs:* if the league ever adds K or DEF, change `POSITIONS`, generate a
migration (the `CHECK` is frozen SQL — see decision 2), and re-sync. The sync runs daily
anyway, so the cost of reversing this is one day.

## A — Approach

**The sync script** (`scripts/sync-players.ts`):
```
fetch  →  Zod parse  →  map to our shape  →  chunked upsert (onConflictDoUpdate)
```
Sleeper's endpoint (`https://api.sleeper.app/v1/players/nfl`) returns a **14.6MB** JSON
*object keyed by player_id* — not an array. **12,200 entries** (measured 2026-07-15; the
draft's "~5MB / ~11k" was a guess). The object's key always equals the row's own
`player_id`, so either is a stable handle. Sleeper asks that it be called at most once
per day. This is a script, not a request path.

**Why "chunked" is not a style choice** *(measured 2026-08-11, during step 4)*. A Postgres
statement counts its parameters in a **16-bit field**, so 65,535 is the hard ceiling. The
insert sends **12 parameters per row** — `id` costs none, travelling as the literal
`default`, which the generated SQL confirms. That puts the wall at **5,461 rows**: 5,461
succeeds, 5,462 fails. Today's ~4,030 would therefore fit in a single statement, at 74% of
the ceiling.

We chunk anyway, at **1,000**, for a reason that is not "it doesn't fit": *the error when
you cross it is undiagnosable.* PGlite reports `Invalid array length` at 5,462 rows and
`Maximum call stack size exceeded` at 12,200. Neither mentions parameters. And 1,000 rather
than the maximal 5,461 because the ceiling is a function of the **column count** — 5,461
silently becomes wrong the next time a column is added, while 1,000 survives adding fifty.

*Why this magic number is allowed where decision 6's row floor was not:* this one is **safe
in the direction it errs**. Too small costs a few extra round trips and nothing else; no
value is ever silently wrong. The rejected 3,000-row floor was wrong in *both* directions —
too low to catch real truncation, or high enough to fire on a slow day. A constant is
acceptable when the cost of being wrong is bounded and cheap.

**The read endpoint** (`src/http/players.ts`):
```
Hono route  →  zValidator('query')  →  Drizzle select  →  JSON
```

⟶ **YOU DECIDE (1) — Primary key.** Sleeper's `player_id` as the PK directly
(natural key), or your own UUID with `sleeperId` as a unique column (surrogate key)?
The demo chose the former. Tradeoff: natural keys make the sync trivially idempotent
and joins obvious, but couple your schema to a third party's identifier forever.
Surrogate keys cost one extra lookup and buy you independence. **Pick one and write
down why.**

✓ **DECIDED: surrogate.** `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` plus
`sleeper_id text NOT NULL UNIQUE`.

*Why:* this slice's whole thesis is the anti-corruption boundary — "Sleeper's
nullability, field names, and IDs **stop at the mirror table**" (CLAUDE.md). A natural
key propagates their identifier into `contracts` and out through the API forever,
contradicting that principle in the one place it is cheapest to honor.

*What it costs:* debugging a contract row means a join to see a name, instead of
reading `4034` and curling Sleeper directly. Accepted.

*What it doesn't cost:* the sync. `onConflictDoUpdate` targets **any unique
constraint**, not necessarily the primary key — so the upsert aims at `sleeper_id`
and stays a single statement. The uuid is free at sync time.

⟶ **YOU DECIDE (2) — Which fields to persist.** The demo kept 11. You need to actually
look at the payload. Two you should think hard about:
- `fantasy_positions` — an **array** (`["RB","WR"]`). Your RB/WR and WR/TE flex slots
  will need it. Postgres can store arrays natively. Do you want it now, or is that
  building ahead?
- `years_exp` — `0` means rookie. Your `isRookie` seam maps straight to this.
  `injury_status` / `status` feed your `irEligible` seam.

✓ **DECIDED: 13 columns.** Nullability below is *measured* against the real payload,
not copied from Sleeper's docs.

| column | type | null? | why |
| --- | --- | --- | --- |
| `id` | uuid PK | no | ours |
| `sleeper_id` | text UNIQUE | no | their key; the upsert target |
| `first_name` | text | no | never null in skill rows |
| `last_name` | text | no | never null in skill rows |
| `full_name` | text | no | their canonical string |
| `position` | text | no | not-null **by construction** — we filtered on it |
| `team` | text | **yes** | null = free agent |
| `fantasy_positions` | text[] | no | never null in skill rows |
| `years_exp` | integer | **yes** | `isRookie` seam (`0` = rookie) |
| `status` | text | no | `irEligible` seam |
| `injury_status` | text | **yes** | null = healthy; `irEligible` seam |
| `active` | boolean | no | never null |
| `synced_at` | timestamptz | no | **ours, not a mirror** — when the sync last touched this row |

Two judgment calls worth naming:
- **`fantasy_positions` is mild building-ahead.** `GET /players?position=RB` does not
  need it. Kept because the RB/WR and WR/TE flex slots are *confirmed in the ruleset*
  rather than speculative, it is never null for skill players, and `text[]` is a real
  Postgres lesson otherwise skipped. Reversible: drop the column, re-sync.
- **`full_name` brushes against "derive, don't store"** — first + last are both here.
  Kept because it is *mirrored, not derived*: it is Sleeper's canonical string,
  handling suffixes and names like "Amon-Ra St. Brown". Deriving it ourselves would be
  re-implementing their naming rules badly.

`position` deserves a note: it is `NOT NULL` **because of decision 0**, not because
Sleeper guarantees it. 240 rows arrive with `position: null`; none survive the filter.
The constraint is downstream of a choice we made, not a fact about the feed.

✓ **DECIDED: `CHECK (position IN ('QB','RB','WR','TE'))`, built from `POSITIONS`.**

*Why:* the `CHECK` is the only one of the three position guards that holds **regardless
of who is writing** — a buggy mapper, a future seed script, a test fixture, or a human
in `psql`. Zod only protects the sync path. This is CLAUDE.md's "declarative, atomic,
race-proof" line, and it is the DB's job.

*Why it does not violate single-source-of-truth:* because no function holds the position
list — `POSITIONS` does, and the `CHECK` is generated from it. (An earlier draft had the
list living inside the filter function, under the since-rejected name `isRosterable`.)
The three guards do different jobs at different layers:

| where | job | on `"LB"` |
| --- | --- | --- |
| the sync's filter | routing | skips silently, by design (8,170×) |
| Zod enum | validation | aborts with a readable error naming the field |
| `CHECK` | storage | rejects the write, whoever is writing |

*The nuance:* `drizzle-kit generate` **evaluates `POSITIONS` and freezes the result** as
literal SQL text. The database never sees the const. Edit `POSITIONS` without generating
a migration and code and DB diverge — loudly, on insert. This is not special to `CHECK`:
every `NOT NULL`, type, and default in `schema.ts` is a cached derivation with a manual
refresh step. That *is* what a migration is.

*The honest cost:* this bakes a **league policy** into a **mirror table's** DDL. A truly
multi-league simulator could not share this table across leagues with different position
sets. But decision 0 already introduced that coupling; the `CHECK` only makes it
undeniable. Reversal is identical either way: change `POSITIONS`, generate, re-sync.

⟶ **YOU DECIDE (3) — Bad-row policy.** Sleeper's pool includes ~11k entries, some of
which are team defenses and other oddities with shapes you won't expect. When a row
fails Zod: **abort the whole sync**, or **skip-and-log** and keep going? There is a
real argument each way. Say which and why.

*(The draft's premise turned out to be softer than it looks. The "oddities" are exactly
the **32 team defenses** — `player_id: "HOU"`, no `full_name`/`years_exp`/`status`. They
are not malformed, just a different shape, and decision 0 means none of them reach the
validator. This decision only ever fires on a genuine surprise.)*

✓ **DECIDED: abort.**

*Why:* abort is safe **because the sync is idempotent** — the two decisions hold hands.
Aborting costs a re-run and nothing else; there is no half-written state to repair. And
a Zod failure is *information*: either Sleeper changed, or our schema is wrong. Both are
things to act on, not swallow. While writing the schema against 12k heterogeneous rows,
abort turns every mistake into a fast red loop — run, crash, read the error, fix, rerun.

*The rejected option:* skip-and-log is how a player is quietly missing in October and
nobody knows why. A silent skip is indistinguishable from a player who does not exist.

*Revisit if:* Sleeper proves genuinely flaky and one bad row routinely blocks 4,029
good ones. Then the fallback is skip + log + **non-zero exit code** — never a silent
skip.

**Consequence — decision 0 forces the pipeline order.** "Abort" is only tolerable
because the filter runs **before** validation:

```
fetch → isLeaguePosition(raw.position)? → STRICT Zod → map → upsert
             └─ no → skip, silently, by design
```

*(An earlier draft of this diagram showed two steps — "has a position?" then the position
check — and called the second one `isRosterable`. Both were wrong. The name is
`isLeaguePosition`, and the separate null-check is dead: `isLeaguePosition` takes
`string | null | undefined` and returns `false` for all three, which `rules.test.ts` pins
explicitly. One guard, not two.)*

Validating first would mean parsing all 12,200 rows, which requires a loose schema —
throwing away decision 0's entire benefit. So the order is not a style preference; it
is *implied* by the two decisions above. We only ever validate rows we intend to keep,
which means a malformed team defense can never abort the sync, and a malformed *running
back* always will. That is exactly the blast radius we want.

The filter reads `position` off not-yet-validated JSON, which is the one place this
is legitimate: it is a routing decision, not a trust decision. Nothing downstream sees
the row until the strict schema has passed. Skipping a non-skill row is **not** an error
and is not logged as one — it is the filter doing its job 8,170 times.

⟶ **YOU DECIDE (4) — PGlite persistence.** Ephemeral in-memory (fresh every run), or
persisted to a directory on disk? Re-fetching 5MB from Sleeper on every restart is
rude to them and slow for you.

✓ **DECIDED: both, via one factory.** `createDb(path?)` — the two callers differ only
by argument.

- **Disk (`./.data/players`, gitignored)** for the sync script and the dev server. A
  restart must not re-fetch 14.6MB from an API that asks for one call per day.
- **In-memory** for tests, fresh per file. A test that depends on 4,030 previously
  synced rows is not a unit test — it is a fixture with a long fuse. Tests that share
  a database fail in an order-dependent way that is miserable to debug.

*(Correction to this spec's own numbers: the payload is **14.6MB / 12,200 entries**,
not ~5MB / ~11k. Measured 2026-07-15.)*

⟶ **YOU DECIDE (5) — `syncedAt` sourcing.** *(Surfaced during implementation, not in
the original draft — the mapper needs a `synced_at` value for each row.)* Inject it as a
parameter (`mapSleeperPlayer(player, syncedAt)`), or call `new Date()` inside the mapper?
Injecting keeps the mapper a **pure** function — deterministic, exact-value tests, one
timestamp per run. Sourcing it inside is a simpler signature but makes the mapper impure:
the clock becomes a hidden input, tests can only assert "is a Date," and each of the
~4,030 rows gets a slightly different timestamp.

✓ **DECIDED (2026-07-22): inject.** `mapSleeperPlayer(player: SleeperPlayer, syncedAt: Date)`.
The sync script mints `new Date()` **once per run** and passes the same value for every row.

*Why:* `new Date()` is **I/O** — it reads the system clock, a value outside the function's
arguments, so the mapper's output would stop being determined by its inputs. That makes it
impure, and the mapper is **functional core**; the clock is the **imperative shell's** job
(CLAUDE.md — functional core / imperative shell). Injection honors that boundary in the one
place it is cheapest to.

*Why it is more than philosophy:* **one run = one timestamp** is a real property. It makes
`WHERE synced_at < :runStartedAt` a clean way to find rows a run did **not** touch — the
standard stale-row detection for when a player leaves Sleeper's skill-position pool (retires,
gets cut). Per-row `new Date()` has no single boundary value, so that feature would force
you to mint and thread a run timestamp *anyway*. Injecting now does honestly, today, what a
later slice will want.

*What it buys the test:* a fixed `SYNCED_AT` asserts an **exact** value (`toBe`), which also
proves the mapper passes the timestamp through **untouched** — not merely that it produced
*a* Date. The impure version can only assert `toBeInstanceOf(Date)`, or stand up
clock-mocking to test a one-line field mapping.

*The honest smallness:* `synced_at` never feeds a *rule* — it is pure bookkeeping — so this
is low-stakes today. The value is the **habit** (the same move returns, load-bearing, in
dead-money-by-season, the rollover cascade, bid resolution) and the stale-row **seam**, not
the correctness of any calculation.

*What it costs:* one extra argument threaded from the sync script. Accepted — the script
already holds the timestamp.

*Rejected — default parameter (`syncedAt: Date = new Date()`):* pure when passed, convenient
when not, but it **hides** the I/O edge; a caller who forgets the argument silently gets
impurity. For a learning slice the explicit boundary teaches more than the convenience saves.

⟶ **YOU DECIDE (6) — the zero-row policy.** *(Surfaced during implementation of the pure
pipeline, 2026-08-11. Not in the original draft.)*

Decision 3 settled what happens when a *row* is bad: abort. It says nothing about a bad
*response*. A sync can end up writing **zero rows** by two completely different routes,
and they call for opposite responses:

| what happened | payload entries | rows out | whose problem |
| --- | --- | --- | --- |
| normal day | 12,200 | ~4,030 | none |
| empty / failed / wrong-URL response | 0 | 0 | **theirs** — re-run later |
| Sleeper renamed positions, or changed `position`'s type | 12,200 | 0 | **ours** — the filter is stale, code must change |
| truncated or partial response | ~2,000 | ~700 | **theirs** — re-run |

Row 3 is the dangerous one: fetch succeeded, JSON parsed, envelope validated, every row
politely skipped, nothing written, exit `0`. **A failure that looks like success.** And a
check on `rows.length` alone cannot tell row 2 from row 3 — the remedies are opposites.

- **(A) Zero is fatal, checked in two places.** Abort if the payload has no entries; abort
  separately if entries exist but no rows survived, with a message naming which. No magic
  numbers. Misses row 4 entirely.
- **(B) A, plus a minimum-row floor** (say 3,000). Also catches the truncated payload.
  Costs an arbitrary constant nobody can defend, which then rots.
- **(C) No check.** Print the counts and let a human notice. Defensible while the sync is
  run by hand and its output is read.

✓ **DECIDED (2026-08-11): A — zero is fatal, checked in two places.**

*Why:* zero is the only threshold that isn't a guess. Any positive floor is either too low
to catch anything real or too high and breaks on a slow day — and the number would have to
be re-defended every time the pool moves. Zero needs no defense: a sync that writes nothing
has failed, always.

*Why two checks and not one:* the value is not the abort, it is the **message**. One check
on `rows.length` can only say "produced nothing," which is a symptom shared by two problems
with opposite remedies. Split, each abort names its own diagnosis — *"Sleeper returned an
empty pool"* (theirs; re-run tomorrow) versus *"12,200 entries, 0 matched QB/RB/WR/TE"*
(ours; the filter is stale and code must change). The second message is the whole point of
the decision: it is the one failure in this slice that would otherwise **look like success**
— fetch fine, JSON fine, envelope fine, every row politely skipped, exit `0`.

*Where it lives — and where it explicitly does not:* the checks belong to `syncPlayers`,
the **imperative shell**. `mapSleeperPayload` keeps returning `[]` for an empty payload and
is right to: it is a pure transform, and "zero rows is a catastrophe" is a *policy*, not a
property of the mapping. The same transform run against a hand-written two-row fixture must
be free to return zero without anybody throwing. This is the functional-core / imperative-
shell line drawn about as cleanly as it gets, and there is already a test pinning the pure
half of it ("returns an empty array for an empty payload").

*What it costs — say it out loud:* row 4 of the table above, the **truncated payload**, is
not caught. 2,000 entries yielding 700 rows passes both checks and writes 700 rows over a
table that held 4,030. Accepted, because the honest form of that check is **relative** —
*"the table holds 4,030 and today's run yielded 700"* — which needs to read the database
before deciding, and belongs to a later slice, once the sync is scheduled and nobody is
watching the output. A constant pretending to be that check is worse than no check: it
looks like a safeguard and is a guess.

*The stale rows this leaves behind:* nothing here deletes. A truncated run upserts its 700
and leaves the other 3,330 sitting at an older `synced_at` — which is exactly the seam
decision 5 bought (`WHERE synced_at < :runStartedAt`). Also a later slice. Named here so
it is a known gap and not a surprise.

*Rejected — (C), print the counts:* defensible only while a human reads the output. It is
a policy that silently expires the day the sync is scheduled, and nothing in the code marks
the expiry.

**Consequences to settle alongside it:**
- `fetchPlayerPool()` likely returns the *validated envelope*
  (`Promise<Record<string, unknown>>`) rather than raw `unknown`, so the script can count
  entries without parsing the payload a second time. Values stay `unknown` — trust still
  starts at the strict schema.
- The sync must be **importable without running**: an exported `syncPlayers(...)` plus a
  thin entry point. A script that works at import time cannot be tested, and importing it
  would fetch 14.6MB.
- The fetch needs to be swappable. **This is the slice's one honest test double**, and it
  earns its place by provoking failures the real API cannot be asked for (a 500, an empty
  pool) — not by "isolating units." Note what is *not* mocked: the database. In-memory
  PGlite is real Postgres, injected, so constraint violations are real.

⟶ **YOU DECIDE (7) — the fetch seam.** *(The last of decision 6's consequences. Parked
2026-08-11, settled 2026-08-12. Not a behavior decision — a testing-seam decision, which is
why it lives at the end of decision 6 rather than standing alone.)* The sync has to be
testable against an empty pool, a 500, and a malformed running back, and **none of the three
can be requested from the real API** — that is the entire reason a double is allowed here.
Two ways to place it: **hand the fetch over** as a parameter (`syncPlayers(db, fetchPool,
syncedAt)`), or **reach around it** with `vi.stubGlobal('fetch', ...)`.

✓ **DECIDED (2026-08-12): hand it over.** `syncPlayers(db, fetchPool, syncedAt)`, where
`fetchPool: () => Promise<Record<string, unknown>>`.

*Why — the reframe that settled it:* this looks like one choice and is really two, because
**two stacked functions want a seam and their subjects differ.** `fetchPlayerPool`'s subject
is the HTTP call — the URL, the `res.ok` check, `.json()`, the envelope. `syncPlayers`'s
subject is *policy* — decision 6's two aborts, decision 3's abort, one timestamp threaded.
A test of the first wants a fake HTTP **response**; a test of the second wants a fake player
**pool**, a plain object. Swapping `fetch` to serve the second means building the object,
`JSON.stringify`-ing it, wrapping it in a `Response`, and letting `fetchPlayerPool` `.json()`
it back into the object you started with — a round trip to nowhere, in every policy test. So
the question was never "which technique." It was "at which level do I cut," and the level
differs per function.

*What else it buys:* the seam is in the **type signature**, so the function's I/O is visible
to a reader instead of hidden in a test file. No global mutation, therefore no
`unstubAllGlobals` cleanup and no way for one test to leak into the next. And it makes
three-of-three — `db` (decision 4), `syncedAt` (decision 5), `fetchPool` — one injection
pattern in this slice, not two.

*What it costs — say it out loud:* **the function you replace is the function you do not
test.** Parameter injection cannot exercise `fetchPlayerPool` at all, so the URL, the status
check, and the envelope parse ship unexecuted by the suite. A typo in the URL stays green.
And the status check is worth more than it looks: **`fetch` does not throw on a 404 or a
500.** It rejects only on a network-level failure (DNS, connection refused), so a 500 is a
*successful* fetch carrying an HTML error page — and without an explicit `res.ok` check you
call `.json()` on HTML and get a parse error that names nothing.

✓ **DECIDED alongside it (2026-08-12): that gap stays open, deliberately.** Closing it means
a separate small file swapping global `fetch` — the right tool, at the right level — and it
is worth writing once the script exists and its shape has stopped moving. Recorded in the
test plan as a **named gap** rather than left to be rediscovered.

*Not blocked by that:* the carried-over envelope test needs no fetch at all. The `z.record`
envelope also lives in `mapSleeperPayload`, so `mapSleeperPayload([], syncedAt)` is a pure
`toThrow` and can be written any time. (`fetchPlayerPool` parsing the envelope too is a
**deliberate** double parse — a shallow key walk, and the price of each function defending
its own boundary. Comment it as such so it does not read like an oversight.)

## O — Operations (the interface)
```
GET /players
  ?position=QB|RB|WR|TE   (optional)
  ?team=DAL               (optional)
  ?limit=20               (optional, default 20, max 100)
→ 200 [ { id, firstName, lastName, position, team, ... } ]
→ 400 on a malformed query param
```
Nothing else. No `POST`. No `/teams`. Not yet.

✓ **DECIDED (limit): default 20, max 100.** The default protects a naive client; the
cap protects the server from serializing all 4,030 rows because someone typed
`?limit=99999`. 100 is arbitrary but *bounded*, which is the property that matters.

✓ **DECIDED (`?position=ZZ`): `400`, via the `zValidator` enum — no handler code.**

*Why not `200 []`:* an empty array is a **silent lie**. It is indistinguishable from
"there are no RBs on DAL," so a client typo becomes a data conclusion.

*Why `400` and not `422`:* `400` = **malformed** — the request itself is nonsense.
`422` = **well-formed but unprocessable** — every type is right, but a *rule* says no.
Slice 2's cap rejection is the `422` case: valid JSON, valid types, valid player, and
still refused because the bid breaks the cap. Planting the distinction here makes that
slice cheaper.

This is free *because of decision 0*: the enum `QB|RB|WR|TE` is a complete description
of the column, so rejecting `ZZ` can never reject a row that legitimately exists.

⟶ **YOU DECIDE (8) — the read path.** *(Four questions, settled in one sitting at the top
of step 5, 2026-08-12: how the handler gets a database, what the query contract accepts,
what order rows come back in, and what crosses the serializer.)*

**8.1 — How does the handler get `db`?**

✓ **DECIDED: a factory, `createPlayersApp(db)`.** It makes this slice **three-of-three** on
injection — `db` (decision 4), `syncedAt` (decision 5), `fetchPool` (decision 7) — so the
dependency is visible in the type signature rather than hidden in a test file. A test builds
in-memory PGlite, hands it over, and calls `app.request('/players?position=RB')`: Hono's app
*is* a fetch handler, so there is no port, no `listen`, and no HTTP client. The alternative,
a `db` opened at module scope, is **I/O at import time** — what decision 7's "importable
without running" bought and this would spend.

**8.2 — How strictly is `?team=` validated?**

**Measured 2026-08-12** against the 4,038-row table: **33 distinct values — 32 teams plus
`NULL`** — and every one matches `/^[A-Z]{2,3}$/`. Note that Sleeper writes **`WAS`** (not
`WSH`) and **`JAX`** (not `JAC`).

✓ **DECIDED: a shape check, `z.string().regex(/^[A-Z]{2,3}$/)`, lowercase rejected rather
than normalized** — upcasing `?team=dal` silently repairs a query the client got wrong.

*Why:* `position` earns its `400` because `POSITIONS` is a **complete description of the
column** — the `CHECK` and the filter guarantee it — so "invalid value" and "cannot match a
row" are one sentence. Nothing constrains `team`: it holds whatever Sleeper sent, so a
hand-written list would be a **belief about a third party's data**, and one wrong entry
(`WSH` for `WAS`) would hide 30 real players behind a confidently false `400`. The regex
constrains the *shape*, which outlives the *set* — STL→LA→LAR, SD→LAC, OAK→LV changed the
letters, never the length.

*What it costs:* `?team=ZZZ` still returns `200 []`, the silent lie this spec refused for
`?position=ZZ`. Accepted — at this layer the honest fix does not exist, and the regex claims
nothing it cannot back up.

**The rule worth keeping:** a validator checks the **request**; the database answers
**existence**. Never let a validator read the database. Slice 2 is the apparent exception
that proves it: a `POST` naming a nonexistent `playerId` *is* checked against the database,
but as a **`422`** in the handler, because for a *mutation* non-existence is a rule being
violated. For a filter on a list endpoint it is just the answer.

**8.3 — What order do rows come back in?**

✓ **DECIDED: `ORDER BY full_name, sleeper_id`.** `LIMIT` without `ORDER BY` is
**nondeterministic** — Postgres returns rows in whatever order the plan produces and changes
its mind when the plan changes, so `?limit=20` means *some* 20 rows. The tiebreak makes the
order **total**: duplicate full names exist in the NFL, and a tie reintroduces the same
nondeterminism at a scale small enough to flake a test. *Cost:* a sort over ~4,030 unindexed
rows — free at this size; when it stops being free, the answer is an index on
`(full_name, sleeper_id)`.

**8.4 — What crosses `serialize()`?**

✓ **DECIDED: 11 fields out** — `id`, `firstName`, `lastName`, `fullName`, `position`, `team`,
`fantasyPositions`, `yearsExp`, `status`, `injuryStatus`, `active`. **Withheld: `syncedAt`
and `sleeperId`.**

*Why:* `syncedAt` answers a question about **our infrastructure** — when our sync last
touched the row — not about a football player. `sleeperId` is the thing decision 1 spent a
surrogate key to contain ("Sleeper's IDs stop at the mirror table"), and publishing it
re-creates that coupling at the layer where it is hardest to remove: a client keying on it
is a promise you cannot take back. The asymmetry settles both — **adding** a field later is
backwards-compatible, **removing** one breaks clients, so start narrow.

*What it costs:* checking a `curl` response against Sleeper's own site needs a database
lookup for the `sleeper_id` first. Accepted.

`serialize()` renames nothing today — Drizzle already hands back camelCase — so it is a
**picking** function. Its value is that the contract has somewhere to live *before* the
shapes diverge, which they will the first time a response carries a computed field.

**NAMED GAP (opened 2026-08-12 by 8.2) — `?team=` cannot reach free agents.** **3,044 of
the 4,038 rows have `team: NULL`** — 75% of the table — and **no value of `?team=` selects
them.** `WHERE team = 'X'` is never true for a NULL, and neither is `WHERE team = NULL`:
comparing to NULL yields **UNKNOWN**, not true, which is why SQL needs `IS NULL` as separate
syntax. Reaching those rows requires a sentinel (`?team=none`) or a separate parameter
(`?freeAgent=true`), and neither is in the Definition of Done. Recorded here so that slice 2
— whose entire subject is free agency — finds it written down rather than rediscovering it.

## N — Norms
- **No `as` casts at the boundary.** Sleeper's response gets a Zod schema. A type
  assertion is a lie to the compiler with zero runtime enforcement — if Sleeper renames
  `years_exp`, you want to find out in a red test, not in October.
- **The sync is idempotent.** Upsert on a stable key. A crash halfway through is fixed
  by rerunning it, not by a rollback.
- **Never return raw DB rows from a route.** Map to a response shape you control.
- **The handler is thin.** It parses, calls, serializes. Zero logic.
- Money is integer cents (not relevant yet — but the habit starts now).

## S — Safeguards / invariants
- Running the sync twice in a row leaves the DB in the same state as running it once.
- An unknown *extra* field from Sleeper is ignored, not a crash. A *missing required*
  field is caught loudly.
- The server starts and answers `/players` even if the sync has never run (empty array,
  not a 500).
- No `onDelete: Cascade` from `players` to anything, ever. (See CLAUDE.md landmines.)

## Test plan — ✍️ YOU WRITE THESE
The mapper is the anti-corruption boundary, which makes it architecture-critical. That
makes it **your rep.** Claude may hand you a saved Sleeper fixture; you write the
assertions.

*Progress marked 2026-08-11. Checked boxes are green in the suite; the file and
describe block that covers each is named so a future reader can find it.*

- [x] Mapper: a well-formed Sleeper player → the expected row, field by field
      — `src/sync/sleeper.test.ts`, "maps a well-formed player to a row, field by field"
- [x] Mapper: a player with `team: null` (free agent) → survives, doesn't throw
- [x] Mapper: `years_exp: 0` → rookie is correctly identified
- [x] Zod: a payload missing a required field → rejected (per your decision #3)
      — `missingLastName` via `.safeParse(...).success === false`
- [x] Zod: unknown extra fields (`hashtag`, `search_rank`) are **dropped**, not a crash
      *(not in the original plan; it is the Safeguards bullet, so it earned a test)*

Added 2026-08-11 by the pure pipeline (`mapSleeperPayload`), all green:
- [x] Pipeline: a malformed player who **passes** the position filter aborts, and the
      message names his `player_id` — the abort is useless against 4,030 rows otherwise
- [x] Pipeline: every row from one call shares the **same `Date` instance** (`toBe`, not
      `toEqual` — identity proves pass-through; a defensive `new Date(syncedAt)` copy
      would satisfy `toEqual` and is exactly what this must catch)
- [x] Pipeline: an empty payload → `[]`, **not** an error. Whether the *sync* tolerates
      that is decision 6, below — a pure transform has no business deciding it
- [x] Envelope: a payload that is not an object (`[]`, `null`, `"oops"`, `42`) → rejected
      — `src/sync/sleeper.test.ts`, written 2026-08-12 as an `it.each`. Asserts
      **`toThrow(z.ZodError)`, not a message match**: `ZodError.message` is
      `JSON.stringify(issues, null, 2)`, so a regex over it pins Zod's *formatting* rather
      than its behavior. Same lesson as the `CHECK` test's `err.cause` — assert on
      structure, never on rendered prose. The class is exact here because the envelope holds
      this function's **only** `.parse()`; everything else is `safeParse`.
      **Verified by mutation 2026-08-12:** replacing the parse with
      `payload as Record<string, unknown>` turns all four red. That the mutation *needs* an
      `as` cast to compile is itself the point — `.parse()` is doing double duty as runtime
      check and type narrowing, and deleting it forces the lie the Norms forbid. A bare
      `toThrow()` would have left `null` green on an unrelated `TypeError`.

**NAMED GAP (opened 2026-08-12 by decision 7) — `fetchPlayerPool` has no test.** Parameter
injection replaces it in every `syncPlayers` test, so its URL, its `res.ok` check, and its
envelope parse are never executed by the suite. Closing it needs its own file swapping global
`fetch`, and buys two assertions worth having:
- [ ] `fetchPlayerPool`: a **500** response → aborts with a message naming the status. The
      one that actually matters — `fetch` does not throw on a 500, so this is the check most
      easily left out, and leaving it out turns an outage into an unreadable JSON parse error
- [ ] `fetchPlayerPool`: a **200 carrying a non-object body** → aborts at the envelope
- [x] Sync: run twice → same row count, same data (idempotency) — `src/db/players.test.ts`,
      written 2026-08-12. Tested at the `upsertPlayers` level rather than the script level:
      that is where the upsert actually is, and it needs no network double at all. Four
      distinct claims, not one — the count did not double, the changed field was refreshed
      (`DO UPDATE`, not `DO NOTHING`), `syncedAt` was bumped, and **every uuid is
      unchanged**. The last is the one that matters: slice 1's contracts will hold those
      uuids as foreign keys, and nothing else in the suite would notice if a re-sync
      silently minted new ones.
- [x] Chunk boundary: 2,500 rows (chunks of 1000/1000/500) all land — written 2026-08-12.
      **Verified by mutation 2026-08-12:** dropping the final partial chunk turns it red, so
      it is load-bearing. Two mutations survive, and both survive *correctly* — worth
      recording so nobody later mistakes them for holes:
      **(a) overlapping chunks** (`i += CHUNK_SIZE - 1`) stays green, because re-writing a
      row that is already correct changes no observable state. That is the idempotency of
      the upsert paying for itself in an unexpected place; no assertion *can* see it.
      **(b) no chunking at all** (`CHUNK_SIZE = 100_000`) stays green, because 2,500 is
      under the measured 5,461 wall. So the test proves chunking is **harmless**, not that
      it **happens** — the right scope. Proving the latter would mean asserting on how many
      statements Drizzle issued (testing the implementation), and a 6,000-row version would
      not help either: it passes with chunking and *keeps* passing after a column is added
      and the real wall drops. The docblock's measured `5,461` is the honest record of that
      fact; a test cannot improve on it.

**What makes the count assertion sufficient** (`expect(rows).toHaveLength(2500)`): the count
alone only says "2,500 rows exist." It becomes "all 2,500 landed" only because `sleeper_id`
is `UNIQUE` — that forces 2,500 *distinct* external keys, and rows can only originate from
the input. Drop the constraint and the same assertion passes with 2,499 real players and one
duplicate. **The schema is doing half the work of the test**, which is the "where invariants
live" table in CLAUDE.md showing up in practice.
- [ ] `GET /players` with no filters → returns rows — **step 5**
- [ ] `GET /players?position=ZZ` → **`400`** (decided above) — **step 5**

Added by decision 0 — the filter is now a tested seam, not an implementation detail:
- [x] `isLeaguePosition`: `QB`/`RB`/`WR`/`TE` → true; `K`/`DEF`/`LB`/`OL` → false
      — `src/domain/rules.test.ts` (14 cases, incl. `''` and lowercase `'qb'`)
- [x] `isLeaguePosition`: `null` position → false (240 such rows exist)
- [x] Filter: a team defense (`player_id: "HOU"`, no `full_name`) → skipped, **not** an
      abort. This is the test that proves filter-before-validate is wired the right way
      round; if the order is ever flipped, this test goes red.
      — `mapSleeperPayload` block in `src/sync/sleeper.test.ts`. **Verified by mutation
      2026-08-11:** inverting the pipeline turns it red, so it is load-bearing rather than
      incidentally green. Two flips were needed to prove it, and the second taught the
      sharper lesson: moving the `safeParse` *call* above the filter changes nothing
      (`safeParse` is inert — it returns a result), while moving the *throw* above the
      filter fails instantly. **The order that matters is filter-before-ABORT, not
      filter-before-parse.**
- [x] `CHECK`: inserting `position: 'LB'` directly (bypassing the sync) → Postgres
      rejects it. This is the test that proves the constraint guards *every* write path,
      not just the one we wrote. — `src/db/schema.test.ts`. **Verified by mutation
      2026-08-11:** deleting the `CHECK` from the migration turns it red.
- [x] Positive control alongside it: a legal row inserts, `gen_random_uuid()` fires, and
      the row round-trips intact. Not gold-plating — without it, "the bad insert failed"
      would stay green if *every* insert failed for an unrelated reason. It is also the
      only thing in the suite that proves `text[]` and `timestamptz` survive the trip
      (they come back a real JS array and a real `Date`).

**Two traps this test taught, worth not re-learning:**
1. **Drizzle wraps the driver error.** `err.message` is Drizzle's `Failed query: insert
   into "players" (...)` — the Postgres message and its SQLSTATE live on **`err.cause`**.
   So `.rejects.toThrow(/players_position_check/)` **fails**, which is a surprise the
   first time.
2. **`.rejects.toThrow(/position/)` passes for the wrong reason.** It matches the word
   `position` in the *column list of the wrapped SQL text*, not the error. Measured: it
   also passes on a `NOT NULL` violation on `status`, and would stay green with the
   `CHECK` deleted entirely. The assertion must target `err.cause` — SQLSTATE `23514`
   plus the constraint name. (`23` is Postgres's integrity-violation class: `23502`
   not-null, `23503` foreign key, `23505` unique, `23514` check.)

**Gap closed 2026-08-11:** `createDb()` now has callers in the suite, so step 2's
migration is proven by the bar rather than smoke-checked. Cost: the suite went from
~180ms to ~1.7s. That is PGlite booting Postgres and running the migration, and it is
the price of every DB-touching test file from here on.

---

## Concepts you should be able to explain when this slice is green
This slice exists as much to teach you the layer as to ship the feature. By the end,
without looking anything up, you should be able to explain:

- [ ] What a **migration** is, and why the schema file alone isn't enough
- [ ] What **upsert** means and why it makes the sync idempotent
- [ ] The difference between a **natural key** and a **surrogate key** (you'll have
      chosen one — defend it)
- [ ] What a **NOT NULL** constraint buys you, and why most of `players` isn't one
- [ ] Why an **index** on `position` might matter and when it wouldn't
- [ ] The difference between a **type assertion** and **runtime validation**
- [ ] Why `GET` is the right verb here, and what **idempotent** means in HTTP
- [ ] What **middleware** is, and what `zValidator` is actually doing to the request
- [ ] Roughly what SQL Drizzle generated for your `select` (read it out loud)

If any box is still unchecked when the tests are green, the slice isn't done. Ask.

---
*Deferred for this spec: leagues, teams, contracts, the cap, any mutation, real
Postgres, auth, rate limiting, scheduled syncs.*
