//! The labels of the edges: the size of each label's pill as the shell measured it, the point of
//! a label, and the placement of a dragged one (REN-node-content-in-rows, G-6). An edge carries a
//! list of labels, and each is named by its edge's slot and its place in that list
//! (API-edges-dock-nodes-or-edges, *Edge labels*).

use super::{Graph, LabelPlacement, SlotError};
use crate::geometry::{Point, WORLD_LIMIT};

impl Graph {
    /// Records the half width and half height of the pill of the label at `index` of the edge in
    /// `slot`, in world units, as the shell draws it; sizes that are not finite and positive leave
    /// it unmeasured. A slot that holds no edge with a label at `index` refuses it.
    pub fn set_label_size(
        &mut self,
        slot: u32,
        index: u32,
        half_width: f64,
        half_height: f64,
    ) -> Result<(), SlotError> {
        if self.label_point(slot, index).is_none() {
            return Err(SlotError::NoEdge { slot });
        }
        let measured = [half_width, half_height]
            .iter()
            .all(|size| size.is_finite() && *size > 0.0);
        self.pills[slot as usize][index as usize] = measured.then_some((half_width, half_height));
        if measured {
            self.widest_pill = self.widest_pill.max(half_width).max(half_height);
        }
        Ok(())
    }

    /// The point of the label at `index` of the edge in `slot`, where it holds an edge with a
    /// label there.
    pub fn label_point(&self, slot: u32, index: u32) -> Option<Point> {
        self.labels
            .get(slot as usize)
            .and_then(|points| points.get(index as usize))
            .copied()
            .filter(|_| self.holds_edge(slot))
    }

