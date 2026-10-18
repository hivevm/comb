# Ticket: Refuse to compare runs taken on another GPU than the baseline's

## What to build

`bench/compare.ts` refuses runs of another size or mode than the baseline's, but not of another
GPU or renderer: a baseline taken headed on a laptop, or on a fallback renderer, compares
silently with a runner's numbers. The benchmark already writes `gpu`; `compare.ts` makes it part
of what must match, and refuses a baseline or a run that names no GPU, so the mistake of a
baseline taken on Canvas 2D cannot be compared again.

## Acceptance criteria

- [ ] Given a baseline and a run that name different GPUs, when `compare` runs, then it reports
      them incomparable and names both.
- [ ] Given a run whose `gpu` is missing or `"unknown"`, when `median` or `compare` runs, then it
      refuses it.
- [ ] Given the tests, when the GPU check is removed, then at least one fails (the convention
      "Break the feature once").

## Read first

- `bench/compare.ts`, `bench/compare.test.ts`, `bench/run.ts` (where `gpu` is read).
- ADR-0008 (*Benchmark*), `docs/CONVENTIONS.md` ("A number says where it was taken").

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides it: the criteria above, as Bun tests in `bench/compare.test.ts`;
- its scope is `bench/compare.ts` and its test, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 (no public interface, bridge format, validation, or
  workflow) and fits under the cap of two;
- a wrong result shows as a refused or wrongly accepted comparison in `bun test`, undone by a
  revert; green tests plus a red run with the check removed prove it right;
- stop: after two attempts at a criterion that stays red, the session leaves its state here and
  hands off.
