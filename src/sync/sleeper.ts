import { z } from "zod";
import { POSITIONS, isLeaguePosition } from "../domain/rules.js";
import type { NewPlayer } from "../db/schema.js";

/**
 * The strict validation boundary for ONE Sleeper player.
 *
 * "Strict" here means every field we depend on must be present and correctly
 * typed, or `.parse()` throws. It does NOT mean Zod's `.strict()` mode - we
 * deliberately let unknown extra fields (Sleeper sends dozens) be dropped,
 * which is `z.object()`'s default behavior. Missing REQUIRED fields are caught
 * loudly; extra fields are ignored quietly. (spec 002 - Safeguards)
 *
 * Nullability below is the MEASURED reality of the ~4,030 skill rows, not a
 * copy of Sleeper's docs (spec 002 - decision 2's column table).
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

/**
 * The anti-corruption mapper: a validated Sleeper player -> a `players` row.
 *
 * This is the ONE place Sleeper's names (snake_case, `player_id`) become ours
 * (camelCase, `sleeperId`). If Sleeper renames a field, THIS file breaks and
 * nothing downstream does - that is the entire job of the boundary.
 *
 * `syncedAt` is INJECTED (decided 2026-07-22 - spec 002, decision 5). This keeps
 * the mapper a PURE function: the clock is I/O and belongs at the edge, so the
 * sync script mints one timestamp per run and passes it for every row. One run =
 * one timestamp. (The rejected alternative was `new Date()` inside the mapper -
 * simpler signature, but impure and untestable by exact value.)
 */
export function mapSleeperPlayer(player: SleeperPlayer, syncedAt: Date): NewPlayer {
  return {
    sleeperId: player.player_id,
    firstName: player.first_name,
    lastName: player.last_name,
    fullName: player.full_name,
    position: player.position,
    team: player.team,
    fantasyPositions: player.fantasy_positions,
    yearsExp: player.years_exp,
    status: player.status,
    injuryStatus: player.injury_status,
    active: player.active,
    syncedAt: syncedAt,
  };
}

/**
 * The ENVELOPE. Sleeper returns one big JSON object keyed by player_id -
 * `{ "4034": {...}, "SF": {...} }` - not an array. This says only "an object
 * whose keys are strings"; each VALUE stays `unknown`, because trust starts
 * after the strict schema, not before.
 */
const sleeperPayloadSchema = z.record(z.string(), z.unknown());

/**
 * Just enough of a row to make the ROUTING decision - nothing more.
 *
 * This is the one place we read a field off not-yet-validated JSON, and it is
 * legitimate because it decides where the row GOES, not whether we trust it
 * (spec 002 - decision 3's consequence). Rows that fail this aren't errors:
 * 240 of Sleeper's rows have `position: null`, and none of them are ours.
 */
const triageSchema = z.object({ position: z.string() });

/**
 * The whole pure pipeline: Sleeper's raw payload -> the rows to write.
 *
 *   filter (isLeaguePosition) -> STRICT Zod -> map
 *
 * Pure by construction - no fetch, no database, no clock. `syncedAt` is
 * injected for the same reason it is on `mapSleeperPlayer` (spec decision 5),
 * and every row in one call shares it: one run = one timestamp.
 *
 * FILTER BEFORE VALIDATE is not a style choice - decision 0 forces it. We only
 * ever validate rows we intend to keep, so a malformed team defense can never
 * abort the sync and a malformed RUNNING BACK always will. That is the blast
 * radius we want, and it is why the two Zod calls below behave differently:
 *
 *   triageSchema.safeParse  -> returns a result; a failure means SKIP
 *   sleeperPlayerSchema     -> we throw; a failure means ABORT the whole sync
 *
 * Aborting is safe because the sync is idempotent - the cost is a re-run, and
 * there is no half-written state to repair (spec 002 - decision 3).
 */
export function mapSleeperPayload(payload: unknown, syncedAt: Date): NewPlayer[] {
  const pool = sleeperPayloadSchema.parse(payload);
  const rows: NewPlayer[] = [];

  // Object.entries, not .values: the KEY is Sleeper's player_id, and it is the
  // only handle we can name a bad row by - a row that fails validation may not
  // have a readable player_id inside it.
  for (const [playerId, raw] of Object.entries(pool)) {
    const triaged = triageSchema.safeParse(raw);
    if (!triaged.success) continue;
    if (!isLeaguePosition(triaged.data.position)) continue;

    const validated = sleeperPlayerSchema.safeParse(raw);
    if (!validated.success) {
      // Abort - but abort INFORMATIVELY. A bare Zod error names the field and
      // not the row, which is useless against 4,030 of them.
      throw new Error(
        `Sleeper player "${playerId}" (${triaged.data.position}) failed validation:\n` +
          z.prettifyError(validated.error),
      );
    }

    rows.push(mapSleeperPlayer(validated.data, syncedAt));
  }

  return rows;
}
