# Ticket: The benchmark measures a graph of shapes, docking, and loops

## What to build

The benchmark gains a variant at 50,010 nodes:
- its nodes take the shapes in turn;
- its edges dock on the outline;
- one node in a hundred has a loop.

It measures the same gestures and the first frame as the metric tree's run and records the
variant by name, with baselines of its own. The metric tree's run and its baselines stay as
they are.

## Acceptance criteria

- [ ] Given the variant, when the benchmark runs, then it reports the first frame and p95 frame
  times of each gesture under the variant's name (Q-1, Q-2).
- [ ] Given a run of the variant, when it is compared, then it is compared with the variant's
  baseline only, and a run of the metric tree with the metric tree's.
- [ ] Given the reference machine, when the variant runs, then Q-1 and Q-2 hold.

## Read first

- Touches: `bench/`, `examples/uml/` or a graph of its own for the variant, `README.md` (its
  **Benchmark** part)
- The spec, ADR-0028, ADR-0029, and the proposed ADR on the benchmark's variant.
- Golden path: `bench/run.ts` and `bench/compare.ts` with their tests.

## Blocked by

- docs/plan/state-diagram/03-a-loop-leads-a-node-back-to-itself.md

## Mode

with the human: the maintainer records the variant's baselines on the reference machine.
