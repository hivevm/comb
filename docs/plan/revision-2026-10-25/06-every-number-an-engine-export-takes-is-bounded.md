# Ticket: Every number an engine export takes is checked and bounded

## What to build

ADR-0028 (*World*) keeps every point the engine derives within `f32`, and the bridge refuses a
non-finite delta of `translate` and a non-finite or non-positive pixel of `query` and `hit`. Two
exports take numbers unchecked:

- `moveLabel(slot, x, y)` (`crates/engine-wasm/src/lib.rs`) hands its point to
  `Graph::move_label` (`crates/engine/src/graph/labels.rs`); a NaN point gives a NaN offset,
  which `clamp` keeps, so the edge stores a `LabelPlacement` with a NaN offset that the shell
  records, and `updateEdge` carries forward from `current.label`;
- `hit(x, y, …)` takes its point unchecked, and its pixel is bounded by `PIXEL_LIMIT` only in
  `query` (`graph/query.rs`), not in `hit_at` (`graph/hit.rs`), so a pixel of `1e308` gives an
  infinite reach there.

Today's callers pass pointer coordinates the viewport made, so no host reaches either. Refuse a
point that is not finite in both exports, as malformed, as `query` refuses a pixel, and bound the
pixel once, where `query` and `hit` both read it.

## Acceptance criteria

- [ ] Given `moveLabel` or `hit` with a coordinate that is NaN or infinite, when it is called, then
      it refuses with a typed error and changes nothing (`Verifies: ADR-0028, Q-7`).
- [ ] Given a pixel of `1e308`, when `hit` runs, then it answers as with the largest pixel `query`
      strokes for, and every distance it compares is finite.
- [ ] Broken once: with the check of the point dropped, the first test fails.
- [ ] Given `cargo test` and `bun run test`, when they run, then they pass.

## Read first

- ADR-0028 (*World*, *Bridge*), ADR-0010 (*Errors*), ADR-0025 (*One call*); `docs/CONVENTIONS.md`
  (*Check a value as the engine keeps it*).
- `crates/engine-wasm/src/lib.rs` (`checked_pixel`, `move_label`, `hit`),
  `crates/engine/src/graph/labels.rs`, `graph/hit.rs`, `graph/query.rs` (`PIXEL_LIMIT`).

## Blocked by

- None (can start immediately)

## Mode

unattended: tests decide each criterion; the change stays in the engine's exports, touches no part
the harness ADR keeps with the human (ADR-0007), and one revert undoes it; the broken-once run
proves it. Stop: where the refusal needs a new kind of `GraphDataProblem` or changes what the
shell sees of a refusal, hand off, since that is the bridge's data format (ADR-0010).
