# Ticket: Measure Q-1 and Q-2 on the reference machine

## What to build

*Large graphs* served Q-1 and Q-2 but never measured them where they are defined. On SwiftShader
the benchmark reports a first frame of about 0.2 s and p95 frame times of about 100 to 150 ms,
raster-bound, which says nothing about an Iris Xe or Radeon 680M. The maintainer runs
`BENCH_HEADED=1 bun run bench` on the reference machine, and the result decides what follows:
where Q-1 or Q-2 holds, a test cites it (`Verifies: Q-1`, `Verifies: Q-2`, which no test does
yet); where one misses, a ticket says by how much and what the profile points at, or a drafted
specification change if the target itself is in question.

## Acceptance criteria

- [ ] Given the reference machine, when the benchmark runs headed three times, then the median of
      each number is recorded with its GPU in a pull request.
- [ ] Given the numbers, when Q-1 and Q-2 hold, then the benchmark's check against the absolute
      targets cites them; when they miss, a ticket under `docs/plan/` names the gap.
- [ ] Given the levels, when they are measured there, then the pull request says whether the
      thresholds of ADR-0012 should move (docs/plan/revision-2026-10-18/02-adr-0012-revision.md).

## Read first

- `docs/SPECIFICATION.md` Q-1, Q-2 and the reference machine; ADR-0008 (*Benchmark*).
- `README.md` (**Benchmark**), `bench/run.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: only the maintainer has the reference machine.
