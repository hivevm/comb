//! The graphs the tests of the graph's modules build, and the tests that hold the whole graph to
//! a scan: queries, hits, and the lists of edges at each node after random additions, removals,
//! and moves (ADR-0022), and the refusals of a load and of a slot that holds nothing.

use super::*;
use crate::geometry::Side;

/// Sides of an edge, mostly the default, now and then any of the sixteen pairs.
pub(super) fn random_sides(rng: &mut Lcg) -> Sides {
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
        EdgePath::between(
            &self.bounds(spec.source),
            &self.bounds(spec.target),
            spec.sides,
        )
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
            EdgePath::between(
                &graph.node_bounds(spec.source),
                &graph.node_bounds(spec.target),
                spec.sides,
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
    // Verifies: ADR-0022
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
    // Verifies: ADR-0022
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
    // Verifies: ADR-0022
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
