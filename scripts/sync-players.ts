import { createDb, type Db } from "../src/db/client.js";
import { fetchPlayerPool, syncPlayers } from "../src/sync/run.js";

/**
 * Entry point for `npm run sync:players`. WIRING ONLY - no logic lives here.
 *
 * Four jobs, all of them things a unit test has no opinion about: pick where
 * the database file goes, mint the run's clock, print what happened, and set an
 * exit code. Everything worth testing is in src/sync/run.ts, which this file
 * imports and which runs nothing at import time (spec 002, decision 7).
 */

/**
 * Persisted to disk, not in-memory (spec 002, decision 4). A restart must not
 * cost Sleeper another 14.6MB. Gitignored - it is derived data, regenerable by
 * re-running this script, and never source.
 */
const DB_PATH = "./.data/players";

/**
 * Declared out here so the `finally` below can close it whether the run
 * succeeded, threw, or never got a database at all. `undefined` is the honest
 * third state: createDb itself can fail.
 */
let db: Db | undefined;

try {
  db = await createDb(DB_PATH);

  // ONE `new Date()` for the whole run (decision 5). Every row this run writes
  // carries the same synced_at, which is what will later make
  // `WHERE synced_at < :startedAt` a clean way to find the rows a run did NOT
  // touch - players who left Sleeper's skill-position pool by retiring or being
  // cut. That is a later slice; this line is what buys the option.
  const startedAt = new Date();

  const { entryCount, rowCount } = await syncPlayers(
    db,
    fetchPlayerPool,
    startedAt,
  );

  console.log(
    `Synced ${rowCount} players from ${entryCount} Sleeper entries -> ${DB_PATH}`,
  );
} catch (err) {
  console.error(`sync:players FAILED\n${String(err)}`);

  // Drizzle WRAPS driver errors. `err.message` is Drizzle's own
  // "Failed query: insert into ..." - the Postgres message and its SQLSTATE
  // live on `err.cause`. Print it, or a constraint violation reaches you as an
  // unreadable SQL dump with the actual complaint stripped off.
  // (23 is Postgres's integrity-violation class: 23502 not-null, 23503 foreign
  // key, 23505 unique, 23514 check.)
  if (err instanceof Error && err.cause !== undefined) {
    console.error(`Caused by: ${String(err.cause)}`);
  }

  // process.exitCode, NOT process.exit(1). Setting the code lets Node finish
  // flushing stdout/stderr, run the `finally` below, and unwind normally before
  // exiting with it. process.exit() terminates immediately - it would truncate
  // the message written one line above AND skip closing the database. The
  // non-zero code is how a scheduler, CI, or `&&` in a shell learns this failed.
  process.exitCode = 1;
} finally {
  // CLOSING IS NOT OPTIONAL, and the reason is worth knowing because the
  // symptom lands nowhere near the cause. PGlite persists a real Postgres data
  // directory; exiting without closing leaves it as an unclean shutdown, and
  // the NEXT run then hangs indefinitely trying to reopen it. Measured
  // 2026-08-12: without this line, run 1 succeeds and run 2 never returns.
  //
  // That would break Definition of Done #1 - "running it twice produces the
  // same result" - in the nastiest available way, since the run that breaks is
  // not the run that misbehaved.
  //
  // `?.` because createDb may have thrown before assigning. `$client` is
  // Drizzle's handle on the underlying PGlite instance.
  await db?.$client.close();
}
