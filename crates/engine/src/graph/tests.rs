//! The graphs the tests of the graph's modules build, and the tests that hold the whole graph to
//! a scan: queries, hits, and the lists of edges at each node after random additions, removals,
//! and moves (ARCH-engine-edits-graph-in-place), and the refusals of a load and of a slot that
//! holds nothing.

use super::*;
use crate::geometry::{Dock, Side, WORLD_LIMIT};
use crate::stroke::Arrowhead;

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
            source: End::Node(rng.below(nodes)),
            target: End::Node(rng.below(nodes)),
            labels: random_labels(rng),
            style: random_style(rng),
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
    /// The measured pill of each label of each edge, in the order of its list.
    pub(super) pills: Vec<Vec<Option<(f64, f64)>>>,
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
            pills: specs.iter().map(|s| vec![None; s.labels.len()]).collect(),
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
        let spec = &self.specs[edge as usize];
        path_of(
            spec,
            &self.bounds(spec.nodes().0),
            &self.bounds(spec.nodes().1),
        )
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

    /// The label whose measured pill holds `p`, of the edge in the highest slot and the last of
    /// its labels, by testing every label (REN-node-content-in-rows).
    pub(super) fn label_at(&self, p: Point) -> Option<(u32, u32)> {
        self.edges()
            .flat_map(|e| (0..self.specs[e as usize].labels.len() as u32).map(move |i| (e, i)))
            .filter(|&(e, i)| {
                let (Some(at), Some((w, h))) =
                    (self.label_point(e, i), self.pills[e as usize][i as usize])
                else {
                    return false;
                };
                (p.x - at.x).abs() <= w && (p.y - at.y).abs() <= h
            })
            .max()
    }

    /// The point of the label at `index` of `edge`, where it holds one.
    pub(super) fn label_point(&self, edge: u32, index: u32) -> Option<Point> {
        let label = self.specs[edge as usize].labels.get(index as usize)?;
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
            if slots.contains(&spec.nodes().0) || slots.contains(&spec.nodes().1) {
                self.free_edges[e] = true;
                self.pills[e].fill(None);
            }
        }
    }

    /// Frees the edges `slots`, their label sizes with them.
    pub(super) fn remove_edges(&mut self, slots: &[u32]) {
        for &slot in slots {
            self.free_edges[slot as usize] = true;
            self.pills[slot as usize].fill(None);
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
            let spec = &graph.edges[e as usize];
            let path = path_of(
                spec,
                &graph.node_bounds(spec.nodes().0),
                &graph.node_bounds(spec.nodes().1),
            );
            drawn_bounds(spec, &path).meets(rect)
        })
        .collect();
    let labels = (0..graph.edge_slots.count())
        .filter(|&e| graph.holds_edge(e))
        .flat_map(|e| {
            let spec = &graph.edges[e as usize];
            let path = path_of(
                spec,
                &graph.node_bounds(spec.nodes().0),
                &graph.node_bounds(spec.nodes().1),
            );
            (0_u32..)
                .zip(&spec.labels)
                .filter(move |(_, label)| {
                    label_rect.contains(path.label_position(label.t, label.offset))
                })
                .flat_map(move |(index, _)| [e, index])
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
        assert_eq!(out.label_points.len(), out.labels.len());
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
            source: End::Node(2 * i),
            target: End::Node(2 * i + 1),
            labels: Vec::new(),
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
        source: End::Node(0),
        target: End::Node(1),
        labels: Vec::new(),
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

/// The bounds of `path` as the edge `spec` is drawn: a lightning bolt's turns, which lie 6 off
/// the path at a third and two thirds of the way from 0.45 to 0.55, taken in
/// (API-edges-dock-nodes-or-edges).
pub(super) fn drawn_bounds(spec: &EdgeSpec, path: &EdgePath) -> Rect {
    let mut bounds = path.bounds();
    if spec.style.lightning {
        for (t, offset) in [(0.45 + 0.1 / 3.0, 6.0), (0.55 - 0.1 / 3.0, -6.0)] {
            bounds = bounds.union(&Rect::at(path.label_position(t, offset)));
        }
    }
    bounds
}

/// Random edge labels: none for half the edges, one to three for the others
/// (API-edges-dock-nodes-or-edges, *Edge labels*).
pub(super) fn random_labels(rng: &mut Lcg) -> Vec<LabelPlacement> {
    (0..rng.below(6).saturating_sub(2))
        .map(|_| LabelPlacement {
            t: rng.range(-0.2, 1.2),
            offset: rng.range(-40.0, 40.0),
        })
        .collect()
}

/// A random style: each of the four arrowheads, and a lightning bolt now and then.
pub(super) fn random_style(rng: &mut Lcg) -> EdgeStyle {
    EdgeStyle {
        arrow: [
            Arrowhead::None,
            Arrowhead::End,
            Arrowhead::Open,
            Arrowhead::Hollow,
        ][rng.below(4) as usize],
        lightning: rng.next() < 0.25,
        ..EdgeStyle::unstyled()
    }
}

/// A random edge between two nodes in `drawn`, now and then from a node to itself, now and
/// then with a label.
fn random_edge(rng: &mut Lcg, drawn: &Drawn) -> EdgeSpec {
    let pick = |rng: &mut Lcg| drawn.0[rng.below(drawn.0.len()) as usize];
    let source = pick(rng);
    EdgeSpec {
        sides: random_sides(rng),
        source: End::Node(source),
        target: End::Node(if rng.next() < 0.1 { source } else { pick(rng) }),
        labels: random_labels(rng),
        style: random_style(rng),
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
                let (_, edges) = graph.remove_nodes(&removed[..count]).unwrap();
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
                            .update_edge(edge, spec.labels, spec.style, spec.sides)
                            .unwrap();
                    }
                }
            } else {
                let spec = random_edge(&mut rng, &drawn);
                let free = graph.edge_slots.free_list().last().copied();
                let slot = graph.add_edge(spec.clone()).unwrap();
                assert_eq!(free.unwrap_or(graph.edge_slots.count() - 1), slot);
                assert_eq!(graph.edge(slot), Some(&spec));
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
    let (_, removed) = graph.remove_nodes(&[3]).unwrap();
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

/// A model of a nested graph the property test below edits beside the engine: per node slot, its
/// container, its mark, its world position, its size, and its rank, `None` at a free slot; and
/// the edges in use by their ends.
struct NestedModel {
    nodes: Vec<Option<ModelNode>>,
    edges: Vec<Option<(u32, u32)>>,
    next_rank: u32,
}

#[derive(Clone, Copy)]
struct ModelNode {
    container: u32,
    is_container: bool,
    at: [f32; 2],
    /// Its position relative to its container's, as the two world positions were when it last
    /// moved or joined the container: what a move of the container keeps.
    relative: [f64; 2],
    size: [f32; 2],
    rank: u32,
}

impl NestedModel {
    /// The nodes in use, by slot.
    fn in_use(&self) -> impl Iterator<Item = (u32, ModelNode)> + '_ {
        (0..self.nodes.len() as u32).filter_map(|s| self.nodes[s as usize].map(|n| (s, n)))
    }

    /// `slot` and every node it holds, at every depth, each once.
    fn subtree(&self, slot: u32) -> Vec<u32> {
        let mut found = vec![slot];
        let mut i = 0;
        while i < found.len() {
            let parent = found[i];
            found.extend(
                self.in_use()
                    .filter(|(_, n)| n.container == parent)
                    .map(|(s, _)| s),
            );
            i += 1;
        }
        found
    }

    fn bounds(node: &ModelNode) -> Rect {
        let [x, y] = node.at.map(f64::from);
        let [w, h] = node.size.map(f64::from);
        Rect::of_node(x, y, w, h)
    }

    /// The containers in the order they are drawn: each after its own container, siblings by rank.
    fn drawn_containers(&self) -> Vec<u32> {
        fn visit(model: &NestedModel, parent: u32, out: &mut Vec<u32>) {
            let mut children: Vec<(u32, ModelNode)> = model
                .in_use()
                .filter(|(_, n)| n.is_container && n.container == parent)
                .collect();
            children.sort_by_key(|(_, n)| n.rank);
            for (slot, _) in children {
                out.push(slot);
                visit(model, slot, out);
            }
        }
        let mut out = Vec::new();
        visit(self, CANVAS, &mut out);
        out
    }

    /// What a query of `rect` finds: the containers in their order, the other nodes by rank.
    fn found(&self, rect: &Rect) -> (Vec<u32>, Vec<u32>) {
        let meets = |s: &u32| Self::bounds(&self.nodes[*s as usize].unwrap()).meets(rect);
        let containers = self.drawn_containers().into_iter().filter(meets).collect();
        let mut nodes: Vec<(u32, ModelNode)> = self
            .in_use()
            .filter(|(s, n)| !n.is_container && meets(s))
            .collect();
        nodes.sort_by_key(|(_, n)| n.rank);
        (containers, nodes.into_iter().map(|(s, _)| s).collect())
    }
}

impl NestedModel {
    /// A random tree of `count` nodes with 30 random edges among them, loaded, and its model.
    fn loaded(rng: &mut Lcg, count: usize) -> (Self, Graph) {
        let (nesting, relative, sizes) = random_tree(rng, count);
        let world: Vec<f32> = nesting.world(&relative).iter().map(|&v| v as f32).collect();
        let specs: Vec<EdgeSpec> = (0..30)
            .map(|_| EdgeSpec {
                sides: Sides::default(),
                source: End::Node(rng.below(count)),
                target: End::Node(rng.below(count)),
                labels: Vec::new(),
                style: EdgeStyle::unstyled(),
            })
            .collect();
        let node = |i: usize| ModelNode {
            container: nesting.containers[i],
            is_container: nesting.is_container[i],
            at: [world[i * 2], world[i * 2 + 1]],
            relative: [0.0; 2],
            size: [sizes[i * 2], sizes[i * 2 + 1]],
            rank: i as u32,
        };
        let mut model = Self {
            nodes: (0..count).map(|i| Some(node(i))).collect(),
            edges: specs.iter().map(|e| Some(e.nodes())).collect(),
            next_rank: count as u32,
        };
        for slot in 0..count as u32 {
            model.keep_relative(slot);
        }
        let graph = Graph::nested(world, sizes, specs, nesting).unwrap();
        (model, graph)
    }

    /// Keeps the position of the node in `slot` relative to its container's, from the world
    /// positions both have now, the difference in `f64`; none on the canvas.
    fn keep_relative(&mut self, slot: u32) {
        let node = self.nodes[slot as usize].unwrap();
        let relative = if node.container == CANVAS {
            [0.0; 2]
        } else {
            let origin = self.nodes[node.container as usize].unwrap().at;
            [0, 1].map(|axis| f64::from(node.at[axis]) - f64::from(origin[axis]))
        };
        self.nodes[slot as usize].as_mut().unwrap().relative = relative;
    }

    /// Moves the node in `slot` by a random delta in `graph` and here, with what it holds; whether
    /// it held anything.
    fn moved(&mut self, graph: &mut Graph, slot: u32, rng: &mut Lcg) -> bool {
        let [dx, dy] = [
            rng.range(-300.0, 300.0) as f32,
            rng.range(-300.0, 300.0) as f32,
        ];
        graph.translate(&[slot], dx, dy).unwrap();
        // The node by the delta, and what it holds at the sum of its container's new world
        // position and its own relative to it, parents first.
        let moved = self.subtree(slot);
        let node = self.nodes[slot as usize].as_mut().unwrap();
        node.at = [node.at[0] + dx, node.at[1] + dy];
        self.keep_relative(slot);
        for &s in &moved[1..] {
            let node = self.nodes[s as usize].unwrap();
            let origin = self.nodes[node.container as usize].unwrap().at;
            let at = [0, 1].map(|axis| (f64::from(origin[axis]) + node.relative[axis]) as f32);
            self.nodes[s as usize].as_mut().unwrap().at = at;
        }
        moved.len() > 1
    }

    /// The edges in use at any of `nodes`, in ascending order.
    fn edges_at(&self, nodes: &[u32]) -> Vec<u32> {
        let at = |&(a, b): &(u32, u32)| nodes.contains(&a) || nodes.contains(&b);
        (0..self.edges.len() as u32)
            .filter(|&e| self.edges[e as usize].as_ref().is_some_and(at))
            .collect()
    }

    /// Removes the node in `slot` from `graph` and here, with what it holds and the edges at any of
    /// it, asserting that the engine names exactly those; whether it held anything.
    fn removed(&mut self, graph: &mut Graph, slot: u32) -> bool {
        let gone = self.subtree(slot);
        let edges = self.edges_at(&gone);
        let (nodes, freed) = graph.remove_nodes(&[slot]).unwrap();
        let mut sorted = nodes.clone();
        sorted.sort_unstable();
        let mut expected = gone.clone();
        expected.sort_unstable();
        assert_eq!((nodes[0], sorted), (slot, expected), "nodes removed");
        assert_eq!(freed, edges, "edges removed");
        for &s in &gone {
            self.nodes[s as usize] = None;
        }
        for e in edges {
            self.edges[e as usize] = None;
        }
        gone.len() > 1
    }

    /// Adds a random node to `graph` and here, into a container now and then, a container itself
    /// now and then; whether it went into a container.
    fn added(&mut self, graph: &mut Graph, rng: &mut Lcg) -> bool {
        let containers: Vec<u32> = self
            .in_use()
            .filter(|(_, n)| n.is_container)
            .map(|(s, _)| s)
            .collect();
        let container = if !containers.is_empty() && rng.next() < 0.6 {
            containers[rng.below(containers.len()) as usize]
        } else {
            CANVAS
        };
        let is_container = rng.next() < 0.3;
        let [x, y, w, h] = random_node(rng);
        let size = [w * 2.0, h * 2.0];
        let slot = graph
            .add_node_in(container, is_container, [x, y, size[0], size[1]])
            .unwrap();
        if self.nodes.len() <= slot as usize {
            self.nodes.resize(slot as usize + 1, None);
        }
        self.nodes[slot as usize] = Some(ModelNode {
            container,
            is_container,
            at: [x, y],
            relative: [0.0; 2],
            size,
            rank: self.next_rank,
        });
        self.keep_relative(slot);
        self.next_rank += 1;
        container != CANVAS
    }

    /// Asserts that every node in use lies where the model has it, in its container, with the
    /// edges at it, and that queries and hits find what a scan of the model finds; returns how
    /// many hits found a node.
    fn assert_matches(&self, graph: &mut Graph, rng: &mut Lcg) -> usize {
        let mut hits = 0;
        for (slot, node) in self.in_use() {
            let i = slot as usize * 2;
            let at = [graph.positions()[i], graph.positions()[i + 1]];
            assert_eq!(at, node.at, "node {slot}");
            assert_eq!(graph.container(slot), node.container, "node {slot}");
            assert_eq!(graph.edges_at(&[slot]).unwrap(), self.edges_at(&[slot]));
        }
        let mut out = Visible::default();
        for _ in 0..5 {
            let rect = random_rect(rng);
            graph.query(&rect, Level::Near, 4.0, 0.0, &mut out);
            let (containers, nodes) = self.found(&rect);
            assert_eq!(
                (&out.containers, &out.nodes),
                (&containers, &nodes),
                "{rect:?}"
            );
            assert_eq!(
                out.edges,
                self.edges_meeting(graph, &rect),
                "edges in {rect:?}"
            );
            let p = Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0));
            let top = self.top_at(p);
            assert_eq!(graph.node_at(p), top, "node at {p:?}");
            hits += usize::from(top.is_some());
            // A node that is no container is hit before any edge or container.
            if let Some(slot) = top.filter(|&s| !self.nodes[s as usize].unwrap().is_container) {
                let hit = graph.hit_at(p, 1.0, Level::Middle, false);
                assert_eq!(hit, Some(Target::Node(slot)), "hit at {p:?}");
            }
        }
        hits
    }

    /// The edges in use whose path, between their ends where the model has them, meets `rect`, in
    /// slot order.
    fn edges_meeting(&self, graph: &Graph, rect: &Rect) -> Vec<u32> {
        let bounds = |s: u32| Self::bounds(&self.nodes[s as usize].unwrap());
        (0..self.edges.len() as u32)
            .filter(|&e| self.edges[e as usize].is_some())
            .filter(|&e| {
                let spec = &graph.edges[e as usize];
                let path = path_of(spec, &bounds(spec.nodes().0), &bounds(spec.nodes().1));
                drawn_bounds(spec, &path).meets(rect)
            })
            .collect()
    }

    /// The node drawn on top at `p`: of the nodes that hold it, the one that is no container of the
    /// highest rank, else the last container in their order.
    fn top_at(&self, p: Point) -> Option<u32> {
        let holds = |s: &u32| Self::bounds(&self.nodes[*s as usize].unwrap()).contains(p);
        let node = self
            .in_use()
            .filter(|(s, n)| !n.is_container && holds(s))
            .max_by_key(|(_, n)| n.rank)
            .map(|(s, _)| s);
        node.or_else(|| self.drawn_containers().into_iter().rev().find(holds))
    }
}

