//! The query: which node slots, edge slots, and edge labels a rectangle meets, at a level of
//! detail, and the mesh of the edges it found, written relative to an origin (ADR-0010,
//! ADR-0012).

use super::{Graph, SlotError};
use crate::geometry::{Point, Rect, bounded_pixel};
use crate::stroke::{MESH_BUDGET, Mesh, Stroke};

/// The level of detail a query serves (ADR-0012): near draws edge labels, middle does not, and
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
    /// (ADR-0012); at the near level also the labels whose point lies within `label_reach` of it,
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
        let at = MeshAt {
            rect: *rect,
            level,
            pixel,
            origin: out.origin,
        };
        self.mesh_edges(&out.edges, &at, budget, &mut out.mesh);
    }

    /// Writes into `edges` the slots of every edge at the node slots `slots` and of the edge slots
    /// `also`, found by a query or not, each once, in ascending order, and into `out` their mesh,
    /// stroked as `query` strokes the edges it found in `rect` at `level` where a screen pixel is
    /// `pixel` world units, relative to `origin`, within the mesh budget: what a drag redraws of
    /// the nodes it moves and an edit of what it added (ADR-0027). A slot of `slots`
    /// that holds no node, or of `also` that holds no edge, refuses the call, and nothing is
    /// written.
    pub fn mesh_at(
        &mut self,
        slots: &[u32],
        also: &[u32],
        at: &MeshAt,
        edges: &mut Vec<u32>,
        out: &mut Mesh,
    ) -> Result<(), SlotError> {
        self.edges_held(also)?;
        let mut found = self.edges_at(slots)?;
        found.extend_from_slice(also);
        found.sort_unstable();
        found.dedup();
        *edges = found;
        self.mesh_edges(edges, at, MESH_BUDGET, out);
        Ok(())
    }

    /// Writes into `out` the mesh of the edge slots `edges`, each from its path and its style,
    /// stroked for `at`'s level where a screen pixel is its pixel's world units, in its rectangle,
    /// relative to its origin, within `budget` vertices: the step from an edge slot to its stroke,
    /// which the query and the moving mesh both take (ADR-0012, ADR-0027).
    fn mesh_edges(&mut self, edges: &[u32], at: &MeshAt, budget: u32, out: &mut Mesh) {
        let found = edges.iter().map(|&slot| {
            let slot = slot as usize;
            (&self.paths[slot], &self.edges[slot].style)
        });
        let stroke = Stroke::at(at.level, bounded_pixel(at.pixel));
        out.build(
            found,
            &stroke,
            &at.rect,
            at.origin,
            budget,
            &mut self.points,
        );
    }
}

/// Where an edge mesh is stroked: for `mesh_at`, the edges at the nodes a drag moves and the
/// edges an edit at the far level added, in the rectangle, at the level, and where a screen pixel
/// is the pixel's world units of the query the scene keeps, relative to its origin (ADR-0027);
/// for a query, its own.
#[derive(Clone, Copy, Debug)]
pub struct MeshAt {
    pub rect: Rect,
    pub level: Level,
    pub pixel: f64,
    pub origin: Point,
}

#[cfg(test)]
mod tests {
    use super::super::{EdgeSpec, LabelPlacement};
    use super::*;
    use crate::geometry::{Dock, EdgePath, Side, Sides, WORLD_LIMIT};
    use crate::stroke::{Detail, EdgeStyle};

    #[test]
    fn a_graph_that_never_loaded_finds_nothing_at_every_level() {
        // Verifies: Q-7
        let mut graph = Graph::default();
        let mut out = Visible::default();
        for level in [Level::Near, Level::Middle, Level::Far] {
            for rect in [
                Rect::new(0.0, 0.0, 800.0, 600.0),
                Rect::new(-1e300, -1e300, 1e300, 1e300),
            ] {
                graph.query(&rect, level, 1.0, 8.0, &mut out);
                assert!(out.nodes.is_empty() && out.edges.is_empty() && out.labels.is_empty());
                assert!(out.mesh.indices.is_empty(), "{level:?} {rect:?}");
                assert_eq!(out.mesh.detail, Detail::Complete, "{level:?} {rect:?}");
            }
            for connectors in [false, true] {
                let target = graph.hit_at(Point::new(10.0, 10.0), 1.0, level, connectors);
                assert_eq!(target, None, "{level:?}");
            }
        }
    }

