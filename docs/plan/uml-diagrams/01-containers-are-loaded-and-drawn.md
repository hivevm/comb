# Ticket: A loaded container draws its nodes above it and its edges above both

## What to build

The tracer bullet through containment (G-14). A host application loads a graph in which a node
marked `isContainer` holds nodes by their `container` field, at positions relative to it, one of
them a container itself. Comb draws the containers in the new `containers` layer below the edges,
each container above its own, and every other node above them. It culls each node by its own box and
hits a node that is no container first, then an edge, then a container. The engine keeps world
positions as the sums along the chain of containers, and refuses a node in a node that is no
container, in itself, or in one it holds. Inspection reports what is bound in which layer.

## Acceptance criteria

- [ ] Given graph data with a container holding two nodes and an edge between them, when it loads,
      then inspection reports the container in `containers`, the edge above it, and the two nodes in
      `nodes` at their world positions, the sums of their relative positions and the container's.
- [ ] Given a container added after the nodes it overlaps, when a press lands where it and a node
      overlap, then the node is hit; a press on the edge over the container selects the edge.
- [ ] Given graph data whose `container` names a node without `isContainer`, a node itself, or a
      node it holds, when it loads, then the load is refused with a typed error naming the node and
      the field, and the graph stays as it was.
- [ ] Given a container far outside the viewport holding a node that reaches into it, when the scene
      queries, then the node is bound and the container is not.
- [ ] Given the property test of `crates/engine/src/graph/tests.rs` over random trees of containers,
      when it runs, then every world position is the sum along its chain, and a query and a hit test
      find what a scan finds.

## Read first

- Touches: `crates/engine/src/graph.rs`, `crates/engine/src/graph/nodes.rs`,
  `crates/engine/src/graph/query.rs`, `crates/engine/src/graph/hit.rs`,
  `crates/engine/src/graph/tests.rs`, `crates/engine-wasm/src/lib.rs`,
  `crates/engine-wasm/src/graph_data.rs`, `crates/engine-wasm/src/properties.rs`,
  `packages/comb/src/api/snapshot.ts`, `packages/comb/src/store/index.ts`,
  `packages/comb/src/render/scene.ts`, `packages/comb/src/render/bindings.ts`,
  `packages/comb/src/render/particles.ts`, `packages/comb/src/testing.ts`
- ADRs: ARCH-engine-edits-nested-graph (*Containers*, *Positions*, *Bounds*, *Draw order of nodes*),
  REN-virtualized-nested-scene (*Layers*, *Culling*, *Hit testing*), REN-node-content-and-hits (*Hit
  test*), API-bridge-columns-carry-nesting (*Graph data of a load*), API-edits-report-nested-changes
  (*Graph data of nesting*).
- Glossary: Container. Conventions: *Geometry is tested on its awkward cases*, *A random test counts
  the cases each clause rests on*, *Check a value as the engine keeps it*.
- Golden path: a load through `packages/comb/src/api/snapshot.ts` into `loadGraph`; the draw-order
  test of a node in a freed slot.
- Seam: inspection through `comb/testing` in a new `examples/metric-tree/e2e/containers.spec.ts`,
  and the engine's property tests.

## Blocked by

- None (can start immediately)

## Mode

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface or the engine's graph, where a wrong
turn costs more than a revert.