#[test]
fn queries_and_lists_match_a_scan_after_containers_are_added_to_removed_and_moved() {
    // Verifies: ARCH-engine-edits-nested-graph, G-14
    // Per clause, the cases it settles: a container removed with what it holds, a container moved
    // with what it holds, a node added into a container, and a hit on a node.
    let mut cases = [0; 4];
    for seed in 1..=30 {
        let mut rng = Lcg(seed);
        let (mut model, mut graph) = NestedModel::loaded(&mut rng, 40);
        for _ in 0..60 {
            let alive: Vec<u32> = model.in_use().map(|(s, _)| s).collect();
            let roll = rng.next();
            let (case, held) = if alive.is_empty() || roll >= 0.6 {
                (2, model.added(&mut graph, &mut rng))
            } else {
                let slot = alive[rng.below(alive.len()) as usize];
                if roll < 0.4 {
                    (1, model.moved(&mut graph, slot, &mut rng))
                } else {
                    (0, model.removed(&mut graph, slot))
                }
            };
            cases[case] += usize::from(held);
            cases[3] += model.assert_matches(&mut graph, &mut rng);
        }
    }
    for (clause, count, floor) in [
        ("containers removed with what they hold", cases[0], 30),
        ("containers moved with what they hold", cases[1], 60),
        ("nodes added into a container", cases[2], 60),
        ("hits on a node", cases[3], 300),
    ] {
        assert!(count >= floor, "{clause}: {count}");
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
        source: End::Node(1),
        target: End::Node(2),
        labels: Vec::new(),
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
        source: End::Node(0),
        target: End::Node(1),
        labels: Vec::new(),
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
    // The removal of the container frees what it holds after it, so slot 0 is taken last.
    let mut graph = container_of_two();
    graph.remove_nodes(&[0]).unwrap();
    assert_eq!(graph.add_node(2000.0, 0.0, 10.0, 10.0), Ok(2));
    assert_eq!(graph.add_node(2000.0, 0.0, 10.0, 10.0), Ok(1));
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

/// `container_of_two` with container 3 inside container 0 at (10, 100) within it, 200 × 100,
/// holding node 4 at (5, 5) within it, 50 × 20; edge 1 from node 4 to node 1, and node 5 on the
/// canvas at (0, 0) with edge 2 from node 5 to node 2.
fn nested_three() -> Graph {
    let mut graph = container_of_two();
    let inner = graph
        .add_node_in(0, true, [110.0, 300.0, 200.0, 100.0])
        .unwrap();
    let held = graph
        .add_node_in(inner, false, [115.0, 305.0, 50.0, 20.0])
        .unwrap();
    let outside = graph.add_node(0.0, 0.0, 50.0, 20.0).unwrap();
    assert_eq!((inner, held, outside), (3, 4, 5));
    let edge = |source, target| EdgeSpec {
        sides: Sides::default(),
        source: End::Node(source),
        target: End::Node(target),
        labels: Vec::new(),
        style: EdgeStyle::unstyled(),
    };
    assert_eq!(graph.add_edge(edge(4, 1)), Ok(1));
    assert_eq!(graph.add_edge(edge(5, 2)), Ok(2));
    graph
}

/// What a query of the whole world finds: containers, other nodes, and edges.
fn found(graph: &mut Graph) -> (Vec<u32>, Vec<u32>, Vec<u32>) {
    let mut out = Visible::default();
    let all = Rect::new(-10_000.0, -10_000.0, 10_000.0, 10_000.0);
    graph.query(&all, Level::Near, 1.0, 0.0, &mut out);
    (out.containers, out.nodes, out.edges)
}

#[test]
fn a_node_added_into_a_container_lies_in_it_and_a_node_that_is_no_container_refuses_it() {
    // Verifies: ARCH-engine-edits-nested-graph
    let mut graph = nested_three();
    assert_eq!((graph.container(3), graph.container(4)), (0, 3));
    assert_eq!(graph.held(0), [1, 2, 3]);
    assert_eq!(graph.held(3), [4]);
    assert!(graph.is_container(3) && !graph.is_container(4));
    // A node that is no container, a free slot, and a slot beyond the graph refuse the node, and
    // the graph stays as it was.
    for slot in [1, 6, 99] {
        assert_eq!(
            graph.add_node_in(slot, false, [0.0, 0.0, 1.0, 1.0]),
            Err(AddNodeError::NoContainer { slot })
        );
    }
    assert_eq!(graph.nodes_in_use(), 6);
    // The container added last comes after its sibling containers' content, the inner one after
    // its own container.
    let sibling = graph
        .add_node_in(CANVAS, true, [-500.0, -500.0, 10.0, 10.0])
        .unwrap();
    assert_eq!(found(&mut graph).0, vec![0, 3, sibling]);
}

#[test]
fn removing_a_container_removes_what_it_holds_at_every_depth_and_every_edge_at_any_of_it() {
    // Verifies: ARCH-engine-edits-nested-graph
    let mut graph = nested_three();
    let named = graph.removal(&[0]).unwrap();
    assert_eq!(named, (vec![0, 1, 2, 3, 4], vec![0, 1, 2]));
    // Removing the inner container alone takes its node and that node's edge, nothing above.
    assert_eq!(graph.removal(&[3]).unwrap(), (vec![3, 4], vec![1]));
    // A node named with its container is named once, where the container lists it.
    assert_eq!(graph.removal(&[4, 3]).unwrap(), (vec![4, 3], vec![1]));
    assert_eq!(graph.remove_nodes(&[0]), Ok(named));
    assert_eq!(found(&mut graph), (vec![], vec![5], vec![]));
    assert_eq!(graph.nodes_in_use(), 1);
    assert!(graph.incident[5].is_empty());
    assert_eq!(graph.removal(&[0]), Err(SlotError::NoNode { slot: 0 }));
}

#[test]
fn a_moved_container_moves_what_it_holds_at_every_depth_and_their_edges_in_the_same_call() {
    // Verifies: ARCH-engine-edits-nested-graph, G-14
    let mut graph = nested_three();
    let before = graph.positions().to_vec();
    let path = |graph: &Graph, edge: usize| graph.paths[edge];
    let paths = [0, 1, 2].map(|e| path(&graph, e));
    graph.translate(&[0], 30.0, -40.0).unwrap();
    for slot in 0..6 {
        let moved = slot != 5;
        let delta = if moved { [30.0, -40.0] } else { [0.0, 0.0] };
        for axis in 0..2 {
            assert_eq!(
                graph.positions()[slot * 2 + axis],
                before[slot * 2 + axis] + delta[axis],
                "node {slot}"
            );
        }
    }
    // The edges between held nodes followed; the edge to the node outside was placed anew.
    assert_ne!(path(&graph, 0), paths[0]);
    assert_ne!(path(&graph, 1), paths[1]);
    assert_ne!(path(&graph, 2), paths[2]);
    // A query finds the held nodes where they are now, and a container and a node it holds named
    // together move once.
    graph.translate(&[3, 4], 1.0, 1.0).unwrap();
    assert_eq!(&graph.positions()[8..10], [146.0, 266.0]);
    let mut out = Visible::default();
    graph.query(
        &Rect::new(145.0, 265.0, 147.0, 267.0),
        Level::Near,
        1.0,
        0.0,
        &mut out,
    );
    assert_eq!((out.containers, out.nodes), (vec![0, 3], vec![4]));
}

impl NestedModel {
    /// Moves the node in `slot` into a random target in `graph` and here: the canvas now and then,
    /// the node or one it holds now and then, else a random node in use, a container or not.
    /// Asserts the engine's answer against the
    /// model's and returns the clause that settled it: 0 moved, 1 a target that is no container, 2
    /// a target that is the node or a node it holds.
    fn moved_into(&mut self, graph: &mut Graph, slot: u32, rng: &mut Lcg) -> usize {
        let alive: Vec<u32> = self.in_use().map(|(s, _)| s).collect();
        let roll = rng.next();
        let own = self.subtree(slot);
        let target = if roll < 0.15 {
            CANVAS
        } else if roll < 0.3 {
            own[rng.below(own.len()) as usize]
        } else {
            alive[rng.below(alive.len()) as usize]
        };
        let answer = graph.move_into(slot, target);
        let is_container = |s: u32| self.nodes[s as usize].unwrap().is_container;
        if target != CANVAS && !is_container(target) {
            assert_eq!(answer, Err(MoveIntoError::NoContainer { slot: target }));
            return 1;
        }
        if self.subtree(slot).contains(&target) {
            assert_eq!(answer, Err(MoveIntoError::InItself { slot: target }));
            return 2;
        }
        assert_eq!(answer, Ok(()), "{slot} into {target}");
        let node = self.nodes[slot as usize].as_mut().unwrap();
        // A move into its own container keeps its rank.
        if node.container == target {
            return 0;
        }
        node.container = target;
        node.rank = self.next_rank;
        self.next_rank += 1;
        self.keep_relative(slot);
        0
    }

    /// The container a drop of the node in `dragged` at `p` lands in: of the containers whose box
    /// holds `p`, neither `dragged` nor a node it holds, the last in their order.
    fn container_at(&self, p: Point, dragged: u32) -> Option<u32> {
        let excluded = self.subtree(dragged);
        self.drawn_containers().into_iter().rev().find(|s| {
            !excluded.contains(s) && Self::bounds(&self.nodes[*s as usize].unwrap()).contains(p)
        })
    }

    /// A point inside a random container in use, or anywhere where there is none.
    fn point_in_a_container(&self, rng: &mut Lcg) -> Point {
        let containers: Vec<u32> = self
            .in_use()
            .filter(|(_, n)| n.is_container)
            .map(|(s, _)| s)
            .collect();
        if containers.is_empty() {
            return Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0));
        }
        let b = Self::bounds(
            &self.nodes[containers[rng.below(containers.len()) as usize] as usize].unwrap(),
        );
        Point::new(rng.range(b.min_x, b.max_x), rng.range(b.min_y, b.max_y))
    }
}

