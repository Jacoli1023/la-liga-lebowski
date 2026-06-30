import { describe, it, expect } from "vitest";
import { Team } from "./team.js";

describe("empty roster has no cap", () => {
  it("reports 0 cap used", () => {
    const newTeam = new Team("La Liga");
    expect(newTeam.calcCapUsed()).toBe(0);
  });
});
