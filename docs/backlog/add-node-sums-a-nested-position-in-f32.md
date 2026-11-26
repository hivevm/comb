# addNode sums a nested node's world position from its container's rounded one

- **Observed:** a load sums a nested node's world position along its chain of containers in `f64`
  and rounds it to `f32` once. `addNode` adds the node's relative position to its container's
  world position, which the engine keeps in `f32`, already rounded. The two can differ by a unit
  in the last place of an `f32`, and a region's extent, taken between two such positions, with
  them. The property of ticket 12 of revision-2026-11-20 compares their boxes within two such
  units for that reason. A sum in `f64` from the container's `f32` position does not close the
  gap at depth 2 and more: the exact sum of the chain is no longer at hand.
- **Where:** `add_node_to` in `crates/engine-wasm/src/graph_data/load.rs`; `world_of` in the same
  file; `alike` in `crates/engine-wasm/src/properties.rs`.
