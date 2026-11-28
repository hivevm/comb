# Ticket: The bridge crate's tests read the columns the shell writes, not a Rust copy of the writer

## What to build

`crates/engine-wasm/src/graph_data/snapshot.rs` is about 1,315 lines, all under `cfg(test)`:
`OwnedColumns`, `OwnedEdgeColumns`, and `EdgeCells` write the columns of a load a second time, as
`packages/comb/src/bridge/columns.ts` writes them for the shell. It grew by 762 lines on
uml-diagrams. Where the two writers differ, the bridge crate's tests decide a load the shell never
hands over.

Evidence: the second review of ticket 06 of uml-diagrams, lesser: the Rust copy never writes
`beside` 4 or 5, so no test of the bridge crate decides the load's refusal of them. Ticket 05,
finding D: the property of the regions never went through the shell's columns, and
`packages/comb/src/bridge/regions.test.ts` was added to cover it.

Let one corpus of graph data decide both: `columns.ts` writes the columns of each case into
fixtures that the Rust tests load, and a TypeScript test fails when a fixture is stale; or a test
holds that the two writers give equal bytes for each case.

## Acceptance criteria

- [ ] Given a case of the corpus, when either writer changes what it writes for it, then a test
      fails.
- [ ] Given the bits of `side` and `offset` in the column `given`, which replaced `beside` 4 and 5
      in ticket 06 of this revision, when the corpus is read, then a case holds each and a Rust
      test decides its refusal.
- [ ] Given `snapshot.rs`, when the work is done, then `OwnedColumns` is smaller or gone, and the
      hand-off says by how many lines.

## Read first

- Touches: `crates/engine-wasm/src/graph_data/snapshot.rs`, `packages/comb/src/bridge/columns.ts`,
  `packages/comb/src/bridge/bridge.test.ts`
- API-bridge-columns-keep-no-size.
- The seam: the bridge crate's tests and `bun test` in `packages/comb/`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the bridge crate and the bridge, protected parts the maintainer reviews
(DEV-implementer-and-fresh-reviewer).
