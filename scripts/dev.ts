import { serve } from "@hono/node-server";
import { createDb } from "../src/db/client.js";
import { createPlayersApp } from "../src/http/players.js";

/**
 * Entry point for `pnpm dev`. WIRING ONLY - same contract as
 * scripts/sync-players.ts: pick the paths, start the thing, arrange for a
 * clean stop. No routes, no queries, no rules.
 *
 * Reads the SAME database the sync writes (spec 002, decision 4), so the
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
 * TODO(human): graceful shutdown.
 *
 * WHY THIS IS NOT OPTIONAL: PGlite persists a real Postgres data directory and
 * MUST be closed (see the long note in scripts/sync-players.ts). That script
 * gets it for free from a `finally`, because it finishes. This one never does.
 *
 * Ctrl+C sends SIGINT, whose DEFAULT action is to terminate the process on the
 * spot. Nothing is thrown, so nothing unwinds, so no `finally` runs and the
 * database is never closed. Measured 2026-08-12 on the sync: the next run then
 * hangs forever. The run that breaks is not the run that misbehaved.
 *
 * Write an async `shutdown(signal: string)` that:
 *   1. guards against running twice - a second Ctrl+C while the first is still
 *      closing should not start a second shutdown
 *   2. `server.close()` FIRST, so no new request can arrive mid-teardown
 *   3. `await db.$client.close()` second
 *   4. does NOT call process.exit(). With both handles released the event loop
 *      is empty and Node exits on its own with code 0 - and process.exit()
 *      would truncate any buffered output, which is the exact trap
 *      sync-players.ts documents beside its `process.exitCode = 1`.
 *
 * Then register it for BOTH signals:
 *   SIGINT  - Ctrl+C from a terminal
 *   SIGTERM - what `kill`, a process manager, or `docker stop` sends. Not
 *             hypothetical: it is how this would be stopped anywhere but here.
 *
 * Note that `process.on` takes a sync callback, so an async shutdown needs
 * `() => { void shutdown("SIGINT"); }` rather than being passed directly.
 *
 * IF CTRL+C EVER SEEMS TO HANG: registering a handler REPLACES the default
 * kill, so the process now stops only if your handler makes it stop. The usual
 * culprit is a browser holding a keep-alive connection open, which
 * `server.close()` politely waits for. `server.closeAllConnections()` is the
 * escape hatch. Reach for it only if you actually see the hang.
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
