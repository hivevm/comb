# Ticket: Each benchmark run is compared with the baseline of its runner kind

## What to build

ADR-0008 (*Benchmark*) compares the median of a workflow's three runs with the baseline of the
runner's kind, the CPU model the run records, and refuses a run on a kind without a baseline,
naming the kind. Today `bench/compare.ts` compares every run with the one `bench/baseline.json`,
and its median drops the CPU model and each gesture's steps and frames. After this ticket a run on
an AMD EPYC 7763 is compared as before, and a run on an Intel Xeon Platinum 8370C, an AMD EPYC
9V45, or an AMD EPYC 9V74 is refused until a run on `main` on that kind is recorded as its
baseline, instead of failing or passing on the runner.

- `bench/compare.ts` takes the directory `bench/baselines` (its default) and picks the file of
  the run's kind, named as ADR-0008 derives it from the CPU model; given one baseline file
  instead, it still compares only when the file names the run's CPU model. `Run` and the
  median gain `cpu`, and each gesture the median of `steps` and `frames`; a mixture of CPU
  models in the runs is refused as a mixture of GPUs is.
- The refusal names the run's kind and the kinds that have a baseline, and the file a baseline of
  this kind would be saved as; runs that name no CPU model are refused, saying so and naming the
  kinds that have a baseline. The refusal replaces the path on which a missing baseline is reported
  and passes (exit 0).
- The fixtures of `bench/compare.test.ts` gain `cpu`, which is why its existing tests change; the
  test of a missing baseline expects the refusal.
- `bench/baseline.json` moves to `bench/baselines/amd-epyc-7763-64-core-processor.json`,
  recorded again with the new median from the three run files of Benchmark run 39160029963 on
  `main`, the source of today's baseline, so that it gains `cpu`, `steps`, and `frames` and no
  number changes.
- `.github/workflows/benchmark.yml`: the compare step passes `bench/baselines`, and the header
  comment says the baseline is the one of the runner's kind and that a run on a kind without one is
  refused, not passed.
- `README.md`, **Build, Test & Run**, *Benchmark*: "exceeds `bench/baseline.json`" becomes the
  baseline of the runner's kind under `bench/baselines/`; the gate compares with the kind's
  baseline; the local command becomes `bun bench/compare.ts bench/baselines <run>...`, and a run in
  the Dev Container is refused, since its CPU model has no baseline, unless a baseline recorded on
  the same CPU model is passed; recording a baseline saves `median.json` under the file name the
  refusal prints; the list of refused runs adds a run on a kind without a baseline, or naming no CPU
  model.
- `docs/ARCHITECTURE.md`, *Benchmark*: the baseline of the runner's kind instead of
  `bench/baseline.json`.
- The header comments of `bench/compare.ts` and `bench/run.ts` follow.

## Acceptance criteria

- [ ] Given a baseline on the AMD EPYC 7763 and a median on the Intel Xeon Platinum 8370C, when
      they are compared, then the run is refused, naming both CPU models (`Verifies: ADR-0008`).
- [ ] Given a baseline and a median on the same CPU model, when they are compared, then the
      numbers and the reference gate judge them as before.
- [ ] Given `bench/baselines` without a file for the runs' CPU model, when `bench/compare.ts`
      runs, then it exits with 2 and names the kind, the kinds with a baseline, and the file name
      for this kind.
- [ ] Given runs that name no CPU model, when `bench/compare.ts` runs, then it exits with 2,
      says that they name none, and names the kinds with a baseline.
- [ ] Given the CPU models `AMD EPYC 7763 64-Core Processor` and
      `Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz`, when their file names are derived, then
      they are `amd-epyc-7763-64-core-processor.json` and
      `intel-r-xeon-r-platinum-8370c-cpu-2-80ghz.json`.
- [ ] Given three runs, when their median is written, then `median.json` carries the CPU model
      and each gesture's p95, steps, and frames.
- [ ] Given the three run files of Benchmark run 39160029963, when their median is taken, then
      it equals the 7763's baseline in every number of `bench/baseline.json`.
- [ ] Broken once: with the CPU model left out of the comparison, the first criterion's test
      fails; and on a scratch branch with an 80 ms busy-wait in `Scene.render`, a **Benchmark**
      run on the 7763, started by the maintainer, fails, naming the gestures it slowed. A run
      that lands on another kind is refused, naming it, and is started again.

## Read first

- ADR-0008 (*Benchmark*, *Context* on runner kinds, *Enforcement*); ADR-0007 on the protected
  parts, the benchmark workflow among them.
- `bench/compare.ts`, `bench/compare.test.ts`, `bench/run.ts` (the recorded `cpu`, `steps`,
  `frames`), `bench/baseline.json`, `.github/workflows/benchmark.yml`.
- `docs/CONVENTIONS.md`: a number says where it was taken. `docs/GLOSSARY.md`: *Runner kind*.

## Blocked by

- None (can start immediately)

## Mode

with the human: it implements a revision of ADR-0008 that the maintainer reviews first, the
benchmark workflow is a protected part of ADR-0007, and only the maintainer starts its runs,
the busy-wait break-once among them; the run files of 39160029963 are read with `gh` on the
maintainer's instruction.
