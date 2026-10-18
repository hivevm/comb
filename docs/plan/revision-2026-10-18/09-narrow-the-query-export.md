# Ticket: Narrow the query export and take inspection off its hot path

## What to build

The bridge's `query` export takes eight scalars under `#[allow(clippy::too_many_arguments)]`: a
flattened rectangle, the label reach, and the three fields of `Stroke`, among them the flag
`plain` that `Mesh::add_edge` turns into an early return for the far level. Every query also
computes edge-label slots and points and eight control-point floats per edge
(`crates/engine/src/graph.rs`, `edge_points`), and `EdgesContainer.sync`
(`packages/comb/src/render/edges.ts`) copies the edge slots and those points on every query;
only `comb/testing`'s `inspect()` reads them, and at the far level, which draws no text, the
labels are thrown away. With 50,000 edges zoomed out, that is a full copy per query paid for a
test seam (Q-1).

Shape to propose: the far level as a query of its own (or a `Stroke` that is an enum, not a
flag), labels left out where the level draws none, and the edge ends for `inspect()` computed on
demand from the slots rather than on every query.

## Acceptance criteria

- [ ] Given a query at the far level, when it runs, then the engine computes no edge-label
      placement and no control points, and a Rust test shows it.
- [ ] Given `inspect()`, when a test reads the drawn edges, then it gets the same ends as before,
      computed when asked; the browser tests citing G-7 still pass unchanged.
- [ ] Given `bun run bench`, when the ticket closes, then the pull request reports its numbers
      against the median of three runs before it.

## Read first

- ADR-0010 (streams, views), ADR-0012 (levels of detail), ADR-0009 (the bridge holds no geometry).
- `crates/engine-wasm/src/lib.rs` (`query`), `crates/engine/src/graph.rs` (`query`),
  `crates/engine/src/stroke.rs` (`Stroke`, `add_edge`), `packages/comb/src/bridge/index.ts`,
  `packages/comb/src/render/edges.ts`.

## Blocked by

- docs/plan/revision-2026-10-18/03-adr-0010-revision.md

## Mode

with the human: it changes the bridge's exports, whose data format ADR-0007 keeps with the
maintainer.
