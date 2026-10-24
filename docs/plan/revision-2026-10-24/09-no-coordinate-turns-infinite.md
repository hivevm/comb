# Ticket: No coordinate the engine derives turns infinite

## What to build

The bridge refuses a coordinate or a size that is not finite as `f32` (ADR-0028), but nothing
bounds what the engine derives from them. A node at `x = 3e38` with `width = 3e38` has its right
connector past `f32::MAX`; a node dragged far enough in `f32` has no overflow check; a query
rectangle around ±1e300, which the bridge does not refuse, makes label points relative to its
origin infinite. An edge end, a vertex, or a label point that turns infinite breaks Q-4, and
accepted graph data at some viewport would then draw what Q-7 says it never does. The reasons
of the `cast_possible_truncation` expectations in `crates/engine/src/graph.rs` and `stroke.rs`
say so; nothing fixes it.

Every coordinate the engine derives stays finite: the bridge refuses a node whose extent
(`x + width`, `y + height`) is not finite as `f32`, `translate` refuses or clamps a move that
would make a node's extent not finite, and a query refuses a rectangle that is not finite as
`f32` relative to its origin. Which of refusing and clamping applies to a drag is the
maintainer's decision.

## Acceptance criteria

- [ ] Given a node at `x = 3e38` with `width = 3e38`, when it is loaded, then `load` throws a
      `GraphDataError` naming the node and the field (`Verifies: Q-7`).
- [ ] Given a loaded node, when it is dragged or translated towards `f32::MAX`, then no edge end,
      vertex, or label point turns infinite, and the engine is not lost.
- [ ] Given a viewport set around ±1e300, when it is queried, then the query is refused with a
      typed error or the viewport is clamped, and nothing drawn is infinite.
- [ ] Broken once: without the extent check, the first criterion's test fails.

## Read first

- `docs/SPECIFICATION.md` Q-4, Q-7; ADR-0028 (*Bridge*), ADR-0010 (*Origin*), ADR-0027.
- `crates/engine-wasm/src/graph_data.rs` (`nodes_of`), `crates/engine/src/graph.rs` (`translate`,
  `query_within`, `edge_ends`), `docs/CONVENTIONS.md` (*Check a value as the engine keeps it*).

## Blocked by

- None (can start immediately)

## Mode

with the human: it changes the validation of graph data and the engine's mesh, protected parts of
ADR-0007, and refusing or clamping a drag is the maintainer's decision.
