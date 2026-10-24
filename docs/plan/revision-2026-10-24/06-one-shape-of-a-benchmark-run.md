# Ticket: One shape of a benchmark run, written once

## What to build

`bench/run.ts` writes a run's record and `bench/compare.ts` reads it, and each spells out what a
run holds on its own. The record is built untyped in `run.ts` beside a `Measure` of its own, and
`compare.ts` declares the `Run` and `Gesture` it reads; nothing holds the two together, so a
field renamed in one is read as missing in the other, which the comparison takes for a run of an
older shape (`steps?`, `frames?`, `reference?` are optional for that reason). The parts of the
reference workload are listed five times: the `Reference` interface of `bench/reference.ts`,
`PARTS` and the literal list in `usable` and the part-by-part median in `compare.ts`, and the log
line of `run.ts`; a part added to the workload and missed in one of them is left out of the gate
or the median. The in-page timer of `reference.ts` takes its own median, right for an odd number
of rounds only; that one stays, since `page.evaluate` serialises it, but says so where `ROUNDS`
is set.

Make `compare.ts` the one definition of a run: `run.ts` builds its record as `satisfies Run`,
and the parts of the reference come from one list that the gate, `usable`, the median, and the
log line all walk. No number of a run, a baseline, or a verdict changes.

## Acceptance criteria

- [ ] Given `run.ts`, when its record lacks or misnames a field `Run` declares, then `tsc` fails.
- [ ] Given the reference parts, when one is added to `Reference`, then the gate, `usable`, the
      median, and the log line take it without another edit; a test of `compare.test.ts` pins
      that `usable` and the median cover every part.
- [ ] Given the baseline of `bench/baselines/` passed to `bench/compare.ts` as three run files,
      when it is compared before and after the change, then the verdict and every line it prints
      are the same.
- [ ] Given `compare.test.ts`, when it runs, then the rule of a kind's file name is held on a CPU
      model that starts and ends with a character other than a letter or digit, the clause of
      ADR-0008 no test exercises today.

## Read first

- ADR-0008 (*Benchmark*).
- `bench/run.ts`, `bench/compare.ts`, `bench/reference.ts`, `bench/compare.test.ts`.

## Blocked by

- None (can start immediately)

## Mode

unattended: `bench/` is no protected part of ADR-0007. A test decides the criteria
(`compare.test.ts`, `tsc`, and the verdict over the baseline as run files before and after); the
scope is `bench/` alone and a wrong result costs one revert; it is noticed by a changed verdict
or a failing comparison test, and undone by the revert. Stop: if a verdict or a printed line
changes, or after two attempts at a type that `run.ts` and `compare.ts` share without widening
`Run`, hand off with the state written here.
