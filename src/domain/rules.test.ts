import { describe, it, expect } from "vitest";
import { isLeaguePosition } from "./rules.js";

describe("isLeaguePosition", () => {
  it.each(["QB", "RB", "WR", "TE"])("accepts %s as a La Liga position", (position) => {
    expect(isLeaguePosition(position)).toBe(true);
  });

  it.each(["K", "DEF", "LB", "OL", "FB", "ZZ"])("rejects %s - not a La Liga position", (position) => {
    expect(isLeaguePosition(position)).toBe(false);
  });

  it.each([null, undefined, ""])("rejects %o - an absent position", (position) => {
    expect(isLeaguePosition(position)).toBe(false);
  });

  it("rejects lowercase 'qb' - positions are case-sensitive", () => {
    expect(isLeaguePosition("qb")).toBe(false);
  });
});
