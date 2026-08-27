import { and, eq, sql, type SQL } from "drizzle-orm";
import { players, type NewPlayer, type Player } from "./schema.js";
import type { Db } from "./client.js";

/**
 * How many rows go in one INSERT statement.
 *
 * There is a hard ceiling here, not a preference: a Postgres statement counts
 * its parameters in a 16-bit field, so 65,535 is the maximum. This insert sends
 * 12 parameters per row (`id` costs none - it goes over as the literal DEFAULT),
 * which puts the real wall at 5,461 rows. Measured 2026-08-11: 5,461 succeeds,
 * 5,462 fails.
 *
 * Today's ~4,030 skill players would in fact fit in ONE statement, at 74% of the
 * ceiling. We chunk anyway, for one reason: the error you get when you cross it
 * is undiagnosable. PGlite reports "Invalid array length" at 5,462 rows and
 * "Maximum call stack size exceeded" at 12,200. Neither mentions parameters.
 *
 * 1,000 rather than the maximal 5,461 because the ceiling is a function of the
 * COLUMN COUNT - add columns and 5,461 silently becomes wrong. 1,000 survives
 * adding fifty. Being too small costs a few extra round trips and nothing else,
 * which is what makes this magic number acceptable where the rejected minimum-row
 * floor of spec decision 6 was not: this one is safe in the direction it errs.
 */
const CHUNK_SIZE = 1_000;

/**
 * Write players into the mirror table, inserting new ones and refreshing the
 * ones already there. This is the UPSERT that makes the sync idempotent.
 *
 * The SQL, per chunk:
 *
 *   insert into "players" ("id", "sleeper_id", ..., "synced_at")
 *   values (default, $1, ..., $12), (default, $13, ..., $24), ...
 *   on conflict ("sleeper_id") do update set
 *     "first_name" = excluded."first_name",
 *     ...
 *     "synced_at"  = excluded."synced_at"
 *
 * Three things to read carefully there:
 *
 * `excluded` is a Postgres pseudo-table holding the row we PROPOSED and that got
 * rejected for conflicting. So `set team = excluded.team` means "use the value I
 * just brought." It is how you say "refresh it to today's data."
 *
 * The conflict target is `sleeper_id`, NOT the primary key. Our `id` is a fresh
 * uuid on every attempt, so a conflict on `id` could never fire and every run
 * would insert 4,030 duplicates. The target has to be the stable EXTERNAL key -
 * which is exactly what spec 002 decision 1 promised the surrogate key would not
 * cost us ("onConflictDoUpdate targets ANY unique constraint").
 *
 * `id` is deliberately NOT in the set clause. A player's uuid must survive every
 * sync forever, because slice 1's `contracts` rows will reference it. Updating it
 * would silently orphan league history - the same family of bug as the
 * onDelete: Cascade landmine in CLAUDE.md.
 *
 * NO TRANSACTION, on purpose. A crash after chunk 3 of 5 leaves the first 3,000
 * players refreshed and the rest stale, and that is FINE: nothing here spans
 * rows, so a partly-finished sync is not corrupt, just partly old. Rerunning
 * fixes it, which is CLAUDE.md's "partial failure is fixed by rerunning, not by
 * rolling back." Wrapping it would hold locks over 4,030 rows to buy atomicity
 * nothing needs. (Slice 2 is the opposite case: "committed cap <= league cap" is
 * an invariant ACROSS rows, and that genuinely requires a transaction. This is
 * the contrast worth remembering when it shows up.)
 *
 * Returns nothing. The caller already knows how many rows it handed over, and a
 * count that is always `rows.length` would be a second way to answer one question.
 */
