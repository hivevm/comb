# Ticket: The engine divides a node in one operation that a load, addNode, and updateNode share

## What to build

A division of a node is a protocol of thin setters in `crates/engine/src/graph/regions.rs`
(`divide`, `made_by_division`, `set_divided_width`, `set_top`, `mark_region`, `arrange`), whose doc
comments state the order a caller keeps. The bridge crate keeps that order three times: in a load
(`crates/engine-wasm/src/graph_data/load.rs`), in `addNode`, and in `updateNode`
(`crates/engine-wasm/src/lib.rs`). The invariants of ARCH-regions-are-container-slots hold only
where each caller keeps the order.

Evidence: the three callers drifted apart in review after review:

- ticket 05 of uml-diagrams, first review: a divided region took nodes beside its regions in a
  load, `addNode`, the drop target, and `api`, fixed in four places (finding 1); `updateNode` with
  `regions: []` left the node divided (finding 2); `updateNode` laid a grown node out from its grown
  width, unlike a load (finding 7);
- ticket 06 of uml-diagrams, finding 7: `regions: []` was taken by a load and refused by `addNode`
  and `updateNode`.

Let one operation of the engine divide a node, or leave it undivided: it marks the regions as
containers, keeps what a kept region held, as the human decided for ticket 05 of uml-diagrams,
records the data width, and lays the regions out. A load, `addNode`, and `updateNode` call it, and
the bridge crate orders no step of a division.

## Acceptance criteria

- [ ] Given the engine's graph, when it is read, then `made_by_division`, `set_divided_width`, and
      `mark_region` are not public, and the bridge crate calls the one operation alone.
- [ ] Given a random division, when a property test applies it by a load, by `addNode`, and by
      `updateNode`, then the three give equal boxes and equal marks.
- [ ] Given `regions: []`, when it is handed over by each of the three paths, then the node ends
      undivided on each, in one test.

## Read first

- Touches: `crates/engine/src/graph/regions.rs`, `crates/engine/src/graph/nodes.rs`,
  `crates/engine-wasm/src/graph_data/load.rs`, `crates/engine-wasm/src/graph_data/regions.rs`,
  `crates/engine-wasm/src/lib.rs`
- ARCH-regions-are-container-slots, ARCH-engine-edits-nested-graph,
  API-bridge-columns-carry-nesting.
- The seam: `crates/engine/src/graph/regions.rs`'s tests, and the bridge crate's
  `crates/engine-wasm/src/properties.rs`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the engine's graph and the bridge crate, protected parts the maintainer
reviews (DEV-implementer-and-fresh-reviewer).
