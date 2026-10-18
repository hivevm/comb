# Ticket: Revise ADR-0010 to the streams that cross the bridge

## What to build

A revision of the proposed ADR-0010, in a pull request of ADRs only, developed with the
maintainer. Its *Streams* name node positions, edge path points, and culling results. The `query`
export also writes edge-label slots and points, edge control points, and five buffers of the edge
mesh (positions, distances, colours, dashes, indices) for the shell to read as views, none of them
named. Its *Streams* clause also says "the bridge keeps the map from identifiers to slots on both
sides in step", but `crates/engine-wasm` builds that map while loading and drops it; only the
TypeScript side keeps one. The decision to take: list the mesh and the label streams, and say
whether the Rust side keeps a map (it will need one once *Editing* deletes and connects by
identifier) or the clause means the TypeScript side.

## Acceptance criteria

- [ ] Given the revised ADR-0010, when it is read beside `crates/engine-wasm/src/lib.rs` and
      `packages/comb/src/bridge/index.ts`, then every buffer the bridge reads is a named stream,
      and the identifier map clause says which side keeps it.
- [ ] Given the revision, when it lands, then its pull request holds ADRs only.

## Read first

- ADR-0010 in full, the `propose-adr` skill.
- `crates/engine-wasm/src/lib.rs` (`query`, `nodes_of`, `Engine`),
  `packages/comb/src/bridge/index.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: an ADR is developed with the maintainer, and the bridge's data format is a
protected part of ADR-0007.
