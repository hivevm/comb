//! Edge paths and edge-label placement.
//!
//! An edge is a cubic Bézier curve from its source connector to its target connector. An edge
//! label sits at the point of the path parameter `t` and is moved by the label offset along the
//! path's normal there (G-6). An edge leaves its source node at the middle of its right side and
//! enters its target node at the middle of its left side.

/// A point in world coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    fn lerp(self, other: Self, t: f64) -> Self {
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

/// The values of `t` in (0, 1) where one coordinate of a cubic Bézier curve has an extremum: the
/// roots of its derivative, a quadratic.
fn extrema(p0: f64, p1: f64, p2: f64, p3: f64) -> impl Iterator<Item = f64> {
    let a = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
    let b = 2.0 * (p0 - 2.0 * p1 + p2);
    let c = p1 - p0;
    let roots = if a.abs() < 1e-12 {
        [(b.abs() >= 1e-12).then(|| -c / b), None]
    } else {
        let discriminant = b * b - 4.0 * a * c;
        if discriminant < 0.0 {
            [None, None]
        } else {
            let root = discriminant.sqrt();
            [Some((-b + root) / (2.0 * a)), Some((-b - root) / (2.0 * a))]
        }
    };
    roots.into_iter().flatten().filter(|t| *t > 0.0 && *t < 1.0)
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
