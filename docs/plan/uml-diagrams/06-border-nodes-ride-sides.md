# Ticket: A border node sits on a side of its node, moves with it, and slides along its outline

## What to build

A node with `attachedTo`, `side`, and `offset` is a border node. The engine centres it where the
line at right angles to that side meets the outline, nearer the side, keeps its world position,
moves it with its node, and keeps its side and offset through a resize. It is drawn and hit directly
after its node. The user drags it along the outline, onto another side where that is nearer, and
`nodeMoved` reports its side and offset. Edges dock on it as on any node. Removing a node removes
its border nodes and their edges. The moving layer drags a node's border nodes with it.

Settled with the human on 2026-11-18:

- `updateNode` sets a border node's `side` and `offset` here.
- `NodeData` becomes a union in TypeScript: a node with `x`, `y`, and optionally `container`, or a
  border node with `attachedTo`, `side`, and `offset`.
- One new generated kind, `invalidAttachment`, names the node and the field. It refuses a border
  node attached to itself or to another border node, one with `isContainer`, `regions`, or
  `resizable`, and `attachedTo` beside `x`, `y`, or `container`. An `attachedTo` naming no node of
  the graph is refused as `missingNode`, as an edge's end is.
- A load, `addNode`, and `updateNode` hold an `offset` within its side's length, as a resize does;
  only an offset that is not finite is refused. `nodeAdded` reports the offset as held.
- A point of the outline belongs to the side of the box nearest it, ties in the order top, right,
  bottom, left; its `offset` is its distance from that side's start. The property test asserts
  that the side and offset lead back to that point.
- A node that ticket 03 moves into another container takes its border nodes along in the same
  call of the engine; `nodeMoved` names the node alone. A drag of a border node never asks
  `canMoveInto`.
- A border node can be selected and deleted alone, with the edges at it.
- A drag that leaves a border node at the side and offset it had delivers no `nodeMoved`.
- The tests run in `examples/metric-tree/e2e/border-nodes.spec.ts`, the criteria's action a
  rectangle and its pin a small node without content; the diamond and the ellipse, which
  `crates/engine/src/shape.rs` has already, are the engine's property test's.

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
- [ ] Given the action selected, when the user presses Delete, then `canDelete` names the pin in
      `nodes` and the edge at it in `edges`.
- [ ] Given `updateNode` with a pin's `side` and an `offset` past that side's length, when it is
      called, then the pin sits on that side at its end.
- [ ] Given a diamond and an ellipse with border nodes on every side, when the property test of
      `crates/engine/src/graph/tests.rs` moves and resizes them, then each border node stays on the
      outline at its side.
- [ ] Given a border node attached to a border node, one with `resizable`, and one with `x` beside
      `attachedTo`, when each loads, then it is refused as `invalidAttachment` naming the node and
      the field; an `attachedTo` naming no node is refused as `missingNode`.

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
