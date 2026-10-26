# Ticket: The 9V74's baseline is retaken, and the 7763 judges the first frame against its own again

## What to build

The baseline of the AMD EPYC 9V74, `bench/baselines/amd-epyc-9v74-80-core-processor.json`, was
taken while a load converted every field through serde-wasm-bindgen, so it holds the slower first
frame (365.3 ms) and lets a load grow that slow again unnoticed on that kind. Once a load crosses
as columns, the maintainer retakes it: the median of a Benchmark run on `main` on a 9V74, saved as
the README's **Benchmark** section describes, in a pull request that says why.

The baseline of the AMD EPYC 7763, `bench/baselines/amd-epyc-7763-64-core-processor.json`, holds
the first frame of before (378.6 ms) and stays as it is. The first frame on that kind is judged
against it again and passes: should its first frame have been exempted, or its baseline moved,
while the load was slow, this ticket undoes that.

The comparison step of `.github/workflows/benchmark.yml` then carries the marker ADR-0032's
*Enforcement* names, `Verifies: ADR-0032, Q-2`.

## Acceptance criteria

- [ ] Given a Benchmark run on `main` after
      `docs/plan/first-frame/04-a-load-hands-its-edges-over-as-columns.md` landed, on a 7763,
      when it compares, then the median first frame is at most 378.6 ms, its baseline unchanged,
      and the comparison passes.
- [ ] Given a Benchmark run on `main` on a 9V74, when its `median.json` is saved as
      `bench/baselines/amd-epyc-9v74-80-core-processor.json`, then its first frame is below the
      365.3 ms it replaces, and the pull request links the run and says why.
- [ ] Given `.github/workflows/benchmark.yml`, when `scripts/check-traceability.sh` runs, then the
      comparison step cites `Verifies: ADR-0032, Q-2`.

## Read first

- ADR-0008 (*Benchmark*), ADR-0032 (*Enforcement*), `docs/SPECIFICATION.md` Q-2.
- `README.md` (**Benchmark**), `bench/compare.ts`, `.github/workflows/benchmark.yml`.

## Blocked by

- docs/plan/first-frame/04-a-load-hands-its-edges-over-as-columns.md

## Mode

with the human: only the maintainer runs the Benchmark workflow and records a baseline, and
`.github/` is a protected part of ADR-0007.