    #[test]
    fn the_mesh_at_a_node_holds_every_edge_at_it_found_or_not_and_no_other() {
        // Verifies: ADR-0027
        // Nodes 0 and 1 side by side, node 2 far off; edges 0–1, 1–2, and 0–2, then one between
        // 1 and 2 alone, which no edge at 0 is.
        let positions = vec![0.0, 0.0, 300.0, 0.0, 1e6, 1e6];
        let sizes = vec![220.0, 64.0, 220.0, 64.0, 220.0, 64.0];
        let edge = |source, target| EdgeSpec {
            sides: Sides::default(),
            source,
            target,
            label: None,
            style: EdgeStyle::unstyled(),
        };
        let edges = vec![edge(0, 1), edge(1, 2), edge(0, 2), edge(2, 1)];
        let mut graph = Graph::new(positions, sizes, edges).unwrap();
        // Inside node 0's box, short of its right side, where its edges leave: the query finds
        // node 0 but not edge 0 at it.
        let rect = Rect::new(10.0, 10.0, 50.0, 50.0);
        let mut found = Visible::default();
        graph.query(&rect, Level::Near, 1.0, 0.0, &mut found);
        assert_eq!(found.nodes, [0]);
        assert!(!found.edges.contains(&0), "{:?}", found.edges);
        assert_eq!(found.mesh.edge_starts.len(), found.edges.len());
        let at = MeshAt {
            rect,
            level: Level::Near,
            pixel: 1.0,
            origin: found.origin,
        };
        let (mut edges, mut mesh) = (Vec::new(), Mesh::default());
        graph
            .mesh_at(&[0], &[], &at, &mut edges, &mut mesh)
            .unwrap();
        assert_eq!(edges, [0, 2]);
        assert_eq!(mesh.edge_starts.len(), 2);
        assert!(!mesh.indices.is_empty());
        // Of two nodes, each edge at either once, found by the query or not.
        graph
            .mesh_at(&[1, 2], &[], &at, &mut edges, &mut mesh)
            .unwrap();
        assert_eq!(edges, [0, 1, 2, 3]);
        assert_eq!(mesh.edge_starts.len(), 4);
        // A slot that holds no node refuses, and nothing is written.
        let before = mesh.indices.len();
        assert!(
            graph
                .mesh_at(&[9], &[], &at, &mut edges, &mut mesh)
                .is_err()
        );
        assert_eq!((edges.len(), mesh.indices.len()), (4, before));
    }

