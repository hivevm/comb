# Ticket: The benchmark measures the full content

## What to build

The benchmark loads the example with its full content at 50,010 nodes and times load, drag, pan,
zoom, and edits at each level of detail. Where a number of the runner's kind grows by more than
the workflow's 25 %, the profile names what costs, and the ticket fixes it or writes a ticket that
says by how much and why. The maintainer records the kind's new baseline from a workflow run on
`main`.

## Acceptance criteria

- [ ] Given `bun run bench` on the example with content, when it runs, then every gesture of today
      is timed at each level, and the result names the content it loaded.
- [ ] Given the **Benchmark** workflow against the current baseline, when it runs, then no number
      exceeds it by more than 25 %, or a ticket under `docs/plan/` says which, by how much, and
      what the profile points at.
- [ ] Given the work-per-frame counts of the scene, when the viewport pans at the near level, then
      no element view is created outside the pools' growth.

## Read first

- ADR-0008 (*Benchmark*, *Runner kind and baselines*), ADR-0027; `bench/run.ts`, the README's
  **Benchmark**; Ticket docs/plan/revision-2026-10-18/16-measure-q1-q2-on-the-reference-machine.md
  for Q-1 and Q-2 on the reference machine, which this ticket does not replace.

## Blocked by

- docs/plan/node-content/07-the-example-shows-the-metric-tree-of-g-9.md

## Mode

with the human: a new baseline is the maintainer's to record (ADR-0008), and a number past the
budget is a decision on Q-1 and the levels' thresholds (ADR-0027).
