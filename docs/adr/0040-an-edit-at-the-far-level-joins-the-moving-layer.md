# ADR-0040: An edit at the far level keeps the query and draws what it added in the moving layer

- **Status:** 🟡 proposed
- **Date:** 2026-11-02
- **Deciders:** Markus Brigl
- **Applies to:** the scene's culling and binding in `packages/comb/src/render/`, the edge meshes of `crates/engine` and `crates/engine-wasm` and their export in `packages/comb/src/bridge/`, the store's signals of an added node in `packages/comb/src/store/`, and the benchmark's edit gesture in `bench/`

## Context

Q-1 asks adding or removing a node or an edge at 50,000 nodes and 50,000 edges to draw a frame
each refresh of the display. The measurement of ticket 16 of revision-2026-10-18 found the edit
gesture at the fitted view, the far level, at a p95 of 116.7 ms on the maintainer's machine, about
seven frames; at the near and the middle level the same gesture held a frame. A profile of it in
the Dev Container found every edit frame querying the engine anew and uploading 15.9 MB, 9.4 MB of
it the edge mesh, for one node or edge added or removed (ticket 17 of revision-2026-10-18).

The scene keeps a query only while the store's `nodes` and `edges` stay the arrays it drew and
`positionsVersion` the counter it drew (`covers` of `packages/comb/src/render/scene.ts`,
ADR-0027); an edit replaces an array, and an added node also increments `positionsVersion`
(ADR-0037). ADR-0036 has a drag keep its query and redraw what it moves in a moving layer, from
the engine's mesh of the edges at the dragged nodes, hidden in the kept query by their ranges; it
names an edit of one node as its follow-up. At the near and the middle level a query finds only
what the viewport shows, and an edit there costs a frame already.

## Decision

We will have the scene keep its query at the far level across edits of a few slots, drawing the
nodes and edges they added in the moving layer and hiding those they removed in what the query
drew, and query anew past those few, at another level, or as ADR-0027 and ADR-0036 say.

- **An edit, as the scene sees it:** the slots in which the store's `nodes` and `edges` differ
  from those of the query it keeps, compared slot by slot, so that several edits within a frame
  count as the slots they changed. At most 256 slots between them keep the query; more, or a load,
  query anew. An added node no longer increments `positionsVersion`, which the restatement of
  ADR-0037 says.
- **What was added:** the added nodes' particles and the added edges, and every edge at an added
  node, drawn in the moving layer each render while the query is kept: the edges meshed by the
  engine as the query meshes an edge, in its rectangle, at its level, relative to its origin, by
  their edge slots, beside the edges a drag moves (ADR-0036).
- **What was removed:** the removed nodes' particles and the removed edges, hidden in what the
  query drew once, by their ranges, as a drag hides the edges it moves.
- **A drag during edits:** the moving layer draws both, the dragged nodes' edges and the edited
  ones, each once.
- **Inspection:** a node or an edge the moving layer draws is drawn, a hidden one is not, as the
  canvas shows them.

**Out of scope:** an edit at the near and the middle level, which queries as before; a change of a
node's content or an edge's style, which queries as before; the zoom at the far level (ticket 18 of
revision-2026-10-18).

## Alternatives considered

- **The engine patches the kept mesh** — the edges an edit touched re-meshed in place and their
  ranges uploaded; exact, with no second path, but a range with no room for an edge that grew needs
  spare room or a reallocation, which ADR-0036 avoided for a drag.
- **Edits coalesced in a window** — several edits share one query; cheap, but one edit a frame
  still queries once a window, and the gesture keeps missing Q-1.
- **Every level** — the moving layer would bind views for added nodes at the near and the middle
  level as well, a second binding of node content for no frame those levels miss.
- **The store's last change as the signal** — the store names the change it recorded, but several
  edits within a frame leave only the last visible to the render that follows.

## Sources / Prior art

- The measurement and the profile of tickets 16 and 17 of revision-2026-10-18 (`docs/plan/`,
  `bench/baselines/13th-gen-intel-r-core-tm-i7-13700.json`).
- ADR-0036, whose moving layer and hiding by ranges this extends.

## Consequences

- Positive: an edit frame at the far level uploads and computes in the size of what it edited,
  which is what Q-1 asks of an edit at 50,000 nodes.
- Negative / trade-offs: the moving layer grows with the edits until the next query, so a long run
  of edits without a pan or a zoom past the margin draws up to 256 slots there, each frame.
- Negative / trade-offs: a slot-by-slot comparison of the arrays on each render of a kept query
  while the arrays differ, about 100,000 comparisons at 50,000 nodes and edges.
- Negative / trade-offs: the engine meshes edges by their slots as well as by their nodes, one
  export more on the bridge.
- Follow-ups: whether the near and the middle level take the same path once they need it.

## Enforcement

A browser test of the example, citing `Verifies: ADR-0040`, adds and removes a node and an edge, one
edit a frame, at the fitted view at 50,010 nodes and asserts by `work()` of `comb/testing` that no
frame queries and the bytes a frame uploads do not grow with the graph, that each added node and
edge is drawn and each removed one is not, and that 257 slots changed at once query anew. A Rust
test of the engine asserts that the mesh of given edge slots holds those edges and no other. The
benchmark's edit at the fitted view holds Q-1 on the maintainer's machine.
