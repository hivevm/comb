//! The bridge between the shell and the engine (ADR-0010).
//!
//! Structured data crosses through serde-wasm-bindgen as `Ts<T>`, with TypeScript types tsify
//! generates; node positions and the results of a viewport query cross as buffers the engine
//! owns, which the shell reads as typed-array views created anew after every call.

use std::collections::{HashMap, HashSet};
use std::fmt;

use comb_engine::geometry::Point;
use comb_engine::geometry::Rect;
use comb_engine::graph::{self, EdgeSpec, Graph, GraphError, LabelPlacement, Level, Visible};
use comb_engine::positions::PositionError;
use comb_engine::stroke::EdgeStyle;
use serde::de::{self, IgnoredAny, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

/// The most UTF-16 code units, the length JavaScript gives a string, of a node's title or an edge
/// label's text.
pub const MAX_TEXT: usize = 1_000;

/// The most nodes, and the most edges, of one graph.
pub const MAX_ITEMS: u32 = 1_000_000;

/// The most UTF-16 code units of an identifier: a node's or an edge's, or an edge's source or
/// target.
pub const MAX_ID: usize = 256;

/// The most UTF-16 code units of all identifiers of one load together, sources and targets
/// among them, so that the identifiers of a graph within its other limits cost a bounded copy.
pub const MAX_ID_UNITS: u32 = 64_000_000;

/// The length of a text in UTF-16 code units, as JavaScript counts it.
fn utf16_length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// The length in UTF-16 code units of a field the engine does not keep, or none where it holds
/// no string. A value of another type is refused naming its node or edge and the field, not as
/// malformed data; serde-wasm-bindgen gives each value a deserializer of its own, so the refused
/// one leaves the rest to read. The text itself is not kept: the bridge only checks it.
fn text_length<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<usize>, D::Error> {
    Ok(String::deserialize(deserializer)
        .ok()
        .map(|text| utf16_length(&text)))
}

/// A field the engine does not keep that holds a number or nothing: `None` for null or
/// undefined, NaN for a value of another type, a BigInt among them, so that the check refuses
/// it by name.
fn optional_number<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<f64>, D::Error> {
    Ok(Option::<f64>::deserialize(deserializer).unwrap_or(Some(f64::NAN)))
}

/// A value of the patch of `updateNode`: the string it holds, or none where it holds a value of
/// another type.
pub struct Text(pub Option<String>);

impl<'de> Deserialize<'de> for Text {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self(String::deserialize(deserializer).ok()))
    }
}

/// A node as the host application hands it over: its identifier, its title, the position of its
/// top-left corner, and its size.
#[derive(Tsify, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    pub id: String,
    /// Missing, it is refused by name, which makes it optional in the generated type.
    #[tsify(type = "string")]
    #[serde(rename = "title", default, deserialize_with = "text_length")]
    pub title_length: Option<usize>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// An edge label: its text, where it sits by path parameter `t` and label offset in pixels
/// (G-6), and the colour of its background as `0xRRGGBB`, the edge's own without one.
#[derive(Tsify, Deserialize, Clone, Copy)]
pub struct LabelInput {
    #[tsify(type = "string")]
    #[serde(rename = "text", default, deserialize_with = "text_length")]
    pub text_length: Option<usize>,
    pub t: f64,
    pub offset: f64,
    #[tsify(optional)]
    #[serde(default, deserialize_with = "optional_number")]
    pub background: Option<f64>,
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
#[derive(Tsify, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInput {
    pub id: String,
    pub source: String,
    pub target: String,
    #[tsify(optional)]
    #[serde(default)]
    pub label: Option<LabelInput>,
    pub color: u32,
    #[tsify(optional)]
    #[serde(default)]
    pub dash: Option<[f64; 2]>,
    pub arrow: Arrow,
}

