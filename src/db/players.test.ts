import { describe, it, expect, beforeEach } from "vitest";
import { createDb } from "./client.js";
import { players, type NewPlayer } from "./schema.js";
import { upsertPlayers } from "./players.js";

/**
 * The upsert - the single property the whole sync rests on.
 *
 * CLAUDE.md: "The sync is idempotent. Upsert on a stable external key. Partial
 * failure is fixed by rerunning, not by rolling back." Every other decision in
 * spec 002 leans on that sentence being true - decision 3 aborts on a bad row
 * ONLY because a re-run is free, and upsertPlayers skips a transaction ONLY
 * because a half-finished run is stale rather than corrupt.
 *
 * So this file's job is to prove the sentence, not to assume it.
 */
describe("upsertPlayers", () => {
  // A FRESH in-memory database per test, not per file. Costs a migration run
  // each time (~100ms); buys zero order-dependence. For a file whose whole
  // subject is "what happens on the second write," inheriting rows from the
  // previous test would be an actively bad idea.
  let db: Awaited<ReturnType<typeof createDb>>;

  beforeEach(async () => {
    db = await createDb();
  });

  /**
   * `n` players, all identical except sleeperId. `team` and `syncedAt` are
   * parameters because they are what a second run is expected to CHANGE.
   */
  function pool(n: number, team: string, syncedAt: Date): NewPlayer[] {
    return Array.from({ length: n }, (_, i) => ({
      sleeperId: `p-${i}`,
      firstName: "First",
      lastName: `Last${i}`,
      fullName: `First Last${i}`,
      position: "RB",
      team,
      fantasyPositions: ["RB"],
      yearsExp: 3,
      status: "Active",
      injuryStatus: null,
      active: true,
      syncedAt,
    }));
  }

  /** sleeperId -> our uuid. A map so identity is compared by key, never by row order. */
  function idsBySleeperId(rows: { sleeperId: string; id: string }[]) {
    return new Map(rows.map((row) => [row.sleeperId, row.id]));
  }

  const RUN_1 = new Date("2026-08-11T12:00:00.000Z");
  const RUN_2 = new Date("2026-08-12T12:00:00.000Z");

  // THE HEADLINE TEST - spec 002's Safeguards bullet, and its test-plan line
  // "Sync: run twice -> same row count, same data".
  //
  // Run the same players twice, with one field changed the second time (a trade:
  // SF -> KC) and a later syncedAt. Four separate claims are worth asserting, and
  // they are NOT the same claim:
  //
  //   1. the row COUNT did not double        - the conflict fired at all
  //   2. the changed field was REFRESHED     - it was DO UPDATE, not DO NOTHING
  //   3. syncedAt was bumped                 - the run timestamp threaded through
  //   4. every uuid is UNCHANGED             - the identity survived
  //
  // (4) is the one that matters most and is easiest to forget. Slice 1's
  // contracts will hold these uuids as foreign keys. If a re-sync silently minted
  // new ones, every contract in the league would point at a player who no longer
  // exists - and nothing else in this file would notice.
  it("run twice: updates in place, keeps every uuid stable", async () => {
    // first run
    await upsertPlayers(db, pool(3, "SF", RUN_1));
    const afterRun1 = await db.select().from(players);

    // second run
    await upsertPlayers(db, pool(3, "KC", RUN_2));
    const afterRun2 = await db.select().from(players);

    // (1) no duplicates
    expect(afterRun2).toHaveLength(3);

    // (2) + (3) team field and timestamp updated
    for (const row of afterRun2) {
      expect(row.team).toBe("KC");
      expect(row.syncedAt).toEqual(RUN_2);
    }

    // (4) uuids remain unchanged
    expect(idsBySleeperId(afterRun2)).toEqual(idsBySleeperId(afterRun1));
  });

  // THE CHUNK BOUNDARY.
  //
  // upsertPlayers slices rows into batches of CHUNK_SIZE (1,000). 2,500 rows
  // means chunks of 1000 / 1000 / 500 - so this goes red on an off-by-one in the
  // loop, or on a final partial chunk being dropped. Neither would show up in a
  // 3-row test, and both would silently lose players in production.
  //
  // 2,500 is chosen to be more than two full chunks AND to leave a remainder.
  // It takes ~150ms, which is the honest price of testing the real boundary.
  it("writes every row when the input spans multiple chunks", async () => {
    await upsertPlayers(db, pool(2500, "DAL", RUN_1));
    const rows = await db.select().from(players);

    expect(rows).toHaveLength(2500);
  });
});
