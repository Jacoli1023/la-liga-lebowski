import { createDb, type Db } from "../src/db/client.js";
import { fetchPlayerPool, syncPlayers } from "../src/sync/run.js";

/**
 * Entry point for `pnpm sync:players`. WIRING ONLY - no logic lives here.
 *
 * Four jobs, none of which a unit test has an opinion about: pick where the
 * database file goes, mint the run's clock, print what happened, set an exit
 * code. Everything worth testing is in src/sync/run.ts, which runs nothing at
 * import time.
 */

/**
 * Persisted to disk, not in-memory. A restart must not cost Sleeper another
 * 14.6MB. Gitignored: derived data, regenerable by re-running this script.
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

  // ONE `new Date()` for the whole run, which is what makes
  // `WHERE synced_at < :startedAt` a clean way to find rows a run did NOT touch.
  // See docs/adr/0005-inject-the-clock.md
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

  // Drizzle WRAPS driver errors: `err.message` is Drizzle's own
  // "Failed query: ...", while the Postgres message and its SQLSTATE live on
  // `err.cause`. Print it, or a constraint violation arrives as an unreadable
  // SQL dump with the actual complaint stripped off.
  if (err instanceof Error && err.cause !== undefined) {
    console.error(`Caused by: ${String(err.cause)}`);
  }

  // process.exitCode, NOT process.exit(1). Setting the code lets Node flush
  // stdout/stderr, run the `finally` below, and unwind normally. process.exit()
  // would truncate the message above AND skip closing the database.
  process.exitCode = 1;
} finally {
  // CLOSING IS NOT OPTIONAL: without it the NEXT run hangs indefinitely. See
  // docs/notes/measured.md. `?.` because createDb may have thrown before
  // assigning; `$client` is Drizzle's handle on the underlying PGlite instance.
  await db?.$client.close();
}