/// The nodes and edges of one load, each in slot order.
#[derive(Tsify, Deserialize)]
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
    /// A node's title, in a load or a patch, is not a string.
    #[serde(rename_all = "camelCase")]
    InvalidTitle { node: String },
    /// A node's title, in a load or a patch, is longer than `limit` UTF-16 code units.
    #[serde(rename_all = "camelCase")]
    TitleTooLong { node: String, limit: u32 },
    /// A patch of a node holds a field other than its title.
    #[serde(rename_all = "camelCase")]
    UnknownPatchField { node: String, field: String },
    /// Two nodes share an identifier.
    #[serde(rename_all = "camelCase")]
    DuplicateNode { node: String },
    /// Two edges share an identifier.
    #[serde(rename_all = "camelCase")]
    DuplicateEdge { edge: String },
    /// An edge names a node that is not in the batch.
    #[serde(rename_all = "camelCase")]
    MissingNode { edge: String, node: String },
    /// An edge label's path parameter or label offset is NaN or infinite.
    #[serde(rename_all = "camelCase")]
    NonFiniteLabel { edge: String },
    /// An edge label's text is not a string.
    #[serde(rename_all = "camelCase")]
    InvalidLabelText { edge: String },
    /// An edge label's text is longer than `limit` UTF-16 code units.
    #[serde(rename_all = "camelCase")]
    LabelTextTooLong { edge: String, limit: u32 },
    /// An edge label's background is not an integer from `0` to `0xFFFFFF`.
    #[serde(rename_all = "camelCase")]
    InvalidBackground { edge: String },
    /// An edge's colour lies beyond `0xFFFFFF`.
    #[serde(rename_all = "camelCase")]
    InvalidColor { edge: String },
    /// An edge's dash is not positive or its gap negative, or either is not finite.
    #[serde(rename_all = "camelCase")]
    InvalidDash { edge: String },
    /// A graph holds more than `limit` nodes or edges; `list` names which.
    #[serde(rename_all = "camelCase")]
    TooMany { list: String, limit: u32 },
    /// An identifier is longer than `limit` UTF-16 code units: `field` (`id`, `source`, or
    /// `target`) of the item at `index` of `list` (`nodes` or `edges`).
    #[serde(rename_all = "camelCase")]
    IdTooLong {
        list: String,
        index: u32,
        field: String,
        limit: u32,
    },
    /// The identifiers of one load hold more than `limit` UTF-16 code units together.
    #[serde(rename_all = "camelCase")]
    IdBudgetExceeded { limit: u32 },
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

/// A value that does not have the shape an export expects. Its message is the bridge's own: the
/// value is not formatted into it, so that a refused value of any size costs no copy.
fn unshaped(_error: impl std::fmt::Display) -> BridgeError {
    malformed("the value does not have the shape the bridge expects")
}

fn malformed(error: impl std::fmt::Display) -> BridgeError {
    BridgeError::Malformed {
        message: error.to_string(),
    }
}

/// A graph the engine refuses after the bridge's own checks is malformed data. Each refusal is
/// named, so that a new one is decided here rather than passed on by default.
impl From<GraphError> for BridgeError {
    fn from(error: GraphError) -> Self {
        match error {
            GraphError::SlotCountMismatch
            | GraphError::EdgeEndOutOfRange { .. }
            | GraphError::TooManySlots => malformed(format!("{error:?}")),
        }
    }
}

/// The engine's conversion of a count to slots, so that both refuse the same counts.
fn slot(index: usize) -> Result<u32, BridgeError> {
    Ok(graph::slot(index)?)
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
        // Checked as the engine keeps them: a number beyond `f32` is as infinite as infinity.
        let [x, y, width, height] = [node.x, node.y, node.width, node.height].map(|v| v as f32);
        if !x.is_finite() || !y.is_finite() {
            return Err(BridgeError::NonFiniteCoordinate { node: named() });
        }
        if !(width.is_finite() && height.is_finite()) || width < 0.0 || height < 0.0 {
            return Err(BridgeError::InvalidSize { node: named() });
        }
        match node.title_length {
            None => return Err(BridgeError::InvalidTitle { node: named() }),
            Some(length) if length > MAX_TEXT => {
                return Err(BridgeError::TitleTooLong {
                    node: named(),
                    limit: MAX_TEXT as u32,
                });
            }
            Some(_) => {}
        }
        if slots.insert(node.id.as_str(), slot(index)?).is_some() {
            return Err(BridgeError::DuplicateNode { node: named() });
        }
        positions.extend([x, y]);
        sizes.extend([width, height]);
    }
    Ok(Nodes {
        positions,
        sizes,
        slots,
    })
}

