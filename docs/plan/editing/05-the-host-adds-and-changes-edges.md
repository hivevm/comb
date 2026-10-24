# Ticket: The host application adds edges and changes their attributes

## What to build

`addEdge(edge)` adds an edge between two nodes the graph holds, drawn with its appearance, and
`updateEdge(id, patch)` changes its colour, dash (`null` makes it solid), arrowhead, or label
(`null` removes it); the canvas shows the change in the next frame (G-5). `onChange` delivers
`edgeAdded` with the edge as Comb keeps it, defaults filled, and `edgeUpdated` with the patch as
merged, `by: "host"`. The bridge crate checks the edge and the patch as a load checks those
fields and refuses a patch field it does not know, with a new generated kind; `api` refuses an
unknown edge, a duplicate identifier, and an edge to a node the graph does not hold. The engine
adds the edge to the edge grid and the lists of its ends (a list per node since ticket 04), and
restyles or re-places one in place. `addEdge` refuses an edge from a node to itself with a
generated kind of its own (ADR-0024). The doc comment of `missingNode`, today "not in the batch",
widens to a node the graph does not hold.

## Acceptance criteria

- [ ] Given nodes `a` and `b`, when the host adds an edge from `a` to `b` with a colour, a dash,
      and a label, then the next frame draws it so, as inspection reports, and `edgeAdded`
      was delivered with the defaults filled.
- [ ] Given that edge, when the host updates its colour, clears its dash, and moves its label,
      then the next frame draws the change, and `edgeUpdated` was delivered once.
- [ ] Given an edge to a node the graph does not hold, a duplicate identifier, a colour past
      `0xFFFFFF`, a patch of an unknown edge, or a patch with an unknown field, when the host
      calls `addEdge` or `updateEdge`, then a `GraphDataError` of the generated kind is thrown and
      nothing changes (Q-7); the bridge's property test generates the patch fields.
- [ ] Given node `a`, when the host adds an edge from `a` to `a`, then it is refused with the
      self-edge kind and nothing changes.
- [ ] Given a graph at the limit of edges of a load, when the host adds one more, then it is
      refused as `tooMany`.
- [ ] Broken once: with the patch merged before the bridge checked it, the refused-patch criterion
      fails.

## Read first

- ADR-0023, ADR-0009, ADR-0010, ADR-0012 (*Edges*), ADR-0022.
- Glossary: edge, edge label, dash pattern, arrowhead, change.
- `api/index.ts` (`updaterOf`), `api/snapshot.ts` (`patchOf`), the bridge crate's
  `placement_of` and `patch_of`, `e2e/edge-styles.spec.ts`.

## Blocked by

- docs/plan/editing/04-the-host-removes-nodes-and-edges.md

## Mode

with the human: it touches `packages/comb/src/api/`, `crates/engine-wasm/`, and
`crates/engine/src/graph.rs`, protected parts of ADR-0007.
