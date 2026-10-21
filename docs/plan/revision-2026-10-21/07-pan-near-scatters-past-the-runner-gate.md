# Ticket: "Pan near" scatters between runners more than the reference predicts

## What to build

ADR-0008's runner gate refuses a run whose reference workload differs from the baseline's by
more than 25 % in a part, and compares the rest. Between GitHub runner kinds, "pan near" scattered
more than the reference predicts, in Benchmark runs 39544445534, 39545407940, 39545410268,
39545961970, and 39545986669. ADR-0008 foresaw it ("a runner that differs in what Comb uses and
the reference does not still passes the gate") and leaves the 25 % to the workflow's runs on
`main`. Those runs now say something.

Two properties of the numbers may explain more than the runner does. Every p95 in
`bench/baseline.json` is a whole number of frames at 60 Hz: drag 250 ms (15 frames), pan 233.4
(14), zoom 200.1 (12), pan near 133.4 (8), and pan middle 166.7 (10). For pan near, one frame more
is 12.5 %, two frames reach the margin, and three fail it; for drag, the margin is almost four
frames. And every gesture of the baseline is `truncated`: the action budget ran out before every
step was sent, so how many frames a gesture rendered, which the baseline does not record, varies
with the runner.

The session collects each listed run's reference parts, frame counts, and numbers into a table,
says which explanation the data supports, the runner, the frame step, or the sample count, and
drafts the remedy for the maintainer: a margin of whole frames, more frames per gesture, a gate
per gesture, or a baseline per runner kind. A remedy that changes the gate or the comparison is a
revision of ADR-0008 in a pull request of ADRs only; the code follows as a ticket of its own.

## Acceptance criteria

- [ ] Given the five runs, when their artifacts are read, then a table in the pull request gives
      for each the runner's reference parts, the frames each gesture rendered, and each number
      against the baseline.
- [ ] Given the table, when the explanations are weighed, then the pull request says which the
      data supports and which it rules out, with the numbers.
- [ ] Given the explanation, when a remedy changes how runs are judged, then it is a proposed
      revision of ADR-0008, and `bench/compare.test.ts` gains the case that decides it.

## Read first

- ADR-0008 (*Benchmark*, *Consequences*, *Enforcement*) in full.
- `bench/run.ts` (`frameTimes`, `percentile`, the action budget), `bench/compare.ts`,
  `bench/baseline.json`, `.github/workflows/benchmark.yml`.
- `docs/CONVENTIONS.md`: a number says where it was taken.

## Blocked by

- None (can start immediately)

## Mode

with the human: the runs' artifacts are read with `gh`, which waits for the maintainer's
instruction, the benchmark workflow is a protected part of ADR-0007, and how runs are judged is
ADR-0008's to decide.
