# Ticket: An edge ends on another edge, and on a container toward a node it holds

## What to build

An end names an edge by `sourceEdge` or `targetEdge` with `sourceT` or `targetT`, one level deep.
The end lies on that edge's path at its path parameter and follows it. Removing an edge removes the
edges that end on it and reports them. An end on a container toward a node it holds docks beyond
that node on the container's outline. The moving layer moves the edges that end on a dragged node's
edges.

## Acceptance criteria

- [ ] Given a comment anchored by an edge on the middle of an extend, when a use case at either end
      moves, then the anchor's end stays on the extend's path at 0.5 within Q-4's precision, in each
      frame of the drag.
- [ ] Given an edge that ends on an edge which itself ends on an edge, on itself, or on one of its
      own ends, when it loads or `addEdge` takes it, then it is refused with a typed error naming
      the edge.
- [ ] Given the extend removed, when `edgesRemoved` arrives, then it names the anchor too.
- [ ] Given a transition from a composite state to a state it holds, docked on the outline, when it
      is drawn, then its end on the composite state lies on the outline beyond the inner state.

## Read first

- Touches: `crates/engine/src/geometry.rs`, `crates/engine/src/graph/edges.rs`,
  `crates/engine/src/graph/tests.rs`, `crates/engine-wasm/src/graph_data.rs`,
  `crates/engine-wasm/src/properties.rs`, `packages/comb/src/api/snapshot.ts`,
  `packages/comb/src/api/editors.ts`, `packages/comb/src/render/moving.ts`
- ADRs: API-edges-dock-nodes-or-edges (*Ends*, *An end on an edge*, *An end on a container toward a
  node it holds*), REN-moving-layer-moves-content, API-bridge-columns-carry-nesting.
- Glossary: Edge, Dock, Path parameter. Conventions: *Geometry is tested on its awkward cases*.
- Golden path: the path between two nodes in `crates/engine/src/geometry.rs`.
- Seam: geometry tests, browser tests in `examples/metric-tree/e2e/`.

## Blocked by

- docs/plan/uml-diagrams/01-containers-are-loaded-and-drawn.md

## Mode

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface or the engine's graph, where a wrong
turn costs more than a revert.
