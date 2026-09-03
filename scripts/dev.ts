import { serve } from "@hono/node-server";
import { createDb } from "../src/db/client.js";
import { createPlayersApp } from "../src/http/players.js";

/**
 * Entry point for `pnpm dev`. WIRING ONLY - same contract as
 * scripts/sync-players.ts: pick the paths, start the thing, arrange for a
 * clean stop. No routes, no queries, no rules.
 *
 * Reads the SAME database the sync writes, so the
 * workflow is `pnpm sync:players` once, then `pnpm dev` to serve it.
 */

/** The same path sync-players.ts writes. Gitignored, regenerable. */
const DB_PATH = "./.data/players";

const PORT = 3000;

// createDb does a recursive mkdir, so this starts cleanly on a fresh clone
// where .data/ does not exist yet and the sync has never run. Spec 002's
// Safeguards require exactly that: the server must answer /players with an
// empty array rather than a 500 when there is no data.
const db = await createDb(DB_PATH);
const app = createPlayersApp(db);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
  console.log(`Try: curl "http://localhost:${info.port}/players?position=RB&limit=3"`);
});

/**
 * Graceful shutdown, which is not optional here.
 *
 * PGlite must be closed or the next run hangs indefinitely (see
 * docs/notes/measured.md). sync-players.ts gets that for free from a `finally`
 * because it finishes; a server never does. SIGINT's default action terminates
 * the process on the spot - nothing is thrown, so nothing unwinds and no
 * `finally` runs.
 *
 * Registering a handler REPLACES that default, so this code now owns exiting.
 * It closes the server first, so no request arrives mid-teardown, then the
 * database, and calls no process.exit(): with both handles released the event
 * loop is empty and Node exits with 0 on its own.
 *
 * If Ctrl+C ever seems to hang, the usual cause is a client holding a
 * keep-alive connection that `server.close()` politely waits for.
 * `server.closeAllConnections()` is the escape hatch.
 */
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) {
    console.error("Second signal received - exiting immediately");
    process.exit(130);
  }

  shuttingDown = true;
  console.log(`Shutting down on ${signal}`);
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await db.$client.close();
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((err) => {
    console.error(`Shutdown failed: ${String(err)}`);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((err) => {
    console.error(`Shutdown failed: ${String(err)}`);
    process.exit(1);
  });
});
