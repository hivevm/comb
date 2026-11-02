# Ticket: An edit at the fitted view redraws what it changed, not the graph

## What to build

The measurement of ticket 16 on the maintainer's machine (Intel UHD Graphics 770, Intel Core
i7-13700 slowed two times, Chrome 156 on the host, 50,010 nodes, commit fb791e79) found the edit
gesture at the fitted view, the far level, at a p95 of 116.7 ms, median of three runs (83.4, 133.3,
116.7), against Q-1's 16.7 ms: about seven frames. Every other gesture at the near and the middle
level, and the drag and the pan at the fitted view, held one frame.

A profile of the same gesture in the Dev Container (`work()` of `comb/testing`, headless Chromium,
the production build) found every edit frame querying the engine anew and uploading 15.9 MB, 9.4 MB
of it the edge mesh, for one node added or removed: an addition or a removal changes the store's
nodes and `positionsVersion`, which no kept query survives (`covers` of
`packages/comb/src/render/scene.ts`, ADR-0037). It is the shape ADR-0036 removed from a drag, and
ADR-0036 names an edit of one node as its follow-up.

How an edit redraws is a decision on the scene's culling and binding (ADR-0027, ADR-0036) and on
the store's signals (ADR-0037), for the maintainer: an added node and its edges drawn in a layer
of their own until the next query, a removed one hidden in the kept query, or the engine's mesh
updated in the ranges an edit touched. This ticket is the profile at the reference's class and the
proposal, before any code: a `proposed` ADR where the choice binds the scene.

## Acceptance criteria

- [ ] Given an edit a frame at the fitted view at 50,010 nodes, when it is profiled, then the
      profile says per frame what is uploaded and what the engine recomputes, and the alternatives
      above are weighed against Q-1 with their cost.
- [ ] Given the maintainer's choice, when it is implemented, then a browser test asserts by
      `work()` of `comb/testing` that the bytes an edit frame uploads do not grow with the graph,
      and the benchmark's edit at the fitted view holds Q-1 on the maintainer's machine.

## Read first

- ADR-0027, ADR-0036, ADR-0037, ADR-0022; `packages/comb/src/render/scene.ts` (`covers`, `drag`,
  `query`); `bench/run.ts` (`installEdits`).
- `bench/baselines/13th-gen-intel-r-core-tm-i7-13700.json`, the median of the measurement the
  numbers above come from.

## Blocked by

- None (can start immediately)

## Mode

with the human: the choice binds the scene's culling and binding (ADR-0027, ADR-0036) and is the
maintainer's.
