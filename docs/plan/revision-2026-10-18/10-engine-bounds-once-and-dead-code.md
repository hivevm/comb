# Ticket: Compute each edge's bounds once, and drop the engine's dead code

## What to build

Graph::query (`crates/engine/src/graph.rs`) calls `path.bounds()`, which solves two
quadratics, for every candidate edge on every query, although `reindex_edge` computed the same
bounds when the edge last moved; they belong beside `paths`. Around it, code no production path
reaches: `Graph::label_point` has no caller; `Graph::edge_path` and `Stroke::full` serve tests
only, and `STROKE_WIDTH = 2.0` in `stroke.rs` has no effect, because the shell passes its own
`EDGE_WIDTH` (`packages/comb/src/render/scene.ts`): one number with two homes. `Graph`'s
`slots()` saturates a count to `u32::MAX` where the bridge's `slot()` returns an error for the
same conversion.

## Acceptance criteria

- [ ] Given random graphs, when nodes move and the index is queried, then the result equals the
      brute-force scan as before, and `bounds()` is no longer called per query (the cached
      bounds are checked against a fresh computation in a test after moves).
- [ ] Given the engine, when the ticket closes, then no function or constant is left that only
      tests reach, unless the test needs it as an oracle independent of the code under test, and
      the edge width has one home.
- [ ] Given a slot count beyond `u32`, when either conversion meets it, then both refuse it the
      same way.

## Read first

- ADR-0009 (the core), ADR-0012 (edge geometry), `docs/CONVENTIONS.md`.
- `crates/engine/src/graph.rs`, `crates/engine/src/stroke.rs`, `crates/engine-wasm/src/lib.rs`.

## Blocked by

- docs/plan/revision-2026-10-18/09-narrow-the-query-export.md

## Mode

unattended:
- a test decides it: the criteria above;
- its scope is `crates/engine/` and the one constant in `render/scene.ts`, interface-preserving, and
  a wrong result costs one revert;
- it touches no protected part of ADR-0007 (no public interface, bridge format, validation, or
  CI workflow) and fits under the cap of two;
- a wrong result shows as a red `scripts/check-all.sh`, undone by a revert; a green run plus the
  red run each criterion names proves it right;
- stop: after two attempts at a criterion that stays red, or when a change would need a decision
  no ADR in force states, the session leaves its state here and hands off.
