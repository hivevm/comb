//! The loaded graph as the engine keeps it: node positions and sizes per node slot, edges per edge
//! slot, a rank per node slot that orders drawing and hitting, and a spatial index over both that
//! loads, additions, and moves keep current (ADR-0010, ADR-0022, ADR-0027).
//!
//! A query answers which node slots, edge slots, and edge labels a rectangle meets, and writes
//! those slots, the points of the labels, and the mesh of the edges into buffers the caller reads;
//! the ends of the edges it found are computed only when inspection asks for them.

use crate::geometry::{EdgePath, Point, Rect, Side, Sides};

/// The four sides, each with a connector.
const SIDES: [Side; 4] = [Side::Top, Side::Right, Side::Bottom, Side::Left];
use crate::positions::{self, PositionError};
use crate::spatial::Grid;
use crate::stroke::{EdgeStyle, MESH_BUDGET, Mesh, Stroke, near_path};

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

/// Why a call that names slots was refused: a slot beyond the slots, or free (ADR-0022).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotError {
    /// A slot that holds no node.
    NoNode { slot: u32 },
    /// A slot that holds no edge.
    NoEdge { slot: u32 },
}

/// The slot of the node or edge at `index`, or the count of `index` of them, refused where it
/// lies beyond `u32`: the one conversion of a count to slots, for the engine and the bridge alike.
pub fn slot(index: usize) -> Result<u32, GraphError> {
    u32::try_from(index).map_err(|_| GraphError::TooManySlots)
}

/// The level of detail a query serves (ADR-0027): near draws edge labels, middle does not, and
/// far draws edges as plain lines one pixel wide.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Near,
    Middle,
    Far,
}

/// What a query found: node slots in ascending rank, edge and label slots in ascending order, per
/// found label its
/// point, and the mesh of the found edges with its detail; the label points and the mesh's
/// positions relative to `origin` (ADR-0010).
#[derive(Debug, Default)]
pub struct Visible {
    pub nodes: Vec<u32>,
    pub edges: Vec<u32>,
    pub labels: Vec<u32>,
    pub label_points: Vec<f32>,
    pub mesh: Mesh,
    pub origin: Point,
}

/// The origin of a query in `rect` (ADR-0010): its centre snapped to a grid whose side is the
/// smallest power of two at least the rectangle's larger side, so that it stays across pans
/// shorter than that, and taken to the nearest `f32`, so that it holds exactly in both; (0, 0)
/// for a rectangle that is not finite or has no area to snap to.
pub(crate) fn origin_of(rect: &Rect) -> Point {
    let side = (rect.max_x - rect.min_x).max(rect.max_y - rect.min_y);
    let grid = side.log2().ceil().exp2();
    #[expect(
        clippy::cast_possible_truncation,
        reason = "taken to the nearest f32 on purpose, so that the origin holds exactly in both \
                  (ADR-0010); a centre beyond f32 turns infinite and falls back to (0, 0) below"
    )]
    let snap = |min: f64, max: f64| f64::from((((min + max) / 2.0 / grid).round() * grid) as f32);
    let origin = Point::new(snap(rect.min_x, rect.max_x), snap(rect.min_y, rect.max_y));
    if origin.x.is_finite() && origin.y.is_finite() {
        origin
    } else {
        Point::default()
    }
}

/// Whether an index whose grid holds `beyond` of `items` items beyond its extent is to be built
/// again: more than an eighth of them, and at least 16.
fn stale(beyond: usize, items: usize) -> bool {
    beyond > (items / 8).max(16)
}

/// How near a press has to come to an edge's path to hit it, in screen pixels (ADR-0025).
const EDGE_REACH: f64 = 4.0;

/// What a press hits (ADR-0025): a connector by its node's slot and side, a label by its edge's
/// slot, a node, or an edge, by its slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    /// The connector of a side of the node in a slot (ADR-0024).
    Connector(u32, Side),
    /// The label of the edge in a slot (ADR-0025).
    Label(u32),
    Node(u32),
    Edge(u32),
}

/// How near a press has to come to a connector to hit it, in screen pixels (ADR-0025).
const CONNECTOR_REACH: f64 = 8.0;