#[test]
fn moves_into_containers_keep_world_positions_and_a_drop_finds_the_container_a_scan_finds() {
    // Verifies: ARCH-engine-edits-nested-graph
    // Per clause, the cases it settles: a move made, a target that is no container refused, a
    // target that is the node or one it holds refused, a drop that lands in a container, and a drop
    // whose topmost container is the dragged node or one it holds, which lands lower or nowhere.
    let mut cases = [0; 5];
    for seed in 1..=30 {
        let mut rng = Lcg(seed);
        let (mut model, mut graph) = NestedModel::loaded(&mut rng, 40);
        for _ in 0..60 {
            let alive: Vec<u32> = model.in_use().map(|(s, _)| s).collect();
            let slot = alive[rng.below(alive.len()) as usize];
            if rng.next() < 0.3 {
                model.moved(&mut graph, slot, &mut rng);
            } else {
                cases[model.moved_into(&mut graph, slot, &mut rng)] += 1;
            }
            model.assert_matches(&mut graph, &mut rng);
            for _ in 0..5 {
                let p = model.point_in_a_container(&mut rng);
                // Half the drops of a container the point lies in, the others of any node.
                let holding: Vec<u32> = alive
                    .iter()
                    .copied()
                    .filter(|&s| model.nodes[s as usize].is_some_and(|n| n.is_container))
                    .filter(|&s| NestedModel::bounds(&model.nodes[s as usize].unwrap()).contains(p))
                    .collect();
                let in_use: Vec<u32> = model.in_use().map(|(s, _)| s).collect();
                let dragged = if !holding.is_empty() && rng.next() < 0.5 {
                    holding[rng.below(holding.len()) as usize]
                } else {
                    in_use[rng.below(in_use.len()) as usize]
                };
                let expected = model.container_at(p, dragged);
                assert_eq!(
                    graph.container_at(p, dragged),
                    Ok(expected),
                    "{p:?}, {dragged}"
                );
                let top =
                    model.drawn_containers().into_iter().rev().find(|s| {
                        NestedModel::bounds(&model.nodes[*s as usize].unwrap()).contains(p)
                    });
                if top != expected {
                    cases[4] += 1;
                } else if expected.is_some() {
                    cases[3] += 1;
                }
            }
        }
    }
    for (clause, count, floor) in [
        ("moves into a container or onto the canvas", cases[0], 300),
        ("targets that are no container", cases[1], 400),
        ("targets the node holds", cases[2], 40),
        ("drops into a container", cases[3], 3000),
        ("drops past the dragged node's own", cases[4], 3000),
    ] {
        assert!(count >= floor, "{clause}: {count}");
    }
}

