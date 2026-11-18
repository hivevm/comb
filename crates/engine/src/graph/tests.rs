//! The graphs the tests of the graph's modules build, and the tests that hold the whole graph to
//! a scan: queries, hits, and the lists of edges at each node after random additions, removals,
//! and moves (ARCH-engine-edits-graph-in-place), and the refusals of a load and of a slot that
//! holds nothing.

use super::*;
use crate::geometry::{Dock, Side};

/// Sides of an edge, mostly the default, now and then any pair of the four sides and the
/// outline (API-edges-dock-side-or-outline).
pub(super) fn random_sides(rng: &mut Lcg) -> Sides {
    if rng.next() < 0.5 {
        return Sides::default();
    }
    let docks = [
        Dock::Side(Side::Top),
        Dock::Side(Side::Right),
        Dock::Side(Side::Bottom),
        Dock::Side(Side::Left),
        Dock::Outline,
    ];
    Sides {
        source: docks[rng.below(5) as usize],
        target: docks[rng.below(5) as usize],
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

/// The positions, sizes, and edges of a random graph of `nodes` nodes and `edges` edges, which
/// `random_graph` loads and `Model` judges it by.
pub(super) fn random_inputs(
    rng: &mut Lcg,
    nodes: usize,
    edges: usize,
) -> (Vec<f32>, Vec<f32>, Vec<EdgeSpec>) {
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
    (positions, sizes, specs)
}

/// The path of the edge `spec` between `source` and `target`, the rectangles of its ends, from
/// the geometry alone: a loop's where it leads a node back to itself, else `between`'s
/// (API-edges-dock-side-or-outline).
pub(super) fn path_of(spec: &EdgeSpec, source: &Rect, target: &Rect) -> EdgePath {
    if spec.source == spec.target {
        EdgePath::looped(
            source,
            crate::shape::NodeShape::Rectangle,
            spec.sides.source,
        )
    } else {
        EdgePath::between(source, target, spec.sides)
    }
}

pub(super) fn random_graph(rng: &mut Lcg, nodes: usize, edges: usize) -> Graph {
    let (positions, sizes, specs) = random_inputs(rng, nodes, edges);
    Graph::new(positions, sizes, specs).unwrap()
}

/// What a graph holds, kept apart from it from the inputs a test gave it: the positions, sizes,
/// and edges it was loaded with, the moves and removals made since, and the label sizes measured.
/// It computes node bounds, connectors, paths, and label points from them with the geometry alone,
/// reading nothing of the graph it judges, so that an oracle built on it owes nothing to the code
/// under test (`docs/CONVENTIONS.md`). A load ranks node `i` as `i`, and these graphs add no node,
/// so the node of the higher slot is drawn above.
pub(super) struct Model {
    pub(super) positions: Vec<f32>,
    pub(super) sizes: Vec<f32>,
    pub(super) specs: Vec<EdgeSpec>,
    pub(super) free_nodes: Vec<bool>,
    pub(super) free_edges: Vec<bool>,
    pub(super) pills: Vec<Option<(f64, f64)>>,
    pub(super) shapes: Vec<crate::shape::NodeShape>,
}

impl Model {
    /// A random graph and its model, from the same inputs.
    pub(super) fn random(rng: &mut Lcg, nodes: usize, edges: usize) -> (Self, Graph) {
        let (positions, sizes, specs) = random_inputs(rng, nodes, edges);
        Self::of(positions, sizes, specs)
    }

    /// The graph loaded from `positions`, `sizes`, and `specs`, and its model.
    pub(super) fn of(positions: Vec<f32>, sizes: Vec<f32>, specs: Vec<EdgeSpec>) -> (Self, Graph) {
        let graph = Graph::new(positions.clone(), sizes.clone(), specs.clone()).unwrap();
        let (nodes, edges) = (positions.len() / 2, specs.len());
        let model = Self {
            positions,
            sizes,
            free_nodes: vec![false; nodes],
            free_edges: vec![false; edges],
            pills: vec![None; edges],
            shapes: vec![crate::shape::NodeShape::Rectangle; nodes],
            specs,
        };
        (model, graph)
    }

    /// The node slots that hold a node, ascending.
    pub(super) fn nodes(&self) -> impl Iterator<Item = u32> + '_ {
        (0..self.free_nodes.len() as u32).filter(|&n| !self.free_nodes[n as usize])
    }

    /// The edge slots that hold an edge, ascending.
    pub(super) fn edges(&self) -> impl Iterator<Item = u32> + '_ {
        (0..self.free_edges.len() as u32).filter(|&e| !self.free_edges[e as usize])
    }

    pub(super) fn bounds(&self, node: u32) -> Rect {
        let i = node as usize * 2;
        Rect::of_node(
            f64::from(self.positions[i]),
            f64::from(self.positions[i + 1]),
            f64::from(self.sizes[i]),
            f64::from(self.sizes[i + 1]),
        )
    }

    pub(super) fn path(&self, edge: u32) -> EdgePath {
        let spec = self.specs[edge as usize];
        path_of(&spec, &self.bounds(spec.source), &self.bounds(spec.target))
    }

    /// The connector a press at `p` hits where a connector reaches `reach` world units, written
    /// from REN-node-content-in-rows alone: of the nodes with a connector within its reach, the one
    /// of the highest slot, and its nearest connector there. Within the node's outline a connector
    /// reaches at most a quarter of the node's height for the top and the bottom side, of its width
    /// for the right and the left; beside the outline, within its rectangle too, the whole reach.
    pub(super) fn connector_at(&self, p: Point, reach: f64) -> Option<(u32, Side, f64)> {
        self.nodes()
            .filter_map(|n| {
                let bounds = self.bounds(n);
                let (width, height) = (bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y);
                let inside = bounds.contains(p)
                    && self.shapes[n as usize].contains(
                        width,
                        height,
                        p.x - bounds.min_x,
                        p.y - bounds.min_y,
                    );
                [Side::Top, Side::Right, Side::Bottom, Side::Left]
                    .into_iter()
                    .map(|side| {
                        let c = side.connector(&bounds);
                        let across = match side {
                            Side::Top | Side::Bottom => height,
                            Side::Right | Side::Left => width,
                        };
                        let reach = if inside {
                            reach.min(across / 4.0)
                        } else {
                            reach
                        };
                        (n, side, (c.x - p.x).hypot(c.y - p.y), reach)
                    })
                    .filter(|&(_, _, d, reach)| d <= reach)
                    .map(|(n, side, d, _)| (n, side, d))
                    .min_by(|a, b| a.2.total_cmp(&b.2))
            })
            .max_by_key(|&(n, _, _)| n)
    }

    /// The point of the label of `edge`, where it holds one.
    pub(super) fn label_point(&self, edge: u32) -> Option<Point> {
        let label = self.specs[edge as usize].label?;
        Some(self.path(edge).label_position(label.t, label.offset))
    }

    /// Moves the nodes `slots` as `Graph::translate` does, within the world's limit, which no
    /// test's move comes near.
    pub(super) fn translate(&mut self, slots: &[u32], dx: f32, dy: f32) {
        for &slot in slots {
            let i = slot as usize * 2;
            for (axis, delta) in [(i, dx), (i + 1, dy)] {
                #[expect(
                    clippy::cast_possible_truncation,
                    reason = "the tests move nodes far within f32"
                )]
                let moved = (f64::from(self.positions[axis]) + f64::from(delta)) as f32;
                self.positions[axis] = moved;
            }
        }
    }

    /// Frees the nodes `slots` and every edge at them.
    pub(super) fn remove_nodes(&mut self, slots: &[u32]) {
        for &slot in slots {
            self.free_nodes[slot as usize] = true;
        }
        for (e, spec) in self.specs.iter().enumerate() {
            if slots.contains(&spec.source) || slots.contains(&spec.target) {
                self.free_edges[e] = true;
                self.pills[e] = None;
            }
        }
    }

    /// Frees the edges `slots`, their label sizes with them.
    pub(super) fn remove_edges(&mut self, slots: &[u32]) {
        for &slot in slots {
            self.free_edges[slot as usize] = true;
            self.pills[slot as usize] = None;
        }
    }
}

