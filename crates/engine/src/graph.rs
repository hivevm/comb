//! The loaded graph as the engine keeps it: node positions and sizes per node slot, edges per edge
//! slot, and a spatial index over both that loads and moves keep current (ADR-0010, ADR-0012).
//!
//! A query answers which node slots, edge slots, and edge labels a rectangle meets, and writes
//! those slots, the points of the labels, and the mesh of the edges into buffers the caller reads;
//! the ends of the edges it found are computed only when inspection asks for them.

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
    /// More nodes or edges than slots numbered in a `u32`.
    TooManySlots,
}

/// The slot of the node or edge at `index`, or the count of `index` of them, refused where it
/// lies beyond `u32`: the one conversion of a count to slots, for the engine and the bridge alike.
pub fn slot(index: usize) -> Result<u32, GraphError> {
    u32::try_from(index).map_err(|_| GraphError::TooManySlots)
}

/// The level of detail a query serves (ADR-0012): near draws edge labels, middle does not, and
/// far draws edges as plain lines one pixel wide.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Near,
    Middle,
    Far,
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
    node_slots: u32,
    edge_slots: u32,
    paths: Vec<EdgePath>,
    /// The bounds of each path, computed when the path is.
    bounds: Vec<Rect>,
    labels: Vec<Option<Point>>,
    /// The edge slots at each node slot: `incident[offsets[n]..offsets[n + 1]]`.
    offsets: Vec<u32>,
    incident: Vec<u32>,
    node_grid: Grid,
    edge_grid: Grid,
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
        let mut offsets = vec![0u32; self.node_slots as usize + 1];
        for slot in 0..self.edge_slots {
            for end in self.ends(slot) {
                offsets[end as usize + 1] += 1;
            }
        }
        for n in 1..offsets.len() {
            offsets[n] += offsets[n - 1];
        }
        let mut next = offsets.clone();
        self.incident = vec![0; offsets[offsets.len() - 1] as usize];
        for edge in 0..self.edge_slots {
            for end in self.ends(edge).collect::<Vec<_>>() {
                self.incident[next[end as usize] as usize] = edge;
                next[end as usize] += 1;
            }
        }
        self.offsets = offsets;
    }

    /// The side of a grid cell: about twice the mean node, and large enough that the grid has
    /// about one cell per node. It affects only how fast a query runs, not which slots it returns:
    /// the grid is exact for any cell side, as the query test against a brute-force scan holds.
    fn cell_side(&self, extent: &Rect) -> f64 {
        let count = f64::from(self.node_slots.max(1));
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
        let nodes: Vec<Rect> = (0..self.node_slots).map(|s| self.node_bounds(s)).collect();
        let extent = nodes
            .iter()
            .copied()
            .reduce(|a, b| a.union(&b))
            .unwrap_or(Rect::new(0.0, 0.0, 1.0, 1.0));
        let cell = self.cell_side(&extent);
        self.node_grid = Grid::new(extent, cell, nodes.len());
        for (slot, bounds) in (0..self.node_slots).zip(&nodes) {
            self.node_grid.set(slot, bounds);
        }
        self.edge_grid = Grid::new(extent, cell, self.edge_slots as usize);
        let placed: Vec<_> = (0..self.edge_slots).map(|e| self.placement(e)).collect();
        self.paths = placed.iter().map(|&(path, _, _)| path).collect();
        self.bounds = placed.iter().map(|&(_, bounds, _)| bounds).collect();
        self.labels = placed.iter().map(|&(_, _, label)| label).collect();
        for slot in 0..self.edge_slots {
            self.reindex_edge(slot);
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
        if stale(self.node_grid.beyond_extent(), self.node_slots as usize)
            || stale(self.edge_grid.beyond_extent(), self.edge_slots as usize)
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
        let stroke = Stroke::at(level, pixel);
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
            if self.bounds[slot as usize].meets(rect) {
                out.edges.push(slot);
                let style = self.edges[slot as usize].style;
                out.mesh.add_edge(
                    &self.paths[slot as usize],
                    &style,
                    &stroke,
                    &mut self.points,
                );
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
            .filter(|&s| graph.node_bounds(s).meets(rect))
            .collect();
        let edges = (0..graph.edge_slots)
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
}
