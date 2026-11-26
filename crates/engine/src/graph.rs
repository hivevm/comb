//! The loaded graph as the engine keeps it: node positions and sizes per node slot, edges per edge
//! slot, a rank per node slot that orders drawing and hitting, and a spatial index over both that
//! loads, additions, and moves keep current (API-bridge-columns-carry-nesting,
//! ARCH-engine-edits-nested-graph, REN-virtualized-nested-scene).
//!
//! A query answers which node slots, edge slots, and edge labels a rectangle meets, and writes
//! those slots, the points of the labels, and the mesh of the edges into buffers the caller reads;
//! the ends of the edges it found are computed only when inspection asks for them.
//!
//! The graph is split by concept: `slots` keeps the free slots of a kind, `nodes` and `edges` the
//! edits of each, `containers` which node each node lies in and the order of containers
//! (ARCH-engine-edits-nested-graph), `index` the spatial index and the rule that builds it again,
//! `hit` the hit test, `labels` the edge labels, `query` what a rectangle meets, `resize` the
//! resize of a node by its resize handles, `regions` the regions a node is divided into
//! (ARCH-regions-are-container-slots), and `borders` the border nodes that ride a node's outline
//! (ARCH-border-nodes-ride-sides).

use crate::geometry::{EdgePath, Point, Rect, Sides};
use crate::shape::{NodeShape, Outline};
use crate::spatial::Grid;
use crate::stroke::EdgeStyle;

mod borders;
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

pub use borders::{AttachError, Place};
pub use containers::{CANVAS, NestError, Nesting};
pub use hit::Target;
pub use nodes::PositionError;
/// The origin of a query, which the tests of `stroke` take theirs from.
#[cfg(test)]
pub(crate) use query::origin_of;
pub use query::{Level, MeshAt, Visible};
pub use regions::{Axis, BAND, DivideError, Divided, LEAST_REGION, LineError, Part, RegionSlots};
pub use resize::{Handle, LEAST_SIDE, resized};
use slots::Slots;

/// Where an end of an edge lies: on the node in a node slot, or on the edge in an edge slot at the
/// path parameter `t` of that edge's path, from 0 to 1, one level deep
/// (API-edges-dock-nodes-or-edges, *Ends*).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum End {
    Node(u32),
    Edge { slot: u32, t: f64 },
}

impl End {
    /// The node slot of an end on a node, or none.
    pub const fn node(self) -> Option<u32> {
        match self {
            Self::Node(slot) => Some(slot),
            Self::Edge { .. } => None,
        }
    }

    /// The edge slot of an end on an edge, or none.
    pub const fn edge(self) -> Option<u32> {
        match self {
            Self::Node(_) => None,
            Self::Edge { slot, .. } => Some(slot),
        }
    }
}

/// One of the two ends of an edge, as a refusal names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Which {
    Source,
    Target,
}

/// An edge between two ends, each on a node or on another edge, with the path parameter and label
/// offset of each of its edge labels, in the order of its list, and the style it is drawn with.
#[derive(Clone, Debug, PartialEq)]
pub struct EdgeSpec {
    pub source: End,
    pub target: End,
    /// Where it leaves its source and enters its target: at a side's connector or on the outline
    /// (API-edges-dock-nodes-or-edges); an end on an edge reads none of it.
    pub sides: Sides,
    /// Where each of its edge labels sits, in the order of its list of labels
    /// (API-edges-dock-nodes-or-edges, *Edge labels*).
    pub labels: Vec<LabelPlacement>,
    pub style: EdgeStyle,
}

#[cfg(test)]
impl EdgeSpec {
    /// The node slots of the source and the target of an edge both of whose ends lie on nodes, as
    /// the tests that end no edge on an edge read them.
    pub(crate) fn nodes(&self) -> (u32, u32) {
        let node = |end: End| end.node().expect("an end on a node");
        (node(self.source), node(self.target))
    }
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
    /// An edge names a node slot or an edge slot that does not exist.
    EdgeEndOutOfRange { edge: u32 },
    /// An edge ends on itself, or on an edge that itself ends on an edge
    /// (API-edges-dock-nodes-or-edges, *Ends*).
    EdgeEndOnEdgeEnd { edge: u32 },
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
/// (ARCH-engine-edits-nested-graph).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotError {
    /// A slot that holds no node.
    NoNode { slot: u32 },
    /// A slot that holds no edge.
    NoEdge { slot: u32 },
}

