# Ticket: A node's height is computed once, by the engine

## What to build

ADR-0013 has the engine compute a node's height. The bridge crate computes it twice more, by
putting together the pieces the engine exports:

- `ContentColumns::check` (`crates/engine-wasm/src/graph_data/content.rs:401`) collects each
  element's height from `check_element` (line 442), which takes an action's and a text's height
  from `fonts.of(..).line_height()` directly and the other kinds' from `element_height` with
  placeholder elements, and sums rows by `row_height_of` with a flag per badge and `node_height`.
- `ContentData::height` (line 1161) does it again with placeholder elements, for `setFont`'s
  relayout (`crates/engine-wasm/src/lib.rs`, `lay_out_heights`).
- `layout::lay_out` (`crates/engine/src/content.rs:424`) computes the height a third time and the
  bridge drops it.

The engine exports `element_height`, `row_height_of` with its `(is_badge, height)` pairs, and
`node_height` only so that the bridge can rebuild the rule; `row_offset` and `row_height` are
public and used by no other crate. A change of the height rule, as the badge's row offset was,
lands in three places.

The engine offers one function from a node's rows of element shapes, kinds and roles without
their texts, and the fonts to the node's height; the check and the relayout call it, and the
pieces it is built of become private to `crates/engine/src/content.rs`.

## Acceptance criteria

- [ ] Given `crates/engine/src/content.rs`, when the bridge crate needs a node's height, then it
      calls one engine function, and `element_height`, `row_height_of`, `node_height`,
      `row_offset`, and `row_height` are not public.
- [ ] Given the engine's layout tests and a test that, for random accepted content, the height
      of that function equals the height `lay_out` returns, when they run, then they pass.
- [ ] Given the bridge's tests and the property tests of `crates/engine-wasm`, when they run, then
      they pass unchanged.
- [ ] Broken once: with the badge's row offset left out of the new function, the equality test
      fails.

## Read first

- ADR-0013 (*Layout*), ADR-0034; `crates/engine/src/content.rs`,
  `crates/engine-wasm/src/graph_data/content.rs` (`check`, `check_element`, `height`).

## Blocked by

- None (can start immediately)

## Mode

with the human: `crates/engine-wasm/` is a protected part of ADR-0007.
