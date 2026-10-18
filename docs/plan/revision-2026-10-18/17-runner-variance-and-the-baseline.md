# Ticket: Make the benchmark baseline robust against the runner it lands on

## What to build

The **Benchmark** workflow compares the median of three runs on one runner with
`bench/baseline.json`. Within a run the three agree closely, but between workflow runs the runner
itself varies: the run after the baseline, with no change that touches the benchmark, measured
every number 13 to 42 % faster (first frame 221 against 379 ms, p95 drag 167 against 250 ms).
A baseline from a slow runner then hides a real regression of up to the difference, and one from
a fast runner raises false alarms. The workflow compares in a way that the runner's own speed
does not decide, so that a 25 % margin means a 25 % regression of Comb.

The maintainer chooses between at least these, or another:

- **A baseline over several workflow runs:** the median of five weekly runs on `main`, recorded
  together, so one runner's speed weighs less; the margin stays absolute.
- **Numbers relative to the runner:** every run also times a fixed reference workload on the same
  runner (for example a fixed WebGL draw and a fixed engine query), and the workflow compares
  each number divided by that reference; the baseline then records ratios.
- **A wider margin** sized to the observed spread between runners, with the cost that it catches
  only larger regressions.

## Acceptance criteria

- [ ] Given two workflow runs on `main` without a change to the code they measure, when both are
      compared with the baseline, then their verdicts agree and neither number differs from the
      baseline by more than the margin.
- [ ] Given a change that makes one number slower by more than the margin on the same runner,
      when the workflow runs, then it fails and names that number (break the feature once).
- [ ] Given ADR-0008's *Benchmark* clause, when the choice is made, then the clause says how the
      comparison is made and the README says how the baseline is recorded.

## Read first

- ADR-0008 (*Benchmark*), `bench/compare.ts`, `bench/run.ts`, `.github/workflows/benchmark.yml`.
- The runs of the workflow on `main`: 39098695116 (the baseline) and 39102498247 (the check).
- `docs/CONVENTIONS.md`: "A number says where it was taken".

## Blocked by

- None (can start immediately)

## Mode

with the human: the margin and how the baseline is recorded are the maintainer's to set
(ADR-0008), and only the maintainer starts workflows on GitHub and decides what is recorded from
them.
