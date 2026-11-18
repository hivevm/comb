//! The nodes of the graph: an addition into the free slot freed last or a new one, with the next
//! rank, so that it is drawn and hit above every other node; a removal, which takes the edges at
//! the nodes along; and a move, which takes them along too (ARCH-engine-edits-graph-in-place).

use std::collections::HashSet;

use super::slots::put;
use super::{AddNodeError, CANVAS, Graph, MoveError, SlotError, TooManySlots};
use crate::geometry::{Rect, WORLD_LIMIT};
use crate::shape::NodeShape;

/// Where `shift` moves the nodes named to it: by a delta, as `translate` moves them, or to a
/// world position, as `place` puts one.
#[derive(Clone, Copy)]
enum Shift {
    By([f64; 2]),
    To([f64; 2]),
}

/// Why the positions refused a move: a delta that is NaN or infinite.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PositionError {
    /// A delta that is NaN or infinite.
    NonFinite,
}

impl Graph {
    /// How many node slots hold a node.
    pub fn nodes_in_use(&self) -> u32 {
        self.node_slots.in_use()
    }

    /// Whether `slot` holds a node: a slot below the slots and not free.
    pub fn holds_node(&self, slot: u32) -> bool {
        self.node_slots.holds(slot)
    }

    /// Refuses `slots` where one holds no node, beyond the slots or free, naming the first: the
    /// one check of the node slots a call names (ARCH-engine-edits-graph-in-place).
    pub(super) fn nodes_held(&self, slots: &[u32]) -> Result<(), SlotError> {
        match slots.iter().find(|&&s| !self.holds_node(s)) {
            Some(&slot) => Err(SlotError::NoNode { slot }),
            None => Ok(()),
        }
    }

    /// Adds the node at `(x, y)` of size `(width, height)` on the canvas and returns its slot, as
    /// `add_node_in` adds one.
    pub fn add_node(
        &mut self,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    ) -> Result<u32, TooManySlots> {
        self.add_nested(CANVAS, false, [x, y, width, height])
    }

    /// Adds the node at the world position `(x, y)` of size `(width, height)` into the container
    /// in `container`, or onto the canvas for `CANVAS`, a container itself where `is_container`,
    /// and returns its slot: the free slot freed last, or a new one after the highest. It takes
    /// the next rank, so that it is drawn and hit above every other node of its kind, and goes into
    /// the index in place, which the rule of ARCH-engine-edits-graph-in-place then builds again
    /// where it asks for it. A container that holds no container refuses the node, and the graph
    /// stays as it was (ARCH-engine-edits-nested-graph).
    pub fn add_node_in(
        &mut self,
        container: u32,
        is_container: bool,
        [x, y, width, height]: [f32; 4],
    ) -> Result<u32, AddNodeError> {
        if container != CANVAS && !(self.holds_node(container) && self.is_container(container)) {
            return Err(AddNodeError::NoContainer { slot: container });
        }
        Ok(self.add_nested(container, is_container, [x, y, width, height])?)
    }

    /// `add_node_in` past its check of `container`, which is `CANVAS` or holds a container.
    fn add_nested(
        &mut self,
        container: u32,
        is_container: bool,
        [x, y, width, height]: [f32; 4],
    ) -> Result<u32, TooManySlots> {
        let rank = self.take_rank();
        let slot = self.node_slots.take()?;
        let i = slot as usize;
        put(&mut self.positions, i * 2, x);
        put(&mut self.positions, i * 2 + 1, y);
        put(&mut self.sizes, i * 2, width);
        put(&mut self.sizes, i * 2 + 1, height);
        put(&mut self.ranks, i, rank);
        // A node added is a rectangle until it is given another node shape; a freed slot taken
        // again forgets the node shape of the node it held.
        if let Some(shape) = self.shapes.get_mut(i) {
            *shape = NodeShape::default();
        }
        // A node added has no edges yet; a freed slot taken again forgets the nesting of the node
        // it held before it takes the new node's.
        put(&mut self.incident, i, Vec::new());
        self.forget_nesting(slot);
        self.next_rank += 1;
        self.nest_added(slot, container, is_container);
        let bounds = self.node_bounds(slot);
        self.node_grid.set(slot, &bounds);
        self.keep_index();
        Ok(slot)
    }

