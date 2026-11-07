# Ticket: The far level's particle of a node shape, and a loaded loop's sides, are tested

## What to build

Two behaviours the state diagram's tickets changed are not decided by a test that says so:

- **The far level.** `examples/metric-tree/e2e/node-shapes.spec.ts`, "each node shape is drawn
  at the far level as a particle, as every node is", asserts that no node view draws a node shape
  there, not that a particle is drawn (ticket 01, merge 4069304, *Could not confirm*). A far level
  that drew nothing for a shaped node would pass it.
- **A loaded loop without sides.** `api` fills in `top` for both sides of a loop the host names no
  side of, in `addEdge` and a load alike (`edgeOf` of `api`'s snapshot). The
  edge snapshot's unit test and the `addEdge` browser test decide it for one edge; no test loads a
  loop without sides and checks where it is drawn, and a load gave `right` and `left` before
  ticket 03 (merge f2646dd, *Doubts*).

Add a browser test of each through `comb/testing`, each watched failing under the breakage it
claims: the far test with particles of shaped nodes skipped, the load test with the load's default
set back to `right` and `left`.

## Acceptance criteria

- [ ] Given a graph of every node shape at the far level, when it is inspected, then each node is
      drawn as a particle of its colour, and the test fails when particles skip shaped nodes.
- [ ] Given a load of a loop that names no side, when it is drawn, then its ends lie on the top
      side of its node, and the test fails when the load's default is `right` and `left`.

## Read first

- Touches: `examples/metric-tree/e2e/node-shapes.spec.ts`,
  `examples/metric-tree/e2e/add-edge.spec.ts`
- ADR-0012 (levels of detail), ADR-0031 (*Loops*), ADR-0032 (*Levels of detail*).
- The convention *Break the feature once, and watch its test fail*.
- The seam: `inspect` of `comb/testing`; the existing loop tests of
  `examples/metric-tree/e2e/add-edge.spec.ts`.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria: the two browser tests, each with its breakage named;
- its scope is two browser test files, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a test that passes under its breakage, which the hand-off names;
  `scripts/check-all.sh` green proves it right;
- stop: when `inspect` reports no particles, so that the far test needs a new export of
  `comb/testing`, or `scripts/check-all.sh` is still red after three attempts at a fix, the
  session leaves its state here and hands off.
