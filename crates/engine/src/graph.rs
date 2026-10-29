//! The loaded graph as the engine keeps it: node positions and sizes per node slot, edges per edge
//! slot, a rank per node slot that orders drawing and hitting, and a spatial index over both that
//! loads, additions, and moves keep current (ADR-0033, ADR-0022, ADR-0027).
//!
//! A query answers which node slots, edge slots, and edge labels a rectangle meets, and writes
//! those slots, the points of the labels, and the mesh of the edges into buffers the caller reads;
//! the ends of the edges it found are computed only when inspection asks for them.
//!
//! The graph is split by concept: `slots` keeps the free slots of a kind, `nodes` and `edges` the
//! edits of each, `index` the spatial index and the rule that builds it again, `hit` the hit test,
//! `labels` the edge labels, and `query` what a rectangle meets.

use crate::geometry::{EdgePath, Point, Rect, Sides};
use crate::spatial::Grid;
use crate::stroke::EdgeStyle;

mod edges;
mod hit;
mod index;
mod labels;
mod nodes;
mod query;
mod slots;

#[cfg(test)]
mod budget;
#[cfg(test)]
mod tests;

pub use hit::Target;
pub use nodes::PositionError;
/// The origin of a query, which the tests of `stroke` take theirs from.
#[cfg(test)]
pub(crate) use query::origin_of;
pub use query::{Level, Visible};
use slots::Slots;

/// An edge between two node slots, with the path parameter and label offset of its edge label
/// and the style it is drawn with.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EdgeSpec {
    pub source: u32,
    pub target: u32,
    /// The sides it leaves its source by and enters its target by (ADR-0024).
    pub sides: Sides,
    pub label: Option<LabelPlacement>,
    pub style: EdgeStyle,
}

/// Where an edge label sits on its edge: path parameter `t` and label offset (G-6).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LabelPlacement {
    pub t: f64,
    pub offset: f64,
}

/// Why a graph was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphError {
    /// The positions and sizes buffers do not hold the same number of slots.
    SlotCountMismatch,
    /// An edge names a node slot that does not exist.
    EdgeEndOutOfRange { edge: u32 },
    /// More nodes or edges than slots numbered in a `u32`.
    TooManySlots,
}

/// More nodes or edges than slots numbered in a `u32`: the one refusal of a count, of an addition,
/// and of a slot taken.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TooManySlots;

impl From<TooManySlots> for GraphError {
    fn from(_: TooManySlots) -> Self {
        Self::TooManySlots
    }
}

/// Why a call that names slots was refused: a slot beyond the slots, or free (ADR-0022).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotError {
    /// A slot that holds no node.
    NoNode { slot: u32 },
    /// A slot that holds no edge.
    NoEdge { slot: u32 },
}

/// Why an edge was not added: an end that holds no node, or a slot past those a `u32` numbers,
/// refused as a node past them is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddEdgeError {
    Slot(SlotError),
    TooManySlots(TooManySlots),
}

/// Why a move of nodes was refused: a slot that holds no node, or a delta that is not finite.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MoveError {
    Slot(SlotError),
    Position(PositionError),
}

impl From<SlotError> for MoveError {
    fn from(error: SlotError) -> Self {
        Self::Slot(error)
    }
}

impl From<PositionError> for MoveError {
    fn from(error: PositionError) -> Self {
        Self::Position(error)
    }
}

impl From<SlotError> for AddEdgeError {
    fn from(error: SlotError) -> Self {
        Self::Slot(error)
    }
}

impl From<TooManySlots> for AddEdgeError {
    fn from(error: TooManySlots) -> Self {
        Self::TooManySlots(error)
    }
}

/// The slot of the node or edge at `index`, or the count of `index` of them, refused where it
/// lies beyond `u32`: the one conversion of a count to slots, for the engine and the bridge alike.
pub fn slot(index: usize) -> Result<u32, TooManySlots> {
    u32::try_from(index).map_err(|_| TooManySlots)
}

/// The loaded graph and its spatial index.
#[derive(Debug, Default)]
pub struct Graph {
    positions: Vec<f32>,
    sizes: Vec<f32>,
    edges: Vec<EdgeSpec>,
    /// The node slots, free ones among them (ADR-0022).
    node_slots: Slots,
    /// The edge slots, free ones among them (ADR-0022).
    edge_slots: Slots,
    paths: Vec<EdgePath>,
    /// The bounds of each path, computed when the path is.
    bounds: Vec<Rect>,
    labels: Vec<Option<Point>>,
    /// Half the width and half the height of each edge label's pill in world units, as the shell
    /// measured it; a label it has not measured is not hit (ADR-0025).
    pills: Vec<Option<(f64, f64)>>,
    /// The largest half extent of any pill measured, by which a hit looks for labels around it.
    widest_pill: f64,
    /// The edge slots at each node slot, one list per node slot (ADR-0022).
    incident: Vec<Vec<u32>>,
    /// The rank of each node slot: the node of the higher rank is drawn and hit above the other
    /// (ADR-0022).
    ranks: Vec<u32>,
    /// The rank the next node added takes, one above the highest given.
    next_rank: u64,
    /// The node slots in use when the index was last built.
    indexed_nodes: u32,
    /// The edge slots in use when the index was last built.
    indexed_edges: u32,
    node_grid: Grid,
    edge_grid: Grid,
    /// How often the index was built, for the tests that count rebuilds.
    #[cfg(test)]
    builds: u32,
    /// How often the rule that builds the index again was asked, for the tests that count it.
    #[cfg(test)]
    rule_asked: u32,
    /// How often an edge was placed, for the tests that count placements.
    #[cfg(test)]
    placements: std::cell::Cell<u32>,
    scratch: Vec<u32>,
    points: Vec<Point>,
}

impl Graph {
    /// A graph of the nodes at `positions`, `x, y` per slot, of `sizes`, `width, height` per slot,
    /// and of `edges`, edge slot `i` for edge `i`.
    pub fn new(
        positions: Vec<f32>,
        sizes: Vec<f32>,
        edges: Vec<EdgeSpec>,
    ) -> Result<Self, GraphError> {
        if positions.len() != sizes.len() || !positions.len().is_multiple_of(2) {
            return Err(GraphError::SlotCountMismatch);
        }
        let node_slots = slot(positions.len() / 2)?;
        let edge_slots = slot(edges.len())?;
        if let Some(edge) = (0..edge_slots).find(|&e| {
            let spec = edges[e as usize];
            spec.source >= node_slots || spec.target >= node_slots
        }) {
            return Err(GraphError::EdgeEndOutOfRange { edge });
        }
        let mut graph = Self {
            positions,
            sizes,
            edges,
            node_slots: Slots::loaded(node_slots),
            edge_slots: Slots::loaded(edge_slots),
            ranks: (0..node_slots).collect(),
            next_rank: u64::from(node_slots),
            pills: vec![None; edge_slots as usize],
            ..Self::default()
        };
        graph.link();
        graph.place_edges();
        graph.index();
        Ok(graph)
    }

    /// The node positions, `x, y` per slot.
    pub fn positions(&self) -> &[f32] {
        &self.positions
    }
}