    /// The rank the next node added takes, after the ranks in use are numbered again from 0 in
    /// their order where it would pass `u32::MAX`.
    pub(super) fn take_rank(&mut self) -> u32 {
        if let Ok(rank) = u32::try_from(self.next_rank) {
            return rank;
        }
        let mut order: Vec<u32> = self.node_slots.in_use_slots().collect();
        order.sort_unstable_by_key(|&s| self.ranks[s as usize]);
        let mut next = 0;
        for &s in &order {
            self.ranks[s as usize] = next;
            next += 1;
        }
        self.next_rank = u64::from(next);
        next
    }

    /// The rectangle of the node in `slot`.
    pub(super) fn node_bounds(&self, slot: u32) -> Rect {
        let i = slot as usize * 2;
        Rect::of_node(
            f64::from(self.positions[i]),
            f64::from(self.positions[i + 1]),
            f64::from(self.sizes[i]),
            f64::from(self.sizes[i + 1]),
        )
    }

    /// Removes the nodes in `slots`, everything they hold at every depth, and every edge at any of
    /// them, and returns the slots of those nodes, as `with_held` names them, and of those edges,
    /// in ascending order. Their slots go onto the free lists, the node named last freed last, and
    /// they leave the index; nothing else moves (ARCH-engine-edits-nested-graph). A slot that holds
    /// no node refuses the call, which then changes nothing.
    pub fn remove_nodes(&mut self, slots: &[u32]) -> Result<(Vec<u32>, Vec<u32>), SlotError> {
        let (nodes, edges) = self.removal(slots)?;
        // The nodes go first, so that the edges leave only the lists of the nodes that stay.
        let mut containers = false;
        for &slot in &nodes {
            if self.node_slots.free(slot) {
                self.incident[slot as usize].clear();
                containers |= self.is_container(slot);
                self.forget_nesting(slot);
            }
        }
        if containers {
            self.order_containers();
        }
        self.node_grid.take(&nodes);
        // A removal builds nothing: the index is built again after growth and moves
        // (ARCH-engine-edits-graph-in-place).
        self.free_edges_at(&edges);
        Ok((nodes, edges))
    }

    /// Moves the nodes in `slots` by `(dx, dy)`, everything they hold with them, at every depth,
    /// and their edges, in time linear in what they hold (ARCH-engine-edits-nested-graph,
    /// *Positions*). A refused move changes nothing. Once more than an eighth of the nodes or
    /// edges, and at least 16, reach beyond the extent the index was built for, the index is built
    /// again over the current extent.
    pub fn translate(&mut self, slots: &[u32], dx: f32, dy: f32) -> Result<(), MoveError> {
        self.shift(slots, Shift::By([f64::from(dx), f64::from(dy)]))
    }

    /// The nodes in `slots` that lie in no other of them, each once, in the order named: what a
    /// move of them moves by its own delta, each taking what it holds along. Linear in the slots
    /// named and the depth they lie at.
    fn roots_of(&self, slots: &[u32]) -> Vec<u32> {
        let named: HashSet<u32> = slots.iter().copied().collect();
        let mut seen = HashSet::with_capacity(named.len());
        slots
            .iter()
            .copied()
            .filter(|&s| seen.insert(s))
            .filter(|&s| {
                let mut at = self.container(s);
                while at != CANVAS {
                    if named.contains(&at) {
                        return false;
                    }
                    at = self.container(at);
                }
                true
            })
            .collect()
    }