/// Whether `value` is a colour `0xRRGGBB`: an integer from `0` to `0xFFFFFF`.
fn rgb(value: f64) -> bool {
    value.fract() == 0.0 && (0.0..=f64::from(0xff_ffff)).contains(&value)
}

/// The label placement and style of an edge, or why they were refused.
fn placement_of(edge: &EdgeInput) -> Result<(Option<LabelPlacement>, EdgeStyle), BridgeError> {
    let id = || edge.id.clone();
    let label = match edge.label {
        Some(l) if !(l.t.is_finite() && l.offset.is_finite()) => {
            return Err(BridgeError::NonFiniteLabel { edge: id() });
        }
        Some(l) if l.text_length.is_none() => {
            return Err(BridgeError::InvalidLabelText { edge: id() });
        }
        Some(l) if l.text_length > Some(MAX_TEXT) => {
            return Err(BridgeError::LabelTextTooLong {
                edge: id(),
                limit: MAX_TEXT as u32,
            });
        }
        Some(LabelInput {
            background: Some(b),
            ..
        }) if !rgb(b) => {
            return Err(BridgeError::InvalidBackground { edge: id() });
        }
        label => label.map(|l| LabelPlacement {
            t: l.t,
            offset: l.offset,
        }),
    };
    if !rgb(f64::from(edge.color)) {
        return Err(BridgeError::InvalidColor { edge: id() });
    }
    // Checked as the engine keeps it, so that a dash too short for `f32` is refused too.
    let dash = match edge.dash.map(|[dash, gap]| (dash as f32, gap as f32)) {
        Some((dash, gap)) if !(dash.is_finite() && gap.is_finite() && dash > 0.0 && gap >= 0.0) => {
            return Err(BridgeError::InvalidDash { edge: id() });
        }
        dash => dash,
    };
    let style = EdgeStyle {
        color: edge.color,
        dash,
        arrow: edge.arrow == Arrow::End,
    };
    Ok((label, style))
}

/// Resolves every edge's ends to node slots, or names the first offending edge: the second of
/// two that share an identifier, or one whose ends, label, or style were refused.
fn edges_of(batch: &GraphBatch, slots: &HashMap<&str, u32>) -> Result<Vec<EdgeSpec>, BridgeError> {
    let mut seen = HashSet::with_capacity(batch.edges.len());
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
            if !seen.insert(edge.id.as_str()) {
                return Err(BridgeError::DuplicateEdge {
                    edge: edge.id.clone(),
                });
            }
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
/// Checks the length of every identifier of a batch, and of all of them together.
fn ids_of(batch: &GraphBatch) -> Result<(), BridgeError> {
    let mut units = 0;
    let mut add = |list: &str, index: usize, field: &str, id: &str| {
        let length = utf16_length(id);
        if length > MAX_ID {
            return Err(BridgeError::IdTooLong {
                list: list.to_owned(),
                index: slot(index)?,
                field: field.to_owned(),
                limit: MAX_ID as u32,
            });
        }
        units += length;
        Ok(())
    };
    for (index, node) in batch.nodes.iter().enumerate() {
        add("nodes", index, "id", &node.id)?;
    }
    for (index, edge) in batch.edges.iter().enumerate() {
        add("edges", index, "id", &edge.id)?;
        add("edges", index, "source", &edge.source)?;
        add("edges", index, "target", &edge.target)?;
    }
    check_id_budget(units as f64)
}

fn graph_of(batch: &GraphBatch) -> Result<Graph, BridgeError> {
    check_graph_size(batch.nodes.len() as f64, batch.edges.len() as f64)?;
    ids_of(batch)?;
    let nodes = nodes_of(batch)?;
    let edges = edges_of(batch, &nodes.slots)?;
    Ok(Graph::new(nodes.positions, nodes.sizes, edges)?)
}

/// The attributes `updateNode` changes on a node, by name: only its title, a string. Read from a
/// plain object alone: `api` hands over a copy whose values are primitives, and `false` in place
/// of a patch that is no plain object, a `Map` or an array among them, which is refused as
/// malformed. No value of the host application, and none of its code, reaches the bridge.
#[derive(Tsify)]
#[tsify(type = "{ title?: string }")]
pub struct NodePatch(pub Vec<(String, Text)>);

impl<'de> Deserialize<'de> for NodePatch {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(PatchVisitor)
    }
}

