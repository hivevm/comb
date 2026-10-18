# Ticket: Make the benchmark baseline robust against the runner it lands on

## What to build

The **Benchmark** workflow compares the median of three runs on one runner with
`bench/baseline.json`. Within a run the three agree closely, but between workflow runs the runner
itself varies: the run after the baseline, with no change that touches the benchmark, measured
every number 13 to 42 % faster (first frame 221 against 379 ms, p95 drag 167 against 250 ms).
A baseline from a slow runner then hides a real regression of up to the difference, and one from
a fast runner raises false alarms. The workflow compares in a way that the runner's own speed
does not decide, so that a 25 % margin means a 25 % regression of Comb.

The maintainer chose the **reference as a gate** (ADR-0008, *Benchmark*): every run also times a
fixed reference workload on the same runner (`bench/reference.ts`), the numbers are compared raw
with the baseline, and a run whose reference differs from the baseline's by more than the margin
in any part is refused as taken on a runner not comparable. The gate, the comparison, and their
tests are in place; what remains is to record a baseline with a reference from a workflow run on
`main` and to see from runs on `main` whether the gate's margin suits the runners.

## Acceptance criteria

- [ ] Given two workflow runs on `main` without a change to the code they measure, when both are
      compared with the baseline, then their verdicts agree and neither number differs from the
      baseline by more than the margin. Open: it needs runs of the workflow on `main`, after a
      baseline with a reference is recorded from one, which only the maintainer starts.
- [ ] Given a change that makes one number slower by more than the margin on the same runner,
      when the workflow runs, then it fails and names that number (break the feature once). Open:
      it needs a workflow run on `main`; locally, an 80 ms busy-wait in `Scene.render` made
      `bench/compare.ts` exit 1 naming the five gestures (+37 to +62 %).
- [x] Given ADR-0008's *Benchmark* clause, when the choice is made, then the clause says how the
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