#[test]
fn a_node_moved_into_a_container_keeps_its_world_position_and_is_drawn_above_the_others() {
    // Verifies: ARCH-engine-edits-nested-graph
    let mut graph = nested_three();
    let before = graph.positions().to_vec();
    // The node outside, 5, into the inner container, 3: its world position stays, it is held
    // last, and drawn above every other node.
    assert_eq!(graph.move_into(5, 3), Ok(()));
    assert_eq!(graph.positions(), before.as_slice());
    assert_eq!((graph.container(5), graph.held(3)), (3, &[4, 5][..]));
    assert_eq!(found(&mut graph).1, vec![1, 2, 4, 5]);
    // A move into its own container keeps the rank: node 1 stays below the others.
    let ranks = graph.ranks.clone();
    assert_eq!(graph.move_into(1, 0), Ok(()));
    assert_eq!(
        (graph.ranks.clone(), graph.held(0)),
        (ranks, &[1, 2, 3][..])
    );
    // Node 1 onto the canvas takes the next rank too, and leaves its container's list.
    assert_eq!(graph.move_into(1, CANVAS), Ok(()));
    assert_eq!((graph.container(1), graph.held(0)), (CANVAS, &[2, 3][..]));
    assert_eq!(found(&mut graph).1, vec![2, 4, 5, 1]);
    // The inner container onto the canvas comes after the outer one, by its rank, and a move of
    // the outer one leaves it where it is.
    assert_eq!(graph.move_into(3, CANVAS), Ok(()));
    assert_eq!(found(&mut graph).0, vec![0, 3]);
    graph.translate(&[0], 10.0, 10.0).unwrap();
    assert_eq!(&graph.positions()[6..8], &before[6..8]);
    assert_eq!(graph.container_at(Point::new(150.0, 350.0), 5), Ok(Some(3)));
    assert_eq!(graph.container_at(Point::new(150.0, 350.0), 3), Ok(Some(0)));
}

