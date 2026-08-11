# Spec 002 — Player Sync (The Walking Skeleton)

**Status:** **In progress (build steps 1–3 of 5 done, 2026-08-11).** All decisions are
locked — the original seven (2026-07-15) plus decision 5, which surfaced during
implementation and was settled 2026-07-22. Each is recorded inline below with its
rationale *and its cost*. The ⟶ **YOU DECIDE** blocks are kept rather than deleted: the
question is the context for the answer, and a decision without its alternatives is just
a rule. Next: **step 4, `scripts/sync-players.ts`** — see the test plan at the bottom for
what is still red.
**Why this is the slice:** it is the thinnest thing that touches *every layer* — an
external API, validation, a mapper, a schema, a migration, a database, and an HTTP
route. It is deliberately boring. Its job is to prove the wires connect, and to put
real NFL players in your database so that every slice after this one has something to
stand on.

**What this slice is NOT:** it is not the cap, not contracts, not teams. Resist.

---

## R — Requirements / Definition of Done
1. `npm run sync:players` fetches the Sleeper player pool, validates it, maps it, and
   upserts it into a local PGlite database. Running it twice produces the same result.
2. `npm run dev` starts a Hono server.
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
a copy: the Zod enum (`z.enum(POSITIONS)`), the sync's triage filter, and the `CHECK`
constraint (`schema.ts` imports it). The import direction is correct — shell depends on
core, never the reverse.

*It also makes the query contract honest:* the only positions in the table are exactly
`QB|RB|WR|TE`, so the `?position=` enum is a **complete** description of the column.
Mirroring everything would mean rejecting `?position=LB` while 1,162 linebackers sat
in the table — filter and contract disagreeing.

*What it costs:* if the league ever adds K or DEF, change `isRosterable` and re-sync.
The sync runs daily anyway, so the cost of reversing this is one day.

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

*Why it does not violate single-source-of-truth:* because `isRosterable` no longer holds
the position list — `POSITIONS` does, and the `CHECK` is generated from it. The three
guards do different jobs at different layers:

| where | job | on `"LB"` |
| --- | --- | --- |
| triage filter | routing | skips silently, by design (8,170×) |
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
fetch → triage (has a position?) → isRosterable(position)? → STRICT Zod → map → upsert
                                        └─ no → skip, silently, by design
```

Validating first would mean parsing all 12,200 rows, which requires a loose schema —
throwing away decision 0's entire benefit. So the order is not a style preference; it
is *implied* by the two decisions above. We only ever validate rows we intend to keep,
which means a malformed team defense can never abort the sync, and a malformed *running
back* always will. That is exactly the blast radius we want.

The triage step reads `position` off not-yet-validated JSON, which is the one place this
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
- [ ] Sync: run twice → same row count, same data (idempotency) — **step 4**
- [ ] `GET /players` with no filters → returns rows — **step 5**
- [ ] `GET /players?position=ZZ` → **`400`** (decided above) — **step 5**

Added by decision 0 — the filter is now a tested seam, not an implementation detail:
- [x] `isLeaguePosition`: `QB`/`RB`/`WR`/`TE` → true; `K`/`DEF`/`LB`/`OL` → false
      — `src/domain/rules.test.ts` (14 cases, incl. `''` and lowercase `'qb'`)
- [x] `isLeaguePosition`: `null` position → false (240 such rows exist)
- [ ] Filter: a team defense (`player_id: "HOU"`, no `full_name`) → skipped, **not** an
      abort. This is the test that proves filter-before-validate is wired the right way
      round; if the order is ever flipped, this test goes red. — **step 4**; the
      `teamDefense` fixture is already waiting in `src/sync/sleeper.fixtures.ts`
- [ ] `CHECK`: inserting `position: 'LB'` directly (bypassing the sync) → Postgres
      rejects it. This is the test that proves the constraint guards *every* write path,
      not just the one we wrote. — **step 4**

**Gap worth naming:** no test in the suite calls `createDb()` yet, so step 2's migration
is committed but unproven by the bar. (It does work — smoke-checked 2026-08-11.) The
`CHECK` test above is the cheapest thing that fixes this, since it needs a real database
to mean anything.

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