/// Why an edge was not added: an end on a slot that holds no node or no edge, an end on an edge
/// that itself ends on an edge (API-edges-dock-nodes-or-edges, *Ends*), or a slot past those a
/// `u32` numbers, refused as a node past them is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddEdgeError {
    Slot(SlotError),
    OnEdgeEnd(Which),
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
    /// The node shape of each node slot (REN-node-shapes-cover-uml); a slot past its end is a
    /// rectangle, so that a graph that names no node shape keeps none.
    shapes: Vec<NodeShape>,
    /// How the outline of each node slot is drawn (REN-node-shapes-cover-uml, *Outline*); a slot
    /// past its end is solid.
    outlines: Vec<Outline>,
    /// The height each node slot's data gives, or a resize left, or none; a slot past its end
    /// has none (API-edits-report-nested-changes).
    given: Vec<Option<f32>>,
    /// Whether the user may resize each node slot by its resize handles; a slot past its end may
    /// not.
    resizable: Vec<bool>,
    edges: Vec<EdgeSpec>,
    /// The node slots, free ones among them (ARCH-engine-edits-nested-graph).
    node_slots: Slots,
    /// The edge slots, free ones among them (ARCH-engine-edits-nested-graph).
    edge_slots: Slots,
    paths: Vec<EdgePath>,
    /// The bounds of each path, computed when the path is.
    bounds: Vec<Rect>,
    /// The point of each edge label of each edge slot, in the order of the edge's list.
    labels: Vec<Vec<Point>>,
    /// Half the width and half the height of each edge label's pill in world units, as the shell
    /// measured it, per edge slot in the order of its list; a label it has not measured is not hit
    /// (REN-node-content-and-hits).
    pills: Vec<Vec<Option<(f64, f64)>>>,
    /// The largest half extent of any pill measured, by which a hit looks for labels around it.
    widest_pill: f64,
    /// The edge slots at each node slot, one list per node slot (ARCH-engine-edits-nested-graph).
    incident: Vec<Vec<u32>>,
    /// The edge slots of the edges that end on each edge slot, one list per edge slot, each edge
    /// once (API-edges-dock-nodes-or-edges, *An end on an edge*).
    anchored: Vec<Vec<u32>>,
    /// The rank of each node slot: the node of the higher rank is drawn and hit above the other
    /// (ARCH-engine-edits-nested-graph).
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
    /// Where each border node sits, none for a node that is no border node; a slot past its end
    /// is none (ARCH-border-nodes-ride-sides).
    places: Vec<Option<Place>>,
    /// The border nodes attached to each node slot, in the order they were attached; a slot past
    /// its end has none.
    borders: Vec<Vec<u32>>,
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
        let held = |end: End| match end {
            End::Node(node) => node < node_slots,
            End::Edge { slot, .. } => slot < edge_slots,
        };
        if let Some(edge) = (0..edge_slots).find(|&e| {
            let spec = &edges[e as usize];
            !(held(spec.source) && held(spec.target))
        }) {
            return Err(GraphError::EdgeEndOutOfRange { edge });
        }
        // An end on an edge lies one level deep: on another edge, whose own ends lie on nodes.
        let on_nodes = |e: u32| {
            let spec = &edges[e as usize];
            spec.source.edge().is_none() && spec.target.edge().is_none()
        };
        if let Some(edge) = (0..edge_slots).find(|&e| {
            let spec = &edges[e as usize];
            [spec.source, spec.target]
                .iter()
                .filter_map(|end| end.edge())
                .any(|on| on == e || !on_nodes(on))
        }) {
            return Err(GraphError::EdgeEndOnEdgeEnd { edge });
        }
        let pills = edges.iter().map(|e| vec![None; e.labels.len()]).collect();
        let mut graph = Self {
            positions,
            sizes,
            edges,
            node_slots: Slots::loaded(node_slots),
            edge_slots: Slots::loaded(edge_slots),
            ranks: (0..node_slots).collect(),
            next_rank: u64::from(node_slots),
            pills,
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
        // An edge between a container and a node it holds is placed by the nesting, which `new`
        // did not know yet; such an edge is at a node that lies in a container.
        let held: Vec<u32> = (0..graph.node_slots.count())
            .filter(|&node| graph.container(node) != CANVAS)
            .collect();
        graph.place_nested_at(&held);
        Ok(graph)
    }

    /// The node positions, `x, y` per slot.
    pub fn positions(&self) -> &[f32] {
        &self.positions
    }
}