#[test]
fn a_move_into_a_node_that_is_no_container_or_into_itself_is_refused_and_changes_nothing() {
    // Verifies: ARCH-engine-edits-nested-graph
    let mut graph = nested_three();
    let held = |graph: &Graph| [0, 3].map(|s| graph.held(s).to_vec());
    let before = (held(&graph), found(&mut graph));
    for (slot, container, refusal) in [
        (5, 1, MoveIntoError::NoContainer { slot: 1 }),
        (5, 6, MoveIntoError::NoContainer { slot: 6 }),
        (5, 99, MoveIntoError::NoContainer { slot: 99 }),
        (0, 0, MoveIntoError::InItself { slot: 0 }),
        (0, 3, MoveIntoError::InItself { slot: 3 }),
        (6, 0, MoveIntoError::Slot(SlotError::NoNode { slot: 6 })),
    ] {
        assert_eq!(graph.move_into(slot, container), Err(refusal));
        assert_eq!((held(&graph), found(&mut graph)), before);
    }
    assert_eq!(
        graph.container_at(Point::new(0.0, 0.0), 6),
        Err(SlotError::NoNode { slot: 6 })
    );
}

#[test]
fn a_node_placed_lies_exactly_there_and_takes_what_it_holds_along() {
    // Verifies: ARCH-engine-edits-nested-graph
    let mut graph = nested_three();
    let before = graph.positions().to_vec();
    // Far from the origin, where f32 rounds a sum of deltas, dragged in odd steps and placed back:
    // the container below 2^20 on x, node 2 above it, where f32 rounds to a coarser step.
    graph.translate(&[0], 1_048_300.0, -3.0e6).unwrap();
    for _ in 0..7 {
        graph.translate(&[0], 0.05, -0.3).unwrap();
    }
    graph.place(0, 100.0, 200.0).unwrap();
    // The container where it was, and what it holds exactly where it was too, at every depth, its
    // world position the sum along its chain again; the node outside stayed.
    assert_eq!(graph.positions(), before.as_slice());
    let mut out = Visible::default();
    graph.query(
        &Rect::new(114.0, 304.0, 116.0, 306.0),
        Level::Near,
        1.0,
        0.0,
        &mut out,
    );
    assert_eq!(out.nodes, vec![4]);
    assert!(matches!(
        graph.place(0, f64::NAN, 0.0),
        Err(MoveError::Position(PositionError::NonFinite))
    ));
    assert_eq!(
        graph.place(6, 0.0, 0.0),
        Err(MoveError::Slot(SlotError::NoNode { slot: 6 }))
    );
}

