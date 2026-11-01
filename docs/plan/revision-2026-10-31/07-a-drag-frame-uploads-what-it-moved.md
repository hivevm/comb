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
