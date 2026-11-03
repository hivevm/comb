# Ticket: The edit gesture's check stays out of the frames it times

## What to build

The benchmark's edit gesture checks that each edit shows, and it does so inside the frames it
times for Q-1. `benchEdit(i)` of `bench/run.ts` (installed around line 180) first asks
`window.isDrawn` whether edit `i - 1` shows, then makes edit `i`. `editGesture` calls it inside
`frameTimes`.

For an edge, `isDrawn` goes through `Scene.draws` of `packages/comb/src/render/scene.ts`. That
calls `bridge.drawnEdges()`, which copies, sorts, and deduplicates every drawn edge and computes
its ends (`drawn_edges` of `crates/engine-wasm/src/lib.rs`). Then a `findIndex` runs over the
store's edges. At the fitted view at 50,010 nodes that is the whole far view, every other frame,
in the measurement it disturbs. The scene already holds both sets it reads: the query's found
edges and the moving layer's slots.

Measure first what the check costs in a timed edit frame. Then either take the check out of the
timed frames, for example by recording what each edit made and checking it after `frameTimes`
returns, or have the scene answer whether one edge is drawn from the sets it holds, without the
engine's copy. Inspection, `inspect()`, keeps reading the engine.

## Acceptance criteria

- [ ] Given the edit gesture at the fitted view at 50,010 nodes, when it is timed, then no
      `drawnEdges()` call and no scan of every edge runs within `frameTimes`, or the pull request
      shows by a profile that what remains costs under 0.5 ms a frame.
- [ ] Given `examples/metric-tree/e2e/remove.spec.ts` and the edit test of
      `examples/metric-tree/e2e/work-per-frame.spec.ts`, when they run, then `isDrawn` still
      answers as `inspect()` does.
- [ ] Given a run of the benchmark on the maintainer's machine, when the edit's p95 moves, then
      the pull request reports by how much, beside
      `bench/baselines/13th-gen-intel-r-core-tm-i7-13700.json`.

## Read first

- ADR-0027 (*Inspection*), ADR-0028, the conventions *A number says where it was taken* and
  *Work that should not happen is pinned by a count, never by a time*.
- `bench/run.ts` (`benchEdit`, `editGesture`, `frameTimes`), `packages/comb/src/render/scene.ts`
  (`draws`, `edgeDrawn`).

## Blocked by

- None (can start immediately)

## Mode

with the human: the measurement on the maintainer's machine stands in for the reference machine
(Q-1), and only the human runs it.