#[test]
fn a_move_naming_a_node_twice_or_with_what_holds_it_moves_each_node_once() {
    // Verifies: ARCH-engine-edits-nested-graph
    let mut graph = nested_three();
    let before = graph.positions().to_vec();
    let moved_by = |graph: &Graph, dx: f32| {
        (0..6)
            .map(|slot| graph.positions()[slot * 2] - before[slot * 2])
            .map(|d| d == dx)
            .collect::<Vec<bool>>()
    };
    // The container named twice.
    graph.translate(&[0, 0], 10.0, 0.0).unwrap();
    assert_eq!(
        moved_by(&graph, 10.0),
        [true, true, true, true, true, false]
    );
    // Many slots: the container, what it holds at each depth, the node outside, and repeats, in
    // an order that names content before what holds it.
    graph
        .translate(&[4, 0, 5, 3, 1, 0, 4, 2], 5.0, 0.0)
        .unwrap();
    assert_eq!(
        moved_by(&graph, 15.0),
        [true, true, true, true, true, false]
    );
    assert_eq!(graph.positions()[10] - before[10], 5.0);
}

#[test]
fn a_container_moved_to_the_world_s_limit_cuts_its_content_there_and_placed_back_restores_it() {
    // Verifies: ARCH-engine-edits-nested-graph
    let mut graph = nested_three();
    // A node reaching past the container's right side, 550 into it and 200 wide.
    let past = graph
        .add_node_in(0, false, [650.0, 210.0, 200.0, 20.0])
        .unwrap();
    let before = graph.positions().to_vec();
    graph.translate(&[0], f32::MAX, 0.0).unwrap();
    // The container and everything it holds stop at the limit, which f32 rounds them to; the
    // node outside stays.
    let limit = WORLD_LIMIT as f32;
    for slot in [0, 1, 2, 3, 4, past as usize] {
        assert_eq!(graph.positions()[slot * 2], limit, "node {slot}");
        assert_eq!(
            graph.positions()[slot * 2 + 1],
            before[slot * 2 + 1],
            "node {slot}"
        );
    }
    assert_eq!(&graph.positions()[10..12], &before[10..12]);
    // The positions within the container were kept: placed back, each lies where it lay.
    graph.place(0, 100.0, 200.0).unwrap();
    assert_eq!(graph.positions(), before.as_slice());
}

/// The box of the node in `slot`, `x, y, width, height`, as its buffers hold it.
fn box_of(graph: &Graph, slot: u32) -> [f64; 4] {
    let i = slot as usize * 2;
    [
        f64::from(graph.positions()[i]),
        f64::from(graph.positions()[i + 1]),
        f64::from(graph.sizes()[i]),
        f64::from(graph.sizes()[i + 1]),
    ]
}

