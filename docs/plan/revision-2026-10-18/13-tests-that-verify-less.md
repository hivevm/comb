# Ticket: Make the tests that pass without their feature fail without it

## What to build

Tests in the modules of *Large graphs* that would pass with the behaviour they name removed:

- `a_label_follows_when_a_node_moves` (`crates/engine/src/geometry.rs`) moves no node: it
  builds a fresh path and compares `label_position` with `point_at`. Nothing tests that
  `Graph::translate` recomputes the label points of the moved node's edges.
- `nodes_dragged_far_beyond_the_extent_rebuild_the_index` (`graph.rs`) would pass its query
  check without a rebuild; only `beyond_extent() == 0` shows one, and no test shows that the
  index is *not* rebuilt below the trigger `max(items / 8, 16)`.
- Unpinned constants of the engine: the span cap `most = max(items * 4, 64)`
  (`spatial.rs`), the cell side (`graph.rs`), `MAX_DEPTH = 12` (`stroke.rs`).
- `examples/metric-tree/e2e/example.spec.ts`: an assertion `>= before + 2` where the test knows
  the exact count.

## Acceptance criteria

- [ ] Given each test above, when the behaviour it names is removed (no label recomputation on
      move, no rebuild, a rebuild on every move), then it fails; the pull request names each
      breakage tried.
- [ ] Given each constant above, when it is changed so that it matters (the span cap halved, the
      depth at 4), then a test fails, or the constant is documented as free with why.
- [ ] Given every expected value, when it is computed, then it comes from the inputs, not from
      the engine's state (`docs/CONVENTIONS.md`, "An oracle owes nothing…").

## Read first

- `docs/CONVENTIONS.md`, all entries; ADR-0002.
- `crates/engine/src/graph.rs`, `spatial.rs`, `stroke.rs`, `geometry.rs`, and their tests.

## Blocked by

- docs/plan/revision-2026-10-18/10-engine-bounds-once-and-dead-code.md

## Mode

unattended:
- a test decides it: the criteria above;
- its scope is the tests of `crates/engine/` and the example's browser tests, and a wrong result
  costs one revert;
- it touches no protected part of ADR-0007 (no public interface, bridge format, validation, or
  CI workflow) and fits under the cap of two;
- a wrong result shows as a red `scripts/check-all.sh`, undone by a revert; a green run plus the
  red run each criterion names proves it right;
- stop: after two attempts at a criterion that stays red, or when a change would need a decision
  no ADR in force states, the session leaves its state here and hands off.
