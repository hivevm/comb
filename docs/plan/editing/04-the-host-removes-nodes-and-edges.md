# Ticket: The host application removes nodes and edges, and their slots are reused

## What to build

`removeNodes(ids)` removes those nodes and every edge at them; `removeEdges(ids)` removes those
edges. Each refuses an identifier the graph does not hold (`unknownNode`, `unknownEdge`, the
latter a new generated kind) and then changes nothing. `onChange` delivers one `nodesRemoved`
with the removed nodes and the edges that went with them, or one `edgesRemoved`, `by: "host"`.
Underneath, the engine frees the slots onto its free lists, takes the items out of the grids and
out of the lists of edges at each node (which this ticket turns from the packed array into a
list per node), returns the slots of the removed edges, and the next `addNode` takes the slot
freed last (ADR-0022). The store keeps holes at free slots and every reader skips them; a
selection of a removed item is cleared.

## Acceptance criteria

- [ ] Given random sequences of additions, removals, and moves of nodes and edges, when the
      engine's property test queries and hits after each step, then it finds exactly what a scan
      of the items in use finds, never a free slot, and the lists of edges at each node are exact.
- [ ] Given a graph of 50,000 nodes, when a node and an edge are removed and added within the
      index's extent, then the index is built no time.
- [ ] Given node `a` with three edges, when the host removes `a`, then the canvas draws neither
      `a` nor its edges, and `onChange` delivered one `nodesRemoved` naming `a` and the three
      edges (G-4).
- [ ] Given a removed node's slot, when the host adds a node, then it takes that slot and is drawn
      and hit above the nodes in higher slots, and the bridge refuses a free slot wherever an
      export names one.
- [ ] Given an unknown identifier among several known ones, when the host removes them, then a
      `GraphDataError` of kind `unknownNode` or `unknownEdge` is thrown and nothing is removed
      (Q-7).
- [ ] Given the selected node, when the host removes it, then `onSelectionChange` reports `null`.
- [ ] Broken once: with removals left in the grid, the property test fails.

## Read first

- ADR-0022, ADR-0023, ADR-0026, ADR-0010 (*Slots*), ADR-0012 (*Culling*, *Hit testing*).
- Glossary: slot, free slot, change, selection.
- `crates/engine/src/graph.rs` (`link`, `translate`, the tests against a scan),
  `crates/engine/src/spatial.rs`, `store/index.ts`, `api/index.ts` (`boundsOf` reads every slot).

## Blocked by

- docs/plan/editing/01-the-host-adds-a-node.md

## Mode

with the human: it touches `crates/engine/src/graph.rs`, `crates/engine-wasm/`, and
`packages/comb/src/api/`, protected parts of ADR-0007.