struct PatchVisitor;

impl<'de> Visitor<'de> for PatchVisitor {
    type Value = NodePatch;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("an object")
    }

    /// Keeps the fields up to the first other than `title`, which is refused, and passes over
    /// the rest unread, so that a patch of many fields costs no copy of them.
    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<NodePatch, A::Error> {
        let mut fields = Vec::new();
        while let Some(field) = map.next_key::<String>()? {
            let other = field != "title";
            fields.push((field, map.next_value()?));
            if other {
                while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                break;
            }
        }
        Ok(NodePatch(fields))
    }
}

/// The most UTF-16 code units of a title or a label text, `MAX_TEXT`: the shell hands over no
/// more than one beyond it, so that a text of any length costs at most that much to check.
#[wasm_bindgen(js_name = textLimit)]
pub fn text_limit() -> u32 {
    MAX_TEXT as u32
}

/// The most UTF-16 code units of an identifier, `MAX_ID`: the shell hands over no more than one
/// beyond it.
#[wasm_bindgen(js_name = idLimit)]
pub fn id_limit() -> u32 {
    MAX_ID as u32
}

/// The most UTF-16 code units of all identifiers of one load, `MAX_ID_UNITS`: the shell stops
/// reading a graph whose identifiers hold more, and hands over their count.
#[wasm_bindgen(js_name = idBudget)]
pub fn id_budget() -> u32 {
    MAX_ID_UNITS
}

/// Checks how many UTF-16 code units the identifiers of one load hold together.
#[wasm_bindgen(js_name = checkIdBudget)]
pub fn check_id_budget(units: f64) -> Result<(), BridgeError> {
    if units.is_nan() || units < 0.0 {
        return Err(malformed("the count of identifier code units is no count"));
    }
    if units > f64::from(MAX_ID_UNITS) {
        return Err(BridgeError::IdBudgetExceeded {
            limit: MAX_ID_UNITS,
        });
    }
    Ok(())
}

/// Checks how many nodes and edges a graph holds, before the shell copies any of them: at most
/// `MAX_ITEMS` of each. A count that is no whole number from 0 is no list's length.
#[wasm_bindgen(js_name = checkGraphSize)]
pub fn check_graph_size(nodes: f64, edges: f64) -> Result<(), BridgeError> {
    for (list, count) in [("nodes", nodes), ("edges", edges)] {
        if !(count >= 0.0 && count.fract() == 0.0) {
            return Err(malformed(format!("{list} is not a list")));
        }
        if count > f64::from(MAX_ITEMS) {
            return Err(BridgeError::TooMany {
                list: list.to_owned(),
                limit: MAX_ITEMS,
            });
        }
    }
    Ok(())
}

/// A patch of a node as the bridge checked it: what the store merges, and nothing else.
#[derive(Tsify, Serialize, Debug, PartialEq, Default)]
pub struct CheckedPatch {
    #[tsify(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// Checks a patch of the node `node` and returns the fields it changes, or names its first
/// offending field.
fn patch_of(node: &str, patch: NodePatch) -> Result<CheckedPatch, BridgeError> {
    let mut checked = CheckedPatch::default();
    for (field, Text(value)) in patch.0 {
        if field != "title" {
            return Err(BridgeError::UnknownPatchField {
                node: node.to_owned(),
                field,
            });
        }
        let title = value.ok_or_else(|| BridgeError::InvalidTitle {
            node: node.to_owned(),
        })?;
        if utf16_length(&title) > MAX_TEXT {
            return Err(BridgeError::TitleTooLong {
                node: node.to_owned(),
                limit: MAX_TEXT as u32,
            });
        }
        checked.title = Some(title);
    }
    Ok(checked)
}

/// Checks the patch `updateNode` hands over for the node `node`, reading it once, and returns
/// the fields it changes, which the store merges in its place; the engine keeps nothing of it.
#[wasm_bindgen(js_name = checkNodePatch)]
pub fn check_node_patch(node: &str, patch: Ts<NodePatch>) -> Result<Ts<CheckedPatch>, BridgeError> {
    let checked = patch_of(node, patch.to_rust().map_err(unshaped)?)?;
    Ts::from_rust(&checked).map_err(malformed)
}

/// A rectangle in world coordinates, as a query asks for it.
#[derive(Tsify, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectInput {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// The level of detail a query serves (ADR-0012).
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DetailLevel {
    Near,
    Middle,
    Far,
}

impl From<DetailLevel> for Level {
    fn from(level: DetailLevel) -> Self {
        match level {
            DetailLevel::Near => Self::Near,
            DetailLevel::Middle => Self::Middle,
            DetailLevel::Far => Self::Far,
        }
    }
}

/// The engine's state as the shell sees it: the loaded graph, and what the last query found.
#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {
    graph: Graph,
    visible: Visible,
    ends: Vec<f32>,
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
        let batch = batch.to_rust().map_err(unshaped)?;
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

