//! The loaded graph as the engine keeps it: node positions and sizes per node slot, edges per edge
//! slot, a rank per node slot that orders drawing and hitting, and a spatial index over both that
//! loads, additions, and moves keep current (API-bridge-takes-serde-and-columns,
//! ARCH-engine-edits-graph-in-place, REN-virtualized-scene-graph).
//!
//! A query answers which node slots, edge slots, and edge labels a rectangle meets, and writes
//! those slots, the points of the labels, and the mesh of the edges into buffers the caller reads;
//! the ends of the edges it found are computed only when inspection asks for them.
//!
//! The graph is split by concept: `slots` keeps the free slots of a kind, `nodes` and `edges` the
//! edits of each, `containers` which node each node lies in and the order of containers
//! (ARCH-engine-edits-nested-graph), `index` the spatial index and the rule that builds it again,
//! `hit` the hit test, `labels` the edge labels, `query` what a rectangle meets, `resize` the
//! resize of a node by its resize handles, and `regions` the regions a node is divided into
//! (ARCH-regions-are-container-slots).

use crate::geometry::{EdgePath, Point, Rect, Sides};
use crate::shape::NodeShape;
use crate::spatial::Grid;
use crate::stroke::EdgeStyle;

mod containers;
mod edges;
mod hit;
mod index;
mod labels;
mod nodes;
mod query;
mod regions;
mod resize;
mod slots;

#[cfg(test)]
mod budget;
#[cfg(test)]
mod tests;

pub use containers::{CANVAS, NestError, Nesting};
pub use hit::Target;
pub use nodes::PositionError;
/// The origin of a query, which the tests of `stroke` take theirs from.
#[cfg(test)]
pub(crate) use query::origin_of;
pub use query::{Level, MeshAt, Visible};
pub use regions::{Axis, BAND, LEAST_REGION, LineError};
pub use resize::{Handle, LEAST_SIDE, resized};
use slots::Slots;

/// An edge between two node slots, with the path parameter and label offset of its edge label
/// and the style it is drawn with.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EdgeSpec {
    pub source: u32,
    pub target: u32,
    /// Where it leaves its source and enters its target: at a side's connector or on the outline
    /// (API-edges-dock-side-or-outline).
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
    /// A node lies in no node, in a node that is no container, or in itself or a node it holds
    /// (ARCH-engine-edits-nested-graph).
    Nest(NestError),
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

/// Why a call that names slots was refused: a slot beyond the slots, or free
/// (ARCH-engine-edits-graph-in-place).
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

/// Why a node was not added: a container that holds no container, or a slot past those a `u32`
/// numbers (ARCH-engine-edits-nested-graph).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddNodeError {
    /// The slot named as its container holds no node, or a node that is no container.
    NoContainer {
        slot: u32,
    },
    TooManySlots(TooManySlots),
}

impl From<TooManySlots> for AddNodeError {
    fn from(error: TooManySlots) -> Self {
        Self::TooManySlots(error)
    }
}

/// Why a move of a node into a container or onto the canvas was refused: a slot that holds no
/// node, a container that is none, or a container that is the node or a node it holds
/// (ARCH-engine-edits-nested-graph, *Moving into a container*). Each is the shell's own mistake.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MoveIntoError {
    Slot(SlotError),
    /// The slot named as the container holds no node, or a node that is no container.
    NoContainer {
        slot: u32,
    },
    /// The container named is the node itself or a node it holds, at any depth.
    InItself {
        slot: u32,
    },
}

impl From<SlotError> for MoveIntoError {
    fn from(error: SlotError) -> Self {
        Self::Slot(error)
    }
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
    /// The node shape of each node slot (REN-closed-set-of-node-shapes); a slot past its end is a
    /// rectangle, so that a graph that names no node shape keeps none.
    shapes: Vec<NodeShape>,
    /// The height each node slot's data gives, or a resize left, or none; a slot past its end
    /// has none (API-edits-report-nested-changes).
    given: Vec<Option<f32>>,
    /// Whether the user may resize each node slot by its resize handles; a slot past its end may
    /// not.
    resizable: Vec<bool>,
    edges: Vec<EdgeSpec>,
    /// The node slots, free ones among them (ARCH-engine-edits-graph-in-place).
    node_slots: Slots,
    /// The edge slots, free ones among them (ARCH-engine-edits-graph-in-place).
    edge_slots: Slots,
    paths: Vec<EdgePath>,
    /// The bounds of each path, computed when the path is.
    bounds: Vec<Rect>,
    labels: Vec<Option<Point>>,
    /// Half the width and half the height of each edge label's pill in world units, as the shell
    /// measured it; a label it has not measured is not hit (REN-node-content-in-rows).
    pills: Vec<Option<(f64, f64)>>,
    /// The largest half extent of any pill measured, by which a hit looks for labels around it.
    widest_pill: f64,
    /// The edge slots at each node slot, one list per node slot (ARCH-engine-edits-graph-in-place).
    incident: Vec<Vec<u32>>,
    /// The rank of each node slot: the node of the higher rank is drawn and hit above the other
    /// (ARCH-engine-edits-graph-in-place).
    ranks: Vec<u32>,
    /// The rank the next node added takes, one above the highest given.
    next_rank: u64,
    /// The slot of the container of each node slot, or `CANVAS`; a slot past its end lies on the
    /// canvas, so that a graph that names no container keeps none (ARCH-engine-edits-nested-graph).
    containers: Vec<u32>,
    /// Whether each node slot is a container; a slot past its end is none.
    is_container: Vec<bool>,
    /// The slots each container holds directly, one list per node slot.
    held: Vec<Vec<u32>>,
    /// The position of each node that lies in a container relative to its container's world
    /// position, the difference of the two `f32` world positions, exact in `f64`: what a move of
    /// the container keeps, so that what it holds lies at the sum along its chain however often it
    /// moves (ARCH-engine-edits-nested-graph, *Positions*). A slot on the canvas keeps none that
    /// is read; a slot past its end is on the canvas.
    relative: Vec<[f64; 2]>,
    /// Where each container is drawn and hit among the containers, the higher above the lower.
    container_order: Vec<u32>,
    /// What each node slot is of regions (ARCH-regions-are-container-slots); a slot past its end
    /// is neither a region nor divided.
    divisions: Vec<regions::Division>,
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

    /// `new`, its nodes nested by `nesting` (ARCH-engine-edits-nested-graph): `positions` are the
    /// world positions, which `Nesting::world` sums along each chain of containers. A nesting
    /// that `Nesting::check` refuses, or of another count of nodes, refuses the graph.
    pub fn nested(
        positions: Vec<f32>,
        sizes: Vec<f32>,
        edges: Vec<EdgeSpec>,
        nesting: Nesting,
    ) -> Result<Self, GraphError> {
        let nodes = nesting.containers.len();
        if nodes * 2 != positions.len() || nesting.is_container.len() != nodes {
            return Err(GraphError::SlotCountMismatch);
        }
        nesting.check().map_err(GraphError::Nest)?;
        let mut graph = Self::new(positions, sizes, edges)?;
        graph.nest(nesting);
        Ok(graph)
    }

    /// The node positions, `x, y` per slot.
    pub fn positions(&self) -> &[f32] {
        &self.positions
    }
}
