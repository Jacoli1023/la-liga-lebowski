import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.js";

/**
 * Opens a PGlite database, brings it up to date with the migrations in
 * ./drizzle, and returns a typed Drizzle client.
 *
 * One factory, two callers:
 *   - createDb("./.data/players")  -> persisted to disk (sync script, dev server)
 *   - createDb()                   -> in-memory, fresh  (tests)
 *
 * migrationsFolder resolves from the current working directory, which is the
 * project root for every entry point we have: npm scripts and vitest both run
 * from there.
 *
 * `path`, when given, is a filesystem path - the only kind either caller uses.
 * PGlite also accepts URI forms like `memory://`; we do not, and the mkdir
 * below assumes we do not.
 */
export async function createDb(path?: string) {
  // PGlite creates its own data directory, but with a NON-recursive mkdir - so
  // "./.data/players" fails with ENOENT when "./.data" does not exist yet, which
  // is the state of every fresh clone. Creating it here keeps the factory's
  // promise honest: hand it a path, get a working database, no setup step.
  //
  // `recursive: true` does two jobs. It creates missing parents, and it returns
  // quietly instead of throwing EEXIST when the directory is already there - so
  // this line is idempotent, and safe on the 2nd through 400th run.
  //
  // Worth knowing how this surfaced: the failure arrived as Drizzle's
  // "Failed query: CREATE SCHEMA IF NOT EXISTS drizzle", with the real
  // complaint (ENOENT ... mkdir) buried on err.cause. Same wrapping trap as the
  // CHECK-constraint test - when this stack lies to you, read err.cause.
  if (path !== undefined) {
    await mkdir(path, { recursive: true });
  }

  const client = new PGlite(path);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

/**
 * Exported so the repositories, the sync, and the entry points all name the
 * same type instead of each re-deriving it. Reach it as `db.$client` to get the
 * underlying PGlite instance - which is how an entry point calls `.close()`.
 */
export type Db = Awaited<ReturnType<typeof createDb>>;
