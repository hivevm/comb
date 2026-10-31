# Ticket: The edits at the fitted view begin at the fitted view

## What to build

The benchmark times the edits at the fitted view at the view the example opens with. The zoom
at the fitted view zooms in for the first half of its steps and out for the second, and on every
CI runner it runs out of its action budget before the second half: the baselines hold 57 steps of
120 on the AMD EPYC 7763, 69 on the 9V74, 74 on the 9V45, 49 on the Xeon 6975P-C, and 36 on the
Xeon Platinum 8573C. The edits that follow begin wherever the cut-short zoom stopped, which
depends on the runner.

The **Benchmark** workflow on 2c11a58, against the baselines without content, found past 25 %:

| Runner kind | Gesture | Baseline (ms) | Run (ms) | Change |
|---|---|---|---|---|
| AMD EPYC 7763 (run 41193148167) | first frame | 378.6 | 489.8 | +29 % |
| AMD EPYC 7763 | drag p95 | 250.0 | 316.6 | +27 % |
| AMD EPYC 9V74 (run 41193154217) | edit p95 | 66.7 | 116.7 | +75 % |

The zoom steps and the edits of those runs:

| Runner kind | Zoom steps (baseline) | Edit steps | Edit p95 (ms) | Baseline edit p95 (ms) |
|---|---|---|---|---|
| AMD EPYC 7763 | 54, 54, 55 (57) | 105, 101, 106, truncated | 150 to 166.7 | 150 |
| AMD EPYC 9V74 | 67, 68, 67 (69) | 120, not truncated | 116.7 (p50 100) | 66.7 |

The edits began at nearly the scale of the baselines' edits. On the 9V74 the whole distribution
moved, its p50 of 100 ms past the baseline's p95 of 66.7 ms, at nearly the same zoom, so the cause
of its edit p95 is open; criterion 2 decides it with the human.

The first frame's growth is the content's columns: a local profile against 9a27df1 found
`snapshotOf` 32 ms longer, of which the bridge's node writer copying its columns as they grow is
at most 3 to 5 ms. Sizing them beforehand would read the host's content twice, which ADR-0028
rules out, so the first frame's cost is the content's and its baseline records it.

The same profile found the drag and the edits at the fitted view 9 to 14 % slower in their mean
frame, and none of it in JavaScript or WebAssembly: the far level draws no node view, and the time
is the GPU process executing the WebGL commands on SwiftShader. It found no single cause. What it
found per frame of a drag at the fitted view, present before the content as well: PixiJS hit-tests
the edge mesh on every pointer move, 9 to 11 ms (`Mesh.containsPoint`), and every frame uploads the
whole edge mesh, 9.4 MB, and all particles, 6.4 MB, since the scene's cover fails on the moved
positions (`packages/comb/src/render/scene.ts`, `covers` and `query`). A drag's p95 is the second
worst of about 38 frames, since the drag too runs out of its budget.

## Acceptance criteria

- [x] Given the zoom at the fitted view cut short by its action budget, when the edits at the
      fitted view begin, then the viewport is the fitted view's, its scale and position, and the
      result records the scale the edits ran at.
- [ ] Given this ticket merged on `main`, when the **Benchmark** workflow runs on each runner
      kind with a baseline, then a number past 25 % of its baseline is decided with the
      human, and the maintainer records each kind's baseline with the content from a run on
      `main`.

## Where it stands

- Criterion 1 holds: `bench/fitted.ts` shows the fitted view, its scale and position, before the
  edits at the fitted view, and the run records the scale they ran at as `edit.scale`;
  `bench/fitted.test.ts` decides it with the zoom cut short. The edits at each level already
  begin at the level's scale (`restAtLevel`).
- The edits at the fitted view now run at the fitted scale, which draws far, and no longer where
  the cut-short zoom stopped: 57, 69, 74, 49, and 36 of 120 zoom steps in the committed baselines
  of the 7763, 9V74, 9V45, Xeon 6975P-C, and Xeon Platinum 8573C, at about 1.062 times the scale
  a step. Against those baselines their p95 measures another view; it is read against the new
  baselines of criterion 2. A local profile measured an edit at the fitted view at 135 to 154 ms
  mean frame, against 60 to 80 ms zoomed in at far.
- The median and a baseline keep no `edit.scale`.
- Open: criterion 2, the **Benchmark** workflow's runs on `main` on each runner kind and the
  maintainer's baselines with the content.

## Read first

- ADR-0008 (*Benchmark*, *Runner kind and baselines*, the shape of a gesture), ADR-0027;
  `bench/run.ts` (`steps`, `zoom`, `zoomGesture`, `editGesture`, `atEveryLevel`), the README's
  **Benchmark**.

## Blocked by

- None (can start immediately)

## Mode

with the human: what the edits at the fitted view time is the shape of a gesture ADR-0008 weighs,
a new baseline is the maintainer's to record, and a number past the budget is a decision on Q-1
and the levels' thresholds (ADR-0027).
