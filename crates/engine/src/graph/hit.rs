//! The hit test (ADR-0025): what a press at a point hits, a connector before an edge label, a
//! node, and an edge.

use super::{Graph, Level};
use crate::geometry::{Point, Rect, Side, bounded_pixel};
use crate::stroke::{Stroke, near_path};

/// The four sides, each with a connector.
const SIDES: [Side; 4] = [Side::Top, Side::Right, Side::Bottom, Side::Left];

/// How near a press has to come to an edge's path to hit it, in screen pixels (ADR-0025).
const EDGE_REACH: f64 = 4.0;

/// How near a press has to come to a connector to hit it, in screen pixels (ADR-0025).
const CONNECTOR_REACH: f64 = 8.0;

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

impl Graph {
    /// What a press at `point` hits where a screen pixel is `pixel` world units, at `level`: where
    /// `connectors` asks for them, at the near and middle level, a connector within
    /// `CONNECTOR_REACH` screen pixels, of the node of the highest rank; else at the near level a
    /// label whose measured pill holds it, of the highest edge slot; else a node whose bounds hold
    /// it, the one of the highest rank; else an edge within `EDGE_REACH` screen pixels of its path
    /// as the stroke of `level` flattens it, the one in the highest slot; else nothing (ADR-0025).
    /// A pixel beyond any zoom hits as the largest a query strokes for.
    pub fn hit_at(
        &mut self,
        point: Point,
        pixel: f64,
        level: Level,
        connectors: bool,
    ) -> Option<Target> {
        let pixel = bounded_pixel(pixel);
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
        if let Some(slot) = self.node_at(point) {
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
    pub(super) fn node_at(&mut self, point: Point) -> Option<u32> {
        self.node_grid
            .candidates(&Rect::at(point), &mut self.scratch);
        self.scratch
            .iter()
            .copied()
            .filter(|&slot| self.node_bounds(slot).contains(point))
            .max_by_key(|&slot| self.ranks[slot as usize])
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{Lcg, random_graph};
    use super::*;
    use crate::geometry::{EdgePath, PIXEL_LIMIT};

    #[test]
    fn a_pixel_beyond_any_zoom_hits_as_the_largest_a_query_strokes_for() {
        // Verifies: ADR-0028
        // Two nodes near the world's limit, an edge between them, and presses near them and twice
        // that far away: an unbounded pixel would reach everything from anywhere.
        let edges = vec![super::super::EdgeSpec {
            sides: crate::geometry::Sides::default(),
            source: 0,
            target: 1,
            label: None,
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
    fn a_hit_finds_the_topmost_node_a_scan_finds_before_and_after_moves() {
        let mut rng = Lcg(7);
        let mut graph = random_graph(&mut rng, 300, 0);
        let scan = |graph: &Graph, p: Point| {
            (0..graph.node_slots.count())
                .filter(|&s| graph.node_bounds(s).contains(p))
                .max()
        };
        for round in 0..2 {
            for _ in 0..500 {
                let p = Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0));
                assert_eq!(graph.node_at(p), scan(&graph, p), "{p:?} in round {round}");
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
                graph.node_at(p).is_some()
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
                    let edge = rng.below(graph.edge_slots.count() as usize) as usize;
                    let on = graph.paths[edge].point_at(rng.next());
                    let off = 8.0 * pixel;
                    Point::new(on.x + rng.range(-off, off), on.y + rng.range(-off, off))
                } else {
                    Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0))
                };
                let node = graph.node_at(p);
                let hit = graph.hit_at(p, pixel, level, false);
                if let Some(slot) = node {
                    assert_eq!(hit, Some(Target::Node(slot)), "a node before any edge");
                    continue;
                }
                // Within the reach less the flattening's tolerance an edge is surely hit, beyond it
                // plus the tolerance surely not; between, either is right.
                let (reach, tolerance) = (EDGE_REACH * pixel, Stroke::at(level, pixel).tolerance);
                let d: Vec<(f64, f64)> = (0..graph.edge_slots.count())
                    .map(|e| distance_to_curve(&graph.paths[e as usize], p))
                    .collect();
                // Surely hit by its upper bound, surely too far by its lower one.
                let sure = (0..graph.edge_slots.count())
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
                    let node = rng.below(graph.node_slots.count() as usize);
                    let side = SIDES[rng.below(4) as usize];
                    let c = side.connector(&graph.node_bounds(node));
                    let off = 1.5 * reach;
                    Point::new(c.x + rng.range(-off, off), c.y + rng.range(-off, off))
                } else {
                    Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0))
                };
                // The scan: of the nodes in use with a connector within the reach, the one of the
                // highest rank, and its nearest connector.
                let scan = (0..graph.node_slots.count())
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
    fn a_hit_at_the_near_level_finds_a_measured_label_inside_its_pill_before_a_node() {
        // Verifies: ADR-0025
        let mut rng = Lcg(9);
        let mut graph = random_graph(&mut rng, 30, 60);
        let measured: Vec<u32> = (0..graph.edge_slots.count())
            .filter(|e| e % 3 != 0)
            .collect();
        for &edge in &measured {
            graph
                .set_label_size(edge, 20.0 + f64::from(edge % 5) * 10.0, 11.0)
                .unwrap();
        }
        for _ in 0..2_000 {
            let p = Point::new(rng.range(-2500.0, 2500.0), rng.range(-2500.0, 2500.0));
            let p = if rng.next() < 0.7 {
                let edge = rng.below(graph.edge_slots.count() as usize);
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
}
