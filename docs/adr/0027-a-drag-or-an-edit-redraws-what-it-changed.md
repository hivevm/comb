# ADR-0027: A drag, or an edit at the far level, redraws what it changed in a moving layer, and the scene keeps its query

- **Status:** 🟢 accepted
- **Date:** 2026-11-02
- **Deciders:** Markus Brigl
- **Applies to:** the scene's culling and binding in `packages/comb/src/render/`, the edge meshes of `crates/engine` and `crates/engine-wasm` and their export in `packages/comb/src/bridge/`, the store's signals of a move and of an added node in `packages/comb/src/store/`, and the node drag of `packages/comb/src/interaction/`

## Context

Q-1 asks dragging a node, and adding or removing a node or an edge, at 50,000 nodes and 50,000
edges to draw a frame each refresh of a 60 Hz display. ADR-0027 has a drag keep the query of its
press and redraw what it moves in a moving layer of its own, from the engine's mesh of the edges at
the dragged nodes, hidden in the kept query by their ranges; it names an edit of one node as its
follow-up.

The measurement on the maintainer's machine (ticket 17 of revision-2026-10-18,
`bench/baselines/13th-gen-intel-r-core-tm-i7-13700.json`) found the drag at the fitted view, the
far level, at a frame, and the edit gesture there at a p95 of 116.7 ms, about seven frames; at the
near and the middle level the edit held a frame. A profile of it in the Dev Container found every
edit frame querying the whole far view anew and uploading 15.9 MB, 9.4 MB of it the edge mesh, for
one node or edge added or removed: the query and its mesh, the WebAssembly ADR-0027 measured at
about 25 ms a frame for the drag, and the uploads.

The scene keeps a query only while the store's `nodes` and `edges` stay the arrays it drew and
`positionsVersion` the counter it drew (`covers` of `packages/comb/src/render/scene.ts`, ADR-0012).
An edit replaces an array, an added node also increments `positionsVersion` (ADR-0011), and
ADR-0027 has a change of the graph during a drag query anew. The store replaces the object in a
slot on an edit that adds or removes, on a change of a node's content or an edge's style or label,
and when the engine reuses a freed slot (ADR-0023). PixiJS uploads a sub-range of a buffer
(`Buffer.update(sizeInBytes, offsetInBytes)`); its `ParticleContainer` uploads every particle when
a property marked static changes, and `packages/comb/src/render/particles.ts` marks every property
static so that a pan uploads none.

This ADR restates ADR-0027 with edits at the far level, and supersedes it, together with
ADR-0011, which restates ADR-0011.

## Decision

We will have the scene keep its query while a drag moves nodes, and at the far level while edits
add or remove a few slots, drawing in a moving layer what they move or add, and hiding in what the
query drew what they move or remove, and query anew at the release, past those few slots, or as
ADR-0012 says.

- **A drag's signal:** at its first move, interaction writes the slots it drags into the store's
  `dragged`, and clears them at the release; each pointer move increments `movesVersion`, which a
  kept query survives, and the release increments `positionsVersion` (ADR-0011).
- **An edit, as the scene sees it:** the slots in which the store's `nodes` and `edges` differ from
  the arrays of the query it keeps, compared slot by slot when either array is a new one since the
  last render, so that several edits within a frame count as the slots they changed. A slot empty
  in the kept query and filled now is added; one filled then and empty now is removed; one filled
  in both by another object, a change of content, style, or label or a slot reused, queries anew.
  An added node increments no counter (ADR-0011).
- **Which edits keep the query:** at the far level, at most 256 changed slots since the query, a
  bound on what the moving layer draws each frame and on the comparison; more, an edit at the near
  or the middle level, a load, an edit that clears the selection, and a removal that ends a drag
  query anew.
- **What is hidden:** in what the query drew, the dragged nodes' edges and the removed edges by
  their ranges of the edge mesh, uploading the one span of indices that covers them; and at the far
  level the dragged and the removed nodes' particles, which uploads every particle once each time
  that set grows.
