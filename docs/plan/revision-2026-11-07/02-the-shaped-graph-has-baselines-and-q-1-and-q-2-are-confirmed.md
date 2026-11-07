# Ticket: The shaped graph has baselines, and Q-1 and Q-2 are confirmed for it

## What to build

Ticket 05 of the state diagram (merge 9e8f882) made the benchmark measure a shaped graph
(`BENCH_GRAPH=shaped`, ADR-0033) and wrote no baseline: `bench/baselines/` holds no
`<kind>.shaped.json`, so the workflow's shaped step passes on exit 3 with a notice on every runner
kind, and nothing compares a shaped run with anything. The spec's criterion that Q-1 and Q-2 hold
for a graph of node shapes, outline docking, and loops was left "the maintainer's to confirm".
The only numbers so far are one headless SwiftShader run in the Dev Container, which is no
baseline.

Record the shaped graph's baselines as the metric tree's were recorded, from the workflow's
`median.shaped.json` on each runner kind and from a run on the reference machine (ADR-0028), and
judge Q-1 and Q-2 for the shaped graph on the reference machine.

Two observations of the hand-offs go with it:

- The shaped graph's filled nodes carry no content, 57,156 texts against the metric tree's
  100,020, which may hide what the shaped graph's edge placement costs (`set_shape` places a
  node's edges again on a load). Whether the shaped graph measures what the spec asked is a
  question for this ticket's numbers.
- The workflow has not yet been seen to run both graphs on GitHub within its 90 minutes.

## Acceptance criteria

- [ ] Given a run of the benchmark workflow on `main`, when it finishes, then both graphs ran
      within the timeout, and its shaped step's summary holds a median for each runner kind.
- [ ] Given those medians and a run on the reference machine, when they are committed under
      `bench/baselines/` as `<kind>.shaped.json`, then `bun run bench/compare.ts` compares a later
      shaped run of that kind against them and exits 0 or 1, not 3.
- [ ] Given the reference machine's shaped run, when the maintainer reads it against Q-1 and Q-2,
      then this ticket records whether both hold, and a miss is filed as a ticket of its own.

## Read first

- Touches: `bench/baselines/`
- ADR-0033 (proposed), ADR-0028, ADR-0029; the **Benchmark** part of `README.md`.
- The merge message of 9e8f882, *Doubts* and *Demo*.

## Blocked by

- docs/plan/revision-2026-11-07/03-the-shaped-graphs-filled-nodes-fit-their-rows.md

## Mode

with the human: the workflow runs on GitHub, the reference machine is the maintainer's, and Q-1
and Q-2 are the maintainer's to judge on it; a session in the Dev Container measures neither.
Ticket 03 changes the graph the baselines are taken of; where the maintainer declines it, its
file goes and this ticket starts.
