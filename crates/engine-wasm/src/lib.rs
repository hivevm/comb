//! The bridge between the shell and the engine (ADR-0034).
//!
//! Structured data crosses through serde-wasm-bindgen as `Ts<T>`, with TypeScript types tsify
//! generates; the graph data of a load crosses as columns, each a string in pieces or one typed
//! array; node positions and the results of a viewport query cross as buffers the engine owns,
//! which the shell reads as typed-array views created anew after every call.
//!
//! This root holds the exports and their conversions; the reading and checking of graph data,
//! which the bridge alone does (ADR-0028), is the module `graph_data`.

#![cfg_attr(
    test,
    allow(
        clippy::cast_possible_truncation,
        reason = "test code narrows the fixtures it builds; the lint holds the code that ships"
    )
)]

mod graph_data;

use comb_engine::content::{Cell, Font, Fonts, Placed};
use comb_engine::geometry::Point;
use comb_engine::geometry::Rect;
use comb_engine::graph::{
    Graph, Level, MoveError, PositionError, SlotError as GraphSlotError, Target, Visible,
};
use comb_engine::stroke::Detail;
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

pub use graph_data::{
    Arrow, ArrowCode, ContentElement, DirectionCode, EdgeField, EdgeInput, EdgePatch, ElementHit,
    ElementKind, Field, GraphDataProblem, GraphList, KindCode, LabelInput, MAX_COLUMNS,
    MAX_CONTENT_UNITS, MAX_ID, MAX_ID_UNITS, MAX_ITEMS, MAX_ROWS, MAX_SEGMENTS, MAX_TEXT,
    NodeContent, NodeField, NodeInput, NodePatch, Pair, RoleCode, Segment, Side, SideCode,
    TextRole, Trend, TrendDirection,
};

use graph_data::{
    COLUMN_LIMIT, ContentData, ContentStore, Drawn, EdgeColumns, EdgeRefusal, ID_LIMIT,
    NodeColumns, ROW_LIMIT, SEGMENT_LIMIT, TEXT_LIMIT, add_edge_to, add_node_to, edge_refused_of,
    load_of, malformed, patch_of, refused_of, slot, unshaped, update_edge_in,
};

/// A number the shell computed that an export cannot take: the shell's own mistake, never one of
/// graph data, so that a host application never meets it (ADR-0031). Its kind names the number.
#[derive(Tsify, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NumberError {
    /// A world point of `hit` or `moveLabel` with a coordinate that is NaN or infinite.
    NonFinitePoint,
    /// A screen pixel of `query` or `hit` that is not a finite number above zero.
    InvalidPixel,
    /// A delta of `translate` that is NaN or infinite.
    NonFiniteDelta,
    /// A font of `setFont` whose role names none, or whose metrics do not pair up or are not
    /// finite numbers from 0 to 1,024.
    InvalidFont,
}

/// The refusal of `translate`'s delta, under the name it had before `NumberError` held it. A slot
/// that holds no node is refused with a `SlotError`, as every export that takes slots refuses one.
pub type TranslateError = NumberError;

/// Why `hit`, `query`, or `moveLabel` was refused, as the shell receives it: a problem of graph
/// data, a slot that holds nothing, or a number the shell computed (ADR-0031).
#[derive(Debug, PartialEq)]
pub enum CallRefusal {
    Data(GraphDataProblem),
    Slot(SlotError),
    Number(NumberError),
}

impl From<GraphDataProblem> for CallRefusal {
    fn from(problem: GraphDataProblem) -> Self {
        Self::Data(problem)
    }
}

impl From<GraphSlotError> for CallRefusal {
    fn from(error: GraphSlotError) -> Self {
        Self::Slot(error.into())
    }
}

impl From<NumberError> for CallRefusal {
    fn from(error: NumberError) -> Self {
        Self::Number(error)
    }
}

/// Why `translate` was refused, as the shell receives it: a slot that holds no node, crossing as
/// `SlotError`, or a delta that is not finite, crossing as `TranslateError`.
#[derive(Debug, PartialEq)]
pub enum TranslateRefusal {
    Slot(SlotError),
    Delta(TranslateError),
}

/// Why the engine refused a call that names slots: a slot that holds no node or no edge, beyond
/// the slots or free. The shell's own mistake, never one of graph data, since `api` refuses an
/// identifier the graph does not hold before it names a slot (ADR-0028).
#[derive(Tsify, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SlotError {
    /// A slot that holds no node.
    #[serde(rename_all = "camelCase")]
    NoNode { slot: u32 },
    /// A slot that holds no edge.
    #[serde(rename_all = "camelCase")]
    NoEdge { slot: u32 },
}

impl From<GraphSlotError> for SlotError {
    fn from(error: GraphSlotError) -> Self {
        match error {
            GraphSlotError::NoNode { slot } => Self::NoNode { slot },
            GraphSlotError::NoEdge { slot } => Self::NoEdge { slot },
        }
    }
}

impl From<MoveError> for TranslateRefusal {
    fn from(error: MoveError) -> Self {
        match error {
            MoveError::Slot(error) => Self::Slot(error.into()),
            MoveError::Position(PositionError::NonFinite) => {
                Self::Delta(TranslateError::NonFiniteDelta)
            }
        }
    }
}

/// An error as the shell receives it: the generated value, or a message where it cannot be
/// built.
fn thrown<T: Tsify + Serialize>(error: T) -> JsValue
where
    T::JsType: Into<JsValue>,
{
    error
        .into_ts()
        .map_or_else(|_| JsValue::from_str("comb: bridge error"), Into::into)
}

impl From<GraphDataProblem> for JsValue {
    fn from(error: GraphDataProblem) -> Self {
        thrown(error)
    }
}

impl From<TranslateRefusal> for JsValue {
    fn from(refusal: TranslateRefusal) -> Self {
        match refusal {
            TranslateRefusal::Slot(error) => thrown(error),
            TranslateRefusal::Delta(error) => thrown(error),
        }
    }
}

impl From<SlotError> for JsValue {
    fn from(error: SlotError) -> Self {
        thrown(error)
    }
}

impl From<CallRefusal> for JsValue {
    fn from(refusal: CallRefusal) -> Self {
        match refusal {
            CallRefusal::Data(problem) => problem.into(),
            CallRefusal::Slot(error) => thrown(error),
            CallRefusal::Number(error) => thrown(error),
        }
    }
}

impl From<EdgeRefusal> for JsValue {
    fn from(refusal: EdgeRefusal) -> Self {
        match refusal {
            EdgeRefusal::Data(problem) => problem.into(),
            EdgeRefusal::Slot(error) => SlotError::from(error).into(),
        }
    }
}

/// The size of a screen pixel, in world units, a query and a hit test take, or its refusal as the
/// shell's mistake where it is no finite number above zero, before any edge is flattened
/// (ADR-0031).
fn checked_pixel(pixel: f64) -> Result<f64, NumberError> {
    if pixel.is_finite() && pixel > 0.0 {
        Ok(pixel)
    } else {
        Err(NumberError::InvalidPixel)
    }
}

/// The world point `(x, y)` a hit test or a label's move takes, or its refusal as the shell's
/// mistake where a coordinate is NaN or infinite, before anything is hit or moved (ADR-0031).
fn checked_point(x: f64, y: f64) -> Result<Point, NumberError> {
    if x.is_finite() && y.is_finite() {
        Ok(Point::new(x, y))
    } else {
        Err(NumberError::NonFinitePoint)
    }
}

/// The most UTF-16 code units of a text of node content or a label text, `MAX_TEXT`: the shell
/// hands over no more than one beyond it, so that a text of any length costs at most that much to
/// check.
#[wasm_bindgen(js_name = textLimit)]
pub fn text_limit() -> u32 {
    TEXT_LIMIT
}

/// The most UTF-16 code units of an identifier, `MAX_ID`: the shell hands over no more than one
/// beyond it.
#[wasm_bindgen(js_name = idLimit)]
pub fn id_limit() -> u32 {
    ID_LIMIT
}

/// The most UTF-16 code units of all identifiers of one load, `MAX_ID_UNITS`: the shell stops
/// reading a graph whose identifiers hold more, and hands over their count.
#[wasm_bindgen(js_name = idBudget)]
pub fn id_budget() -> u32 {
    MAX_ID_UNITS
}

/// Checks how many UTF-16 code units the identifiers of one load hold together.
#[wasm_bindgen(js_name = checkIdBudget)]
pub fn check_id_budget(units: f64) -> Result<(), GraphDataProblem> {
    graph_data::check_id_budget(units)
}

/// Checks how many nodes and edges a graph holds, before the shell copies any of them: at most
/// `MAX_ITEMS` of each. A count that is no whole number from 0 is no list's length.
#[wasm_bindgen(js_name = checkGraphSize)]
pub fn check_graph_size(nodes: f64, edges: f64) -> Result<(), GraphDataProblem> {
    graph_data::check_graph_size(nodes, edges)
}

/// The most UTF-16 code units of the strings of all content of one load, `MAX_CONTENT_UNITS`: the
/// shell stops reading a graph whose content holds more, and hands over their count.
#[wasm_bindgen(js_name = contentBudget)]
pub fn content_budget() -> u32 {
    MAX_CONTENT_UNITS
}

/// Checks how many UTF-16 code units the strings of content of one load hold together, `units`,
/// as the shell counted them while it read them, and names the node `node` whose string passed
/// the budget (ADR-0034).
#[wasm_bindgen(js_name = checkContentBudget)]
pub fn check_content_budget(units: f64, node: &str) -> Result<(), GraphDataProblem> {
    graph_data::check_content_budget(node, units)
}

/// The space between a badge's text and its pill's left and right sides, in world units: the
/// engine's, by which the shell places the text on the pill the engine laid out (ADR-0013).
#[wasm_bindgen(js_name = badgePaddingX)]
pub fn badge_padding_x() -> f64 {
    comb_engine::content::BADGE_PADDING_X
}

/// The space between a badge's text and its pill's top and bottom, in world units, as
/// `badgePaddingX`.
#[wasm_bindgen(js_name = badgePaddingY)]
pub fn badge_padding_y() -> f64 {
    comb_engine::content::BADGE_PADDING_Y
}

