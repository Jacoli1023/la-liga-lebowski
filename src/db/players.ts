import { sql } from "drizzle-orm";
import { players, type NewPlayer } from "./schema.js";
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
