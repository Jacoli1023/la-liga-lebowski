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

/**
 * The row shape a SELECT from `players` returns - the mirror of NewPlayer above,
 * and likewise derived from the table rather than hand-written.
 *
 * It differs from NewPlayer in exactly one way that matters: nothing here is
 * optional. NewPlayer lets you omit `id` because Postgres fills it in; a row
 * that has already been stored HAS one. "What you may write" and "what you get
 * back" are two different questions, so they get two different types.
 */
export type Player = typeof players.$inferSelect;
