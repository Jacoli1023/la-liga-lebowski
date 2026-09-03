# Domain glossary

The canonical vocabulary for La Liga Lebowski. This file defines what a term
names in this codebase and which synonyms to avoid. It holds no implementation
details and no numbers.

`docs/la-liga-rules.txt` is authoritative for every value - thresholds,
multipliers, roster limits, deadlines. A figure restated here would be a second
source of truth, and it would drift.

## The two sides of the boundary

**Player** - a row mirrored from Sleeper's player pool. A Player is a fact about
the NFL. He carries no league state: no salary, no status, no team in the La
Liga sense. Players exist whether or not anyone in the league has ever heard of
them.

**Contract** - the league's record that a Team holds rights to a Player. This is
where salary, contract length and RosterStatus live. Everything the league cares
about hangs off a Contract, not off a Player.

The distinction matters in one specific way: a Player can be replaced
wholesale by the next sync, and Contracts must not notice. See
ADR-0004.

## Teams and rosters

**Team** - one league member's franchise. Has a cap and a set of Contracts.

**League** - the container for Teams, and the owner of the cap figure and the
ruleset parameters for a Season.

**Season** - one NFL year as the league experiences it, bounded by the March 1
rollover rather than by the calendar.

**Roster** - a query over a Team's Contracts, filtered by RosterStatus. Never a
stored collection, never an array on Team. If you find yourself writing
`team.roster = [...]`, the model has gone wrong.

**Active Roster** - the Contracts that count against the roster ceiling.
Injured Reserve and Practice Squad Contracts are on the Team but not on the
Active Roster.

**RosterStatus** - which bucket a Contract currently sits in. It is data, not a
type: a Contract moves between buckets and is never subclassed to represent one.

## Cap vocabulary

Four distinct terms, frequently confused:

**Cap hit** - one Contract's contribution to its Team's committed cap, being its
salary weighted by its RosterStatus.

**Cap used** - the sum of a Team's Cap hits.

**Cap total** - the per-Team cap for the Season, owned by the League.

**Cap space** - Cap total minus Cap used.

**Dead money** - the cap consequence in Seasons after a Player is dropped
mid-contract. Distinct from the current-Season hit a dropped Contract keeps,
which is not dead money.

## Two kinds of "free"

These are unrelated, and conflating them will produce wrong queries.

**Free agent** - a Player with no live Contract in this league. A La Liga fact.
This is what a blind bid competes for.

**Unsigned** - `players.team` is null, meaning Sleeper does not have him on an
NFL roster. An NFL fact, mirrored from a third party. An unsigned Player may
well be under Contract in La Liga, and a Free agent is usually on an NFL team.

## Position vocabulary

**isLeaguePosition** - is this one of the positions La Liga uses at all? A
question about the `Position` union, answerable with no state. This is what the
sync's filter asks.

**isRosterable** - reserved, and not yet implemented. Real roster eligibility:
is he under Contract elsewhere, is there an Active Roster spot, does he meet
Practice Squad or Injured Reserve eligibility. Needs Team state. Do not let a
position filter squat on this name.

## Terms mirrored from Sleeper

**years_exp** - Sleeper's years of NFL experience. Null means Sleeper does not
know, not that the Player is a rookie. A rookie is `years_exp = 0`. Two columns
in the mirror table can be nullable for entirely different reasons: `team` null
carries domain meaning, `years_exp` null carries absence of data.