/// The centre of the node in `slot`, relative to the top left corner of the node in `on`.
fn centre_on(graph: &Graph, slot: u32, on: u32) -> (f64, f64) {
    let [x, y, w, h] = box_of(graph, slot);
    let [ox, oy, ..] = box_of(graph, on);
    (x + w / 2.0 - ox, y + h / 2.0 - oy)
}

/// What the property test of border nodes gave each border node: the node it rides, its side,
/// and its offset as the call that placed it returned it.
struct Rider {
    slot: u32,
    on: u32,
    side: Side,
    offset: f64,
}

/// Asserts that each of `riders` is centred on its node's outline, on the half of the box nearer
/// its side, at its offset held within the side's length now, within far less than Q-4's half a
/// pixel at any zoom the graph is drawn at.
fn assert_riding(graph: &Graph, riders: &[Rider]) {
    for rider in riders {
        let shape = graph.shape(rider.on);
        let [ox, oy, w, h] = box_of(graph, rider.on);
        let (x, y) = centre_on(graph, rider.slot, rider.on);
        let tolerance = 1e-3 + 1e-6 * (ox.abs() + oy.abs() + w + h);
        let off = crate::shape::tests::off_outline(shape, w, h, x, y);
        assert!(
            off <= tolerance,
            "{shape:?} {w}x{h}: ({x}, {y}) off by {off}"
        );
        let length = match rider.side {
            Side::Top | Side::Bottom => w,
            Side::Right | Side::Left => h,
        };
        let (along, near) = match rider.side {
            Side::Top => (x, y <= h / 2.0 + tolerance),
            Side::Right => (y, x >= w / 2.0 - tolerance),
            Side::Bottom => (x, y >= h / 2.0 - tolerance),
            Side::Left => (y, x <= w / 2.0 + tolerance),
        };
        let held = rider.offset.clamp(0.0, length);
        assert!(
            (along - held).abs() <= tolerance && near,
            "{shape:?} {w}x{h} {:?} at {}: ({x}, {y})",
            rider.side,
            rider.offset
        );
    }
}

/// The graph of the property test of border nodes: a container, one node of each node shape, every
/// other one in the container, five border nodes on each, one on every side, and edges between
/// border nodes.
struct Bordered {
    graph: Graph,
    container: u32,
    nodes: Vec<u32>,
    riders: Vec<Rider>,
    edges: Vec<(u32, EdgeSpec)>,
}

const SIDES: [Side; 4] = [Side::Top, Side::Right, Side::Bottom, Side::Left];

/// Per node shape, the steps whose check rests on the riders of a node of that shape: a move of
/// such a node or of the container it lies in, its resize, a drag of one of its border nodes, and
/// an update of one's place; and the drags checked against a scan of the outline.
#[derive(Default)]
struct Counts {
    moved: [u32; NodeShape::ALL.len()],
    resized: [u32; NodeShape::ALL.len()],
    slid: [u32; NodeShape::ALL.len()],
    placed: [u32; NodeShape::ALL.len()],
    nearest: u32,
}

/// The place of the node shape of the node in `slot` in `NodeShape::ALL`.
fn shape_code(graph: &Graph, slot: u32) -> usize {
    let shape = graph.shape(slot);
    crate::shape::NodeShape::ALL
        .iter()
        .position(|&s| s == shape)
        .unwrap()
}

impl Bordered {
    fn new(rng: &mut Lcg) -> Self {
        use crate::shape::NodeShape;
        let mut graph = Graph::new(Vec::new(), Vec::new(), Vec::new()).unwrap();
        let container = graph
            .add_node_in(CANVAS, true, [-3000.0, -3000.0, 6000.0, 6000.0])
            .unwrap();
        let mut nodes = Vec::new();
        let mut riders = Vec::new();
        for (k, shape) in NodeShape::ALL.into_iter().enumerate() {
            let within = if k % 2 == 0 { container } else { CANVAS };
            let width = rng.range(20.0, 400.0) as f32;
            let height = match shape {
                NodeShape::Circle | NodeShape::RingedCircle => width,
                NodeShape::Bar => 8.0,
                _ => rng.range(20.0, 300.0) as f32,
            };
            let at = [
                rng.range(-2000.0, 2000.0) as f32,
                rng.range(-2000.0, 2000.0) as f32,
            ];
            let node = graph
                .add_node_in(within, false, [at[0], at[1], width, height])
                .unwrap();
            graph.set_shape(node, shape).unwrap();
            nodes.push(node);
            for n in 0..5 {
                let side = SIDES[if n < 4 { n } else { rng.below(4) as usize }];
                riders.push(attached(&mut graph, rng, node, side, [width, height]));
            }
        }
        let mut edges = Vec::new();
        for _ in 0..10 {
            let a = riders[rng.below(riders.len()) as usize].slot;
            let b = riders[rng.below(riders.len()) as usize].slot;
            if a != b {
                let spec = EdgeSpec {
                    sides: Sides::default(),
                    source: End::Node(a),
                    target: End::Node(b),
                    labels: Vec::new(),
                    style: EdgeStyle::unstyled(),
                };
                edges.push((graph.add_edge(spec.clone()).unwrap(), spec));
            }
        }
        Self {
            graph,
            container,
            nodes,
            riders,
            edges,
        }
    }

