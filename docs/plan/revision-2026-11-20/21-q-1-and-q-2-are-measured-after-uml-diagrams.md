# Ticket: Q-1 and Q-2 are measured after uml-diagrams

## What to build

The spec of uml-diagrams named Q-1 and Q-2 as goals that keep holding, the benchmark's numbers
within their margins. Tickets 09 and 10 added columns to a load, labels as lists, and edges that end
on edges; their hand-offs say the benchmark was not run. A load now nests, divides, and places the
edges at held nodes anew (ticket 08 of this revision). No measure of the branch's head compares it
with the baselines.

Evidence: the hand-offs of tickets 09 and 10 of uml-diagrams, and *Could not confirm* of the pull
request of uml-diagrams: "The benchmark was not run for tickets 09 and 10, which add columns to a
load."

Run the benchmark of the metric tree on the reference machine and in the workflow at the head that
holds uml-diagrams, compare with `bench/baselines/`, and record the result. Where a number falls
outside its margin, the hand-off names the commit by bisecting the topics of uml-diagrams, and the
human decides between a fix and a new baseline.

## Acceptance criteria

- [ ] Given the head that holds uml-diagrams, when the benchmark runs on the reference machine
      and in the workflow, then its record names each number against its baseline and margin.
- [ ] Given a number outside its margin, when the topics are bisected, then the hand-off names the
      commit and the cause.

## Read first

- Touches: `bench/`, `bench/baselines/`
- PERF-benchmark-drives-host-chrome, PERF-benchmark-measures-named-graph; Q-1 and Q-2 of
  `docs/SPECIFICATION.md`.
- docs/plan/revision-2026-11-07/02-the-shaped-graph-has-baselines-and-q-1-and-q-2-are-confirmed.md,
  which records the shaped graph's baselines and may run with it.

## Blocked by

- None (can start immediately)

## Mode

with the human: the reference machine is the maintainer's, and a new baseline is the maintainer's
decision.
