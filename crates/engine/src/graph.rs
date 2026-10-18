//! The loaded graph as the engine keeps it: node positions and sizes per node slot, edges per edge
//! slot, and a spatial index over both that loads and moves keep current (ADR-0010, ADR-0012).
//!
//! A query answers which node slots, edge slots, and edge labels a rectangle meets, and writes the
//! control points of the edges it found and the points of the labels into buffers the caller
//! reads.

use crate::geometry::{EdgePath, Point, Rect};
use crate::positions::{self, PositionError};
use crate::spatial::Grid;
use crate::stroke::{EdgeStyle, Mesh, Stroke};

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
}

/// The level of detail a query serves (ADR-0012): near draws edge labels, middle does not, and
/// far draws edges as plain lines one pixel wide.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Near,
    Middle,
    Far,
}

/// How far a drawn edge may stray from its path, in screen pixels: half the 0.5 px of Q-4.
pub const FLATNESS: f64 = 0.25;
/// The width of an edge at the far level, in screen pixels.
pub const FAR_EDGE_WIDTH: f64 = 1.0;

impl Level {
    /// How edges are stroked at this level, where a screen pixel is `pixel` world units.
    pub fn stroke(self, pixel: f64) -> Stroke {
        match self {
            Self::Far => Stroke {
                tolerance: FLATNESS * pixel,
                width: FAR_EDGE_WIDTH * pixel,
                plain: true,
            },
            Self::Near | Self::Middle => Stroke::full(FLATNESS * pixel),
        }
    }
}

/// What a query found: node, edge, and label slots in ascending order, per found label its
/// point, and the mesh of the found edges.
#[derive(Debug, Default)]
pub struct Visible {
    pub nodes: Vec<u32>,
    pub edges: Vec<u32>,
    pub labels: Vec<u32>,
    pub label_points: Vec<f32>,
    pub mesh: Mesh,
}

/// The loaded graph and its spatial index.
#[derive(Debug, Default)]
pub struct Graph {
    positions: Vec<f32>,
    sizes: Vec<f32>,
    edges: Vec<EdgeSpec>,
    paths: Vec<EdgePath>,
    labels: Vec<Option<Point>>,
    /// The edge slots at each node slot: `incident[offsets[n]..offsets[n + 1]]`.
    offsets: Vec<u32>,
    incident: Vec<u32>,
    node_grid: Grid,
    edge_grid: Grid,
    scratch: Vec<u32>,
    points: Vec<Point>,
}

