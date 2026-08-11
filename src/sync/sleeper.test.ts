import { describe, it, expect } from "vitest";
import { sleeperPlayerSchema, mapSleeperPlayer } from "./sleeper.js";
import { sleeperFixtures } from "./sleeper.fixtures.js";

describe("sleeperPlayerSchema — the strict boundary", () => {
  // Yours to write. The schema is already drafted in sleeper.ts — turn each
  // todo into a real assertion. Hint: parse returns the cleaned object;
  // .safeParse(...).success is the boolean for the rejection case.
  it("accepts a well-formed skill player", () => {
    const parsed = sleeperPlayerSchema.parse(sleeperFixtures.wellFormedRB);
    expect(parsed.position).toBe("RB");
    expect(parsed.player_id).toBe("4034");
  });

  it("strips unknown extra fields (hashtag, search_rank, ...) instead of throwing", () => {
    const parsed = sleeperPlayerSchema.parse(sleeperFixtures.wellFormedRB);
    expect(parsed).not.toHaveProperty("hashtag");
  });

  it("rejects a player missing a required field (use missingLastName)", () => {
    expect(sleeperPlayerSchema.safeParse(sleeperFixtures.missingLastName).success).toBe(false);
  });
});

describe("mapSleeperPlayer — Sleeper JSON → players row", () => {
  // Each test parses with the real schema first (as the pipeline does), then
  // maps. mapSleeperPlayer is a stub that throws, so all three are RED now.
  //
  // Two-step drive: (1) implement the mapper so it stops throwing, (2) fill in
  // the TODO assertions so the test actually checks something. `hasAssertions()`
  // keeps a test RED even after step 1 until you've done step 2 — it fails any
  // test that finishes without running a single expect. That's the guard
  // against a "passing" test that verifies nothing.

  // syncedAt is injected (decided 2026-07-22 — spec 002, decision 5). A pure
  // mapper means a fixed timestamp asserts an EXACT value (toBe), which also
  // proves the mapper passes it through untouched — not just "is a Date".
  const SYNCED_AT = new Date("2026-07-16T12:00:00.000Z");

  it("maps a well-formed player to a row, field by field", () => {
    const validated = sleeperPlayerSchema.parse(sleeperFixtures.wellFormedRB);
    const row = mapSleeperPlayer(validated, SYNCED_AT);

    expect(row).toEqual({
      sleeperId: "4034",
      firstName: "Christian",
      lastName: "McCaffrey",
      fullName: "Christian McCaffrey",
      position: "RB",
      team: "SF",
      fantasyPositions: ["RB"],
      yearsExp: 8,
      status: "Active",
      injuryStatus: null,
      active: true,
      syncedAt: SYNCED_AT,
    });
  });

  it("keeps a free agent (team: null) without throwing", () => {
    const validated = sleeperPlayerSchema.parse(sleeperFixtures.freeAgent);
    const row = mapSleeperPlayer(validated, SYNCED_AT);
    
    expect(row.team).toBeNull();
  });

  it("carries years_exp: 0 through (the rookie seam)", () => {
    const validated = sleeperPlayerSchema.parse(sleeperFixtures.rookie);
    const row = mapSleeperPlayer(validated, SYNCED_AT);

    expect(row.yearsExp).toBe(0);
  });
});
