//! The edge mesh (ADR-0012): edge paths flattened into polylines within a tolerance, and stroked
//! into triangles with each edge's colour, dash pattern, and arrowhead (G-11).
//!
//! A path is flattened by subdividing it until its control points lie within the tolerance of
//! the chord, so the polyline stays within the tolerance of the curve (Q-4). The stroke has two
//! vertices per polyline point, offset along the averaged normal, and carries the distance along
//! the path, which a shader compares with the dash pattern. An arrowhead is a triangle whose tip
//! is the path's end; the stroke stops at its base.

use crate::geometry::{EdgePath, Point};

/// How an edge is drawn: its colour as `0xRRGGBB`, its dash pattern as dash and gap lengths in
/// world units, or none for a solid line, and whether an arrowhead marks its end, as it does
/// unless the host application says otherwise.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EdgeStyle {
    pub color: u32,
    pub dash: Option<(f32, f32)>,
    pub arrow: bool,
}

impl Default for EdgeStyle {
    fn default() -> Self {
        Self {
            color: 0x9a_a1ad,
            dash: None,
            arrow: true,
        }
    }
}

/// The width of a stroke at full detail, in world units.
pub(crate) const STROKE_WIDTH: f64 = 2.0;

/// How a query strokes its edges: flattened within `tolerance` and `width` wide, in world units;
/// `plain` draws thin lines alone, without dash patterns or arrowheads, as the far level of
/// detail does (ADR-0012).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Stroke {
    pub(crate) tolerance: f64,
    pub(crate) width: f64,
    pub(crate) plain: bool,
}

impl Stroke {
    /// Full detail: the stroke width, dash patterns, and arrowheads, within `tolerance`.
    pub(crate) const fn full(tolerance: f64) -> Self {
        Self {
            tolerance,
            width: STROKE_WIDTH,
            plain: false,
        }
    }
}
/// The length and half the base of an arrowhead, in world units.
const ARROW_LENGTH: f64 = 10.0;
const ARROW_HALF_WIDTH: f64 = 5.0;
/// How deep a path is subdivided at most: 2^12 segments.
const MAX_DEPTH: u32 = 12;

/// The triangles of the edges a query found, as buffers a shader reads: per vertex its position
/// `x, y`, its distance along its path, its colour as RGBA bytes, and its dash pattern `dash,
/// gap` (0, 0 for solid); and three vertex indices per triangle.
#[derive(Debug, Default)]
pub struct Mesh {
    pub positions: Vec<f32>,
    pub distances: Vec<f32>,
    pub colors: Vec<u32>,
    pub dashes: Vec<f32>,
    pub indices: Vec<u32>,
}

impl Mesh {
    pub(crate) fn clear(&mut self) {
        self.positions.clear();
        self.distances.clear();
        self.colors.clear();
        self.dashes.clear();
        self.indices.clear();
    }

    fn vertex_count(&self) -> u32 {
        u32::try_from(self.distances.len()).unwrap_or(u32::MAX)
    }

    fn vertex(&mut self, at: Point, distance: f64, color: u32, dash: (f32, f32)) {
        self.positions.extend([at.x as f32, at.y as f32]);
        self.distances.push(distance as f32);
        self.colors.push(color);
        self.dashes.extend([dash.0, dash.1]);
    }

    /// Strokes `path` with `style` into the mesh as `stroke` says.
    pub(crate) fn add_edge(
        &mut self,
        path: &EdgePath,
        style: &EdgeStyle,
        stroke: &Stroke,
        scratch: &mut Vec<Point>,
    ) {
        flatten(path, stroke.tolerance, scratch);
        let color = rgba(style.color);
        if stroke.plain {
            self.polyline(scratch, color, (0.0, 0.0), stroke.width);
            return;
        }
        if style.arrow {
            let tip = path.target;
            let back = path.tangent_at(1.0);
            let base = Point::new(tip.x - back.x * ARROW_LENGTH, tip.y - back.y * ARROW_LENGTH);
            trim_end(scratch, base);
            self.arrowhead(tip, base, back, color);
        }
        self.polyline(
            scratch,
            color,
            style.dash.unwrap_or((0.0, 0.0)),
            stroke.width,
        );
    }

