//! The bridge between the shell and the engine (ADR-0010).
//!
//! Structured data crosses through serde-wasm-bindgen as `Ts<T>`, with TypeScript types tsify
//! generates; node positions cross as a buffer the engine owns, which the shell reads as a
//! `Float32Array` view created anew after every call.

use std::collections::HashSet;

use comb_engine::geometry::{EdgePath, Point};
use comb_engine::positions::{self, PositionError};
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

/// How far an edge's control points pull out of its connectors at least, in pixels.
const MIN_PULL: f64 = 40.0;

/// A node as the host application hands it over.
#[derive(Tsify, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

/// The nodes of one load, in slot order.
#[derive(Tsify, Serialize, Deserialize)]
pub struct NodeBatch {
    pub nodes: Vec<NodeInput>,
}

/// A point in world coordinates.
#[derive(Tsify, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

/// Why the engine refused graph data (Q-7).
#[derive(Tsify, Serialize, Deserialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BridgeError {
    /// The value did not have the shape the export expects.
    #[serde(rename_all = "camelCase")]
    Malformed { message: String },
    /// A node's coordinate is NaN or infinite.
    #[serde(rename_all = "camelCase")]
    NonFiniteCoordinate { node: String },
    /// Two nodes share an identifier.
    #[serde(rename_all = "camelCase")]
    DuplicateNode { node: String },
    /// A slot beyond the loaded nodes.
    #[serde(rename_all = "camelCase")]
    SlotOutOfRange { slot: u32 },
    /// A delta that is NaN or infinite.
    NonFiniteDelta,
}

impl From<PositionError> for BridgeError {
    fn from(error: PositionError) -> Self {
        match error {
            PositionError::SlotOutOfRange { slot } => Self::SlotOutOfRange { slot },
            PositionError::NonFinite => Self::NonFiniteDelta,
        }
    }
}

impl From<BridgeError> for JsValue {
    fn from(error: BridgeError) -> Self {
        error
            .into_ts()
            .map_or_else(|_| JsValue::from_str("comb: bridge error"), JsValue::from)
    }
}

fn malformed(error: impl std::fmt::Display) -> BridgeError {
    BridgeError::Malformed {
        message: error.to_string(),
    }
}

/// Checks a batch and flattens it into `x, y` per slot, or names the first offending node.
fn positions_of(batch: &NodeBatch) -> Result<Vec<f32>, BridgeError> {
    let mut seen = HashSet::with_capacity(batch.nodes.len());
    let mut positions = Vec::with_capacity(batch.nodes.len() * 2);
    for node in &batch.nodes {
        if !node.x.is_finite() || !node.y.is_finite() {
            return Err(BridgeError::NonFiniteCoordinate {
                node: node.id.clone(),
            });
        }
        if !seen.insert(node.id.as_str()) {
            return Err(BridgeError::DuplicateNode {
                node: node.id.clone(),
            });
        }
        positions.extend([node.x as f32, node.y as f32]);
    }
    Ok(positions)
}

/// The engine's state as the shell sees it: the node positions it owns.
#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {
    positions: Vec<f32>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces every node with the batch, slot `i` for the batch's node `i`, and returns the
    /// number of slots. A refused batch leaves the loaded nodes as they were.
    #[wasm_bindgen(js_name = loadNodes)]
    pub fn load_nodes(&mut self, batch: Ts<NodeBatch>) -> Result<u32, BridgeError> {
        let batch = batch.to_rust().map_err(malformed)?;
        self.positions = positions_of(&batch)?;
        u32::try_from(batch.nodes.len()).map_err(malformed)
    }

    /// Moves the nodes in `slots` by `(dx, dy)`.
    pub fn translate(&mut self, slots: &[u32], dx: f32, dy: f32) -> Result<(), BridgeError> {
        positions::translate(&mut self.positions, slots, dx, dy).map_err(BridgeError::from)
    }

    /// Where the positions buffer starts in WebAssembly memory.
    #[wasm_bindgen(js_name = positionsPtr)]
    pub fn positions_ptr(&self) -> *const f32 {
        self.positions.as_ptr()
    }

    /// How many `f32` values the positions buffer holds: two per slot.
    #[wasm_bindgen(js_name = positionsLen)]
    pub fn positions_len(&self) -> usize {
        self.positions.len()
    }
}

fn edge_path(source: &Ts<Vec2>, target: &Ts<Vec2>) -> Result<EdgePath, BridgeError> {
    let source = source.to_rust().map_err(malformed)?;
    let target = target.to_rust().map_err(malformed)?;
    Ok(EdgePath::horizontal(
        Point::new(source.x, source.y),
        Point::new(target.x, target.y),
        MIN_PULL,
    ))
}

/// The four control points of the edge from `source` to `target`, as `x, y` pairs.
#[wasm_bindgen(js_name = edgeControlPoints)]
pub fn edge_control_points(source: Ts<Vec2>, target: Ts<Vec2>) -> Result<Vec<f32>, BridgeError> {
    let path = edge_path(&source, &target)?;
    Ok([
        path.source,
        path.control_source,
        path.control_target,
        path.target,
    ]
    .iter()
    .flat_map(|p| [p.x as f32, p.y as f32])
    .collect())
}

/// Where an edge label with path parameter `t` and label offset `offset` sits (G-6).
#[wasm_bindgen(js_name = labelPosition)]
pub fn label_position(
    source: Ts<Vec2>,
    target: Ts<Vec2>,
    t: f64,
    offset: f64,
) -> Result<Ts<Vec2>, BridgeError> {
    let point = edge_path(&source, &target)?.label_position(t, offset);
    Vec2 {
        x: point.x,
        y: point.y,
    }
    .into_ts()
    .map_err(malformed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(nodes: &[(&str, f64, f64)]) -> NodeBatch {
        NodeBatch {
            nodes: nodes
                .iter()
                .map(|&(id, x, y)| NodeInput {
                    id: id.into(),
                    x,
                    y,
                })
                .collect(),
        }
    }

    #[test]
    fn a_batch_flattens_into_slot_order() {
        let positions = positions_of(&batch(&[("a", 1.0, 2.0), ("b", 3.0, 4.0)])).unwrap();
        assert_eq!(positions, [1.0, 2.0, 3.0, 4.0]);
    }

    #[test]
    fn a_non_finite_coordinate_names_its_node() {
        let error = positions_of(&batch(&[("a", 0.0, 0.0), ("b", f64::NAN, 0.0)])).unwrap_err();
        assert_eq!(error, BridgeError::NonFiniteCoordinate { node: "b".into() });
    }

    #[test]
    fn a_duplicate_identifier_names_its_node() {
        let error = positions_of(&batch(&[("a", 0.0, 0.0), ("a", 1.0, 1.0)])).unwrap_err();
        assert_eq!(error, BridgeError::DuplicateNode { node: "a".into() });
    }
}
