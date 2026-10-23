# Ticket: Edges far from the origin keep Q-4 in the vertices the bridge hands over

## What to build

The engine computes edge paths in f64, but the edge mesh crosses the bridge as f32 vertices
(ADR-0010). Near ±5e7 world units an f32 rounds by up to about 2 world units, about 8 px at a
scale of 4, while the query reports the mesh complete (found by the work on the mesh budget).
Q-4 asks for 0.5 px for everything the viewport shows. The engine hands over vertices relative
to an origin near the query's rectangle, and the shell offsets the mesh by that origin, so the
rounding is that of the distance to the rectangle, not to the world's origin. How the origin
crosses is a revision of ADR-0010, in a pull request of ADRs only, before the code.

## Acceptance criteria

- [ ] Given an edge from (5e7, 0) to (5e7 + 300, 200) and a viewport on it at scale 4, when it
      is drawn, then every vertex the shell draws lies within a quarter pixel of the engine's f64
      stroke (`Verifies: Q-4`).
- [ ] Given the benchmark's graph, when its first frame and gestures are measured, then Q-1 and
      Q-2 hold as before.
- [ ] Broken once: with the origin left at (0, 0), the first criterion's test fails.

## Read first

- `docs/SPECIFICATION.md` Q-4; ADR-0010 (*Streams*), ADR-0012 (*The rectangle*, *Mesh budget*).
- `crates/engine/src/stroke.rs`, `crates/engine-wasm/src/lib.rs` (`query`),
  `packages/comb/src/render/edges.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: the origin of the vertices changes the data format of the bridge, a protected
part of ADR-0007.
