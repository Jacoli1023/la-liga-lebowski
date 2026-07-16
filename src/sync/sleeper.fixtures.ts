/**
 * Saved Sleeper player payloads for tests. Shapes mirror the real
 * https://api.sleeper.app/v1/players/nfl feed. These are RAW (pre-validation):
 * pass them through `sleeperPlayerSchema.parse` in tests, exactly as the sync
 * pipeline will.
 *
 * `wellFormedRB` carries several EXTRA fields on purpose, so a test can prove
 * the schema drops them rather than choking on them.
 */
export const sleeperFixtures = {
  // A well-formed skill player, plus extra Sleeper fields the schema should ignore.
  wellFormedRB: {
    player_id: "4034",
    first_name: "Christian",
    last_name: "McCaffrey",
    full_name: "Christian McCaffrey",
    position: "RB",
    team: "SF",
    fantasy_positions: ["RB"],
    years_exp: 8,
    status: "Active",
    injury_status: null,
    active: true,
    // --- extra fields Sleeper sends that we don't model ---
    hashtag: "#CMC",
    search_rank: 5,
    height: "71",
    weight: "205",
    number: 23,
  },

  // Same shape, unsigned: team is null.
  freeAgent: {
    player_id: "9999",
    first_name: "Free",
    last_name: "Agent",
    full_name: "Free Agent",
    position: "WR",
    team: null,
    fantasy_positions: ["WR"],
    years_exp: 3,
    status: "Active",
    injury_status: null,
    active: true,
  },

  // A rookie: years_exp is 0 (the isRookie seam).
  rookie: {
    player_id: "12000",
    first_name: "Rook",
    last_name: "Ie",
    full_name: "Rook Ie",
    position: "QB",
    team: "CHI",
    fantasy_positions: ["QB"],
    years_exp: 0,
    status: "Active",
    injury_status: null,
    active: true,
  },

  // Malformed: last_name is missing entirely. For the Zod-rejection test.
  missingLastName: {
    player_id: "13000",
    first_name: "No",
    full_name: "No Lastname",
    position: "TE",
    team: "KC",
    fantasy_positions: ["TE"],
    years_exp: 2,
    status: "Active",
    injury_status: null,
    active: true,
  },

  // A team defense: the filter drops this BEFORE Zod sees it. full_name /
  // years_exp / status are absent — a different shape, not malformed. Kept here
  // for the later filter-before-validate test, NOT the mapper.
  teamDefense: {
    player_id: "SF",
    first_name: "San Francisco",
    last_name: "49ers",
    position: "DEF",
    team: "SF",
    fantasy_positions: ["DEF"],
    active: true,
  },
};
