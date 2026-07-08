# Spec 001 — Salary Cap Calculation & Invariant

**Status:** Draft — sections marked ⟶ **YOU DECIDE** are yours to fill in before coding.
**Why this is feature #1:** it's the heart of the whole system and it's pure, testable
domain logic with zero I/O. Perfect first TDD target.

---

## R — Requirements / Definition of Done
A Team can report how much cap it has committed, and whether it is cap-legal.

Done when:
- `team.calcCapUsed()` returns total committed cap in **integer cents**, summed over
  *all* the team's contracts, each weighted by its `RosterStatus` multiplier.
- A legality check answers: is committed cap ≤ the league cap?
- Pure function of current state. No I/O. Fully unit-tested.

## E — Entities involved
- `Team` (owns `Contract[]`)
- `Contract` (`status`, `salaryCents`)
- `League` (`salaryCapCents`)
- `RosterStatus` → multiplier (rules)

## A — Approach
Iterate the team's contracts; for each, weight `salaryCents` by `multiplier(status)`;
sum. Legality compares that sum to `league.salaryCapCents`.

✓ **DECIDED:** The multiplier table is a `Record<RosterStatus, number>` constant in a new
`src/domain/rules.ts`, stored as integer percents (100 / 50 / 25). `Contract.calcCapHit()`
consults it and applies it to its own salary; `Team.calcCapUsed()` just sums
`contract.calcCapHit()`. **Why:** a `Record` keyed by the full union is exhaustiveness-
checked by `tsc` — adding a status without a multiplier fails to compile, enforcing the
safeguard that no status silently contributes 0. Keeps the table data-directed (not
subclassed) and configurable per-league later; Contract owns status→hit, Team owns the sum.

⟶ **YOU DECIDE (next chunk):** Where does the legality check live — on `Team`, on
`League`, or as a standalone rule function? Deferred until the multiplier lands green;
decided at the top of that chunk, not now.

## O — Operations (the interface)
Locked for this chunk:
- `CAP_MULTIPLIER_PCT: Record<RosterStatus, number>`  // integer percents, in `rules.ts`
- `Contract.calcCapHit(): number`   // cents; `Math.floor(salaryCents * pct / 100)`
- `Team.calcCapUsed(): number`      // cents; sum of contracts' `calcCapHit()`

Next chunk (deferred):
- `isCapLegal(...): boolean`         // location TBD — see the DECIDE note above

## N — Norms
- Integer cents only.
- The 50% / 25% multipliers will produce **fractions of a cent**.
  ✓ **DECIDED — floor**, via integer-only math: `Math.floor(salaryCents * pct / 100)`
  (multiply first, divide last — no float ever touches money). Half-cent cases truncate
  down, so a discounted player counts at *no more* than his share. Pinned with an odd-cent
  salary in the test plan below.
- `RosterStatus` is a union. No magic strings.
- Domain-pure: no console, no file, no DB.

## S — Safeguards / invariants
- `calcCapUsed` equals the sum of per-contract hits — no double-counting, no missed
  statuses.
- An empty roster returns `0`, not an error.
- Every `RosterStatus` value must be handled — a new status must not silently
  contribute 0 and slip through unnoticed.

## Test plan — ✍️ YOU WRITE THESE
This is architecture-critical, so the tests are your rep. **Enumerate the cases
yourself and write the assertions with exact expected cent values.** Red first, then
implement to green.

Categories to make sure you cover (add your own):
- [ ] Empty roster → 0
- [ ] Single ACTIVE contract → full salary
- [ ] IR contract → 50% (use an odd-cent salary to exercise your rounding rule)
- [ ] PRACTICE_SQUAD contract → 25%
- [ ] Mixed roster (ACTIVE + IR + PS) → correct weighted sum
- [ ] Cap-legal vs cap-illegal, including the exact boundary (at the cap = legal)
- [ ] What happens at the rounding edges?

---
*Deferred for this spec: DROPPED status, capacity/eligibility enforcement on moves,
the 26-man limit check. Those are their own specs.*