    /// Finds the nodes and edges that meet the rectangle and builds the mesh of the edges for
    /// `level`, where a screen pixel is `pixel` world units; at the near level also the edge
    /// labels within `label_reach` of it. The results are read through the `visible…` and
    /// `mesh…` buffers.
    pub fn query(
        &mut self,
        rect: Ts<RectInput>,
        level: DetailLevel,
        pixel: f64,
        label_reach: f64,
    ) -> Result<(), BridgeError> {
        let rect = rect.to_rust().map_err(unshaped)?;
        let rect = Rect::new(rect.min_x, rect.min_y, rect.max_x, rect.max_y);
        self.graph
            .query(&rect, level.into(), pixel, label_reach, &mut self.visible);
        Ok(())
    }

    /// Computes the ends of the edges the last query found, read through the `edgeEnds…` buffer:
    /// for inspection, not for drawing.
    #[wasm_bindgen(js_name = drawnEdges)]
    pub fn drawn_edges(&mut self) {
        self.graph.edge_ends(&self.visible.edges, &mut self.ends);
    }

    /// The slot of the node drawn on top at the world point `(x, y)`, if any.
    pub fn hit(&mut self, x: f64, y: f64) -> Option<u32> {
        self.graph.hit(Point::new(x, y))
    }
}

/// The buffers the shell reads, each as a pointer into WebAssembly memory and a length in values.
#[wasm_bindgen]
impl Engine {
    /// Where the positions buffer starts, which `loadGraph` and `translate` write: `x, y` per node
    /// slot.
    #[wasm_bindgen(js_name = positionsPtr)]
    pub fn positions_ptr(&self) -> *const f32 {
        self.graph.positions().as_ptr()
    }

    /// How many values the positions buffer holds: two per node slot.
    #[wasm_bindgen(js_name = positionsLen)]
    pub fn positions_len(&self) -> usize {
        self.graph.positions().len()
    }

    /// Where the buffer starts that `query` writes the node slots it found into.
    #[wasm_bindgen(js_name = visibleNodesPtr)]
    pub fn visible_nodes_ptr(&self) -> *const u32 {
        self.visible.nodes.as_ptr()
    }

    /// How many node slots the last `query` wrote.
    #[wasm_bindgen(js_name = visibleNodesLen)]
    pub fn visible_nodes_len(&self) -> usize {
        self.visible.nodes.len()
    }

    /// Where the buffer starts that `query` writes the edge slots it found into.
    #[wasm_bindgen(js_name = visibleEdgesPtr)]
    pub fn visible_edges_ptr(&self) -> *const u32 {
        self.visible.edges.as_ptr()
    }

    /// How many edge slots the last `query` wrote.
    #[wasm_bindgen(js_name = visibleEdgesLen)]
    pub fn visible_edges_len(&self) -> usize {
        self.visible.edges.len()
    }

    /// Where the buffer starts that `drawnEdges` writes into: per edge slot the query before it
    /// found, `x, y` of its source end, then of its target end.
    #[wasm_bindgen(js_name = edgeEndsPtr)]
    pub fn edge_ends_ptr(&self) -> *const f32 {
        self.ends.as_ptr()
    }

