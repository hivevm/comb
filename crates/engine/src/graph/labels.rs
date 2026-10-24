//! The labels of the edges: the size of each label's pill as the shell measured it, the point of
//! a label, and the placement of a dragged one (ADR-0025, G-6).

use super::{Graph, LabelPlacement, SlotError};
use crate::geometry::{Point, WORLD_LIMIT};

impl Graph {
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
        // A label dragged to a point beyond the world's limit stops there, as a load would refuse
        // an offset beyond it.
        let offset = offset.clamp(-WORLD_LIMIT, WORLD_LIMIT);
        let placement = LabelPlacement { t, offset };
        self.edges[slot as usize].label = Some(placement);
        self.place_edge(slot);
        self.keep_index();
        Ok(placement)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{Lcg, random_graph};
    use super::super::{EdgeSpec, Level, Target, Visible};
    use super::*;
    use crate::geometry::{Rect, Sides};
    use crate::stroke::EdgeStyle;

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
            for edge in 0..graph.edge_slots.count() {
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
    fn a_label_measured_with_a_size_that_is_not_finite_and_positive_is_not_hit() {
        // Verifies: ADR-0025
        let mut rng = Lcg(11);
        let mut graph = random_graph(&mut rng, 10, 10);
        let edge = (0..graph.edge_slots.count())
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
        let edge = (0..graph.edge_slots.count())
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
}