    /// Moves the nodes in `slots` as `how` says, by a delta for `translate` or to a world position
    /// for `place`: the nodes named that lie in no other named node, each once, and what they
    /// hold, at every depth, to the sum of its container's new world position and its own
    /// relative to it, which the move keeps, so that no rounding of a delta builds up within a
    /// container, each node cut where it meets the world's limit.
    fn shift(&mut self, slots: &[u32], how: Shift) -> Result<(), MoveError> {
        self.nodes_held(slots)?;
        let (Shift::By(numbers) | Shift::To(numbers)) = how;
        if !numbers.iter().all(|n| n.is_finite()) {
            return Err(PositionError::NonFinite.into());
        }
        let named;
        let roots = if slots.len() > 1 {
            named = self.roots_of(slots);
            named.as_slice()
        } else {
            slots
        };
        // Each node stops where it meets the world's limit, so that nothing derived from it turns
        // infinite.
        match how {
            Shift::By(delta) => {
                translate_positions(&mut self.positions, &self.sizes, roots, delta, WORLD_LIMIT)?;
            }
            Shift::To(at) => {
                for &root in roots {
                    let i = root as usize * 2;
                    for axis in 0..2 {
                        let size = f64::from(self.sizes[i + axis]);
                        self.positions[i + axis] = within_world(at[axis], size, WORLD_LIMIT);
                    }
                }
            }
        }
        for &root in roots {
            if self.container(root) != CANVAS {
                self.keep_relative(root);
            }
        }
        let held;
        let slots = if roots.iter().any(|&s| !self.held(s).is_empty()) {
            // Each container before what it holds, so that each is summed from where it now is.
            held = self.with_held(roots)?;
            let root_set: HashSet<u32> = roots.iter().copied().collect();
            for &slot in held.iter().filter(|s| !root_set.contains(s)) {
                let summed = self.summed(slot);
                let i = slot as usize * 2;
                for axis in 0..2 {
                    let size = f64::from(self.sizes[i + axis]);
                    self.positions[i + axis] = within_world(summed[axis], size, WORLD_LIMIT);
                }
            }
            held.as_slice()
        } else {
            roots
        };
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
        self.keep_index();
        Ok(())
    }

    /// Puts the node in `slot` at the world position `(x, y)`, and what it holds, at every depth,
    /// at the sum along its chain, as `translate` moves them, so that a drag taken back puts the
    /// node and its content where they were and not where a sum of the drag's `f32` deltas would
    /// (API-edits-report-nested-changes, *Vetoes*). A slot that holds no node, or a point that is
    /// not finite, refuses the call, which then changes nothing.
    pub fn place(&mut self, slot: u32, x: f64, y: f64) -> Result<(), MoveError> {
        self.shift(&[slot], Shift::To([x, y]))
    }

    /// Gives the node in `slot` the height `height`, which its content lays out to
    /// (REN-node-content-in-rows), and re-places its edges and its place in the index. A slot that
    /// holds no node refuses the call, which then changes nothing.
    pub fn resize_node(&mut self, slot: u32, height: f32) -> Result<(), SlotError> {
        self.nodes_held(&[slot])?;
        self.sizes[slot as usize * 2 + 1] = height;
        let bounds = self.node_bounds(slot);
        self.node_grid.set(slot, &bounds);
        let edges = std::mem::take(&mut self.incident[slot as usize]);
        for &edge in &edges {
            self.place_edge(edge);
        }
        self.incident[slot as usize] = edges;
        self.keep_index();
        Ok(())
    }

    /// The node sizes, `width, height` per slot.
    pub fn sizes(&self) -> &[f32] {
        &self.sizes
    }

    /// The node shape of the node in `slot`, a rectangle where none was given
    /// (REN-closed-set-of-node-shapes).
    pub fn shape(&self, slot: u32) -> NodeShape {
        self.shapes.get(slot as usize).copied().unwrap_or_default()
    }

