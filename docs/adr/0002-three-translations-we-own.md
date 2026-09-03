---
status: accepted
date: 2026-07-15
---

# Four shapes, three translations we own

## Context and Problem Statement

Data enters from Sleeper's API and leaves through our own HTTP API, with a
Postgres table and a domain model in between. Sleeper's field names, nullability
and identifiers are theirs to change without notice. Left unchecked, a rename on
their side reaches our API consumers, and their nullability rules become our
domain's problem.

## Considered Options

* Four distinct shapes with three explicit translations: Sleeper JSON, the
  mirror table, domain objects, API JSON.
* Pass through: store Sleeper's payload shape, load it into the domain as-is,
  return database rows directly from route handlers.
* Partial translation: validate on the way in, but serialize database rows
  straight out of handlers.

## Decision Outcome

Chosen option: "four distinct shapes with three explicit translations", because
each translation is then code we own and can change. Sleeper's nullability,
field names and IDs stop at the mirror table. The database's column names stop
at `serialize()`. If Sleeper renames a field, exactly one mapper file breaks and
the domain does not.

### Consequences

* Good, because the blast radius of an upstream change is one file.
* Good, because it names a concrete prohibition: never return a raw database row
  from a route.
* Bad, because a field that needs to reach the API must be written out four
  times, and adding a column is correspondingly tedious.
* Bad, because the guarantee at the outbound edge is weaker than it looks.
  TypeScript is structurally typed and types are erased, so a return type of
  `PlayerResponse` does not stop extra fields from being published. The
  enforcement is the explicit field list inside `serialize`, and nothing else.
  A spread leaks silently; an explicit list fails loudly.
