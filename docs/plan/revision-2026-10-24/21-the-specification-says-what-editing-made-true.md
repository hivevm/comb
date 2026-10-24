# Ticket: The specification says what editing made true

## What to build

The editing work served criteria whose text no longer says what the tests decide. Three drafted
changes of `docs/SPECIFICATION.md`, each the maintainer's to land, take or refuse
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7). No agent lands them.

**1. Q-1 names editing.** The editing spec served Q-1 with "edits are incremental, so they hold at
50,000 nodes", and the benchmark times an edit gesture (ADR-0022, `bench/run.ts`), but Q-1 names
only dragging a node, panning, and zooming, so the edit gesture is measured against no criterion.
Draft:

> **Q-1** — Interaction performance: the reason Comb exists. With 50,000 nodes and 50,000 edges
> loaded, dragging a node, panning, zooming, and adding or removing a node or an edge hold a p95
> frame time of at most 16.7 ms (60 fps) on the reference machine, measured by the benchmark of
> the Strategy.

Moves: ADR-0008 (*Benchmark*, what `bun run bench` measures), ADR-0022 (its *Consequences*
weigh Q-1, and a rebuild "may miss Q-1" in its frame).

**2. Q-7 names edges and duplicates.** Q-7 refuses "a change through the public interface that
names a node the graph does not hold". The interface now also refuses an edge it does not hold
(`unknownEdge`), an identifier it holds already (`duplicateNode`, `duplicateEdge`), and an edge
from a node to itself (`selfEdge`), and the browser tests of those refusals cite `Verifies: Q-7`.
Draft of its first sentence:

> **Q-7** — Robust input: malformed graph data (a value of the wrong type, non-finite
> coordinates, an edge referring to a missing node, a duplicate identifier), and a change through
> the public interface that names a node or an edge the graph does not hold, or adds one it holds
> already, never crash or hang the host page and never cause a WebAssembly panic; …

Moves: ADR-0023 (*Validation*, *Refusals*), ADR-0028 (*What the bridge cannot see*), whose
Context cites Q-7's wording.

**3. The assumption on edges and a load's self-edges.** The specification assumes every edge
connects a connector of one node to one of another; `load` accepts an edge from a node to itself,
which ADR-0024 (*Self-edges*) records as an assumption not enforced for a load. Where the
specification and an ADR disagree, the specification wins
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 5), so the conflict is raised here.
Two drafts, one to choose:

> (a) Every edge connects one connector of a node to one connector of another node; there are no
> hyperedges and no edges without both ends. An edge of a load may join a node to itself.

> (b) Keep the assumption as it stands, and supersede ADR-0024's *Self-edges* so that `load`
> refuses a self-edge as `addEdge` does, a change of what a load accepts (*Existing behaviour*
> of the editing spec kept it).

Moves: ADR-0024 (*Self-edges*, its *Consequences*), and with (b) ADR-0028 (the limits and refusals
of a load).

## Acceptance criteria

- [ ] Given each of the three drafts, when the maintainer has decided it, then the specification
      says it or the ticket records the refusal, and every ADR it moves is named in that change.
- [ ] Given `scripts/check-docs.sh` and `scripts/check-traceability.sh`, when they run after the
      change, then they pass.

## Read first

- `docs/SPECIFICATION.md` (Q-1, Q-7, *Assumptions*); ADR-0008, ADR-0022, ADR-0023, ADR-0024,
  ADR-0028.

## Blocked by

- None (can start immediately)

## Mode

with the human: a change of the specification is the maintainer's decision alone
([`AGENTS.md` §3](../../../AGENTS.md#3-adr-rules), rule 7).
