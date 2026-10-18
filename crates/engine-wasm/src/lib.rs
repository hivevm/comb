//! The bridge between the shell and the engine (ADR-0010).
//!
//! Structured data crosses through serde-wasm-bindgen as `Ts<T>`, with TypeScript types tsify
//! generates; node positions and the results of a viewport query cross as buffers the engine
//! owns, which the shell reads as typed-array views created anew after every call.

use std::collections::HashMap;

use comb_engine::geometry::Point;
use comb_engine::geometry::Rect;
use comb_engine::graph::{EdgeSpec, Graph, GraphError, LabelPlacement, Visible};
use comb_engine::positions::PositionError;
use comb_engine::stroke::{EdgeStyle, Stroke};
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

/// A node as the host application hands it over: its identifier, the position of its top-left
/// corner, and its size.
#[derive(Tsify, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Where an edge label sits: path parameter `t` and label offset in pixels (G-6).
#[derive(Tsify, Serialize, Deserialize, Clone, Copy)]
pub struct LabelInput {
    pub t: f64,
    pub offset: f64,
}

/// Whether an arrowhead marks the end of an edge.
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Arrow {
    End,
    None,
}

/// An edge between two nodes, named by their identifiers, with the style it is drawn with: its
/// colour as `0xRRGGBB`, its dash pattern as dash and gap lengths in world units (none for a
/// solid line), and whether an arrowhead marks its end (G-11).
#[derive(Tsify, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInput {
    pub id: String,
    pub source: String,
    pub target: String,
    #[tsify(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<LabelInput>,
    pub color: u32,
    #[tsify(optional)]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dash: Option<[f64; 2]>,
    pub arrow: Arrow,
}

/// The nodes and edges of one load, each in slot order.
#[derive(Tsify, Serialize, Deserialize)]
pub struct GraphBatch {
    pub nodes: Vec<NodeInput>,
    pub edges: Vec<EdgeInput>,
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
    /// A node's width or height is negative, NaN, or infinite.
    #[serde(rename_all = "camelCase")]
    InvalidSize { node: String },
    /// Two nodes share an identifier.
    #[serde(rename_all = "camelCase")]
    DuplicateNode { node: String },
    /// An edge names a node that is not in the batch.
    #[serde(rename_all = "camelCase")]
    MissingNode { edge: String, node: String },
    /// An edge label's path parameter or label offset is NaN or infinite.
    #[serde(rename_all = "camelCase")]
    NonFiniteLabel { edge: String },
    /// An edge's colour lies beyond `0xFFFFFF`.
    #[serde(rename_all = "camelCase")]
    InvalidColor { edge: String },
    /// An edge's dash is not positive or its gap negative, or either is not finite.
    #[serde(rename_all = "camelCase")]
    InvalidDash { edge: String },
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

fn slot(index: usize) -> Result<u32, BridgeError> {
    u32::try_from(index).map_err(malformed)
}

/// The nodes of a batch as the engine takes them: positions and sizes, `x, y` and `width, height`
/// per slot, and the map from identifier to slot.
struct Nodes<'a> {
    positions: Vec<f32>,
    sizes: Vec<f32>,
    slots: HashMap<&'a str, u32>,
}

/// Checks the nodes and flattens them, or names the first offending node.
fn nodes_of(batch: &GraphBatch) -> Result<Nodes<'_>, BridgeError> {
    let mut slots = HashMap::with_capacity(batch.nodes.len());
    let mut positions = Vec::with_capacity(batch.nodes.len() * 2);
    let mut sizes = Vec::with_capacity(batch.nodes.len() * 2);
    for (index, node) in batch.nodes.iter().enumerate() {
        let named = || node.id.clone();
        if !node.x.is_finite() || !node.y.is_finite() {
            return Err(BridgeError::NonFiniteCoordinate { node: named() });
        }
        if !(node.width.is_finite() && node.height.is_finite())
            || node.width < 0.0
            || node.height < 0.0
        {
            return Err(BridgeError::InvalidSize { node: named() });
        }
        if slots.insert(node.id.as_str(), slot(index)?).is_some() {
            return Err(BridgeError::DuplicateNode { node: named() });
        }
        positions.extend([node.x as f32, node.y as f32]);
        sizes.extend([node.width as f32, node.height as f32]);
    }
    Ok(Nodes {
        positions,
        sizes,
        slots,
    })
}

