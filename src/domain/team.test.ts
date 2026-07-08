import { describe, it, expect } from "vitest";
import { RosterStatus } from "./rules.js";
import { Team } from "./team.js";
import { Contract } from "./contract.js";

describe("Team.calcCapUsed", () => {
  it("returns 0 for an empty roster", () => {
    const newTeam = new Team("La Liga");
    expect(newTeam.calcCapUsed()).toBe(0);
  });

  it("counts a single contract's full salary", () => {
    const newTeam = new Team("La Liga", [new Contract(100)]);
    expect(newTeam.calcCapUsed()).toBe(100);
  });

  it("counts an IR contract at 50%, flooring the half-cent", () => {
    const team = new Team("La Liga", [
      new Contract(101, RosterStatus.IR),
    ]);
    // floor(101 * 50 / 100) = 50, not 51
    expect(team.calcCapUsed()).toBe(50);
  });

  it("counts a practice squad contract at 25%, floored", () => {
    const team = new Team("La Liga", [
      new Contract(101, RosterStatus.PRACTICE_SQUAD),
    ]);
    expect(team.calcCapUsed()).toBe(25); // floor(101 * 25 / 100) = 25
  });

  it("sums a mixed roster by per-status multiplier", () => {
    const team = new Team("La Liga", [
      new Contract(100, RosterStatus.ACTIVE),
      new Contract(101, RosterStatus.IR),
      new Contract(101, RosterStatus.PRACTICE_SQUAD),
    ]);
    expect(team.calcCapUsed()).toBe(175);
  });

  it("floors cap hit per contract, not after contract sums", () => {
    const team = new Team("La Liga", [
      new Contract(101, RosterStatus.IR),
      new Contract(101, RosterStatus.IR),
    ]);
    expect(team.calcCapUsed()).toBe(100);
  });
});
