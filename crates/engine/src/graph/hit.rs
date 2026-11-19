//! The hit test (REN-node-content-in-rows): what a press at a point hits, a connector before an
//! edge label, a node that is no container, an edge, and a container
//! (ARCH-engine-edits-nested-graph).

use super::regions::LINE_REACH;
use super::{Graph, Handle, Level};
use crate::geometry::{Point, Rect, Side, bounded_pixel, length};
use crate::stroke::{Stroke, near_path};

/// The four sides, each with a connector.
const SIDES: [Side; 4] = [Side::Top, Side::Right, Side::Bottom, Side::Left];

/// How near a press has to come to an edge's path to hit it, in screen pixels
/// (REN-node-content-in-rows).
const EDGE_REACH: f64 = 4.0;

/// How near a press has to come to a resize handle's middle to hit it, on each axis, in screen
/// pixels (REN-node-content-and-hits).
const HANDLE_REACH: f64 = 6.0;

/// How near a press has to come to a connector to hit it, in screen pixels
/// (REN-node-content-in-rows).
const CONNECTOR_REACH: f64 = 8.0;

/// What a press hits (REN-node-content-in-rows): a connector by its node's slot and side, a label
/// by its edge's slot and its place in that edge's list of labels, a node, or an edge, by its
/// slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    /// The connector of a side of the node in a slot (API-edges-dock-side-or-outline).
    Connector(u32, Side),
    /// The line after the region in a slot, between it and the next region
    /// (REN-node-content-and-hits, *Line between regions*).
    Line(u32),
    /// The label at a place of the list of labels of the edge in a slot
    /// (REN-node-content-in-rows, API-edges-dock-nodes-or-edges).
    Label(u32, u32),
    Node(u32),
    Edge(u32),
}

impl Graph {
    /// What a press at `point` hits where a screen pixel is `pixel` world units, at `level`: at the
    /// near and middle level a line between two regions within `LINE_REACH` screen pixels, the
    /// innermost; else where
    /// `connectors` asks for them, at the near and middle level, a connector within
    /// `CONNECTOR_REACH` screen pixels, and inside its node's outline within a quarter of the
    /// node's extent as well (`connector_at`), of the node of the highest rank; else at the near
    /// level a label whose measured pill holds it, of the highest edge slot and of its labels the
    /// last, drawn on top; else a node that is
    /// no container whose outline holds it, the one of the highest rank; else an edge within
    /// `EDGE_REACH` screen pixels of its path as the stroke of `level` flattens it, the one in the
    /// highest slot; else a container whose outline holds it, the last in the order of containers;
    /// else nothing (REN-node-content-in-rows, ARCH-engine-edits-nested-graph). A region hit is
    /// named as the node it divides.
    /// A pixel beyond any zoom hits as the largest a query strokes for.
    pub fn hit_at(
        &mut self,
        point: Point,
        pixel: f64,
        level: Level,
        connectors: bool,
    ) -> Option<Target> {
        let pixel = bounded_pixel(pixel);
        if level != Level::Far
            && let Some(slot) = self.line_at(point, LINE_REACH * pixel)
        {
            return Some(Target::Line(slot));
        }
        if connectors
            && level != Level::Far
            && let Some((slot, side)) = self.connector_at(point, CONNECTOR_REACH * pixel)
        {
            return Some(Target::Connector(slot, side));
        }
        if level == Level::Near
            && let Some((slot, index)) = self.label_at(point)
        {
            return Some(Target::Label(slot, index));
        }
        // A node that is no container lies above the edges, a container below them
        // (ARCH-engine-edits-nested-graph).
        let node = self.node_at(point);
        if let Some(slot) = node.filter(|&s| !self.is_container(s)) {
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
                && near_path(
                    (&self.paths[i], self.edges[i].style.lightning),
                    tolerance,
                    point,
                    reach,
                    &mut self.points,
                )
        });
        self.scratch = candidates;
        // A press on a region is one on the node it divides (ARCH-regions-are-container-slots,
        // *Drawing and hitting*).
        found
            .map(Target::Edge)
            .or(node.map(|slot| Target::Node(self.divided_node(slot))))
    }

    /// The resize handle of the selected node in `selected` within `HANDLE_REACH` screen pixels
    /// of `point` on each axis, the nearest of them, where a screen pixel is `pixel` world units;
    /// none at the far level, for a node that is not resizable, or for a slot that holds none
    /// (REN-node-content-and-hits, *Resize handle*). A press there comes before every other hit.
    pub fn handle_at(
        &self,
        point: Point,
        pixel: f64,
        level: Level,
        selected: u32,
    ) -> Option<Handle> {
        if level == Level::Far || !self.holds_node(selected) || !self.is_resizable(selected) {
            return None;
        }
        let reach = HANDLE_REACH * bounded_pixel(pixel);
        let bounds = self.node_bounds(selected);
        Handle::ALL
            .into_iter()
            .map(|handle| {
                let [x, y] = handle.at(&bounds);
                (handle, (x - point.x).abs().max((y - point.y).abs()))
            })
            .filter(|&(_, d)| d <= reach)
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(handle, _)| handle)
    }

    /// The label whose measured pill holds `point`, of the edge in the highest slot, and of its
    /// labels the last in its list, as its edge slot and its place there
    /// (REN-node-content-in-rows).
    fn label_at(&mut self, point: Point) -> Option<(u32, u32)> {
        if self.widest_pill <= 0.0 {
            return None;
        }
        self.edge_grid
            .candidates(&Rect::at(point).grown(self.widest_pill), &mut self.scratch);
        let mut found = None;
        for &slot in &self.scratch {
            let i = slot as usize;
            for (index, (at, pill)) in (0_u32..).zip(self.labels[i].iter().zip(&self.pills[i])) {
                let Some((half_width, half_height)) = *pill else {
                    continue;
                };
                if (point.x - at.x).abs() <= half_width && (point.y - at.y).abs() <= half_height {
                    found = found.max(Some((slot, index)));
                }
            }
        }
        found
    }

    /// The connector within `reach` of `point`: of the nodes with one there, the one drawn on top,
    /// and of its connectors the nearest. Within the node's outline a connector reaches at most a
    /// quarter of the node's extent across its side, its height for the top and the bottom, its
    /// width for the right and the left, so that the middle half of a node is the node's however
    /// thin it is on screen; beside the outline, within its rectangle too, the whole reach
    /// (REN-node-content-in-rows, REN-closed-set-of-node-shapes).
    fn connector_at(&mut self, point: Point, reach: f64) -> Option<(u32, Side)> {
        self.node_grid
            .candidates(&Rect::at(point).grown(reach), &mut self.scratch);
        let mut best: Option<(u32, Side, f64)> = None;
        for &slot in &self.scratch {
            // A region has no connectors: no edge ends on it.
            if self.is_region(slot) {
                continue;
            }
            let bounds = self.node_bounds(slot);
            if !bounds.grown(reach).contains(point) {
                continue;
            }
            let inside = self.within_outline(slot, point);
            let near = SIDES
                .iter()
                .map(|&side| {
                    let c = side.connector(&bounds);
                    (side, length(c.x - point.x, c.y - point.y))
                })
                .filter(|&(side, d)| {
                    let across = match side {
                        Side::Top | Side::Bottom => bounds.max_y - bounds.min_y,
                        Side::Right | Side::Left => bounds.max_x - bounds.min_x,
                    };
                    d <= if inside {
                        reach.min(across / 4.0)
                    } else {
                        reach
                    }
                })
                .min_by(|a, b| a.1.total_cmp(&b.1));
            if let Some((side, d)) = near {
                let above =
                    best.is_none_or(|(other, _, _)| self.draw_key(slot) > self.draw_key(other));
                if above {
                    best = Some((slot, side, d));
                }
            }
        }
        best.map(|(slot, side, _)| (slot, side))
    }

    /// The node at `point`: of the nodes whose outline holds it, the one drawn on top, a node
    /// that is no container before every container, the others by rank and containers by their
    /// order (ARCH-engine-edits-nested-graph, REN-closed-set-of-node-shapes).
    pub(super) fn node_at(&mut self, point: Point) -> Option<u32> {
        self.node_grid
            .candidates(&Rect::at(point), &mut self.scratch);
        self.scratch
            .iter()
            .copied()
            .filter(|&slot| self.within_outline(slot, point))
            .max_by_key(|&slot| self.draw_key(slot))
    }
}

