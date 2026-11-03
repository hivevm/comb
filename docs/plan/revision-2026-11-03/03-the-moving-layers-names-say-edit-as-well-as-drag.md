# Ticket: The moving layer's names and comments say edit as well as drag

## What to build

Edits at the far level share the moving layer since
[ADR-0027](../../adr/0027-a-drag-or-an-edit-redraws-what-it-changed.md), but names and comments
still say drag alone:

- `meshOf(..., ofDrag: boolean)` in `packages/comb/src/bridge/index.ts` and
  `meshPtr(moving: bool, buffer)` in `crates/engine-wasm/src/lib.rs` select a mesh by a boolean.
  A `MeshBuffer`-like enum of the two meshes would name it.
- These comments say "drag" only: the comment of `Moving` in `packages/comb/src/bridge/index.ts`,
  of `moving_edges` in `crates/engine-wasm/src/lib.rs`, and of `MeshAt` in
  `crates/engine/src/graph/query.rs`.
- The comment of `DrawnMesh` in `packages/comb/src/render/edges.ts` says the moving mesh names no
  edges, though it passes them.
- The comment of `DrawnEdges` in `packages/comb/src/bridge/index.ts` says "edges the last query
  found", while `drawnEdges` covers the moving mesh's edges too.
- The comment of `meshAt` in `packages/comb/src/bridge/index.ts` cites "(ADR-0027, ADR-0027)", a
  doubled citation the normalization's merge of two ADRs left.

Names and comments follow the concept. No behaviour changes. It waits for ticket 02, which
changes `meshAt` and its comment too.

## Acceptance criteria

- [ ] Given the bridge and the crate, when a mesh is read, then it is selected by a named value
      of the two meshes, not a boolean.
- [ ] Given `git grep -nP 'ADR-(\d{4})\b[^\n]{0,12}?ADR-\1\b'`, when it runs over
      `packages/` and `crates/`, then it finds nothing.
- [ ] Given the comments listed above, when they are read, then each says what the code does for
      a drag and for an edit.
- [ ] Given `scripts/check-all.sh`, when it runs, then it passes.

## Read first

- ADR-0010, ADR-0027.
- `packages/comb/src/bridge/index.ts`, `crates/engine-wasm/src/lib.rs`,
  `packages/comb/src/render/edges.ts`.

## Blocked by

- docs/plan/revision-2026-11-03/02-mesh-at-takes-one-set-of-edge-slots.md

## Mode

with the human: `crates/engine-wasm/` and `packages/comb/src/bridge/` are protected parts of
[ADR-0007](../../adr/0007-harness.md).
