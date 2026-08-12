import { sleeperPayloadSchema, mapSleeperPayload } from "./sleeper.js";
import { upsertPlayers } from "../db/players.js";
import { POSITIONS } from "../domain/rules.js";
import type { Db } from "../db/client.js";

/**
 * The IMPERATIVE SHELL of the player sync.
 *
 * Its sibling `sleeper.ts` is the functional core - Zod schemas and mappers,
 * pure, no clock and no network. Everything that touches the outside world
 * lives here instead: the HTTP call, and the policy about what to do when a
 * run produces nothing.
 *
 * That split is the reason these are two files rather than one.
 */

/**
 * Sleeper's player pool. One JSON OBJECT keyed by player_id (not an array):
 * 12,200 entries, 14.6MB, measured 2026-07-15.
 *
 * Sleeper asks that this be called at most once per day. That request is why
 * the sync is a script rather than a request path, and why the database is
 * persisted to disk (spec 002, decision 4) - a restart must not cost them
 * another 14.6MB.
 */
const SLEEPER_URL = "https://api.sleeper.app/v1/players/nfl";

/**
 * Fetch the player pool and return it as a validated ENVELOPE - an object whose
 * keys are strings and whose values are still `unknown`. Trust starts at the
 * strict per-player schema, not here.
 *
 * This is the only function in slice 0 that opens a socket.
 */
export async function fetchPlayerPool(): Promise<Record<string, unknown>> {
  const res = await fetch(SLEEPER_URL);

  // `fetch` does NOT throw on a 404 or a 500. It rejects only on a NETWORK-level
  // failure - DNS, connection refused, TLS. A 500 is a perfectly SUCCESSFUL
  // fetch that happens to be carrying an error page, so `res.ok` (shorthand for
  // a status in 200-299) has to be checked by hand. Delete this `if` and the
  // next line calls .json() on HTML and reports a syntax error at some
  // character offset: an outage wearing the costume of a parse bug.
  if (!res.ok) {
    throw new Error(
      `Sleeper returned ${res.status} ${res.statusText} for ${SLEEPER_URL}`,
    );
  }

  // `fetch` resolves as soon as the HEADERS arrive - the body is still
  // streaming. `.json()` is what reads it to the end and parses it, which here
  // means buffering 14.6MB into memory and building a 12,200-key object.
  const payload = await res.json();

  // The SECOND of two envelope parses, on purpose. mapSleeperPayload parses it
  // again with this same schema, because a pure function defends its own
  // boundary rather than trusting whoever called it. The cost is one shallow
  // key walk (spec 002, decision 7).
  //
  // It also earns its place here independently: syncPlayers counts these
  // entries to tell "Sleeper sent nothing" apart from "we matched nothing"
  // (decision 6), and counting keys on an unvalidated `unknown` would be
  // exactly the `as`-cast this project forbids.
  return sleeperPayloadSchema.parse(payload);
}

/**
 * What one sync run did.
 *
 * RETURNED rather than logged, for two reasons. Presentation belongs to the
 * entry point - a library function that prints is a library function you cannot
 * reuse quietly. And a test can assert on numbers; it cannot assert on console
 * output without capturing it.
 *
 * Contrast `upsertPlayers`, which deliberately returns void: its count is always
 * `rows.length`, which the caller already has. These two counts are different -
 * nothing outside this function ever saw the payload.
 */
export type SyncResult = {
  /** Entries in Sleeper's payload, before any filtering. ~12,200. */
  entryCount: number;
  /** Rows actually written - the QB/RB/WR/TE survivors. ~4,030. */
  rowCount: number;
};

/**
 * Fetch, validate, map, and upsert the player pool. The whole sync.
 *
 *   fetchPool() -> count entries -> mapSleeperPayload -> count rows -> upsert
 *
 * `fetchPool` is a PARAMETER, not an import (spec 002, decision 7). That is the
 * slice's one honest test double, and it earns its place by provoking failures
 * the real API cannot be asked for: an empty pool, and a malformed running back.
 * Note what is NOT doubled - the database. In-memory PGlite is real Postgres,
 * injected the same way, so a constraint violation in a test is a real one.
 *
 * `syncedAt` is a PARAMETER too (decision 5). The clock is I/O and belongs to
 * the caller; one run mints one timestamp and every row written by that run
 * carries it.
 *
 * THROWS on any failure, and that is the designed behavior rather than an
 * oversight - see decision 3 (a bad row aborts) and decision 6 (zero rows
 * aborts, twice). Aborting is safe here ONLY because the upsert is idempotent:
 * the cost is a re-run, and there is no half-written state to repair.
 */
export async function syncPlayers(
  db: Db,
  fetchPool: () => Promise<Record<string, unknown>>,
  syncedAt: Date,
): Promise<SyncResult> {
  const pool = await fetchPool();
  const entryCount = Object.keys(pool).length;

  // ABORT 1 of 2 (decision 6). THEIR problem: an empty, failed, or wrong-URL
  // response. The remedy is to re-run later. No code changes.
  if (entryCount === 0) {
    throw new Error(
      "Sleeper returned an empty pool (0 entries). Nothing was written. " +
        "This is upstream - re-run later.",
    );
  }

  const rows = mapSleeperPayload(pool, syncedAt);

  // ABORT 2 of 2 (decision 6). OUR problem: entries arrived and every single one
  // was skipped, which means the position filter is stale - Sleeper renamed the
  // positions, or changed the type of the field.
  //
  // This is the entire reason the check is split in two. One test on
  // rows.length could only report "produced nothing", a symptom shared by two
  // problems whose remedies are opposites. And this is the one failure in the
  // slice that would otherwise LOOK LIKE SUCCESS: fetch fine, JSON fine,
  // envelope fine, every row politely skipped, exit 0.
  //
  // The position list is interpolated from POSITIONS rather than typed out, so
  // the message cannot drift from the filter it is describing.
  if (rows.length === 0) {
    throw new Error(
      `Sleeper returned ${entryCount} entries and 0 matched ` +
        `${POSITIONS.join("/")}. Nothing was written. This is OURS - the ` +
        "position filter is stale.",
    );
  }

  await upsertPlayers(db, rows);

  return { entryCount, rowCount: rows.length };
}
