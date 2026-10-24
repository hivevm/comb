//! The bridge between the shell and the engine (ADR-0010).
//!
//! Structured data crosses through serde-wasm-bindgen as `Ts<T>`, with TypeScript types tsify
//! generates; node positions and the results of a viewport query cross as buffers the engine
//! owns, which the shell reads as typed-array views created anew after every call.
//!
//! This root holds the exports and their conversions; the reading and checking of graph data,
//! which the bridge alone does (ADR-0026), is the module `graph_data`.

#![cfg_attr(
    test,
    allow(
        clippy::cast_possible_truncation,
        reason = "test code narrows the fixtures it builds; the lint holds the code that ships"
    )
)]

mod graph_data;

use comb_engine::geometry::Point;
use comb_engine::geometry::Rect;
use comb_engine::graph::{Graph, Level, SlotError as GraphSlotError, Target, Visible};
use comb_engine::positions::PositionError;
use comb_engine::stroke::Detail;
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;

pub use graph_data::{
    Arrow, CheckedPatch, EdgeInput, EdgePatch, Field, GraphBatch, GraphDataProblem, GraphList,
    LabelInput, MAX_ID, MAX_ID_UNITS, MAX_ITEMS, MAX_TEXT, NodeInput, NodePatch, Pair, Text,
};

use graph_data::{
    ID_LIMIT, TEXT_LIMIT, add_edge_to, add_node_to, graph_of, malformed, patch_of, reading, slot,
    unshaped, update_edge_in,
};

/// Why the engine refused a move of nodes: the shell's own mistake, never one of graph data, so
/// that a host application never meets it.
#[derive(Tsify, Serialize, Deserialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TranslateError {
    /// A slot beyond the loaded nodes.
    #[serde(rename_all = "camelCase")]
    SlotOutOfRange { slot: u32 },
    /// A delta that is NaN or infinite.
    NonFiniteDelta,
}

/// Why the engine refused a call that names slots: a slot that holds no node or no edge, beyond
/// the slots or free. The shell's own mistake, never one of graph data, since `api` refuses an identifier the
/// graph does not hold before it names a slot (ADR-0026).
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

