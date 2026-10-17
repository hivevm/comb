# Ticket: Draw only what is in the viewport

## What to build

Panning a large graph binds display objects only to the nodes, edge labels, and edges whose
bounds meet the viewport, with a margin. The engine answers which slots those are from a spatial
index it keeps current through loads and moves; the scene takes node views and edge-label views
from pools and returns the rest.

## Acceptance criteria

- [ ] Given random graphs, when the engine's index is queried with a rectangle, then it returns
      exactly the slots a brute-force scan returns, before and after nodes move.
- [ ] Given the bridge, when it queries the index after the engine's memory grew, then the result
      view holds the current slots.
- [ ] Given the example with a known graph, when a browser test pans so that known nodes, edges,
      and edge labels lie entirely outside the viewport, then none of them is bound to a display
      object (`Verifies: G-7`).
- [ ] Given the example at 1 and at 1,000 copies, when the viewport shows the same area, then the
      number of bound display objects is the same within the margin.
- [ ] Given the drag and selection test of ticket 01, when it runs, then it still passes.
- [ ] Given `bun run bench`, when the ticket closes, then the pull request reports its numbers
      against the baseline.

## Read first

- ADR-0010 (index results as a `Uint32Array` view, fresh per read), ADR-0012 (pooling and
  culling), ADR-0009 (the engine stays pure; only the bridge calls it).
- Glossary: culling, viewport, bridge, engine.
- The bridge's existing tests, including the one after memory growth.

## Blocked by

- docs/plan/large-graphs/01-benchmark.md

## Mode

with the human: it adds exports to the bridge, whose data format ADR-0007 keeps with the
maintainer.