/// The most rows of a node's content, `MAX_ROWS`: the shell hands over no more than one beyond
/// it.
#[wasm_bindgen(js_name = rowLimit)]
pub fn row_limit() -> u32 {
    ROW_LIMIT
}

/// The most columns of a row of a node's content, `MAX_COLUMNS`: the shell hands over no more
/// than one beyond it.
#[wasm_bindgen(js_name = columnLimit)]
pub fn column_limit() -> u32 {
    COLUMN_LIMIT
}

/// The most segments of a progress bar of a node's content, `MAX_SEGMENTS`: the shell hands over
/// no more than one beyond it.
#[wasm_bindgen(js_name = segmentLimit)]
pub fn segment_limit() -> u32 {
    SEGMENT_LIMIT
}

/// What a press hits (ADR-0013): a connector by the slot of its node and its side, a label by the
/// slot of its edge, a node by its slot and the element of its content drawn there, where one is
/// (ADR-0013), an edge by its slot, or nothing; one generated value (ADR-0034).
#[derive(Tsify, Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Hit {
    None,
    Connector {
        slot: u32,
        side: Side,
    },
    Label {
        slot: u32,
    },
    Node {
        slot: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        #[tsify(optional)]
        element: Option<ElementHit>,
    },
    Edge {
        slot: u32,
    },
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

/// The level of detail a query serves (ADR-0027).
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

/// The detail of a query's edge mesh (ADR-0027): complete, or coarsened where an edge was drawn
/// as its chord, or left out, for the mesh budget or for memory.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MeshDetail {
    Complete,
    Coarsened,
}

impl From<Detail> for MeshDetail {
    fn from(detail: Detail) -> Self {
        match detail {
            Detail::Complete => Self::Complete,
            Detail::Coarsened => Self::Coarsened,
        }
    }
}

/// A trap on demand, in test mode only (ADR-0021), so that the shell's tests provoke the loss of
/// the engine without depending on a trap the checks may close. The feature `test-mode` builds it
/// into the engine the tests run; the production build carries none of it, and
/// scripts/check-bundle.sh fails an engine file that names its export.
#[cfg(feature = "test-mode")]
mod trap {
    use std::sync::atomic::{AtomicBool, Ordering};

    static ARMED: AtomicBool = AtomicBool::new(false);

    /// Arms the trap: the next call of an `Engine` traps while it holds the engine. Exported
    /// without the glue, so that both builds share one glue.
    #[unsafe(no_mangle)]
    pub extern "C" fn comb_test_mode_trap() {
        ARMED.store(true, Ordering::Relaxed);
    }

    /// Traps, a WebAssembly `unreachable`, where the trap is armed.
    pub fn spring() {
        if ARMED.swap(false, Ordering::Relaxed) {
            std::process::abort();
        }
    }
}

/// Without the feature `test-mode`, no trap.
#[cfg(not(feature = "test-mode"))]
mod trap {
    #[inline(always)]
    pub const fn spring() {}
}