    /// How many values the last `drawnEdges` wrote: four per edge, `x, y` of each of its two ends.
    #[wasm_bindgen(js_name = edgeEndsLen)]
    pub fn edge_ends_len(&self) -> usize {
        self.ends.len()
    }

    /// Where the buffer starts that `query` writes the edge slots of the labels it found into.
    #[wasm_bindgen(js_name = visibleLabelsPtr)]
    pub fn visible_labels_ptr(&self) -> *const u32 {
        self.visible.labels.as_ptr()
    }

    /// How many label slots the last `query` wrote.
    #[wasm_bindgen(js_name = visibleLabelsLen)]
    pub fn visible_labels_len(&self) -> usize {
        self.visible.labels.len()
    }

    /// Where the buffer starts that `query` writes the point of each label it found into: `x, y`
    /// per label slot.
    #[wasm_bindgen(js_name = labelPointsPtr)]
    pub fn label_points_ptr(&self) -> *const f32 {
        self.visible.label_points.as_ptr()
    }

    /// How many values of label points the last `query` wrote: two per label slot.
    #[wasm_bindgen(js_name = labelPointsLen)]
    pub fn label_points_len(&self) -> usize {
        self.visible.label_points.len()
    }

    /// Where the buffer starts that `query` writes the mesh's vertex positions into: `x, y` per
    /// vertex.
    #[wasm_bindgen(js_name = meshPositionsPtr)]
    pub fn mesh_positions_ptr(&self) -> *const f32 {
        self.visible.mesh.positions.as_ptr()
    }

    /// How many values of vertex positions the last `query` wrote: two per vertex.
    #[wasm_bindgen(js_name = meshPositionsLen)]
    pub fn mesh_positions_len(&self) -> usize {
        self.visible.mesh.positions.len()
    }

    /// Where the buffer starts that `query` writes the mesh's distance along its path into: one
    /// per vertex.
    #[wasm_bindgen(js_name = meshDistancesPtr)]
    pub fn mesh_distances_ptr(&self) -> *const f32 {
        self.visible.mesh.distances.as_ptr()
    }

    /// How many distances the last `query` wrote: one per vertex.
    #[wasm_bindgen(js_name = meshDistancesLen)]
    pub fn mesh_distances_len(&self) -> usize {
        self.visible.mesh.distances.len()
    }

    /// Where the buffer starts that `query` writes the mesh's colours into: one per vertex, as
    /// RGBA bytes.
    #[wasm_bindgen(js_name = meshColorsPtr)]
    pub fn mesh_colors_ptr(&self) -> *const u32 {
        self.visible.mesh.colors.as_ptr()
    }

    /// How many colours the last `query` wrote: one per vertex.
    #[wasm_bindgen(js_name = meshColorsLen)]
    pub fn mesh_colors_len(&self) -> usize {
        self.visible.mesh.colors.len()
    }

    /// Where the buffer starts that `query` writes the mesh's dash patterns into: `dash, gap` per
    /// vertex.
    #[wasm_bindgen(js_name = meshDashesPtr)]
    pub fn mesh_dashes_ptr(&self) -> *const f32 {
        self.visible.mesh.dashes.as_ptr()
    }

    /// How many values of dash patterns the last `query` wrote: two per vertex.
    #[wasm_bindgen(js_name = meshDashesLen)]
    pub fn mesh_dashes_len(&self) -> usize {
        self.visible.mesh.dashes.len()
    }

    /// Where the buffer starts that `query` writes the mesh's vertex indices into: three per
    /// triangle.
    #[wasm_bindgen(js_name = meshIndicesPtr)]
    pub fn mesh_indices_ptr(&self) -> *const u32 {
        self.visible.mesh.indices.as_ptr()
    }

    /// How many vertex indices the last `query` wrote: three per triangle.
    #[wasm_bindgen(js_name = meshIndicesLen)]
    pub fn mesh_indices_len(&self) -> usize {
        self.visible.mesh.indices.len()
    }
}

#[cfg(test)]
mod properties;

// The malformed-data tests below verify ADR-0010: every export that receives graph data returns a
// typed error that names the offender, and none panics.
// Verifies: ADR-0010
#[cfg(test)]
mod tests {
    use super::*;

