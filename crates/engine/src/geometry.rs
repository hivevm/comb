//! Edge paths and edge-label placement.
//!
//! An edge is a cubic Bézier curve from its source connector to its target connector. An edge
//! label sits at the point of the path parameter `t` and is moved by the label offset along the
//! path's normal there (G-6). An edge leaves its source node at the middle of its right side and
//! enters its target node at the middle of its left side.

/// A point in world coordinates.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub(crate) fn lerp(self, other: Self, t: f64) -> Self {
        Self::new(
            self.x + (other.x - self.x) * t,
            self.y + (other.y - self.y) * t,
        )
    }
}

/// A rectangle in world coordinates, its edges included.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl Rect {
    pub const fn new(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Self {
        Self {
            min_x,
            min_y,
            max_x,
            max_y,
        }
    }

    /// The rectangle of a node at `(x, y)`, its top-left corner, of `width` × `height`.
    pub(crate) fn of_node(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self::new(x, y, x + width, y + height)
    }

    /// Whether the two rectangles share at least one point; touching counts.
    pub(crate) fn meets(&self, other: &Self) -> bool {
        self.min_x <= other.max_x
            && other.min_x <= self.max_x
            && self.min_y <= other.max_y
            && other.min_y <= self.max_y
    }

    /// Whether `point` lies inside the rectangle or on its edges.
    pub(crate) fn contains(&self, point: Point) -> bool {
        self.min_x <= point.x
            && point.x <= self.max_x
            && self.min_y <= point.y
            && point.y <= self.max_y
    }

    /// Whether `other` lies wholly inside the rectangle, edges included.
    pub(crate) fn contains_rect(&self, other: &Self) -> bool {
        self.min_x <= other.min_x
            && other.max_x <= self.max_x
            && self.min_y <= other.min_y
            && other.max_y <= self.max_y
    }

    /// The rectangle grown by `by` on every side.
    pub(crate) fn grown(&self, by: f64) -> Self {
        Self::new(
            self.min_x - by,
            self.min_y - by,
            self.max_x + by,
            self.max_y + by,
        )
    }

    /// The smallest rectangle that holds both.
    pub(crate) fn union(&self, other: &Self) -> Self {
        Self::new(
            self.min_x.min(other.min_x),
            self.min_y.min(other.min_y),
            self.max_x.max(other.max_x),
            self.max_y.max(other.max_y),
        )
    }

    /// The rectangle of a single point.
    pub(crate) const fn at(point: Point) -> Self {
        Self::new(point.x, point.y, point.x, point.y)
    }
}

/// How far an edge's control points pull out of its connectors at least, in pixels.
const MIN_PULL: f64 = 40.0;

/// The values of `t` where one coordinate of a cubic Bézier curve may have an extremum: the roots
/// of its derivative `a t² + b t + c`, by the form that stays exact where `a` vanishes and the
/// derivative is linear. Where there is no root, or a root lies outside 0..=1, or `a` and `b`
/// both vanish, the value is still a point of the curve once `point_at` clamps it, so the bounds
/// stay as they are; only a value that is not a number is left out.
fn extrema(p0: f64, p1: f64, p2: f64, p3: f64) -> impl Iterator<Item = f64> {
    let a = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
    let b = 2.0 * (p0 - 2.0 * p1 + p2);
    let c = p1 - p0;
    let q = -0.5 * (b + b.signum() * (b * b - 4.0 * a * c).max(0.0).sqrt());
    [q / a, c / q].into_iter().filter(|t| !t.is_nan())
}

/// The four control points of an edge's cubic Bézier path.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct EdgePath {
    pub(crate) source: Point,
    pub(crate) control_source: Point,
    pub(crate) control_target: Point,
    pub(crate) target: Point,
}

impl EdgePath {
    /// The path from a connector on the right side of a node to one on the left side of
    /// another: the control points pull horizontally, half the horizontal distance and at least
    /// `min_pull`, so an edge leaves and enters its connectors level.
    pub(crate) fn horizontal(source: Point, target: Point, min_pull: f64) -> Self {
        let pull = ((target.x - source.x).abs() / 2.0).max(min_pull);
        Self {
            source,
            control_source: Point::new(source.x + pull, source.y),
            control_target: Point::new(target.x - pull, target.y),
            target,
        }
    }

