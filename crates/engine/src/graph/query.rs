//! The query: which node slots, edge slots, and edge labels a rectangle meets, at a level of
//! detail, and the mesh of the edges it found, written relative to an origin (ADR-0010,
//! ADR-0027).

use super::Graph;
use crate::geometry::{Point, Rect, bounded_pixel};
use crate::stroke::{MESH_BUDGET, Mesh, Stroke};

/// The level of detail a query serves (ADR-0027): near draws edge labels, middle does not, and
/// far draws edges as plain lines one pixel wide.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Near,
    Middle,
    Far,
}

/// What a query found: node slots in ascending rank, edge and label slots in ascending order, per
/// found label its
/// point, and the mesh of the found edges with its detail; the label points and the mesh's
/// positions relative to `origin` (ADR-0010).
#[derive(Debug, Default)]
pub struct Visible {
    pub nodes: Vec<u32>,
    pub edges: Vec<u32>,
    pub labels: Vec<u32>,
    pub label_points: Vec<f32>,
    pub mesh: Mesh,
    pub origin: Point,
}

/// The origin of a query in `rect` (ADR-0010): its centre snapped to a grid whose side is the
/// smallest power of two at least the rectangle's larger side, so that it stays across pans
/// shorter than that, and taken to the nearest `f32`, so that it holds exactly in both; (0, 0)
/// for a rectangle that is not finite or has no area to snap to.
pub(crate) fn origin_of(rect: &Rect) -> Point {
    let side = (rect.max_x - rect.min_x).max(rect.max_y - rect.min_y);
    let grid = side.log2().ceil().exp2();
    #[expect(
        clippy::cast_possible_truncation,
        reason = "taken to the nearest f32 on purpose, so that the origin holds exactly in both \
                  (ADR-0010); a centre beyond f32 turns infinite and falls back to (0, 0) below"
    )]
    let snap = |min: f64, max: f64| f64::from((((min + max) / 2.0 / grid).round() * grid) as f32);
    let origin = Point::new(snap(rect.min_x, rect.max_x), snap(rect.min_y, rect.max_y));
    if origin.x.is_finite() && origin.y.is_finite() {
        origin
    } else {
        Point::default()
    }
}

impl Graph {
    /// Writes into `out` the nodes and edges whose bounds meet `rect` and the mesh of the edges,
    /// stroked for `level` where a screen pixel is `pixel` world units, within the mesh budget
    /// (ADR-0027); at the near level also the labels whose point lies within `label_reach` of it,
    /// and at the others no label.
    pub fn query(
        &mut self,
        rect: &Rect,
        level: Level,
        pixel: f64,
        label_reach: f64,
        out: &mut Visible,
    ) {
        self.query_within(rect, level, pixel, label_reach, MESH_BUDGET, out);
    }

    /// `query` with a mesh of at most `budget` vertices.
    pub(super) fn query_within(
        &mut self,
        rect: &Rect,
        level: Level,
        pixel: f64,
        label_reach: f64,
        budget: u32,
        out: &mut Visible,
    ) {
        let pixel = bounded_pixel(pixel);
        let labelled = level == Level::Near;
        let label_rect = rect.grown(if labelled { label_reach.max(0.0) } else { 0.0 });
        self.node_grid.candidates(rect, &mut self.scratch);
        out.nodes.clear();
        out.nodes.extend(
            self.scratch
                .iter()
                .filter(|&&slot| self.node_bounds(slot).meets(rect)),
        );
        out.nodes
            .sort_unstable_by_key(|&slot| self.ranks[slot as usize]);
        self.edge_grid
            .candidates(&rect.union(&label_rect), &mut self.scratch);
        self.scratch.sort_unstable();
        out.edges.clear();
        out.labels.clear();
        out.label_points.clear();
        out.origin = origin_of(rect);
        for &slot in &self.scratch {
            if self.bounds[slot as usize].meets(rect) {
                out.edges.push(slot);
            }
            if !labelled {
                continue;
            }
            if let Some(point) = self.labels[slot as usize].filter(|p| label_rect.contains(*p)) {
                out.labels.push(slot);
                let Point { x, y } = out.origin;
                #[expect(
                    clippy::cast_possible_truncation,
                    reason = "a label point within `label_rect`, less the query's origin and only \
                              then rounded, rounds by its distance from the rectangle (ADR-0010); \
                              a label point lies within three times `WORLD_LIMIT`, and the \
                              origin of a rectangle that finds it within 2^127 of it (ADR-0010), \
                              within f32"
                )]
                out.label_points
                    .extend([(point.x - x) as f32, (point.y - y) as f32]);
            }
        }
        let found = out.edges.iter().map(|&slot| {
            let slot = slot as usize;
            (&self.paths[slot], &self.edges[slot].style)
        });
        let stroke = Stroke::at(level, pixel);
        out.mesh
            .build(found, &stroke, rect, out.origin, budget, &mut self.points);
    }
}