    fn batch(nodes: &[(&str, f64, f64)], edges: &[(&str, &str, &str)]) -> GraphBatch {
        GraphBatch {
            nodes: nodes
                .iter()
                .map(|&(id, x, y)| NodeInput {
                    id: id.into(),
                    title_length: Some(1),
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
    fn a_number_beyond_f32_is_refused_as_a_non_finite_one() {
        let error = graph_of(&batch(&[("a", 1e300, 0.0)], &[])).unwrap_err();
        assert_eq!(error, BridgeError::NonFiniteCoordinate { node: "a".into() });
        let mut data = batch(&[("a", 0.0, 0.0)], &[]);
        data.nodes[0].width = 1e300;
        assert_eq!(
            graph_of(&data).unwrap_err(),
            BridgeError::InvalidSize { node: "a".into() }
        );
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let mut data = batch(&two, &[("e", "a", "b")]);
        data.edges[0].dash = Some([1e-300, 1e300]);
        assert_eq!(
            graph_of(&data).unwrap_err(),
            BridgeError::InvalidDash { edge: "e".into() }
        );
    }

    #[test]
    fn a_duplicate_identifier_names_its_node() {
        let error = graph_of(&batch(&[("a", 0.0, 0.0), ("a", 1.0, 1.0)], &[])).unwrap_err();
        assert_eq!(error, BridgeError::DuplicateNode { node: "a".into() });
    }

    #[test]
    fn a_duplicate_identifier_names_its_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let error = graph_of(&batch(&two, &[("e", "a", "b"), ("e", "b", "a")])).unwrap_err();
        assert_eq!(error, BridgeError::DuplicateEdge { edge: "e".into() });
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
            text_length: Some(1),
            t: f64::NAN,
            offset: 0.0,
            background: None,
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
    fn a_title_that_is_not_text_names_its_node() {
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        data.nodes[1].title_length = None;
        assert_eq!(
            graph_of(&data).unwrap_err(),
            BridgeError::InvalidTitle { node: "b".into() }
        );
    }

    #[test]
    fn a_label_text_or_background_pixi_cannot_draw_names_its_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let label = |text, background| {
            let mut data = batch(&two, &[("e", "a", "b")]);
            data.edges[0].label = Some(LabelInput {
                text_length: text,
                t: 0.5,
                offset: 0.0,
                background,
            });
            graph_of(&data)
        };
        assert!(label(Some(1), None).is_ok());
        assert!(label(Some(1), Some(0.0)).is_ok());
        assert!(label(Some(1), Some(f64::from(0xff_ffff))).is_ok());
        assert_eq!(
            label(None, None).unwrap_err(),
            BridgeError::InvalidLabelText { edge: "e".into() }
        );
        for background in [-5.0, 1.5, f64::NAN, 1e20, f64::from(0x100_0000)] {
            assert_eq!(
                label(Some(1), Some(background)).unwrap_err(),
                BridgeError::InvalidBackground { edge: "e".into() }
            );
        }
    }

    #[test]
    fn a_text_longer_than_its_limit_names_its_node_or_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let mut data = batch(&two, &[("e", "a", "b")]);
        data.nodes[0].title_length = Some(MAX_TEXT);
        data.edges[0].label = Some(LabelInput {
            text_length: Some(MAX_TEXT),
            t: 0.5,
            offset: 0.0,
            background: None,
        });
        assert!(graph_of(&data).is_ok());
        data.nodes[0].title_length = Some(MAX_TEXT + 1);
        assert_eq!(
            graph_of(&data).unwrap_err(),
            BridgeError::TitleTooLong {
                node: "a".into(),
                limit: 1_000
            }
        );
        data.nodes[0].title_length = Some(MAX_TEXT);
        if let Some(label) = data.edges[0].label.as_mut() {
            label.text_length = Some(MAX_TEXT + 1);
        }
        assert_eq!(
            graph_of(&data).unwrap_err(),
            BridgeError::LabelTextTooLong {
                edge: "e".into(),
                limit: 1_000
            }
        );
        // JavaScript's length: a character beyond the basic plane counts twice.
        assert_eq!(utf16_length(&"\u{1F600}".repeat(500)), 1_000);
    }

    #[test]
    fn an_identifier_beyond_its_limit_or_the_budget_is_refused() {
        let long = "x".repeat(MAX_ID);
        let longer = "x".repeat(MAX_ID + 1);
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
        data.nodes[1].id = long.clone();
        data.edges[0].target = long;
        assert!(graph_of(&data).is_ok());
        data.edges[0].source = longer;
        assert_eq!(
            graph_of(&data).unwrap_err(),
            BridgeError::IdTooLong {
                list: "edges".into(),
                index: 0,
                field: "source".into(),
                limit: 256
            }
        );
        assert_eq!(check_id_budget(64e6), Ok(()));
        assert_eq!(
            check_id_budget(64e6 + 1.0),
            Err(BridgeError::IdBudgetExceeded { limit: 64_000_000 })
        );
        assert!(matches!(
            check_id_budget(f64::NAN),
            Err(BridgeError::Malformed { .. })
        ));
    }

    #[test]
    fn a_load_counts_the_code_units_of_all_its_identifiers_against_the_budget() {
        let id = |i: usize| format!("{i:0>256}");
        let nodes = |count: usize| GraphBatch {
            nodes: (0..count)
                .map(|i| NodeInput {
                    id: id(i),
                    title_length: Some(1),
                    x: 0.0,
                    y: 0.0,
                    width: 1.0,
                    height: 1.0,
                })
                .collect(),
            edges: Vec::new(),
        };
        // 250,000 identifiers of 256 code units hold 64,000,000 together.
        assert_eq!(ids_of(&nodes(250_000)), Ok(()));
        assert_eq!(
            ids_of(&nodes(250_001)),
            Err(BridgeError::IdBudgetExceeded { limit: 64_000_000 })
        );
    }

    #[test]
    fn a_graph_beyond_a_million_nodes_or_edges_is_refused_naming_the_list() {
        assert_eq!(check_graph_size(1e6, 1e6), Ok(()));
        let too_many = |list: &str| BridgeError::TooMany {
            list: list.into(),
            limit: 1_000_000,
        };
        assert_eq!(check_graph_size(1e6 + 1.0, 0.0), Err(too_many("nodes")));
        assert_eq!(
            check_graph_size(0.0, 4_294_967_295.0),
            Err(too_many("edges"))
        );
        for count in [f64::NAN, -1.0, 0.5] {
            assert!(matches!(
                check_graph_size(count, 0.0),
                Err(BridgeError::Malformed { .. })
            ));
        }
    }

    #[test]
    fn a_patch_with_another_field_or_a_title_not_text_names_its_node() {
        let patch = |entries: &[(&str, Option<&str>)]| {
            let text = |v: Option<&str>| Text(v.map(str::to_owned));
            let fields = entries.iter().map(|&(k, v)| (k.to_owned(), text(v)));
            patch_of("a", NodePatch(fields.collect()))
        };
        assert_eq!(patch(&[]), Ok(CheckedPatch { title: None }));
        assert_eq!(
            patch(&[("title", Some("A"))]),
            Ok(CheckedPatch {
                title: Some("A".into())
            })
        );
        assert_eq!(
            patch(&[("title", Some("A")), ("width", None)]),
            Err(BridgeError::UnknownPatchField {
                node: "a".into(),
                field: "width".into()
            })
        );
        let long = "x".repeat(MAX_TEXT + 1);
        assert_eq!(
            patch(&[("title", Some(long.as_str()))]),
            Err(BridgeError::TitleTooLong {
                node: "a".into(),
                limit: 1_000
            })
        );
        assert_eq!(
            patch(&[("title", None)]),
            Err(BridgeError::InvalidTitle { node: "a".into() })
        );
    }

    #[test]
    fn a_count_beyond_u32_is_refused_as_the_engine_refuses_it() {
        let beyond = u32::MAX as usize + 1;
        assert_eq!(slot(u32::MAX as usize), Ok(u32::MAX));
        assert_eq!(
            slot(beyond),
            Err(BridgeError::from(graph::slot(beyond).unwrap_err()))
        );
        assert_eq!(
            slot(beyond),
            Err(BridgeError::Malformed {
                message: "TooManySlots".into()
            })
        );
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