/// What a query must find, by testing every node and edge.
fn brute_force(graph: &Graph, rect: &Rect, reach: f64) -> (Vec<u32>, Vec<u32>, Vec<u32>) {
    let label_rect = rect.grown(reach);
    let nodes = (0..graph.node_slots.count())
        .filter(|&s| graph.holds_node(s) && graph.node_bounds(s).meets(rect))
        .collect();
    let edges = (0..graph.edge_slots.count())
        .filter(|&e| graph.holds_edge(e))
        .filter(|&e| {
            let spec = graph.edges[e as usize];
            path_of(
                &spec,
                &graph.node_bounds(spec.source),
                &graph.node_bounds(spec.target),
            )
            .bounds()
            .meets(rect)
        })
        .collect();
    let labels = (0..graph.edge_slots.count())
        .filter(|&e| graph.holds_edge(e))
        .filter(|&e| {
            let spec = graph.edges[e as usize];
            spec.label.is_some_and(|label| {
                let path = path_of(
                    &spec,
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

/// A graph of `count` nodes of side 5 in a row, 10 apart, without edges.
pub(super) fn row(count: usize) -> Graph {
    let positions = (0..count).flat_map(|i| [i as f32 * 10.0, 0.0]).collect();
    Graph::new(positions, vec![5.0; count * 2], Vec::new()).unwrap()
}

/// A grid of `count` nodes of side 50, 100 apart, in rows of 250.
pub(super) fn plane(count: usize) -> Graph {
    let positions = (0..count)
        .flat_map(|i| [(i % 250) as f32 * 100.0, (i / 250) as f32 * 100.0])
        .collect();
    Graph::new(positions, vec![50.0; count * 2], Vec::new()).unwrap()
}

/// 2,000 nodes in a plane and `edges` edges, edge `i` from node `2i` to node `2i + 1`.
pub(super) fn paired(edges: u32) -> Graph {
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
fn a_count_beyond_u32_is_refused_and_one_within_kept() {
    assert_eq!(slot(u32::MAX as usize), Ok(u32::MAX));
    assert_eq!(slot(u32::MAX as usize + 1), Err(TooManySlots));
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
        assert_eq!(graph.node_at(p), drawn.top_at(graph, p), "hit at {p:?}");
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
    // Verifies: ARCH-engine-edits-graph-in-place
    for seed in 1..=10 {
        let mut rng = Lcg(seed);
        // Now and then from an empty graph, which the first addition indexes.
        let loaded = if seed % 3 == 0 { 0 } else { 60 };
        let mut graph = random_graph(&mut rng, loaded, loaded);
        let mut drawn = Drawn((0..graph.node_slots.count()).collect());
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
    for node in (0..graph.node_slots.count()).filter(|&n| graph.holds_node(n)) {
        let mut listed = graph.incident[node as usize].clone();
        listed.sort_unstable();
        let at: Vec<u32> = (0..graph.edge_slots.count())
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
    // Verifies: ARCH-engine-edits-graph-in-place, G-4
    for seed in 1..=12 {
        let mut rng = Lcg(seed);
        let mut graph = random_graph(&mut rng, 60, 80);
        let mut drawn = Drawn((0..graph.node_slots.count()).collect());
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
                let before: Vec<u32> = (0..graph.edge_slots.count())
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
                let used: Vec<u32> = (0..graph.edge_slots.count())
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
                let free = graph.edge_slots.free_list().last().copied();
                let slot = graph.add_edge(spec).unwrap();
                assert_eq!(free.unwrap_or(graph.edge_slots.count() - 1), slot);
                assert_eq!(graph.edge(slot), Some(spec));
            }
            assert_matches_scan(&mut graph, &drawn, &mut rng);
            assert_edges_match_scan(&mut graph, &mut rng);
        }
    }
}

#[test]
fn a_slot_that_holds_nothing_refuses_a_removal_and_a_move_which_change_nothing() {
    // Verifies: ARCH-engine-edits-graph-in-place
    let mut rng = Lcg(3);
    let mut graph = random_graph(&mut rng, 4, 3);
    let removed = graph.remove_nodes(&[3]).unwrap();
    graph.remove_edges(&[2]).ok();
    let positions = graph.positions().to_vec();
    let (free_nodes, free_edges) = (
        graph.node_slots.free_list().to_vec(),
        graph.edge_slots.free_list().to_vec(),
    );
    assert_eq!(
        graph.remove_nodes(&[0, 3]),
        Err(SlotError::NoNode { slot: 3 })
    );
    assert_eq!(graph.remove_nodes(&[9]), Err(SlotError::NoNode { slot: 9 }));
    let free_edge = *graph.edge_slots.free_list().first().unwrap_or(&3);
    assert_eq!(
        graph.remove_edges(&[free_edge]),
        Err(SlotError::NoEdge { slot: free_edge })
    );
    assert_eq!(
        graph.translate(&[0, 3], 1.0, 1.0),
        Err(MoveError::Slot(SlotError::NoNode { slot: 3 }))
    );
    assert_eq!(graph.positions(), positions);
    assert_eq!(
        (
            graph.node_slots.free_list().to_vec(),
            graph.edge_slots.free_list().to_vec()
        ),
        (free_nodes, free_edges)
    );
    // A free edge slot's ends are NaN, as a slot beyond the graph's.
    let mut ends = Vec::new();
    graph.edge_ends(&[free_edge], &mut ends);
    assert!(ends.iter().all(|v| v.is_nan()));
    assert!(removed.iter().all(|&e| !graph.holds_edge(e)));
}

/// A random tree of containers over `count` nodes: per node its container, or `CANVAS`, and
/// whether it is a container, each node in a container made before it in a random order of making,
/// so that a container may lie in a slot after what it holds; and the positions, each relative to
/// its container, and the sizes, a container's larger.
fn random_tree(rng: &mut Lcg, count: usize) -> (Nesting, Vec<f32>, Vec<f32>) {
    let mut made: Vec<usize> = (0..count).collect();
    for i in (1..count).rev() {
        made.swap(i, rng.below(i + 1) as usize);
    }
    let mut nesting = Nesting::on_canvas(count);
    let mut positions = vec![0.0; count * 2];
    let mut sizes = vec![0.0; count * 2];
    let mut containers_made = Vec::new();
    for &node in &made {
        let container = rng.next() < 0.35;
        nesting.is_container[node] = container;
        if !containers_made.is_empty() && rng.next() < 0.75 {
            let c = containers_made[rng.below(containers_made.len()) as usize];
            nesting.containers[node] = c as u32;
            positions[node * 2] = rng.range(-150.0, 600.0) as f32;
            positions[node * 2 + 1] = rng.range(-150.0, 400.0) as f32;
        } else {
            positions[node * 2] = rng.range(-2000.0, 2000.0) as f32;
            positions[node * 2 + 1] = rng.range(-2000.0, 2000.0) as f32;
        }
        let scale = if container { 4.0 } else { 1.0 };
        sizes[node * 2] = (rng.range(10.0, 200.0) * scale) as f32;
        sizes[node * 2 + 1] = (rng.range(10.0, 100.0) * scale) as f32;
        if container {
            containers_made.push(node);
        }
    }
    (nesting, positions, sizes)
}

/// The world positions of a nesting by walking up each node's chain to the canvas, from the
/// inputs alone, and the depth of each node.
fn summed(containers: &[u32], relative: &[f32]) -> (Vec<f32>, Vec<u32>) {
    let count = containers.len();
    let mut world = Vec::with_capacity(count * 2);
    let mut depths = Vec::with_capacity(count);
    for node in 0..count {
        let (mut x, mut y, mut depth) = (0.0_f64, 0.0_f64, 0);
        let mut at = node;
        loop {
            x += f64::from(relative[at * 2]);
            y += f64::from(relative[at * 2 + 1]);
            if containers[at] == CANVAS {
                break;
            }
            at = containers[at] as usize;
            depth += 1;
        }
        world.extend([x as f32, y as f32]);
        depths.push(depth);
    }
    (world, depths)
}

/// The containers of a nesting in the order they are drawn, from the inputs alone: each after its
/// own container, containers in one container or on the canvas by slot, which a load ranks by,
/// each followed by what it contains (ARCH-engine-edits-nested-graph).
fn drawn_containers(nesting: &Nesting) -> Vec<u32> {
    fn visit(nesting: &Nesting, parent: u32, out: &mut Vec<u32>) {
        for (slot, (&container, &mark)) in nesting
            .containers
            .iter()
            .zip(&nesting.is_container)
            .enumerate()
        {
            if mark && container == parent {
                out.push(slot as u32);
                visit(nesting, slot as u32, out);
            }
        }
    }
    let mut out = Vec::new();
    visit(nesting, CANVAS, &mut out);
    out
}

#[test]
fn in_random_trees_of_containers_world_positions_are_sums_and_queries_and_hits_match_a_scan() {
    // Verifies: ARCH-engine-edits-nested-graph, REN-virtualized-nested-scene
    // Per clause, the cases it settles: a hit on a node that is no container, a hit on a container
    // where no other node lies, a query that finds containers in an order other than their slots',
    // and a node at a depth of three or more.
    let (mut node_hits, mut container_hits, mut reordered, mut deep) = (0, 0, 0, 0);
    for seed in 1..=40 {
        let mut rng = Lcg(seed);
        let count = 80;
        let (nesting, relative, sizes) = random_tree(&mut rng, count);
        let (world, depths) = summed(&nesting.containers, &relative);
        deep += depths.iter().filter(|&&d| d >= 3).count();
        let world_of_engine: Vec<f32> =
            nesting.world(&relative).iter().map(|&v| v as f32).collect();
        assert_eq!(world_of_engine, world, "seed {seed}");
        let mut graph =
            Graph::nested(world_of_engine, sizes.clone(), Vec::new(), nesting.clone()).unwrap();
        assert_eq!(graph.positions(), world.as_slice());
        let order = drawn_containers(&nesting);
        let bounds = |s: u32| {
            let i = s as usize * 2;
            Rect::of_node(
                f64::from(world[i]),
                f64::from(world[i + 1]),
                f64::from(sizes[i]),
                f64::from(sizes[i + 1]),
            )
        };
        let mut out = Visible::default();
        for _ in 0..40 {
            let rect = random_rect(&mut rng);
            graph.query(&rect, Level::Near, 4.0, 0.0, &mut out);
            let containers: Vec<u32> = order
                .iter()
                .copied()
                .filter(|&s| bounds(s).meets(&rect))
                .collect();
            let nodes: Vec<u32> = (0..count as u32)
                .filter(|&s| !nesting.is_container[s as usize] && bounds(s).meets(&rect))
                .collect();
            assert_eq!(out.containers, containers, "seed {seed}, {rect:?}");
            assert_eq!(out.nodes, nodes, "seed {seed}, {rect:?}");
            if containers.windows(2).any(|w| w[0] > w[1]) {
                reordered += 1;
            }
            // Half the presses inside a random node, the others anywhere.
            let p = if rng.next() < 0.5 {
                let b = bounds(rng.below(count));
                Point::new(rng.range(b.min_x, b.max_x), rng.range(b.min_y, b.max_y))
            } else {
                Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 3000.0))
            };
            let node = (0..count as u32)
                .rev()
                .find(|&s| !nesting.is_container[s as usize] && bounds(s).contains(p));
            let container = order.iter().rev().find(|&&s| bounds(s).contains(p));
            let expected = node.or(container.copied()).map(Target::Node);
            assert_eq!(
                graph.hit_at(p, 1.0, Level::Middle, false),
                expected,
                "seed {seed}, hit at {p:?}"
            );
            match (node, container) {
                (Some(_), _) => node_hits += 1,
                (None, Some(_)) => container_hits += 1,
                _ => {}
            }
        }
    }
    for (clause, cases, floor) in [
        ("node hits", node_hits, 200),
        ("container hits", container_hits, 100),
        ("queries out of slot order", reordered, 50),
        ("nodes three deep", deep, 200),
    ] {
        assert!(cases >= floor, "{clause}: {cases}");
    }
}

/// A container in slot 0 at (100, 200), 600 × 300, holding nodes 1 and 2 at (10, 20) and
/// (300, 20) within it, 100 × 50, and edge 0 from node 1 to node 2.
fn container_of_two() -> Graph {
    let nesting = Nesting {
        containers: vec![CANVAS, 0, 0],
        is_container: vec![true, false, false],
    };
    let relative = [100.0, 200.0, 10.0, 20.0, 300.0, 20.0];
    let world = nesting.world(&relative).iter().map(|&v| v as f32).collect();
    let edge = EdgeSpec {
        sides: Sides::default(),
        source: 1,
        target: 2,
        label: None,
        style: EdgeStyle::unstyled(),
    };
    let sizes = vec![600.0, 300.0, 100.0, 50.0, 100.0, 50.0];
    Graph::nested(world, sizes, vec![edge], nesting).unwrap()
}

#[test]
fn a_loaded_container_is_found_apart_from_the_nodes_it_holds_at_their_world_positions() {
    // Verifies: ARCH-engine-edits-nested-graph
    let mut graph = container_of_two();
    assert_eq!(
        graph.positions(),
        [100.0, 200.0, 110.0, 220.0, 400.0, 220.0]
    );
    assert_eq!(graph.held(0), [1, 2]);
    assert_eq!((graph.container(1), graph.container(0)), (0, CANVAS));
    let mut out = Visible::default();
    graph.query(
        &Rect::new(0.0, 0.0, 1000.0, 1000.0),
        Level::Near,
        1.0,
        0.0,
        &mut out,
    );
    assert_eq!(
        (out.containers, out.nodes, out.edges),
        (vec![0], vec![1, 2], vec![0])
    );
}

#[test]
fn a_container_loaded_after_the_nodes_it_overlaps_is_hit_below_them_and_below_their_edge() {
    // Verifies: ARCH-engine-edits-nested-graph, REN-virtualized-nested-scene
    // Nodes 0 and 1 on the canvas with edge 0 between them, and container 2, in the last slot and
    // so of the highest rank, over both and holding neither.
    let nesting = Nesting {
        containers: vec![CANVAS; 3],
        is_container: vec![false, false, true],
    };
    let positions = vec![110.0, 220.0, 400.0, 220.0, 100.0, 200.0];
    let sizes = vec![100.0, 50.0, 100.0, 50.0, 600.0, 300.0];
    let edge = EdgeSpec {
        sides: Sides::default(),
        source: 0,
        target: 1,
        label: None,
        style: EdgeStyle::unstyled(),
    };
    let mut graph = Graph::nested(positions, sizes, vec![edge], nesting).unwrap();
    let hit = |graph: &mut Graph, x, y| graph.hit_at(Point::new(x, y), 1.0, Level::Near, false);
    assert_eq!(hit(&mut graph, 150.0, 240.0), Some(Target::Node(0)));
    // On the edge from (210, 245) to (400, 245), over the container.
    assert_eq!(hit(&mut graph, 300.0, 245.0), Some(Target::Edge(0)));
    assert_eq!(hit(&mut graph, 300.0, 400.0), Some(Target::Node(2)));
    let mut out = Visible::default();
    graph.query(
        &Rect::new(0.0, 0.0, 1000.0, 1000.0),
        Level::Near,
        1.0,
        0.0,
        &mut out,
    );
    assert_eq!((out.containers, out.nodes), (vec![2], vec![0, 1]));
}

#[test]
fn a_node_reaching_into_the_viewport_is_found_and_its_container_far_outside_is_not() {
    // Verifies: ARCH-engine-edits-nested-graph, REN-virtualized-nested-scene
    // Container 0 at (10000, 10000), 100 × 100; node 1 in it at (-10000, -10000), in the world at
    // the origin, past its container's outline, which does not grow to hold it.
    let nesting = Nesting {
        containers: vec![CANVAS, 0],
        is_container: vec![true, false],
    };
    let relative = [10_000.0, 10_000.0, -10_000.0, -10_000.0];
    let world: Vec<f32> = nesting.world(&relative).iter().map(|&v| v as f32).collect();
    let mut graph = Graph::nested(world, vec![100.0; 4], Vec::new(), nesting).unwrap();
    let mut out = Visible::default();
    graph.query(
        &Rect::new(-50.0, -50.0, 50.0, 50.0),
        Level::Near,
        1.0,
        0.0,
        &mut out,
    );
    assert_eq!((out.containers, out.nodes), (vec![], vec![1]));
    assert_eq!(
        graph.node_bounds(0),
        Rect::of_node(10_000.0, 10_000.0, 100.0, 100.0)
    );
}

#[test]
fn a_nesting_the_check_refuses_refuses_the_graph() {
    // Verifies: ARCH-engine-edits-nested-graph
    let nesting = Nesting {
        containers: vec![CANVAS, 0],
        is_container: vec![false, false],
    };
    let refused = Graph::nested(vec![0.0; 4], vec![1.0; 4], Vec::new(), nesting);
    assert_eq!(
        refused.unwrap_err(),
        GraphError::Nest(NestError::NotAContainer { node: 1 })
    );
    let short = Graph::nested(
        vec![0.0; 4],
        vec![1.0; 4],
        Vec::new(),
        Nesting::on_canvas(1),
    );
    assert_eq!(short.unwrap_err(), GraphError::SlotCountMismatch);
    let mut long = Nesting::on_canvas(2);
    long.is_container.push(true);
    let marks = Graph::nested(vec![0.0; 4], vec![1.0; 4], Vec::new(), long);
    assert_eq!(marks.unwrap_err(), GraphError::SlotCountMismatch);
}

#[test]
fn a_freed_container_s_slot_taken_again_is_no_container_and_holds_nothing() {
    // Verifies: ARCH-engine-edits-nested-graph
    // A free slot holds nothing: the node added into it lies on the canvas, no container.
    let mut graph = container_of_two();
    graph.remove_nodes(&[0]).unwrap();
    assert_eq!(graph.add_node(0.0, 0.0, 10.0, 10.0), Ok(0));
    assert!(!graph.is_container(0) && graph.held(0).is_empty());
    assert_eq!(graph.container(0), CANVAS);
    let mut out = Visible::default();
    graph.query(
        &Rect::new(-5.0, -5.0, 5.0, 5.0),
        Level::Near,
        1.0,
        0.0,
        &mut out,
    );
    assert_eq!((out.containers, out.nodes), (vec![], vec![0]));
}
