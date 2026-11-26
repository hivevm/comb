# A node a load puts in a region can lie past the world's limit once the regions are laid out

- **Observed:** a load checks a node's world position against the world's limit while the regions
  of a divided node still lie at its origin. The layout then moves each region to its place, and
  a node it holds keeps its position relative to the region, so that node can come to lie past
  `WORLD_LIMIT`, finite in `f32` still. The re-review of ticket 07 of revision-2026-11-20 probed
  it: a node divided across into 5 regions of `WORLD_LIMIT / 5`; in its fifth region a node at
  `(-0.99, -0.99) × WORLD_LIMIT`, itself divided across into 2 regions of `0.98 × WORLD_LIMIT`.
  The far side of the inner node then lies at about `1.77 × WORLD_LIMIT`.
- **Where:** `world_of` and `load_of` in `crates/engine-wasm/src/graph_data/load.rs`;
  `within_world_divided` in `crates/engine-wasm/src/graph_data/regions.rs`; `lay_out_regions` in
  `crates/engine/src/graph/regions.rs`.