#[cfg(test)]
mod tests {
    use super::super::{EdgeSpec, LabelPlacement};
    use super::*;
    use crate::geometry::{Side, Sides, WORLD_LIMIT};
    use crate::stroke::EdgeStyle;

    #[test]
    fn a_query_returns_slots_and_label_points_and_its_edges_have_ends() {
        let positions = vec![0.0, 0.0, 300.0, 100.0];
        let sizes = vec![220.0, 64.0, 220.0, 64.0];
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
    fn a_query_origin_is_its_centre_snapped_to_the_power_of_two_of_its_larger_side() {
        // Verifies: ADR-0010
        // 400 by 100 around (5e7 + 100, 100): a grid of 512, and 97,656 of it the nearest in x.
        let rect = Rect::new(5e7 - 100.0, 50.0, 5e7 + 300.0, 150.0);
        assert_eq!(origin_of(&rect), Point::new(49_999_872.0, 0.0));
        // Taller than wide, and below the world's origin: the grid is the larger side's.
        let rect = Rect::new(-50.0, -3e7 - 600.0, 50.0, -3e7 + 200.0);
        assert_eq!(origin_of(&rect), Point::new(0.0, -30_000_128.0));
    }

    #[test]
    fn a_query_origin_stays_across_a_pan_shorter_than_half_its_grid() {
        // Verifies: ADR-0010
        let around = |x: f64| Rect::new(x - 200.0, -200.0, x + 200.0, 200.0);
        let origin = Point::new(49_999_872.0, 0.0);
        for pan in [-250.0, -100.0, 0.0, 100.0, 250.0] {
            assert_eq!(origin_of(&around(origin.x + pan)), origin, "pan {pan}");
        }
        assert_eq!(
            origin_of(&around(origin.x + 300.0)),
            Point::new(origin.x + 512.0, 0.0)
        );
    }

    #[test]
    fn a_query_origin_holds_in_f32_and_is_the_world_origin_where_nothing_snaps() {
        // Verifies: ADR-0010
        // A grid finer than f32 holds at 1e8: the origin is the nearest f32, within its spacing.
        let origin = origin_of(&Rect::new(1e8 + 0.3, 0.3, 1e8 + 0.301, 0.301));
        assert_eq!(f64::from(origin.x as f32), origin.x);
        assert!((origin.x - 1e8).abs() <= 4.0, "{origin:?}");
        for rect in [
            Rect::new(f64::NEG_INFINITY, 0.0, f64::INFINITY, 1.0),
            Rect::new(5e7, 5e7, 5e7, 5e7),
            Rect::new(f64::NAN, 0.0, 1.0, 1.0),
            // Beyond f32 in x alone.
            Rect::new(1e39, 0.0, 1e39, 10.0),
        ] {
            assert_eq!(origin_of(&rect), Point::default(), "{rect:?}");
        }
    }

    /// The edge from `at` to `at` + (300, 200), labelled at its middle, queried at the near level
    /// at a scale of 4 around it.
    fn far_edge_at(at: Point) -> Visible {
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
        let Point { x, y } = at;
        let positions = [x, y, x + 300.0, y + 200.0].map(|v| v as f32).to_vec();
        let mut graph = Graph::new(positions, vec![220.0, 64.0, 220.0, 64.0], edges).unwrap();
        let mut out = Visible::default();
        let rect = Rect::new(x + 60.0, y - 80.0, x + 460.0, y + 320.0);
        graph.query(&rect, Level::Near, 0.25, 0.0, &mut out);
        out
    }

    #[test]
    fn an_edge_far_from_the_world_origin_hands_over_its_mesh_as_precisely_as_near_it() {
        // Verifies: ADR-0010, Q-4
        // At 5e7 an f32 holds every fourth number, at 3e7 every second; near the world's origin,
        // the same edge rounds by under 2^-23 of 512, which stands for the engine's f64 stroke.
        let at = Point::new(5e7, -3e7);
        let (far, near) = (far_edge_at(at), far_edge_at(Point::default()));
        assert_eq!(far.origin, Point::new(50_000_384.0, -30_000_128.0));
        let world = |out: &Visible, values: &[f32], shift: Point| -> Vec<f64> {
            let origin = [out.origin.x - shift.x, out.origin.y - shift.y];
            let at = values.iter().enumerate();
            at.map(|(i, &v)| f64::from(v) + origin[i % 2]).collect()
        };
        let worst = |a: Vec<f64>, b: Vec<f64>| {
            assert_eq!(a.len(), b.len());
            a.iter()
                .zip(&b)
                .map(|(a, b)| (a - b).abs())
                .fold(0.0, f64::max)
        };
        assert!(far.mesh.positions.len() > 12);
        let none = Point::default();
        let mesh = worst(
            world(&far, &far.mesh.positions, at),
            world(&near, &near.mesh.positions, none),
        );
        // A quarter pixel at a scale of 4.
        assert!(mesh <= 1.0 / 16.0, "the mesh strays {mesh} world units");
        assert_eq!(far.label_points.len(), 2);
        let labels = worst(
            world(&far, &far.label_points, at),
            world(&near, &near.label_points, none),
        );
        assert!(
            labels <= 1.0 / 16.0,
            "the label strays {labels} world units"
        );
    }

    #[test]
    fn below_the_near_level_a_query_places_no_label_and_strokes_plain_far() {
        let label = LabelPlacement {
            t: 0.5,
            offset: 0.0,
        };
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
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

    /// Every coordinate a query of `rect` writes, the origin, the mesh's positions and distances,
    /// the label points, and the ends of the edges found, at each level and at a pixel of a near,
    /// a far, and no zoom the shell reaches.
    fn written(graph: &mut Graph, rect: &Rect) -> Vec<f64> {
        let mut out = Visible::default();
        let mut all = Vec::new();
        for level in [Level::Near, Level::Middle, Level::Far] {
            for pixel in [0.25, 200.0, 1e300] {
                graph.query(rect, level, pixel, 1e3, &mut out);
                let mut ends = Vec::new();
                graph.edge_ends(&out.edges, &mut ends);
                all.extend([out.origin.x, out.origin.y]);
                let mesh = [&out.mesh.positions, &out.mesh.distances];
                let floats = mesh.into_iter().chain([&out.label_points, &ends]);
                all.extend(floats.flatten().map(|&v| f64::from(v)));
            }
        }
        all
    }

    #[test]
    fn no_coordinate_turns_infinite_where_nodes_and_labels_are_dragged_to_the_world_limit() {
        // Verifies: Q-4, Q-7, ADR-0028
        // Node `a` between `b` and `c`, an edge from each to `a` with a label, which the drags
        // below carry to opposite corners of the world, and the labels beyond them.
        let label = Some(LabelPlacement {
            t: 0.5,
            offset: 40.0,
        });
        let edge = |source, sides| EdgeSpec {
            sides,
            source,
            target: 0,
            label,
            style: EdgeStyle::unstyled(),
        };
        let crossed = Sides {
            source: Side::Bottom,
            target: Side::Top,
        };
        let mut graph = Graph::new(
            vec![0.0, 0.0, 300.0, 0.0, -300.0, 0.0],
            vec![220.0, 64.0, 220.0, 64.0, 220.0, 64.0],
            vec![edge(1, Sides::default()), edge(2, crossed)],
        )
        .unwrap();
        for _ in 0..4 {
            graph.translate(&[1], f32::MAX, f32::MAX).unwrap();
            graph.translate(&[2], -f32::MAX, -f32::MAX).unwrap();
        }
        // Each stopped where its far side meets the limit, as f32 rounds it: 2^120 - 220 rounds to
        // 2^120 itself.
        let at = |slot: usize| [graph.positions[slot * 2], graph.positions[slot * 2 + 1]];
        let limit = WORLD_LIMIT as f32;
        assert_eq!(at(2), [-limit, -limit]);
        assert_eq!(at(1), [limit, limit]);
        let [x, y] = at(1);
        for slot in [0, 1] {
            let far = graph.move_label(slot, Point::new(1e300, -1e300)).unwrap();
            assert_eq!(far.offset.abs(), WORLD_LIMIT);
        }
        for rect in [
            Rect::new(-1e300, -1e300, 1e300, 1e300),
            Rect::new(1e300, 1e300, 1.1e300, 1.1e300),
            Rect::new(-1e300, 0.0, 1e300, 1.0),
            Rect::new(
                f64::from(x) - 1e3,
                f64::from(y) - 1e3,
                f64::from(x) + 1e3,
                f64::from(y) + 1e3,
            ),
            Rect::new(-1e3, -1e3, 1e3, 1e3),
            // Beyond the world, but within f32, where its origin is too.
            Rect::new(3e38, 3e38, 3.1e38, 3.1e38),
            // From within the world to 2^127, whose grid of 2^127 snaps its origin there, the
            // largest power of two f32 holds.
            Rect::new(1e36, 1e36, 2f64.powi(127), 2f64.powi(127)),
        ] {
            let written = written(&mut graph, &rect);
            assert!(!written.is_empty());
            assert!(
                written.iter().all(|v| v.abs() < f64::from(f32::MAX)),
                "{rect:?} wrote a coordinate that f32 does not hold",
            );
        }
        let mut out = Visible::default();
        let far = 2f64.powi(127);
        graph.query(
            &Rect::new(1e36, 1e36, far, far),
            Level::Far,
            200.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.origin, Point::new(far, far));
        assert!(!out.edges.is_empty());
        // A press anywhere still answers.
        graph.hit_at(Point::new(1e300, 1e300), 1e300, Level::Near, true);
    }
}
