export const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type Position = (typeof POSITIONS)[number];
export function isLeaguePosition(value: string | null | undefined): value is Position {
  return POSITIONS.some((position) => position === value);
}

export const RosterStatus = {
  ACTIVE: "ACTIVE",
  IR: "IR",
  PRACTICE_SQUAD: "PRACTICE_SQUAD",
} as const;

export type RosterStatus =
  (typeof RosterStatus)[keyof typeof RosterStatus];

export const CAP_MULTIPLIER_PCT: Record<RosterStatus, number> = {
  ACTIVE: 100,
  IR: 50,
  PRACTICE_SQUAD: 25,
};
