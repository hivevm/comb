# Ticket: A border node sits on a side of its node, moves with it, and slides along its outline

## What to build

A node with `attachedTo`, `side`, and `offset` is a border node. The engine centres it where the
line at right angles to that side meets the outline, nearer the side, keeps its world position,
moves it with its node, and keeps its side and offset through a resize. It is drawn and hit directly
after its node. The user drags it along the outline, onto another side where that is nearer, and
`nodeMoved` reports its side and offset. Edges dock on it as on any node. Removing a node removes
its border nodes and their edges. The moving layer drags a node's border nodes with it.

## Acceptance criteria

- [ ] Given an action with a pin on its right side, when it loads, then the pin's centre lies on the
      action's outline within Q-4's precision, and inspection draws the pin above the action and
      above a node added after the action.
- [ ] Given the pin, when the user drags it around the action's corner, then it stays on the
      outline, moves to the bottom side, and one `nodeMoved` arrives with `side` and `offset`.
- [ ] Given an edge docked on the pin, when the user drags the action, then the pin and the edge
      follow in each frame.
- [ ] Given the action removed, when `nodesRemoved` arrives, then it names the pin, and the edge at
      it is gone.
- [ ] Given a diamond and an ellipse with border nodes on every side, when the property test of
      `crates/engine/src/graph/tests.rs` moves and resizes them, then each border node stays on the
      outline at its side.

## Read first

- Touches: `crates/engine/src/graph.rs`, `crates/engine/src/graph/nodes.rs`,
  `crates/engine/src/shape.rs`, `crates/engine/src/graph/tests.rs`,
  `crates/engine-wasm/src/graph_data.rs`, `packages/comb/src/api/snapshot.ts`,
  `packages/comb/src/api/changes.ts`, `packages/comb/src/interaction/node-drag.ts`,
  `packages/comb/src/render/moving.ts`
- ADRs: ARCH-border-nodes-ride-sides, ARCH-engine-edits-nested-graph (*Draw order of nodes*),
  REN-moving-layer-moves-content, API-edits-report-nested-changes, API-bridge-columns-carry-nesting.
- Glossary: Border node, Connector. Conventions: *Geometry is tested on its awkward cases*.
- Golden path: the node drag; the crossing of the outline in `crates/engine/src/shape.rs`.
- Seam: browser tests in a new `examples/metric-tree/e2e/border-nodes.spec.ts`.

## Blocked by

- docs/plan/uml-diagrams/02-containers-are-edited-and-dragged.md
- docs/plan/uml-diagrams/04-nodes-take-a-height-and-are-resized.md

## Mode

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface or the engine's graph, where a wrong
turn costs more than a revert.