impl Graph {
    /// Whether `point` lies within the outline of the node in `slot`: within its rectangle, and
    /// within its node shape there.
    pub(super) fn within_outline(&self, slot: u32, point: Point) -> bool {
        let bounds = self.node_bounds(slot);
        bounds.contains(point)
            && self.shape(slot).contains(
                bounds.max_x - bounds.min_x,
                bounds.max_y - bounds.min_y,
                point.x - bounds.min_x,
                point.y - bounds.min_y,
            )
    }
}

#[cfg(test)]
mod tests {
    use super::super::LabelPlacement;
    use super::super::tests::{Lcg, Model, random_inputs};
    use super::*;
    use crate::geometry::{EdgePath, PIXEL_LIMIT};
    use crate::graph::End;

    #[test]
    fn a_pixel_beyond_any_zoom_hits_as_the_largest_a_query_strokes_for() {
        // Verifies: ARCH-one-workspace-per-example
        // Two nodes near the world's limit, an edge between them, and presses near them and twice
        // that far away: an unbounded pixel would reach everything from anywhere.
        let edges = vec![super::super::EdgeSpec {
            sides: crate::geometry::Sides::default(),
            source: End::Node(0),
            target: End::Node(1),
            labels: Vec::new(),
            style: crate::stroke::EdgeStyle::unstyled(),
        }];
        let positions = vec![1e36, 0.0, 1e36, 1e35];
        let sizes = vec![220.0, 64.0, 220.0, 64.0];
        let mut graph = Graph::new(positions, sizes, edges).unwrap();
        let near = Point::new(1e36 - 1e34, 32.0);
        let far = Point::new(-1e36, 0.0);
        for (point, connectors, level) in [
            (near, true, Level::Near),
            (far, true, Level::Near),
            (far, false, Level::Middle),
            (far, false, Level::Far),
        ] {
            let largest = graph.hit_at(point, PIXEL_LIMIT, level, connectors);
            let beyond = graph.hit_at(point, 1e308, level, connectors);
            assert_eq!(beyond, largest, "{point:?}, {level:?}");
        }
        assert!(matches!(
            graph.hit_at(near, 1e308, Level::Near, true),
            Some(Target::Connector(..))
        ));
        assert_eq!(graph.hit_at(far, 1e308, Level::Middle, false), None);
        assert!(bounded_pixel(1e308) * CONNECTOR_REACH < f64::MAX);
    }

