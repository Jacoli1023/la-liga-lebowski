import { and, eq, sql, type SQL } from "drizzle-orm";
import { players, type NewPlayer, type Player } from "./schema.js";
import type { Db } from "./client.js";

/**
 * How many rows go in one INSERT statement. Well under the parameter ceiling
 * that bounds a Postgres statement, and deliberately not the maximum: see
 * docs/adr/0008-chunk-the-player-upsert-at-1000-rows.md
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
 * `excluded` is a Postgres pseudo-table holding the row we proposed and that got
 * rejected for conflicting, so `set team = excluded.team` means "use the value I
 * just brought."
 *
 * The conflict target is `sleeper_id`, not the primary key, and `id` is
 * deliberately absent from the set clause: a player's uuid must survive every
 * sync forever. See docs/adr/0004-sleeper-identifiers-stop-at-the-mirror-table.md
 *
 * No transaction, on purpose. See
 * docs/adr/0009-no-transaction-around-the-player-upsert.md
 *
 * Returns nothing; the caller already knows how many rows it handed over.
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
 * Both filters are optional; absent means "do not narrow by this at all", which
 * is a different statement from any particular value. `limit` is required,
 * because the HTTP query schema has already supplied a default and enforced a
 * ceiling by the time a value reaches here. Not `Partial<Player>`: these are
 * the filters the endpoint publishes, not "any column, maybe".
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
 * Unlike `upsertPlayers`, the SQL TEXT here varies with runtime input, not just
 * its values. With no filters the WHERE clause is absent entirely - not
 * `where true` - because Drizzle's `and()` returns undefined for an empty
 * condition list and `.where(undefined)` emits no clause. Values always travel
 * as bound parameters, never interpolated into the text.
 *
 * Two things that will bite if changed:
 *
 * `.where()` is called exactly once. In Drizzle a second `.where()` replaces
 * the first rather than ANDing with it, so a filter would vanish with no error.
 * That is why the conditions are collected into an array and combined before
 * the call. See docs/notes/measured.md.
 *
 * The ORDER BY is total, not cosmetic. `LIMIT` without an order is
 * nondeterministic, and `full_name` alone is not enough because duplicate names
 * exist in the NFL; `sleeper_id` is UNIQUE, which makes the order total and the
 * tests stable.
 *
 * Returns whole rows. Which fields reach the client is `serialize()`'s job in
 * the HTTP layer: the repository answers "which rows", the serializer answers
 * "which fields".
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