- **The moving layer, each render while the query is kept:** the engine meshes every edge at the
  dragged nodes and every added edge, each once, as the query meshes an edge, in its rectangle, at
  its level, relative to its origin, within the mesh budget; the mesh is made anew when the drag
  moves or the arrays change, and kept otherwise. At the far level the moving layer draws the
  dragged nodes' particles and above them the added ones, which hold the newest ranks, in slot
  order, their ranks' but where an edit reused a slot freed since the query. At the near and the
  middle level a dragged node's view stays where the kept query bound it, keeping its rank
  (ADR-0023), and moves to the node's position, and the labels of the dragged nodes' edges move to
  their points (G-6).
- **Layers:** the moving edges directly above `edges`, the moving particles directly above
  `particles` (ADR-0012); a dragged particle drawn above the nodes it passes is the one departure
  from the order of ranks, until the next query.
- **Inspection:** `draws`, `isDrawn`, and `inspect()` report the moving layer's nodes and edges as
  drawn and the hidden ones as not, against the store's arrays, not the query's; the moving mesh's
  detail joins the query's.

**Out of scope:** a label drag, which moves a label and increments `positionsVersion`; the hit
test, which reads the engine's positions and so finds a node where it is drawn; the zoom at the far
level (ticket 18 of revision-2026-10-18).

## Alternatives considered

- **The engine patches the kept mesh** — the edges an edit touched re-meshed in place and their
  ranges uploaded; exact, with no second path, but a range with no room for an edge that grew needs
  spare room or a reallocation, the cost the moving layer avoids.
- **Edits coalesced in a window** — several edits share one query; cheap to build, but one edit a
  frame still pays the whole query, about 25 ms and 15.9 MB, once a window, and keeps missing Q-1.
- **Every level** — the moving layer would bind views for added nodes at the near and the middle
  level, a second binding of node content for no frame those levels miss.
- **The store's last change as the signal** — the store names the change it recorded, but several
  edits within a frame leave only the last visible to the render that follows.
- **Dynamic particle colours** — a removed node's particle hidden by its colour alone, but a
  dynamic property uploads every frame, every pan among them.
- From ADR-0027, for a drag: ranges updated in place with room to spare; the moving layer kept past
  the release; the engine recording the moves; querying less often, which G-2 refuses; an overlay
  without hiding, which leaves the old edges drawn.

## Sources / Prior art

- The measurements and profiles of ticket 07 of revision-2026-10-31 and ticket 17 of
  revision-2026-10-18, and `bench/baselines/13th-gen-intel-r-core-tm-i7-13700.json`.
- ADR-0027, which this restates.
- PixiJS v8, `Buffer.update(sizeInBytes, offsetInBytes)` and `ParticleBuffer.update`, in
  `node_modules/pixi.js` 8.22.0 (read 2026-11-01).

## Consequences

- Positive: a drag frame, and an edit frame at the far level that adds or removes an edge, upload
  and compute in the size of what they changed, which is what Q-1 asks at 50,000 nodes.
- Negative / trade-offs: an edit that removes a node the query drew uploads every particle once, in
  the size of the far view, about 6.3 MB at the fitted view; the benchmark's gesture removes only
  nodes it added, which the moving layer drew.
- Negative / trade-offs: the moving layer grows with the edits until the next query, up to 256
  slots, and a second drawing path draws a node and its edges as the kept level does.
- Negative / trade-offs: a comparison of about 100,000 slots each time an array changes while a
  query is kept.
- Follow-ups: whether the near and the middle level take the edits' path once they need it.

## Enforcement

Browser tests of the example, citing `Verifies: ADR-0027`:

- a drag of a node with one edge at 15 and at 50,010 nodes uploads per frame bytes that do not grow
  with the graph, beyond its first frame, every edge at the node follows it in each frame (G-2),
  and the release queries once;
- at the fitted view at 15 and at 50,010 nodes, an edit a frame that adds a node, adds an edge to
  it, removes an edge the query drew, and removes the added node queries in no frame and uploads
  per frame bytes that do not grow with the graph; each added node and edge is drawn and each
  removed one is not, as `isDrawn` and `inspect()` report; 257 slots changed at once query anew,
  and so does a removal of a dragged node.

`examples/metric-tree/e2e/remove.spec.ts` keeps deciding that `isDrawn` answers as `inspect()` does
at the far level before and after a removal. A Rust test of the engine asserts that the mesh of
given node and edge slots holds the edges at those nodes and those edges, each once, and no other.