fn slots(len: usize) -> impl Iterator<Item = u32> {
    (0..len).map(|i| u32::try_from(i).unwrap_or(u32::MAX))
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
        let count = positions.len() / 2;
        if let Some(edge) = slots(edges.len()).find(|&e| {
            let spec = edges[e as usize];
            spec.source as usize >= count || spec.target as usize >= count
        }) {
            return Err(GraphError::EdgeEndOutOfRange { edge });
        }
        let mut graph = Self {
            positions,
            sizes,
            edges,
            ..Self::default()
        };
        graph.link();
        graph.index();
        Ok(graph)
    }

    /// The node positions, `x, y` per slot.
    pub fn positions(&self) -> &[f32] {
        &self.positions
    }

    fn node_count(&self) -> usize {
        self.positions.len() / 2
    }

    /// The rectangle of the node in `slot`.
    pub fn node_bounds(&self, slot: u32) -> Rect {
        let i = slot as usize * 2;
        Rect::of_node(
            f64::from(self.positions[i]),
            f64::from(self.positions[i + 1]),
            f64::from(self.sizes[i]),
            f64::from(self.sizes[i + 1]),
        )
    }

    /// The path of the edge in `slot`, as of the last load or move.
    pub fn edge_path(&self, slot: u32) -> EdgePath {
        self.paths[slot as usize]
    }

    /// The point of the label of the edge in `slot`, if it has one.
    pub fn label_point(&self, slot: u32) -> Option<Point> {
        self.labels[slot as usize]
    }

    /// The node slots at the ends of the edge in `slot`, each once.
    fn ends(&self, slot: usize) -> impl Iterator<Item = u32> {
        let edge = self.edges[slot];
        std::iter::once(edge.source).chain((edge.target != edge.source).then_some(edge.target))
    }

    /// Builds the lists of edges at each node.
    fn link(&mut self) {
        let mut offsets = vec![0u32; self.node_count() + 1];
        for slot in 0..self.edges.len() {
            for end in self.ends(slot) {
                offsets[end as usize + 1] += 1;
            }
        }
        for n in 1..offsets.len() {
            offsets[n] += offsets[n - 1];
        }
        let mut next = offsets.clone();
        self.incident = vec![0; offsets[offsets.len() - 1] as usize];
        for (slot, edge) in slots(self.edges.len()).enumerate() {
            for end in self.ends(slot).collect::<Vec<_>>() {
                self.incident[next[end as usize] as usize] = edge;
                next[end as usize] += 1;
            }
        }
        self.offsets = offsets;
    }

    /// The side of a grid cell: about twice the mean node, and large enough that the grid has
    /// about one cell per node.
    fn cell_side(&self, extent: &Rect) -> f64 {
        let count = self.node_count().max(1) as f64;
        let mean = self
            .sizes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|size| f64::from(size[0].max(size[1])))
            .sum::<f64>()
            / count;
        let area = (extent.max_x - extent.min_x) * (extent.max_y - extent.min_y);
        (2.0 * mean).max((area / count).sqrt())
    }

    /// Rebuilds both grids from the current positions.
    fn index(&mut self) {
        let nodes: Vec<Rect> = slots(self.node_count())
            .map(|s| self.node_bounds(s))
            .collect();
        let extent = nodes
            .iter()
            .copied()
            .reduce(|a, b| a.union(&b))
            .unwrap_or(Rect::new(0.0, 0.0, 1.0, 1.0));
        let cell = self.cell_side(&extent);
        self.node_grid = Grid::new(extent, cell, nodes.len());
        for (slot, bounds) in slots(nodes.len()).zip(&nodes) {
            self.node_grid.set(slot, bounds);
        }
        self.edge_grid = Grid::new(extent, cell, self.edges.len());
        let placed: Vec<_> = (0..self.edges.len()).map(|e| self.placement(e)).collect();
        self.paths = placed.iter().map(|&(path, _)| path).collect();
        self.labels = placed.iter().map(|&(_, label)| label).collect();
        for slot in slots(self.edges.len()) {
            self.reindex_edge(slot);
        }
    }

    /// The path and label point of the edge in `slot` from the current positions.
    fn placement(&self, slot: usize) -> (EdgePath, Option<Point>) {
        let spec = self.edges[slot];
        let path = EdgePath::between(
            &self.node_bounds(spec.source),
            &self.node_bounds(spec.target),
        );
        let label = spec
            .label
            .map(|label| path.label_position(label.t, label.offset));
        (path, label)
    }

    /// Puts the edge in `slot` into the edge grid under the bounds of its path and its label point
    /// together.
    fn reindex_edge(&mut self, slot: u32) {
        let path = self.paths[slot as usize].bounds();
        let bounds = self.labels[slot as usize].map_or(path, |p| path.union(&Rect::at(p)));
        self.edge_grid.set(slot, &bounds);
    }

    /// Recomputes the path and label of the edge in `slot` and moves it in the edge grid.
    fn place_edge(&mut self, slot: u32) {
        let (path, label) = self.placement(slot as usize);
        self.paths[slot as usize] = path;
        self.labels[slot as usize] = label;
        self.reindex_edge(slot);
    }

    /// Writes into `out`, after clearing it, the ends of the edges in `slots` as they lie now:
    /// per edge the point it leaves its source and the point it enters its target, `x, y` each,
    /// and NaN for a slot beyond the loaded edges, so that the pairs stay in step with `slots`.
    pub fn edge_ends(&self, slots: &[u32], out: &mut Vec<f32>) {
        out.clear();
        for &slot in slots {
            match self.paths.get(slot as usize) {
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
    /// one in the highest slot.
    pub fn hit(&mut self, point: Point) -> Option<u32> {
        self.node_grid
            .candidates(&Rect::at(point), &mut self.scratch);
        self.scratch
            .iter()
            .copied()
            .filter(|&slot| self.node_bounds(slot).contains(point))
            .max()
    }

    /// Moves the nodes in `slots` by `(dx, dy)` and their edges with them. A refused move changes
    /// nothing. Once more than an eighth of the nodes or edges, and at least 16, reach beyond the
    /// extent the index was built for, the index is built again over the current extent.
    pub fn translate(&mut self, slots: &[u32], dx: f32, dy: f32) -> Result<(), PositionError> {
        positions::translate(&mut self.positions, slots, dx, dy)?;
        let mut edges = std::mem::take(&mut self.scratch);
        edges.clear();
        for &slot in slots {
            let bounds = self.node_bounds(slot);
            self.node_grid.set(slot, &bounds);
            let (from, to) = (
                self.offsets[slot as usize] as usize,
                self.offsets[slot as usize + 1] as usize,
            );
            edges.extend_from_slice(&self.incident[from..to]);
        }
        edges.sort_unstable();
        edges.dedup();
        for &edge in &edges {
            self.place_edge(edge);
        }
        self.scratch = edges;
        let stale = |beyond: usize, items: usize| beyond > (items / 8).max(16);
        if stale(self.node_grid.beyond_extent(), self.node_count())
            || stale(self.edge_grid.beyond_extent(), self.edges.len())
        {
            self.index();
        }
        Ok(())
    }

    /// Writes into `out` the nodes and edges whose bounds meet `rect` and the mesh of the edges,
    /// stroked for `level` where a screen pixel is `pixel` world units; at the near level also the
    /// labels whose point lies within `label_reach` of it, and at the others no label.
    pub fn query(
        &mut self,
        rect: &Rect,
        level: Level,
        pixel: f64,
        label_reach: f64,
        out: &mut Visible,
    ) {
        let stroke = level.stroke(pixel);
        let labelled = level == Level::Near;
        let label_rect = rect.grown(if labelled { label_reach.max(0.0) } else { 0.0 });
        self.node_grid.candidates(rect, &mut self.scratch);
        out.nodes.clear();
        out.nodes.extend(
            self.scratch
                .iter()
                .filter(|&&slot| self.node_bounds(slot).meets(rect)),
        );
        out.nodes.sort_unstable();
        self.edge_grid
            .candidates(&rect.union(&label_rect), &mut self.scratch);
        self.scratch.sort_unstable();
        out.edges.clear();
        out.labels.clear();
        out.label_points.clear();
        out.mesh.clear();
        for &slot in &self.scratch {
            let path = self.paths[slot as usize];
            if path.bounds().meets(rect) {
                out.edges.push(slot);
                let style = self.edges[slot as usize].style;
                out.mesh.add_edge(&path, &style, &stroke, &mut self.points);
            }
            if !labelled {
                continue;
            }
            if let Some(point) = self.labels[slot as usize].filter(|p| label_rect.contains(*p)) {
                out.labels.push(slot);
                out.label_points.extend([point.x as f32, point.y as f32]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A small deterministic generator, so that a failure repeats.
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> f64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }

        fn range(&mut self, from: f64, to: f64) -> f64 {
            from + (to - from) * self.next()
        }

        fn below(&mut self, n: usize) -> u32 {
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
                    ..EdgeStyle::default()
                },
            })
            .collect();
        Graph::new(positions, sizes, specs).unwrap()
    }

    /// What a query must find, by testing every node and edge.
    fn brute_force(graph: &Graph, rect: &Rect, reach: f64) -> (Vec<u32>, Vec<u32>, Vec<u32>) {
        let label_rect = rect.grown(reach);
        let nodes = slots(graph.node_count())
            .filter(|&s| graph.node_bounds(s).meets(rect))
            .collect();
        let edges = slots(graph.edges.len())
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
        let labels = slots(graph.edges.len())
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
    fn a_query_returns_the_control_points_and_label_points_of_what_it_found() {
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
            style: EdgeStyle::default(),
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
        let path = graph.edge_path(0);
        let mut ends = Vec::new();
        graph.edge_ends(&out.edges, &mut ends);
        assert_eq!(ends, [220.0, 32.0, 300.0, 132.0]);
        let at = path.label_position(0.5, 0.0);
        assert_eq!(out.label_points, [at.x as f32, at.y as f32]);
    }

    #[test]
    fn the_stroke_follows_the_level_and_the_size_of_a_screen_pixel() {
        let pixel = 4.0;
        let far = Level::Far.stroke(pixel);
        assert_eq!((far.tolerance, far.width, far.plain), (1.0, 4.0, true));
        for level in [Level::Near, Level::Middle] {
            let full = level.stroke(pixel);
            let expected = (1.0, crate::stroke::STROKE_WIDTH, false);
            assert_eq!((full.tolerance, full.width, full.plain), expected);
        }
    }

    #[test]
    fn the_ends_of_unknown_slots_keep_their_place() {
        let edges = vec![EdgeSpec {
            source: 0,
            target: 1,
            label: None,
            style: EdgeStyle::default(),
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
                ..EdgeStyle::default()
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
                    style: EdgeStyle::default(),
                },
                EdgeSpec {
                    source: 1,
                    target: 2,
                    label: None,
                    style: EdgeStyle::default(),
                },
            ],
        )
        .unwrap();
        graph.translate(&[1], 0.0, 5000.0).unwrap();
        assert_eq!(graph.edge_path(0).target, Point::new(300.0, 5025.0));
        assert_eq!(graph.edge_path(1).source, Point::new(400.0, 5025.0));
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
            slots(graph.node_count())
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

    #[test]
    fn nodes_dragged_far_beyond_the_extent_rebuild_the_index() {
        let count = 200;
        let positions = (0..count).flat_map(|i| [i as f32 * 10.0, 0.0]).collect();
        let mut graph = Graph::new(positions, vec![5.0; count * 2], Vec::new()).unwrap();
        let far: Vec<u32> = (0..30).collect();
        graph.translate(&far, 1e6, 1e6).unwrap();
        assert_eq!(graph.node_grid.beyond_extent(), 0);
        let mut out = Visible::default();
        graph.query(
            &Rect::new(1e6, 1e6, 1e6 + 300.0, 1e6 + 10.0),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes, far);
    }

    #[test]
    fn an_edge_to_a_missing_slot_is_refused() {
        let edges = vec![EdgeSpec {
            source: 0,
            target: 1,
            label: None,
            style: EdgeStyle::default(),
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
}
