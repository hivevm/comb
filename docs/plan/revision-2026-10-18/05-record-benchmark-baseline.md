# Ticket: Record the benchmark's baseline

## What to build

The **Benchmark** workflow compares the median of three runs with `bench/baseline.json`, and
without one "says so and passes". No baseline is recorded, so the weekly run catches no
regression yet. The maintainer starts the workflow on `main`, takes `median.json` from its
artefact, and lands it as `bench/baseline.json` in a pull request that says it is the first.
The baseline recorded during ticket 01 is unusable: it was taken on PixiJS's Canvas 2D fallback.

## Acceptance criteria

- [ ] Given a run of the workflow on `main`, when its artefact is downloaded, then `median.json`
      names a SwiftShader GPU; the benchmark refuses any renderer but WebGL.
- [ ] Given `bench/baseline.json` on `main`, when the workflow runs again, then it compares every
      number and passes, and the pull request that added it reports the three runs' spread.

## Read first

- ADR-0008 (*Benchmark*), `README.md` (**Benchmark**), `bench/compare.ts`,
  `.github/workflows/benchmark.yml`.

## Blocked by

- docs/plan/revision-2026-10-18/06-baseline-names-its-gpu.md

## Mode

with the human: only the maintainer starts a workflow on GitHub and decides what leaves the
machine
([`AGENTS.md` §6](../../../AGENTS.md#6-project-rules)).