/// The label placement and style of an edge, or why they were refused.
fn placement_of(edge: &EdgeInput) -> Result<(Option<LabelPlacement>, EdgeStyle), BridgeError> {
    let id = || edge.id.clone();
    let label = match edge.label {
        Some(l) if !(l.t.is_finite() && l.offset.is_finite()) => {
            return Err(BridgeError::NonFiniteLabel { edge: id() });
        }
        label => label.map(|l| LabelPlacement {
            t: l.t,
            offset: l.offset,
        }),
    };
    if edge.color > 0xff_ffff {
        return Err(BridgeError::InvalidColor { edge: id() });
    }
    let dash = match edge.dash {
        Some([dash, gap]) if !(dash.is_finite() && gap.is_finite() && dash > 0.0 && gap >= 0.0) => {
            return Err(BridgeError::InvalidDash { edge: id() });
        }
        dash => dash.map(|[dash, gap]| (dash as f32, gap as f32)),
    };
    let style = EdgeStyle {
        color: edge.color,
        dash,
        arrow: edge.arrow == Arrow::End,
    };
    Ok((label, style))
}

/// Resolves every edge's ends to node slots, or names the first offending edge.
fn edges_of(batch: &GraphBatch, slots: &HashMap<&str, u32>) -> Result<Vec<EdgeSpec>, BridgeError> {
    let end = |edge: &EdgeInput, node: &String| {
        slots
            .get(node.as_str())
            .copied()
            .ok_or_else(|| BridgeError::MissingNode {
                edge: edge.id.clone(),
                node: node.clone(),
            })
    };
    batch
        .edges
        .iter()
        .map(|edge| {
            let source = end(edge, &edge.source)?;
            let target = end(edge, &edge.target)?;
            let (label, style) = placement_of(edge)?;
            Ok(EdgeSpec {
                source,
                target,
                label,
                style,
            })
        })
        .collect()
}

/// Checks a batch and builds the engine's graph from it.
fn graph_of(batch: &GraphBatch) -> Result<Graph, BridgeError> {
    let nodes = nodes_of(batch)?;
    let edges = edges_of(batch, &nodes.slots)?;
    Graph::new(nodes.positions, nodes.sizes, edges).map_err(|error| match error {
        GraphError::SlotCountMismatch | GraphError::EdgeEndOutOfRange { .. } => {
            malformed(format!("{error:?}"))
        }
    })
}

/// The engine's state as the shell sees it: the loaded graph, and what the last query found.
#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {
    graph: Graph,
    visible: Visible,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the graph with the batch, node slot `i` for the batch's node `i` and edge slot
    /// `i` for its edge `i`, and returns the number of node slots. A refused batch leaves the
    /// loaded graph as it was.
    #[wasm_bindgen(js_name = loadGraph)]
    pub fn load_graph(&mut self, batch: Ts<GraphBatch>) -> Result<u32, BridgeError> {
        let batch = batch.to_rust().map_err(malformed)?;
        self.graph = graph_of(&batch)?;
        self.visible = Visible::default();
        slot(batch.nodes.len())
    }

    /// Moves the nodes in `slots` by `(dx, dy)`, their edges with them.
    pub fn translate(&mut self, slots: &[u32], dx: f32, dy: f32) -> Result<(), BridgeError> {
        self.graph
            .translate(slots, dx, dy)
            .map_err(BridgeError::from)
    }

    /// Finds the nodes and edges that meet the rectangle and the edge labels within
    /// `label_reach` of it, and builds the mesh of the edges, flattened within `tolerance` and
    /// `width` wide, as thin lines alone where `plain`; the results are read through the
    /// `visible…` and `mesh…` buffers.
    #[allow(clippy::too_many_arguments)]
    pub fn query(
        &mut self,
        min_x: f64,
        min_y: f64,
        max_x: f64,
        max_y: f64,
        label_reach: f64,
        tolerance: f64,
        width: f64,
        plain: bool,
    ) {
        let rect = Rect::new(min_x, min_y, max_x, max_y);
        let stroke = Stroke {
            tolerance,
            width,
            plain,
        };
        self.graph
            .query(&rect, label_reach, &stroke, &mut self.visible);
    }

    /// The slot of the node drawn on top at the world point `(x, y)`, if any.
    pub fn hit(&mut self, x: f64, y: f64) -> Option<u32> {
        self.graph.hit(Point::new(x, y))
    }
}

/// The buffers the shell reads, each as a pointer into WebAssembly memory and a length in values.
#[wasm_bindgen]
impl Engine {
    /// Where the positions buffer, `x, y` per node slot starts.
    #[wasm_bindgen(js_name = positionsPtr)]
    pub fn positions_ptr(&self) -> *const f32 {
        self.graph.positions().as_ptr()
    }

