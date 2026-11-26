# `loadGraph`'s positional parameters are restated in five places

- **Observed:** the design revision of 2026-11-20 found this without evidence
  (NUC-design-is-revised §3). The human had it recorded on 2026-11-21.
  - The export `loadGraph` takes about 100 positional parameters, one per column.
  - Their order is restated in the bridge crate, in the shell's bridge, in `testing.ts`, and in
    tests.
  - Tickets 04–06 of uml-diagrams pinned the list again each time they added a column.
  - Folding the columns into fewer parameters would revise "one parameter per column" of
    API-bridge-columns-keep-no-size. That ADR is accepted, so the change needs a superseding ADR.
- **Where:** `crates/engine-wasm/src/lib.rs`, `crates/engine-wasm/src/graph_data/`
  (`node_columns.rs`, `edge_columns.rs`), `packages/comb/src/bridge/columns.ts`,
  `packages/comb/src/bridge/index.ts`, `packages/comb/src/testing.ts`.
