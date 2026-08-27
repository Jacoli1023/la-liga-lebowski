import { describe, it, expect, beforeEach } from "vitest";
import { createDb } from "../db/client.js";
import { upsertPlayers } from "../db/players.js";
import { createPlayersApp } from "./players.js";
import type { NewPlayer } from "../db/schema.js";

/**
 * The read endpoint - the last layer of slice 0, and the first test in this
 * project to exercise HTTP.
 *
 * Note what is NOT here: no server, no port, no fetch client, no supertest. A
 * Hono app IS a fetch handler, so `app.request(url)` runs the whole middleware
 * chain and handler in-process and hands back a real web-standard Response.
 * That is the payoff of spec 002 decision 8.1's factory - the app takes its
 * database as an argument, so a test can build one and hand it over.
 *
 * The database is NOT a mock. It is in-memory PGlite: real Postgres, real
 * migration, real CHECK constraint. The only test double in this slice remains
 * decision 7's fetchPool, and it is in a different file.
 */
describe("GET /players", () => {
  // Fresh per test, matching players.test.ts. An endpoint test that inherited
  // rows from the previous test would pass or fail based on execution order.
  let db: Awaited<ReturnType<typeof createDb>>;
  let app: ReturnType<typeof createPlayersApp>;

  beforeEach(async () => {
    db = await createDb();
    app = createPlayersApp(db);
  });

  /** One player, with only the fields a given test cares about overridden. */
  function player(overrides: Partial<NewPlayer> & { sleeperId: string }): NewPlayer {
    return {
      firstName: "First",
      lastName: "Last",
      fullName: "First Last",
      position: "RB",
      team: "DAL",
      fantasyPositions: ["RB"],
      yearsExp: 3,
      status: "Active",
      injuryStatus: null,
      active: true,
      syncedAt: new Date("2026-08-27T12:00:00.000Z"),
      ...overrides,
    };
  }

  /**
   * The headline test. Rows in the table come back through the endpoint.
   *
   * Seeded deliberately OUT of alphabetical order, so that asserting the
   * returned order is a real claim about decision 8.3's `ORDER BY full_name,
   * sleeper_id` rather than an accident of insertion.
   *
   * TODO(human): the assertions. Three claims worth making, and the second is
   * the one that earns this test its place:
   *   1. status is 200, and the body holds 3 rows
   *   2. the FIELDS of a row are exactly decision 8.4's eleven - no `sleeperId`,
   *      no `syncedAt`. This is the only assertion in the suite that would catch
   *      `serialize` being "simplified" to `{ ...player }`, which compiles clean
   *      and leaks both. Verify it by making that exact mutation.
   *   3. the order is Alvin, Bijan, Zay - the ORDER BY, otherwise untested
   *
   * Reading the body: `await res.json()` is typed `any`, which would be a lie
   * anywhere else in this codebase. It is acceptable HERE because the assertion
   * that follows IS the runtime check - in production code the boundary gets a
   * Zod schema, in a test the `expect` does that job.
   */
  it("returns the players in the table", async () => {
    await upsertPlayers(db, [
      player({ sleeperId: "2", fullName: "Zay Flowers", position: "WR" }),
      player({ sleeperId: "1", fullName: "Bijan Robinson", position: "RB" }),
      player({ sleeperId: "3", fullName: "Alvin Kamara", position: "RB" }),
    ]);

    const res = await app.request("/players");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(3);

    expect(body).toEqual([
      {
        id: expect.any(String),
        firstName: "First",
        lastName: "Last",
        fullName: "Alvin Kamara",
        position: "RB",
        team: "DAL",
        fantasyPositions: ["RB"],
        yearsExp: 3,
        status: "Active",
        injuryStatus: null,
        active: true,
      },
      expect.objectContaining({ fullName: "Bijan Robinson" }),
      expect.objectContaining({ fullName: "Zay Flowers" }),
    ]);

  });

  /**
   * A malformed query param is a 400, and no rows are needed to prove it.
   *
   * The empty database is the POINT, not a shortcut: zValidator rejects the
   * request before the handler runs, so findPlayers is never called. If this
   * test ever needs a seeded row to pass, validation has leaked into the
   * handler.
   *
   * Spec 002 decision 8: 400 (malformed) and not 422 (well-formed but
   * unprocessable) - slice 2's cap rejection is the 422 case.
   *
   * TODO(human): the assertion. ONE line, and deliberately not a body match:
   * a ZodError's `message` is `JSON.stringify(issues, null, 2)`, so asserting
   * on it would pin Zod's formatting rather than your behavior - the same trap
   * your envelope test in sleeper.test.ts already dodged.
   *
   * Verify by mutation: drop `z.enum(POSITIONS)` from querySchema and watch
   * this go green-to-red.
   */
  it("rejects an unknown position with 400", async () => {
    const res = await app.request("/players?position=ZZ");

    expect(res.status).toBe(400);
  });
});