    fn arrowhead(&mut self, tip: Point, base: Point, direction: Point, color: u32) {
        let first = self.vertex_count();
        let (nx, ny) = (
            -direction.y * ARROW_HALF_WIDTH,
            direction.x * ARROW_HALF_WIDTH,
        );
        self.vertex(tip, 0.0, color, (0.0, 0.0));
        self.vertex(Point::new(base.x + nx, base.y + ny), 0.0, color, (0.0, 0.0));
        self.vertex(Point::new(base.x - nx, base.y - ny), 0.0, color, (0.0, 0.0));
        self.indices.extend([first, first + 1, first + 2]);
    }

    /// Two vertices per point, half of `width` either side along the averaged normal, and
    /// two triangles per segment.
    fn polyline(&mut self, points: &[Point], color: u32, dash: (f32, f32), width: f64) {
        if points.len() < 2 {
            return;
        }
        let half = width / 2.0;
        let mut distance = 0.0;
        for (i, &point) in points.iter().enumerate() {
            if i > 0 {
                let previous = points[i - 1];
                distance += (point.x - previous.x).hypot(point.y - previous.y);
            }
            let (nx, ny) = normal_at(points, i);
            let first = self.vertex_count();
            self.vertex(
                Point::new(point.x + nx * half, point.y + ny * half),
                distance,
                color,
                dash,
            );
            self.vertex(
                Point::new(point.x - nx * half, point.y - ny * half),
                distance,
                color,
                dash,
            );
            if i > 0 {
                self.indices
                    .extend([first - 2, first - 1, first, first - 1, first + 1, first]);
            }
        }
    }
}

/// `0xRRGGBB` as the bytes R, G, B, 255 in memory order.
fn rgba(color: u32) -> u32 {
    let [b, g, r, _] = color.to_le_bytes();
    u32::from_le_bytes([r, g, b, 0xff])
}

fn unit(dx: f64, dy: f64) -> Option<(f64, f64)> {
    let length = dx.hypot(dy);
    (length > f64::EPSILON).then(|| (dx / length, dy / length))
}

/// The normal at point `i` of a polyline: the mean of the normals of its segments, lengthened so
/// the stroke keeps its width at a bend, but at most twice.
fn normal_at(points: &[Point], i: usize) -> (f64, f64) {
    let segment = |a: Point, b: Point| unit(b.x - a.x, b.y - a.y).map(|(x, y)| (-y, x));
    let before = (i > 0).then(|| segment(points[i - 1], points[i])).flatten();
    let after = points.get(i + 1).and_then(|&next| segment(points[i], next));
    match (before, after) {
        (Some(a), Some(b)) => {
            let Some((x, y)) = unit(a.0 + b.0, a.1 + b.1) else {
                return a;
            };
            let scale = 1.0 / (x * a.0 + y * a.1).max(0.5);
            (x * scale, y * scale)
        }
        (Some(n), None) | (None, Some(n)) => n,
        (None, None) => (0.0, 1.0),
    }
}

/// Drops the trailing points within the arrowhead, its base included, and ends the polyline at
/// its `base`. Where the whole path lies within the arrowhead, only its first point stays, and no
/// stroke is drawn.
fn trim_end(points: &mut Vec<Point>, base: Point) {
    let Some(&tip) = points.last() else {
        return;
    };
    let reach = (base.x - tip.x).hypot(base.y - tip.y);
    let within = |p: &Point| (p.x - tip.x).hypot(p.y - tip.y) <= reach;
    while points.len() > 1 && within(&points[points.len() - 1]) {
        points.pop();
    }
    if !within(&points[0]) {
        points.push(base);
    }
}

