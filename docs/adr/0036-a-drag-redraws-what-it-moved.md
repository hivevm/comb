# ADR-0036: A drag redraws what it moved, in a layer of its own, and the release queries once

- **Status:** ⚪ superseded by [ADR-0040](0040-a-drag-or-an-edit-redraws-what-it-changed.md)
- **Date:** 2026-11-01
- **Deciders:** Markus Brigl
- **Applies to:** the scene's culling and binding in `packages/comb/src/render/`, the edge mesh and the query of `crates/engine` and `crates/engine-wasm`, the store's signals of a move in `packages/comb/src/store/`, and the node drag of `packages/comb/src/interaction/`

## Context

Q-1 asks a drag of a node at 50,000 nodes and 50,000 edges to hold a p95 frame time of 16.7 ms
on the reference machine, and G-2 asks every edge at the dragged node to follow it in the same
frame. ADR-0029 has a drag write the node's position into the engine's buffer and increment
`positionsVersion` once per pointer move; ADR-0027 has the scene query the engine anew whenever
the graph changed, the positions counter among it, and bind its views, its particles, and one
edge mesh to what the query found.

So every frame of a drag queries the engine and uploads the whole of what it draws. A profile of a
drag at the fitted view at 50,010 nodes, the far level (ticket 07 of revision-2026-10-31), found
15.5 MB uploaded a frame, the edge mesh's 9.2 MB and about 6.3 MB of particles, and about 25 ms of
WebAssembly for the query and the mesh, though one node and one edge moved; a pan within the
margin, which moves the world alone, uploads 0.26 MB. The particles' container takes no dynamic
property, so a change of one particle uploads all of them. The drag at the fitted view is the
gesture of the AMD EPYC 7763 that passed its baseline by 27 %.

A re-meshed edge rarely keeps its vertex count: its length, its splits at the query's rectangle,
and its chords change as its node moves, so a range of the one mesh cannot take it in place
without room to spare.

## Decision

We will draw the nodes a drag moves and every edge at them in a moving layer of their own for as
long as the drag lasts, redrawn from the engine each frame, while the scene keeps the query it
drew at the press, with those nodes and edges hidden in it, and query once at the release.

- **The signal:** at the press, interaction writes the slots it drags into the store, and clears
  them at the release; each pointer move increments a counter of moves, `movesVersion`, which a
  kept query survives, instead of `positionsVersion`. `positionsVersion` keeps meaning a change of
  positions the query does not survive: a load, an added node, a move of a node no drag holds.
- **The press:** the scene hides the dragged nodes' particles and the dragged nodes' edges in
  what it keeps, once: their ranges of the edge mesh collapsed to no area, a partial upload, and
  their particles hidden.
- **Each frame of the drag:** the engine meshes every edge at the dragged slots, the query's or
  not, as the query meshes an edge, at the scale and within the rectangle of the kept query, into
  a mesh of their own, which the moving layer uploads whole. A dragged node keeps its rank, which
  a drag does not change (ADR-0022): at the near and the middle level its view stays where the
  kept query bound it and moves to the node's position, and at the far level the moving layer
  draws its particle. The labels of the dragged nodes' edges the kept query bound move to their
  edges' points each frame (G-6). A frame costs what the dragged nodes and their edges cost, not
  what the graph does.
- **Layers:** the moving edges directly above `edges`, the moving particles directly above
  `particles` (ADR-0027); a particle one pixel wide drawn above the nodes it passes is the one
  departure from the order of ranks, until the release.
- **The release, and anything else:** the release clears the dragged slots and queries as today.
  A change of the graph, of the selection, of the level, or a viewport past the kept rectangle
  during a drag queries as today too, with the dragged nodes and edges hidden in the new query and
  the moving layer kept.
- **The mesh budget** (ADR-0027) bounds the moving mesh as it bounds a query's, its edges in slot
  order; its detail joins the query's in what inspection reports.

**Out of scope:** a label drag, which moves a label and also increments `positionsVersion`; the
hit test, which reads the engine's positions and so finds a dragged node where it is drawn.

## Alternatives considered

- **Update in place, room to spare** — each edge's range of the one mesh keeps spare vertices and
  a frame overwrites it; the mesh grows for every edge, and an edge that outgrows its room brings
  back the full upload it was to avoid.
- **Keep the moving layer past the release** — merged into the kept query, no upload at the
  release; but the main mesh then holds what no query computed, its coarsening detail and its
  culling inexact until the next query.
- **The engine reports the moves** — it records the slots `translate` moved since the last query
  and the scene asks each frame; the store stays as it is, but the engine keeps state of the
  shell's rendering.
- **Query less often** — every few frames, or past a distance; the dragged node lags the pointer,
  which G-2 does not allow.
- **Overlay without hiding** — draw the moved node and edges on top and leave the old ones in the
  kept query; the old edges stay visible where the node was.

## Sources / Prior art

- The profile of ticket 07 of revision-2026-10-31 (`docs/plan/`), taken 2026-11-01 with `work()`
  of `comb/testing` and the CPU profile of the page.
- PixiJS v8's `ParticleContainer` uploads a property marked static whole when it updates,
  `packages/comb/src/render/particles.ts` marks every property static.

## Consequences

- Positive: a drag frame uploads and computes in the size of the dragged node's edges, which is
  what Q-1 asks of a gesture at 50,000 nodes; the press and the release cost one partial and one
  full upload.
- Positive: a node drag no longer queries, so a pan or a zoom that follows it starts from a query
  the drag did not invalidate frame by frame.
- Negative / trade-offs: a second drawing path for a node and its edges, which must draw them as
  the kept level does, and a counter more in the store that ADR-0029 did not have.
- Negative / trade-offs: the mesh must name each edge's range, which the engine's mesh does not
  return today.
- Follow-ups: whether a label drag takes the same path; whether an edit of one node (ADR-0022)
  could keep a query the same way.

## Enforcement

A browser test of the example, citing `Verifies: ADR-0036`, drags a node with one edge at 15
nodes and at 50,010 nodes and asserts, by `work()` of `comb/testing` across the frames of the drag,
that the bytes uploaded per frame do not grow with the graph, beyond the press and the release;
that every edge at the node follows it in each frame (G-2); and that the release queries once. A
Rust test of the engine asserts that the moving mesh of a slot holds every edge at it, found by
the query or not, and no other.