/// The loaded graph and its spatial index.
#[derive(Debug, Default)]
pub struct Graph {
    positions: Vec<f32>,
    sizes: Vec<f32>,
    edges: Vec<EdgeSpec>,
    node_slots: u32,
    edge_slots: u32,
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
    /// The free node slots, the one freed last at the end.
    free_nodes: Vec<u32>,
    /// The free edge slots, the one freed last at the end.
    free_edges: Vec<u32>,
    /// Whether each node slot is free.
    node_free: Vec<bool>,
    /// Whether each edge slot is free.
    edge_free: Vec<bool>,
    /// The node slots in use when the index was last built.
    indexed_nodes: u32,
    /// The edge slots in use when the index was last built.
    indexed_edges: u32,
    node_grid: Grid,
    edge_grid: Grid,
    /// How often the index was built, for the tests that count rebuilds.
    #[cfg(test)]
    builds: u32,
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
            node_slots,
            edge_slots,
            ranks: (0..node_slots).collect(),
            next_rank: u64::from(node_slots),
            node_free: vec![false; node_slots as usize],
            edge_free: vec![false; edge_slots as usize],
            pills: vec![None; edge_slots as usize],
            ..Self::default()
        };
        graph.link();
        graph.index();
        Ok(graph)
    }

    /// How many node slots hold a node.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the free slots are slots below `node_slots`, a u32, and no more of them"
    )]
    pub fn nodes_in_use(&self) -> u32 {
        self.node_slots - self.free_nodes.len() as u32
    }

    /// How many edge slots hold an edge.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the free slots are slots below `edge_slots`, a u32, and no more of them"
    )]
    pub fn edges_in_use(&self) -> u32 {
        self.edge_slots - self.free_edges.len() as u32
    }

    /// Whether `slot` holds a node: a slot below the slots and not free.
    fn holds_node(&self, slot: u32) -> bool {
        self.node_free.get(slot as usize) == Some(&false)
    }

    /// Whether `slot` holds an edge: a slot below the slots and not free.
    fn holds_edge(&self, slot: u32) -> bool {
        self.edge_free.get(slot as usize) == Some(&false)
    }

    /// The node slots that hold a node, in ascending order.
    fn node_slots_in_use(&self) -> impl Iterator<Item = u32> + '_ {
        (0..self.node_slots).filter(|&s| !self.node_free[s as usize])
    }

    /// Adds the node at `(x, y)` of size `(width, height)` and returns its slot: the free slot
    /// freed last, or a new one after the highest. It takes the next rank, so that it is drawn and
    /// hit above every other node, and goes into the index in place; the index is built again only
    /// where the nodes in use pass twice the count it was built for, or more than an eighth of
    /// them, and at least 16, lie beyond its extent (ADR-0022).
    pub fn add_node(&mut self, x: f32, y: f32, width: f32, height: f32) -> Result<u32, GraphError> {
        let rank = self.take_rank();
        let slot = if let Some(free) = self.free_nodes.pop() {
            let i = free as usize;
            self.positions[i * 2..i * 2 + 2].copy_from_slice(&[x, y]);
            self.sizes[i * 2..i * 2 + 2].copy_from_slice(&[width, height]);
            self.ranks[i] = rank;
            self.node_free[i] = false;
            free
        } else {
            let next = slot(self.node_slots as usize + 1)?;
            let new = self.node_slots;
            self.positions.extend([x, y]);
            self.sizes.extend([width, height]);
            self.ranks.push(rank);
            self.node_free.push(false);
            // A node added has no edges yet.
            self.incident.push(Vec::new());
            self.node_slots = next;
            new
        };
        self.next_rank += 1;
        let in_use = self.nodes_in_use();
        if in_use > self.indexed_nodes.saturating_mul(2) {
            self.index();
        } else {
            let bounds = self.node_bounds(slot);
            self.node_grid.add(slot, &bounds);
            if stale(self.node_grid.beyond_extent(), in_use as usize) {
                self.index();
            }
        }
        Ok(slot)
    }

    /// The rank the next node added takes, after the ranks in use are numbered again from 0 in
    /// their order where it would pass `u32::MAX`.
    fn take_rank(&mut self) -> u32 {
        if let Ok(rank) = u32::try_from(self.next_rank) {
            return rank;
        }
        let mut order: Vec<u32> = self.node_slots_in_use().collect();
        order.sort_unstable_by_key(|&s| self.ranks[s as usize]);
        let mut next = 0;
        for &s in &order {
            self.ranks[s as usize] = next;
            next += 1;
        }
        self.next_rank = u64::from(next);
        next
    }

    /// The node positions, `x, y` per slot.
    pub fn positions(&self) -> &[f32] {
        &self.positions
    }

    /// The rectangle of the node in `slot`.
    fn node_bounds(&self, slot: u32) -> Rect {
        let i = slot as usize * 2;
        Rect::of_node(
            f64::from(self.positions[i]),
            f64::from(self.positions[i + 1]),
            f64::from(self.sizes[i]),
            f64::from(self.sizes[i + 1]),
        )
    }

    /// The node slots at the ends of the edge in `slot`, each once.
    fn ends(&self, slot: u32) -> impl Iterator<Item = u32> {
        let edge = self.edges[slot as usize];
        std::iter::once(edge.source).chain((edge.target != edge.source).then_some(edge.target))
    }

    /// Builds the lists of edges at each node.
    fn link(&mut self) {
        let mut incident = vec![Vec::new(); self.node_slots as usize];
        for edge in 0..self.edge_slots {
            for end in self.ends(edge) {
                incident[end as usize].push(edge);
            }
        }
        self.incident = incident;
    }

    /// The slots of the edges at the nodes in `slots`, each once, in ascending order: what a
    /// removal of those nodes would take along, named before anything is removed (ADR-0022). A
    /// slot that holds no node refuses the call.
    pub fn edges_at(&self, slots: &[u32]) -> Result<Vec<u32>, SlotError> {
        if let Some(&slot) = slots.iter().find(|&&s| !self.holds_node(s)) {
            return Err(SlotError::NoNode { slot });
        }
        let mut edges: Vec<u32> = slots
            .iter()
            .flat_map(|&s| self.incident[s as usize].iter().copied())
            .collect();
        edges.sort_unstable();
        edges.dedup();
        Ok(edges)
    }

    /// Removes the nodes in `slots` and every edge at them, and returns the slots of those edges
    /// in ascending order. Their slots go onto the free lists, the one named last freed last, and
    /// they leave the index; nothing else moves (ADR-0022). A slot that holds no node refuses the
    /// call, which then changes nothing.
    pub fn remove_nodes(&mut self, slots: &[u32]) -> Result<Vec<u32>, SlotError> {
        let edges = self.edges_at(slots)?;
        // The nodes go first, so that the edges leave only the lists of the nodes that stay.
        for &slot in slots {
            let i = slot as usize;
            if self.node_free[i] {
                continue;
            }
            self.node_free[i] = true;
            self.free_nodes.push(slot);
            self.incident[i].clear();
        }
        self.node_grid.take(slots);
        self.free_edges_at(&edges);
        Ok(edges)
    }

    /// Adds the edge `spec` and returns its slot: the free slot freed last, or a new one after the
    /// highest. It goes into the lists of its ends and into the index in place; the index is built
    /// again only where the edges in use pass twice the count it was built for, or more than an
    /// eighth of them, and at least 16, lie beyond its extent (ADR-0022). An end that holds no node
    /// refuses the edge, and nothing changes.
    pub fn add_edge(&mut self, spec: EdgeSpec) -> Result<u32, SlotError> {
        if let Some(slot) = [spec.source, spec.target]
            .into_iter()
            .find(|&s| !self.holds_node(s))
        {
            return Err(SlotError::NoNode { slot });
        }
        let slot = if let Some(free) = self.free_edges.pop() {
            self.edges[free as usize] = spec;
            self.edge_free[free as usize] = false;
            self.pills[free as usize] = None;
            free
        } else {
            let next = slot(self.edge_slots as usize + 1).map_err(|_| SlotError::NoEdge {
                slot: self.edge_slots,
            })?;
            let new = self.edge_slots;
            self.edges.push(spec);
            self.edge_free.push(false);
            self.pills.push(None);
            let (path, bounds, label) = self.placement(new);
            self.paths.push(path);
            self.bounds.push(bounds);
            self.labels.push(label);
            self.edge_slots = next;
            new
        };
        for end in self.ends(slot).collect::<Vec<_>>() {
            self.incident[end as usize].push(slot);
        }
        let in_use = self.edges_in_use();
        if in_use > self.indexed_edges.saturating_mul(2) {
            self.index();
        } else {
            let (path, bounds, label) = self.placement(slot);
            self.paths[slot as usize] = path;
            self.bounds[slot as usize] = bounds;
            self.labels[slot as usize] = label;
            let indexed = self.labels[slot as usize].map_or(bounds, |p| bounds.union(&Rect::at(p)));
            self.edge_grid.add(slot, &indexed);
            if stale(self.edge_grid.beyond_extent(), in_use as usize) {
                self.index();
            }
        }
        Ok(slot)
    }

    /// The edge in `slot`, its ends, label placement, and style, where the slot holds one.
    pub fn edge(&self, slot: u32) -> Option<EdgeSpec> {
        self.holds_edge(slot).then(|| self.edges[slot as usize])
    }

    /// Gives the edge in `slot` the label placement `label`, the style `style`, and the sides
    /// `sides`, and places it again in place (ADR-0022, ADR-0024). A slot that holds no edge refuses the change.
    pub fn update_edge(
        &mut self,
        slot: u32,
        label: Option<LabelPlacement>,
        style: EdgeStyle,
        sides: Sides,
    ) -> Result<(), SlotError> {
        if !self.holds_edge(slot) {
            return Err(SlotError::NoEdge { slot });
        }
        let spec = &mut self.edges[slot as usize];
        spec.label = label;
        spec.style = style;
        spec.sides = sides;
        self.place_edge(slot);
        if stale(self.edge_grid.beyond_extent(), self.edges_in_use() as usize) {
            self.index();
        }
        Ok(())
    }

    /// Removes the edges in `slots`. Their slots go onto the free list, the one named last freed
    /// last, and they leave the index and the lists of edges at their ends (ADR-0022). A slot that
    /// holds no edge refuses the call, which then changes nothing.
    pub fn remove_edges(&mut self, slots: &[u32]) -> Result<(), SlotError> {
        if let Some(&slot) = slots.iter().find(|&&s| !self.holds_edge(s)) {
            return Err(SlotError::NoEdge { slot });
        }
        self.free_edges_at(slots);
        Ok(())
    }

    /// Frees the edges in `slots`, each that holds an edge once, and takes them out of the lists
    /// of the nodes in use at their ends, each list once, so that a node of many edges costs its
    /// edges once and not once per edge.
    fn free_edges_at(&mut self, slots: &[u32]) {
        let mut touched = Vec::new();
        for &slot in slots {
            let i = slot as usize;
            if self.edge_free[i] {
                continue;
            }
            self.edge_free[i] = true;
            self.pills[i] = None;
            self.free_edges.push(slot);
            touched.extend(self.ends(slot).filter(|&end| !self.node_free[end as usize]));
        }
        self.edge_grid.take(slots);
        touched.sort_unstable();
        touched.dedup();
        for end in touched {
            let free = &self.edge_free;
            self.incident[end as usize].retain(|&e| !free[e as usize]);
        }
    }

    /// The side of a grid cell: about twice the mean node, and large enough that the grid has
    /// about one cell per node. It affects only how fast a query runs, not which slots it returns:
    /// the grid is exact for any cell side, as the query test against a brute-force scan holds.
    fn cell_side(&self, extent: &Rect) -> f64 {
        let count = f64::from(self.nodes_in_use().max(1));
        let sizes = self.sizes.as_chunks::<2>().0;
        let mean = self
            .node_slots_in_use()
            .map(|s| {
                let size = sizes[s as usize];
                f64::from(size[0].max(size[1]))
            })
            .sum::<f64>()
            / count;
        let area = (extent.max_x - extent.min_x) * (extent.max_y - extent.min_y);
        (2.0 * mean).max((area / count).sqrt())
    }

    /// Rebuilds both grids from the current positions of the slots in use: free slots count for
    /// nothing, neither in the extent nor in the cell side, and stay out of the grids (ADR-0022).
    fn index(&mut self) {
        #[cfg(test)]
        {
            self.builds += 1;
        }
        self.indexed_nodes = self.nodes_in_use();
        self.indexed_edges = self.edges_in_use();
        let nodes: Vec<(u32, Rect)> = self
            .node_slots_in_use()
            .map(|s| (s, self.node_bounds(s)))
            .collect();
        let extent = nodes
            .iter()
            .map(|&(_, bounds)| bounds)
            .reduce(|a, b| a.union(&b))
            .unwrap_or(Rect::new(0.0, 0.0, 1.0, 1.0));
        let cell = self.cell_side(&extent);
        self.node_grid = Grid::new(extent, cell, self.node_slots as usize);
        for (slot, bounds) in &nodes {
            self.node_grid.set(*slot, bounds);
        }
        self.edge_grid = Grid::new(extent, cell, self.edge_slots as usize);
        // A free slot is placed too, from whatever it held, and stays out of the grid.
        let placed: Vec<_> = (0..self.edge_slots).map(|e| self.placement(e)).collect();
        self.paths = placed.iter().map(|&(path, _, _)| path).collect();
        self.bounds = placed.iter().map(|&(_, bounds, _)| bounds).collect();
        self.labels = placed.iter().map(|&(_, _, label)| label).collect();
        for slot in 0..self.edge_slots {
            if self.holds_edge(slot) {
                self.reindex_edge(slot);
            }
        }
    }

    /// The path, its bounds, and the label point of the edge in `slot` from the current positions.
    fn placement(&self, slot: u32) -> (EdgePath, Rect, Option<Point>) {
        let spec = self.edges[slot as usize];
        let path = EdgePath::between(
            &self.node_bounds(spec.source),
            &self.node_bounds(spec.target),
            spec.sides,
        );
        let label = spec
            .label
            .map(|label| path.label_position(label.t, label.offset));
        (path, path.bounds(), label)
    }

    /// Puts the edge in `slot` into the edge grid under the bounds of its path and its label point
    /// together.
    fn reindex_edge(&mut self, slot: u32) {
        let path = self.bounds[slot as usize];
        let bounds = self.labels[slot as usize].map_or(path, |p| path.union(&Rect::at(p)));
        self.edge_grid.set(slot, &bounds);
    }

    /// Recomputes the path and label of the edge in `slot` and moves it in the edge grid.
    fn place_edge(&mut self, slot: u32) {
        let (path, bounds, label) = self.placement(slot);
        self.paths[slot as usize] = path;
        self.bounds[slot as usize] = bounds;
        self.labels[slot as usize] = label;
        self.reindex_edge(slot);
    }

    /// Writes into `out`, after clearing it, the ends of the edges in `slots` as they lie now:
    /// per edge the point it leaves its source and the point it enters its target, `x, y` each,
    /// and NaN for a slot beyond the loaded edges, so that the pairs stay in step with `slots`.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "an end is the middle of a side of a node, whose position and size the engine \
                  keeps as f32; the ends cross without an origin, rounded by their distance from \
                  the world's origin (ADR-0010); a node near the end of f32's range can put an \
                  end past f32::MAX, where it turns infinite, which nothing bounds yet"
    )]
    pub fn edge_ends(&self, slots: &[u32], out: &mut Vec<f32>) {
        out.clear();
        for &slot in slots {
            match self
                .paths
                .get(slot as usize)
                .filter(|_| self.holds_edge(slot))
            {
                Some(path) => out.extend([
                    path.source.x as f32,
                    path.source.y as f32,
                    path.target.x as f32,
                    path.target.y as f32,
                ]),
                None => out.extend([f32::NAN; 4]),
            }
        }
    }

    /// What a press at `point` hits where a screen pixel is `pixel` world units, at `level`: where
    /// `connectors` asks for them, at the near and middle level, a connector within
    /// `CONNECTOR_REACH` screen pixels, of the node of the highest rank; else at the near level a
    /// label whose measured pill holds it, of the highest edge slot; else a node whose bounds hold
    /// it, the one of the highest rank; else an edge within `EDGE_REACH` screen pixels of its path
    /// as the stroke of `level` flattens it, the one in the highest slot; else nothing (ADR-0025).
    pub fn hit_at(
        &mut self,
        point: Point,
        pixel: f64,
        level: Level,
        connectors: bool,
    ) -> Option<Target> {
        if connectors
            && level != Level::Far
            && let Some((slot, side)) = self.connector_at(point, CONNECTOR_REACH * pixel)
        {
            return Some(Target::Connector(slot, side));
        }
        if level == Level::Near
            && let Some(slot) = self.label_at(point)
        {
            return Some(Target::Label(slot));
        }
        if let Some(slot) = self.hit(point) {
            return Some(Target::Node(slot));
        }
        let reach = EDGE_REACH * pixel;
        let tolerance = Stroke::at(level, pixel).tolerance;
        self.edge_grid
            .candidates(&Rect::at(point).grown(reach), &mut self.scratch);
        let mut candidates = std::mem::take(&mut self.scratch);
        candidates.sort_unstable_by(|a, b| b.cmp(a));
        let found = candidates.iter().copied().find(|&slot| {
            let i = slot as usize;
            self.bounds[i].grown(reach).contains(point)
                && near_path(&self.paths[i], tolerance, point, reach, &mut self.points)
        });
        self.scratch = candidates;
        found.map(Target::Edge)
    }

    /// The label whose measured pill holds `point`, of the edge in the highest slot (ADR-0025).
    fn label_at(&mut self, point: Point) -> Option<u32> {
        if self.widest_pill <= 0.0 {
            return None;
        }
        self.edge_grid
            .candidates(&Rect::at(point).grown(self.widest_pill), &mut self.scratch);
        self.scratch
            .iter()
            .copied()
            .filter(|&slot| {
                let i = slot as usize;
                match (self.labels[i], self.pills[i]) {
                    (Some(at), Some((half_width, half_height))) => {
                        (point.x - at.x).abs() <= half_width
                            && (point.y - at.y).abs() <= half_height
                    }
                    _ => false,
                }
            })
            .max()
    }

    /// Records the half width and half height of the pill of the label of the edge in `slot`, in
    /// world units, as the shell draws it; sizes that are not finite and positive leave it
    /// unmeasured. A slot that holds no edge refuses it.
    pub fn set_label_size(
        &mut self,
        slot: u32,
        half_width: f64,
        half_height: f64,
    ) -> Result<(), SlotError> {
        if !self.holds_edge(slot) {
            return Err(SlotError::NoEdge { slot });
        }
        let measured = [half_width, half_height]
            .iter()
            .all(|size| size.is_finite() && *size > 0.0);
        self.pills[slot as usize] = measured.then_some((half_width, half_height));
        if measured {
            self.widest_pill = self.widest_pill.max(half_width).max(half_height);
        }
        Ok(())
    }

    /// The point of the label of the edge in `slot`, where it holds an edge with a label.
    pub fn label_point(&self, slot: u32) -> Option<Point> {
        self.labels
            .get(slot as usize)
            .copied()
            .flatten()
            .filter(|_| self.holds_edge(slot))
    }

    /// Places the label of the edge in `slot` at `point`: at the path parameter nearest it and its
    /// distance along the normal there, which it returns, and moves it in the index (G-6). A slot
    /// that holds no edge with a label refuses it.
    pub fn move_label(&mut self, slot: u32, point: Point) -> Result<LabelPlacement, SlotError> {
        if self.label_point(slot).is_none() {
            return Err(SlotError::NoEdge { slot });
        }
        let (t, offset) = self.paths[slot as usize].placement_at(point);
        let placement = LabelPlacement { t, offset };
        self.edges[slot as usize].label = Some(placement);
        self.place_edge(slot);
        if stale(self.edge_grid.beyond_extent(), self.edges_in_use() as usize) {
            self.index();
        }
        Ok(placement)
    }

    /// The connector within `reach` of `point`: of the nodes with one there, the one drawn on top,
    /// and of its connectors the nearest (ADR-0025).
    fn connector_at(&mut self, point: Point, reach: f64) -> Option<(u32, Side)> {
        self.node_grid
            .candidates(&Rect::at(point).grown(reach), &mut self.scratch);
        let mut best: Option<(u32, Side, f64)> = None;
        for &slot in &self.scratch {
            let bounds = self.node_bounds(slot);
            if !bounds.grown(reach).contains(point) {
                continue;
            }
            let near = SIDES
                .iter()
                .map(|&side| {
                    let c = side.connector(&bounds);
                    (side, (c.x - point.x).hypot(c.y - point.y))
                })
                .filter(|&(_, d)| d <= reach)
                .min_by(|a, b| a.1.total_cmp(&b.1));
            if let Some((side, d)) = near {
                let above = best.is_none_or(|(other, _, _)| {
                    self.ranks[slot as usize] > self.ranks[other as usize]
                });
                if above {
                    best = Some((slot, side, d));
                }
            }
        }
        best.map(|(slot, side, _)| (slot, side))
    }

    /// The node at `point`: of the nodes whose bounds hold it, the one drawn on top, which is the
    /// one of the highest rank (ADR-0022).
    fn hit(&mut self, point: Point) -> Option<u32> {
        self.node_grid
            .candidates(&Rect::at(point), &mut self.scratch);
        self.scratch
            .iter()
            .copied()
            .filter(|&slot| self.node_bounds(slot).contains(point))
            .max_by_key(|&slot| self.ranks[slot as usize])
    }

    /// Moves the nodes in `slots` by `(dx, dy)` and their edges with them. A refused move changes
    /// nothing. Once more than an eighth of the nodes or edges, and at least 16, reach beyond the
    /// extent the index was built for, the index is built again over the current extent.
    pub fn translate(&mut self, slots: &[u32], dx: f32, dy: f32) -> Result<(), PositionError> {
        // A free slot is refused as a slot beyond the graph (ADR-0022).
        if let Some(&slot) = slots.iter().find(|&&s| !self.holds_node(s)) {
            return Err(PositionError::SlotOutOfRange { slot });
        }
        positions::translate(&mut self.positions, slots, dx, dy)?;
        let mut edges = std::mem::take(&mut self.scratch);
        edges.clear();
        for &slot in slots {
            let bounds = self.node_bounds(slot);
            self.node_grid.set(slot, &bounds);
            edges.extend_from_slice(&self.incident[slot as usize]);
        }
        edges.sort_unstable();
        edges.dedup();
        for &edge in &edges {
            self.place_edge(edge);
        }
        self.scratch = edges;
        if stale(self.node_grid.beyond_extent(), self.nodes_in_use() as usize)
            || stale(self.edge_grid.beyond_extent(), self.edges_in_use() as usize)
        {
            self.index();
        }
        Ok(())
    }

    /// Writes into `out` the nodes and edges whose bounds meet `rect` and the mesh of the edges,
    /// stroked for `level` where a screen pixel is `pixel` world units, within the mesh budget
    /// (ADR-0027); at the near level also the labels whose point lies within `label_reach` of it,
    /// and at the others no label.
    pub fn query(
        &mut self,
        rect: &Rect,
        level: Level,
        pixel: f64,
        label_reach: f64,
        out: &mut Visible,
    ) {
        self.query_within(rect, level, pixel, label_reach, MESH_BUDGET, out);
    }

    /// `query` with a mesh of at most `budget` vertices.
    fn query_within(
        &mut self,
        rect: &Rect,
        level: Level,
        pixel: f64,
        label_reach: f64,
        budget: u32,
        out: &mut Visible,
    ) {
        let labelled = level == Level::Near;
        let label_rect = rect.grown(if labelled { label_reach.max(0.0) } else { 0.0 });
        self.node_grid.candidates(rect, &mut self.scratch);
        out.nodes.clear();
        out.nodes.extend(
            self.scratch
                .iter()
                .filter(|&&slot| self.node_bounds(slot).meets(rect)),
        );
        out.nodes
            .sort_unstable_by_key(|&slot| self.ranks[slot as usize]);
        self.edge_grid
            .candidates(&rect.union(&label_rect), &mut self.scratch);
        self.scratch.sort_unstable();
        out.edges.clear();
        out.labels.clear();
        out.label_points.clear();
        out.origin = origin_of(rect);
        for &slot in &self.scratch {
            if self.bounds[slot as usize].meets(rect) {
                out.edges.push(slot);
            }
            if !labelled {
                continue;
            }
            if let Some(point) = self.labels[slot as usize].filter(|p| label_rect.contains(*p)) {
                out.labels.push(slot);
                let Point { x, y } = out.origin;
                #[expect(
                    clippy::cast_possible_truncation,
                    reason = "a label point within `label_rect`, less the query's origin and only \
                              then rounded, rounds by its distance from the rectangle (ADR-0010); \
                              a rectangle reaching past f32::MAX from its origin, which the \
                              bridge does not refuse, can turn it infinite"
                )]
                out.label_points
                    .extend([(point.x - x) as f32, (point.y - y) as f32]);
            }
        }
        let found = out.edges.iter().map(|&slot| {
            let slot = slot as usize;
            (&self.paths[slot], &self.edges[slot].style)
        });
        let stroke = Stroke::at(level, pixel);
        out.mesh
            .build(found, &stroke, rect, out.origin, budget, &mut self.points);
    }
}