/// Writes into `out`, after clearing it, the points of `path` flattened so that no point of the
/// curve lies farther than `tolerance` from the polyline. A tolerance that is not positive and
/// finite gives the most points.
fn flatten(path: &EdgePath, tolerance: f64, out: &mut Vec<Point>) {
    out.clear();
    out.push(path.source);
    let tolerance = if tolerance.is_finite() {
        tolerance.max(0.0)
    } else {
        0.0
    };
    subdivide(path, tolerance, 0, out);
}

/// How far `p` lies from the segment `a`–`b`.
fn distance_to_segment(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let length2 = dx * dx + dy * dy;
    let t = if length2 > 0.0 {
        (((p.x - a.x) * dx + (p.y - a.y) * dy) / length2).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (p.x - a.x - t * dx).hypot(p.y - a.y - t * dy)
}

/// How far the control points of `path` lie from its chord, the segment between its ends, at
/// most. The curve lies in the hull of its control points, so no point of it lies farther from
/// the chord, also where it bends back beyond an end.
fn flatness(path: &EdgePath) -> f64 {
    let (a, b) = (path.source, path.target);
    distance_to_segment(path.control_source, a, b).max(distance_to_segment(
        path.control_target,
        a,
        b,
    ))
}

fn subdivide(path: &EdgePath, tolerance: f64, depth: u32, out: &mut Vec<Point>) {
    if depth >= MAX_DEPTH || flatness(path) <= tolerance {
        out.push(path.target);
        return;
    }
    let (left, right) = path.split();
    subdivide(&left, tolerance, depth + 1, out);
    subdivide(&right, tolerance, depth + 1, out);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::Rect;

    /// The scales the example zooms through, from its least to its most.
    const SCALES: [f64; 6] = [0.005, 0.05, 0.25, 1.0, 2.0, 4.0];

    fn paths() -> Vec<EdgePath> {
        let node = |x, y| Rect::of_node(x, y, 220.0, 64.0);
        vec![
            EdgePath::between(&node(0.0, 0.0), &node(300.0, 110.0)),
            EdgePath::between(&node(0.0, 0.0), &node(300.0, -330.0)),
            EdgePath::between(&node(600.0, 0.0), &node(0.0, 500.0)),
            EdgePath::between(&node(0.0, 0.0), &node(4000.0, 2000.0)),
            // Backwards and level: the control points pull out beyond both ends of the chord.
            EdgePath::between(&node(500.0, 0.0), &node(0.0, 0.0)),
            EdgePath::between(&node(500.0, 0.0), &node(0.0, 0.5)),
        ]
    }

    /// How far `p` lies from the curve: the nearest of dense samples, refined around it.
    fn nearest_on_curve(path: &EdgePath, p: Point) -> f64 {
        let off = |t: f64| {
            let q = path.point_at(t);
            (q.x - p.x).hypot(q.y - p.y)
        };
        let n = 2000;
        let best = (0..=n).min_by(|&a, &b| {
            off(f64::from(a) / f64::from(n)).total_cmp(&off(f64::from(b) / f64::from(n)))
        });
        let t = f64::from(best.unwrap_or(0)) / f64::from(n);
        let (mut lo, mut hi) = (
            (t - 1.0 / f64::from(n)).max(0.0),
            (t + 1.0 / f64::from(n)).min(1.0),
        );
        for _ in 0..60 {
            let (a, b) = (lo + (hi - lo) / 3.0, hi - (hi - lo) / 3.0);
            if off(a) < off(b) {
                hi = b;
            } else {
                lo = a;
            }
        }
        off((lo + hi) / 2.0)
    }

    #[test]
    fn a_flattened_path_lies_within_half_a_pixel_of_the_curve_at_every_zoom() {
        // Verifies: Q-4
        let mut points = Vec::new();
        for path in paths() {
            for scale in SCALES {
                // The tolerance the scene asks for at this scale: a quarter pixel on screen.
                flatten(&path, 0.25 / scale, &mut points);
                assert_eq!(points[0], path.source);
                assert_eq!(*points.last().unwrap(), path.target);
                // Every point of the curve lies near the polyline...
                let worst = (0..=2000)
                    .map(|i| path.point_at(f64::from(i) / 2000.0))
                    .map(|p| {
                        points
                            .windows(2)
                            .map(|s| distance_to_segment(p, s[0], s[1]))
                            .fold(f64::INFINITY, f64::min)
                    })
                    .fold(0.0, f64::max);
                assert!(worst * scale <= 0.5, "{worst} world units at scale {scale}");
                // ...and every point of the polyline lies on the curve.
                for &p in &points {
                    let nearest = nearest_on_curve(&path, p);
                    assert!(
                        nearest * scale <= 0.5,
                        "{nearest} off the curve at scale {scale}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_path_is_cut_into_at_most_4096_segments() {
        // No tolerance stops the subdivision, so it stops at its deepest: 2^12 segments.
        let mut points = Vec::new();
        for tolerance in [0.0, f64::NAN] {
            flatten(&paths()[3], tolerance, &mut points);
            assert_eq!(points.len(), 4096 + 1, "tolerance {tolerance}");
        }
    }

    #[test]
    fn zoomed_out_a_path_needs_fewer_points() {
        let path = paths()[3];
        let mut near = Vec::new();
        let mut far = Vec::new();
        flatten(&path, 0.25 / 4.0, &mut near);
        flatten(&path, 0.25 / 0.05, &mut far);
        assert!(
            far.len() < near.len(),
            "{} against {}",
            far.len(),
            near.len()
        );
    }

    #[test]
    fn a_stroke_has_two_vertices_per_point_and_two_triangles_per_segment() {
        let path = paths()[0];
        let mut points = Vec::new();
        let mut mesh = Mesh::default();
        let style = EdgeStyle {
            color: 0x22_a55b,
            dash: Some((6.0, 4.0)),
            arrow: false,
        };
        mesh.add_edge(&path, &style, &Stroke::full(0.25), &mut points);
        let n = points.len();
        assert_eq!(mesh.distances.len(), 2 * n);
        assert_eq!(mesh.indices.len(), 6 * (n - 1));
        assert_eq!(mesh.positions.len(), 4 * n);
        assert!(
            mesh.colors
                .iter()
                .all(|&c| c.to_le_bytes() == [0x22, 0xa5, 0x5b, 0xff])
        );
        assert!(mesh.dashes.chunks(2).all(|d| d == [6.0, 4.0]));
        // Distances grow along the path and end at about its length.
        assert!(mesh.distances.windows(2).all(|d| d[1] >= d[0]));
        assert!(*mesh.distances.last().unwrap() > 300.0 - 220.0);
        // The two vertices of a point lie a stroke width apart.
        let p = &mesh.positions;
        assert!(((p[2] - p[0]).hypot(p[3] - p[1]) - STROKE_WIDTH as f32).abs() < 1e-4);
    }

    #[test]
    fn an_arrowhead_ends_at_the_target_and_the_stroke_at_its_base() {
        let path = paths()[0];
        let mut points = Vec::new();
        let mut mesh = Mesh::default();
        mesh.add_edge(
            &path,
            &EdgeStyle::default(),
            &Stroke::full(0.25),
            &mut points,
        );
        let tip = Point::new(f64::from(mesh.positions[0]), f64::from(mesh.positions[1]));
        assert!((tip.x - path.target.x).abs() < 1e-3 && (tip.y - path.target.y).abs() < 1e-3);
        assert_eq!(&mesh.indices[..3], [0, 1, 2]);
        let end = *points.last().unwrap();
        assert!((end.x - (path.target.x - ARROW_LENGTH)).abs() < 1e-9);
        assert!((end.y - path.target.y).abs() < 1e-9);
        assert!(points.iter().all(|p| p.x <= end.x + 1e-9));
    }

    #[test]
    fn a_plain_stroke_is_thin_and_has_neither_dashes_nor_arrowhead() {
        let path = paths()[0];
        let mut points = Vec::new();
        let mut mesh = Mesh::default();
        let style = EdgeStyle {
            dash: Some((6.0, 4.0)),
            ..EdgeStyle::default()
        };
        let stroke = Stroke {
            tolerance: 5.0,
            width: 40.0,
            plain: true,
        };
        mesh.add_edge(&path, &style, &stroke, &mut points);
        assert_eq!(mesh.distances.len(), 2 * points.len());
        assert!(mesh.dashes.iter().all(|&d| d == 0.0));
        let p = &mesh.positions;
        assert!(((p[2] - p[0]).hypot(p[3] - p[1]) - 40.0).abs() < 1e-3);
        assert_eq!(*points.last().unwrap(), path.target);
    }

    #[test]
    fn an_edge_shorter_than_its_arrowhead_draws_only_the_arrowhead() {
        let path = EdgePath::horizontal(Point::new(0.0, 0.0), Point::new(4.0, 0.0), 0.0);
        let mut points = Vec::new();
        let mut mesh = Mesh::default();
        mesh.add_edge(
            &path,
            &EdgeStyle::default(),
            &Stroke::full(0.25),
            &mut points,
        );
        assert_eq!(mesh.indices.len(), 3);
        assert!(mesh.positions.chunks(2).all(|p| p[0] <= 4.0));
    }

    fn near(a: (f64, f64), b: (f64, f64)) -> bool {
        (a.0 - b.0).abs() < 1e-9 && (a.1 - b.1).abs() < 1e-9
    }

    /// The vertex `i` of a mesh.
    fn vertex_of(mesh: &Mesh, i: usize) -> (f64, f64) {
        (
            f64::from(mesh.positions[2 * i]),
            f64::from(mesh.positions[2 * i + 1]),
        )
    }

    /// A straight path from `a` to `b`, its control points at the thirds.
    fn straight(a: Point, b: Point) -> EdgePath {
        let at = |t: f64| Point::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        EdgePath {
            source: a,
            control_source: at(1.0 / 3.0),
            control_target: at(2.0 / 3.0),
            target: b,
        }
    }

    #[test]
    fn a_unit_vector_keeps_the_direction_and_needs_more_than_epsilon() {
        // The boundary at epsilon is the threshold the code chose, not one of the geometry.
        assert_eq!(unit(-3.0, 4.0), Some((-0.6, 0.8)));
        assert_eq!(unit(0.0, -2.0), Some((0.0, -1.0)));
        assert_eq!(unit(2.0 * f64::EPSILON, 0.0), Some((1.0, 0.0)));
        assert_eq!(unit(f64::EPSILON, 0.0), None);
        assert_eq!(unit(0.0, 0.0), None);
    }

    #[test]
    fn the_normal_of_a_segment_is_its_direction_turned_a_quarter() {
        let p = |x, y| Point::new(x, y);
        // Down the screen along (0, 1): the normal (-dy, dx) is (-1, 0).
        let down = [p(0.0, 0.0), p(0.0, 10.0)];
        assert!(near(normal_at(&down, 0), (-1.0, 0.0)));
        assert!(near(normal_at(&down, 1), (-1.0, 0.0)));
        // Up and to the left along (-0.6, -0.8): the normal is (0.8, -0.6).
        let slant = [p(30.0, 40.0), p(0.0, 0.0)];
        assert!(near(normal_at(&slant, 0), (0.8, -0.6)));
        assert!(near(normal_at(&slant, 1), (0.8, -0.6)));
        // A single point, or points that coincide, have no direction: the normal is (0, 1).
        assert!(near(normal_at(&[p(5.0, 5.0)], 0), (0.0, 1.0)));
        // A point that repeats its neighbour takes the normal of the segment it does have.
        let repeated = [p(0.0, 0.0), p(0.0, 0.0), p(0.0, 10.0), p(0.0, 10.0)];
        assert!(near(normal_at(&repeated, 0), (0.0, 1.0)));
        assert!(near(normal_at(&repeated, 1), (-1.0, 0.0)));
        assert!(near(normal_at(&repeated, 2), (-1.0, 0.0)));
    }

    #[test]
    fn at_a_bend_the_normal_is_the_mitre_and_at_most_twice_as_long() {
        let p = |x, y| Point::new(x, y);
        // A right angle, right then down: the normals (0, 1) and (-1, 0); the mitre runs along
        // their mean, 1 / cos 45° = √2 long, so it lies 1 from both segments' lines.
        let right_angle = [p(0.0, 0.0), p(10.0, 0.0), p(10.0, 10.0)];
        assert!(near(normal_at(&right_angle, 1), (-1.0, 1.0)));
        // A turn of 150°: 1 / cos 75° is more than 2, so the mitre is 2 long along the mean of
        // the normals (0, 1) and (-1/2, -√3/2).
        let (c, s) = (3.0_f64.sqrt() / 2.0, 0.5);
        let sharp = [p(0.0, 0.0), p(10.0, 0.0), p(10.0 - 10.0 * c, 10.0 * s)];
        let (mx, my) = (-0.5_f64, 1.0 - c);
        let m = mx.hypot(my);
        assert!(near(normal_at(&sharp, 1), (2.0 * mx / m, 2.0 * my / m)));
        // Turning back on itself the normals cancel: the normal of the segment before stays.
        let back = [p(0.0, 0.0), p(10.0, 0.0), p(0.0, 0.0)];
        assert!(near(normal_at(&back, 1), (0.0, 1.0)));
        // A turn of 60° to the left, up the screen: the normals (0, 1) and (√3/2, 1/2), mitre
        // 1 / cos 30° along their mean.
        let left = [p(0.0, 0.0), p(10.0, 0.0), p(10.0 + 10.0 * s, -10.0 * c)];
        let (mx, my): (f64, f64) = (c, 1.5);
        let m = mx.hypot(my);
        let mitre = 1.0 / c;
        assert!(near(normal_at(&left, 1), (mitre * mx / m, mitre * my / m)));
    }

    #[test]
    fn a_stroke_lies_half_its_width_either_side_of_the_polyline() {
        // Verifies: ADR-0012
        let p = |x, y| Point::new(x, y);
        // Down and right along (0.6, 0.8) for 50, then straight down for 60.
        let points = [p(0.0, 0.0), p(30.0, 40.0), p(30.0, 100.0)];
        let mut mesh = Mesh::default();
        mesh.polyline(&points, 7, (3.0, 1.0), 4.0);
        assert_eq!(mesh.distances, [0.0, 0.0, 50.0, 50.0, 110.0, 110.0]);
        assert_eq!(mesh.indices, [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
        assert_eq!(mesh.colors, [7; 6]);
        assert_eq!(mesh.dashes, [3.0_f32, 1.0].repeat(6));
        // The ends: 2 along the normal (-0.8, 0.6) of the first segment and (-1, 0) of the last.
        let close =
            |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).abs() < 1e-5 && (a.1 - b.1).abs() < 1e-5;
        assert!(close(vertex_of(&mesh, 0), (-1.6, 1.2)));
        assert!(close(vertex_of(&mesh, 1), (1.6, -1.2)));
        assert!(close(vertex_of(&mesh, 4), (28.0, 100.0)));
        assert!(close(vertex_of(&mesh, 5), (32.0, 100.0)));
        // The bend: each vertex lies 2 from the lines of both segments, on its own side.
        let from_first = |(x, y): (f64, f64)| -0.8 * x + 0.6 * y;
        let from_second = |(x, _): (f64, f64)| 30.0 - x;
        assert!((from_first(vertex_of(&mesh, 2)) - 2.0).abs() < 1e-5);
        assert!((from_second(vertex_of(&mesh, 2)) - 2.0).abs() < 1e-5);
        assert!((from_first(vertex_of(&mesh, 3)) + 2.0).abs() < 1e-5);
        assert!((from_second(vertex_of(&mesh, 3)) + 2.0).abs() < 1e-5);
    }

    #[test]
    fn a_polyline_of_two_points_is_one_segment_and_of_one_point_nothing() {
        let p = |x, y| Point::new(x, y);
        let mut mesh = Mesh::default();
        mesh.polyline(&[p(0.0, 0.0), p(0.0, 5.0)], 1, (0.0, 0.0), 2.0);
        assert_eq!(mesh.distances, [0.0, 0.0, 5.0, 5.0]);
        assert_eq!(mesh.indices, [0, 1, 2, 1, 3, 2]);
        let mut mesh = Mesh::default();
        mesh.polyline(&[p(0.0, 0.0)], 1, (0.0, 0.0), 2.0);
        assert!(mesh.positions.is_empty() && mesh.indices.is_empty());
    }

    #[test]
    fn an_arrowhead_points_along_a_slanted_end() {
        // Verifies: ADR-0012
        // Straight from (0, 0) to (60, 80), direction (0.6, 0.8): the base lies 10 back at
        // (54, 72), its corners 5 either side along (-0.8, 0.6).
        let path = straight(Point::new(0.0, 0.0), Point::new(60.0, 80.0));
        let mut points = Vec::new();
        let mut mesh = Mesh::default();
        mesh.add_edge(
            &path,
            &EdgeStyle::default(),
            &Stroke::full(0.25),
            &mut points,
        );
        let close =
            |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).abs() < 1e-4 && (a.1 - b.1).abs() < 1e-4;
        assert!(close(vertex_of(&mesh, 0), (60.0, 80.0)));
        assert!(close(vertex_of(&mesh, 1), (50.0, 75.0)));
        assert!(close(vertex_of(&mesh, 2), (58.0, 69.0)));
        assert!(near(
            (points[points.len() - 1].x, points[points.len() - 1].y),
            (54.0, 72.0)
        ));
        assert_eq!(points[0], path.source);
    }

    #[test]
    fn an_arrowhead_on_an_edge_shorter_than_it_reaches_back_past_the_source() {
        // Verifies: ADR-0012
        // Straight up from (0, 4) to (0, 0), 4 long: the base lies 10 back, at (0, 10), its
        // corners 5 either side along (1, 0); no stroke is drawn.
        let path = straight(Point::new(0.0, 4.0), Point::new(0.0, 0.0));
        let mut points = Vec::new();
        let mut mesh = Mesh::default();
        mesh.add_edge(
            &path,
            &EdgeStyle::default(),
            &Stroke::full(0.25),
            &mut points,
        );
        assert_eq!(mesh.distances.len(), 3);
        assert_eq!(mesh.indices, [0, 1, 2]);
        let close =
            |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).abs() < 1e-4 && (a.1 - b.1).abs() < 1e-4;
        assert!(close(vertex_of(&mesh, 0), (0.0, 0.0)));
        assert!(close(vertex_of(&mesh, 1), (5.0, 10.0)));
        assert!(close(vertex_of(&mesh, 2), (-5.0, 10.0)));
    }

    #[test]
    fn the_stroke_stops_at_the_base_of_the_arrowhead() {
        let p = |x, y| Point::new(x, y);
        // The base at (90, 0), 10 before the end: the points within 10 of the end go.
        let mut points = vec![p(0.0, 0.0), p(50.0, 0.0), p(95.0, 0.0), p(100.0, 0.0)];
        trim_end(&mut points, p(90.0, 0.0));
        assert_eq!(points, [p(0.0, 0.0), p(50.0, 0.0), p(90.0, 0.0)]);
        // Slanted, the reach is measured as a distance: (94, 92) lies 10 from (100, 100), so
        // (95, 95), 7.07 away, goes and (90, 90), 14.1 away, stays.
        let mut points = vec![p(90.0, 90.0), p(95.0, 95.0), p(100.0, 100.0)];
        trim_end(&mut points, p(94.0, 92.0));
        assert_eq!(points, [p(90.0, 90.0), p(94.0, 92.0)]);
        // Wholly within the arrowhead, only the first point stays.
        let mut points = vec![p(95.0, 0.0), p(100.0, 0.0)];
        trim_end(&mut points, p(90.0, 0.0));
        assert_eq!(points, [p(95.0, 0.0)]);
    }

    #[test]
    fn the_distance_to_a_segment_is_measured_to_its_nearest_point() {
        let p = |x, y| Point::new(x, y);
        let (a, b) = (p(0.0, 0.0), p(10.0, 0.0));
        assert!((distance_to_segment(p(5.0, 3.0), a, b) - 3.0).abs() < 1e-12);
        // Beyond an end, to that end, not to the line.
        assert!((distance_to_segment(p(13.0, 4.0), a, b) - 5.0).abs() < 1e-12);
        assert!((distance_to_segment(p(-3.0, -4.0), a, b) - 5.0).abs() < 1e-12);
        // A segment of no length is its point.
        assert!((distance_to_segment(p(3.0, 4.0), a, a) - 5.0).abs() < 1e-12);
    }

    #[test]
    fn a_tolerance_that_is_not_finite_gives_the_most_points() {
        let mut points = Vec::new();
        for tolerance in [f64::INFINITY, f64::NEG_INFINITY] {
            flatten(&paths()[3], tolerance, &mut points);
            assert_eq!(points.len(), 4096 + 1, "tolerance {tolerance}");
        }
    }

    #[test]
    fn a_negative_tolerance_counts_as_none() {
        // A straight path lies on its chord: within no tolerance at all, it needs no point
        // between its ends, which a tolerance below zero would never allow.
        let path = EdgePath::horizontal(Point::new(0.0, 0.0), Point::new(100.0, 0.0), 0.0);
        let mut points = Vec::new();
        for tolerance in [0.0, -1.0] {
            flatten(&path, tolerance, &mut points);
            assert_eq!(points, [path.source, path.target], "tolerance {tolerance}");
        }
    }

    #[test]
    fn a_point_exactly_at_the_base_of_the_arrowhead_is_not_repeated() {
        // Repeated, the base would close a segment of no length, whose last point has no
        // direction to take its normal from.
        let p = |x, y| Point::new(x, y);
        let mut points = vec![p(0.0, 0.0), p(90.0, 0.0), p(100.0, 0.0)];
        trim_end(&mut points, p(90.0, 0.0));
        assert_eq!(points, [p(0.0, 0.0), p(90.0, 0.0)]);
        // A path exactly as long as the arrowhead lies wholly within it: no stroke.
        let mut points = vec![p(0.0, 0.0), p(10.0, 0.0)];
        trim_end(&mut points, p(0.0, 0.0));
        assert_eq!(points, [p(0.0, 0.0)]);
    }

    #[test]
    fn a_degenerate_path_strokes_without_panicking() {
        let p = Point::new(5.0, 5.0);
        let path = EdgePath {
            source: p,
            control_source: p,
            control_target: p,
            target: p,
        };
        let mut points = Vec::new();
        let mut mesh = Mesh::default();
        mesh.add_edge(
            &path,
            &EdgeStyle::default(),
            &Stroke::full(f64::NAN),
            &mut points,
        );
        assert!(mesh.positions.iter().all(|v| v.is_finite()));
    }
}
