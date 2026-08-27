import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { POSITIONS } from "../domain/rules.js";
import { findPlayers } from "../db/players.js";
import type { Player } from "../db/schema.js";
import type { Db } from "../db/client.js";

/**
 * What GET /players accepts in its query string.
 *
 * The single most important fact about this schema: QUERY PARAMS ARE ALWAYS
 * STRINGS. `?limit=5` arrives as "5", never 5 - HTTP is text on a wire and has
 * no types. That is why `limit` needs `z.coerce.number()` and not `z.number()`,
 * which would reject every request ever sent.
 *
 * Measured 2026-08-26, so the edges are known rather than assumed:
 *
 *   undefined -> 20      the default fires when the param is absent
 *   "20"      -> 20      the ordinary case
 *   ""        -> 400     coerces to 0, then fails min(1)
 *   "abc"     -> 400     coerces to NaN, fails the int check
 *   "20.5"    -> 400     a number, but not an integer
 *   "101"     -> 400     over the ceiling
 *
 * Everything rejects rather than silently passing something wrong, which is the
 * only acceptable behavior at a boundary.
 *
 * `position` derives its enum from POSITIONS rather than repeating the four
 * strings. That is CLAUDE.md's single-source-of-truth rule doing real work:
 * POSITIONS already generates the migration's CHECK constraint and drives the
 * sync filter, so all three agree by construction. Retyping them here would
 * create a fourth place to forget.
 *
 * `team` is a SHAPE check, not a membership check (spec 002, decision 8.2). A
 * hand-written list of 32 abbreviations would be a belief about Sleeper's data,
 * and one wrong entry (WSH where Sleeper writes WAS) would hide 30 real players
 * behind a confidently false 400. The regex constrains what outlives the set:
 * STL -> LA -> LAR and OAK -> LV changed the letters, never the length.
 * Lowercase is REJECTED rather than upcased - normalizing `?team=dal` would
 * silently repair a query the client got wrong.
 *
 * --- Might want to change this so that lowercase is accepted and normalized to
 * uppercase.
 * --- Also, perhaps no upper limit should be set, allowing the client to request
 * as many players as they want.
 *
 * On failure zValidator returns 400 by itself, before the handler runs. There is
 * no validation code in the handler and there should never be. Verified
 * 2026-08-26: ?position=ZZ, ?team=dal, and ?limit=9999 all return 400 with an
 * empty database, because the request never reaches findPlayers.
 */
const querySchema = z.object({
  position: z.enum(POSITIONS).optional(),
  team: z
    .string()
    .regex(/^[A-Z]{2,3}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * The public shape of one player in an API response - the fourth of CLAUDE.md's
 * four shapes, and the only one this project publishes.
 *
 * written out by hand on purpose, rather than derived from the table with
 * omit<player, ...>. a derived type would silently grow every time a column is
 * added to schema.ts, which is precisely the accident decision 8.4 exists to
 * prevent: the mirror table is free to change, the contract is not.
 *
 * todo(human): the 11 fields from decision 8.4.
 *   id, firstname, lastname, fullname, position, team, fantasypositions,
 *   yearsexp, status, injurystatus, active
 *
 * two columns are deliberately absent and you should be able to say why:
 * `syncedat` answers a question about our infrastructure, not about a football
 * player; `sleeperid` is the coupling decision 1 spent a surrogate key to
 * contain, and a client keying on it is a promise you cannot take back.
 *
 * copy the types from player, minding that `team`, `yearsexp`, and
 * `injurystatus` are nullable and `fantasypositions` is an array.
 */
export type PlayerResponse = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  position: string;
  team: string | null;
  fantasyPositions: string[];
  yearsExp: number | null;
  status: string;
  injuryStatus: string | null;
  active: boolean;
};

/**
 * Turn a database row into the response shape.
 *
 * Today this renames nothing - Drizzle already hands back camelCase - so it is
 * purely a PICKING function, and it would be fair to ask why it exists at all.
 * It exists because the contract needs somewhere to live BEFORE the two shapes
 * diverge, which they will the first time a response carries a computed field
 * (slice 1's capHit is not a column). Adding that later to a function that
 * already exists is an edit; adding it to a route that returns raw rows is a
 * refactor of every caller.
 *
 * This is also the enforcement point for CLAUDE.md's "never return raw DB rows
 * from a route." The column names stop here.
 *
 * TODO(human): implement. Take a Player, return a PlayerResponse, field by
 * field. Resist the urge to spread `...player` and delete the two - an explicit
 * list fails loudly when a field is missing, where a spread fails silently when
 * a new column appears.
 */
export function serialize(player: Player): PlayerResponse {
  return {
    id: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    fullName: player.fullName,
    position: player.position,
    team: player.team,
    fantasyPositions: player.fantasyPositions,
    yearsExp: player.yearsExp,
    status: player.status,
    injuryStatus: player.injuryStatus,
    active: player.active,
  };
}

/**
 * Build the players app, with its database handed in.
 *
 * A FACTORY, not a module-scope app (spec 002, decision 8.1). This slice is now
 * three-for-three on injection - `db` (decision 4), `syncedAt` (decision 5),
 * `fetchPool` (decision 7) - so every dependency is visible in a type signature
 * instead of hidden in a test file. The alternative, opening a db at module
 * scope, is I/O AT IMPORT TIME: importing this file would touch the disk, which
 * is exactly the property decision 7 bought and this would spend.
 *
 * What it buys the tests is worth seeing before you write them. A Hono app IS a
 * fetch handler, so a test needs no port, no listen, and no HTTP client:
 *
 *   const db = await createDb();              // in-memory, real Postgres
 *   const app = createPlayersApp(db);
 *   const res = await app.request("/players?position=RB");
 *   expect(res.status).toBe(200);
 *
 * TODO(human): implement the handler body. Three steps and no more:
 *   1. `const filters = c.req.valid("query")` - the VALIDATED, typed, coerced
 *      object. Never read `c.req.query()` here; that is the raw untrusted
 *      strings, and reaching for it would walk around the boundary you just
 *      built.
 *   2. call findPlayers with it, and map the rows through serialize
 *   3. `return c.json(...)`
 *
 * Note what the handler does NOT do: no filtering, no sorting, no validation,
 * no rules. It loads, delegates, and serializes. CLAUDE.md's "no rule ever gets
 * computed inside a route handler" starts being enforced here, while the
 * handler is trivial enough that the discipline is free.
 */
export function createPlayersApp(db: Db) {
  return new Hono().get(
    "/players",
    zValidator("query", querySchema),
    async (c) => {
      const filters = c.req.valid("query");
      const players = await findPlayers(db, filters);
      const serialized = players.map(serialize);
      return c.json(serialized);
    },
  );
}
