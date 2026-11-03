# Ticket: The engine meshes one set of edge slots, and the stroke of a slot is built once

## What to build

`meshAt(slots, also, …)` of `crates/engine/src/graph/query.rs` (exported in
`crates/engine-wasm/src/lib.rs` and called in `packages/comb/src/bridge/index.ts`) grew a second
list. It now means "the edges at these nodes, plus these edges, each once". The engine already
exports `edgesAt`, so a mesh of one given set of edge slots would do, with the union made by its
caller. Separately, the closure from a slot to its path and style, and the `Stroke::at(...)` call,
are written twice in `query.rs`, once for the query and once for `meshAt`.

Take the narrower interface where it costs no frame. Either `meshAt` meshes one set of edge
slots and the shell, or the engine's own caller, names them, or the pull request says why the
union belongs in the engine. Write the slot-to-stroke step once.

## Acceptance criteria

- [ ] Given `crates/engine/src/graph/query.rs`, when it is read, then the step from an edge slot
      to its stroke is written once and the query and the moving mesh both call it.
- [ ] Given the bridge's `meshAt`, when it is read, then it takes one list of edge slots, or the
      pull request names why it keeps two.
- [ ] Given the Rust test that the mesh of given node and edge slots holds those edges each once,
      and the browser tests `examples/metric-tree/e2e/work-per-frame.spec.ts` and
      `examples/metric-tree/e2e/drag.spec.ts`, when they run, then they pass.

## Read first

- ADR-0010, ADR-0027.
- `crates/engine/src/graph/query.rs`, `crates/engine-wasm/src/lib.rs` (`meshAt`, `edgesAt`),
  `packages/comb/src/bridge/index.ts` (`meshAt`).

## Blocked by

- None (can start immediately)

## Mode

with the human: `crates/engine/src/graph/`, `crates/engine-wasm/`, and `packages/comb/src/bridge/`
are protected parts of [ADR-0007](../../adr/0007-harness.md).