    /// The path from the middle of the right side of `source` to the middle of the left side of
    /// `target`.
    pub(crate) fn between(source: &Rect, target: &Rect) -> Self {
        Self::horizontal(
            Point::new(source.max_x, (source.min_y + source.max_y) / 2.0),
            Point::new(target.min_x, (target.min_y + target.max_y) / 2.0),
            MIN_PULL,
        )
    }

    /// The smallest rectangle that holds the whole path: its ends and the points where it turns.
    pub(crate) fn bounds(&self) -> Rect {
        let (p0, p1, p2, p3) = (
            self.source,
            self.control_source,
            self.control_target,
            self.target,
        );
        let mut bounds = Rect::at(p0).union(&Rect::at(p3));
        for t in extrema(p0.x, p1.x, p2.x, p3.x).chain(extrema(p0.y, p1.y, p2.y, p3.y)) {
            bounds = bounds.union(&Rect::at(self.point_at(t)));
        }
        bounds
    }

    /// The smallest rectangle that holds the four control points, and so the whole path, which
    /// lies in their hull, and its chord.
    pub(crate) fn hull(&self) -> Rect {
        Rect::at(self.source)
            .union(&Rect::at(self.control_source))
            .union(&Rect::at(self.control_target))
            .union(&Rect::at(self.target))
    }

    /// The two halves of the path, split at `t = 0.5` (de Casteljau).
    pub(crate) fn split(&self) -> (Self, Self) {
        let ab = self.source.lerp(self.control_source, 0.5);
        let bc = self.control_source.lerp(self.control_target, 0.5);
        let cd = self.control_target.lerp(self.target, 0.5);
        let abc = ab.lerp(bc, 0.5);
        let bcd = bc.lerp(cd, 0.5);
        let mid = abc.lerp(bcd, 0.5);
        (
            Self {
                source: self.source,
                control_source: ab,
                control_target: abc,
                target: mid,
            },
            Self {
                source: mid,
                control_source: bcd,
                control_target: cd,
                target: self.target,
            },
        )
    }

    /// The point at path parameter `t`, clamped to 0.0..=1.0.
    pub(crate) fn point_at(&self, t: f64) -> Point {
        let t = t.clamp(0.0, 1.0);
        let a = self.source.lerp(self.control_source, t);
        let b = self.control_source.lerp(self.control_target, t);
        let c = self.control_target.lerp(self.target, t);
        a.lerp(b, t).lerp(b.lerp(c, t), t)
    }

    /// The unit tangent at path parameter `t`, or (1, 0) where the path has no direction.
    pub(crate) fn tangent_at(&self, t: f64) -> Point {
        let t = t.clamp(0.0, 1.0);
        let u = 1.0 - t;
        let d = |p0: f64, p1: f64, p2: f64, p3: f64| {
            3.0 * u * u * (p1 - p0) + 6.0 * u * t * (p2 - p1) + 3.0 * t * t * (p3 - p2)
        };
        let dx = d(
            self.source.x,
            self.control_source.x,
            self.control_target.x,
            self.target.x,
        );
        let dy = d(
            self.source.y,
            self.control_source.y,
            self.control_target.y,
            self.target.y,
        );
        let length = dx.hypot(dy);
        if length < f64::EPSILON {
            Point::new(1.0, 0.0)
        } else {
            Point::new(dx / length, dy / length)
        }
    }

