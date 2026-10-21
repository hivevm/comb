# Ticket: Draft a change to Q-7: a change through the interface, and what a refusal keeps

## What to build

A drafted change to the specification, for the maintainer to decide
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7). The tests that cite Q-7 decide more
than its text says, and the work on Q-7 moved past it:

- `updateNode` with an identifier the graph does not hold throws a `GraphDataError`, and its
  browser test cites Q-7; Q-7 speaks only of graph data, not of a change made through the
  interface.
- The browser tests of refusals assert that the previous graph stays drawn; Q-7 says nothing of
  what a refusal leaves behind.
- ADR-0010 asks the typed error to name the offending node, edge, or field; Q-7 asks only for a
  typed error.
- A value of the wrong type is refused like the three kinds Q-7 names in parentheses.

Q-7 today:

> **Q-7** — Robust input: malformed graph data (non-finite coordinates, an edge referring to a
> missing node, a duplicate identifier) never crashes or hangs the host page and never causes a
> WebAssembly panic; the system rejects it with a typed error.

Drafted:

> **Q-7** — Robust input: malformed graph data (a value of the wrong type, non-finite
> coordinates, an edge referring to a missing node, a duplicate identifier), and a change through
> the public interface that names a node the graph does not hold, never crash or hang the host
> page and never cause a WebAssembly panic; the system rejects each with a typed error that names
> what it refused, and keeps the graph it had.

Landed before docs/plan/revision-2026-10-21/02-a-malformed-value-names-its-place.md, the naming
is unmet for a value of the wrong type, whose problem names no node and no field today; the
maintainer lands the two in that order or accepts the gap as pending.

ADRs: none of the accepted ADRs (0001 to 0006) rests on Q-7. Of the proposed ones, ADR-0010
(*Errors*) already asks for the naming, and ADR-0007 keeps the validation that holds Q-7 with the
maintainer; neither changes. The maintainer confirms this reading.

## Acceptance criteria

- [ ] Given the draft, when the maintainer decides, then the change lands in a pull request of
      their own that names the ADRs it moves, or the draft is dropped with the reason.
- [ ] Given the change landed, when the tests that cite Q-7 are read, then each decides a part of
      its new text, and a part no test decides is listed as pending.

## Read first

- `docs/SPECIFICATION.md` (*Quality Goals*, *Threats & Forbidden Actions*); ADR-0010, ADR-0007.
- `examples/metric-tree/e2e/malformed.spec.ts`, `crates/engine-wasm/src/properties.rs`.
- docs/plan/revision-2026-10-21/01-check-what-only-the-store-keeps.md, whose refusals the new
  text covers too, and docs/plan/revision-2026-10-21/02-a-malformed-value-names-its-place.md,
  which makes the naming hold.

## Blocked by

- None (can start immediately)

## Mode

with the human: a change to the specification is the maintainer's decision.
