# Ticket: The baseline of the runner's kind holds the edit gesture

## What to build

The benchmark times edits at 50,000 nodes (ADR-0022), and `bench/compare.ts` judges that gesture
only against a baseline that holds it. The one baseline, `bench/baselines/
amd-epyc-7763-64-core-processor.json`, holds the load, the drag, the pan, the zoom, and the pans
at the near and middle level, but no edit, so every run reports the edits without a verdict: a
change that turned each edit into a load would pass the **Benchmark** workflow. A kind's baseline
is the median of three runs on a GitHub runner of that kind on `main`
([architecture](../../ARCHITECTURE.md), *Benchmark*).

Run the **Benchmark** workflow on `main` and take the median of its three runs into the baseline,
the edit gesture with it, as the baseline was made before.

## Acceptance criteria

- [ ] Given the baseline of the runner's kind, when it is read, then it holds the edit gesture, the
      median of three runs on that kind on `main`.
- [ ] Given a run of the **Benchmark** workflow after it, when it compares, then it judges the edit
      gesture against the baseline with the margin of 25 %.
- [ ] Given `bun test bench/`, when it runs, then it passes.

## Read first

- ADR-0008 (*Benchmark*), ADR-0022; `bench/compare.ts`, `bench/baselines/`,
  `.github/workflows/benchmark.yml`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the workflow runs on GitHub, which a human starts, and the baseline is what every
later run is held to.