    /// Where an edge label with path parameter `t` and label offset `offset` sits: the path
    /// point at `t`, moved `offset` pixels along the normal, which points left of the direction
    /// of travel.
    pub(crate) fn label_position(&self, t: f64, offset: f64) -> Point {
        let point = self.point_at(t);
        let tangent = self.tangent_at(t);
        Point::new(point.x + tangent.y * offset, point.y - tangent.x * offset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EPS: f64 = 1e-9;

    fn close(a: Point, b: Point) -> bool {
        (a.x - b.x).abs() < EPS && (a.y - b.y).abs() < EPS
    }

    fn straight() -> EdgePath {
        EdgePath::horizontal(Point::new(0.0, 0.0), Point::new(200.0, 0.0), 10.0)
    }

    #[test]
    fn the_path_runs_from_source_to_target() {
        let path = EdgePath::horizontal(Point::new(10.0, 20.0), Point::new(300.0, 140.0), 40.0);
        assert!(close(path.point_at(0.0), path.source));
        assert!(close(path.point_at(1.0), path.target));
    }

    #[test]
    fn a_parameter_outside_the_path_is_clamped() {
        let path = straight();
        assert!(close(path.point_at(-1.0), path.source));
        assert!(close(path.point_at(2.0), path.target));
    }

    #[test]
    fn a_label_sits_at_its_path_point_moved_along_the_normal() {
        let path = straight();
        assert!(close(path.label_position(0.5, 0.0), Point::new(100.0, 0.0)));
        // Travelling right, the normal points up (negative y in screen coordinates).
        assert!(close(
            path.label_position(0.5, 12.0),
            Point::new(100.0, -12.0)
        ));
    }

    /// The bounds by dense sampling, for comparison.
    fn sampled_bounds(path: &EdgePath) -> Rect {
        (0..=10_000).fold(Rect::at(path.source), |bounds, i| {
            bounds.union(&Rect::at(path.point_at(f64::from(i) / 10_000.0)))
        })
    }

    #[test]
    fn the_bounds_hold_the_whole_path_and_no_more() {
        let paths = [
            straight(),
            EdgePath::horizontal(Point::new(10.0, 20.0), Point::new(300.0, 140.0), 40.0),
            // Backwards: the control points pull out beyond both ends.
            EdgePath::horizontal(Point::new(300.0, 0.0), Point::new(0.0, 90.0), 40.0),
            EdgePath {
                source: Point::new(0.0, 0.0),
                control_source: Point::new(100.0, -80.0),
                control_target: Point::new(-50.0, 120.0),
                target: Point::new(60.0, 10.0),
            },
        ];
        for path in paths {
            let exact = path.bounds();
            let sampled = sampled_bounds(&path);
            for (a, b) in [
                (exact.min_x, sampled.min_x),
                (exact.min_y, sampled.min_y),
                (exact.max_x, sampled.max_x),
                (exact.max_y, sampled.max_y),
            ] {
                assert!((a - b).abs() < 1e-3, "{exact:?} against {sampled:?}");
            }
        }
    }

    #[test]
    fn an_edge_runs_from_the_right_middle_to_the_left_middle() {
        let source = Rect::of_node(0.0, 0.0, 220.0, 64.0);
        let target = Rect::of_node(300.0, 100.0, 220.0, 64.0);
        let path = EdgePath::between(&source, &target);
        assert!(close(path.source, Point::new(220.0, 32.0)));
        assert!(close(path.target, Point::new(300.0, 132.0)));
    }

    #[test]
    fn the_halves_of_a_split_path_trace_the_path() {
        let path = EdgePath::horizontal(Point::new(10.0, 20.0), Point::new(300.0, 140.0), 40.0);
        let (left, right) = path.split();
        for i in 0..=10 {
            let t = f64::from(i) / 10.0;
            assert!(close(left.point_at(t), path.point_at(t / 2.0)));
            assert!(close(right.point_at(t), path.point_at(0.5 + t / 2.0)));
        }
    }

    #[test]
    fn rectangles_that_touch_meet() {
        let a = Rect::new(0.0, 0.0, 10.0, 10.0);
        assert!(a.meets(&Rect::new(10.0, 10.0, 20.0, 20.0)));
        assert!(!a.meets(&Rect::new(10.5, 0.0, 20.0, 10.0)));
        assert!(a.contains(Point::new(10.0, 0.0)));
        assert!(!a.contains(Point::new(-0.1, 5.0)));
    }

    /// The point of the curve at `t` by its Bernstein form, for comparison.
    fn bernstein(path: &EdgePath, t: f64) -> Point {
        let u = 1.0 - t;
        let w = [u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t];
        let p = [
            path.source,
            path.control_source,
            path.control_target,
            path.target,
        ];
        Point::new(
            (0..4).map(|i| w[i] * p[i].x).sum(),
            (0..4).map(|i| w[i] * p[i].y).sum(),
        )
    }

    /// The paths of the awkward cases: forward, backward, vertical, looped back, bent into an S.
    fn awkward_paths() -> [EdgePath; 5] {
        [
            EdgePath::horizontal(Point::new(10.0, 20.0), Point::new(300.0, 140.0), 40.0),
            EdgePath::horizontal(Point::new(300.0, 0.0), Point::new(0.0, 90.0), 40.0),
            EdgePath::horizontal(Point::new(50.0, 0.0), Point::new(50.0, 200.0), 40.0),
            EdgePath {
                source: Point::new(0.0, 0.0),
                control_source: Point::new(100.0, -80.0),
                control_target: Point::new(-50.0, 120.0),
                target: Point::new(60.0, 10.0),
            },
            EdgePath {
                source: Point::new(-20.0, 7.0),
                control_source: Point::new(-20.0, 300.0),
                control_target: Point::new(40.0, -300.0),
                target: Point::new(40.0, 7.0),
            },
        ]
    }

    #[test]
    fn the_control_points_pull_level_by_half_the_horizontal_distance_and_at_least_the_minimum() {
        // Forward, 290 apart: the pull is 145.
        let path = EdgePath::horizontal(Point::new(10.0, 20.0), Point::new(300.0, 140.0), 40.0);
        assert!(close(path.control_source, Point::new(155.0, 20.0)));
        assert!(close(path.control_target, Point::new(155.0, 140.0)));
        // Backward, 300 apart: the pull is 150, out beyond both ends.
        let path = EdgePath::horizontal(Point::new(300.0, 0.0), Point::new(0.0, 90.0), 40.0);
        assert!(close(path.control_source, Point::new(450.0, 0.0)));
        assert!(close(path.control_target, Point::new(-150.0, 90.0)));
        // 7 apart: the minimum of 40 pulls.
        let path = EdgePath::horizontal(Point::new(0.0, 0.0), Point::new(7.0, 50.0), 40.0);
        assert!(close(path.control_source, Point::new(40.0, 0.0)));
        assert!(close(path.control_target, Point::new(-33.0, 50.0)));
    }

    #[test]
    fn a_grown_rectangle_moves_each_side_outward() {
        let grown = Rect::new(-5.0, 10.0, 20.0, 40.0).grown(3.0);
        assert_eq!(grown, Rect::new(-8.0, 7.0, 23.0, 43.0));
    }

    #[test]
    fn the_tangent_is_the_unit_direction_of_travel() {
        // Verifies: Q-4
        let h = 1e-6;
        for path in awkward_paths() {
            for i in 0..=20 {
                let t = f64::from(i) / 20.0;
                // The direction by a difference of the curve's points around t, one-sided at the
                // ends.
                let (a, b) = ((t - h).max(0.0), (t + h).min(1.0));
                let (p, q) = (bernstein(&path, a), bernstein(&path, b));
                let length = (q.x - p.x).hypot(q.y - p.y);
                let expected = Point::new((q.x - p.x) / length, (q.y - p.y) / length);
                let tangent = path.tangent_at(t);
                assert!(
                    (tangent.x - expected.x).abs() < 1e-5 && (tangent.y - expected.y).abs() < 1e-5,
                    "{tangent:?} against {expected:?} at {t} of {path:?}"
                );
            }
        }
    }

    #[test]
    fn a_path_has_a_direction_down_to_a_derivative_of_epsilon() {
        // The boundary at epsilon is the threshold the code chose, not one of the geometry.
        // Leaving its source leftwards: the derivative at t = 0 is 3 (control_source - source),
        // exactly epsilon long.
        let step = -f64::EPSILON / 3.0;
        assert_eq!(3.0 * step, -f64::EPSILON);
        let path = EdgePath {
            source: Point::new(0.0, 0.0),
            control_source: Point::new(step, 0.0),
            control_target: Point::new(step, 0.0),
            target: Point::new(step, 0.0),
        };
        assert!(close(path.tangent_at(0.0), Point::new(-1.0, 0.0)));
    }

    #[test]
    fn a_label_sits_left_of_the_direction_of_travel_on_a_slanted_path() {
        // Verifies: G-6
        // A straight path from (0, 0) to (300, 400): direction (0.6, 0.8), whose left in screen
        // coordinates, y down, is (0.8, -0.6); the middle is (150, 200).
        let path = EdgePath {
            source: Point::new(0.0, 0.0),
            control_source: Point::new(100.0, 400.0 / 3.0),
            control_target: Point::new(200.0, 800.0 / 3.0),
            target: Point::new(300.0, 400.0),
        };
        assert!(close(
            path.label_position(0.5, 10.0),
            Point::new(158.0, 194.0)
        ));
        assert!(close(
            path.label_position(0.5, -10.0),
            Point::new(142.0, 206.0)
        ));
    }

    #[test]
    fn the_bounds_reach_exactly_to_where_the_path_turns() {
        // Backward from (300, 0) to (0, 90), pulled 150: x runs 300, 450, -150, 0, whose
        // derivative is 3 (1500 t² - 1500 t + 150), zero at t = (1 ∓ √0.6) / 2.
        let path = EdgePath::horizontal(Point::new(300.0, 0.0), Point::new(0.0, 90.0), 40.0);
        let (first, second) = ((1.0 - 0.6_f64.sqrt()) / 2.0, (1.0 + 0.6_f64.sqrt()) / 2.0);
        let bounds = path.bounds();
        assert!((bounds.max_x - bernstein(&path, first).x).abs() < EPS);
        assert!((bounds.min_x - bernstein(&path, second).x).abs() < EPS);
        assert_eq!((bounds.min_y, bounds.max_y), (0.0, 90.0));
        // y runs 0, 40, 40, 0, whose derivative is linear (the cubic term vanishes) and zero at
        // t = 0.5, where y is 30; x runs 0, 30, 60, 90 and turns nowhere.
        let path = EdgePath {
            source: Point::new(0.0, 0.0),
            control_source: Point::new(30.0, 40.0),
            control_target: Point::new(60.0, 40.0),
            target: Point::new(90.0, 0.0),
        };
        let bounds = path.bounds();
        assert!(close(
            Point::new(bounds.min_x, bounds.min_y),
            Point::new(0.0, 0.0)
        ));
        assert!(close(
            Point::new(bounds.max_x, bounds.max_y),
            Point::new(90.0, 30.0)
        ));
        // Mirrored, y runs 0, -40, -40, 0 and turns at -30.
        let path = EdgePath {
            control_source: Point::new(30.0, -40.0),
            control_target: Point::new(60.0, -40.0),
            ..path
        };
        assert!((path.bounds().min_y + 30.0).abs() < EPS);
        // An S whose x runs 10, 16, 4, 10, so x - 10 = 18 t (1 - t) (1 - 2 t): the derivative
        // 3 (36 t² - 36 t + 6) is zero at t = (1 ∓ √(1/3)) / 2, where x is 10 ± √3.
        let path = EdgePath {
            source: Point::new(10.0, 5.0),
            control_source: Point::new(16.0, 5.0),
            control_target: Point::new(4.0, 5.0),
            target: Point::new(10.0, 5.0),
        };
        let bounds = path.bounds();
        assert!((bounds.max_x - (10.0 + 3.0_f64.sqrt())).abs() < EPS);
        assert!((bounds.min_x - (10.0 - 3.0_f64.sqrt())).abs() < EPS);
    }

    /// The greatest value of `f` on 0..=1 where it rises to one peak, by ternary search.
    fn peak(f: impl Fn(f64) -> f64) -> f64 {
        let (mut lo, mut hi) = (0.0, 1.0);
        for _ in 0..200 {
            let (a, b) = (lo + (hi - lo) / 3.0, hi - (hi - lo) / 3.0);
            if f(a) < f(b) {
                lo = a;
            } else {
                hi = b;
            }
        }
        f((lo + hi) / 2.0)
    }

    #[test]
    fn the_bounds_hold_a_path_whose_turning_point_is_ill_conditioned_or_tiny() {
        // Verifies: Q-4
        // y runs 0, 1, 1, 1e-11: the cubic term of the derivative is 1e-11, so small that the
        // textbook root (-b - √(b² - 4ac)) / 2a loses most of its digits.
        let flat = EdgePath {
            source: Point::new(0.0, 0.0),
            control_source: Point::new(1.0, 1.0),
            control_target: Point::new(2.0, 1.0),
            target: Point::new(3.0, 1e-11),
        };
        // Arched and 1e-13 wide, as at a tiny scale: y runs 0, 4e-13, 4e-13, 0 and peaks at 3e-13.
        let tiny = EdgePath {
            source: Point::new(0.0, 0.0),
            control_source: Point::new(1e-13, 4e-13),
            control_target: Point::new(2e-13, 4e-13),
            target: Point::new(3e-13, 0.0),
        };
        for path in [flat, tiny] {
            let expected = peak(|t| bernstein(&path, t).y);
            let max_y = path.bounds().max_y;
            assert!(
                (max_y - expected).abs() <= 1e-15 * expected,
                "{max_y} against {expected} for {path:?}"
            );
        }
        assert!((peak(|t| bernstein(&tiny, t).y) - 3e-13).abs() < 1e-27);
    }

    /// A small generator of numbers with a fixed seed (SplitMix64): the core takes no crate that
    /// reaches randomness (ADR-0009).
    struct Numbers(u64);

    impl Numbers {
        /// The next number, uniform in 0..1.
        fn unit(&mut self) -> f64 {
            self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^= z >> 31;
            // The top 52 bits as the fraction of a number in 1..2.
            f64::from_bits(0x3FF0_0000_0000_0000 | (z >> 12)) - 1.0
        }

        /// The next number, uniform in `lo..hi`.
        fn uniform(&mut self, lo: f64, hi: f64) -> f64 {
            lo + (hi - lo) * self.unit()
        }

        /// A scale from 1e-13 to 1e6, uniform in its exponent.
        fn scale(&mut self) -> f64 {
            10_f64.powf(self.uniform(-13.0, 6.0))
        }

        /// A coordinate within `scale` of the origin.
        fn coordinate(&mut self, scale: f64) -> f64 {
            self.uniform(-scale, scale)
        }

        /// A term so small beside `scale` that a derivative's root by it is ill-conditioned:
        /// from 1e-16 to 1e-6 of `scale`, of either sign.
        fn sliver(&mut self, scale: f64) -> f64 {
            let sign = if self.unit() < 0.5 { -1.0 } else { 1.0 };
            sign * scale * 10_f64.powf(self.uniform(-16.0, -6.0))
        }
    }

    /// One path of each kind the test draws, by its index: as `EdgePath::between` builds it
    /// (forwards, backwards, or level), and of arbitrary control points, some with a cubic or a
    /// quadratic term of a coordinate's derivative that nearly vanishes.
    fn drawn_path(numbers: &mut Numbers, index: usize) -> EdgePath {
        let s = numbers.scale();
        match index % 6 {
            // Between two nodes, the target right of, left of, or level with the source.
            kind @ 0..=2 => {
                let source = Rect::of_node(
                    numbers.coordinate(s),
                    numbers.coordinate(s),
                    numbers.uniform(0.0, s),
                    numbers.uniform(0.0, s),
                );
                let height = numbers.uniform(0.0, s);
                let x = match kind {
                    0 => source.max_x + numbers.uniform(0.0, 2.0 * s),
                    _ => source.min_x - numbers.uniform(0.0, 2.0 * s),
                };
                let y = if kind == 2 {
                    (source.min_y + source.max_y - height) / 2.0
                } else {
                    numbers.coordinate(s)
                };
                EdgePath::between(
                    &source,
                    &Rect::of_node(x, y, numbers.uniform(0.0, s), height),
                )
            }
            // As between builds it, with the minimum pull at the path's own scale.
            3 => EdgePath::horizontal(
                Point::new(numbers.coordinate(s), numbers.coordinate(s)),
                Point::new(numbers.coordinate(s), numbers.coordinate(s)),
                numbers.uniform(0.0, s),
            ),
            // Arbitrary control points, and the same with a near-vanishing cubic or quadratic
            // term: a = -p0 + 3 p1 - 3 p2 + p3 and b / 2 = p0 - 2 p1 + p2.
            kind => {
                let mut p: [Point; 4] = core::array::from_fn(|_| {
                    Point::new(numbers.coordinate(s), numbers.coordinate(s))
                });
                for axis in [0, 1] {
                    let mut c = p.map(|q| if axis == 0 { q.x } else { q.y });
                    if kind == 4 {
                        c[3] = c[0] - 3.0 * c[1] + 3.0 * c[2] + numbers.sliver(s);
                    } else if kind == 5 && numbers.unit() < 0.5 {
                        c[2] = 2.0 * c[1] - c[0] + numbers.sliver(s);
                    }
                    for (q, v) in p.iter_mut().zip(c) {
                        if axis == 0 {
                            q.x = v;
                        } else {
                            q.y = v;
                        }
                    }
                }
                EdgePath {
                    source: p[0],
                    control_source: p[1],
                    control_target: p[2],
                    target: p[3],
                }
            }
        }
    }

    #[test]
    fn the_bounds_hold_every_path_drawn_from_a_fixed_seed_and_no_more() {
        // Verifies: Q-4
        const PATHS: usize = 6_000;
        const SAMPLES: u32 = 512;
        /// How far the bounds may miss a sampled point, or overreach the sampled bounds beyond
        /// the sampling error, relative to the scale of the path in that coordinate: the
        /// rounding of two evaluations.
        const TOLERANCE: f64 = 1e-13;
        // The weights of `bernstein`, once for every sample rather than per path and point.
        let weights: Vec<[f64; 4]> = (0..=SAMPLES)
            .map(|i| {
                let t = f64::from(i) / f64::from(SAMPLES);
                let u = 1.0 - t;
                [u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t]
            })
            .collect();
        let mut numbers = Numbers(0x5EED_C0DE_B0B5_F00D);
        for index in 0..PATHS {
            let path = drawn_path(&mut numbers, index);
            let bounds = path.bounds();
            let p = [
                path.source,
                path.control_source,
                path.control_target,
                path.target,
            ];
            // Each coordinate rounds by its own magnitudes, so each has its own tolerance.
            let tx = TOLERANCE * p.iter().fold(0.0_f64, |m, q| m.max(q.x.abs()));
            let ty = TOLERANCE * p.iter().fold(0.0_f64, |m, q| m.max(q.y.abs()));
            // The curve by its Bernstein form, sampled at every weight, and the sampled bounds
            // as min_x, min_y, max_x, max_y.
            let mut sampled = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
            for w in &weights {
                let x: f64 = (0..4).map(|i| w[i] * p[i].x).sum();
                let y: f64 = (0..4).map(|i| w[i] * p[i].y).sum();
                assert!(
                    x >= bounds.min_x - tx
                        && x <= bounds.max_x + tx
                        && y >= bounds.min_y - ty
                        && y <= bounds.max_y + ty,
                    "path {index}: ({x}, {y}) lies outside {bounds:?} for {path:?}"
                );
                sampled = [
                    sampled[0].min(x),
                    sampled[1].min(y),
                    sampled[2].max(x),
                    sampled[3].max(y),
                ];
            }
            // Between two samples, a coordinate rises past the nearer at most f'' h² / 8, and
            // |f''| <= 6 max(|p0 - 2 p1 + p2|, |p1 - 2 p2 + p3|).
            let h = 1.0 / f64::from(SAMPLES);
            let error = |c: [f64; 4], tolerance: f64| {
                6.0 * (c[0] - 2.0 * c[1] + c[2])
                    .abs()
                    .max((c[1] - 2.0 * c[2] + c[3]).abs())
                    * h
                    * h
                    / 8.0
                    + tolerance
            };
            let (ex, ey) = (error(p.map(|q| q.x), tx), error(p.map(|q| q.y), ty));
            assert!(
                bounds.min_x >= sampled[0] - ex
                    && bounds.min_y >= sampled[1] - ey
                    && bounds.max_x <= sampled[2] + ex
                    && bounds.max_y <= sampled[3] + ey,
                "path {index}: {bounds:?} reaches beyond {sampled:?} for {path:?}"
            );
        }
    }

    #[test]
    fn a_degenerate_path_has_a_defined_tangent() {
        let p = Point::new(5.0, 5.0);
        let path = EdgePath {
            source: p,
            control_source: p,
            control_target: p,
            target: p,
        };
        assert!(close(path.tangent_at(0.5), Point::new(1.0, 0.0)));
    }
}
