# Ticket: The host application adds a node, and hears it through onChange

## What to build

The tracer bullet through every layer the editing spec touches. The host application calls
`addNode` with a node and sees it on the canvas at the given position, without a load, and its
listener of `onChange` receives one `nodeAdded` with `by: "host"`; a `load` delivers `loaded`.
Underneath: the engine appends a node slot, or takes a free one where there is one, with the
free list of ADR-0022 (empty until removals exist), gives it the next rank so that it is drawn
and hit above every other node, and adds the node to the node grid in place; queries return node
slots by rank and the nodes layer and the particles bind in that order;
the bridge crate checks the node as a load checks one and returns the slot; `api` reads the node
once into primitives, refuses an identifier the store's map holds already as `duplicateNode` and
a count past the limit of a load, and the store records the slot, the node, and the change it
made, from which `api` delivers `onChange`. The change types are exported from `comb`.

## Acceptance criteria

- [ ] Given a loaded graph, when the host calls `addNode` with a node at (x, y), then the next
      frame draws it there, inspection names it, and a query in the engine finds it without the
      index being built again.
- [ ] Given nodes overlapping where a node is added, when the next frame draws, then inspection
      draws the added node above them and a press there selects it, also where the slot order
      would put it below; a load still draws nodes in slot order.
- [ ] Given a listener of `onChange`, when the host calls `addNode`, then the listener has
      received exactly one `{ kind: "nodeAdded", by: "host", node }` before the call returns, and
      when the host calls `load`, exactly one `{ kind: "loaded", by: "host" }`.
- [ ] Given a graph holding node `a`, when the host adds another node `a`, a node with a
      coordinate that is not finite, a title of the wrong type, or a node past the limit of a
      load, then `addNode` throws a `GraphDataError` of the generated kind, the graph and the
      store are as they were, and no change is delivered (Q-7).
- [ ] Given a lost engine, when the host calls `addNode`, then it throws `EngineLostError`.
- [ ] Given the type test, when `GraphChange` is checked, then it admits exactly the kinds of
      ADR-0023's table.
- [ ] Broken once: with the node left out of the grid, the first criterion fails.

## Read first

- ADR-0022, ADR-0023 (proposed; they bind this work), ADR-0026, ADR-0010, ADR-0011, ADR-0021.
- Glossary: slot, free slot, change, graph data.
- `api/index.ts` (`loaderOf`, `updaterOf`), `api/snapshot.ts`, `store/index.ts`,
  `crates/engine/src/graph.rs` (`Graph::new`, `index`), `crates/engine/src/spatial.rs`
  (`Grid::set`), the bridge crate's `load_graph` and `check_node_patch`.
- The golden path: `updateNode` from `api` through the bridge into the store; its browser tests
  in `examples/metric-tree/e2e/malformed.spec.ts`; the type test `store/graph-view.test.ts`.

## Blocked by

- docs/plan/revision-2026-10-24/01-only-a-snapshot-reaches-the-bridge.md
- docs/plan/revision-2026-10-24/07-the-bridge-crate-reads-graph-data-in-a-module-of-its-own.md

## Mode

with the human: it touches `packages/comb/src/api/`, `crates/engine-wasm/`,
`packages/comb/src/bridge/`, and `crates/engine/src/graph.rs`, protected parts of ADR-0007, and
it sets the shape of a public interface (ADR-0023).