impl From<PositionError> for TranslateError {
    fn from(error: PositionError) -> Self {
        match error {
            PositionError::SlotOutOfRange { slot } => Self::SlotOutOfRange { slot },
            PositionError::NonFinite => Self::NonFiniteDelta,
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

impl From<TranslateError> for JsValue {
    fn from(error: TranslateError) -> Self {
        thrown(error)
    }
}

impl From<SlotError> for JsValue {
    fn from(error: SlotError) -> Self {
        thrown(error)
    }
}

/// The most UTF-16 code units of a title or a label text, `MAX_TEXT`: the shell hands over no
/// more than one beyond it, so that a text of any length costs at most that much to check.
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

/// Checks the patch `updateNode` hands over for the node `node`, reading it once, and returns
/// the fields it changes, which the store merges in its place; the engine keeps nothing of it.
#[wasm_bindgen(js_name = checkNodePatch)]
pub fn check_node_patch(
    node: &str,
    patch: Ts<NodePatch>,
) -> Result<Ts<CheckedPatch>, GraphDataProblem> {
    let checked = patch_of(node, patch.to_rust().map_err(unshaped)?)?;
    Ts::from_rust(&checked).map_err(|_| malformed("the checked patch could not be handed back"))
}

/// What a press hits (ADR-0025): a node or an edge by its slot, or nothing; one generated value
/// (ADR-0010).
#[derive(Tsify, Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Hit {
    None,
    Node { slot: u32 },
    Edge { slot: u32 },
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
    pub fn load_graph(&mut self, batch: Ts<GraphBatch>) -> Result<u32, GraphDataProblem> {
        trap::spring();
        let batch = reading(|| batch.to_rust()).map_err(unshaped)?;
        self.graph = graph_of(&batch)?;
        self.visible = Visible::default();
        slot(batch.nodes.len())
    }

    /// Checks the node `addNode` hands over as a load checks a node and adds it, drawn and hit
    /// above every other node, and returns the slot the engine chose for it: the free slot freed
    /// last, or a new one after the highest (ADR-0022). A refused node leaves the graph as it was.
    #[wasm_bindgen(js_name = addNode)]
    pub fn add_node(&mut self, node: Ts<NodeInput>) -> Result<u32, GraphDataProblem> {
        trap::spring();
        let node = reading(|| node.to_rust()).map_err(unshaped)?;
        add_node_to(&mut self.graph, &node)
    }

    /// Checks the edge `addEdge` hands over as a load checks an edge, refuses one from a node to
    /// itself (ADR-0024), adds it between the node slots `source` and `target`, which the shell
    /// resolved, and returns the slot the engine chose for it (ADR-0022). A refused edge leaves
    /// the graph as it was.
    #[wasm_bindgen(js_name = addEdge)]
    pub fn add_edge(
        &mut self,
        edge: Ts<EdgeInput>,
        source: u32,
        target: u32,
    ) -> Result<u32, GraphDataProblem> {
        trap::spring();
        let edge = reading(|| edge.to_rust()).map_err(unshaped)?;
        add_edge_to(&mut self.graph, &edge, source, target)
    }

    /// Checks the patch `updateEdge` hands over for the edge `id` in `slot`, reading it once, as a
    /// load checks those fields, and gives the edge its new style and label placement; the store
    /// merges the patch, the rest of which the engine does not keep. A refused patch changes
    /// nothing.
    #[wasm_bindgen(js_name = updateEdge)]
    pub fn update_edge(
        &mut self,
        slot: u32,
        id: &str,
        patch: Ts<EdgePatch>,
    ) -> Result<(), GraphDataProblem> {
        trap::spring();
        let patch = reading(|| patch.to_rust()).map_err(unshaped)?;
        update_edge_in(&mut self.graph, slot, id, patch)
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
        Ok(self.graph.remove_nodes(slots)?)
    }

    /// Removes the edges in `slots`; the slots go onto the free list (ADR-0022). A slot that holds
    /// no edge refuses the call, which then changes nothing.
    #[wasm_bindgen(js_name = removeEdges)]
    pub fn remove_edges(&mut self, slots: &[u32]) -> Result<(), SlotError> {
        trap::spring();
        Ok(self.graph.remove_edges(slots)?)
    }

    /// Moves the nodes in `slots` by `(dx, dy)`, their edges with them.
    pub fn translate(&mut self, slots: &[u32], dx: f32, dy: f32) -> Result<(), TranslateError> {
        trap::spring();
        self.graph
            .translate(slots, dx, dy)
            .map_err(TranslateError::from)
    }

    /// Finds the nodes and edges that meet the rectangle and builds the mesh of the edges for
    /// `level`, where a screen pixel is `pixel` world units, within the mesh budget; at the near
    /// level also the edge labels within `label_reach` of it. Returns the detail of the mesh; the
    /// results are read through the `visible…` and `mesh…` buffers. A pixel that is not a finite
    /// number above zero is refused as malformed before any edge is flattened.
    pub fn query(
        &mut self,
        rect: Ts<RectInput>,
        level: DetailLevel,
        pixel: f64,
        label_reach: f64,
    ) -> Result<MeshDetail, GraphDataProblem> {
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
    /// at `level`: the node drawn on top there, else the edge drawn on top within 4 screen pixels
    /// of its path, else nothing (ADR-0025).
    pub fn hit(
        &mut self,
        x: f64,
        y: f64,
        pixel: f64,
        level: DetailLevel,
    ) -> Result<Ts<Hit>, GraphDataProblem> {
        trap::spring();
        let hit = match self.graph.hit_at(Point::new(x, y), pixel, level.into()) {
            Some(Target::Node(slot)) => Hit::Node { slot },
            Some(Target::Edge(slot)) => Hit::Edge { slot },
            None => Hit::None,
        };
        Ts::from_rust(&hit).map_err(|_| malformed("the hit could not be handed back"))
    }
}

impl Engine {
    /// `query` of a rectangle already converted.
    fn query_rect(
        &mut self,
        rect: &RectInput,
        level: DetailLevel,
        pixel: f64,
        label_reach: f64,
    ) -> Result<MeshDetail, GraphDataProblem> {
        if !(pixel.is_finite() && pixel > 0.0) {
            return Err(malformed(
                "the size of a screen pixel is not a finite number above zero",
            ));
        }
        let rect = Rect::new(rect.min_x, rect.min_y, rect.max_x, rect.max_y);
        self.graph
            .query(&rect, level.into(), pixel, label_reach, &mut self.visible);
        Ok(self.visible.mesh.detail.into())
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
    /// relative to (ADR-0010).
    #[wasm_bindgen(js_name = originX)]
    pub fn origin_x(&self) -> f64 {
        self.visible.origin.x
    }

    /// The `y` of the origin the last `query` wrote its vertex positions and label points
    /// relative to (ADR-0010).
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
                Err(TranslateError::SlotOutOfRange { slot })
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
        // Verifies: ADR-0010
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
    fn a_pixel_that_is_not_a_finite_number_above_zero_is_refused_before_any_edge_is_flattened() {
        // Verifies: ADR-0027
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
                Err(malformed(
                    "the size of a screen pixel is not a finite number above zero"
                )),
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