    /// How many values the positions buffer holds.
    #[wasm_bindgen(js_name = positionsLen)]
    pub fn positions_len(&self) -> usize {
        self.graph.positions().len()
    }

    /// Where the node slots the last query found starts.
    #[wasm_bindgen(js_name = visibleNodesPtr)]
    pub fn visible_nodes_ptr(&self) -> *const u32 {
        self.visible.nodes.as_ptr()
    }

    /// How many values the node slots the last query found holds.
    #[wasm_bindgen(js_name = visibleNodesLen)]
    pub fn visible_nodes_len(&self) -> usize {
        self.visible.nodes.len()
    }

    /// Where the edge slots the last query found starts.
    #[wasm_bindgen(js_name = visibleEdgesPtr)]
    pub fn visible_edges_ptr(&self) -> *const u32 {
        self.visible.edges.as_ptr()
    }

    /// How many values the edge slots the last query found holds.
    #[wasm_bindgen(js_name = visibleEdgesLen)]
    pub fn visible_edges_len(&self) -> usize {
        self.visible.edges.len()
    }

    /// Where the four control points of each edge the last query found, `x, y` each starts.
    #[wasm_bindgen(js_name = edgePointsPtr)]
    pub fn edge_points_ptr(&self) -> *const f32 {
        self.visible.edge_points.as_ptr()
    }

    /// How many values the four control points of each edge the last query found holds.
    #[wasm_bindgen(js_name = edgePointsLen)]
    pub fn edge_points_len(&self) -> usize {
        self.visible.edge_points.len()
    }

    /// Where the edge slots of the labels the last query found starts.
    #[wasm_bindgen(js_name = visibleLabelsPtr)]
    pub fn visible_labels_ptr(&self) -> *const u32 {
        self.visible.labels.as_ptr()
    }

    /// How many values the edge slots of the labels the last query found holds.
    #[wasm_bindgen(js_name = visibleLabelsLen)]
    pub fn visible_labels_len(&self) -> usize {
        self.visible.labels.len()
    }

    /// Where the point of each label the last query found, `x, y` starts.
    #[wasm_bindgen(js_name = labelPointsPtr)]
    pub fn label_points_ptr(&self) -> *const f32 {
        self.visible.label_points.as_ptr()
    }

    /// How many values the point of each label the last query found holds.
    #[wasm_bindgen(js_name = labelPointsLen)]
    pub fn label_points_len(&self) -> usize {
        self.visible.label_points.len()
    }
    /// Where the mesh's vertex positions, `x, y` each starts.
    #[wasm_bindgen(js_name = meshPositionsPtr)]
    pub fn mesh_positions_ptr(&self) -> *const f32 {
        self.visible.mesh.positions.as_ptr()
    }

    /// How many values the mesh's vertex positions holds.
    #[wasm_bindgen(js_name = meshPositionsLen)]
    pub fn mesh_positions_len(&self) -> usize {
        self.visible.mesh.positions.len()
    }

    /// Where the mesh's distance along its path per vertex starts.
    #[wasm_bindgen(js_name = meshDistancesPtr)]
    pub fn mesh_distances_ptr(&self) -> *const f32 {
        self.visible.mesh.distances.as_ptr()
    }

    /// How many values the mesh's distance along its path per vertex holds.
    #[wasm_bindgen(js_name = meshDistancesLen)]
    pub fn mesh_distances_len(&self) -> usize {
        self.visible.mesh.distances.len()
    }

    /// Where the mesh's colour per vertex, as RGBA bytes starts.
    #[wasm_bindgen(js_name = meshColorsPtr)]
    pub fn mesh_colors_ptr(&self) -> *const u32 {
        self.visible.mesh.colors.as_ptr()
    }

    /// How many values the mesh's colour per vertex holds.
    #[wasm_bindgen(js_name = meshColorsLen)]
    pub fn mesh_colors_len(&self) -> usize {
        self.visible.mesh.colors.len()
    }

    /// Where the mesh's dash pattern per vertex, `dash, gap` starts.
    #[wasm_bindgen(js_name = meshDashesPtr)]
    pub fn mesh_dashes_ptr(&self) -> *const f32 {
        self.visible.mesh.dashes.as_ptr()
    }

    /// How many values the mesh's dash pattern per vertex holds.
    #[wasm_bindgen(js_name = meshDashesLen)]
    pub fn mesh_dashes_len(&self) -> usize {
        self.visible.mesh.dashes.len()
    }

