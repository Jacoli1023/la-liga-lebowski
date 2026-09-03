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
 * Query params are always strings. `?limit=5` arrives as "5", never 5, because
 * HTTP is text on a wire and has no types. Hence `z.coerce.number()` and not
 * `z.number()`, which would reject every request ever sent. Measured edges,
 * all of which reject rather than silently passing something wrong: "" coerces
 * to 0 and fails min(1), "abc" becomes NaN, "20.5" fails the int check, "101"
 * exceeds the ceiling.
 *
 * `position` derives its enum from POSITIONS rather than repeating the four
 * strings, which already generate the migration's CHECK constraint and drive
 * the sync filter. Retyping them here would be a fourth place to forget.
 *
 * `team` is a shape check, not a membership check. A hand-written list of 32
 * abbreviations would be a belief about Sleeper's data, and one wrong entry
 * would hide real players behind a confidently false 400. Lowercase is
 * rejected rather than upcased; that choice and the `limit` ceiling are both
 * recorded as open in the Deferred decisions section of
 * specs/002-player-sync.md.
 *
 * On failure zValidator returns 400 by itself, before the handler runs. There
 * is no validation code in the handler and there should never be.
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
 * The public shape of one player in an API response. The last of the four
 * shapes in docs/adr/0002-three-translations-we-own.md, and the only one this
 * project publishes.
 *
 * Written out by hand rather than derived with Omit<Player, ...>. A derived
 * type would silently grow every time a column is added to schema.ts: the
 * mirror table is free to change, the contract is not.
 *
 * Two columns are deliberately absent. `syncedAt` answers a question about our
 * infrastructure, not about a football player. `sleeperId` is the coupling that
 * ADR-0004 spent a surrogate key to contain, and a client keying on it is a
 * promise we could not take back.
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
 * Today this renames nothing, so it is purely a picking function. It exists
 * because the contract needs somewhere to live before the two shapes diverge,
 * which they will the first time a response carries a computed field - slice
 * 1's capHit is not a column. Adding that to a function that already exists is
 * an edit; adding it to a route that returns raw rows is a refactor of every
 * caller.
 *
 * The guarantee is the explicit field list, not the return type. TypeScript is
 * structurally typed and types are erased, so `return { ...player }` would
 * compile clean and publish every column. An explicit list fails loudly when a
 * field goes missing; a spread fails silently when one is added.
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
 * A factory rather than a module-scope app, so that importing this file
 * performs no I/O. Opening a database at module scope would be I/O at import
 * time; see docs/adr/0006-inject-the-fetch-seam.md for why that property is
 * worth keeping.
 *
 * A Hono app is itself a fetch handler, so a test needs no port and no HTTP
 * client:
 *
 *   const app = createPlayersApp(await createDb());
 *   const res = await app.request("/players?position=RB");
 *
 * The handler reads `c.req.valid("query")` - the validated, coerced object -
 * and never `c.req.query()`, which is the raw untrusted strings. It loads,
 * delegates and serializes; no filtering, sorting, validation or rules.
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