    /// Gives the node in `slot` the node shape `shape`, and places its edges again, whose ends
    /// on its outline move with it (API-edges-dock-side-or-outline). Its bounds stay its rectangle;
    /// its height is the caller's, through `resize_node`. A slot that holds no node refuses the
    /// call, which then changes nothing.
    pub fn set_shape(&mut self, slot: u32, shape: NodeShape) -> Result<(), SlotError> {
        self.nodes_held(&[slot])?;
        let i = slot as usize;
        if self.shapes.len() <= i {
            self.shapes.resize(i + 1, NodeShape::default());
        }
        self.shapes[i] = shape;
        let edges = std::mem::take(&mut self.incident[i]);
        for &edge in &edges {
            self.place_edge(edge);
        }
        self.incident[i] = edges;
        self.keep_index();
        Ok(())
    }
}

/// Moves the nodes in `slots`, slots that hold a node, by `(dx, dy)` within `positions`, `x, y`
/// per node slot (API-bridge-takes-serde-and-columns), each as far as keeps it, of the size `sizes`
/// holds for it, within `limit` of the origin on each axis, as `f32` rounds it. Nothing is written
/// unless the delta is finite, so a refused move leaves the buffer as it was.
fn translate_positions(
    positions: &mut [f32],
    sizes: &[f32],
    slots: &[u32],
    [dx, dy]: [f64; 2],
    limit: f64,
) -> Result<(), PositionError> {
    if !dx.is_finite() || !dy.is_finite() {
        return Err(PositionError::NonFinite);
    }
    for &slot in slots {
        let i = slot as usize * 2;
        for (axis, delta) in [(i, dx), (i + 1, dy)] {
            // In `f64`, so that a move past `f32` is cut rather than turned infinite.
            let moved = f64::from(positions[axis]) + delta;
            positions[axis] = within_world(moved, f64::from(sizes[axis]), limit);
        }
    }
    Ok(())
}

/// `at`, on one axis, of a node of `size` there, cut to keep the node within `limit` of the origin,
/// as `f32` rounds it.
fn within_world(at: f64, size: f64, limit: f64) -> f32 {
    #[expect(
        clippy::cast_possible_truncation,
        reason = "cut to within `limit`, far within f32, before it is rounded"
    )]
    let cut = at.clamp(-limit, (limit - size).max(-limit)) as f32;
    cut
}

#[cfg(test)]
mod tests {
    use super::super::tests::{Lcg, paired, row};
    use super::super::{EdgeSpec, Level, Visible};
    use super::*;
    use crate::geometry::tests::on_the_outline_towards;
    use crate::geometry::{Dock, Point, Sides};
    use crate::stroke::EdgeStyle;

    /// The centre of the node in `slot`.
    fn centre_of(graph: &Graph, slot: u32) -> Point {
        let b = graph.node_bounds(slot);
        Point::new((b.min_x + b.max_x) / 2.0, (b.min_y + b.max_y) / 2.0)
    }

    const OUTLINE: Sides = Sides {
        source: Dock::Outline,
        target: Dock::Outline,
    };