/// The engine's state as the shell sees it: the loaded graph, the content of its nodes and the
/// fonts it is laid out in (ADR-0013), and what the last query found.
#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {
    graph: Graph,
    visible: Visible,
    ends: Vec<f32>,
    fonts: Fonts,
    /// The content of the nodes the graph holds and the code units of its strings (ADR-0013).
    content: ContentStore,
    /// Of the nodes the last query found at the near or middle level, in its order, the
    /// boundaries of each one's elements in `placed`.
    content_bounds: Vec<u32>,
    placed: Vec<Placed>,
    /// `x, y, width, height` of each element of `placed`, as the shell reads them.
    content_rects: Vec<f32>,
    /// The role and the drawn text of each element of `placed`.
    drawn: Drawn,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self::default()
    }

    /// Replaces the graph with a load, node slot `i` for its node `i` and edge slot `i` for its
    /// edge `i`, and returns the number of node slots. The nodes and the edges cross as columns
    /// (ADR-0034), each in slot order, and serde-wasm-bindgen converts nothing of a load. Of the
    /// nodes: the identifiers as pieces of at most 2^28 UTF-16 code units, each ending where a
    /// value ends, with the boundaries across all pieces in UTF-16 code units, the numbers as
    /// `Float64Array`, the content as the columns of `ContentColumns`, its texts in pieces as the
    /// identifiers are, with per text whether it is a text, and the first value the shell refused
    /// by its type, the index of its node, the code of its `NodeField`, and for a shape of content
    /// its row and column, or none. Each node is as high as its content lays out to in the fonts
    /// `setFont` handed over (ADR-0013). Of the edges: the identifiers, sources, targets, and label
    /// texts each as pieces with their boundaries, per label text whether it is a text; whether a
    /// label, its background, and a dash are present, as bytes; the label's `t` and offset, the
    /// background, the colour, and the dash and gap as `Float64Array`; the arrowhead and the sides
    /// as the codes of `ArrowCode` and `SideCode`; and the first value the shell refused by its
    /// type, the index of its edge and the code of its `EdgeField`, or none. A refused load leaves
    /// the loaded graph as it was.
    #[wasm_bindgen(js_name = loadGraph)]
    #[expect(
        clippy::too_many_arguments,
        reason = "one parameter per column, each a type wasm-bindgen hands over in one copy, \
                  or one per piece (ADR-0034)"
    )]
    #[expect(
        clippy::needless_pass_by_value,
        reason = "wasm-bindgen hands a list of strings over as an owned `Vec<String>` only"
    )]
    pub fn load_graph(
        &mut self,
        ids: Vec<String>,
        id_bounds: &[u32],
        x: &[f64],
        y: &[f64],
        width: &[f64],
        row_bounds: Vec<u32>,
        element_bounds: Vec<u32>,
        kinds: Vec<u8>,
        weights: Vec<f64>,
        roles: Vec<u8>,
        directions: Vec<u8>,
        colors: Vec<f64>,
        segment_bounds: Vec<u32>,
        fractions: Vec<f64>,
        segment_colors: Vec<f64>,
        texts: Vec<String>,
        text_bounds: Vec<u32>,
        text_valid: Vec<u8>,
        names: Vec<String>,
        name_bounds: Vec<u32>,
        name_valid: Vec<u8>,
        refused_at: Option<u32>,
        refused_field: Option<u32>,
        refused_row: Option<u32>,
        refused_column: Option<u32>,
        edge_ids: Vec<String>,
        edge_id_bounds: &[u32],
        sources: Vec<String>,
        source_bounds: &[u32],
        targets: Vec<String>,
        target_bounds: &[u32],
        has_label: &[u8],
        labels: Vec<String>,
        label_bounds: &[u32],
        label_texts: &[u8],
        label_t: &[f64],
        label_offset: &[f64],
        has_background: &[u8],
        background: &[f64],
        color: &[f64],
        has_dash: &[u8],
        dash: &[f64],
        gap: &[f64],
        arrow: &[u8],
        source_side: &[u8],
        target_side: &[u8],
        edge_refused_at: Option<u32>,
        edge_refused_field: Option<u32>,
    ) -> Result<u32, GraphDataProblem> {
        trap::spring();
        let refused = refused_of(refused_at, refused_field, refused_row, refused_column)?;
        let edges = EdgeColumns {
            ids: &edge_ids,
            id_bounds: edge_id_bounds,
            sources: &sources,
            source_bounds,
            targets: &targets,
            target_bounds,
            has_label,
            labels: &labels,
            label_bounds,
            label_texts,
            label_t,
            label_offset,
            has_background,
            background,
            color,
            has_dash,
            dash,
            gap,
            arrow,
            source_side,
            target_side,
            refused: edge_refused_of(edge_refused_at, edge_refused_field)?,
        };
        // The content's columns, which the engine keeps as they crossed, owned without a copy.
        let mut content = ContentData {
            row_bounds,
            element_bounds,
            kinds,
            weights,
            roles,
            directions,
            colors,
            segment_bounds,
            fractions,
            segment_colors,
            texts,
            text_bounds,
            text_valid,
            names,
            name_bounds,
            name_valid,
            ..ContentData::default()
        };
        let nodes = NodeColumns {
            ids: &ids,
            id_bounds,
            x,
            y,
            width,
            content: content.view(),
            refused,
        };
        let loaded = load_of(&nodes, &edges, &self.fonts)?;
        self.graph = loaded.graph;
        content.spans = loaded.spans;
        content.name_spans = loaded.name_spans;
        content.index_strings();
        self.content = ContentStore::of_load(content, loaded.units);
        self.visible = Visible::default();
        slot(x.len())
    }

    /// The texts the last `query` placed, as the shell draws them, one after another, which the
    /// boundaries of `contentTextBounds…` cut: each text, or as much of it as fits followed by an
    /// ellipsis, and an icon's registered name whole, which the shell draws as the image
    /// registered under it (ADR-0013). One copy per query, of the texts of the nodes it found
    /// alone.
    #[wasm_bindgen(js_name = contentTexts)]
    pub fn content_texts(&mut self) -> String {
        trap::spring();
        self.drawn.texts.clone()
    }

    /// The content of the node in `slot`, as the host application's type describes it: built when
    /// inspection or a change Comb tells asks for it, since the shell keeps none (ADR-0013). A slot
    /// that holds no node throws a `SlotError`.
    pub fn content(&mut self, slot: u32) -> Result<Ts<NodeContent>, CallRefusal> {
        trap::spring();
        if !self.graph.holds_node(slot) {
            return Err(CallRefusal::Slot(SlotError::NoNode { slot }));
        }
        Ts::from_rust(&self.content.content_of(slot))
            .map_err(|_| malformed("the content could not be handed back").into())
    }

    /// Hands over the metrics of the font the shell draws the texts of the role `role`, a
    /// `RoleCode`, with: the advance of the glyph of each code point of `codes` in `advances`,
    /// that of every other character, `fallback`, and its line height, all in world units. Every
    /// layout from then on uses it; the shell hands each over once, before the first load
    /// (ADR-0013). A role that names none, or metrics that do not pair up or are not finite
    /// numbers from 0 to 1,024, are refused with a `NumberError`, and nothing changes.
    #[wasm_bindgen(js_name = setFont)]
    pub fn set_font(
        &mut self,
        role: u8,
        codes: &[u32],
        advances: &[f64],
        fallback: f64,
        line_height: f64,
    ) -> Result<(), CallRefusal> {
        trap::spring();
        let role = graph_data::role_of(role).ok_or(NumberError::InvalidFont)?;
        let font = Font::new(codes, advances, fallback, line_height)
            .map_err(|_| NumberError::InvalidFont)?;
        self.fonts.set(role, font);
        self.lay_out_heights();
        Ok(())
    }

    /// Checks the node `addNode` hands over as a load checks a node, its strings of content
    /// counted against the budget on from those the graph holds, and adds it, drawn and hit
    /// above every other node, and returns the slot the engine chose for it: the free slot freed
    /// last, or a new one after the highest (ADR-0022). A refused node leaves the graph as it was.
    #[wasm_bindgen(js_name = addNode)]
    pub fn add_node(&mut self, node: Ts<NodeInput>) -> Result<u32, GraphDataProblem> {
        trap::spring();
        let node = node.to_rust().map_err(unshaped)?;
        self.add(&node)
    }

    /// Checks the patch `updateNode` hands over for the node `id` in `slot`, reading it once, as a
    /// load checks a node's content, its strings counted against the budget on from those the
    /// graph holds besides the node's, and gives the node its new content and the height it lays
    /// out to, its edges re-placed (ADR-0013); the store merges the patch. A refused patch changes
    /// nothing; a slot that holds no node throws a `SlotError`.
    #[wasm_bindgen(js_name = updateNode)]
    pub fn update_node(
        &mut self,
        slot: u32,
        id: &str,
        patch: Ts<NodePatch>,
    ) -> Result<(), CallRefusal> {
        trap::spring();
        let patch = patch.to_rust().map_err(unshaped)?;
        self.update(slot, id, &patch)
    }

    /// Checks the edge `addEdge` hands over as a load checks an edge, refuses one from a node to
    /// itself (ADR-0024), adds it between the node slots `source` and `target`, which the shell
    /// resolved, and returns the slot the engine chose for it (ADR-0022). A refused edge leaves
    /// the graph as it was; a slot of an end that holds no node throws a `SlotError`.
    #[wasm_bindgen(js_name = addEdge)]
    pub fn add_edge(
        &mut self,
        edge: Ts<EdgeInput>,
        source: u32,
        target: u32,
    ) -> Result<u32, EdgeRefusal> {
        trap::spring();
        let edge = edge.to_rust().map_err(unshaped)?;
        add_edge_to(&mut self.graph, &edge, source, target)
    }

    /// Checks the patch `updateEdge` hands over for the edge `id` in `slot`, reading it once, as a
    /// load checks those fields, and gives the edge its new style and label placement; the store
    /// merges the patch, the rest of which the engine does not keep. A refused patch changes
    /// nothing; a slot that holds no edge throws a `SlotError`.
    #[wasm_bindgen(js_name = updateEdge)]
    pub fn update_edge(
        &mut self,
        slot: u32,
        id: &str,
        patch: Ts<EdgePatch>,
    ) -> Result<(), EdgeRefusal> {
        trap::spring();
        let patch = patch.to_rust().map_err(unshaped)?;
        update_edge_in(&mut self.graph, slot, id, patch)
    }

    /// Records the half width and half height of the pill of the label of the edge in `slot`, in
    /// world units, as the shell draws it; a label it has not measured is not hit (ADR-0013).
    #[wasm_bindgen(js_name = setLabelSize)]
    pub fn set_label_size(
        &mut self,
        slot: u32,
        half_width: f64,
        half_height: f64,
    ) -> Result<(), SlotError> {
        trap::spring();
        Ok(self.graph.set_label_size(slot, half_width, half_height)?)
    }

    /// The world point of the label of the edge in `slot`, `x, y`, or nothing where it holds no
    /// edge with a label.
    #[wasm_bindgen(js_name = labelPoint)]
    pub fn label_point(&mut self, slot: u32) -> Vec<f64> {
        trap::spring();
        self.graph
            .label_point(slot)
            .map_or_else(Vec::new, |p| vec![p.x, p.y])
    }

    /// Places the label of the edge in `slot` at the world point `(x, y)`, at the path parameter
    /// nearest it and its distance along the normal there, and returns the two, `t, offset`
    /// (G-6). A slot that holds no edge with a label refuses it with a `SlotError`, and a point
    /// that is not finite with a `NumberError`, before anything moves.
    #[wasm_bindgen(js_name = moveLabel)]
    pub fn move_label(&mut self, slot: u32, x: f64, y: f64) -> Result<Vec<f64>, CallRefusal> {
        trap::spring();
        let point = checked_point(x, y)?;
        let placed = self.graph.move_label(slot, point)?;
        Ok(vec![placed.t, placed.offset])
    }

    /// The slots of the edges at the nodes in `slots`, in ascending order, as a removal of them
    /// would take along, named before anything is removed (ADR-0022). A slot that holds no node
    /// refuses the call.
    #[wasm_bindgen(js_name = edgesAt)]
    pub fn edges_at(&mut self, slots: &[u32]) -> Result<Vec<u32>, SlotError> {
        trap::spring();
        Ok(self.graph.edges_at(slots)?)
    }

    /// Removes the nodes in `slots` and every edge at them, and returns the slots of those edges
    /// in ascending order; the slots go onto the free lists (ADR-0022). A slot that holds no node
    /// refuses the call, which then changes nothing.
    #[wasm_bindgen(js_name = removeNodes)]
    pub fn remove_nodes(&mut self, slots: &[u32]) -> Result<Vec<u32>, SlotError> {
        trap::spring();
        let edges = self.graph.remove_nodes(slots)?;
        self.content.remove(slots);
        Ok(edges)
    }

    /// Removes the edges in `slots`; the slots go onto the free list (ADR-0022). A slot that holds
    /// no edge refuses the call, which then changes nothing.
    #[wasm_bindgen(js_name = removeEdges)]
    pub fn remove_edges(&mut self, slots: &[u32]) -> Result<(), SlotError> {
        trap::spring();
        Ok(self.graph.remove_edges(slots)?)
    }

    /// Moves the nodes in `slots` by `(dx, dy)`, their edges with them. A slot that holds no node
    /// throws a `SlotError`, and a delta that is not finite a `NumberError` `nonFiniteDelta`, which
    /// `TranslateError` names; either way nothing moves.
    pub fn translate(&mut self, slots: &[u32], dx: f32, dy: f32) -> Result<(), TranslateRefusal> {
        trap::spring();
        self.graph
            .translate(slots, dx, dy)
            .map_err(TranslateRefusal::from)
    }

    /// Finds the nodes and edges that meet the rectangle and builds the mesh of the edges for
    /// `level`, where a screen pixel is `pixel` world units, within the mesh budget; at the near
    /// level also the edge labels within `label_reach` of it. Returns the detail of the mesh; the
    /// results are read through the `visible…` and `mesh…` buffers. A pixel that is not a finite
    /// number above zero is refused with a `NumberError` before any edge is flattened.
    pub fn query(
        &mut self,
        rect: Ts<RectInput>,
        level: DetailLevel,
        pixel: f64,
        label_reach: f64,
    ) -> Result<MeshDetail, CallRefusal> {
        trap::spring();
        let rect = rect.to_rust().map_err(unshaped)?;
        self.query_rect(&rect, level, pixel, label_reach)
    }

    /// Computes the ends of the edges the last query found, read through the `edgeEnds…` buffer:
    /// for inspection, not for drawing.
    #[wasm_bindgen(js_name = drawnEdges)]
    pub fn drawn_edges(&mut self) {
        trap::spring();
        self.graph.edge_ends(&self.visible.edges, &mut self.ends);
    }

    /// What a press at the world point `(x, y)` hits where a screen pixel is `pixel` world units,
    /// at `level`: where `connectors` asks for them, at the near and middle level, a connector
    /// within 8 screen pixels, of the node drawn on top; else, at the near level, the label whose
    /// measured pill holds the point; else the node drawn on top there, else the edge drawn on top
    /// within 4 screen pixels of its path, else nothing (ADR-0013). Of a node, the element of its
    /// content whose rectangle holds the point, of those drawn at `level`: at the near level every
    /// element, at the middle level the texts of role title, at the far level none (ADR-0013). A
    /// pixel is checked as `query` checks it, and a point that is not finite is refused, both with
    /// a `NumberError`.
    pub fn hit(
        &mut self,
        x: f64,
        y: f64,
        pixel: f64,
        level: DetailLevel,
        connectors: bool,
    ) -> Result<Ts<Hit>, CallRefusal> {
        trap::spring();
        let point = checked_point(x, y)?;
        let pixel = checked_pixel(pixel)?;
        let hit = match self.graph.hit_at(point, pixel, level.into(), connectors) {
            Some(Target::Connector(slot, side)) => Hit::Connector {
                slot,
                side: side.into(),
            },
            Some(Target::Label(slot)) => Hit::Label { slot },
            Some(Target::Node(slot)) => Hit::Node {
                slot,
                element: self.element_at(slot, point, level),
            },
            Some(Target::Edge(slot)) => Hit::Edge { slot },
            None => Hit::None,
        };
        Ts::from_rust(&hit).map_err(|_| malformed("the hit could not be handed back").into())
    }
}

impl Engine {
    /// `addNode` of `node`, read: its strings of content counted on from those the graph holds.
    fn add(&mut self, node: &NodeInput) -> Result<u32, GraphDataProblem> {
        let (slot, content) =
            add_node_to(&mut self.graph, node, &self.fonts, self.content.units())?;
        self.content.set(slot, content);
        Ok(slot)
    }

    /// `updateNode` of the node `id` in `slot` by `patch`, read: its strings of content counted on
    /// from those the graph holds besides the node's.
    fn update(&mut self, slot: u32, id: &str, patch: &NodePatch) -> Result<(), CallRefusal> {
        // A slot that holds no node holds no content: the patch counts on from all the graph
        // holds, and is refused as a slot only once its content is checked.
        let held = if self.graph.holds_node(slot) {
            self.content.held_besides(slot)
        } else {
            self.content.units()
        };
        let Some((content, height)) = patch_of(id, patch, &self.fonts, held)? else {
            return Ok(());
        };
        if !self.graph.holds_node(slot) {
            return Err(CallRefusal::Slot(SlotError::NoNode { slot }));
        }
        graph_data::within_by_height(id, self.graph.positions()[slot as usize * 2 + 1], height)?;
        self.graph.resize_node(slot, height)?;
        self.content.set(slot, content);
        Ok(())
    }

