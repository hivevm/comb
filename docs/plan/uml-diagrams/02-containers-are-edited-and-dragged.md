# Ticket: A container is added to, removed with its content, and dragged with it

## What to build

The host application adds a node into a container with `addNode` and removes a container with
`removeNodes`, which takes everything it holds, at every depth, and every edge at any of them. The
user deletes a selected container, `canDelete` naming the content, and drags a container: the moving
layer moves everything it holds and the edges at them in each frame, and the container's particle
stays in `containers` below the edges at the far level. A move of a container moves the world
positions of what it holds in the same call.

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
