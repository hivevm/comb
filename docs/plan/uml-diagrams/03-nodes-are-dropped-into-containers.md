# Ticket: A dragged node is dropped into a container or onto the canvas, and the host can refuse it

## What to build

The user drags a node and releases it over the topmost container or region under the pointer, or
outside every container. Where that differs from its own container, Comb asks `canMoveInto({ node,
container })`. On `true` the node moves into it, keeping its world position, takes the next rank,
and `nodeMoved` delivers its position relative to the new container and the container. On anything
else the whole drag is taken back and no change is delivered. A container and what it holds are
never its own target.

## Acceptance criteria

- [ ] Given a node on the canvas and a container, when the user drops the node inside the container
      with `canMoveInto` returning `true`, then one `nodeMoved` arrives with the container and the
      position relative to it, and the node is drawn above the container.
- [ ] Given the same drop with `canMoveInto` returning `false`, throwing, or removing the container
      during its call, then the node stands where it stood before the drag, no change of the user's
      is told, and a thrown error reaches the page after the gesture.
- [ ] Given a node in a container, when the user drops it outside every container, then
      `canMoveInto` is asked with `null`, and on `true` the node lies on the canvas.
- [ ] Given a container dragged over a container it holds, when it is released, then `canMoveInto`
      is not asked for it, and the drag is a move within its own container.
- [ ] Given a drop within the node's own container, when it is released, then nothing is asked, and
      `nodeMoved` carries the same container.

## Read first

- Touches: `packages/comb/src/interaction/node-drag.ts`, `packages/comb/src/interaction/guard.ts`,
  `packages/comb/src/api/index.ts`, `packages/comb/src/api/changes.ts`,
  `crates/engine-wasm/src/lib.rs`, `crates/engine/src/graph/nodes.rs`
- ADRs: API-edits-report-nested-changes (*Vetoes*, *A veto during whose call Comb tells a change*),
  ARCH-engine-edits-nested-graph (*Moving into a container*).
- Conventions: *Host code may change the graph*, *Hostile host code in a test answers within
  bounds*.
- Golden path: the connection veto, `packages/comb/src/interaction/connect.ts` and
  `examples/metric-tree/e2e/connect.spec.ts`.
- Seam: browser tests in `examples/metric-tree/e2e/containers.spec.ts`; unit tests beside
  `packages/comb/src/interaction/delete.test.ts`.

## Blocked by

- docs/plan/uml-diagrams/02-containers-are-edited-and-dragged.md

## Mode

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface or the engine's graph, where a wrong
turn costs more than a revert.
