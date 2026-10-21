# Ticket: A check that an edge's bounds hold its whole path, over many paths

## What to build

The bounds of an edge's path decide whether a query finds the edge (G-7). They fell short of the
curve where the cubic term of a coordinate's derivative was small, and missed an arch 1e-13 wide
altogether. The tests then took four fixed paths, and none of them was ill-conditioned. The
fault was fixed with a regression test of the two cases that showed it. Nothing tests the next
case of the same kind.

A Rust test in `crates/engine` builds paths from a fixed seed: paths as `EdgePath::between`
builds them, forwards, backwards, and level, and paths of arbitrary control points, at scales from
1e-13 to 1e6, with near-degenerate cubic and quadratic terms among them. For each, it asserts that
the bounds hold every point of the curve sampled densely, and that they reach no farther than
the sampled bounds plus the sampling error. The points are computed by the Bernstein form in the
test, not by the engine's `point_at`, so that the oracle owes nothing to the code it judges. It
uses no new dependency. The core takes no crate that reaches randomness (ADR-0009), so a small
generator with a fixed seed is written in the test.

## Acceptance criteria

- [ ] Given a fixed seed and some thousands of paths of the kinds above, when the bounds of each
      are computed, then each holds every sampled point of its curve and reaches no farther than
      the sampled bounds plus the sampling error, both within a tolerance relative to the path's
      scale that the test names (`Verifies: Q-4`).
- [ ] Given the test, when it runs in `cargo test`, then it adds no more than a second to the
      engine's suite, so that the mutation workflow's timeout of 30 s per mutant still holds.
- [ ] Broken once: with `extrema` back to the textbook quadratic roots behind thresholds of 1e-12,
      the test fails and names a path.

## Read first

- ADR-0012 (*Culling*), ADR-0009 (*Core*), ADR-0008 (*Mutation testing*).
- `crates/engine/src/geometry.rs` (`extrema`, `EdgePath::bounds`, and its tests: `bernstein` in
  `the_bounds_hold_a_path_whose_turning_point_is_ill_conditioned_or_tiny` is the golden path of
  an oracle independent of `point_at`).
- `docs/CONVENTIONS.md`: geometry is tested on its awkward cases; an oracle owes nothing to the
  code it judges; break the feature once.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria (above);
- scope: one Rust test in `geometry.rs`; one revert undoes it;
- cap: it counts as one of the two pieces of open agent work ADR-0007 allows, and starts only
  when fewer than two are open;
- no protected part of ADR-0007;
- a wrong result shows as a red or slow `cargo test`; the broken-once run proves it;
- stop: if the test finds bounds that fall short with today's `extrema`, stop and hand off with
  the path. That is a fault in the engine and needs a ticket of its own; the test's tolerance
  is not widened to pass it.
