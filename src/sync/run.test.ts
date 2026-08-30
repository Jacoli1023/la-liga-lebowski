import { describe, it, expect, afterEach, vi } from "vitest";
import { z } from "zod";

import { syncPlayers, fetchPlayerPool } from "./run.js";
import { sleeperFixtures } from "./sleeper.fixtures.js";
import type { Db } from "../db/client.js";

/**
 * Tests for the sync's IMPERATIVE SHELL. Closes the named gap in spec 002's
 * test plan, and the wider one found alongside it: run.ts was the only file in
 * src/ with no .test.ts sibling, so decision 6's two aborts had never executed.
 *
 * Note the two describe blocks need COMPLETELY DIFFERENT machinery, and that is
 * decision 7 showing up as file structure rather than as prose. syncPlayers'
 * subject is POLICY, so its tests hand over a plain object and never mention
 * fetch. fetchPlayerPool's subject is the HTTP CALL, so its tests swap the
 * global and never mention the database. Same file, two levels, one cut each.
 */

/**
 * syncPlayers takes a Db, and both abort tests throw BEFORE upsertPlayers is
 * reached, so this value is never read. Booting a real in-memory PGlite just to
 * ignore it would roughly double the suite's runtime (~1.3s -> ~2.8s) to prove
 * nothing, so this is a deliberate exception to the "as is not validation" rule
 * rather than an oversight.
 *
 * WHY THE EXCEPTION HOLDS: that rule is about UNTRUSTED DATA at an external
 * boundary, where a cast claims a shape nobody verified. Nothing crosses a
 * boundary here. The claim is not "this is a Db", it is "nothing ever asks."
 *
 * The double `as unknown as` is required because TypeScript rejects the direct
 * `null as Db` outright - the types do not overlap enough. Having to say it
 * twice is the compiler pricing the lie, and it is worth noticing.
 *
 * IF THIS EVER BREAKS: a failure reading `.insert` or `.select` of null means
 * syncPlayers now touches the database before aborting. That is a real change
 * in behavior - fix the code or boot a real db here, but do not paper over it.
 */
const unusedDb = null as unknown as Db;

/** The clock is injected (decision 5). Any Date will do; nothing reads it. */
const SYNCED_AT = new Date("2026-01-01T00:00:00Z");

describe("syncPlayers - decision 6's two aborts", () => {
  /**
   * ABORT 1 (run.ts:117). THEIRS: Sleeper sent an empty pool. Remedy is to
   * re-run later, with no code change.
   *
   * PICK THE REGEX CAREFULLY. Both abort messages contain "Nothing was
   * written." - match that and this test passes for EITHER abort, which is the
   * one failure it exists to catch. Match a phrase only this message has.
   *
   * MUTATION TO RUN AFTERWARDS, because this test is worthless if it survives
   * it: delete the `entryCount === 0` block from run.ts. An empty pool then
   * falls through to abort 2 and still throws - so a bare .rejects.toThrow()
   * stays GREEN while the code blames you for Sleeper's outage. Your assertion
   * must go red.
   */
  it("aborts when Sleeper returns an empty pool, and blames Sleeper", async () => {
    await expect(syncPlayers(unusedDb, async () => ({}), SYNCED_AT)).rejects.toThrow(/empty pool/);
  });

  /**
   * ABORT 2 (run.ts:138). OURS: entries arrived and every one was filtered out,
   * which means the position filter is stale. This is the failure that would
   * otherwise LOOK LIKE SUCCESS - fetch fine, JSON fine, envelope fine, every
   * row politely skipped, exit 0.
   *
   * teamDefense is position "DEF", so it survives the envelope parse and is
   * dropped by the filter: entryCount 1, rowCount 0. Add a kicker if you want
   * the pool to read more like the real thing; one entry is enough to fire it.
   *
   */
  it("aborts when entries arrive but none match a league position, and blames us", async () => {
    await expect(syncPlayers(unusedDb, async () => ({ SF: sleeperFixtures.teamDefense }), SYNCED_AT)).rejects.toThrow(/filter is stale/);
  });
});

describe("fetchPlayerPool - the only socket in slice 0", () => {
  /**
   * vi.stubGlobal MUTATES A GLOBAL, so it must be undone or it leaks into the
   * next test and then the next file. This cleanup is the exact cost decision 7
   * listed as a BENEFIT of parameter injection - the bill arriving, in the one
   * place that cannot avoid it.
   */
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The assertion that matters most in this file. `fetch` does NOT throw on a
   * 500 - it rejects only on a network-level failure - so a 500 is a perfectly
   * successful fetch carrying an HTML error page. Without the res.ok check,
   * .json() parses HTML and reports a syntax error at some character offset: an
   * outage wearing the costume of a parse bug.
   *
   * Use a REAL Response, not an object literal. A literal encodes your belief
   * about fetch's shape, and `ok` is DERIVED from status rather than
   * independent - get that wrong and this test passes against a fiction. Same
   * instinct as not mocking the database.
   *
   * WATCH THE MESSAGE: `new Response(body, { status: 500 })` leaves statusText
   * as "", so the thrown string reads "Sleeper returned 500  for https://..."
   * with a double space. Assert on the status number, not the whole sentence.
   *
   * DO NOT PUT THE STATUS NUMBER IN THE STUB'S BODY. Node's JSON parse error
   * QUOTES the input it choked on - JSON.parse("<html>500</html>") throws
   * `Unexpected token '<', "<html>500</html>" is not valid JSON`. So with that
   * body, deleting the res.ok check leaves this test GREEN: the SyntaxError
   * message happens to contain "500" too. Use a body with no digits
   * ("<html>Service Unavailable</html>") and the mutation goes red properly.
   *
   */
  it("aborts on a 500 rather than parsing the error page as JSON", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response("<html>Service Unavailable</html>", { status: 500 });
    });

    await expect(fetchPlayerPool()).rejects.toThrow(/500/);
  });

  /**
   * Proves the envelope parse at the END of fetchPlayerPool actually runs. That
   * parse is deliberately the SECOND one - mapSleeperPayload parses again,
   * because a pure function defends its own boundary - so it is exactly the
   * kind of line that looks redundant and gets deleted.
   *
   * Assert the CLASS (z.ZodError), never the message: a ZodError's message is
   * JSON.stringify(issues, null, 2), so a regex over it pins Zod's formatting
   * rather than our behavior. Contrast the two syncPlayers tests above, where
   * matching the message is correct because we WROTE those messages. The rule:
   * match the message when you wrote it, match the structure when a library
   * did.
   *
   * One case is enough here. The four-way shape sweep ([], null, "oops", 42)
   * already exists against mapSleeperPayload in sleeper.test.ts; this test asks
   * only whether fetchPlayerPool parses at all.
   *
   */
  it("aborts at the envelope when a 200 carries a non-object body", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response("[]", { status: 200 });
    });

    await expect(fetchPlayerPool()).rejects.toThrow(z.ZodError);
  });
});