    /// Where the mesh's vertex indices, three per triangle starts.
    #[wasm_bindgen(js_name = meshIndicesPtr)]
    pub fn mesh_indices_ptr(&self) -> *const u32 {
        self.visible.mesh.indices.as_ptr()
    }

    /// How many values the mesh's vertex indices holds.
    #[wasm_bindgen(js_name = meshIndicesLen)]
    pub fn mesh_indices_len(&self) -> usize {
        self.visible.mesh.indices.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(nodes: &[(&str, f64, f64)], edges: &[(&str, &str, &str)]) -> GraphBatch {
        GraphBatch {
            nodes: nodes
                .iter()
                .map(|&(id, x, y)| NodeInput {
                    id: id.into(),
                    x,
                    y,
                    width: 100.0,
                    height: 50.0,
                })
                .collect(),
            edges: edges
                .iter()
                .map(|&(id, source, target)| EdgeInput {
                    id: id.into(),
                    source: source.into(),
                    target: target.into(),
                    label: None,
                    color: 0x9a_a1ad,
                    dash: None,
                    arrow: Arrow::End,
                })
                .collect(),
        }
    }

    #[test]
    fn a_batch_flattens_into_slot_order() {
        let data = batch(&[("a", 1.0, 2.0), ("b", 3.0, 4.0)], &[]);
        let nodes = nodes_of(&data).unwrap();
        assert_eq!(nodes.positions, [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(nodes.sizes, [100.0, 50.0, 100.0, 50.0]);
    }

    #[test]
    fn a_non_finite_coordinate_names_its_node() {
        let error = graph_of(&batch(&[("a", 0.0, 0.0), ("b", f64::NAN, 0.0)], &[])).unwrap_err();
        assert_eq!(error, BridgeError::NonFiniteCoordinate { node: "b".into() });
    }

    #[test]
    fn a_size_that_is_negative_or_not_finite_names_its_node() {
        for (width, height) in [(-1.0, 10.0), (10.0, f64::INFINITY), (f64::NAN, 10.0)] {
            let mut data = batch(&[("a", 0.0, 0.0)], &[]);
            data.nodes[0].width = width;
            data.nodes[0].height = height;
            let error = graph_of(&data).unwrap_err();
            assert_eq!(error, BridgeError::InvalidSize { node: "a".into() });
        }
    }

    #[test]
    fn a_duplicate_identifier_names_its_node() {
        let error = graph_of(&batch(&[("a", 0.0, 0.0), ("a", 1.0, 1.0)], &[])).unwrap_err();
        assert_eq!(error, BridgeError::DuplicateNode { node: "a".into() });
    }

    #[test]
    fn an_edge_to_a_missing_node_names_the_edge_and_the_node() {
        let error = graph_of(&batch(&[("a", 0.0, 0.0)], &[("e", "a", "z")])).unwrap_err();
        assert_eq!(
            error,
            BridgeError::MissingNode {
                edge: "e".into(),
                node: "z".into()
            }
        );
    }

    #[test]
    fn a_non_finite_label_names_its_edge() {
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
        data.edges[0].label = Some(LabelInput {
            t: f64::NAN,
            offset: 0.0,
        });
        let error = graph_of(&data).unwrap_err();
        assert_eq!(error, BridgeError::NonFiniteLabel { edge: "e".into() });
    }

    #[test]
    fn a_colour_beyond_rgb_or_a_bad_dash_names_its_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let mut data = batch(&two, &[("e", "a", "b")]);
        data.edges[0].color = 0x100_0000;
        assert_eq!(
            graph_of(&data).unwrap_err(),
            BridgeError::InvalidColor { edge: "e".into() }
        );
        for dash in [
            [0.0, 4.0],
            [6.0, -1.0],
            [f64::NAN, 4.0],
            [6.0, f64::INFINITY],
        ] {
            let mut data = batch(&two, &[("e", "a", "b")]);
            data.edges[0].dash = Some(dash);
            assert_eq!(
                graph_of(&data).unwrap_err(),
                BridgeError::InvalidDash { edge: "e".into() }
            );
        }
    }

    #[test]
    fn edges_resolve_to_the_slots_of_their_nodes() {
        let data = batch(
            &[("a", 0.0, 0.0), ("b", 300.0, 0.0), ("c", 600.0, 0.0)],
            &[("e", "c", "a")],
        );
        let edges = edges_of(&data, &nodes_of(&data).unwrap().slots).unwrap();
        assert_eq!((edges[0].source, edges[0].target), (2, 0));
    }
}
