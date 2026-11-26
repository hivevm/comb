# A patch of content of a divided node is not checked against the world's limit

- **Observed:** `updateNode` checks a division against the world's limit only where the patch
  sets regions. A patch that sets content alone on a node already divided calls `set_top`, which
  lays the regions out again below a new `top`. That grows the node by the new content's height,
  but `within_world_divided` does not see it. `within_by_height` checks the node's height before
  the regions are laid out, not the height they grow it to. A font handed over after a load does
  the same: `lay_out_heights` gives every divided node a new `top` through `set_top`, whose
  `arrange` lays the regions out again unchecked. The review of ticket 07 of revision-2026-11-20
  found both.
- **Where:** `update_node_in` and `divide_anew` in `crates/engine-wasm/src/graph_data/update.rs`;
  `lay_out_heights` in `crates/engine-wasm/src/lib.rs`; `within_world_divided` in
  `crates/engine-wasm/src/graph_data/regions.rs`; `set_top` and `arrange` in
  `crates/engine/src/graph/regions.rs`.