    /// One random step: a move or a drop, a resize, a drag of a border node, or an update of its
    /// place, each checked after it.
    fn step(&mut self, rng: &mut Lcg, counts: &mut Counts) {
        match rng.below(5) {
            0 | 1 => {
                let pick = rng.below(self.nodes.len() + 1) as usize;
                let slot = self.nodes.get(pick).copied().unwrap_or(self.container);
                let (dx, dy) = (rng.range(-500.0, 500.0), rng.range(-500.0, 500.0));
                self.graph.translate(&[slot], dx as f32, dy as f32).unwrap();
                if slot != self.container && rng.next() < 0.3 {
                    let into = if rng.next() < 0.5 {
                        self.container
                    } else {
                        CANVAS
                    };
                    self.graph.move_into(slot, into).unwrap();
                }
                assert_riding(&self.graph, &self.riders);
                // The nodes the move moved: the one named, or what the container holds.
                for &node in &self.nodes {
                    if node == slot || (slot == self.container && self.graph.lies_in(node, slot)) {
                        counts.moved[shape_code(&self.graph, node)] += 1;
                    }
                }
            }
            2 => {
                let slot = self.nodes[rng.below(self.nodes.len()) as usize];
                let [x, y, w, h] = box_of(&self.graph, slot);
                let from = Rect::new(x, y, x + w, y + h);
                let handle = Handle::ALL[rng.below(8) as usize];
                let by = [rng.range(-300.0, 300.0), rng.range(-300.0, 300.0)];
                self.graph.resize(slot, handle, &from, by, 8.0).unwrap();
                assert_riding(&self.graph, &self.riders);
                counts.resized[shape_code(&self.graph, slot)] += 1;
            }
            3 => self.slid(rng, counts),
            _ => {
                let k = rng.below(self.riders.len()) as usize;
                let side = SIDES[rng.below(4) as usize];
                let offset = rng.range(-100.0, 600.0);
                let held = self.graph.set_place(self.riders[k].slot, side, offset);
                (self.riders[k].side, self.riders[k].offset) = (side, held.unwrap());
                assert_riding(&self.graph, &self.riders);
                counts.placed[shape_code(&self.graph, self.riders[k].on)] += 1;
            }
        }
        // The edges at border nodes lie where their ends now are.
        for (edge, spec) in &self.edges {
            let edge = *edge;
            let ends = [spec.nodes().0, spec.nodes().1].map(|s| {
                let [x, y, w, h] = box_of(&self.graph, s);
                Rect::new(x, y, x + w, y + h)
            });
            let path = path_of(spec, &ends[0], &ends[1]);
            assert_eq!(self.graph.paths[edge as usize], path);
        }
    }

    /// A drag of a border node to a point around its node, inside it or out: its centre is then
    /// the outline's point nearest the pointer, by a scan of the outline.
    fn slid(&mut self, rng: &mut Lcg, counts: &mut Counts) {
        let k = rng.below(self.riders.len()) as usize;
        let on = self.riders[k].on;
        let [x, y, w, h] = box_of(&self.graph, on);
        let point = Point::new(x + w * rng.range(-0.5, 1.5), y + h * rng.range(-0.5, 1.5));
        let place = self.graph.slide(self.riders[k].slot, point).unwrap();
        assert_eq!(place.on, on);
        (self.riders[k].side, self.riders[k].offset) = (place.side, place.offset);
        assert_riding(&self.graph, &self.riders);
        counts.slid[shape_code(&self.graph, on)] += 1;
        let shape = self.graph.shape(on);
        let (cx, cy) = centre_on(&self.graph, self.riders[k].slot, on);
        let (px, py) = (point.x - x, point.y - y);
        let scanned = crate::shape::tests::outline_points(shape, w, h, 4_000)
            .iter()
            .map(|&(sx, sy)| (sx - px).hypot(sy - py))
            .fold(f64::INFINITY, f64::min);
        let tolerance = 1e-3 + 1e-6 * (x.abs() + y.abs() + w + h);
        let found = (cx - px).hypot(cy - py);
        assert!(
            found <= scanned + tolerance,
            "{shape:?}: {found} > {scanned}"
        );
        counts.nearest += 1;
    }

    /// Removes a node, and asserts that its border nodes and every edge at them went with it.
    fn assert_removal(&mut self, rng: &mut Lcg) {
        let node = self.nodes[rng.below(self.nodes.len()) as usize];
        let ridden: Vec<u32> = self
            .riders
            .iter()
            .filter(|r| r.on == node)
            .map(|r| r.slot)
            .collect();
        let (removed, edges_removed) = self.graph.remove_nodes(&[node]).unwrap();
        let mut expected = vec![node];
        expected.extend(&ridden);
        assert_eq!(removed, expected);
        for (edge, spec) in &self.edges {
            let at = ridden.contains(&spec.nodes().0) || ridden.contains(&spec.nodes().1);
            assert_eq!(edges_removed.contains(edge), at);
            assert_eq!(self.graph.edge(*edge).is_none(), at);
        }
        assert!(ridden.iter().all(|&s| !self.graph.holds_node(s)));
    }
}

/// A border node of 6 to 16 square attached to `node`, `size` its width and height, on `side`
/// at a random offset up to a fifth of the side's length beyond either end.
fn attached(graph: &mut Graph, rng: &mut Lcg, node: u32, side: Side, size: [f32; 2]) -> Rider {
    let edge = rng.range(6.0, 16.0) as f32;
    let slot = graph.add_node(0.0, 0.0, edge, edge).unwrap();
    let length = f64::from(match side {
        Side::Top | Side::Bottom => size[0],
        Side::Right | Side::Left => size[1],
    });
    let offset = rng.range(-0.2 * length, 1.2 * length);
    let held = graph.attach(slot, node, side, offset).unwrap();
    assert_eq!(held, offset.clamp(0.0, length));
    Rider {
        slot,
        on: node,
        side,
        offset: held,
    }
}

#[test]
fn border_nodes_stay_on_their_node_s_outline_at_their_side_through_moves_resizes_and_drags() {
    // Verifies: ARCH-border-nodes-ride-sides, G-17
    let mut rng = Lcg(0x000B_0DE5);
    let mut counts = Counts::default();
    for _ in 0..28 {
        let mut bordered = Bordered::new(&mut rng);
        assert_riding(&bordered.graph, &bordered.riders);
        for _ in 0..60 {
            bordered.step(&mut rng, &mut counts);
        }
        bordered.assert_removal(&mut rng);
    }
    for (code, shape) in crate::shape::NodeShape::ALL.iter().enumerate() {
        let (moved, resized) = (counts.moved[code], counts.resized[code]);
        let (slid, placed) = (counts.slid[code], counts.placed[code]);
        assert!(
            moved >= 20 && resized >= 10 && slid >= 10 && placed >= 10,
            "{shape:?}: {moved} moved, {resized} resized, {slid} slid, {placed} placed"
        );
    }
    assert!(counts.nearest >= 100, "{} drags", counts.nearest);
}