    #[test]
    fn the_mesh_of_edge_slots_holds_those_edges_and_the_ones_at_the_nodes_each_once() {
        // Verifies: ADR-0027
        let positions = vec![0.0, 0.0, 300.0, 0.0, 600.0, 0.0];
        let sizes = vec![220.0, 64.0, 220.0, 64.0, 220.0, 64.0];
        let edge = |source, target| EdgeSpec {
            sides: Sides::default(),
            source,
            target,
            label: None,
            style: EdgeStyle::unstyled(),
        };
        let edges = vec![edge(0, 1), edge(1, 2), edge(0, 2)];
        let mut graph = Graph::new(positions, sizes, edges).unwrap();
        let rect = Rect::new(-10.0, -10.0, 900.0, 100.0);
        let mut found = Visible::default();
        graph.query(&rect, Level::Far, 1.0, 0.0, &mut found);
        let at = MeshAt {
            rect,
            level: Level::Far,
            pixel: 1.0,
            origin: found.origin,
        };
        let (mut edges, mut mesh) = (Vec::new(), Mesh::default());
        // An added edge alone: that edge and no other.
        graph
            .mesh_at(&[], &[1], &at, &mut edges, &mut mesh)
            .unwrap();
        assert_eq!(edges, [1]);
        assert_eq!(mesh.edge_starts.len(), 1);
        // Beside a dragged node: the edges at it and the added one, each once.
        graph
            .mesh_at(&[0], &[2, 1], &at, &mut edges, &mut mesh)
            .unwrap();
        assert_eq!(edges, [0, 1, 2]);
        // An edge slot that holds no edge refuses, and nothing is written.
        assert!(
            graph
                .mesh_at(&[], &[7], &at, &mut edges, &mut mesh)
                .is_err()
        );
        assert_eq!(edges, [0, 1, 2]);
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
        // Verifies: Q-4, Q-7, ADR-0030
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
            source: Side::Bottom.into(),
            target: Side::Top.into(),
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

    /// Whether `p` is a point `f32` holds.
    fn held(p: Point) -> bool {
        p.x.abs() < f64::from(f32::MAX) && p.y.abs() < f64::from(f32::MAX)
    }

    /// A small node and one as wide and high as the world, each with a loop on every side and
    /// one of the outline, labelled, carried to opposite corners of the world; and the loops.
    fn loops_at_the_world_limit() -> (Graph, Vec<EdgeSpec>) {
        let docks = [Side::Top, Side::Right, Side::Bottom, Side::Left].map(Dock::Side);
        let docks = docks.into_iter().chain([Dock::Outline]);
        let specs: Vec<EdgeSpec> = docks
            .flat_map(|dock| [0, 1].map(|node| (node, dock)))
            .map(|(node, dock)| EdgeSpec {
                sides: Sides {
                    source: dock,
                    target: Dock::Outline,
                },
                source: node,
                target: node,
                label: Some(LabelPlacement {
                    t: 0.5,
                    offset: 40.0,
                }),
                style: EdgeStyle::unstyled(),
            })
            .collect();
        let world = 2.0 * WORLD_LIMIT as f32;
        let mut graph = Graph::new(
            vec![0.0, 0.0, -1e3, -1e3],
            vec![220.0, 64.0, world, world],
            specs.clone(),
        )
        .unwrap();
        for _ in 0..4 {
            graph.translate(&[0], f32::MAX, f32::MAX).unwrap();
            graph.translate(&[1], -f32::MAX, -f32::MAX).unwrap();
        }
        let limit = WORLD_LIMIT as f32;
        assert_eq!(&graph.positions[..2], [limit - 220.0, limit - 64.0]);
        assert_eq!(&graph.positions[2..], [-limit, -limit]);
        (graph, specs)
    }

    /// Asserts that every point of the loop in `slot`, its control points and its label's
    /// before and after a drag of it far beyond the world, is one `f32` holds; returns whether a
    /// control point lies past twice the world's limit.
    fn assert_loop_held(graph: &mut Graph, slot: usize, spec: &EdgeSpec) -> bool {
        let path = graph.paths[slot];
        let node = graph.node_bounds(spec.source);
        assert_eq!(path, EdgePath::looped(&node, spec.sides.source), "{slot}");
        let points = (0..=64).map(|t| path.point_at(f64::from(t) / 64.0));
        let controls = [path.control_source, path.control_target];
        assert!(points.chain(controls).all(held), "edge {slot}: {path:?}");
        assert!(held(graph.labels[slot].unwrap()), "edge {slot}");
        let far = graph
            .move_label(slot as u32, Point::new(1e300, -1e300))
            .unwrap();
        assert_eq!(far.offset.abs(), WORLD_LIMIT);
        assert!(held(graph.labels[slot].unwrap()), "edge {slot}");
        controls
            .iter()
            .any(|p| p.x.abs().max(p.y.abs()) > 2.0 * WORLD_LIMIT)
    }

    #[test]
    fn every_point_of_a_loop_is_one_f32_holds_where_its_node_lies_at_the_world_limit() {
        // Verifies: ADR-0031, ADR-0030, Q-4
        // A loop pulls out as far as its side is long, so the large node's reaches three times
        // the limit out; its points, and every coordinate a query writes, stay within f32.
        let (mut graph, specs) = loops_at_the_world_limit();
        let beyond = (0..specs.len())
            .filter(|&slot| assert_loop_held(&mut graph, slot, &specs[slot]))
            .count();
        // The large node's loops reach past twice the limit, which the test rests on.
        assert!(beyond >= 4, "{beyond}");
        let limit = WORLD_LIMIT;
        for rect in [
            Rect::new(-1e300, -1e300, 1e300, 1e300),
            Rect::new(-3.5 * limit, -3.5 * limit, -limit, -limit),
            Rect::new(-1e3, -3.1 * limit, 1e3, -2.9 * limit),
            Rect::new(limit - 1e3, limit - 1e3, limit + 1e3, limit + 1e3),
        ] {
            let written = written(&mut graph, &rect);
            assert!(!written.is_empty(), "{rect:?}");
            assert!(
                written.iter().all(|v| v.abs() < f64::from(f32::MAX)),
                "{rect:?} wrote a coordinate that f32 does not hold",
            );
        }
    }
}
