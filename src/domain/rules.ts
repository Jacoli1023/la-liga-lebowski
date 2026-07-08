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