export async function upsertPlayers(db: Db, rows: NewPlayer[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);

    await db
      .insert(players)
      .values(chunk)
      .onConflictDoUpdate({
        target: players.sleeperId,
        set: {
          // Every mirrored column. Listed one by one rather than generated from
          // the table, so that adding a column to schema.ts and forgetting it
          // here is a visible omission instead of invisible magic.
          firstName: sql`excluded.first_name`,
          lastName: sql`excluded.last_name`,
          fullName: sql`excluded.full_name`,
          position: sql`excluded.position`,
          team: sql`excluded.team`,
          fantasyPositions: sql`excluded.fantasy_positions`,
          yearsExp: sql`excluded.years_exp`,
          status: sql`excluded.status`,
          injuryStatus: sql`excluded.injury_status`,
          active: sql`excluded.active`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }
}

/**
 * What the caller may narrow a player search by.
 *
 * Both filters are OPTIONAL - absent means "do not narrow by this at all",
 * which is a different statement from any particular value. `limit` is not
 * optional: spec 002 decision 8 puts the default (20) and the ceiling (100) in
 * the query schema at the HTTP boundary, so by the time a value reaches here it
 * has already been supplied and bounded. This function trusts that and does not
 * re-decide it - a default in two places is two places to change it.
 *
 * The shape is deliberately NOT `Partial<Player>`. These are the filters the
 * endpoint publishes, not "any column, maybe". Widening it later is a decision,
 * not an accident.
 */
export type PlayerFilters = {
  position?: string;
  team?: string;
  limit: number;
};

/**
 * Read players out of the mirror table, narrowed by whichever filters were
 * given, in a stable order, capped at `limit`.
 *
 * This is the first query in the project whose SQL TEXT - not just its
 * parameters - depends on runtime input. `upsertPlayers` above always emits the
 * same statement and only varies the values. This one emits a different
 * statement per filter combination:
 *
 *   no filters      select ... from "players"
 *                   order by "players"."full_name", "players"."sleeper_id"
 *                   limit $1
 *
 *   position only   select ... from "players"
 *                   where "players"."position" = $1
 *                   order by ... limit $2
 *
 *   both            select ... from "players"
 *                   where ("players"."position" = $1 and "players"."team" = $2)
 *                   order by ... limit $3
 *
 * Four things to read there:
 *
 * The WHERE clause genuinely DISAPPEARS when nothing is filtered. Not
 * `where true`, not `where 1=1` - absent. Drizzle's `and()` returns `undefined`
 * for an empty condition list, and `.where(undefined)` emits no clause at all.
 *
 * Values never appear in the SQL text. `"RB"` travels separately as $1. That is
 * a PREPARED STATEMENT: the query's shape is fixed before any user data is
 * attached, so a parameter can never turn into syntax. It is the structural
 * reason a hostile `?team=` cannot inject SQL here.
 *
 * The placeholder NUMBERS shift with the filter count - notice `limit` is $1,
 * $2, or $3 depending on how many conditions precede it. Placeholders are
 * positional and mean nothing but "the Nth value in the array". Build the array
 * in the wrong order and you filter by the wrong thing, silently.
 *
 * `.where()` is called EXACTLY ONCE, and that is load-bearing. In Drizzle a
 * second `.where()` REPLACES the first rather than ANDing with it - measured
 * 2026-08-26: chaining `.where(position)` then `.where(team)` emits
 * `where "players"."team" = $1` and the position filter vanishes with no error.
 * So the conditions are combined in the array FIRST and handed over together.
 *
 * ORDER BY is not cosmetic (decision 8.3). `LIMIT` without it is
 * nondeterministic - Postgres returns whatever the plan produces and changes
 * its mind when the plan changes, so `?limit=20` would mean SOME 20 rows.
 * `full_name` alone is not enough either: duplicate names exist in the NFL, and
 * a tie puts the nondeterminism back at a scale small enough to flake a test.
 * `sleeper_id` is UNIQUE, so adding it makes the order TOTAL.
 *
 * Returns whole rows, all 13 columns (decision 8.4, option 1). The two the API
 * withholds - `syncedAt` and `sleeperId` - are dropped by `serialize()` in the
 * HTTP layer, not here. The repository answers "which rows"; the serializer
 * answers "which fields".
 *
 * TODO(human): implement the body.
 *
 * Sketch, so the Drizzle API is not the puzzle:
 *   1. `const conditions: SQL[] = []`
 *   2. push `eq(players.position, filters.position)` when position is present,
 *      and the same for team. Check `!== undefined` rather than truthiness -
 *      see the question below before you decide that matters.
 *   3. one chain: `db.select().from(players).where(...).orderBy(...).limit(...)`
 *      - `.where()` takes `and(...conditions)`
 *      - `.orderBy()` takes both columns as separate arguments
 *
 * Print what you built with `.toSQL()` before you trust it.
 */
export async function findPlayers(
  db: Db,
  filters: PlayerFilters,
): Promise<Player[]> {
  const conditions: SQL[] = [];
  if (filters.position !== undefined) {
    conditions.push(eq(players.position, filters.position));
  }
  if (filters.team !== undefined) {
    conditions.push(eq(players.team, filters.team));
  }

  return db
    .select()
    .from(players)
    .where(and(...conditions))
    .orderBy(players.fullName, players.sleeperId)
    .limit(filters.limit);
}
