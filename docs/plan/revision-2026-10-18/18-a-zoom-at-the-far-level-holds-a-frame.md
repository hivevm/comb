# Ticket: A zoom at the far level holds a frame

## What to build

The measurement of ticket 16 on the maintainer's machine (Intel UHD Graphics 770, Intel Core
i7-13700 slowed two times, Chrome 156 on the host, 50,010 nodes, commit fb791e79) found the zoom
at the far level at a p95 of 66.7 ms (50.1, 66.7, 67.1) and the zoom from the fitted view across
every level at 50.0 ms (50.0, 83.3, 50.0), medians of three runs, against Q-1's 16.7 ms: three to
four frames. The zooms at the near and the middle level held one frame.

A profile of a zoom of 2 % a step at the fitted view in the Dev Container (`work()` of
`comb/testing`, headless Chromium, the production build) found one frame in ten querying the engine
anew, uploading about 11 MB each, the edge mesh and every particle, and the others moving the world
alone: a scale more than `RESCALE` (1.25) from the one the scene queried at fails `covers` of
`packages/comb/src/render/scene.ts`, as ADR-0027 decides, so that a mesh flattened within a quarter
pixel strays at most 0.31 px (Q-4). Those frames make the p95.

At the far level every edge is a plain line one pixel wide (ADR-0027), so its mesh changes with the
scale only by the width of its lines in world units; a shader that widens the lines by the scale
might keep a far query across any zoom within the level, as might a query spread over frames, or a
narrower `RESCALE` with a smaller mesh. Which, if any, is a decision on the levels of detail
(ADR-0027) for the maintainer, with a profile on the maintainer's machine first.

## Acceptance criteria

- [ ] Given a zoom at the far level at 50,010 nodes, when it is profiled on the maintainer's
      machine, then the profile says per frame what is queried, uploaded, and drawn, and the
      alternatives above are weighed against Q-1 and Q-4 with their cost.
- [ ] Given the maintainer's choice, when it is implemented, then the benchmark's zoom at the far
      level and from the fitted view hold Q-1 on the maintainer's machine, and the browser tests of
      Q-4 pass.

## Read first

- ADR-0027 (*Levels of detail*, *Culling*), ADR-0034; `packages/comb/src/render/scene.ts`
  (`covers`, `RESCALE`), `packages/comb/src/render/edges.ts`.
- `bench/baselines/13th-gen-intel-r-core-tm-i7-13700.json`, the median of the measurement the
  numbers above come from.

## Blocked by

- None (can start immediately)

## Mode

with the human: the choice binds the levels of detail (ADR-0027) and is the maintainer's.