    #[test]
    fn a_resize_handle_of_the_selected_resizable_node_is_hit_near_and_middle_and_no_other() {
        // Verifies: REN-node-content-and-hits
        // A node at the origin, 100 × 8, the thinnest a resize leaves, and one beside it.
        let positions = vec![0.0, 0.0, 300.0, 0.0];
        let sizes = vec![100.0, 8.0, 100.0, 60.0];
        let mut graph = Graph::new(positions, sizes, Vec::new()).unwrap();
        let at = |graph: &Graph, x: f64, y: f64, level: Level, selected: u32| {
            graph.handle_at(Point::new(x, y), 2.0, level, selected)
        };
        // Not resizable: no handle, whatever is pressed.
        assert_eq!(at(&graph, 0.0, 0.0, Level::Near, 0), None);
        graph.set_sizing(0, None, true).unwrap();
        // Each handle at its point and within 6 screen pixels, 12 world units at a pixel of 2.
        let corners = [
            (0.0, 0.0, Handle::TopLeft),
            (50.0, 0.0, Handle::Top),
            (100.0, 0.0, Handle::TopRight),
            (100.0, 8.0, Handle::BottomRight),
            (50.0, 8.0, Handle::Bottom),
            (0.0, 8.0, Handle::BottomLeft),
        ];
        for level in [Level::Near, Level::Middle] {
            for (x, y, handle) in corners {
                assert_eq!(at(&graph, x, y, level, 0), Some(handle), "{handle:?}");
            }
            assert_eq!(at(&graph, -11.0, -11.0, level, 0), Some(Handle::TopLeft));
            assert_eq!(at(&graph, -13.0, 0.0, level, 0), None);
            // In the middle of a side of a node so thin, the nearest handle wins: the bottom's.
            assert_eq!(at(&graph, 50.0, 5.0, level, 0), Some(Handle::Bottom));
            assert_eq!(at(&graph, 101.0, 4.0, level, 0), Some(Handle::Right));
        }
        // None at the far level, of another node, or of a slot that holds none.
        assert_eq!(at(&graph, 0.0, 0.0, Level::Far, 0), None);
        assert_eq!(at(&graph, 300.0, 0.0, Level::Near, 1), None);
        assert_eq!(at(&graph, 0.0, 0.0, Level::Near, 9), None);
    }

    #[test]
    fn the_side_handles_of_a_taller_node_stand_at_its_sides_middles_and_a_slot_taken_again_has_none()
     {
        // Verifies: REN-node-content-and-hits
        let positions = vec![0.0, 0.0, 300.0, 0.0];
        let sizes = vec![100.0, 8.0, 100.0, 60.0];
        let mut graph = Graph::new(positions, sizes, Vec::new()).unwrap();
        let at =
            |graph: &Graph, x: f64, y: f64| graph.handle_at(Point::new(x, y), 2.0, Level::Near, 1);
        graph.set_sizing(1, None, true).unwrap();
        assert_eq!(at(&graph, 300.0, 30.0), Some(Handle::Left));
        assert_eq!(at(&graph, 400.0, 30.0), Some(Handle::Right));
        // A slot freed and taken again is no longer resizable.
        graph.remove_nodes(&[1]).unwrap();
        assert_eq!(graph.add_node(300.0, 0.0, 100.0, 60.0), Ok(1));
        assert!(!graph.is_resizable(1));
    }

    #[test]
    fn a_node_is_hit_within_its_node_shape_and_a_press_beside_its_outline_finds_what_lies_below() {
        // Verifies: REN-closed-set-of-node-shapes
        // A rectangle below and a diamond above it, both at the origin, 100 × 60, and a node away
        // from the origin given a node shape, at the middle level, where no connector is hit.
        let positions = vec![0.0, 0.0, 0.0, 0.0, 1e6, 1e6];
        let sizes = vec![100.0, 60.0, 100.0, 60.0, 100.0, 60.0];
        let mut graph = Graph::new(positions, sizes, Vec::new()).unwrap();
        graph
            .set_shape(1, crate::shape::NodeShape::Diamond)
            .unwrap();
        graph
            .set_shape(2, crate::shape::NodeShape::Ellipse)
            .unwrap();
        let at = |graph: &mut Graph, x: f64, y: f64| {
            graph.hit_at(Point::new(x, y), 1.0, Level::Middle, false)
        };
        // Within the diamond: the diamond, which lies above.
        assert_eq!(at(&mut graph, 50.0, 30.0), Some(Target::Node(1)));
        // In the diamond's corner, beside its outline: the rectangle below.
        assert_eq!(at(&mut graph, 5.0, 5.0), Some(Target::Node(0)));
        // Away from the origin, the ellipse is hit at its centre and not at its rectangle's corner.
        assert_eq!(
            at(&mut graph, 1e6 + 50.0, 1e6 + 30.0),
            Some(Target::Node(2))
        );
        assert_eq!(at(&mut graph, 1e6 + 1.0, 1e6 + 1.0), None);
        // A node shape set on a slot that holds no node is refused.
        assert!(graph.set_shape(7, crate::shape::NodeShape::Circle).is_err());
        // A node added into a slot keeps no node shape of before: a rectangle.
        assert_eq!(graph.shape(1), crate::shape::NodeShape::Diamond);
        graph.remove_nodes(&[1]).unwrap();
        let slot = graph.add_node(0.0, 0.0, 100.0, 60.0).unwrap();
        assert_eq!(slot, 1);
        assert_eq!(graph.shape(1), crate::shape::NodeShape::Rectangle);
    }