#[cfg(test)]
mod budget;

#[cfg(test)]
mod tests {
    use super::*;

    /// Sides of an edge, mostly the default, now and then any of the sixteen pairs.
    pub(super) fn random_sides(rng: &mut Lcg) -> Sides {
        use crate::geometry::Side;
        if rng.next() < 0.5 {
            return Sides::default();
        }
        let sides = [Side::Top, Side::Right, Side::Bottom, Side::Left];
        Sides {
            source: sides[rng.below(4) as usize],
            target: sides[rng.below(4) as usize],
        }
    }

    /// A small deterministic generator, so that a failure repeats.
    pub(super) struct Lcg(pub(super) u64);

    impl Lcg {
        pub(super) fn next(&mut self) -> f64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }

        pub(super) fn range(&mut self, from: f64, to: f64) -> f64 {
            from + (to - from) * self.next()
        }

        pub(super) fn below(&mut self, n: usize) -> u32 {
            ((self.next() * n as f64) as u32).min(n as u32 - 1)
        }
    }

    fn random_graph(rng: &mut Lcg, nodes: usize, edges: usize) -> Graph {
        let mut positions = Vec::new();
        let mut sizes = Vec::new();
        for _ in 0..nodes {
            positions.extend([
                rng.range(-2000.0, 2000.0) as f32,
                rng.range(-2000.0, 2000.0) as f32,
            ]);
            sizes.extend([rng.range(0.0, 300.0) as f32, rng.range(0.0, 120.0) as f32]);
        }
        let specs = (0..edges)
            .map(|_| EdgeSpec {
                sides: random_sides(rng),
                source: rng.below(nodes),
                target: rng.below(nodes),
                label: (rng.next() < 0.5).then(|| LabelPlacement {
                    t: rng.range(-0.2, 1.2),
                    offset: rng.range(-40.0, 40.0),
                }),
                style: EdgeStyle {
                    arrow: rng.next() < 0.5,
                    ..EdgeStyle::unstyled()
                },
            })
            .collect();
        Graph::new(positions, sizes, specs).unwrap()
    }

    /// What a query must find, by testing every node and edge.
    fn brute_force(graph: &Graph, rect: &Rect, reach: f64) -> (Vec<u32>, Vec<u32>, Vec<u32>) {
        let label_rect = rect.grown(reach);
        let nodes = (0..graph.node_slots)
            .filter(|&s| graph.holds_node(s) && graph.node_bounds(s).meets(rect))
            .collect();
        let edges = (0..graph.edge_slots)
            .filter(|&e| graph.holds_edge(e))
            .filter(|&e| {
                let spec = graph.edges[e as usize];
                EdgePath::between(
                    &graph.node_bounds(spec.source),
                    &graph.node_bounds(spec.target),
                    spec.sides,
                )
                .bounds()
                .meets(rect)
            })
            .collect();
        let labels = (0..graph.edge_slots)
            .filter(|&e| graph.holds_edge(e))
            .filter(|&e| {
                let spec = graph.edges[e as usize];
                spec.label.is_some_and(|label| {
                    let path = EdgePath::between(
                        &graph.node_bounds(spec.source),
                        &graph.node_bounds(spec.target),
                        spec.sides,
                    );
                    label_rect.contains(path.label_position(label.t, label.offset))
                })
            })
            .collect();
        (nodes, edges, labels)
    }

    fn random_rect(rng: &mut Lcg) -> Rect {
        let (x, y) = (rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0));
        Rect::new(x, y, x + rng.range(0.0, 1500.0), y + rng.range(0.0, 1000.0))
    }

    fn assert_queries_match(graph: &mut Graph, rng: &mut Lcg) {
        let mut out = Visible::default();
        for _ in 0..50 {
            let rect = random_rect(rng);
            let reach = rng.range(0.0, 100.0);
            graph.query(&rect, Level::Near, 4.0, reach, &mut out);
            let (nodes, edges, labels) = brute_force(graph, &rect, reach);
            assert_eq!(out.nodes, nodes, "nodes in {rect:?}");
            assert_eq!(out.edges, edges, "edges in {rect:?}");
            assert_eq!(out.labels, labels, "labels in {rect:?}");
            assert_eq!(out.label_points.len(), out.labels.len() * 2);
        }
    }

    #[test]
    fn a_query_finds_exactly_what_a_scan_finds_before_and_after_moves() {
        for seed in 1..=20 {
            let mut rng = Lcg(seed);
            let mut graph = random_graph(&mut rng, 300, 300);
            assert_queries_match(&mut graph, &mut rng);
            for _ in 0..40 {
                let moved: Vec<u32> = (0..3).map(|_| rng.below(300)).collect();
                let (dx, dy) = (rng.range(-3000.0, 3000.0), rng.range(-3000.0, 3000.0));
                graph.translate(&moved, dx as f32, dy as f32).unwrap();
            }
            assert_queries_match(&mut graph, &mut rng);
        }
    }

    #[test]
    fn the_bounds_kept_per_edge_are_those_of_its_path_after_moves() {
        let mut rng = Lcg(11);
        let mut graph = random_graph(&mut rng, 200, 300);
        for _ in 0..60 {
            let moved: Vec<u32> = (0..3).map(|_| rng.below(200)).collect();
            let (dx, dy) = (rng.range(-500.0, 500.0), rng.range(-500.0, 500.0));
            graph.translate(&moved, dx as f32, dy as f32).unwrap();
        }
        for e in 0..graph.edge_slots {
            let spec = graph.edges[e as usize];
            let fresh = EdgePath::between(
                &graph.node_bounds(spec.source),
                &graph.node_bounds(spec.target),
                spec.sides,
            )
            .bounds();
            assert_eq!(graph.bounds[e as usize], fresh, "edge {e}");
        }
    }

    #[test]
    fn a_count_beyond_u32_is_refused_and_one_within_kept() {
        assert_eq!(slot(u32::MAX as usize), Ok(u32::MAX));
        assert_eq!(slot(u32::MAX as usize + 1), Err(GraphError::TooManySlots));
    }

    #[test]
    fn a_query_returns_slots_and_label_points_and_its_edges_have_ends() {
        let positions = vec![0.0, 0.0, 300.0, 100.0];
        let sizes = vec![220.0, 64.0, 220.0, 64.0];
        let label = LabelPlacement {
            t: 0.5,
            offset: 0.0,
        };
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
            source: 0,
            target: 1,
            label: Some(label),
            style: EdgeStyle::unstyled(),
        }];
        let mut graph = Graph::new(positions, sizes, edges).unwrap();
        let mut out = Visible::default();
        graph.query(
            &Rect::new(0.0, 0.0, 600.0, 200.0),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes, [0, 1]);
        assert_eq!(out.edges, [0]);
        let mut ends = Vec::new();
        graph.edge_ends(&out.edges, &mut ends);
        assert_eq!(ends, [220.0, 32.0, 300.0, 132.0]);
        // The edge leaves (220, 32) and enters (300, 132), its control points pulled 40 to the
        // side, at (260, 32) and (260, 132); the curve's middle is the chord's, (260, 82).
        let [x, y] = out.label_points[..] else {
            panic!("one label point, not {:?}", out.label_points);
        };
        assert!(
            (x - 260.0).abs() < 1e-4 && (y - 82.0).abs() < 1e-4,
            "({x}, {y})"
        );
    }

    #[test]
    fn a_query_origin_is_its_centre_snapped_to_the_power_of_two_of_its_larger_side() {
        // Verifies: ADR-0010
        // 400 by 100 around (5e7 + 100, 100): a grid of 512, and 97,656 of it the nearest in x.
        let rect = Rect::new(5e7 - 100.0, 50.0, 5e7 + 300.0, 150.0);
        assert_eq!(origin_of(&rect), Point::new(49_999_872.0, 0.0));
        // Taller than wide, and below the world's origin: the grid is the larger side's.
        let rect = Rect::new(-50.0, -3e7 - 600.0, 50.0, -3e7 + 200.0);
        assert_eq!(origin_of(&rect), Point::new(0.0, -30_000_128.0));
    }

    #[test]
    fn a_query_origin_stays_across_a_pan_shorter_than_half_its_grid() {
        // Verifies: ADR-0010
        let around = |x: f64| Rect::new(x - 200.0, -200.0, x + 200.0, 200.0);
        let origin = Point::new(49_999_872.0, 0.0);
        for pan in [-250.0, -100.0, 0.0, 100.0, 250.0] {
            assert_eq!(origin_of(&around(origin.x + pan)), origin, "pan {pan}");
        }
        assert_eq!(
            origin_of(&around(origin.x + 300.0)),
            Point::new(origin.x + 512.0, 0.0)
        );
    }

    #[test]
    fn a_query_origin_holds_in_f32_and_is_the_world_origin_where_nothing_snaps() {
        // Verifies: ADR-0010
        // A grid finer than f32 holds at 1e8: the origin is the nearest f32, within its spacing.
        let origin = origin_of(&Rect::new(1e8 + 0.3, 0.3, 1e8 + 0.301, 0.301));
        assert_eq!(f64::from(origin.x as f32), origin.x);
        assert!((origin.x - 1e8).abs() <= 4.0, "{origin:?}");
        for rect in [
            Rect::new(f64::NEG_INFINITY, 0.0, f64::INFINITY, 1.0),
            Rect::new(5e7, 5e7, 5e7, 5e7),
            Rect::new(f64::NAN, 0.0, 1.0, 1.0),
            // Beyond f32 in x alone.
            Rect::new(1e39, 0.0, 1e39, 10.0),
        ] {
            assert_eq!(origin_of(&rect), Point::default(), "{rect:?}");
        }
    }

    /// The edge from `at` to `at` + (300, 200), labelled at its middle, queried at the near level
    /// at a scale of 4 around it.
    fn far_edge_at(at: Point) -> Visible {
        let label = LabelPlacement {
            t: 0.5,
            offset: 0.0,
        };
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
            source: 0,
            target: 1,
            label: Some(label),
            style: EdgeStyle::unstyled(),
        }];
        let Point { x, y } = at;
        let positions = [x, y, x + 300.0, y + 200.0].map(|v| v as f32).to_vec();
        let mut graph = Graph::new(positions, vec![220.0, 64.0, 220.0, 64.0], edges).unwrap();
        let mut out = Visible::default();
        let rect = Rect::new(x + 60.0, y - 80.0, x + 460.0, y + 320.0);
        graph.query(&rect, Level::Near, 0.25, 0.0, &mut out);
        out
    }

    #[test]
    fn an_edge_far_from_the_world_origin_hands_over_its_mesh_as_precisely_as_near_it() {
        // Verifies: ADR-0010, Q-4
        // At 5e7 an f32 holds every fourth number, at 3e7 every second; near the world's origin,
        // the same edge rounds by under 2^-23 of 512, which stands for the engine's f64 stroke.
        let at = Point::new(5e7, -3e7);
        let (far, near) = (far_edge_at(at), far_edge_at(Point::default()));
        assert_eq!(far.origin, Point::new(50_000_384.0, -30_000_128.0));
        let world = |out: &Visible, values: &[f32], shift: Point| -> Vec<f64> {
            let origin = [out.origin.x - shift.x, out.origin.y - shift.y];
            let at = values.iter().enumerate();
            at.map(|(i, &v)| f64::from(v) + origin[i % 2]).collect()
        };
        let worst = |a: Vec<f64>, b: Vec<f64>| {
            assert_eq!(a.len(), b.len());
            a.iter()
                .zip(&b)
                .map(|(a, b)| (a - b).abs())
                .fold(0.0, f64::max)
        };
        assert!(far.mesh.positions.len() > 12);
        let none = Point::default();
        let mesh = worst(
            world(&far, &far.mesh.positions, at),
            world(&near, &near.mesh.positions, none),
        );
        // A quarter pixel at a scale of 4.
        assert!(mesh <= 1.0 / 16.0, "the mesh strays {mesh} world units");
        assert_eq!(far.label_points.len(), 2);
        let labels = worst(
            world(&far, &far.label_points, at),
            world(&near, &near.label_points, none),
        );
        assert!(
            labels <= 1.0 / 16.0,
            "the label strays {labels} world units"
        );
    }

    #[test]
    fn the_ends_of_unknown_slots_keep_their_place() {
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
            source: 0,
            target: 1,
            label: None,
            style: EdgeStyle::unstyled(),
        }];
        let graph = Graph::new(
            vec![0.0, 0.0, 300.0, 100.0],
            vec![220.0, 64.0, 220.0, 64.0],
            edges,
        )
        .unwrap();
        let mut ends = Vec::new();
        graph.edge_ends(&[7, 0], &mut ends);
        assert!(ends[..4].iter().all(|v| v.is_nan()));
        assert_eq!(&ends[4..], [220.0, 32.0, 300.0, 132.0]);
    }

    #[test]
    fn below_the_near_level_a_query_places_no_label_and_strokes_plain_far() {
        let label = LabelPlacement {
            t: 0.5,
            offset: 0.0,
        };
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
            source: 0,
            target: 1,
            label: Some(label),
            style: EdgeStyle {
                dash: Some((6.0, 4.0)),
                ..EdgeStyle::unstyled()
            },
        }];
        let mut graph = Graph::new(
            vec![0.0, 0.0, 300.0, 100.0],
            vec![220.0, 64.0, 220.0, 64.0],
            edges,
        )
        .unwrap();
        let rect = Rect::new(0.0, 0.0, 600.0, 200.0);
        let mut out = Visible::default();
        graph.query(&rect, Level::Near, 1.0, 50.0, &mut out);
        assert_eq!(out.labels, [0]);
        // Near: the arrowhead adds one triangle to the two per segment.
        assert_eq!(out.mesh.indices.len() % 6, 3);
        for level in [Level::Middle, Level::Far] {
            graph.query(&rect, level, 1.0, 50.0, &mut out);
            assert!(
                out.labels.is_empty() && out.label_points.is_empty(),
                "{level:?}"
            );
            assert_eq!(out.edges, [0]);
        }
        // Far: the dashed edge with an arrowhead draws neither, two triangles per segment alone.
        assert!(out.mesh.dashes.iter().all(|&d| d == 0.0));
        assert_eq!(out.mesh.indices.len() % 6, 0);
    }

    #[test]
    fn a_moved_node_takes_its_edges_along() {
        let mut graph = Graph::new(
            vec![0.0, 0.0, 300.0, 0.0, 600.0, 0.0],
            vec![100.0, 50.0, 100.0, 50.0, 100.0, 50.0],
            vec![
                EdgeSpec {
                    sides: Sides::default(),
                    source: 0,
                    target: 1,
                    label: None,
                    style: EdgeStyle::unstyled(),
                },
                EdgeSpec {
                    sides: Sides::default(),
                    source: 1,
                    target: 2,
                    label: None,
                    style: EdgeStyle::unstyled(),
                },
            ],
        )
        .unwrap();
        graph.translate(&[1], 0.0, 5000.0).unwrap();
        let mut ends = Vec::new();
        graph.edge_ends(&[0, 1], &mut ends);
        assert_eq!(&ends[2..6], [300.0, 5025.0, 400.0, 5025.0]);
        let mut out = Visible::default();
        graph.query(
            &Rect::new(250.0, 4900.0, 450.0, 5100.0),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes, [1]);
        assert_eq!(out.edges, [0, 1]);
    }

    #[test]
    fn a_hit_finds_the_topmost_node_a_scan_finds_before_and_after_moves() {
        let mut rng = Lcg(7);
        let mut graph = random_graph(&mut rng, 300, 0);
        let scan = |graph: &Graph, p: Point| {
            (0..graph.node_slots)
                .filter(|&s| graph.node_bounds(s).contains(p))
                .max()
        };
        for round in 0..2 {
            for _ in 0..500 {
                let p = Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0));
                assert_eq!(graph.hit(p), scan(&graph, p), "{p:?} in round {round}");
            }
            for _ in 0..40 {
                let moved = [rng.below(300)];
                let (dx, dy) = (rng.range(-3000.0, 3000.0), rng.range(-3000.0, 3000.0));
                graph.translate(&moved, dx as f32, dy as f32).unwrap();
            }
        }
        // Every hit lies inside a node, so random points find some.
        let found = (0..500)
            .filter(|_| {
                let p = Point::new(rng.range(-2000.0, 2000.0), rng.range(-2000.0, 2000.0));
                graph.hit(p).is_some()
            })
            .count();
        assert!(found > 0);
    }

    /// A graph of `count` nodes of side 5 in a row, 10 apart, without edges.
    fn row(count: usize) -> Graph {
        let positions = (0..count).flat_map(|i| [i as f32 * 10.0, 0.0]).collect();
        Graph::new(positions, vec![5.0; count * 2], Vec::new()).unwrap()
    }

    #[test]
    fn nodes_dragged_far_beyond_the_extent_rebuild_the_index() {
        // 200 nodes: the index is rebuilt once more than 200 / 8 = 25 lie beyond its extent.
        let mut graph = row(200);
        let far: Vec<u32> = (0..25).collect();
        graph.translate(&far, 1e6, 1e6).unwrap();
        assert_eq!(
            graph.node_grid.beyond_extent(),
            25,
            "not rebuilt at 25 of 200"
        );
        graph.translate(&[25], 1e6, 1e6).unwrap();
        assert_eq!(graph.node_grid.beyond_extent(), 0, "rebuilt at 26 of 200");
        let mut out = Visible::default();
        graph.query(
            &Rect::new(1e6, 1e6, 1e6 + 300.0, 1e6 + 10.0),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes, (0..26).collect::<Vec<u32>>());
    }

    #[test]
    fn in_a_small_graph_the_index_is_rebuilt_once_more_than_16_nodes_leave_it() {
        // 40 nodes: an eighth is 5, below the floor of 16.
        let mut graph = row(40);
        let far: Vec<u32> = (0..16).collect();
        graph.translate(&far, 1e6, 1e6).unwrap();
        assert_eq!(
            graph.node_grid.beyond_extent(),
            16,
            "not rebuilt at 16 of 40"
        );
        graph.translate(&[16], 1e6, 1e6).unwrap();
        assert_eq!(graph.node_grid.beyond_extent(), 0, "rebuilt at 17 of 40");
    }

    #[test]
    fn a_label_follows_when_a_node_moves() {
        let label = LabelPlacement {
            t: 0.5,
            offset: 0.0,
        };
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
            source: 0,
            target: 1,
            label: Some(label),
            style: EdgeStyle::unstyled(),
        }];
        let sizes = vec![220.0, 64.0, 220.0, 64.0];
        let mut graph = Graph::new(vec![0.0, 0.0, 300.0, 100.0], sizes, edges).unwrap();
        let rect = Rect::new(-1000.0, -1000.0, 2000.0, 2000.0);
        let mut out = Visible::default();
        let mut label_at = |graph: &mut Graph| {
            graph.query(&rect, Level::Near, 4.0, 0.0, &mut out);
            let [x, y] = out.label_points[..] else {
                panic!("one label point, not {:?}", out.label_points);
            };
            (f64::from(x), f64::from(y))
        };
        // The pull of the two control points is equal and opposite, so the middle of the curve,
        // (source + 3 control_source + 3 control_target + target) / 8, is the chord's.
        let middle = |source: (f64, f64), target: (f64, f64)| {
            ((source.0 + target.0) / 2.0, (source.1 + target.1) / 2.0)
        };
        let close = |(x, y): (f64, f64), (ex, ey): (f64, f64)| {
            assert!((x - ex).abs() < 1e-3 && (y - ey).abs() < 1e-3, "({x}, {y})");
        };
        close(label_at(&mut graph), middle((220.0, 32.0), (300.0, 132.0)));
        // The target moves down 200: the edge enters it at (300, 332).
        graph.translate(&[1], 0.0, 200.0).unwrap();
        close(label_at(&mut graph), middle((220.0, 32.0), (300.0, 332.0)));
        // The source moves left 100: the edge leaves it at (120, 32).
        graph.translate(&[0], -100.0, 0.0).unwrap();
        close(label_at(&mut graph), middle((120.0, 32.0), (300.0, 332.0)));
        // The target moves left 400, past the source: the edge enters it at (-100, 332) and runs
        // backwards, its control points pulled half the distance, 110, still equal and opposite.
        graph.translate(&[1], -400.0, 0.0).unwrap();
        close(label_at(&mut graph), middle((120.0, 32.0), (-100.0, 332.0)));
    }

    #[test]
    fn an_edge_to_a_missing_slot_is_refused() {
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
            source: 0,
            target: 1,
            label: None,
            style: EdgeStyle::unstyled(),
        }];
        let result = Graph::new(vec![0.0, 0.0], vec![1.0, 1.0], edges);
        assert_eq!(
            result.unwrap_err(),
            GraphError::EdgeEndOutOfRange { edge: 0 }
        );
    }

    #[test]
    fn a_refused_move_changes_nothing() {
        let mut graph = Graph::new(vec![0.0, 0.0], vec![1.0, 1.0], Vec::new()).unwrap();
        assert!(graph.translate(&[1], 1.0, 1.0).is_err());
        assert_eq!(graph.positions(), [0.0, 0.0]);
    }

    /// The node slots in the order a test added them, the first loaded first: the order they are
    /// drawn in, bottom to top, kept apart from the engine's ranks.
    struct Drawn(Vec<u32>);

    impl Drawn {
        /// The slots whose node meets `rect`, bottom to top.
        fn meeting(&self, graph: &Graph, rect: &Rect) -> Vec<u32> {
            let meets = |&&s: &&u32| graph.node_bounds(s).meets(rect);
            self.0.iter().filter(meets).copied().collect()
        }

        /// The slot of the node on top at `p`.
        fn top_at(&self, graph: &Graph, p: Point) -> Option<u32> {
            let holds = |&&s: &&u32| graph.node_bounds(s).contains(p);
            self.0.iter().rev().find(holds).copied()
        }
    }

    /// Asserts that queries and hits find what a scan of the nodes in `drawn` finds, in its order.
    fn assert_matches_scan(graph: &mut Graph, drawn: &Drawn, rng: &mut Lcg) {
        let mut out = Visible::default();
        for _ in 0..20 {
            let rect = random_rect(rng);
            graph.query(&rect, Level::Near, 4.0, 0.0, &mut out);
            assert_eq!(out.nodes, drawn.meeting(graph, &rect), "nodes in {rect:?}");
            let p = Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0));
            assert_eq!(graph.hit(p), drawn.top_at(graph, p), "hit at {p:?}");
        }
    }

    /// A random node: its position and size.
    fn random_node(rng: &mut Lcg) -> [f32; 4] {
        [
            rng.range(-2000.0, 2000.0) as f32,
            rng.range(-2000.0, 2000.0) as f32,
            rng.range(0.0, 300.0) as f32,
            rng.range(0.0, 120.0) as f32,
        ]
    }

    #[test]
    fn queries_and_hits_find_what_a_scan_finds_after_each_addition_and_move() {
        // Verifies: ADR-0022
        for seed in 1..=10 {
            let mut rng = Lcg(seed);
            // Now and then from an empty graph, which the first addition indexes.
            let loaded = if seed % 3 == 0 { 0 } else { 60 };
            let mut graph = random_graph(&mut rng, loaded, loaded);
            let mut drawn = Drawn((0..graph.node_slots).collect());
            for _ in 0..80 {
                if rng.next() < 0.6 || drawn.0.is_empty() {
                    let [x, y, width, height] = random_node(&mut rng);
                    let slot = graph.add_node(x, y, width, height).unwrap();
                    assert!(!drawn.0.contains(&slot), "slot {slot} taken twice");
                    drawn.0.push(slot);
                } else {
                    let moved = [drawn.0[rng.below(drawn.0.len()) as usize]];
                    let (dx, dy) = (rng.range(-3000.0, 3000.0), rng.range(-3000.0, 3000.0));
                    graph.translate(&moved, dx as f32, dy as f32).unwrap();
                }
                assert_matches_scan(&mut graph, &drawn, &mut rng);
            }
        }
    }

    /// Asserts that the edges and labels a query finds are those a scan of the edges in use finds,
    /// and that the list of edges at each node in use holds exactly the edges in use at it.
    fn assert_edges_match_scan(graph: &mut Graph, rng: &mut Lcg) {
        let mut out = Visible::default();
        for _ in 0..20 {
            let rect = random_rect(rng);
            let reach = rng.range(0.0, 100.0);
            graph.query(&rect, Level::Near, 4.0, reach, &mut out);
            let (_, edges, labels) = brute_force(graph, &rect, reach);
            assert_eq!(out.edges, edges, "edges in {rect:?}");
            assert_eq!(out.labels, labels, "labels in {rect:?}");
        }
        for node in (0..graph.node_slots).filter(|&n| graph.holds_node(n)) {
            let mut listed = graph.incident[node as usize].clone();
            listed.sort_unstable();
            let at: Vec<u32> = (0..graph.edge_slots)
                .filter(|&e| graph.holds_edge(e) && graph.ends(e).any(|end| end == node))
                .collect();
            assert_eq!(listed, at, "edges at node {node}");
        }
    }

    /// A random edge between two nodes in `drawn`, now and then from a node to itself, now and
    /// then with a label.
    fn random_edge(rng: &mut Lcg, drawn: &Drawn) -> EdgeSpec {
        let pick = |rng: &mut Lcg| drawn.0[rng.below(drawn.0.len()) as usize];
        let source = pick(rng);
        EdgeSpec {
            sides: random_sides(rng),
            source,
            target: if rng.next() < 0.1 { source } else { pick(rng) },
            label: (rng.next() < 0.5).then(|| LabelPlacement {
                t: rng.range(-0.2, 1.2),
                offset: rng.range(-40.0, 40.0),
            }),
            style: EdgeStyle {
                arrow: rng.next() < 0.5,
                ..EdgeStyle::unstyled()
            },
        }
    }

    #[test]
    fn queries_hits_and_lists_find_what_a_scan_finds_after_additions_removals_and_moves() {
        // Verifies: ADR-0022
        for seed in 1..=12 {
            let mut rng = Lcg(seed);
            let mut graph = random_graph(&mut rng, 60, 80);
            let mut drawn = Drawn((0..graph.node_slots).collect());
            for _ in 0..120 {
                let step = rng.next();
                if step < 0.3 || drawn.0.is_empty() {
                    let [x, y, width, height] = random_node(&mut rng);
                    let slot = graph.add_node(x, y, width, height).unwrap();
                    assert!(!drawn.0.contains(&slot), "slot {slot} taken twice");
                    drawn.0.push(slot);
                } else if step < 0.55 {
                    let moved = [drawn.0[rng.below(drawn.0.len()) as usize]];
                    let (dx, dy) = (rng.range(-3000.0, 3000.0), rng.range(-3000.0, 3000.0));
                    graph.translate(&moved, dx as f32, dy as f32).unwrap();
                } else if step < 0.8 {
                    // One or two nodes, now and then the same twice.
                    let pick = |rng: &mut Lcg| drawn.0[rng.below(drawn.0.len()) as usize];
                    let removed = [pick(&mut rng), pick(&mut rng)];
                    let count = 1 + rng.below(2) as usize;
                    let before: Vec<u32> = (0..graph.edge_slots)
                        .filter(|&e| graph.holds_edge(e))
                        .collect();
                    let named = graph.edges_at(&removed[..count]).unwrap();
                    let edges = graph.remove_nodes(&removed[..count]).unwrap();
                    assert_eq!(named, edges, "edges named before the removal");
                    let gone: Vec<u32> = before
                        .into_iter()
                        .filter(|&e| graph.ends(e).any(|end| removed[..count].contains(&end)))
                        .collect();
                    assert_eq!(edges, gone, "edges removed with {removed:?}");
                    drawn.0.retain(|s| !removed[..count].contains(s));
                } else if step < 0.88 {
                    let used: Vec<u32> = (0..graph.edge_slots)
                        .filter(|&e| graph.holds_edge(e))
                        .collect();
                    if let Some(&edge) = used.get(rng.below(used.len().max(1)) as usize) {
                        if rng.next() < 0.5 {
                            graph.remove_edges(&[edge]).unwrap();
                        } else {
                            let spec = random_edge(&mut rng, &drawn);
                            graph
                                .update_edge(edge, spec.label, spec.style, spec.sides)
                                .unwrap();
                        }
                    }
                } else {
                    let spec = random_edge(&mut rng, &drawn);
                    let free = graph.free_edges.last().copied();
                    let slot = graph.add_edge(spec).unwrap();
                    assert_eq!(free.unwrap_or(graph.edge_slots - 1), slot);
                    assert_eq!(graph.edge(slot), Some(spec));
                }
                assert_matches_scan(&mut graph, &drawn, &mut rng);
                assert_edges_match_scan(&mut graph, &mut rng);
            }
        }
    }

    #[test]
    fn a_slot_that_holds_nothing_refuses_a_removal_and_a_move_which_change_nothing() {
        // Verifies: ADR-0022
        let mut rng = Lcg(3);
        let mut graph = random_graph(&mut rng, 4, 3);
        let removed = graph.remove_nodes(&[3]).unwrap();
        graph.remove_edges(&[2]).ok();
        let positions = graph.positions().to_vec();
        let (free_nodes, free_edges) = (graph.free_nodes.clone(), graph.free_edges.clone());
        assert_eq!(
            graph.remove_nodes(&[0, 3]),
            Err(SlotError::NoNode { slot: 3 })
        );
        assert_eq!(graph.remove_nodes(&[9]), Err(SlotError::NoNode { slot: 9 }));
        let free_edge = *graph.free_edges.first().unwrap_or(&3);
        assert_eq!(
            graph.remove_edges(&[free_edge]),
            Err(SlotError::NoEdge { slot: free_edge })
        );
        assert_eq!(
            graph.translate(&[0, 3], 1.0, 1.0),
            Err(PositionError::SlotOutOfRange { slot: 3 })
        );
        assert_eq!(graph.positions(), positions);
        assert_eq!(
            (graph.free_nodes.clone(), graph.free_edges.clone()),
            (free_nodes, free_edges)
        );
        // A free edge slot's ends are NaN, as a slot beyond the graph's.
        let mut ends = Vec::new();
        graph.edge_ends(&[free_edge], &mut ends);
        assert!(ends.iter().all(|v| v.is_nan()));
        assert!(removed.iter().all(|&e| !graph.holds_edge(e)));
    }

    #[test]
    fn a_node_and_an_edge_removed_and_a_node_added_within_the_extent_of_50_000_build_nothing() {
        // Verifies: ADR-0022
        let mut graph = plane(50_000);
        let edges = (0..1_000)
            .map(|i| EdgeSpec {
                sides: Sides::default(),
                source: i,
                target: i + 1,
                label: None,
                style: EdgeStyle::unstyled(),
            })
            .collect();
        let positions = graph.positions.clone();
        let sizes = graph.sizes.clone();
        graph = Graph::new(positions, sizes, edges).unwrap();
        assert_eq!(graph.builds, 1);
        // Node 500 lies at (0, 200), between edges 499 and 500.
        assert_eq!(graph.remove_nodes(&[500]), Ok(vec![499, 500]));
        graph.remove_edges(&[5]).unwrap();
        assert_eq!(graph.add_node(20.0, 220.0, 50.0, 50.0), Ok(500));
        assert_eq!(graph.builds, 1);
        assert_eq!(graph.hit(Point::new(35.0, 235.0)), Some(500));
    }

    /// 2,000 nodes in a plane and `edges` edges, edge `i` from node `2i` to node `2i + 1`.
    fn paired(edges: u32) -> Graph {
        let plane = plane(2_000);
        let specs = (0..edges)
            .map(|i| EdgeSpec {
                sides: Sides::default(),
                source: 2 * i,
                target: 2 * i + 1,
                label: None,
                style: EdgeStyle::unstyled(),
            })
            .collect();
        Graph::new(plane.positions, plane.sizes, specs).unwrap()
    }

    #[test]
    fn a_node_of_200_000_edges_is_removed_and_its_edges_leave_every_list_in_linear_time() {
        // Verifies: ADR-0022
        // A hub in slot 0 with an edge to and from each of 100,000 others.
        let count = 100_001u32;
        let positions = (0..count).flat_map(|i| [i as f32, 0.0]).collect();
        let edges = (1..count)
            .flat_map(|i| [(0, i), (i, 0)])
            .map(|(source, target)| EdgeSpec {
                sides: Sides::default(),
                source,
                target,
                label: None,
                style: EdgeStyle::unstyled(),
            })
            .collect();
        let mut graph = Graph::new(positions, vec![1.0; count as usize * 2], edges).unwrap();
        let start = std::time::Instant::now();
        assert_eq!(graph.remove_nodes(&[0]).unwrap().len(), 200_000);
        let hub = start.elapsed();
        let mut graph2 = paired(1_000);
        let all: Vec<u32> = (0..1_000).collect();
        graph2.remove_edges(&all).unwrap();
        assert!(graph.incident.iter().all(Vec::is_empty));
        assert!(graph2.incident.iter().all(Vec::is_empty));
        // Quadratic, the removal would compare some 10^10 pairs; linear, it takes well under this.
        assert!(hub.as_secs_f64() < 5.0, "the hub took {hub:?}");
    }

    #[test]
    fn an_edge_to_a_slot_that_holds_no_node_or_a_change_of_a_free_edge_is_refused() {
        // Verifies: ADR-0022
        let mut graph = paired(4);
        graph.remove_nodes(&[7]).unwrap();
        let spec = |source, target| EdgeSpec {
            sides: Sides::default(),
            source,
            target,
            label: None,
            style: EdgeStyle::unstyled(),
        };
        let edges = graph.edge_slots;
        assert_eq!(
            graph.add_edge(spec(0, 7)),
            Err(SlotError::NoNode { slot: 7 })
        );
        assert_eq!(
            graph.add_edge(spec(5_000, 0)),
            Err(SlotError::NoNode { slot: 5_000 })
        );
        assert_eq!(graph.edge_slots, edges);
        assert_eq!(
            graph.update_edge(3, None, EdgeStyle::unstyled(), Sides::default()),
            Err(SlotError::NoEdge { slot: 3 })
        );
        assert_eq!(graph.edge(3), None);
        // The freed edge slot is the next addition's.
        assert_eq!(graph.add_edge(spec(0, 2)), Ok(3));
        assert_eq!(graph.add_edge(spec(2, 0)), Ok(4));
    }

    #[test]
    fn edges_added_within_the_extent_go_into_the_index_in_place_until_they_double() {
        // Verifies: ADR-0022
        let mut graph = paired(100);
        let builds = graph.builds;
        for i in 0..100 {
            graph
                .add_edge(EdgeSpec {
                    sides: Sides::default(),
                    source: 2 * i + 1,
                    target: 2 * i + 2,
                    label: None,
                    style: EdgeStyle::unstyled(),
                })
                .unwrap();
        }
        assert_eq!(graph.builds, builds);
        graph
            .add_edge(EdgeSpec {
                sides: Sides::default(),
                source: 0,
                target: 3,
                label: None,
                style: EdgeStyle::unstyled(),
            })
            .unwrap();
        assert_eq!(graph.builds, builds + 1);
    }

    /// Bounds on how far `p` lies from the curve of `path`, below and above, apart from the
    /// flattening: the curve lies in the hull of its control points, so the distance to the hull
    /// bounds a part's distance below, and the distance to a part's ends bounds it above; parts are
    /// split until the bounds meet within a thousandth, a part whose lower bound exceeds the best
    /// upper one dropped.
    fn distance_to_curve(path: &EdgePath, p: Point) -> (f64, f64) {
        let to = |q: Point| (q.x - p.x).hypot(q.y - p.y);
        let below = |part: &EdgePath| {
            let hull = part.hull();
            let dx = (hull.min_x - p.x).max(p.x - hull.max_x).max(0.0);
            let dy = (hull.min_y - p.y).max(p.y - hull.max_y).max(0.0);
            dx.hypot(dy)
        };
        let mut upper = to(path.source).min(to(path.target));
        let mut lower = f64::INFINITY;
        let mut parts = vec![(*path, 0)];
        while let Some((part, depth)) = parts.pop() {
            let floor = below(&part);
            if floor > upper {
                continue;
            }
            upper = upper.min(to(part.source)).min(to(part.target));
            if depth >= 48 || upper - floor <= 1e-3 {
                lower = lower.min(floor);
                continue;
            }
            let (left, right) = part.split();
            parts.push((left, depth + 1));
            parts.push((right, depth + 1));
        }
        (lower.min(upper), upper)
    }

    #[test]
    fn a_hit_finds_a_node_before_an_edge_and_an_edge_only_near_its_flattened_path() {
        // Verifies: ADR-0025
        for seed in 1..=4 {
            let mut rng = Lcg(seed);
            let mut graph = random_graph(&mut rng, 30, 40);
            // A free slot now and then too, which no hit may return; a press near its old path
            // finds what lies there besides.
            graph.remove_edges(&[3, 17, 29]).unwrap();
            for _ in 0..300 {
                let level = [Level::Near, Level::Middle, Level::Far][rng.below(3) as usize];
                let pixel = [0.25, 1.0, 4.0, 20.0][rng.below(4) as usize];
                // Near a point of a random edge, now and then anywhere.
                let p = if rng.next() < 0.8 {
                    let edge = rng.below(graph.edge_slots as usize) as usize;
                    let on = graph.paths[edge].point_at(rng.next());
                    let off = 8.0 * pixel;
                    Point::new(on.x + rng.range(-off, off), on.y + rng.range(-off, off))
                } else {
                    Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0))
                };
                let node = graph.hit(p);
                let hit = graph.hit_at(p, pixel, level, false);
                if let Some(slot) = node {
                    assert_eq!(hit, Some(Target::Node(slot)), "a node before any edge");
                    continue;
                }
                // Within the reach less the flattening's tolerance an edge is surely hit, beyond it
                // plus the tolerance surely not; between, either is right.
                let (reach, tolerance) = (EDGE_REACH * pixel, Stroke::at(level, pixel).tolerance);
                let d: Vec<(f64, f64)> = (0..graph.edge_slots)
                    .map(|e| distance_to_curve(&graph.paths[e as usize], p))
                    .collect();
                // Surely hit by its upper bound, surely too far by its lower one.
                let sure = (0..graph.edge_slots)
                    .rev()
                    .filter(|&e| graph.holds_edge(e))
                    .find(|&e| d[e as usize].1 < reach - tolerance);
                match hit {
                    Some(Target::Edge(e)) => {
                        assert!(graph.holds_edge(e), "free edge {e}");
                        assert!(d[e as usize].0 <= reach + tolerance, "edge {e} too far");
                        assert!(sure.is_none_or(|s| e >= s), "edge {e} below {sure:?}");
                    }
                    None => assert_eq!(sure, None, "missed at {p:?}"),
                    Some(Target::Node(_) | Target::Connector(..) | Target::Label(_)) => {
                        panic!("{hit:?} where a scan finds none")
                    }
                }
            }
        }
    }

    #[test]
    fn a_hit_finds_a_connector_before_a_node_as_a_scan_finds_and_none_at_the_far_level() {
        // Verifies: ADR-0025, ADR-0024
        for seed in 1..=6 {
            let mut rng = Lcg(seed);
            let mut graph = random_graph(&mut rng, 40, 20);
            graph.remove_nodes(&[5]).unwrap();
            for _ in 0..400 {
                let level = [Level::Near, Level::Middle, Level::Far][rng.below(3) as usize];
                let pixel = [0.25, 1.0, 4.0][rng.below(3) as usize];
                let reach = CONNECTOR_REACH * pixel;
                // Near a connector of a random node, now and then anywhere.
                let p = if rng.next() < 0.8 {
                    let node = rng.below(graph.node_slots as usize);
                    let side = SIDES[rng.below(4) as usize];
                    let c = side.connector(&graph.node_bounds(node));
                    let off = 1.5 * reach;
                    Point::new(c.x + rng.range(-off, off), c.y + rng.range(-off, off))
                } else {
                    Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0))
                };
                // The scan: of the nodes in use with a connector within the reach, the one of the
                // highest rank, and its nearest connector.
                let scan = (0..graph.node_slots)
                    .filter(|&n| graph.holds_node(n))
                    .filter_map(|n| {
                        let bounds = graph.node_bounds(n);
                        SIDES
                            .iter()
                            .map(|&side| {
                                let c = side.connector(&bounds);
                                (n, side, (c.x - p.x).hypot(c.y - p.y))
                            })
                            .filter(|&(_, _, d)| d <= reach)
                            .min_by(|a, b| a.2.total_cmp(&b.2))
                    })
                    .max_by_key(|&(n, _, _)| graph.ranks[n as usize]);
                let without = graph.hit_at(p, pixel, level, false);
                let with = graph.hit_at(p, pixel, level, true);
                match scan {
                    Some((n, side, _)) if level != Level::Far => {
                        assert_eq!(with, Some(Target::Connector(n, side)), "at {p:?}");
                    }
                    _ => assert_eq!(with, without, "no connector at {p:?}, {level:?}"),
                }
                assert!(!matches!(without, Some(Target::Connector(..))));
            }
        }
    }

    #[test]
    fn a_label_placed_at_a_point_its_nearest_path_point_holds_lies_there_far_from_the_origin_too() {
        // Verifies: G-6
        for seed in 1..=6 {
            let mut rng = Lcg(seed);
            // Paths of random sides, backwards ones among them, near the origin and far from it.
            let far = if seed % 2 == 0 { 0.0 } else { 3e6 };
            let mut graph = random_graph(&mut rng, 30, 60);
            graph
                .translate(&(0..30).collect::<Vec<_>>(), far as f32, -far as f32)
                .unwrap();
            for edge in 0..graph.edge_slots {
                let path = graph.paths[edge as usize];
                for _ in 0..4 {
                    let at = path.label_position(rng.range(0.0, 1.0), rng.range(-60.0, 60.0));
                    // The nearest path point by a dense scan apart from the placement: a point
                    // whose nearest is an end lies beyond the path, and is no case.
                    let reference = (0..=20_000)
                        .map(|i| f64::from(i) / 20_000.0)
                        .min_by(|a, b| {
                            let d = |t: f64| {
                                let q = path.point_at(t);
                                (q.x - at.x).hypot(q.y - at.y)
                            };
                            d(*a).total_cmp(&d(*b))
                        })
                        .unwrap();
                    if !(0.01..=0.99).contains(&reference) {
                        continue;
                    }
                    let (t, offset) = path.placement_at(at);
                    let placed = path.label_position(t, offset);
                    let miss = (placed.x - at.x).hypot(placed.y - at.y);
                    assert!(miss < 0.01, "missed by {miss} on edge {edge}, {path:?}");
                }
            }
        }
    }

    #[test]
    fn a_hit_at_the_near_level_finds_a_measured_label_inside_its_pill_before_a_node() {
        // Verifies: ADR-0025
        let mut rng = Lcg(9);
        let mut graph = random_graph(&mut rng, 30, 60);
        let measured: Vec<u32> = (0..graph.edge_slots).filter(|e| e % 3 != 0).collect();
        for &edge in &measured {
            graph
                .set_label_size(edge, 20.0 + f64::from(edge % 5) * 10.0, 11.0)
                .unwrap();
        }
        for _ in 0..2_000 {
            let p = Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0));
            let p = if rng.next() < 0.7 {
                let edge = rng.below(graph.edge_slots as usize);
                match graph.label_point(edge) {
                    Some(at) => {
                        Point::new(at.x + rng.range(-70.0, 70.0), at.y + rng.range(-15.0, 15.0))
                    }
                    None => p,
                }
            } else {
                p
            };
            let scan = measured.iter().copied().rev().find(|&e| {
                let (Some(at), Some((w, h))) = (graph.label_point(e), graph.pills[e as usize])
                else {
                    return false;
                };
                (p.x - at.x).abs() <= w && (p.y - at.y).abs() <= h
            });
            let near = graph.hit_at(p, 1.0, Level::Near, false);
            match scan {
                Some(e) => assert_eq!(near, Some(Target::Label(e)), "at {p:?}"),
                None => assert!(!matches!(near, Some(Target::Label(_))), "at {p:?}"),
            }
            assert!(!matches!(
                graph.hit_at(p, 1.0, Level::Middle, false),
                Some(Target::Label(_))
            ));
        }
        // An edge removed takes its label's measure along; a new edge in its slot is unmeasured.
        let edge = measured[0];
        graph.remove_edges(&[edge]).unwrap();
        assert_eq!(graph.pills[edge as usize], None);
    }

    #[test]
    fn a_label_measured_with_a_size_that_is_not_finite_and_positive_is_not_hit() {
        // Verifies: ADR-0025
        let mut rng = Lcg(11);
        let mut graph = random_graph(&mut rng, 10, 10);
        let edge = (0..graph.edge_slots)
            .find(|&e| graph.label_point(e).is_some())
            .unwrap();
        let at = graph.label_point(edge).unwrap();
        let hit = |graph: &mut Graph| graph.hit_at(at, 1.0, Level::Near, false);
        assert_ne!(hit(&mut graph), Some(Target::Label(edge)), "unmeasured");
        for (w, h) in [
            (0.0, 11.0),
            (-5.0, 11.0),
            (f64::NAN, 11.0),
            (20.0, f64::INFINITY),
        ] {
            graph.set_label_size(edge, w, h).unwrap();
            assert_ne!(hit(&mut graph), Some(Target::Label(edge)), "{w} by {h}");
        }
        graph.set_label_size(edge, 20.0, 11.0).unwrap();
        assert_eq!(hit(&mut graph), Some(Target::Label(edge)));
        graph.remove_edges(&[edge]).unwrap();
        assert_eq!(
            graph.set_label_size(edge, 20.0, 11.0),
            Err(SlotError::NoEdge { slot: edge })
        );
    }

    #[test]
    fn a_moved_label_keeps_its_parameter_and_offset_when_a_node_of_its_edge_moves() {
        // Verifies: G-6
        let mut rng = Lcg(4);
        let mut graph = random_graph(&mut rng, 10, 10);
        let edge = (0..graph.edge_slots)
            .find(|&e| {
                graph.label_point(e).is_some()
                    && graph.edges[e as usize].source != graph.edges[e as usize].target
            })
            .unwrap();
        let at = graph.label_point(edge).unwrap();
        let placement = graph
            .move_label(edge, Point::new(at.x + 15.0, at.y - 25.0))
            .unwrap();
        assert_eq!(graph.edges[edge as usize].label, Some(placement));
        let source = graph.edges[edge as usize].source;
        graph.translate(&[source], 120.0, 40.0).unwrap();
        let moved = graph.label_point(edge).unwrap();
        let expected = graph.paths[edge as usize].label_position(placement.t, placement.offset);
        assert_eq!(moved, expected);
        assert_eq!(
            graph.move_label(5_000, at),
            Err(SlotError::NoEdge { slot: 5_000 })
        );
    }

    #[test]
    fn the_rule_that_rebuilds_the_index_counts_the_edges_in_use() {
        // Verifies: ADR-0022
        // 20 edges dragged beyond the extent: of 400 edges in use, fewer than an eighth.
        let far: Vec<u32> = (0..20).map(|i| 2 * i).collect();
        let mut graph = paired(400);
        graph.translate(&far, 1e6, 0.0).unwrap();
        assert_eq!(graph.builds, 1);
        // Of 1,000 edges, 900 removed: the 20 are more than an eighth of the 100 in use, and 16.
        let mut graph = paired(1_000);
        let removed: Vec<u32> = (100..1_000).collect();
        graph.remove_edges(&removed).unwrap();
        graph.translate(&far, 1e6, 0.0).unwrap();
        assert_eq!(graph.builds, 2);
    }

    #[test]
    fn a_rebuild_after_removals_covers_only_the_slots_in_use() {
        // Verifies: ADR-0022
        // Nine nodes in a row, and one far away, which a rebuild would stretch the extent to.
        let mut positions: Vec<f32> = (0..9).flat_map(|i| [i as f32 * 100.0, 0.0]).collect();
        positions.extend([1e6, 1e6]);
        let mut graph = Graph::new(positions, vec![50.0; 20], Vec::new()).unwrap();
        graph.remove_nodes(&[9]).unwrap();
        graph.index();
        assert_eq!(graph.indexed_nodes, 9);
        assert_eq!(graph.node_grid.beyond_extent(), 0);
        // The extent is the row's: a node at the far one's place lies beyond it.
        let slot = graph.add_node(1e6, 1e6, 50.0, 50.0).unwrap();
        assert_eq!(slot, 9);
        assert_eq!(graph.node_grid.beyond_extent(), 1);
        let mut out = Visible::default();
        graph.query(
            &Rect::new(-1e7, -1e7, 1e7, 1e7),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes.len(), 10);
    }

    #[test]
    fn a_node_added_takes_the_slot_after_the_highest_and_its_place() {
        // Verifies: ADR-0022
        let mut graph = row(3);
        assert_eq!(graph.add_node(500.0, 0.0, 5.0, 5.0), Ok(3));
        assert_eq!(graph.add_node(510.0, 0.0, 5.0, 5.0), Ok(4));
        assert_eq!(&graph.positions()[6..], [500.0, 0.0, 510.0, 0.0]);
        assert_eq!(graph.nodes_in_use(), 5);
        // A node added has no edges: a move of it moves no edge, and of the others none of its.
        graph.translate(&[3, 0], 1.0, 1.0).unwrap();
        assert!(graph.incident.iter().all(Vec::is_empty));
    }

    #[test]
    fn an_addition_takes_the_slot_freed_last_before_a_new_one() {
        // Verifies: ADR-0022
        // The slot named last is freed last, and taken first.
        let mut graph = row(4);
        graph.remove_nodes(&[2, 0]).unwrap();
        assert_eq!(graph.nodes_in_use(), 2);
        assert_eq!(graph.add_node(100.0, 0.0, 5.0, 5.0), Ok(0));
        assert_eq!(graph.add_node(110.0, 0.0, 5.0, 5.0), Ok(2));
        assert_eq!(graph.add_node(120.0, 0.0, 5.0, 5.0), Ok(4));
        assert_eq!(&graph.positions()[..2], [100.0, 0.0]);
        assert_eq!(&graph.sizes[4..6], [5.0, 5.0]);
    }

    #[test]
    fn a_node_added_into_a_lower_slot_is_drawn_and_hit_above_the_nodes_it_overlaps() {
        // Verifies: ADR-0022
        // Nodes 0 to 3 overlap at (0, 0); slot 1 is free, so the addition takes it.
        let positions = vec![0.0; 8];
        let mut graph = Graph::new(positions, vec![50.0; 8], Vec::new()).unwrap();
        graph.remove_nodes(&[1]).unwrap();
        let slot = graph.add_node(10.0, 10.0, 50.0, 50.0).unwrap();
        assert_eq!(slot, 1);
        let mut out = Visible::default();
        let rect = Rect::new(0.0, 0.0, 100.0, 100.0);
        graph.query(&rect, Level::Near, 4.0, 0.0, &mut out);
        assert_eq!(out.nodes, [0, 2, 3, 1]);
        assert_eq!(graph.hit(Point::new(20.0, 20.0)), Some(1));
    }

    #[test]
    fn a_load_ranks_nodes_by_slot() {
        // Verifies: ADR-0022
        let mut graph = Graph::new(vec![0.0; 6], vec![50.0; 6], Vec::new()).unwrap();
        let mut out = Visible::default();
        graph.query(
            &Rect::new(0.0, 0.0, 10.0, 10.0),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes, [0, 1, 2]);
        assert_eq!(graph.hit(Point::new(5.0, 5.0)), Some(2));
        assert_eq!(graph.add_node(0.0, 0.0, 50.0, 50.0), Ok(3));
        assert_eq!(graph.ranks, [0, 1, 2, 3]);
    }

    #[test]
    fn ranks_are_numbered_again_from_0_in_their_order_before_they_pass_u32_max() {
        // Verifies: ADR-0022
        let mut graph = Graph::new(vec![0.0; 8], vec![50.0; 8], Vec::new()).unwrap();
        graph.ranks = vec![u32::MAX - 1, 7, u32::MAX, 3];
        graph.remove_nodes(&[1]).unwrap();
        graph.next_rank = u64::from(u32::MAX) + 1;
        let slot = graph.add_node(0.0, 0.0, 50.0, 50.0).unwrap();
        assert_eq!(slot, 1);
        // In use, by rank: 3, 0, 2; the new node above them.
        assert_eq!(graph.ranks, [1, 3, 2, 0]);
        assert_eq!(graph.next_rank, 4);
        assert_eq!(graph.add_node(0.0, 0.0, 50.0, 50.0), Ok(4));
        assert_eq!(graph.ranks[4], 4);
        assert_eq!(graph.hit(Point::new(5.0, 5.0)), Some(4));
    }

    /// A grid of `count` nodes of side 50, 100 apart, in rows of 250.
    fn plane(count: usize) -> Graph {
        let positions = (0..count)
            .flat_map(|i| [(i % 250) as f32 * 100.0, (i / 250) as f32 * 100.0])
            .collect();
        Graph::new(positions, vec![50.0; count * 2], Vec::new()).unwrap()
    }

    #[test]
    fn a_node_added_within_the_extent_of_50_000_is_found_without_building_the_index() {
        // Verifies: ADR-0022
        let mut graph = plane(50_000);
        assert_eq!(graph.builds, 1);
        let slot = graph.add_node(1_020.0, 1_020.0, 50.0, 50.0).unwrap();
        assert_eq!(graph.builds, 1);
        // It overlaps the node at (1,000, 1,000), slot 10 · 250 + 10, and is drawn above it.
        let mut out = Visible::default();
        let rect = Rect::new(1_030.0, 1_030.0, 1_040.0, 1_040.0);
        graph.query(&rect, Level::Near, 4.0, 0.0, &mut out);
        assert_eq!(out.nodes, [2_510, slot]);
        assert_eq!(graph.hit(Point::new(1_035.0, 1_035.0)), Some(slot));
        graph.query(
            &Rect::new(1_060.0, 1_060.0, 1_065.0, 1_065.0),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes, [slot]);
    }

    #[test]
    fn a_graph_grown_by_additions_inside_its_extent_is_indexed_again_at_each_doubling() {
        // Verifies: ADR-0022
        let mut rng = Lcg(5);
        let mut graph = plane(100);
        let mut built_at = Vec::new();
        for _ in 100..1_000 {
            // Within the extent of the row, (0, 0) to (9,950, 50).
            let (x, y) = (rng.range(0.0, 9_900.0), 0.0);
            let builds = graph.builds;
            graph.add_node(x as f32, y as f32, 50.0, 50.0).unwrap();
            if graph.builds > builds {
                built_at.push(graph.nodes_in_use());
            }
        }
        // Built for 100, again past 200; built for 201, again past 402; then past 806.
        assert_eq!(built_at, [201, 403, 807]);
    }

    #[test]
    fn nodes_added_far_beyond_the_extent_build_the_index_again() {
        // Verifies: ADR-0022
        // 200 nodes: once more than an eighth of the nodes in use lie beyond the extent, it is
        // built again; 28 of 228 are not more than 228 / 8 = 28, and 29 of 229 are.
        let mut graph = row(200);
        for i in 0..28 {
            graph
                .add_node(1e6 + i as f32 * 10.0, 1e6, 5.0, 5.0)
                .unwrap();
        }
        assert_eq!(graph.builds, 1);
        assert_eq!(graph.node_grid.beyond_extent(), 28);
        graph.add_node(1e6 + 280.0, 1e6, 5.0, 5.0).unwrap();
        assert_eq!(graph.builds, 2);
        assert_eq!(graph.node_grid.beyond_extent(), 0);
    }
}
