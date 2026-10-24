//! The loaded graph as the engine keeps it: node positions and sizes per node slot, edges per edge
//! slot, a rank per node slot that orders drawing and hitting, and a spatial index over both that
//! loads, additions, and moves keep current (ADR-0010, ADR-0022, ADR-0027).
//!
//! A query answers which node slots, edge slots, and edge labels a rectangle meets, and writes
//! those slots, the points of the labels, and the mesh of the edges into buffers the caller reads;
//! the ends of the edges it found are computed only when inspection asks for them.

use crate::geometry::{EdgePath, Point, Rect};
use crate::positions::{self, PositionError};
use crate::spatial::Grid;
use crate::stroke::{EdgeStyle, MESH_BUDGET, Mesh, Stroke};

/// An edge between two node slots, with the path parameter and label offset of its edge label
/// and the style it is drawn with.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EdgeSpec {
    pub source: u32,
    pub target: u32,
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

/// Why a removal was refused: a slot beyond the slots, or free (ADR-0022).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RemovalError {
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
    fn edges_in_use(&self) -> u32 {
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

    /// Removes the nodes in `slots` and every edge at them, and returns the slots of those edges
    /// in ascending order. Their slots go onto the free lists, the one named last freed last, and
    /// they leave the index; nothing else moves (ADR-0022). A slot that holds no node refuses the
    /// call, which then changes nothing.
    pub fn remove_nodes(&mut self, slots: &[u32]) -> Result<Vec<u32>, RemovalError> {
        if let Some(&slot) = slots.iter().find(|&&s| !self.holds_node(s)) {
            return Err(RemovalError::NoNode { slot });
        }
        let mut edges: Vec<u32> = slots
            .iter()
            .flat_map(|&s| self.incident[s as usize].iter().copied())
            .collect();
        edges.sort_unstable();
        edges.dedup();
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

    /// Removes the edges in `slots`. Their slots go onto the free list, the one named last freed
    /// last, and they leave the index and the lists of edges at their ends (ADR-0022). A slot that
    /// holds no edge refuses the call, which then changes nothing.
    pub fn remove_edges(&mut self, slots: &[u32]) -> Result<(), RemovalError> {
        if let Some(&slot) = slots.iter().find(|&&s| !self.holds_edge(s)) {
            return Err(RemovalError::NoEdge { slot });
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

    /// The node at `point`: of the nodes whose bounds hold it, the one drawn on top, which is the
    /// one of the highest rank (ADR-0022).
    pub fn hit(&mut self, point: Point) -> Option<u32> {
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
                    source: 0,
                    target: 1,
                    label: None,
                    style: EdgeStyle::unstyled(),
                },
                EdgeSpec {
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
                    let edges = graph.remove_nodes(&removed[..count]).unwrap();
                    let gone: Vec<u32> = before
                        .into_iter()
                        .filter(|&e| graph.ends(e).any(|end| removed[..count].contains(&end)))
                        .collect();
                    assert_eq!(edges, gone, "edges removed with {removed:?}");
                    drawn.0.retain(|s| !removed[..count].contains(s));
                } else {
                    let used: Vec<u32> = (0..graph.edge_slots)
                        .filter(|&e| graph.holds_edge(e))
                        .collect();
                    if let Some(&edge) = used.get(rng.below(used.len().max(1)) as usize) {
                        graph.remove_edges(&[edge]).unwrap();
                    }
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
            Err(RemovalError::NoNode { slot: 3 })
        );
        assert_eq!(
            graph.remove_nodes(&[9]),
            Err(RemovalError::NoNode { slot: 9 })
        );
        let free_edge = *graph.free_edges.first().unwrap_or(&3);
        assert_eq!(
            graph.remove_edges(&[free_edge]),
            Err(RemovalError::NoEdge { slot: free_edge })
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
