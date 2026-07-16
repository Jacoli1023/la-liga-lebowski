import { z } from "zod";
import { POSITIONS } from "../domain/rules.js";
import { players } from "../db/schema.js";

/**
 * The strict validation boundary for ONE Sleeper player.
 *
 * "Strict" here means every field we depend on must be present and correctly
 * typed, or `.parse()` throws. It does NOT mean Zod's `.strict()` mode — we
 * deliberately let unknown extra fields (Sleeper sends dozens) be dropped,
 * which is `z.object()`'s default behavior. Missing REQUIRED fields are caught
 * loudly; extra fields are ignored quietly. (spec 002 — Safeguards)
 *
 * Nullability below is the MEASURED reality of the ~4,030 skill rows, not a
 * copy of Sleeper's docs (spec 002 — decision 2's column table).
 */
export const sleeperPlayerSchema = z.object({
  player_id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  full_name: z.string(),
  position: z.enum(POSITIONS), // a SECOND position guard, derived from POSITIONS
  team: z.string().nullable(), // null = free agent
  fantasy_positions: z.array(z.string()),
  years_exp: z.number().int().nullable(), // null = a genuine data gap
  status: z.string(),
  injury_status: z.string().nullable(), // null = healthy
  active: z.boolean(),
});

/** The shape of a validated Sleeper player, inferred from the schema above. */
export type SleeperPlayer = z.infer<typeof sleeperPlayerSchema>;

/** The row shape Drizzle expects for an INSERT into `players`. */
type NewPlayer = typeof players.$inferInsert;

/**
 * The anti-corruption mapper: a validated Sleeper player → a `players` row.
 *
 * This is the ONE place Sleeper's names (snake_case, `player_id`) become ours
 * (camelCase, `sleeperId`). If Sleeper renames a field, THIS file breaks and
 * nothing downstream does — that is the entire job of the boundary.
 *
 * `syncedAt` is injected here PROVISIONALLY — the sourcing is an OPEN decision
 * for next session (see CLAUDE.md "OPEN DECISION"). Injecting keeps the mapper a
 * PURE function: the clock is I/O and belongs at the edge (the sync script mints
 * one timestamp per run and passes it for every row). The alternative is calling
 * `new Date()` inside the mapper — simpler, but impure.
 *
 * TODO(jacob): settle syncedAt sourcing, then implement to green.
 */
export function mapSleeperPlayer(player: SleeperPlayer, syncedAt: Date): NewPlayer {
  throw new Error("mapSleeperPlayer not implemented");
}
