CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sleeper_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"full_name" text NOT NULL,
	"position" text NOT NULL,
	"team" text,
	"fantasy_positions" text[] NOT NULL,
	"years_exp" integer,
	"status" text NOT NULL,
	"injury_status" text,
	"active" boolean NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "players_sleeper_id_unique" UNIQUE("sleeper_id"),
	CONSTRAINT "players_position_check" CHECK ("players"."position" in ('QB', 'RB', 'WR', 'TE'))
);
