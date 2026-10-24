# Ticket: The benchmark times edits at 50,000 nodes

## What to build

ADR-0022 claims an edit costs no frame at 50,000 nodes. The benchmark measures it: after its
gestures, a gesture of edits adds a node and an edge and removes them again, one edit per frame,
for as many frames as the drag, and records the p95 frame time over the frames Comb rendered,
checked for its effect as the other gestures are (the node count back where it was, each edit
drawn). The comparison with the baseline takes the new gesture once a baseline of the runner's
kind has it; until then it reports it without judging.

## Acceptance criteria

- [ ] Given the benchmark at 50,010 nodes, when it runs, then its record holds a p95 of the edit
      gesture beside drag, pan, and zoom, and the gesture failed its check if an edit was not
      drawn.
- [ ] Given a baseline without the gesture, when `bench/compare.ts` compares, then it reports the
      gesture and judges only the others; its test pins it.
- [ ] Broken once: with every edit made as a load of the whole graph, the gesture's p95 rises to at
      least the time of a load measured in the same run; the pull request records both numbers.

## Read first

- ADR-0022, ADR-0008 (`bench/`), the Strategy of the specification.
- Convention: *A number says where it was taken*.
- `bench/run.ts`, `bench/compare.ts` and its test.

## Blocked by

- docs/plan/editing/04-the-host-removes-nodes-and-edges.md
- docs/plan/editing/05-the-host-adds-and-changes-edges.md
- docs/plan/revision-2026-10-24/06-one-shape-of-a-benchmark-run.md

## Mode

with the human: a baseline of the runner's kind is recorded by the **Benchmark** workflow on
`main`, which the maintainer dispatches, and the decision whether the edit gesture joins Q-1's
gate is the maintainer's.
