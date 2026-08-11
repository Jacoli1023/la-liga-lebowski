import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.js";

/**
 * Opens a PGlite database, brings it up to date with the migrations in
 * ./drizzle, and returns a typed Drizzle client.
 *
 * One factory, two callers (spec 002, decision 4):
 *   - createDb("./.data/players")  -> persisted to disk  (sync script, dev server)
 *   - createDb()                   -> in-memory, fresh    (tests)
 *
 * migrationsFolder is resolved from the current working directory. That is the
 * project root for every entry point we have: npm scripts and vitest both run
 * from there.
 */
export async function createDb(path?: string) {
  const client = new PGlite(path);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}
