import { describe, it, expect, beforeAll } from "vitest";
import { createDb } from "./client.js";
import { players } from "./schema.js";

/** The shape Postgres's gen_random_uuid() produces: 8-4-4-4-12 hex. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The FIRST test in the suite to touch a real database.
 *
 * Everything before this was pure - functions over plain data. This file boots
 * PGlite (real Postgres, compiled to WASM, in-process), runs the migration, and
 * writes to an actual table.
 *
 * What it is really testing is the MIGRATION, not the sync. `drizzle-kit
 * generate` froze `POSITIONS` into literal SQL text back in
 * drizzle/0000_create_players.sql:16:
 *
 *   CONSTRAINT "players_position_check"
 *     CHECK ("players"."position" in ('QB', 'RB', 'WR', 'TE'))
 *
 * The database has never heard of the POSITIONS const. So the only way to know
 * that constraint is really there - and really enforced - is to try to violate
 * it and watch Postgres refuse.
 *
 * Note what this deliberately does NOT do: it never calls mapSleeperPayload,
 * never touches Zod, never runs the filter. It writes DIRECTLY to the table,
 * because the whole claim being tested is that the CHECK guards writers we did
 * not write (spec 002 - decision 2's three-guard table: "on 'LB' -> rejects the
 * write, WHOEVER is writing").
 */
describe("players table - the position CHECK constraint", () => {
  // In-memory, fresh for this file (spec 002 - decision 4). No path argument.
  // A test that inherits 4,030 rows from a previous run is a fixture with a
  // long fuse; tests that share a database fail in order-dependent ways.
  let db: Awaited<ReturnType<typeof createDb>>;

  beforeAll(async () => {
    db = await createDb();
  });

  /**
   * Every NOT NULL column, filled in. Pass overrides to break exactly one thing
   * at a time - which is the only way a constraint test can name what it caught.
   *
   * `id` is omitted on purpose: the column has DEFAULT gen_random_uuid(), so
   * Postgres mints it. That is why it is optional in Drizzle's insert type.
   *
   * Watch out: sleeper_id is UNIQUE. Two successful inserts sharing one
   * sleeperId will fail on THAT constraint, not the one under test, so give
   * each test its own.
   */
  function newRow(
    overrides: Partial<typeof players.$inferInsert> = {},
  ): typeof players.$inferInsert {
    return {
      sleeperId: "test-1",
      firstName: "Christian",
      lastName: "McCaffrey",
      fullName: "Christian McCaffrey",
      position: "RB",
      team: "SF",
      fantasyPositions: ["RB"],
      yearsExp: 8,
      status: "Active",
      injuryStatus: null,
      active: true,
      syncedAt: new Date("2026-08-11T12:00:00.000Z"),
      ...overrides,
    };
  }

  // THE POSITIVE CONTROL - write this one first.
  //
  // A test that only proves "the bad insert failed" is weaker than it looks: it
  // would still pass if EVERY insert failed, for a reason having nothing to do
  // with the CHECK (a broken migration, a missing column, a bad connection). The
  // rejection only means something once you have shown the same shape succeeds
  // when the position is legal. Negative tests need a positive control.
  //
  // Drizzle generates roughly:
  //   insert into "players" ("sleeper_id", "first_name", ..., "synced_at")
  //   values ($1, $2, ..., $13)
  //   returning "id"
  //
  // The $1/$2 are PLACEHOLDERS - the values travel separately from the SQL text,
  // which is why this cannot be SQL-injected. Add .returning() to get the row
  // back (Postgres-specific, and genuinely nice: the DB-generated uuid comes
  // back in the same round trip).
  it("accepts a row whose position is a league position", async () => {

    const row = newRow({ sleeperId: "ok-1" });
    const rows = await db.insert(players).values(row).returning();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toMatch(UUID_RE);
    expect(rows[0]).toMatchObject(row);

  });

  // THE ACTUAL TEST.
  //
  // Note that `position: "LB"` below TYPE-CHECKS. schema.ts declares position as
  // text(), which Drizzle types as plain `string`, so tsc has no complaint. The
  // compiler cannot express "one of four strings" here. That gap is the entire
  // reason the CHECK exists, and this test is where you watch the database catch
  // what the type system waved through.
  //
  // Asserting on a REJECTED promise is new. db.insert(...) returns a promise
  // that rejects, so:
  //   await expect(promise).rejects.toThrow(/.../)
  // The `await` is load-bearing. Without it the test finishes before the promise
  // settles and passes green having checked nothing.
  //
  // Postgres will raise SQLSTATE 23514 (check_violation) and its message names
  // the constraint - which is exactly why schema.ts named it
  // "players_position_check" by hand instead of taking a generated name. Match
  // on something specific enough that an UNRELATED failure (a NOT NULL
  // violation, say) cannot satisfy it.
  it("rejects a row whose position is not a league position", async () => {

    const err = await db
      .insert(players)
      .values(newRow({ sleeperId: "bad-1", position: "LB" }))
      .catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.cause).toMatchObject({
      code: "23514",
      message: expect.stringContaining("players_position_check"),
    });

  });
});
