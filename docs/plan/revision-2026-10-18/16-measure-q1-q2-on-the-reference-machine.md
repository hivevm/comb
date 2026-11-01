# Ticket: Measure Q-1 and Q-2 on the reference machine

## What to build

*Large graphs* served Q-1 and Q-2 but never measured them where they are defined. On SwiftShader
the benchmark reports a first frame of about 0.2 s and p95 frame times of about 100 to 150 ms,
raster-bound, which says nothing about an Iris Xe or Radeon 680M. The maintainer runs
`BENCH_HEADED=1 bun run bench` on the reference machine, and the result decides what follows:
where Q-1 or Q-2 holds, a test cites it (`Verifies: Q-1`, `Verifies: Q-2`, which no test does
yet); where one misses, a ticket says by how much and what the profile points at, or a drafted
specification change if the target itself is in question.

## What the measurement found

Three runs on 2026-11-01 on the maintainer's machine, from the Dev Container, attached to Chrome
156 on the host (ADR-0038), its page's CPU slowed two times (ADR-0039): a Dell Precision 3460 with
an Intel Core i7-13700 and an Intel UHD Graphics 770 (Mesa, RPL-S), 50,010 nodes, commit
fb791e79. Medians of the three, the run's median saved as
`bench/baselines/13th-gen-intel-r-core-tm-i7-13700.json`:

| Number | Median | Q |
| --- | --- | --- |
| first frame | 471 ms (444, 541, 471) | Q-2 holds |
| drag, pan at the fitted view (far) | 16.8 ms p95 | Q-1 holds |
| drag, pan, zoom, edit at near and at middle | 16.7–16.8 ms p95 | Q-1 holds |
| zoom from the fitted view | 50.0 ms p95 | Q-1 misses: ticket 18 |
| zoom at far | 66.7 ms p95 | Q-1 misses: ticket 18 |
| edit at the fitted view (far) | 116.7 ms p95 | Q-1 misses: ticket 17 |

A frame time of 16.8 ms is a frame each refresh of the display's 60 Hz, the browser's timing of
it; Q-1's 16.7 ms cannot be undercut there. The machine is not of the reference's class: its GPU is
weaker and its CPU, slowed by an estimated factor, faster. Whether Q-1 and Q-2 are judged on it,
and how 16.7 ms reads at 60 Hz, is a specification change the maintainer lands; until then no test
cites Q-1 or Q-2. The thresholds of ADR-0027 need not move for these numbers: the near and the
middle level hold a frame at the scales where each begins, and what misses at far is its zoom and
its edits, not the scale where far begins.

## Acceptance criteria

- [ ] Given the reference machine, when the benchmark runs headed three times, then the median of
      each number is recorded with its GPU in a pull request.
- [ ] Given the numbers, when Q-1 and Q-2 hold, then the benchmark's check against the absolute
      targets cites them; when they miss, a ticket under `docs/plan/` names the gap.
- [ ] Given the levels, when they are measured there, then the pull request says whether the
      thresholds of ADR-0027 should move.

## Read first

- `docs/SPECIFICATION.md` Q-1, Q-2 and the reference machine; ADR-0008 (*Benchmark*).
- `README.md` (**Benchmark**), `bench/run.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: only the maintainer has the reference machine.