    /// The element of the content of the node in `slot` whose rectangle holds `point`, of those
    /// drawn at `level` (ADR-0013).
    fn element_at(&self, slot: u32, point: Point, level: DetailLevel) -> Option<ElementHit> {
        if level == DetailLevel::Far {
            return None;
        }
        let at = slot as usize * 2;
        let [x, y] = [0, 1].map(|axis| f64::from(self.graph.positions()[at + axis]));
        let width = self.graph.sizes()[at];
        let (content, node) = self.content.of(slot);
        let (mut cells, mut rows, mut placed) = (Vec::new(), Vec::new(), Vec::new());
        content.element_at(
            node,
            width,
            &self.fonts,
            (point.x - x, point.y - y),
            level == DetailLevel::Middle,
            &mut cells,
            &mut rows,
            &mut placed,
        )
    }

    /// `query` of a rectangle already converted.
    fn query_rect(
        &mut self,
        rect: &RectInput,
        level: DetailLevel,
        pixel: f64,
        label_reach: f64,
    ) -> Result<MeshDetail, CallRefusal> {
        let pixel = checked_pixel(pixel)?;
        let rect = Rect::new(rect.min_x, rect.min_y, rect.max_x, rect.max_y);
        self.graph
            .query(&rect, level.into(), pixel, label_reach, &mut self.visible);
        self.lay_out_found(level);
        Ok(self.visible.mesh.detail.into())
    }

    /// Gives every node the height its content lays out to in the fonts as they are now, its edges
    /// and its place in the index moved along where it changed (ADR-0013).
    fn lay_out_heights(&mut self) {
        let slots = graph_data::numbered(self.graph.sizes().len() / 2);
        for slot in 0..slots {
            if !self.graph.holds_node(slot) {
                continue;
            }
            let (content, node) = self.content.of(slot);
            let height = content.height(node, &self.fonts);
            if self.graph.sizes()[slot as usize * 2 + 1] != height {
                // A slot that holds a node, as the check above found, which no resize refuses.
                let _ = self.graph.resize_node(slot, height);
            }
        }
    }

