import { describe, it, expect } from "vitest";
import { sleeperPlayerSchema, mapSleeperPlayer } from "./sleeper.js";
import { sleeperFixtures } from "./sleeper.fixtures.js";

describe("sleeperPlayerSchema — the strict boundary", () => {
  // Yours to write. The schema is already drafted in sleeper.ts — turn each
  // todo into a real assertion. Hint: parse returns the cleaned object;
  // .safeParse(...).success is the boolean for the rejection case.
  it.todo("accepts a well-formed skill player");
  it.todo("strips unknown extra fields (hashtag, search_rank, ...) instead of throwing");
  it.todo("rejects a player missing a required field (use missingLastName)");
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

  // syncedAt is injected here PROVISIONALLY (sourcing is an open decision — see
  // CLAUDE.md). Injecting keeps the mapper pure, so a fixed timestamp asserts an
  // EXACT value; if we instead source new Date() inside the mapper, this becomes
  // toBeInstanceOf(Date). Revisit once the decision is made.
  const SYNCED_AT = new Date("2026-07-16T12:00:00.000Z");

  it("maps a well-formed player to a row, field by field", () => {
    expect.hasAssertions();
    const validated = sleeperPlayerSchema.parse(sleeperFixtures.wellFormedRB);
    const row = mapSleeperPlayer(validated, SYNCED_AT);
    // TODO(jacob): assert each mapped field, e.g.
    //   expect(row.sleeperId).toBe("4034");
    //   expect(row.firstName).toBe("Christian");
    //   expect(row.position).toBe("RB");
    //   expect(row.fantasyPositions).toEqual(["RB"]);
    //   expect(row.syncedAt).toBe(SYNCED_AT);   // injected → exact match, not "is a Date"
    void row;
  });

  it("keeps a free agent (team: null) without throwing", () => {
    expect.hasAssertions();
    const validated = sleeperPlayerSchema.parse(sleeperFixtures.freeAgent);
    const row = mapSleeperPlayer(validated, SYNCED_AT);
    // TODO(jacob): expect(row.team).toBeNull();
    void row;
  });

  it("carries years_exp: 0 through (the rookie seam)", () => {
    expect.hasAssertions();
    const validated = sleeperPlayerSchema.parse(sleeperFixtures.rookie);
    const row = mapSleeperPlayer(validated, SYNCED_AT);
    // TODO(jacob): expect(row.yearsExp).toBe(0);
    void row;
  });
});
