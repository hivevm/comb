# Ticket: A drag frame uploads what it moved

## What to build

A drag of a node changes the positions counter of the store (ADR-0029), so the scene's `covers`
(`packages/comb/src/render/scene.ts:208`) fails on every frame of a drag and the frame queries the
engine anew: it re-meshes and uploads the whole edge mesh and every particle, though one node and
its edges moved. The profile of a drag at the fitted view at 50,010 nodes taken for ticket 11 of
the node-content plan (`git show 799f006^`, *What to build*) found every frame uploading the edge
mesh, 9.4 MB, and all particles, 6.4 MB, the time spent in the GPU process; the drag at the fitted
view is the gesture of the AMD EPYC 7763 that passed its old baseline by 27 %, and its p95 is the
second worst of about 38 frames. The same holds before the content.

How a drag redraws is a decision on the scene's culling and binding (ADR-0027) and on the
counter's meaning (ADR-0029): a drag might update only the moved node's particle and the moved
edges' part of the mesh, or the scene might keep its query and move the dragged node's view and
edges in an overlay until the release. This ticket is the profile and the proposal, for the
maintainer to decide, before any code: a `proposed` ADR if the choice binds the scene.

## What the profile found

A drag of the node nearest the centre of the fitted view, 60 steps, at 3,334 copies (50,010 nodes,
the far level, scale 0.0134), against the production build in headless Chromium, profiled
2026-11-01 (`work()` of `comb/testing` and the CPU profile of the page):

| per rendered frame | drag (one edge at the node) | pan within the margin |
| --- | --- | --- |
| bytes uploaded | 15.5 MB | 0.26 MB |
| of it, the edge mesh | 9.2 MB | 0.15 MB |
| views created, textures, allocations | 0 | 0 |

Every drag frame queries the engine anew and uploads the whole edge mesh and every particle,
about 6.3 MB of particles beside the mesh, though one node and one edge moved; the engine's part
of a frame, the query and the mesh, is about 25 ms of WebAssembly. The pan within the margin moves
the world alone. Frame times on software WebGL (p50 117 ms for both) are raster-bound and say
nothing about Q-1 on the reference machine (ticket 16 of revision-2026-10-18).

The ways a drag could redraw, each weighed against Q-1:

- **Update in place:** the scene keeps its query through a drag; the engine re-meshes only the
  edges at the dragged nodes and names their ranges in the mesh, and the scene uploads those ranges
  and the dragged nodes' particles. A frame costs what the dragged nodes' edges cost, a release
  nothing more. It needs the mesh addressable by edge, and the positions counter of ADR-0029 split
  into a move the query survives and a change of the graph it does not; it binds ADR-0027's
  binding of views to a query.
- **Overlay until the release:** the scene keeps its query, hides the dragged nodes and their
  edges in it once at the press, and draws them in a layer of their own each frame; the release
  queries once. A frame costs the overlay alone, the press and the release one partial and one
  full upload. It needs the same ranges to hide, and a second path that draws a node and its edges.
- **Query less often:** re-query only every few frames, or past a distance. It costs nothing to
  build, but the dragged node lags the pointer, which G-2 does not allow: every edge at a dragged
  node follows it in the same frame.

## Acceptance criteria

- [ ] Given a drag at the fitted view at 50,010 nodes, when it is profiled, then the profile says
      per frame what is uploaded and what the engine recomputes, and the alternatives above are
      weighed against Q-1 with their cost.
- [ ] Given the maintainer's choice, when it is implemented, then `work()` of `comb/testing`
      counts the bytes uploaded across the frames of a drag, and a browser test asserts that they
      scale with the edges at the dragged node, not with the graph.

## Read first

- ADR-0027, ADR-0029, ADR-0008 (*Benchmark*); `packages/comb/src/render/scene.ts` (`covers`,
  `query`), `packages/comb/src/render/edges.ts`, `packages/comb/src/render/particles.ts`;
  docs/plan/revision-2026-10-18/16-measure-q1-q2-on-the-reference-machine.md.

## Blocked by

- None (can start immediately)

## Mode

with the human: the choice binds the scene's culling and binding (ADR-0027) and is the
maintainer's.
