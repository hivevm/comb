# Ticket: A property test of the engine combines nesting, regions, border nodes, and edges on edges

## What to build

The engine's property tests cover one feature of uml-diagrams at a time:

- random container trees without edges, and the container edits and drops, in
  `crates/engine/src/graph/tests.rs`;
- border nodes with `move_into`, but with no regions and no edges on edges, in the same file;
- regions alone in `crates/engine/src/graph/regions.rs`;
- flat graphs of edges on edges (`anchored_graph`) in `crates/engine/src/graph/edges.rs`;
- divided nodes laid apart in `crates/engine/src/graph/hit.rs`.

No test combines them, so a border node on a divided node under a drag of a line, an edge on an edge
between a container and a node it holds under `move_into`, a resize of a divided node with border
nodes, and the removal of all of them go untested together.

Evidence: the review of the whole branch at 9b198f2f named the property tests covering one feature
at a time as a lesser finding, left to this revision. A defect between features, a divided region
taking nodes beside its regions (ticket 05, finding 1), surfaced in review rather than in a test.

Write one property test in `graph/tests.rs` that generates nested graphs with divided nodes, border
nodes, edges between containers and the nodes they hold, and edges on edges, and runs random steps:
a translation, `move_into`, a resize, a drag of a line, a slide, a removal, and an addition. After
each step it compares the graph with a model: a world position is the sum along its chain; a border
node lies on its node's outline; an anchored end lies at its anchoring path's point; regions tile
their node below its top; and the query and the hit test find what a scan finds.

## Acceptance criteria

- [ ] Given the new test, when it runs, then it counts the cases each clause rests on and asserts
      their floors after the run, as `docs/CONVENTIONS.md` asks of a random test.
- [ ] Given each of these broken in turn, the ride of a border node in `reboxed`, the loop of
      anchored ends in `place_edge`, and `refit`, when the test runs, then it fails.
- [ ] Given the engine's tests, when they run in `scripts/check-all.sh`, then the new test keeps
      within the time the property tests take today, plus a share the hand-off states.

## Read first

- Touches: `crates/engine/src/graph/tests.rs`
- ARCH-engine-edits-nested-graph, ARCH-regions-are-container-slots, ARCH-border-nodes-ride-sides,
  API-edges-dock-nodes-or-edges, REN-node-content-and-hits.
- The golden path: the property tests of edits against a scan in `graph/tests.rs`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the engine's graph, a protected part the maintainer reviews
(DEV-implementer-and-fresh-reviewer).
