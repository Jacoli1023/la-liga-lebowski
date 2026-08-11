import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  check,
} from "drizzle-orm/pg-core";

import { sql } from "drizzle-orm";
import { POSITIONS } from "../domain/rules.js";

const positionList = POSITIONS.map((position) => `'${position}'`).join(", ");

export const players = pgTable(
  "players", 
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sleeperId: text("sleeper_id").notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    fullName: text("full_name").notNull(),
    position: text("position").notNull(),
    team: text("team"),
    fantasyPositions: text("fantasy_positions").array().notNull(),
    yearsExp: integer("years_exp"),
    status: text("status").notNull(),
    injuryStatus: text("injury_status"),
    active: boolean("active").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "players_position_check",
      sql`${table.position} in (${sql.raw(positionList)})`,
    ),
  ],
);

/**
 * The row shape an INSERT into `players` expects - derived from the table above,
 * never hand-written. `id` and the other DEFAULT-ed columns are optional here
 * because Postgres fills them in.
 *
 * Lives in schema.ts because it is a fact about the TABLE, and both the mapper
 * (which produces these) and the repository (which writes them) need it.
 */
export type NewPlayer = typeof players.$inferInsert;

