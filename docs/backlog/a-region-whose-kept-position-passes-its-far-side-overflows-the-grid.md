# A region whose kept position rounds past its far side overflows the spatial grid's count

- **Observed:** in a debug build, `Span::cells` panics on a subtraction that overflows, because
  `r0 > r1`. A region tree whose sizes span about 1e2 to 1e33 reaches it: the region's position,
  kept as `f32`, rounds past the far side of its box, so the grid's first row lies after its last.
  A release build wraps the subtraction instead and counts a wrong number of cells. The review
  of ticket 07 of revision-2026-11-20 found it. It reproduces with the engine's `needs()` as it
  was before that ticket. It is unconfirmed whether graph data the bridge accepts reaches it.
- **Where:** `Span::cells` in `crates/engine/src/spatial.rs`; `lay_out_regions` and `kept` in
  `crates/engine/src/graph/regions.rs`.