    /// Lays out the content of the nodes the last query found, at the near and the middle level,
    /// into the buffers of placed elements; at the far level, none (ADR-0013, ADR-0027).
    fn lay_out_found(&mut self, level: DetailLevel) {
        self.content_bounds.clear();
        self.placed.clear();
        self.drawn.clear();
        if level != DetailLevel::Far {
            self.content_bounds.push(0);
            let mut cells: Vec<Cell> = Vec::new();
            let mut rows = Vec::new();
            let sizes = self.graph.sizes();
            for &slot in &self.visible.nodes {
                let width = sizes[slot as usize * 2];
                let (content, node) = self.content.of(slot);
                let fonts = &self.fonts;
                let start = self.placed.len();
                content.lay_out(node, width, fonts, &mut cells, &mut rows, &mut self.placed);
                content.draw(node, &self.placed[start..], fonts, &mut self.drawn);
                self.content_bounds
                    .push(graph_data::numbered(self.placed.len()));
            }
        }
        self.content_rects.clear();
        for placed in &self.placed {
            let rect = [placed.x, placed.y, placed.width, placed.height];
            self.content_rects.extend(rect);
        }
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

    /// Where the sizes buffer starts, which `loadGraph`, `addNode`, and `updateNode` write:
    /// `width, height` per node slot, the height the node's content lays out to (ADR-0013).
    #[wasm_bindgen(js_name = sizesPtr)]
    pub fn sizes_ptr(&self) -> *const f32 {
        self.graph.sizes().as_ptr()
    }

    /// How many values the sizes buffer holds: two per node slot.
    #[wasm_bindgen(js_name = sizesLen)]
    pub fn sizes_len(&self) -> usize {
        self.graph.sizes().len()
    }

    /// Where the buffer starts that `query` writes, at the near and the middle level, the
    /// boundaries of the placed elements of each node it found into, one more than it found, in
    /// the order of the found node slots; at the far level it holds none.
    #[wasm_bindgen(js_name = contentBoundsPtr)]
    pub fn content_bounds_ptr(&self) -> *const u32 {
        self.content_bounds.as_ptr()
    }

    /// How many boundaries the buffer of placed elements' boundaries holds.
    #[wasm_bindgen(js_name = contentBoundsLen)]
    pub fn content_bounds_len(&self) -> usize {
        self.content_bounds.len()
    }

    /// Where the buffer starts that `query` writes each placed element's rectangle into, `x, y,
    /// width, height` relative to its node's top-left corner, its node's elements in the order of
    /// its rows and theirs.
    #[wasm_bindgen(js_name = contentRectsPtr)]
    pub fn content_rects_ptr(&self) -> *const f32 {
        self.content_rects.as_ptr()
    }

    /// How many values the buffer of placed elements' rectangles holds: four per element.
    #[wasm_bindgen(js_name = contentRectsLen)]
    pub fn content_rects_len(&self) -> usize {
        self.content_rects.len()
    }

    /// Where the buffer starts that `query` writes, per placed element, the code of its
    /// `KindCode` into, which says how the shell draws it (ADR-0013).
    #[wasm_bindgen(js_name = contentKindsPtr)]
    pub fn content_kinds_ptr(&self) -> *const u8 {
        self.drawn.kinds.as_ptr()
    }

    /// How many values the buffer of kinds holds: one per placed element.
    #[wasm_bindgen(js_name = contentKindsLen)]
    pub fn content_kinds_len(&self) -> usize {
        self.drawn.kinds.len()
    }

    /// Where the buffer starts that `query` writes, per placed element, the code of the
    /// `RoleCode` whose font draws its text into, body for an action, and for an icon, whose line
    /// it lies in.
    #[wasm_bindgen(js_name = contentRolesPtr)]
    pub fn content_roles_ptr(&self) -> *const u8 {
        self.drawn.roles.as_ptr()
    }

    /// How many values the buffer of roles holds: one per placed element.
    #[wasm_bindgen(js_name = contentRolesLen)]
    pub fn content_roles_len(&self) -> usize {
        self.drawn.roles.len()
    }

    /// Where the buffer starts that `query` writes, per placed element, its colour as `0xRRGGBB`
    /// into: a badge's pill's, 0 for an element of no colour (ADR-0013).
    #[wasm_bindgen(js_name = contentColorsPtr)]
    pub fn content_colors_ptr(&self) -> *const u32 {
        self.drawn.colors.as_ptr()
    }

    /// How many values the buffer of colours holds: one per placed element.
    #[wasm_bindgen(js_name = contentColorsLen)]
    pub fn content_colors_len(&self) -> usize {
        self.drawn.colors.len()
    }

    /// Where the buffer starts that `query` writes, per placed element, the boundaries of the
    /// pieces of its bar in `contentBars…` into: one more than there are placed elements, a
    /// progress bar's segments and then its track, and no piece of another kind (ADR-0013).
    #[wasm_bindgen(js_name = contentBarBoundsPtr)]
    pub fn content_bar_bounds_ptr(&self) -> *const u32 {
        self.drawn.bar_bounds.as_ptr()
    }

    /// How many boundaries the buffer of the bars' boundaries holds.
    #[wasm_bindgen(js_name = contentBarBoundsLen)]
    pub fn content_bar_bounds_len(&self) -> usize {
        self.drawn.bar_bounds.len()
    }

    /// Where the buffer starts that `query` writes each piece of a bar into, its rectangle
    /// `x, y, width, height` relative to its node.
    #[wasm_bindgen(js_name = contentBarsPtr)]
    pub fn content_bars_ptr(&self) -> *const f32 {
        self.drawn.bars.as_ptr()
    }

    /// How many values the buffer of the bars' pieces holds: four per piece.
    #[wasm_bindgen(js_name = contentBarsLen)]
    pub fn content_bars_len(&self) -> usize {
        self.drawn.bars.len()
    }

    /// Where the buffer starts that `query` writes each piece's colour as `0xRRGGBB` into: a
    /// segment's, and 0 for a track, whose colour is the shell's.
    #[wasm_bindgen(js_name = contentBarColorsPtr)]
    pub fn content_bar_colors_ptr(&self) -> *const u32 {
        self.drawn.bar_colors.as_ptr()
    }

    /// How many values the buffer of the pieces' colours holds: one per piece.
    #[wasm_bindgen(js_name = contentBarColorsLen)]
    pub fn content_bar_colors_len(&self) -> usize {
        self.drawn.bar_colors.len()
    }

    /// Where the buffer starts that `query` writes, per placed element, the boundaries of its parts
    /// in `contentParts…` into: one more than there are placed elements, a metric's caption, value,
    /// and trend's text, and no part of another kind (ADR-0013).
    #[wasm_bindgen(js_name = contentPartBoundsPtr)]
    pub fn content_part_bounds_ptr(&self) -> *const u32 {
        self.drawn.part_bounds.as_ptr()
    }

    /// How many boundaries the buffer of the parts' boundaries holds.
    #[wasm_bindgen(js_name = contentPartBoundsLen)]
    pub fn content_part_bounds_len(&self) -> usize {
        self.drawn.part_bounds.len()
    }

    /// Where the buffer starts that `query` writes each part's rectangle into, `x, y, width,
    /// height` relative to its node.
    #[wasm_bindgen(js_name = contentPartsPtr)]
    pub fn content_parts_ptr(&self) -> *const f32 {
        self.drawn.parts.as_ptr()
    }

    /// How many values the buffer of the parts' rectangles holds: four per part.
    #[wasm_bindgen(js_name = contentPartsLen)]
    pub fn content_parts_len(&self) -> usize {
        self.drawn.parts.len()
    }

    /// Where the buffer starts that `query` writes where each part's text ends in `contentTexts`
    /// into, in UTF-16 code units: each part's text starts where the one before it in its element
    /// ends, the first where its element's text starts.
    #[wasm_bindgen(js_name = contentPartEndsPtr)]
    pub fn content_part_ends_ptr(&self) -> *const u32 {
        self.drawn.part_ends.as_ptr()
    }

    /// How many values the buffer of the parts' ends holds: one per part.
    #[wasm_bindgen(js_name = contentPartEndsLen)]
    pub fn content_part_ends_len(&self) -> usize {
        self.drawn.part_ends.len()
    }

    /// Where the buffer starts that `query` writes, per placed element, the boundaries of its
    /// arrows in `contentArrows…` into: one more than there are placed elements, a metric's one
    /// where its column holds it, and none of another kind (ADR-0013).
    #[wasm_bindgen(js_name = contentArrowBoundsPtr)]
    pub fn content_arrow_bounds_ptr(&self) -> *const u32 {
        self.drawn.arrow_bounds.as_ptr()
    }

    /// How many boundaries the buffer of the arrows' boundaries holds.
    #[wasm_bindgen(js_name = contentArrowBoundsLen)]
    pub fn content_arrow_bounds_len(&self) -> usize {
        self.drawn.arrow_bounds.len()
    }

    /// Where the buffer starts that `query` writes each arrow's triangle into, three points `x, y`
    /// relative to its node, drawn in its element's colour.
    #[wasm_bindgen(js_name = contentArrowsPtr)]
    pub fn content_arrows_ptr(&self) -> *const f32 {
        self.drawn.arrows.as_ptr()
    }

    /// How many values the buffer of the arrows holds: six per arrow.
    #[wasm_bindgen(js_name = contentArrowsLen)]
    pub fn content_arrows_len(&self) -> usize {
        self.drawn.arrows.len()
    }

    /// Where the buffer starts that `query` writes the boundaries of the drawn texts in
    /// `contentTexts`, in UTF-16 code units, into: one more than there are placed elements.
    #[wasm_bindgen(js_name = contentTextBoundsPtr)]
    pub fn content_text_bounds_ptr(&self) -> *const u32 {
        self.drawn.bounds.as_ptr()
    }

    /// How many boundaries the buffer of drawn texts' boundaries holds.
    #[wasm_bindgen(js_name = contentTextBoundsLen)]
    pub fn content_text_bounds_len(&self) -> usize {
        self.drawn.bounds.len()
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
    /// per label slot, relative to the origin.
    #[wasm_bindgen(js_name = labelPointsPtr)]
    pub fn label_points_ptr(&self) -> *const f32 {
        self.visible.label_points.as_ptr()
    }

    /// How many values of label points the last `query` wrote: two per label slot.
    #[wasm_bindgen(js_name = labelPointsLen)]
    pub fn label_points_len(&self) -> usize {
        self.visible.label_points.len()
    }

    /// The `x` of the origin the last `query` wrote its vertex positions and label points
    /// relative to (ADR-0034).
    #[wasm_bindgen(js_name = originX)]
    pub fn origin_x(&self) -> f64 {
        self.visible.origin.x
    }

    /// The `y` of the origin the last `query` wrote its vertex positions and label points
    /// relative to (ADR-0034).
    #[wasm_bindgen(js_name = originY)]
    pub fn origin_y(&self) -> f64 {
        self.visible.origin.y
    }

    /// Where the buffer starts that `query` writes the mesh's vertex positions into: `x, y` per
    /// vertex, relative to the origin.
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

// The tests of the exports: a query of a loaded graph, and the budget a load's limit must fit.
#[cfg(test)]
mod tests {
    use super::*;
    use comb_engine::stroke::MESH_BUDGET;
    use graph_data::tests::batch;
    use graph_data::{GraphBatch, graph_of};

    #[test]
    fn a_freed_slot_is_refused_by_every_export_that_takes_slots_as_a_slot_beyond_the_graph() {
        // Verifies: ADR-0022
        let data = batch(
            &[("a", 0.0, 0.0), ("b", 300.0, 0.0), ("c", 600.0, 0.0)],
            &[("a-b", "a", "b"), ("b-c", "b", "c")],
        );
        let mut engine = Engine::new();
        engine.graph = graph_of(&data).unwrap();
        // Node c goes, and edge b-c, slot 1, with it.
        assert_eq!(engine.remove_nodes(&[2]), Ok(vec![1]));
        for slot in [2, 9] {
            assert_eq!(
                engine.remove_nodes(&[0, slot]),
                Err(SlotError::NoNode { slot })
            );
            assert_eq!(
                engine.translate(&[0, slot], 1.0, 1.0),
                Err(TranslateRefusal::Slot(SlotError::NoNode { slot }))
            );
        }
        for slot in [1, 9] {
            assert_eq!(
                engine.remove_edges(&[0, slot]),
                Err(SlotError::NoEdge { slot })
            );
        }
        assert_eq!(engine.graph.positions()[..4], [0.0, 0.0, 300.0, 0.0]);
        assert_eq!(engine.remove_edges(&[0]), Ok(()));
    }

    #[test]
    fn a_move_by_a_delta_that_is_not_finite_is_refused_after_its_slots_and_nothing_moves() {
        // Verifies: ADR-0031
        // A delta is the shell's own mistake, which crosses as `TranslateError`, the
        // `NumberError` of a delta, never as a problem of graph data.
        let mut engine = Engine::new();
        engine.graph = graph_of(&batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[])).unwrap();
        for (dx, dy) in [(f32::NAN, 1.0), (1.0, f32::INFINITY)] {
            assert_eq!(
                engine.translate(&[0, 1], dx, dy),
                Err(TranslateRefusal::Delta(TranslateError::NonFiniteDelta))
            );
            assert_eq!(
                engine.translate(&[0, 7], dx, dy),
                Err(TranslateRefusal::Slot(SlotError::NoNode { slot: 7 }))
            );
        }
        assert_eq!(engine.graph.positions(), [0.0, 0.0, 300.0, 0.0]);
    }

    /// An engine whose titles advance by 7 a glyph and whose ellipsis by 10, the body by 6, in
    /// lines 18 and 16 high.
    fn fonted() -> Engine {
        let mut engine = Engine::new();
        let ellipsis = [u32::from(comb_engine::content::ELLIPSIS)];
        let title = RoleCode::Title as u8;
        assert_eq!(
            engine.set_font(title, &ellipsis, &[10.0], 7.0, 18.0),
            Ok(())
        );
        let body = RoleCode::Body as u8;
        assert_eq!(engine.set_font(body, &ellipsis, &[9.0], 6.0, 16.0), Ok(()));
        engine
    }

    /// The query of the near level over `rect` on `engine`, where a pixel is a world unit.
    fn near(engine: &mut Engine, rect: [f64; 4]) {
        let [min_x, min_y, max_x, max_y] = rect;
        let rect = RectInput {
            min_x,
            min_y,
            max_x,
            max_y,
        };
        engine
            .query_rect(&rect, DetailLevel::Near, 1.0, 0.0)
            .unwrap();
    }

    #[test]
    fn nodes_of_different_content_are_as_high_as_their_rows_and_are_hit_and_joined_there() {
        // Verifies: ADR-0013
        // Node `a`, 100 wide at (0, 0), holds one title; `b`, at (300, 0), five rows: a title and
        // four bodies, 10 + 18 + 4 * 16 + 10 = 102 high, and the edge from `a` enters it there.
        use graph_data::tests::{TITLE, b_of, load_into, text};
        let body = text(RoleCode::Body, "b");
        let mut engine = fonted();
        let mut nodes = b_of(&[&[TITLE], &[body], &[body], &[body], &[body]]);
        let edges = graph_data::OwnedEdgeColumns::of([Some(&graph_data::EdgeCells::from(
            &batch(&[], &[("e", "a", "b")]).edges[0],
        ))]);
        nodes.content.weights.iter_mut().for_each(|w| *w = 1.0);
        assert_eq!(load_into(&mut engine, &nodes, &edges), Ok(2));
        assert_eq!(engine.graph.sizes(), [100.0, 64.0, 100.0, 102.0]);
        let hit = |engine: &mut Engine, x, y| {
            engine
                .graph
                .hit_at(Point::new(x, y), 1.0, Level::Near, false)
        };
        // Below `a`'s bottom, nothing; at the same height in `b`, `b`.
        assert_eq!(hit(&mut engine, 50.0, 90.0), None);
        assert_eq!(hit(&mut engine, 350.0, 90.0), Some(Target::Node(1)));
        assert_eq!(hit(&mut engine, 350.0, 103.0), None);
        let mut ends = Vec::new();
        engine.graph.edge_ends(&[0], &mut ends);
        assert_eq!(ends, [100.0, 32.0, 300.0, 51.0]);
        // The near level places every text, each relative to its node.
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        assert_eq!(engine.content_bounds, [0, 1, 6]);
        assert_eq!(
            engine.content_rects[..8],
            [12.0, 10.0, 76.0, 18.0, 12.0, 10.0, 76.0, 18.0]
        );
        assert_eq!(engine.content_rects[8..12], [12.0, 28.0, 76.0, 16.0]);
        // Each text drawn whole, with its role: `a`'s title "x", `b`'s title "t" and four bodies.
        assert_eq!(engine.drawn.texts, "xtbbbb");
        assert_eq!(engine.drawn.bounds, [0, 1, 2, 3, 4, 5, 6]);
        let (title, body) = (RoleCode::Title as u8, RoleCode::Body as u8);
        assert_eq!(engine.drawn.roles, [title, title, body, body, body, body]);
    }

    /// An engine of `a`, 100 wide at (0, 0), of one action, and `b` at (300, 0), of a title row and
    /// a row of a body beside an action, each 34 wide with a gap of 8: the body from x = 12, the
    /// action from 54, both from y = 28 to 44.
    fn with_actions() -> Engine {
        use graph_data::tests::{TITLE, action, load_into, named_content, text};
        let mut engine = fonted();
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        data.nodes[0].content = named_content(&[&[action("Open", "first")]]).into();
        let body = (text(RoleCode::Body, "b"), None);
        let b = [
            [(TITLE, None)].as_slice(),
            &[body, action("Details", "details")],
        ];
        data.nodes[1].content = named_content(&b).into();
        let nodes = graph_data::OwnedColumns::of(data.nodes.iter().map(Some));
        let none = graph_data::OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        engine
    }

    /// The element `engine` hits in the node in `slot` at `(x, y)` at `level`.
    fn element(
        engine: &Engine,
        slot: u32,
        x: f64,
        y: f64,
        level: DetailLevel,
    ) -> Option<ElementHit> {
        engine.element_at(slot, Point::new(x, y), level)
    }

    /// Asserts that `got` holds `expected`, each within 1e-4.
    fn assert_close(got: &[f32], expected: &[f64]) {
        assert_eq!(got.len(), expected.len(), "{got:?}");
        let close = got
            .iter()
            .zip(expected)
            .all(|(got, want)| (f64::from(*got) - want).abs() <= 1e-4);
        assert!(close, "{got:?} against {expected:?}");
    }

    /// The element hit at `row` and `column`, of `kind`, naming `action`.
    fn hit(row: u32, column: u32, kind: ElementKind, action: Option<&str>) -> Option<ElementHit> {
        Some(ElementHit {
            row,
            column,
            kind,
            action: action.map(str::to_owned),
        })
    }

    #[test]
    fn actions_are_drawn_in_the_bodys_font_kept_as_given_and_a_patchs_hit_as_it_lays_out() {
        // Verifies: ADR-0013
        use graph_data::tests::{action, named_content};
        let mut engine = with_actions();
        // The near level draws the actions as actions, in the body's font.
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        let (t, a) = (KindCode::Text as u8, KindCode::Action as u8);
        assert_eq!(engine.drawn.kinds, [a, t, t, a]);
        let (title, body) = (RoleCode::Title as u8, RoleCode::Body as u8);
        assert_eq!(engine.drawn.roles, [body, title, body, body]);
        // "Details" in a column of 34 keeps four of the body's glyphs of 6 beside its
        // ellipsis of 9.
        assert_eq!(engine.drawn.texts, "OpentbDeta\u{2026}");
        // Its content, built when asked, holds the action as the host application gave it.
        let details = ContentElement::Action {
            text: "Details".to_owned(),
            id: "details".to_owned(),
            weight: Some(1.0),
        };
        assert_eq!(engine.content.content_of(1).0[1][1], details);
        // A patch's content is hit as it lays out, its names its own.
        let patch = NodePatch(vec![(
            "content".to_owned(),
            named_content(&[&[action("Next", "next")]]).into(),
        )]);
        let (checked, height) = patch_of("b", &patch, &engine.fonts, 0).unwrap().unwrap();
        engine.graph.resize_node(1, height).unwrap();
        engine.content.set(1, checked);
        assert_eq!(
            element(&engine, 1, 320.0, 15.0, DetailLevel::Near),
            hit(0, 0, ElementKind::Action, Some("next"))
        );
    }

    #[test]
    fn a_point_in_a_node_hits_the_element_drawn_there_and_an_action_its_identifier() {
        // Verifies: ADR-0013
        let engine = with_actions();
        let at = |slot, x, y, level| element(&engine, slot, x, y, level);
        let close = DetailLevel::Near;
        assert_eq!(
            at(1, 370.0, 30.0, close),
            hit(1, 1, ElementKind::Action, Some("details"))
        );
        assert_eq!(
            at(1, 320.0, 30.0, close),
            hit(1, 0, ElementKind::Text, None)
        );
        assert_eq!(
            at(1, 320.0, 15.0, close),
            hit(0, 0, ElementKind::Text, None)
        );
        // The gap between the body and the action, the padding, and below the rows: none.
        for (x, y) in [(350.0, 30.0), (305.0, 15.0), (320.0, 50.0)] {
            assert_eq!(at(1, x, y, close), None, "({x}, {y})");
        }
        // `a`'s action names its own identifier, before `b`'s in the column of names.
        assert_eq!(
            at(0, 50.0, 15.0, close),
            hit(0, 0, ElementKind::Action, Some("first"))
        );
        // The middle level draws the title alone, and the far level nothing.
        let middle = DetailLevel::Middle;
        assert_eq!(
            at(1, 320.0, 15.0, middle),
            hit(0, 0, ElementKind::Text, None)
        );
        assert_eq!(at(1, 370.0, 30.0, middle), None);
        assert_eq!(at(0, 50.0, 15.0, middle), None);
        assert_eq!(at(1, 320.0, 15.0, DetailLevel::Far), None);
    }

    #[test]
    fn a_badge_is_drawn_on_its_colour_kept_as_given_and_hit_on_its_pill_alone() {
        // Verifies: ADR-0013, ADR-0034
        // `b`, 100 wide at (300, 0), holds a title row and a badge "Done" on 0x22C55E below it:
        // its pill from (12, 28), the four glyphs of the body's 6 and 8 either side, 40 × 22.
        use graph_data::tests::{badged, load_into};
        let mut engine = fonted();
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        let green = 0x22_c55e;
        data.nodes[1].content = badged(Some("Done"), f64::from(green)).into();
        let nodes = graph_data::OwnedColumns::of(data.nodes.iter().map(Some));
        let none = graph_data::OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        let (t, b) = (KindCode::Text as u8, KindCode::Badge as u8);
        assert_eq!(engine.drawn.kinds, [t, t, b]);
        let (title, body) = (RoleCode::Title as u8, RoleCode::Body as u8);
        assert_eq!(engine.drawn.roles, [title, title, body]);
        assert_eq!(engine.drawn.colors, [0, 0, green]);
        assert_eq!(engine.drawn.texts, "xBetDone");
        assert_eq!(engine.content_rects[8..], [12.0, 28.0, 40.0, 22.0]);
        // Its content, built when asked, holds the badge as the host application gave it.
        let badge = ContentElement::Badge {
            text: "Done".to_owned(),
            color: green,
            weight: Some(1.0),
        };
        assert_eq!(engine.content.content_of(1).0[1], [badge]);
        // A press on the pill hits the badge; beside it in its column, none; at the middle level,
        // where no badge is drawn, none.
        let at = |x, y, level| element(&engine, 1, x, y, level);
        assert_eq!(
            at(320.0, 35.0, DetailLevel::Near),
            hit(1, 0, ElementKind::Badge, None)
        );
        assert_eq!(at(360.0, 35.0, DetailLevel::Near), None);
        assert_eq!(at(320.0, 35.0, DetailLevel::Middle), None);
        assert_eq!(at(320.0, 35.0, DetailLevel::Far), None);
    }

    #[test]
    fn a_progress_bar_is_drawn_as_its_segments_and_track_kept_as_given_and_hit_across_its_line() {
        // Verifies: ADR-0013, ADR-0034
        // `b`, 100 wide at (300, 0), holds a title row and a progress bar of 0.3 green and 0.2
        // grey below it: its cell from (12, 28), 76 × 16, its bar 8 high from 32, the segments
        // 22.8 and 15.2 long from 12, and the track the remaining 38.
        use graph_data::tests::{load_into, progressed};
        let mut engine = fonted();
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        let (green, grey) = (0x22_c55e, 0x9c_a3af);
        let segments = [(0.3, f64::from(green)), (0.2, f64::from(grey))];
        data.nodes[1].content = progressed(&segments).into();
        let nodes = graph_data::OwnedColumns::of(data.nodes.iter().map(Some));
        let none = graph_data::OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        let (t, p) = (KindCode::Text as u8, KindCode::Progress as u8);
        let (title, body) = (RoleCode::Title as u8, RoleCode::Body as u8);
        let drawn = &engine.drawn;
        assert_eq!(
            (&drawn.kinds[..], &drawn.roles[..], &drawn.colors[..]),
            (&[t, t, p][..], &[title, title, body][..], &[0, 0, 0][..])
        );
        // A progress bar shows no text.
        assert_eq!(
            (&drawn.texts[..], &drawn.bounds[..]),
            ("xBet", &[0, 1, 4, 4][..])
        );
        assert_eq!(engine.content_rects[8..], [12.0, 28.0, 76.0, 16.0]);
        // Its pieces: the segments of their colours, then the track, of none.
        assert_eq!(engine.drawn.bar_bounds, [0, 0, 0, 3]);
        assert_eq!(engine.drawn.bar_colors, [green, grey, 0]);
        let expected = [
            12.0, 32.0, 22.8, 8.0, 34.8, 32.0, 15.2, 8.0, 50.0, 32.0, 38.0, 8.0,
        ];
        assert_close(&engine.drawn.bars, &expected);
        // Its content, built when asked, holds the bar as the host application gave it.
        let progress = ContentElement::Progress {
            segments: vec![
                graph_data::Segment {
                    fraction: 0.3,
                    color: green,
                },
                graph_data::Segment {
                    fraction: 0.2,
                    color: grey,
                },
            ],
            weight: Some(1.0),
        };
        assert_eq!(engine.content.content_of(1).0[1], [progress]);
        // A press anywhere on its line in its column hits it, above the bar too; at the middle
        // and far level, where no bar is drawn, none.
        let at = |x, y, level| element(&engine, 1, x, y, level);
        let hit_bar = hit(1, 0, ElementKind::Progress, None);
        assert_eq!(at(380.0, 29.0, DetailLevel::Near), hit_bar);
        assert_eq!(at(320.0, 36.0, DetailLevel::Near), hit_bar);
        assert_eq!(at(320.0, 45.0, DetailLevel::Near), None);
        assert_eq!(at(320.0, 36.0, DetailLevel::Middle), None);
        assert_eq!(at(320.0, 36.0, DetailLevel::Far), None);
    }

    #[test]
    fn an_icon_hands_the_shell_its_name_and_its_square_kept_as_given_and_hit_on_its_square() {
        // Verifies: ADR-0013, ADR-0034
        // `b`, 100 wide at (300, 0), holds a title row and an icon named "bet" below it: its
        // square from (12, 28), the body's line of 16 on a side, in a column 76 wide.
        use graph_data::tests::{icon, load_into, named_content};
        let mut engine = fonted();
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        let title = (graph_data::tests::text(RoleCode::Title, "Bet"), None);
        data.nodes[1].content = named_content(&[&[title], &[icon(Some("bet"))]]).into();
        let nodes = graph_data::OwnedColumns::of(data.nodes.iter().map(Some));
        let none = graph_data::OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        let (t, i) = (KindCode::Text as u8, KindCode::Icon as u8);
        let (title, body) = (RoleCode::Title as u8, RoleCode::Body as u8);
        let drawn = &engine.drawn;
        assert_eq!(
            (&drawn.kinds[..], &drawn.roles[..], &drawn.colors[..]),
            (&[t, t, i][..], &[title, title, body][..], &[0, 0, 0][..])
        );
        // An icon's text is its name, whole, which the shell draws as the image registered
        // under it.
        assert_eq!(
            (&drawn.texts[..], &drawn.bounds[..]),
            ("xBetbet", &[0, 1, 4, 7][..])
        );
        assert_eq!(engine.content_rects[8..], [12.0, 28.0, 16.0, 16.0]);
        assert_eq!(engine.drawn.bar_bounds, [0, 0, 0, 0]);
        // Its content, built when asked, holds the icon as the host application gave it.
        let kept = ContentElement::Icon {
            name: "bet".to_owned(),
            weight: Some(1.0),
        };
        assert_eq!(engine.content.content_of(1).0[1], [kept]);
        // A press on the square hits the icon; beside it in its column, none; at the middle and
        // far level, where no icon is drawn, none.
        let at = |x, y, level| element(&engine, 1, x, y, level);
        assert_eq!(
            at(320.0, 35.0, DetailLevel::Near),
            hit(1, 0, ElementKind::Icon, None)
        );
        assert_eq!(at(330.0, 35.0, DetailLevel::Near), None);
        assert_eq!(at(320.0, 35.0, DetailLevel::Middle), None);
        assert_eq!(at(320.0, 35.0, DetailLevel::Far), None);
    }

    /// An engine of fonts whose caption glyphs advance by 5 and its lines are 14 high, besides
    /// `fonted`'s, loaded with `a` and `b`, 100 wide at (300, 0), which holds a title row and a
    /// metric below it, "Revenue" over "42" and a trend "+3%" down in 0xEF4444, queried near.
    fn metric_engine() -> Engine {
        use graph_data::tests::{load_into, metricked};
        let mut engine = fonted();
        let ellipsis = [u32::from(comb_engine::content::ELLIPSIS)];
        let caption = RoleCode::Caption as u8;
        assert_eq!(
            engine.set_font(caption, &ellipsis, &[8.0], 5.0, 14.0),
            Ok(())
        );
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        let texts = [Some("Revenue"), Some("42"), Some("+3%")];
        let down = DirectionCode::Down as u8;
        data.nodes[1].content = metricked(down, f64::from(RED), texts).into();
        let nodes = graph_data::OwnedColumns::of(data.nodes.iter().map(Some));
        let none = graph_data::OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        engine
    }

    /// The colour of the trend of `metric_engine`'s metric.
    const RED: u32 = 0xef_4444;

    #[test]
    fn a_metric_is_drawn_as_its_three_texts_and_its_arrow() {
        // Verifies: ADR-0013, ADR-0034
        // `metric_engine`'s metric: its cell from (12, 28), 76 × 30, the node 68 high; the caption
        // on its line of 14; the value from (12, 42), two body glyphs of 6; the arrow 8 after it,
        // a square of 10 from (32, 45); the trend's text 4 after the arrow, from 46 to 88.
        let engine = metric_engine();
        assert_eq!(engine.graph.sizes()[3], 68.0);
        let (t, m) = (KindCode::Text as u8, KindCode::Metric as u8);
        let (title, body) = (RoleCode::Title as u8, RoleCode::Body as u8);
        let drawn = &engine.drawn;
        assert_eq!(
            (&drawn.kinds[..], &drawn.roles[..], &drawn.colors[..]),
            (&[t, t, m][..], &[title, title, body][..], &[0, 0, RED][..])
        );
        assert_eq!(engine.content_rects[8..], [12.0, 28.0, 76.0, 30.0]);
        // Its texts one after another, which its three parts cut.
        assert_eq!(
            (&drawn.texts[..], &drawn.bounds[..]),
            ("xBetRevenue42+3%", &[0, 1, 4, 16][..])
        );
        assert_eq!(
            (&drawn.part_bounds[..], &drawn.part_ends[..]),
            (&[0, 0, 0, 3][..], &[11, 13, 16][..])
        );
        let parts = [
            12.0, 28.0, 76.0, 14.0, 12.0, 42.0, 12.0, 16.0, 46.0, 42.0, 42.0, 16.0,
        ];
        assert_close(&drawn.parts, &parts);
        // Its arrow, down: its base along the square's top, its apex the middle of its bottom.
        assert_eq!(drawn.arrow_bounds, [0, 0, 0, 1]);
        assert_close(&drawn.arrows, &[32.0, 45.0, 42.0, 45.0, 37.0, 55.0]);
    }

    #[test]
    fn a_metric_is_kept_as_given_and_hit_across_its_cell() {
        // Verifies: ADR-0013, ADR-0034
        let engine = metric_engine();
        // Its content, built when asked, holds the metric as the host application gave it.
        let metric = ContentElement::Metric {
            caption: "Revenue".to_owned(),
            value: "42".to_owned(),
            trend: Trend {
                text: "+3%".to_owned(),
                direction: TrendDirection::Down,
                color: RED,
            },
            weight: Some(1.0),
        };
        assert_eq!(engine.content.content_of(1).0[1], [metric]);
        // A press anywhere in its cell hits it, on the caption, beside the value, and on the
        // trend; below it none; at the middle and far level, where no metric is drawn, none.
        let at = |x, y, level| element(&engine, 1, x, y, level);
        let hit_metric = hit(1, 0, ElementKind::Metric, None);
        assert_eq!(at(380.0, 30.0, DetailLevel::Near), hit_metric);
        assert_eq!(at(328.0, 50.0, DetailLevel::Near), hit_metric);
        assert_eq!(at(387.0, 57.0, DetailLevel::Near), hit_metric);
        assert_eq!(at(320.0, 59.0, DetailLevel::Near), None);
        assert_eq!(at(320.0, 50.0, DetailLevel::Middle), None);
        assert_eq!(at(320.0, 50.0, DetailLevel::Far), None);
    }

    #[test]
    fn the_texts_after_a_progress_bar_are_read_as_their_own() {
        // Verifies: ADR-0013, ADR-0034
        // A progress bar fills no text, so that the texts of the elements after it, in its node
        // and in the nodes after it, are their own: a load of a node of a bar between two texts,
        // then a node of a title.
        use graph_data::tests::load_into;
        let mut engine = fonted();
        let mut content = graph_data::ContentInput::new();
        content.push(
            KindCode::Text,
            1.0,
            RoleCode::Title as u8,
            f64::NAN,
            Some("A"),
            None,
        );
        content.push(KindCode::Progress, 1.0, 0, f64::NAN, None, None);
        content.push_segment(0.5, 0.0);
        content.push(KindCode::Action, 1.0, 0, f64::NAN, Some("Go"), Some("go"));
        content.end_row();
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        data.nodes[0].content = content.into();
        let nodes = graph_data::OwnedColumns::of(data.nodes.iter().map(Some));
        let none = graph_data::OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        assert_eq!(engine.drawn.texts, "AGox");
        let rows = engine.content.content_of(0).0;
        assert!(
            matches!(&rows[0][2], ContentElement::Action { text, id, .. } if text == "Go" && id == "go")
        );
        assert!(
            matches!(&engine.content.content_of(1).0[0][0], ContentElement::Text { text, .. } if text == "x")
        );
        assert_eq!(
            element(&engine, 0, 75.0, 15.0, DetailLevel::Near),
            hit(0, 2, ElementKind::Action, Some("go"))
        );
    }

    #[test]
    fn a_patch_of_content_lays_the_node_out_anew_and_a_refused_one_changes_nothing() {
        // Verifies: ADR-0013, ADR-0030
        use graph_data::tests::{TITLE, b_of, content, load_into, text};
        let mut engine = fonted();
        let nodes = b_of(&[&[TITLE]]);
        let none = graph_data::OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        let body = text(RoleCode::Body, "b");
        let long = text(RoleCode::Title, "abcdefghijklmnopqrst");
        let rows = content(&[&[long], &[body], &[body], &[body], &[body]]);
        let patch = NodePatch(vec![("content".to_owned(), rows.into())]);
        let slot = 1;
        let (checked, height) = patch_of("b", &patch, &engine.fonts, 0).unwrap().unwrap();
        engine.graph.resize_node(slot, height).unwrap();
        engine.content.set(slot, checked);
        assert_eq!(engine.graph.sizes()[2..], [100.0, 102.0]);
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        // The long title is cut to 9 glyphs and an ellipsis within its column of 76.
        let long = &engine.drawn.texts[engine.drawn.bounds[1] as usize..];
        assert!(long.starts_with("abcdefghi\u{2026}b"), "{long}");
        assert_eq!(engine.drawn.bounds[2] - engine.drawn.bounds[1], 10);
        // Its content, built when asked, is the patch's, each weight as the engine keeps it.
        let text = |role, text: &str| ContentElement::Text {
            role,
            text: text.to_owned(),
            weight: Some(1.0),
        };
        let rows = engine.content.content_of(slot).0;
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0], [text(TextRole::Title, "abcdefghijklmnopqrst")]);
        assert_eq!(rows[4], [text(TextRole::Body, "b")]);
        assert_eq!(
            engine.content.content_of(0).0,
            [[text(TextRole::Title, "x")]]
        );
        // A refused patch leaves the node as it was.
        let refused = NodePatch(vec![(
            "content".to_owned(),
            content(&[&[(KindCode::Unnamed, 1.0, RoleCode::Title, None)]]).into(),
        )]);
        assert!(patch_of("b", &refused, &engine.fonts, 0).is_err());
        assert_eq!(engine.graph.sizes()[2..], [100.0, 102.0]);
        // A slot that holds no node is the shell's mistake.
        assert_eq!(
            engine.graph.resize_node(7, 64.0),
            Err(comb_engine::graph::SlotError::NoNode { slot: 7 })
        );
    }

