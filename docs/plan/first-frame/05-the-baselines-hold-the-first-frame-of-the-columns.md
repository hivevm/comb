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

The comparison step of `.github/workflows/benchmark.yml` then carries the marker ADR-0034's
*Enforcement* names, `Verifies: ADR-0034, ADR-0008`. It cites no Q-2: Q-2 is defined on the
reference machine, and
`docs/plan/revision-2026-10-18/16-measure-q1-q2-on-the-reference-machine.md` keeps that marker.

## Acceptance criteria

- [x] Given a Benchmark run on `main` after
      `docs/plan/first-frame/04-a-load-hands-its-edges-over-as-columns.md` landed, on a 7763,
      when it compares against its unchanged baseline, then the comparison passes and the median
      first frame lies at least 90 ms below the 480 ms of `main` before this plan; a run that
      misses it fails this criterion and is not repeated in the hope of a pass; the
      maintainer decides what follows.
- [ ] Given a Benchmark run on `main` on a 9V74, when its `median.json` is saved as
      `bench/baselines/amd-epyc-9v74-80-core-processor.json`, then its first frame is below the
      365.3 ms it replaces, and the pull request links the run and says why.
- [x] Given `.github/workflows/benchmark.yml`, when it is searched with
      `grep -n 'Verifies: ADR-0034, ADR-0008' .github/workflows/benchmark.yml`, then the one line
      found is a comment of the comparison step; and `scripts/check-traceability.sh` passes.

## Where it stands

- The 7763: Benchmark run 41066540404 on `main` at `d35bb17` compares against its unchanged
  baseline and passes; its median first frame is 387.3 ms against 378.6 (+2 %), 92.7 ms below
  480. No exemption or moved baseline was found to undo.
- The marker sits on the comparison step of `.github/workflows/benchmark.yml`.
- Open: a Benchmark run on `main` that lands on a 9V74, and its `median.json` as that kind's
  baseline.

## Read first

- `docs/plan/first-frame/spec.md`.
- ADR-0008 (*Benchmark*), ADR-0034 (*Enforcement*), `docs/SPECIFICATION.md` Q-2.
- `README.md` (**Benchmark**), `bench/compare.ts`, `.github/workflows/benchmark.yml`.

## Blocked by

- docs/plan/first-frame/04-a-load-hands-its-edges-over-as-columns.md

## Mode

with the human: only the maintainer runs the Benchmark workflow and records a baseline, and
`.github/` is a protected part of ADR-0007.
