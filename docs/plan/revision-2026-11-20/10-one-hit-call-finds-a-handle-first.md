# Ticket: One call of the engine's hit test finds a resize handle first

## What to build

REN-node-content-and-hits decides the hit test as one call: a resize handle, else a line between
regions, else a connector, a label, a node, or an edge. The engine answers it with two functions,
`Graph::handle_at` and `Graph::hit_at` in `crates/engine/src/graph/hit.rs`, and the export `hit` of
`crates/engine-wasm/src/lib.rs` chains them. The engine's scan tests each half; no test of the
engine decides the whole order.

Evidence: the hand-off of ticket 17 of uml-diagrams names in *Doubts* that the order of a handle
before a line lives in the bridge's `hit` and that the scan asserts both halves, not their
composition; its reviewer found that only the UML example's browser test exercises it end to end.

Let `Graph::hit_at` take the selected node and answer a handle first, and let the export call it
once.

## Acceptance criteria

- [ ] Given random graphs with divided and resizable nodes, when the scan test of `hit.rs` runs,
      then it asserts a handle before a line before a connector through one call.
- [ ] Given the engine, when it is read, then `handle_at` is not public.
- [ ] Given the UML example's browser test of handles and lines, when it runs, then it passes
      unchanged.

## Read first

- Touches: `crates/engine/src/graph/hit.rs`, `crates/engine-wasm/src/lib.rs`
- REN-node-content-and-hits.
- The seam: the scan test `a_hit_finds_what_a_scan_finds_with_resize_handles…` of `hit.rs`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the engine's graph and the bridge crate, protected parts the maintainer
reviews (DEV-implementer-and-fresh-reviewer).