    #[test]
    fn a_pentagon_without_an_outline_is_hit_within_its_outline_and_beyond_its_point_finds_what_lies_below()
     {
        // Verifies: REN-node-shapes-cover-uml
        // A rectangle below and a pentagon above it, both 220 × 64 and far from the origin, the
        // pentagon's outline left out; at the near and the middle level, without connectors.
        use crate::shape::{NodeShape, Outline};
        let positions = vec![5e6, 5e6, 5e6, 5e6];
        let sizes = vec![220.0, 64.0, 220.0, 64.0];
        let mut graph = Graph::new(positions, sizes, Vec::new()).unwrap();
        graph.set_shape(1, NodeShape::Pentagon).unwrap();
        graph.set_outline(1, Outline::None).unwrap();
        assert_eq!(graph.outline(1), Outline::None);
        for level in [Level::Near, Level::Middle] {
            let mut at =
                |x: f64, y: f64| graph.hit_at(Point::new(5e6 + x, 5e6 + y), 1.0, level, false);
            // Within the outline it leaves out: the pentagon, which lies above.
            assert_eq!(at(100.0, 32.0), Some(Target::Node(1)));
            assert_eq!(at(215.0, 32.0), Some(Target::Node(1)));
            // Beyond its point, inside its bounding rectangle: the rectangle below.
            assert_eq!(at(215.0, 4.0), Some(Target::Node(0)));
            assert_eq!(at(215.0, 60.0), Some(Target::Node(0)));
        }
        // An outline set on a slot that holds no node is refused, and a slot taken again forgets
        // the outline of the node it held.
        assert!(graph.set_outline(7, Outline::Dashed([6.0, 4.0])).is_err());
        graph.remove_nodes(&[1]).unwrap();
        assert_eq!(graph.add_node(0.0, 0.0, 100.0, 60.0), Ok(1));
        assert_eq!(graph.outline(1), Outline::Solid);
    }