    #[test]
    fn five_ends_on_the_outline_of_one_node_follow_it_as_it_is_dragged_and_never_meet() {
        // Verifies: API-edges-dock-side-or-outline, G-2
        // A hub and five nodes around it, every 72°, the edges in both directions, every end on
        // the outline; the hub an ellipse, the others a circle, a diamond, a rounded rectangle, a
        // rectangle, and a ringed circle.
        let mut positions = vec![-80.0, -40.0];
        let mut sizes = vec![160.0, 80.0];
        let mut specs = Vec::new();
        for i in 0..5_u32 {
            let angle = f64::from(i) * core::f64::consts::TAU / 5.0 + 0.3;
            positions.extend([
                (angle.cos() * 400.0 - 30.0) as f32,
                (angle.sin() * 400.0 - 30.0) as f32,
            ]);
            sizes.extend([60.0, 60.0]);
            let (source, target) = if i % 2 == 0 { (0, i + 1) } else { (i + 1, 0) };
            specs.push(EdgeSpec {
                sides: OUTLINE,
                source,
                target,
                label: None,
                style: EdgeStyle::unstyled(),
            });
        }
        let mut graph = Graph::new(positions, sizes, specs).unwrap();
        let shapes = [
            NodeShape::Ellipse,
            NodeShape::Circle,
            NodeShape::Diamond,
            NodeShape::RoundedRectangle,
            NodeShape::Rectangle,
            NodeShape::RingedCircle,
        ];
        for (slot, shape) in (0..).zip(shapes) {
            graph.set_shape(slot, shape).unwrap();
        }
        // Dragged in steps, past some of the others and back.
        for (dx, dy) in [
            (0.0, 0.0),
            (35.0, -12.0),
            (300.0, 50.0),
            (-640.0, 210.0),
            (0.5, 0.25),
        ] {
            graph.translate(&[0], dx, dy).unwrap();
            let hub = centre_of(&graph, 0);
            let mut at_hub = Vec::new();
            for edge in 0..5_u32 {
                let path = graph.paths[edge as usize];
                let other = edge + 1;
                let (end, far) = if edge % 2 == 0 {
                    (path.source, path.target)
                } else {
                    (path.target, path.source)
                };
                on_the_outline_towards(
                    end,
                    &graph.node_bounds(0),
                    NodeShape::Ellipse,
                    centre_of(&graph, other),
                    1e-9,
                );
                on_the_outline_towards(
                    far,
                    &graph.node_bounds(other),
                    shapes[other as usize],
                    hub,
                    1e-9,
                );
                at_hub.push(end);
            }
            for (i, a) in at_hub.iter().enumerate() {
                for b in &at_hub[i + 1..] {
                    assert!(
                        (a.x - b.x).hypot(a.y - b.y) > 1.0,
                        "two ends meet at {a:?} after ({dx}, {dy})"
                    );
                }
            }
        }
    }

    #[test]
    fn a_new_node_shape_moves_the_ends_on_its_outline_onto_it() {
        // Verifies: API-edges-dock-side-or-outline
        let mut graph = Graph::new(
            vec![0.0, 0.0, 300.0, 200.0],
            vec![100.0, 60.0, 100.0, 60.0],
            vec![EdgeSpec {
                sides: OUTLINE,
                source: 0,
                target: 1,
                label: None,
                style: EdgeStyle::unstyled(),
            }],
        )
        .unwrap();
        graph.set_shape(1, NodeShape::Diamond).unwrap();
        let path = graph.paths[0];
        on_the_outline_towards(
            path.target,
            &graph.node_bounds(1),
            NodeShape::Diamond,
            centre_of(&graph, 0),
            1e-9,
        );
        assert_eq!(graph.bounds[0], path.bounds());
    }

