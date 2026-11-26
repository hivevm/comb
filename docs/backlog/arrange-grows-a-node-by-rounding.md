# A divided node grows by a rounding error each time its regions are laid out again

- **Observed:** `arrange` is not idempotent. After a layout, the last region keeps the rest it
  took as its size, each region's extent kept as `f32`. Their sum, read back as `f64`, can pass
  the node's `f32` height by a rounding error, so the next `arrange` grows the node by that much.
  The property test of ticket 05 of revision-2026-11-20 found it: `updateNode` arranged twice and
  gave a node 187.24788 high where a load gave 187.24786. That ticket made each division arrange
  once, but `set_top` on each change of the fonts and a resize still arrange a laid-out division
  again, so a node may creep taller over many of them.
- **Where:** `arrange`, `needs`, and `lay_out_regions` in `crates/engine/src/graph/regions.rs`;
  `lay_out_heights` in `crates/engine-wasm/src/lib.rs`.
