# Ticket: The edits at the fitted view begin at the fitted view

## What to build

The benchmark times the edits at the fitted view at the view the example opens with. Today the
zoom at the fitted view zooms in for the first half of its steps and out for the second, and on
every CI runner it runs out of its action budget before the second half: the baselines hold 57
steps of 120 on the AMD EPYC 7763, 69 on the 9V74, and 74 on the 9V45. The edits that follow
begin wherever the zoom stopped, at the middle level on the 7763 and at far on the 9V74, and an
edit at the fitted view costs about twice one zoomed in. A change in how many zoom steps fit
moves the edits' p95 by up to a factor of two without a change in what an edit costs.

The **Benchmark** workflow on 2c11a58, against the baselines without content, found past 25 %:

| Runner kind | Gesture | Baseline (ms) | Run (ms) | Change |
|---|---|---|---|---|
| AMD EPYC 7763 (run 41193148167) | first frame | 378.6 | 489.8 | +29 % |
| AMD EPYC 7763 | drag p95 | 250.0 | 316.6 | +27 % |
| AMD EPYC 9V74 (run 41193154217) | edit p95 | 66.7 | 116.7 | +75 % |

The first frame is the ticket
docs/plan/node-content/10-the-writer-sizes-its-columns-from-the-content.md.
A local profile against 9a27df1, before the content, found the drag and the edits at the fitted
view 9 to 14 % slower in their mean frame, and none of it in JavaScript or WebAssembly: the far
level draws no node view, and the time is the GPU process executing the WebGL commands on
SwiftShader. It found no single cause. What it found per frame of a drag at the fitted view,
present before the content as well: PixiJS hit-tests the edge mesh on every pointer move,
9 to 11 ms (`Mesh.containsPoint`), and every frame uploads the whole edge mesh, 9.4 MB, and all
particles, 6.4 MB, since the scene's cover fails on the moved positions
(`packages/comb/src/render/scene.ts`, `covers` and `query`). A drag's p95 is the second worst of
about 38 frames, since the drag too runs out of its budget.

## Acceptance criteria

- [ ] Given the zoom at the fitted view cut short by its action budget, when the edits at the
      fitted view begin, then the viewport is the fitted view's, its scale and position, and the
      result records the scale the edits ran at.
- [ ] Given this ticket and ticket 10 merged on `main`, when the **Benchmark** workflow runs on each
      runner kind with a baseline, then a number past 25 % of its baseline is decided with the
      human, and the maintainer records each kind's baseline with the content from a run on
      `main`.

## Read first

- ADR-0008 (*Benchmark*, *Runner kind and baselines*, the shape of a gesture), ADR-0027;
  `bench/run.ts` (`steps`, `zoom`, `zoomGesture`, `editGesture`, `atEveryLevel`), the README's
  **Benchmark**.

## Blocked by

- docs/plan/node-content/10-the-writer-sizes-its-columns-from-the-content.md

## Mode

with the human: what the edits at the fitted view time is the shape of a gesture ADR-0008 weighs,
a new baseline is the maintainer's to record, and a number past the budget is a decision on Q-1
and the levels' thresholds (ADR-0027).