    #[test]
    fn a_load_whose_texts_are_all_empty_and_a_node_of_no_rows_lay_out() {
        // Verifies: ADR-0034
        // Every text empty: the column of texts crosses in no piece at all.
        use graph_data::tests::{content, load_into, text};
        let empty = || content(&[&[text(RoleCode::Title, "")]]);
        let mut nodes = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]).nodes;
        for node in &mut nodes {
            node.content = empty().into();
        }
        let columns = graph_data::OwnedColumns::of(nodes.iter().map(Some));
        let mut engine = Engine::new();
        let none = graph_data::OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &columns, &none), Ok(2));
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        assert_eq!(engine.drawn.texts, "");
        assert_eq!(engine.drawn.bounds, [0, 0, 0]);
        // A node patched to no rows at all lays out to none, the least height high.
        let patch = NodePatch(vec![("content".to_owned(), content(&[]).into())]);
        let (checked, height) = patch_of("b", &patch, &engine.fonts, 0).unwrap().unwrap();
        engine.graph.resize_node(1, height).unwrap();
        engine.content.set(1, checked);
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        assert_eq!(engine.content_bounds, [0, 1, 1]);
        assert_eq!(engine.graph.sizes()[3], 64.0);
    }

    #[test]
    fn a_font_handed_over_after_a_load_lays_every_node_out_anew_and_moves_its_edges() {
        // Verifies: ADR-0013
        // Two nodes of one title, joined by an edge: a title line of 60 makes each 10 + 60 + 10 =
        // 80 high, and the edge leaves and enters at their middles, 40 down.
        use graph_data::tests::load_into;
        let mut engine = Engine::new();
        let nodes = graph_data::OwnedColumns::of(
            batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[])
                .nodes
                .iter()
                .map(Some),
        );
        let edges = graph_data::OwnedEdgeColumns::of([Some(&graph_data::EdgeCells::from(
            &batch(&[], &[("e", "a", "b")]).edges[0],
        ))]);
        assert_eq!(load_into(&mut engine, &nodes, &edges), Ok(2));
        assert_eq!(engine.graph.sizes(), [100.0, 64.0, 100.0, 64.0]);
        let title = RoleCode::Title as u8;
        assert_eq!(engine.set_font(title, &[], &[], 7.0, 60.0), Ok(()));
        assert_eq!(engine.graph.sizes(), [100.0, 80.0, 100.0, 80.0]);
        let mut ends = Vec::new();
        engine.graph.edge_ends(&[0], &mut ends);
        assert_eq!(ends, [100.0, 40.0, 300.0, 40.0]);
        let hit = engine
            .graph
            .hit_at(Point::new(350.0, 75.0), 1.0, Level::Near, false);
        assert_eq!(hit, Some(Target::Node(1)));
    }

    #[test]
    fn a_font_whose_role_or_metrics_the_engine_cannot_take_is_refused_and_nothing_changes() {
        // Verifies: ADR-0031
        let mut engine = Engine::new();
        let refused = Err(CallRefusal::Number(NumberError::InvalidFont));
        assert_eq!(
            engine.set_font(RoleCode::Unnamed as u8, &[], &[], 1.0, 1.0),
            refused
        );
        assert_eq!(engine.set_font(9, &[], &[], 1.0, 1.0), refused);
        assert_eq!(engine.set_font(0, &[65], &[], 1.0, 1.0), refused);
        assert_eq!(engine.set_font(0, &[], &[], f64::NAN, 1.0), refused);
        assert_eq!(engine.set_font(0, &[], &[], 1.0, -1.0), refused);
        assert_eq!(engine.fonts, Fonts::default());
        assert_eq!(engine.set_font(0, &[], &[], 1.0, 20.0), Ok(()));
        assert_ne!(engine.fonts, Fonts::default());
    }

    #[test]
    fn four_vertices_for_each_of_the_most_edges_a_load_holds_fit_the_budget() {
        // Verifies: ADR-0027
        assert!(4 * u64::from(MAX_ITEMS) <= u64::from(MESH_BUDGET));
        assert_eq!(MESH_BUDGET, (4 * MAX_ITEMS).next_power_of_two());
    }

    /// Queries the graph of `data` for `rect` at `level`, where a pixel is `pixel` world units.
    fn detail_of(data: &GraphBatch, rect: [f64; 4], level: DetailLevel, pixel: f64) -> Engine {
        let mut engine = Engine::new();
        engine.graph = graph_of(data).unwrap();
        let [min_x, min_y, max_x, max_y] = rect;
        let rect = RectInput {
            min_x,
            min_y,
            max_x,
            max_y,
        };
        let detail = engine.query_rect(&rect, level, pixel, 0.0).unwrap();
        assert_eq!(MeshDetail::from(engine.visible.mesh.detail), detail);
        engine
    }

    #[test]
    fn a_small_graph_queries_complete_and_a_million_curved_edges_whole_far_coarsened() {
        // Verifies: ADR-0034
        let small = batch(&[("a", 0.0, 0.0), ("b", 300.0, 100.0)], &[("e", "a", "b")]);
        let rect = [-100.0, -100.0, 500.0, 300.0];
        let engine = detail_of(&small, rect, DetailLevel::Near, 1.0);
        assert_eq!(engine.visible.mesh.detail, Detail::Complete);
        assert!(engine.mesh_distances_len() > 4);
        // 1,000 nodes, 40 a row, 400 apart and 300 down; each edge from a node to one in another
        // row, so that it bends.
        let ids: Vec<String> = (0..1_000).map(|n| format!("n{n}")).collect();
        let nodes: Vec<_> = (0..1_000)
            .map(|n| {
                (
                    ids[n].as_str(),
                    (n % 40) as f64 * 400.0,
                    (n / 40) as f64 * 300.0,
                )
            })
            .collect();
        let edge_ids: Vec<String> = (0..MAX_ITEMS).map(|e| format!("e{e}")).collect();
        let edges: Vec<_> = (0..MAX_ITEMS as usize)
            .map(|e| {
                let (source, target) = (e % 1_000, (e * 7 + 41) % 1_000);
                (
                    edge_ids[e].as_str(),
                    ids[source].as_str(),
                    ids[target].as_str(),
                )
            })
            .collect();
        let large = batch(&nodes, &edges);
        // The whole graph, 16,000 by 7,500, on a screen 1,440 pixels wide.
        let whole = [-1_000.0, -1_000.0, 17_000.0, 8_500.0];
        let engine = detail_of(&large, whole, DetailLevel::Far, 18_000.0 / 1_440.0);
        assert_eq!(engine.visible.edges.len(), MAX_ITEMS as usize);
        assert_eq!(engine.visible.mesh.detail, Detail::Coarsened);
        assert!(engine.mesh_distances_len() <= MESH_BUDGET as usize);
        assert!(engine.mesh_indices_len() <= 3 * MESH_BUDGET as usize);
    }

    #[test]
    fn a_hit_refuses_a_pixel_that_is_not_a_finite_number_above_zero() {
        // Verifies: ADR-0013
        let mut engine = Engine::new();
        engine.graph = graph_of(&batch(
            &[("a", 0.0, 0.0), ("b", 300.0, 100.0)],
            &[("e", "a", "b")],
        ))
        .unwrap();
        // Refused before anything is hit, so the native test needs no JavaScript value.
        for pixel in [0.0, -0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            assert!(
                engine
                    .hit(200.0, 60.0, pixel, DetailLevel::Near, true)
                    .is_err(),
                "{pixel}"
            );
        }
    }

    #[test]
    fn a_hit_refuses_a_pixel_that_is_not_a_finite_number_above_zero_as_the_shells_mistake() {
        // Verifies: ADR-0031
        let mut engine = Engine::new();
        let data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 100.0)], &[("e", "a", "b")]);
        engine.graph = graph_of(&data).unwrap();
        let before = engine.graph.positions().to_vec();
        // Refused before anything is hit, so the native test needs no JavaScript value.
        for pixel in [0.0, -0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let hit = engine.hit(200.0, 60.0, pixel, DetailLevel::Near, true);
            assert_eq!(
                hit.err(),
                Some(CallRefusal::Number(NumberError::InvalidPixel)),
                "{pixel}"
            );
        }
        assert_eq!(engine.graph.positions(), before);
    }

    #[test]
    fn a_hit_and_a_move_of_a_label_refuse_a_point_that_is_not_finite_and_change_nothing() {
        // Verifies: ADR-0031
        let mut engine = Engine::new();
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 100.0)], &[("e", "a", "b")]);
        data.edges[0].label = Some(LabelInput {
            text_length: Some(1),
            t: 0.5.into(),
            offset: 0.0.into(),
            background: None,
        })
        .into();
        engine.graph = graph_of(&data).unwrap();
        let before = engine.label_point(0);
        let refusal = || CallRefusal::Number(NumberError::NonFinitePoint);
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            for (x, y) in [(bad, 60.0), (200.0, bad)] {
                let moved = engine.move_label(0, x, y);
                assert_eq!(moved, Err(refusal()), "({x}, {y})");
                assert_eq!(engine.label_point(0), before, "the label at ({x}, {y})");
                // Refused before anything is hit, so the native test needs no JavaScript value.
                let hit = engine.hit(x, y, 1.0, DetailLevel::Near, true);
                assert_eq!(hit.err(), Some(refusal()), "hit at ({x}, {y})");
            }
        }
        assert!(engine.move_label(0, 150.0, 80.0).is_ok());
        assert_ne!(engine.label_point(0), before);
    }

    #[test]
    fn a_pixel_that_is_not_a_finite_number_above_zero_is_refused_before_any_edge_is_flattened() {
        // Verifies: ADR-0027, ADR-0031
        let mut engine = Engine::new();
        let data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 100.0)], &[("e", "a", "b")]);
        engine.graph = graph_of(&data).unwrap();
        let rect = RectInput {
            min_x: -100.0,
            min_y: -100.0,
            max_x: 500.0,
            max_y: 300.0,
        };
        for pixel in [0.0, -0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let refused = engine.query_rect(&rect, DetailLevel::Near, pixel, 0.0);
            assert_eq!(
                refused,
                Err(CallRefusal::Number(NumberError::InvalidPixel)),
                "{pixel}"
            );
            assert!(engine.visible.edges.is_empty(), "{pixel}");
        }
        let quarter = engine.query_rect(&rect, DetailLevel::Near, 0.25, 0.0);
        assert_eq!(quarter, Ok(MeshDetail::Complete));
        // The least pixel there is: accepted, and the budget bounds what it flattens.
        let least = engine.query_rect(&rect, DetailLevel::Near, f64::MIN_POSITIVE, 0.0);
        assert_eq!(least, Ok(MeshDetail::Coarsened));
        assert!(engine.mesh_distances_len() <= MESH_BUDGET as usize);
    }
}
