# Ticket: A container is added to, removed with its content, and dragged with it

## What to build

The host application adds a node into a container with `addNode` and removes a container with
`removeNodes`, which takes everything it holds, at every depth, and every edge at any of them. The
user deletes a selected container, `canDelete` naming the content, and drags a container: the moving
layer moves everything it holds and the edges at them in each frame, and the container's particle
stays in `containers` below the edges at the far level. A move of a container moves the world
positions of what it holds in the same call.

Until then, as ticket 01 left it: `removeNodes` of a container removes the container alone and
leaves what it held on the canvas at its world position, untested; `addNode` ignores `container`
and `isContainer`; and a drag of a container moves its own box alone. At the far level the
moving layer does not reach the `containers` layer: a container removed keeps its particle drawn
until the next query, and a container dragged is drawn twice, its old particle in `containers` and
a new one in the moving layer. This ticket replaces all of these.

Settled with the human on 2026-11-18:

- `nodeMoved` of a node in a container carries `x` and `y` relative to its container and
  `container`, the identifier of the container it lies in, or `null` on the canvas, as
  API-edits-report-nested-changes says; the move into another container stays ticket 03's.
- `addNode` whose `container` names no node of the graph, or a node without `isContainer`, is
  refused as `invalidContainer`, as a load refuses it; `api` checks it against its map.
- A container added by `addNode` takes the next rank, as every node added does, above its sibling
  containers.
- The store keeps `container` and `isContainer` per node, for `nodeMoved`, `nodeAdded`, and the
  host's `applyChange`; positions stay the engine's.
- One engine export names every node and edge a removal takes along, before anything is removed,
  for `canDelete`; `removeNodes` returns the removed node slots beside the edge slots.
- The test of criterion 3 at 50,010 loads the benchmark graph, adds a container with a few nodes
  and an edge between them by `addNode`, and counts queries and bytes per frame as
  `examples/metric-tree/e2e/work-per-frame.spec.ts` does; the benchmark's baselines stay.
- Deleting a node in a container names it and what it holds to `canDelete`; its container stays.

## Acceptance criteria

- [ ] Given a container holding nodes and an edge, when the host calls `removeNodes` with the
      container, then `nodesRemoved` names the container and its content and the edges at them, and
      none is drawn.
- [ ] Given a container selected, when the user presses Delete, then `canDelete` receives the
      container and its content in `nodes` and their edges in `edges`, and the deletion is made only
      where it returns `true`.
- [ ] Given a container holding nodes and an edge between them at 15 nodes and at the fitted view of
      50,010, when the user drags it, then every node and edge it holds follows in each frame at
      each level, the drag queries in no frame before the release, and the bytes uploaded per frame
      do not grow with the graph.
- [ ] Given `addNode` with a `container`, when it is called, then the node is drawn in the container
      at its relative position, and `nodeAdded` carries it as Comb took it.

## Read first

- Touches: `crates/engine/src/graph.rs`, `crates/engine/src/graph/nodes.rs`,
  `crates/engine/src/graph/tests.rs`, `crates/engine-wasm/src/lib.rs`,
  `packages/comb/src/api/editors.ts`, `packages/comb/src/api/changes.ts`,
  `packages/comb/src/interaction/node-drag.ts`, `packages/comb/src/interaction/delete.ts`,
  `packages/comb/src/render/moving.ts`, `packages/comb/src/render/edits.ts`
- ADRs: ARCH-engine-edits-nested-graph (*Removing a container*, *Positions*),
  REN-moving-layer-moves-content, API-edits-report-nested-changes (*Changes*, *Vetoes*).
- Conventions: *Work that should not happen is pinned by a count, never by a time*, *Hand the host
  copies*.
- Golden path: the node drag and its moving layer, `examples/metric-tree/e2e/drag.spec.ts`; the
  removal, `examples/metric-tree/e2e/remove.spec.ts`.
- Seam: browser tests in `examples/metric-tree/e2e/containers.spec.ts`.

## Blocked by

- docs/plan/uml-diagrams/01-containers-are-loaded-and-drawn.md

## Mode

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface or the engine's graph, where a wrong
turn costs more than a revert.
