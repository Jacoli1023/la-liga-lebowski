import { describe, it, expect } from "vitest";
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
});