    /// Places the label at `index` of the edge in `slot` at `point`: at the path parameter nearest
    /// it and its distance along the normal there, which it returns, and moves it in the index
    /// (G-6); the edge's other labels stay. A slot that holds no edge with a label at `index`
    /// refuses it.
    pub fn move_label(
        &mut self,
        slot: u32,
        index: u32,
        point: Point,
    ) -> Result<LabelPlacement, SlotError> {
        if self.label_point(slot, index).is_none() {
            return Err(SlotError::NoEdge { slot });
        }
        let (t, offset) = self.paths[slot as usize].placement_at(point);
        // A label dragged to a point beyond the world's limit stops there, as a load would refuse
        // an offset beyond it.
        let offset = offset.clamp(-WORLD_LIMIT, WORLD_LIMIT);
        let placement = LabelPlacement { t, offset };
        self.edges[slot as usize].labels[index as usize] = placement;
        self.place_edge(slot);
        self.keep_index();
        Ok(placement)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{Lcg, Model};
    use super::super::{EdgeSpec, Level, Target, Visible};
    use super::*;
    use crate::geometry::{Rect, Sides};
    use crate::stroke::EdgeStyle;

    #[test]
    fn a_drag_moves_the_one_label_it_presses_and_a_query_and_a_hit_name_each_by_its_place() {
        // Verifies: API-edges-dock-nodes-or-edges, G-6
        // An association with a multiplicity near each end and a name in the middle: three labels
        // at 0.1, 0.5, and 0.9, the ends' 12 to the left of the path.
        let placed = |t, offset| LabelPlacement { t, offset };
        let labels = vec![placed(0.1, 12.0), placed(0.5, 0.0), placed(0.9, 12.0)];
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
            source: 0,
            target: 1,
            labels: labels.clone(),
            style: EdgeStyle::unstyled(),
        }];
        let sizes = vec![220.0, 64.0, 220.0, 64.0];
        let (mut model, mut graph) = Model::of(vec![0.0, 0.0, 500.0, 100.0], sizes, edges);
        let rect = Rect::new(-1000.0, -1000.0, 2000.0, 2000.0);
        let mut out = Visible::default();
        graph.query(&rect, Level::Near, 1.0, 0.0, &mut out);
        assert_eq!(out.labels, [0, 0, 0, 1, 0, 2]);
        for i in 0..3 {
            let at = model.label_point(0, i).unwrap();
            let drawn = (
                out.label_points[2 * i as usize],
                out.label_points[2 * i as usize + 1],
            );
            assert_eq!(drawn, (at.x as f32, at.y as f32), "label {i}");
            graph.set_label_size(0, i, 10.0, 8.0).unwrap();
            assert_eq!(
                graph.hit_at(at, 1.0, Level::Near, false),
                Some(Target::Label(0, i))
            );
        }
        // A drag of the label at the source end moves it alone.
        let from = model.label_point(0, 0).unwrap();
        let moved = graph
            .move_label(0, 0, Point::new(from.x + 30.0, from.y - 20.0))
            .unwrap();
        assert_eq!(graph.edge(0).unwrap().labels[1..], labels[1..]);
        assert_eq!(graph.edge(0).unwrap().labels[0], moved);
        model.specs[0].labels[0] = moved;
        // Each follows its edge as a node moves (G-6).
        graph.translate(&[1], 40.0, 200.0).unwrap();
        model.translate(&[1], 40.0, 200.0);
        for i in 0..3 {
            assert_eq!(
                graph.label_point(0, i),
                model.label_point(0, i),
                "label {i}"
            );
        }
        // No label past the list, and none of a free slot.
        assert_eq!(graph.label_point(0, 3), None);
        assert_eq!(
            graph.move_label(0, 3, from),
            Err(SlotError::NoEdge { slot: 0 })
        );
        assert_eq!(
            graph.set_label_size(0, 3, 10.0, 8.0),
            Err(SlotError::NoEdge { slot: 0 })
        );
        // A new list replaces the old one whole, its pills unmeasured.
        let one = vec![placed(0.5, 0.0)];
        graph
            .update_edge(0, one, EdgeStyle::unstyled(), Sides::default())
            .unwrap();
        assert_eq!(graph.label_point(0, 1), None);
        let at = graph.label_point(0, 0).unwrap();
        assert_eq!(
            graph.hit_at(at, 1.0, Level::Near, false),
            Some(Target::Edge(0))
        );
    }

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
            labels: vec![label],
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
            let (mut model, _) = Model::random(&mut rng, 30, 60);
            let all: Vec<u32> = (0..30).collect();
            model.translate(&all, far as f32, -far as f32);
            for edge in 0..60 {
                let path = model.path(edge);
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
    fn a_label_moved_to_where_it_lies_keeps_its_parameter_and_offset() {
        // Verifies: G-6
        let label = LabelPlacement {
            t: 0.4,
            offset: -25.0,
        };
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
            source: 0,
            target: 1,
            labels: vec![label],
            style: EdgeStyle::unstyled(),
        }];
        let sizes = vec![220.0, 64.0, 220.0, 64.0];
        let (model, mut graph) = Model::of(vec![0.0, 0.0, 300.0, 100.0], sizes, edges);
        let at = model.label_point(0, 0).unwrap();
        let moved = graph.move_label(0, 0, at).unwrap();
        assert!(
            (moved.t - label.t).abs() < 1e-6 && (moved.offset - label.offset).abs() < 1e-6,
            "{moved:?}"
        );
    }

    #[test]
    fn a_label_measured_with_a_size_that_is_not_finite_and_positive_is_not_hit() {
        // Verifies: REN-node-content-in-rows
        let mut rng = Lcg(11);
        let (model, mut graph) = Model::random(&mut rng, 10, 10);
        let edge = (0..10)
            .find(|&e| model.label_point(e, 0).is_some())
            .unwrap();
        let at = model.label_point(edge, 0).unwrap();
        let hit = |graph: &mut Graph| graph.hit_at(at, 1.0, Level::Near, false);
        assert_ne!(hit(&mut graph), Some(Target::Label(edge, 0)), "unmeasured");
        for (w, h) in [
            (0.0, 11.0),
            (-5.0, 11.0),
            (f64::NAN, 11.0),
            (20.0, f64::INFINITY),
        ] {
            graph.set_label_size(edge, 0, w, h).unwrap();
            assert_ne!(hit(&mut graph), Some(Target::Label(edge, 0)), "{w} by {h}");
        }
        graph.set_label_size(edge, 0, 20.0, 11.0).unwrap();
        assert_eq!(hit(&mut graph), Some(Target::Label(edge, 0)));
        graph.remove_edges(&[edge]).unwrap();
        assert_eq!(
            graph.set_label_size(edge, 0, 20.0, 11.0),
            Err(SlotError::NoEdge { slot: edge })
        );
    }

    #[test]
    fn a_moved_label_keeps_its_parameter_and_offset_when_a_node_of_its_edge_moves() {
        // Verifies: G-6
        let mut rng = Lcg(4);
        let (mut model, mut graph) = Model::random(&mut rng, 10, 10);
        let edge = (0..10)
            .find(|&e| {
                let spec = &model.specs[e as usize];
                model.label_point(e, 0).is_some() && spec.source != spec.target
            })
            .unwrap();
        let at = model.label_point(edge, 0).unwrap();
        let placement = graph
            .move_label(edge, 0, Point::new(at.x + 15.0, at.y - 25.0))
            .unwrap();
        assert_eq!(graph.edges[edge as usize].labels[0], placement);
        let source = model.specs[edge as usize].source;
        graph.translate(&[source], 120.0, 40.0).unwrap();
        model.translate(&[source], 120.0, 40.0);
        let moved = graph.label_point(edge, 0).unwrap();
        let expected = model
            .path(edge)
            .label_position(placement.t, placement.offset);
        assert_eq!(moved, expected);
        assert_eq!(
            graph.move_label(5_000, 0, at),
            Err(SlotError::NoEdge { slot: 5_000 })
        );
    }
}