    #[test]
    fn every_end_on_the_outline_lies_on_it_within_q4_far_from_the_origin_too() {
        // Verifies: REN-closed-set-of-node-shapes, API-edges-dock-side-or-outline, Q-4
        // Random nodes of random node shapes, near the origin and as far out as 2^40, and random
        // edges between them docked on the outline: every end lies on its node's outline, on
        // the line towards the other centre, within the precision `f64` keeps at that distance.
        // Each node stands in a cell of its own of a 6 × 6 grid whose step is at least the
        // spacing of `f32` at that distance, so that no two nodes round onto one place.
        const TIERS: [f64; 4] = [0.0, 1e4, 3e7, 1_099_511_627_776.0];
        let mut rng = Lcg(32);
        let mut per_shape = [0_u32; NodeShape::ALL.len()];
        let mut per_tier = [0_u32; TIERS.len()];
        for case in 0..200 {
            let tier = case % TIERS.len();
            let far = TIERS[tier];
            // The spacing of `f32` at `far`, 2^-23 of its power of two, and 131072 at 2^40.
            let spacing = if far == 0.0 {
                0.0
            } else {
                2f64.powi(far.log2().floor() as i32 - 23)
            };
            let step = spacing.max(400.0);
            let mut cells: Vec<u32> = (0..36).collect();
            let mut positions = Vec::new();
            let mut sizes = Vec::new();
            for _ in 0..12 {
                let cell = cells.swap_remove(rng.below(cells.len()) as usize);
                let (column, row) = (f64::from(cell % 6), f64::from(cell / 6));
                positions.extend([(far + column * step) as f32, (-far + row * step) as f32]);
                sizes.extend([rng.range(4.0, 300.0) as f32, rng.range(4.0, 160.0) as f32]);
            }
            let specs = (0..20)
                .map(|_| (rng.below(12), rng.below(12)))
                .filter(|(a, b)| a != b)
                .map(|(source, target)| EdgeSpec {
                    sides: OUTLINE,
                    source,
                    target,
                    label: None,
                    style: EdgeStyle::unstyled(),
                })
                .collect();
            let mut graph = Graph::new(positions, sizes, specs).unwrap();
            let mut shapes = Vec::new();
            for slot in 0..12 {
                let shape = rng.below(NodeShape::ALL.len()) as usize;
                graph.set_shape(slot, NodeShape::ALL[shape]).unwrap();
                shapes.push(shape);
            }
            for edge in 0..graph.edges_in_use() {
                let spec = graph.edges[edge as usize];
                let (a, b) = (
                    centre_of(&graph, spec.source),
                    centre_of(&graph, spec.target),
                );
                assert_ne!(a, b, "case {case}: two nodes on one centre");
                let path = graph.paths[edge as usize];
                let tolerance = 1e-9 * 500.0 + 8.0 * f64::EPSILON * far;
                for (end, slot, other) in
                    [(path.source, spec.source, b), (path.target, spec.target, a)]
                {
                    on_the_outline_towards(
                        end,
                        &graph.node_bounds(slot),
                        graph.shape(slot),
                        other,
                        tolerance,
                    );
                    per_shape[shapes[slot as usize]] += 1;
                    per_tier[tier] += 1;
                }
            }
        }
        // Every node shape and every distance has ends enough to rest on.
        for (shape, count) in NodeShape::ALL.iter().zip(per_shape) {
            assert!(count >= 200, "{shape:?}: {count} ends");
        }
        for (far, count) in TIERS.iter().zip(per_tier) {
            assert!(count >= 500, "at {far}: {count} ends");
        }
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
    fn a_resized_node_takes_its_edges_and_its_place_in_the_index_along() {
        // Verifies: REN-node-content-in-rows
        // Node 1, 100 × 50 at (300, 0), grows to 150 high: the edge from node 0 enters it at the
        // middle of its left side, now 75 down, and a query below its old bottom finds it.
        let mut graph = Graph::new(
            vec![0.0, 0.0, 300.0, 0.0],
            vec![100.0, 50.0, 100.0, 50.0],
            vec![EdgeSpec {
                sides: Sides::default(),
                source: 0,
                target: 1,
                label: None,
                style: EdgeStyle::unstyled(),
            }],
        )
        .unwrap();
        graph.resize_node(1, 150.0).unwrap();
        assert_eq!(graph.sizes(), [100.0, 50.0, 100.0, 150.0]);
        let mut ends = Vec::new();
        graph.edge_ends(&[0], &mut ends);
        assert_eq!(ends, [100.0, 25.0, 300.0, 75.0]);
        let mut out = Visible::default();
        let below = Rect::new(310.0, 100.0, 320.0, 140.0);
        graph.query(&below, Level::Near, 4.0, 0.0, &mut out);
        assert_eq!(out.nodes, [1]);
        assert_eq!(graph.node_at(Point::new(350.0, 140.0)), Some(1));
        assert_eq!(
            graph.resize_node(2, 1.0),
            Err(SlotError::NoNode { slot: 2 })
        );
    }

    #[test]
    fn a_refused_move_changes_nothing() {
        let mut graph = Graph::new(vec![0.0, 0.0], vec![1.0, 1.0], Vec::new()).unwrap();
        assert!(graph.translate(&[1], 1.0, 1.0).is_err());
        assert_eq!(graph.positions(), [0.0, 0.0]);
    }

    #[test]
    fn a_node_of_200_000_edges_is_removed_and_its_edges_leave_every_list_in_linear_time() {
        // Verifies: ARCH-engine-edits-graph-in-place
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
        assert_eq!(graph.remove_nodes(&[0]).unwrap().1.len(), 200_000);
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
    fn a_node_added_takes_the_slot_after_the_highest_and_its_place() {
        // Verifies: ARCH-engine-edits-graph-in-place
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
        // Verifies: ARCH-engine-edits-graph-in-place
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
    fn a_graph_that_never_loaded_takes_a_node_and_finds_it() {
        // Verifies: ARCH-engine-edits-graph-in-place
        let mut graph = Graph::default();
        assert_eq!(graph.add_node(10.0, 20.0, 50.0, 50.0), Ok(0));
        assert_eq!(graph.node_at(Point::new(30.0, 40.0)), Some(0));
        assert_eq!(graph.node_at(Point::new(5.0, 40.0)), None);
    }

    #[test]
    fn a_node_added_into_a_lower_slot_is_drawn_and_hit_above_the_nodes_it_overlaps() {
        // Verifies: ARCH-engine-edits-graph-in-place
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
        assert_eq!(graph.node_at(Point::new(20.0, 20.0)), Some(1));
    }

    #[test]
    fn a_load_ranks_nodes_by_slot() {
        // Verifies: ARCH-engine-edits-graph-in-place
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
        assert_eq!(graph.node_at(Point::new(5.0, 5.0)), Some(2));
        assert_eq!(graph.add_node(0.0, 0.0, 50.0, 50.0), Ok(3));
        assert_eq!(graph.ranks, [0, 1, 2, 3]);
    }

    #[test]
    fn ranks_are_numbered_again_from_0_in_their_order_before_they_pass_u32_max() {
        // Verifies: ARCH-engine-edits-graph-in-place
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
        assert_eq!(graph.node_at(Point::new(5.0, 5.0)), Some(4));
    }

    #[test]
    fn translate_moves_only_the_given_slots() {
        let mut positions = [0.0, 0.0, 10.0, 10.0, 20.0, 20.0];
        translate_positions(&mut positions, &[0.0; 6], &[0, 2], [5.0, -5.0], 1e9).unwrap();
        assert_eq!(positions, [5.0, -5.0, 10.0, 10.0, 25.0, 15.0]);
    }

    #[test]
    fn a_non_finite_delta_is_refused() {
        let mut positions = [0.0, 0.0];
        assert_eq!(
            translate_positions(&mut positions, &[0.0; 2], &[0], [f64::NAN, 0.0], 1e9),
            Err(PositionError::NonFinite)
        );
        assert_eq!(
            translate_positions(&mut positions, &[0.0; 2], &[0], [0.0, f64::INFINITY], 1e9),
            Err(PositionError::NonFinite)
        );
        assert_eq!(positions, [0.0, 0.0]);
    }

    #[test]
    fn a_move_past_the_limit_stops_where_the_node_meets_it() {
        // A node of 20 × 10 at (90, -90) moved by 1e30 either way, within 100 of the origin.
        let mut positions = [90.0, -90.0];
        translate_positions(&mut positions, &[20.0, 10.0], &[0], [1e30, -1e30], 100.0).unwrap();
        assert_eq!(positions, [80.0, -100.0]);
        translate_positions(
            &mut positions,
            &[20.0, 10.0],
            &[0],
            [f64::from(f32::MAX), f64::from(f32::MAX)],
            100.0,
        )
        .unwrap();
        assert_eq!(positions, [80.0, 90.0]);
    }
}