    #[test]
    fn a_hit_finds_the_topmost_node_a_scan_finds_before_and_after_moves() {
        let mut rng = Lcg(7);
        let (mut model, mut graph) = Model::random(&mut rng, 300, 0);
        let scan =
            |model: &Model, p: Point| model.nodes().filter(|&s| model.bounds(s).contains(p)).max();
        for round in 0..2 {
            for _ in 0..500 {
                let p = Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0));
                assert_eq!(graph.node_at(p), scan(&model, p), "{p:?} in round {round}");
            }
            for _ in 0..40 {
                let moved = [rng.below(300)];
                let (dx, dy) = (rng.range(-3000.0, 3000.0), rng.range(-3000.0, 3000.0));
                graph.translate(&moved, dx as f32, dy as f32).unwrap();
                model.translate(&moved, dx as f32, dy as f32);
            }
        }
        // Every hit lies inside a node, so random points find some.
        let found = (0..500)
            .filter(|_| {
                let p = Point::new(rng.range(-2000.0, 2000.0), rng.range(-2000.0, 2000.0));
                scan(&model, p).is_some()
            })
            .count();
        assert!(found > 0);
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

    /// `distance_to_curve` of the edge `e` of `model` as it is drawn: a lightning bolt's middle
    /// is its zigzag, whose segments' distance is exact (API-edges-dock-nodes-or-edges).
    fn distance_to_drawn(model: &Model, e: u32, p: Point) -> (f64, f64) {
        let path = model.path(e);
        if !model.specs[e as usize].style.lightning {
            return distance_to_curve(&path, p);
        }
        let (before, [a, b], after) = path.lightning();
        let zigzag = [before.target, a, b, after.source]
            .windows(2)
            .map(|s| crate::stroke::distance_to_segment(p, s[0], s[1]))
            .fold(f64::INFINITY, f64::min);
        let (one, other) = (distance_to_curve(&before, p), distance_to_curve(&after, p));
        (
            one.0.min(other.0).min(zigzag),
            one.1.min(other.1).min(zigzag),
        )
    }

    #[test]
    fn a_hit_finds_a_node_before_an_edge_and_an_edge_only_near_its_flattened_path() {
        // Verifies: REN-node-content-in-rows
        for seed in 1..=4 {
            let mut rng = Lcg(seed);
            let (mut model, mut graph) = Model::random(&mut rng, 30, 40);
            // A free slot now and then too, which no hit may return; a press near its old path
            // finds what lies there besides.
            graph.remove_edges(&[3, 17, 29]).unwrap();
            model.remove_edges(&[3, 17, 29]);
            for _ in 0..300 {
                let level = [Level::Near, Level::Middle, Level::Far][rng.below(3) as usize];
                let pixel = [0.25, 1.0, 4.0, 20.0][rng.below(4) as usize];
                // Near a point of a random edge, now and then anywhere.
                let p = if rng.next() < 0.8 {
                    let edge = rng.below(model.specs.len());
                    let on = model.path(edge).point_at(rng.next());
                    let off = 8.0 * pixel;
                    Point::new(on.x + rng.range(-off, off), on.y + rng.range(-off, off))
                } else {
                    Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0))
                };
                let node = model.nodes().filter(|&n| model.bounds(n).contains(p)).max();
                let hit = graph.hit_at(p, pixel, level, false);
                if let Some(slot) = node {
                    assert_eq!(hit, Some(Target::Node(slot)), "a node before any edge");
                    continue;
                }
                // Within the reach less the flattening's tolerance an edge is surely hit, beyond it
                // plus the tolerance surely not; between, either is right.
                let (reach, tolerance) = (EDGE_REACH * pixel, Stroke::at(level, pixel).tolerance);
                let d: Vec<(f64, f64)> = (0..model.specs.len() as u32)
                    .map(|e| distance_to_drawn(&model, e, p))
                    .collect();
                // Surely hit by its upper bound, surely too far by its lower one.
                let sure = model
                    .edges()
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .find(|&e| d[e as usize].1 < reach - tolerance);
                match hit {
                    Some(Target::Edge(e)) => {
                        assert!(!model.free_edges[e as usize], "free edge {e}");
                        assert!(d[e as usize].0 <= reach + tolerance, "edge {e} too far");
                        assert!(sure.is_none_or(|s| e >= s), "edge {e} below {sure:?}");
                    }
                    None => assert_eq!(sure, None, "missed at {p:?}"),
                    Some(
                        Target::Node(_)
                        | Target::Connector(..)
                        | Target::Label(_, _)
                        | Target::Line(_),
                    ) => {
                        panic!("{hit:?} where a scan finds none")
                    }
                }
            }
        }
    }

    #[test]
    fn a_hit_finds_a_connector_before_a_node_as_a_scan_finds_and_none_at_the_far_level() {
        // Verifies: REN-node-content-in-rows, API-edges-dock-side-or-outline
        for seed in 1..=6 {
            let mut rng = Lcg(seed);
            let (mut model, mut graph) = Model::random(&mut rng, 40, 20);
            graph.remove_nodes(&[5]).unwrap();
            model.remove_nodes(&[5]);
            // Every node shape, so that the reach is clipped by outlines that leave corners of
            // their rectangles as well as by rectangles.
            for node in model.nodes().collect::<Vec<_>>() {
                let shape = crate::shape::NodeShape::ALL
                    [rng.below(crate::shape::NodeShape::ALL.len()) as usize];
                graph.set_shape(node, shape).unwrap();
                model.shapes[node as usize] = shape;
            }
            for _ in 0..400 {
                let level = [Level::Near, Level::Middle, Level::Far][rng.below(3) as usize];
                let pixel = [0.25, 1.0, 4.0][rng.below(3) as usize];
                let reach = CONNECTOR_REACH * pixel;
                // Near a connector of a random node, now and then anywhere.
                let p = if rng.next() < 0.8 {
                    let node = rng.below(model.free_nodes.len());
                    let side = SIDES[rng.below(4) as usize];
                    let c = side.connector(&model.bounds(node));
                    let off = 1.5 * reach;
                    Point::new(c.x + rng.range(-off, off), c.y + rng.range(-off, off))
                } else {
                    Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0))
                };
                // The scan: of the nodes in use with a connector within the reach, clipped within
                // the node's outline, the one of the highest rank, the highest slot, and its
                // nearest connector.
                let scan = model.connector_at(p, reach);
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

    /// Thin nodes and a large one beside them, far apart: a bar of the shaped graph, 220 wide and
    /// `BAR_HEIGHT` high; a node as thin the other way; a node 6 by 6; and a node 220 by 64, the
    /// metric tree's. Each by its slot and rectangle.
    fn thin_nodes() -> (Graph, Vec<(u32, Rect)>) {
        use crate::shape::{BAR_HEIGHT, NodeShape};
        let bar = BAR_HEIGHT as f32;
        let positions = vec![0.0, 0.0, 1000.0, 0.0, 0.0, 1000.0, 1000.0, 1000.0];
        let sizes = vec![220.0, bar, bar, 220.0, 6.0, 6.0, 220.0, 64.0];
        let mut graph = Graph::new(positions, sizes, Vec::new()).unwrap();
        graph.set_shape(0, NodeShape::Bar).unwrap();
        let nodes = (0..4).map(|slot| (slot, graph.node_bounds(slot))).collect();
        (graph, nodes)
    }

    /// The scales of the near level's beginning and of the middle level's, and pixels beyond, as
    /// the size of a screen pixel in world units.
    const THIN_PIXELS: [f64; 4] = [1.0 / 0.6, 1.0 / 0.3, 4.0, 1.0 / 0.15];

    #[test]
    fn a_press_in_the_middle_half_of_a_thin_node_hits_the_node_at_the_near_and_middle_level() {
        // Verifies: REN-node-content-in-rows, G-5
        let (mut graph, nodes) = thin_nodes();
        for (slot, bounds) in nodes {
            let (width, height) = (bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y);
            for pixel in THIN_PIXELS {
                for level in [Level::Near, Level::Middle] {
                    for i in 0..=10 {
                        for j in 0..=10 {
                            // From just past a quarter of the node to just short of three.
                            let (fx, fy) =
                                (0.26 + 0.048 * f64::from(i), 0.26 + 0.048 * f64::from(j));
                            let p =
                                Point::new(bounds.min_x + fx * width, bounds.min_y + fy * height);
                            let hit = graph.hit_at(p, pixel, level, true);
                            assert_eq!(
                                hit,
                                Some(Target::Node(slot)),
                                "{p:?} of node {slot}, pixel {pixel}, {level:?}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn each_connector_of_a_thin_node_is_hit_at_its_point_and_within_its_reach_outside_it() {
        // Verifies: REN-node-content-in-rows, G-3
        let (mut graph, nodes) = thin_nodes();
        let outward = |side: Side| match side {
            Side::Top => (0.0, -1.0),
            Side::Right => (1.0, 0.0),
            Side::Bottom => (0.0, 1.0),
            Side::Left => (-1.0, 0.0),
        };
        for (slot, bounds) in nodes {
            let (width, height) = (bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y);
            for pixel in THIN_PIXELS {
                let reach = CONNECTOR_REACH * pixel;
                for level in [Level::Near, Level::Middle] {
                    for side in SIDES {
                        let c = side.connector(&bounds);
                        let (ox, oy) = outward(side);
                        let across = match side {
                            Side::Top | Side::Bottom => height,
                            Side::Right | Side::Left => width,
                        };
                        let quarter = reach.min(across / 4.0);
                        let at = |d: f64| Point::new(c.x + ox * d, c.y + oy * d);
                        // At its point, outside the node within the reach, and inside the node
                        // within a quarter of it: the connector.
                        for d in [0.0, 0.5 * reach, 0.99 * reach, -0.99 * quarter] {
                            assert_eq!(
                                graph.hit_at(at(d), pixel, level, true),
                                Some(Target::Connector(slot, side)),
                                "{side:?} of node {slot} at {d}, pixel {pixel}, {level:?}"
                            );
                        }
                        // Inside the node beyond a quarter of it, within the reach: the node.
                        if quarter < reach {
                            let d = -(quarter + 0.01 * (reach - quarter).min(across / 4.0));
                            assert_eq!(
                                graph.hit_at(at(d), pixel, level, true),
                                Some(Target::Node(slot)),
                                "{side:?} of node {slot} at {d}, pixel {pixel}, {level:?}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn a_small_shaped_node_pressed_beside_its_outline_within_its_rectangle_hits_its_connector() {
        // Verifies: REN-node-content-in-rows, REN-closed-set-of-node-shapes
        // Verifies: REN-node-shapes-cover-uml
        // Nodes under 32 screen pixels whose outline leaves corners of their rectangle, alone, so
        // that a press beside the outline finds nothing below: there a connector reaches its 8
        // pixels, unclipped by the rectangle, and beyond them nothing is hit.
        use crate::shape::NodeShape;
        let cases = [
            (NodeShape::Circle, 20.0, 20.0),
            (NodeShape::Circle, 31.0, 31.0),
            (NodeShape::RingedCircle, 24.0, 24.0),
            (NodeShape::CrossedCircle, 12.0, 12.0),
            (NodeShape::CrossedCircle, 24.0, 24.0),
            (NodeShape::Ellipse, 28.0, 16.0),
            (NodeShape::Ellipse, 12.0, 30.0),
            (NodeShape::Diamond, 24.0, 24.0),
            (NodeShape::Diamond, 30.0, 14.0),
            (NodeShape::RoundedRectangle, 10.0, 16.0),
            (NodeShape::RoundedRectangle, 16.0, 10.0),
        ];
        for (shape, screen_width, screen_height) in cases {
            for pixel in [0.25, 1.0, 4.0] {
                let (width, height) = (screen_width * pixel, screen_height * pixel);
                let sizes = vec![width as f32, height as f32];
                let mut graph = Graph::new(vec![0.0, 0.0], sizes, Vec::new()).unwrap();
                graph.set_shape(0, shape).unwrap();
                let bounds = graph.node_bounds(0);
                let (width, height) = (bounds.max_x - bounds.min_x, bounds.max_y - bounds.min_y);
                let reach = CONNECTOR_REACH * pixel;
                // Presses beside the outline beyond a quarter of the node from the connector,
                // within its reach, where the rectangle's clip found nothing.
                let mut beyond_a_quarter = 0;
                for i in 0..=40 {
                    for j in 0..=40 {
                        let (x, y) = (width * f64::from(i) / 40.0, height * f64::from(j) / 40.0);
                        if shape.contains(width, height, x, y) {
                            continue;
                        }
                        let p = Point::new(bounds.min_x + x, bounds.min_y + y);
                        let distances = SIDES.map(|side| {
                            let c = side.connector(&bounds);
                            (side, length(c.x - p.x, c.y - p.y))
                        });
                        let nearest = distances.iter().map(|d| d.1).fold(f64::MAX, f64::min);
                        let at = format!("{shape:?} {width} × {height} at {p:?}, pixel {pixel}");
                        for level in [Level::Near, Level::Middle] {
                            let hit = graph.hit_at(p, pixel, level, true);
                            if nearest > reach {
                                assert_eq!(hit, None, "{at}, {level:?}");
                                continue;
                            }
                            let Some(Target::Connector(0, side)) = hit else {
                                panic!("{hit:?} where a connector reaches, {at}, {level:?}");
                            };
                            let d = distances.iter().find(|d| d.0 == side).unwrap().1;
                            assert!(d <= nearest * (1.0 + 1e-9), "{side:?} not nearest, {at}");
                        }
                        let (side, d) = distances
                            .into_iter()
                            .min_by(|a, b| a.1.total_cmp(&b.1))
                            .unwrap();
                        let across = match side {
                            Side::Top | Side::Bottom => height,
                            Side::Right | Side::Left => width,
                        };
                        if across / 4.0 < d && d <= reach {
                            beyond_a_quarter += 1;
                        }
                    }
                }
                assert!(
                    beyond_a_quarter > 0,
                    "{shape:?} {width} × {height}, pixel {pixel}: no press beyond a quarter"
                );
            }
        }
    }

    #[test]
    fn a_node_at_least_32_screen_pixels_high_and_wide_hits_as_it_did_before_the_reach_was_clipped()
    {
        // Verifies: REN-node-content-in-rows
        for seed in 1..=4 {
            let mut rng = Lcg(200 + seed);
            for pixel in [0.25, 1.0, 4.0] {
                let reach = CONNECTOR_REACH * pixel;
                // Nodes from 32 screen pixels, now and then exactly 32, high and wide.
                let least = 4.0 * reach;
                let extent = |rng: &mut Lcg| match rng.next() < 0.2 {
                    true => least,
                    false => least + rng.range(0.0, 300.0),
                };
                let (mut positions, mut sizes) = (Vec::new(), Vec::new());
                for _ in 0..40 {
                    positions.extend([rng.range(-1500.0, 1500.0), rng.range(-1500.0, 1500.0)]);
                    sizes.extend([extent(&mut rng), extent(&mut rng)]);
                }
                let (positions, sizes): (Vec<f32>, Vec<f32>) = (
                    positions.iter().map(|&v| v as f32).collect(),
                    sizes.iter().map(|&v| v as f32).collect(),
                );
                let (model, mut graph) = Model::of(positions, sizes, Vec::new());
                // Of every node shape: from 32 pixels a quarter of the node is at least the reach,
                // so no clip binds, whatever the outline.
                for node in 0..40 {
                    let shape = crate::shape::NodeShape::ALL
                        [rng.below(crate::shape::NodeShape::ALL.len()) as usize];
                    graph.set_shape(node, shape).unwrap();
                }
                for _ in 0..400 {
                    let side = SIDES[rng.below(4) as usize];
                    let c = side.connector(&model.bounds(rng.below(40)));
                    let off = 1.5 * reach;
                    let p = Point::new(c.x + rng.range(-off, off), c.y + rng.range(-off, off));
                    // The hit of before: every connector within the reach, inside the node too.
                    let before = model
                        .nodes()
                        .filter_map(|n| {
                            let bounds = model.bounds(n);
                            SIDES
                                .iter()
                                .map(|&side| {
                                    let c = side.connector(&bounds);
                                    (n, side, (c.x - p.x).hypot(c.y - p.y))
                                })
                                .filter(|&(_, _, d)| d <= reach)
                                .min_by(|a, b| a.2.total_cmp(&b.2))
                        })
                        .max_by_key(|&(n, _, _)| n)
                        .map(|(n, side, _)| Target::Connector(n, side));
                    let level = [Level::Near, Level::Middle][rng.below(2) as usize];
                    let hit = graph.hit_at(p, pixel, level, true);
                    match before {
                        Some(target) => assert_eq!(hit, Some(target), "at {p:?}, pixel {pixel}"),
                        None => assert_eq!(hit, graph.hit_at(p, pixel, level, false), "at {p:?}"),
                    }
                }
            }
        }
    }

    /// What a scan of every kind finds at `p`, in the order of REN-node-content-in-rows, from the
    /// model alone: a connector where they are asked for, at the near and middle level; a measured
    /// label at the near level; a node; and an edge, which the flattening's tolerance blurs, given
    /// as the edge surely hit and the distance bounds of each.
    enum Scan {
        Exactly(Target),
        Edge {
            sure: Option<u32>,
            bounds: Vec<(f64, f64)>,
        },
    }

    fn scan(model: &Model, p: Point, pixel: f64, level: Level, connectors: bool) -> Scan {
        let connector = model.connector_at(p, CONNECTOR_REACH * pixel);
        if let Some((n, side, _)) = connector.filter(|_| connectors && level != Level::Far) {
            return Scan::Exactly(Target::Connector(n, side));
        }
        if let Some((e, i)) = model.label_at(p).filter(|_| level == Level::Near) {
            return Scan::Exactly(Target::Label(e, i));
        }
        if let Some(n) = model.nodes().filter(|&n| model.bounds(n).contains(p)).max() {
            return Scan::Exactly(Target::Node(n));
        }
        let (reach, tolerance) = (EDGE_REACH * pixel, Stroke::at(level, pixel).tolerance);
        let bounds: Vec<(f64, f64)> = (0..model.specs.len() as u32)
            .map(|e| distance_to_drawn(model, e, p))
            .collect();
        let sure = model
            .edges()
            .filter(|&e| bounds[e as usize].1 < reach - tolerance)
            .max();
        Scan::Edge { sure, bounds }
    }

    /// A random graph and its model with a node and an edge removed, the labels of two edges of
    /// three measured, and a few nodes moved after. Every fifth edge's first label sits where the
    /// edge leaves its source, on the connector there, so that a press there finds a connector and
    /// a label both.
    fn scanned_graph(rng: &mut Lcg) -> (Model, Graph) {
        let (positions, sizes, mut specs) = random_inputs(rng, 30, 40);
        for spec in specs.iter_mut().step_by(5) {
            let first = LabelPlacement {
                t: 0.0,
                offset: 0.0,
            };
            match spec.labels.first_mut() {
                Some(label) => *label = first,
                None => spec.labels.push(first),
            }
        }
        let (mut model, mut graph) = Model::of(positions, sizes, specs);
        graph.remove_nodes(&[4]).unwrap();
        model.remove_nodes(&[4]);
        let gone = model.edges().find(|&e| e >= 11).unwrap();
        graph.remove_edges(&[gone]).unwrap();
        model.remove_edges(&[gone]);
        for e in model.edges().filter(|e| e % 3 != 0).collect::<Vec<_>>() {
            for i in 0..model.specs[e as usize].labels.len() as u32 {
                let size = (15.0 + f64::from((e + i) % 4) * 10.0, 10.0);
                graph.set_label_size(e, i, size.0, size.1).unwrap();
                model.pills[e as usize][i as usize] = Some(size);
            }
        }
        for _ in 0..6 {
            let moved: Vec<u32> = model.nodes().filter(|_| rng.next() < 0.2).collect();
            let (dx, dy) = (rng.range(-300.0, 300.0), rng.range(-300.0, 300.0));
            graph.translate(&moved, dx as f32, dy as f32).unwrap();
            model.translate(&moved, dx as f32, dy as f32);
        }
        (model, graph)
    }

    /// A press near a connector, a label, or an edge of `model`, now and then anywhere, the
    /// cases taken from the model, not the graph.
    fn press_near(model: &Model, pixel: f64, rng: &mut Lcg) -> Point {
        let (nodes, edges) = (model.free_nodes.len(), model.specs.len());
        let around = |at: Point, (bx, by): (f64, f64), rng: &mut Lcg| {
            Point::new(at.x + rng.range(-bx, bx), at.y + rng.range(-by, by))
        };
        let anywhere = |rng: &mut Lcg| around(Point::new(0.0, 0.0), (2500.0, 2500.0), rng);
        match rng.below(5) {
            // At a connector of a node a measured label lies on, where both may be hit.
            4 => {
                let on: Vec<u32> = model
                    .edges()
                    .filter(|&e| model.pills[e as usize].first().is_some_and(Option::is_some))
                    .filter(|&e| {
                        model.specs[e as usize]
                            .labels
                            .first()
                            .is_some_and(|l| l.t == 0.0)
                    })
                    .collect();
                match on.is_empty() {
                    true => anywhere(rng),
                    false => around(
                        model.path(on[rng.below(on.len()) as usize]).source,
                        (pixel, pixel),
                        rng,
                    ),
                }
            }
            0 => {
                let side = SIDES[rng.below(4) as usize];
                let c = side.connector(&model.bounds(rng.below(nodes)));
                around(c, (12.0 * pixel, 12.0 * pixel), rng)
            }
            1 => match model.label_point(rng.below(edges), rng.below(3)) {
                Some(at) => around(at, (50.0, 12.0), rng),
                None => anywhere(rng),
            },
            2 => {
                let on = model.path(rng.below(edges)).point_at(rng.next());
                around(on, (8.0 * pixel, 8.0 * pixel), rng)
            }
            _ => anywhere(rng),
        }
    }

    /// Asserts that `hit` is what the scan `found` allows, and returns the kind it found:
    /// connector, label, node, or edge, as 0 to 3, or none.
    fn judged(
        model: &Model,
        hit: Option<Target>,
        found: Scan,
        stroke: (f64, Stroke),
        at: &str,
    ) -> Option<usize> {
        let kind = |target: Target| match target {
            Target::Connector(..) | Target::Line(_) => 0,
            Target::Label(_, _) => 1,
            Target::Node(_) => 2,
            Target::Edge(_) => 3,
        };
        match found {
            Scan::Exactly(target) => {
                assert_eq!(hit, Some(target), "{at}");
                Some(kind(target))
            }
            Scan::Edge { sure, bounds } => {
                let (reach, tolerance) = (EDGE_REACH * stroke.0, stroke.1.tolerance);
                match hit {
                    Some(Target::Edge(e)) => {
                        assert!(!model.free_edges[e as usize], "free edge {e}, {at}");
                        assert!(bounds[e as usize].0 <= reach + tolerance, "{at}");
                        assert!(sure.is_none_or(|s| e >= s), "{e} below {sure:?}, {at}");
                        Some(3)
                    }
                    None => {
                        assert_eq!(sure, None, "missed, {at}");
                        None
                    }
                    _ => panic!("{hit:?} where a scan finds none, {at}"),
                }
            }
        }
    }

    #[test]
    fn a_hit_finds_what_a_scan_of_every_kind_finds_in_the_order_connector_label_node_edge() {
        // Verifies: REN-node-content-in-rows
        // How often the scan found each kind, connector, label, node, and edge, so that none goes
        // untested.
        let mut found = [0; 4];
        // How often a press at the near level found a connector and a label both, where only the
        // order of the two decides.
        let mut both = 0;
        for seed in 1..=3 {
            let mut rng = Lcg(100 + seed);
            let (model, mut graph) = scanned_graph(&mut rng);
            for _ in 0..300 {
                let level = [Level::Near, Level::Middle, Level::Far][rng.below(3) as usize];
                let pixel = [0.25, 1.0, 4.0][rng.below(3) as usize];
                let p = press_near(&model, pixel, &mut rng);
                if level == Level::Near
                    && matches!(
                        scan(&model, p, pixel, level, true),
                        Scan::Exactly(Target::Connector(..))
                    )
                    && matches!(
                        scan(&model, p, pixel, level, false),
                        Scan::Exactly(Target::Label(_, _))
                    )
                {
                    both += 1;
                }
                for connectors in [false, true] {
                    let hit = graph.hit_at(p, pixel, level, connectors);
                    let at = format!("{p:?}, {pixel}, {level:?}, connectors {connectors}");
                    let scanned = scan(&model, p, pixel, level, connectors);
                    let stroke = (pixel, Stroke::at(level, pixel));
                    if let Some(kind) = judged(&model, hit, scanned, stroke, &at) {
                        found[kind] += 1;
                    }
                }
            }
        }
        assert!(found.iter().all(|&n| n > 20), "{found:?}");
        assert!(
            both > 20,
            "{both} presses where a connector and a label lie both"
        );
    }

    #[test]
    fn a_hit_at_the_near_level_finds_a_measured_label_inside_its_pill_before_a_node() {
        // Verifies: REN-node-content-in-rows
        let mut rng = Lcg(9);
        let (mut model, mut graph) = Model::random(&mut rng, 30, 60);
        let measured: Vec<u32> = (0..60).filter(|e| e % 3 != 0).collect();
        for &edge in &measured {
            for i in 0..model.specs[edge as usize].labels.len() as u32 {
                let size = (20.0 + f64::from((edge + i) % 5) * 10.0, 11.0);
                graph.set_label_size(edge, i, size.0, size.1).unwrap();
                model.pills[edge as usize][i as usize] = Some(size);
            }
        }
        for _ in 0..2_000 {
            let p = Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0));
            let p = if rng.next() < 0.7 {
                let edge = rng.below(model.specs.len());
                match model.label_point(edge, rng.below(3)) {
                    Some(at) => {
                        Point::new(at.x + rng.range(-70.0, 70.0), at.y + rng.range(-15.0, 15.0))
                    }
                    None => p,
                }
            } else {
                p
            };
            let scan = model.label_at(p);
            let near = graph.hit_at(p, 1.0, Level::Near, false);
            match scan {
                Some((e, i)) => assert_eq!(near, Some(Target::Label(e, i)), "at {p:?}"),
                None => assert!(!matches!(near, Some(Target::Label(_, _))), "at {p:?}"),
            }
            assert!(!matches!(
                graph.hit_at(p, 1.0, Level::Middle, false),
                Some(Target::Label(_, _))
            ));
        }
        // An edge removed takes its label's measure along; a new edge in its slot is unmeasured.
        let edge = measured[0];
        graph.remove_edges(&[edge]).unwrap();
        assert!(graph.pills[edge as usize].is_empty());
    }
}
