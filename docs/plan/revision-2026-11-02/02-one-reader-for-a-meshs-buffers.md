# Ticket: One reader for a mesh's buffers, the query's and the drag's

## What to build

The engine writes two edge meshes now: the query's and, during a drag, the moving layer's
([ADR-0036](../../adr/0036-a-drag-redraws-what-it-moved.md)). Each of the five arrays of a mesh,
positions, distances, colours, dashes, and indices, crosses through an export pair of its own,
`mesh…Ptr` and `mesh…Len` for the query's and `moving…Ptr` and `moving…Len` for the drag's, so
`crates/engine-wasm/src/lib.rs` holds ten pairs that differ only in the field they read; the crate
root holds 66 such exports in all, beside the exports themselves. In the shell,
`packages/comb/src/bridge/index.ts` reads the five arrays twice, once in `queried` and once in
`moving`, each with its own copy of the `u32` and `f32` view helpers, which `engineBridge` defines
a third time.

The arrays of a mesh are read by one function in the shell, which takes the mesh to read, and the
view helpers are defined once. On the engine's side, the simplest form that lets that function
read either mesh without ten exports of the same shape; which one, and whether the other buffer
pairs follow it, the pull request says. The views stay fresh per read (ADR-0034), and the test
mode's detaching of views keeps catching a view kept across a call.

## Acceptance criteria

- [ ] Given `packages/comb/src/bridge/index.ts`, when it is read, then the five arrays of a mesh
      are read in one function, which the query and `meshAt` both call, and `u32` and `f32` are
      defined once.
- [ ] Given `crates/engine-wasm/src/lib.rs`, when it is read, then no two exports differ only in
      which of the two meshes they read.
- [ ] Given the bridge's Bun tests and the browser tests of a drag
      (`examples/metric-tree/e2e/work-per-frame.spec.ts`, `examples/metric-tree/e2e/drag.spec.ts`),
      when they run, then they pass unchanged.

## Read first

- ADR-0034 (*coordinate streams through typed-array views on engine-owned buffers*), ADR-0036,
  ADR-0027.
- `crates/engine-wasm/src/lib.rs` (the accessors of `Engine`), `packages/comb/src/bridge/index.ts`
  (`queried`, `moving`, `engineBridge`).

## Blocked by

- None (can start immediately)

## Mode

with the human: `crates/engine-wasm/` and `packages/comb/src/bridge/` are protected parts of
[ADR-0007](../../adr/0007-harness.md), the data format of the bridge.
