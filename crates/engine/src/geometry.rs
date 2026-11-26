//! Edge paths and edge-label placement.
//!
//! An edge is a cubic Bézier curve from its source end to its target end, each at the connector
//! of a side or on the node's outline (API-edges-dock-nodes-or-edges). An edge label sits at the
//! point of the path parameter `t` and is moved by the label offset along the path's normal there
//! (G-6). An edge that names no side leaves its source node at the middle of its right side and
//! enters its target node at the middle of its left side.

use crate::shape::NodeShape;

/// How far from the world's origin the graph lies, in world units, 2^120: every node within it on
/// each axis, its far side included, and every label offset within it. Every point the engine
/// derives from them, a connector, a control point, a vertex, a label point, lies within three
/// times this, and the width of a stroke within `PIXEL_LIMIT`'s, so that each stays far within
/// `f32`, whose largest value is about 2^128; relative to the origin of a query that draws it,
/// which lies within half its grid of the rectangle's centre, at most 2^127
/// (API-bridge-columns-keep-no-size), too.
pub const WORLD_LIMIT: f64 = 1_329_227_995_784_915_872_903_807_060_280_344_576.0;

/// The largest screen pixel a query strokes for, 2^114 world units: far beyond the shell's least
/// zoom, and small enough that no stroke or arrowhead reaches past a sixth of `WORLD_LIMIT`.
pub(crate) const PIXEL_LIMIT: f64 = WORLD_LIMIT / 64.0;

/// `pixel` as a query and a hit test take it: a screen pixel beyond any zoom is the largest a query
/// strokes for, `PIXEL_LIMIT`, so that every reach and stroke derived from it stays finite.
pub(crate) fn bounded_pixel(pixel: f64) -> f64 {
    pixel.min(PIXEL_LIMIT)
}

/// Below this, the squares of `length` may underflow, and it asks `hypot` instead.
const LENGTH_FLOOR: f64 = 1e-150;

/// The length of the vector `(dx, dy)`, as `f64::hypot` gives it within a few units in the last
/// place, without its cost: WebAssembly has no fused multiply-add, and libm's `hypot` emulates
/// one in software. The squares cannot overflow for a vector between two points within three
/// times `WORLD_LIMIT`, nor for one from a pressed point to a path or connector, which a hit test
/// measures only once the point lies within the reach of a `PIXEL_LIMIT` of their bounds; where
/// they may underflow, the length is `hypot`'s.
pub(crate) fn length(dx: f64, dy: f64) -> f64 {
    let length = (dx * dx + dy * dy).sqrt();
    if length >= LENGTH_FLOOR {
        length
    } else {
        tiny_length(dx, dy)
    }
}

#[expect(
    clippy::disallowed_methods,
    reason = "only for a length whose squares may underflow, which is rare and needs its accuracy"
)]
fn tiny_length(dx: f64, dy: f64) -> f64 {
    dx.hypot(dy)
}

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

/// A side of a node, at whose middle its connector sits (API-edges-dock-nodes-or-edges).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Side {
    Top,
    #[default]
    Right,
    Bottom,
    Left,
}

/// Where an end of an edge docks: at the connector of a side, or on the node's outline
/// (API-edges-dock-nodes-or-edges).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dock {
    Side(Side),
    Outline,
}

impl From<Side> for Dock {
    fn from(side: Side) -> Self {
        Self::Side(side)
    }
}

/// Where an edge leaves its source and enters its target: by default the right side of its
/// source and the left side of its target (API-edges-dock-nodes-or-edges).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Sides {
    pub source: Dock,
    pub target: Dock,
}

impl Default for Sides {
    fn default() -> Self {
        Self {
            source: Dock::Side(Side::Right),
            target: Dock::Side(Side::Left),
        }
    }
}

impl Side {
    /// The connector of this side of `node`: the middle of the side.
    pub(crate) fn connector(self, node: &Rect) -> Point {
        let (mid_x, mid_y) = (
            (node.min_x + node.max_x) / 2.0,
            (node.min_y + node.max_y) / 2.0,
        );
        match self {
            Self::Top => Point::new(mid_x, node.min_y),
            Self::Right => Point::new(node.max_x, mid_y),
            Self::Bottom => Point::new(mid_x, node.max_y),
            Self::Left => Point::new(node.min_x, mid_y),
        }
    }

    /// This side's outward normal.
    const fn outward(self) -> Point {
        match self {
            Self::Top => Point::new(0.0, -1.0),
            Self::Right => Point::new(1.0, 0.0),
            Self::Bottom => Point::new(0.0, 1.0),
            Self::Left => Point::new(-1.0, 0.0),
        }
    }
}

/// The centre of `node`.
pub(crate) fn centre(node: &Rect) -> Point {
    Point::new(
        (node.min_x + node.max_x) / 2.0,
        (node.min_y + node.max_y) / 2.0,
    )
}

/// Where an edge's end docked by `dock` on `node`, of node shape `shape`, lies, and the unit
/// direction its control point pulls out in: a side's connector and its outward normal, or the
/// point where the line from the node's centre towards `other`, the centre of the node at the
/// edge's other end, crosses its outline, and that line's direction, none where the two centres
/// meet (API-edges-dock-nodes-or-edges).
pub(crate) fn end_of(dock: Dock, node: &Rect, shape: NodeShape, other: Point) -> (Point, Point) {
    match dock {
        Dock::Side(side) => (side.connector(node), side.outward()),
        Dock::Outline => {
            let from = centre(node);
            let (dx, dy) = (other.x - from.x, other.y - from.y);
            let (x, y) = shape.crossing(node.max_x - node.min_x, node.max_y - node.min_y, dx, dy);
            let length = length(dx, dy);
            let direction = if length == 0.0 {
                Point::default()
            } else {
                Point::new(dx / length, dy / length)
            };
            (Point::new(node.min_x + x, node.min_y + y), direction)
        }
    }
}

/// Where an end on an edge lies, and the unit direction its control point pulls out in: the point
/// of that edge's `path` at the path parameter `t`, and the path's normal there on the side of
/// `toward`, the point of the edge's other end; the normal to the left of the path's direction
/// where `toward` lies on its tangent (API-edges-dock-nodes-or-edges, *An end on an edge*).
pub(crate) fn on_edge(path: &EdgePath, t: f64, toward: Point) -> (Point, Point) {
    let point = path.point_at(t);
    let tangent = path.tangent_at(t);
    let left = Point::new(tangent.y, -tangent.x);
    let side = (toward.x - point.x) * left.x + (toward.y - point.y) * left.y;
    let normal = if side < 0.0 {
        Point::new(-left.x, -left.y)
    } else {
        left
    };
    (point, normal)
}

/// The path parameters between which a lightning bolt's zigzag replaces the path, and how wide
/// the zigzag is across it, in world units (API-edges-dock-nodes-or-edges, *Lightning bolt*).
pub(crate) const LIGHTNING_FROM: f64 = 0.45;
pub(crate) const LIGHTNING_TO: f64 = 0.55;
pub(crate) const LIGHTNING_WIDTH: f64 = 12.0;

/// The four control points of an edge's cubic Bézier path.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct EdgePath {
    pub(crate) source: Point,
    pub(crate) control_source: Point,
    pub(crate) control_target: Point,
    pub(crate) target: Point,
}

impl EdgePath {
    /// The path from a connector on the right side of a node to one on the left side of
    /// another, as it was before edges named their sides, which `between` keeps from the right to
    /// the left: the control points pull horizontally, half the horizontal distance and at least
    /// `min_pull`, so an edge leaves and enters its connectors level.
    #[cfg(test)]
    pub(crate) fn horizontal(source: Point, target: Point, min_pull: f64) -> Self {
        let pull = ((target.x - source.x).abs() / 2.0).max(min_pull);
        Self {
            source,
            control_source: Point::new(source.x + pull, source.y),
            control_target: Point::new(target.x - pull, target.y),
            target,
        }
    }

    /// `docked`'s path between two rectangles, the node shape of a node that names none.
    #[cfg(test)]
    pub(crate) fn between(source: &Rect, target: &Rect, sides: Sides) -> Self {
        Self::docked(
            (source, NodeShape::Rectangle),
            (target, NodeShape::Rectangle),
            sides,
        )
    }

    /// The path from the end of `sides.source` on the `source` node to that of `sides.target` on
    /// the `target` node, each node by its rectangle and its node shape
    /// (API-edges-dock-nodes-or-edges). An end on a side lies at that side's connector and pulls
    /// out along its outward normal; an end on the outline lies where the line from its node's
    /// centre towards the other node's centre crosses its outline and pulls out along that line.
    /// Each control point lies half the distance between the ends along its direction out, and at
    /// least `MIN_PULL`. From the right to the left it is `horizontal`'s path, to the bit. The
    /// graph places an edge between two nodes by the same steps, which the tests hold it to.
    #[cfg(test)]
    pub(crate) fn docked(
        (source, source_shape): (&Rect, NodeShape),
        (target, target_shape): (&Rect, NodeShape),
        sides: Sides,
    ) -> Self {
        let (source_centre, target_centre) = (centre(source), centre(target));
        Self::joining(
            end_of(sides.source, source, source_shape, target_centre),
            end_of(sides.target, target, target_shape, source_centre),
        )
    }

    /// The path from the end `from` to the end `to`, each a point and the unit direction its
    /// control point pulls out in: each control point lies half the distance between the two ends
    /// along its direction, and at least `MIN_PULL` (API-edges-dock-nodes-or-edges, *The path
    /// between two nodes*, *An end on an edge*).
    pub(crate) fn joining((from, out): (Point, Point), (to, back): (Point, Point)) -> Self {
        let pulled = |end: Point, n: Point| {
            let along = ((to.x - from.x) * n.x + (to.y - from.y) * n.y).abs();
            let pull = (along / 2.0).max(MIN_PULL);
            Point::new(end.x + n.x * pull, end.y + n.y * pull)
        };
        Self {
            source: from,
            control_source: pulled(from, out),
            control_target: pulled(to, back),
            target: to,
        }
    }

    /// The path from `from` to `to` along the straight line between them, each control point
    /// pulled inward along it by half the distance between the two ends: the path of an edge
    /// between a container and a node it holds, both on the outline, which so stays inside the
    /// container (API-edges-dock-nodes-or-edges, *An end on a container toward a node it holds*).
    pub(crate) fn inward(from: Point, to: Point) -> Self {
        let middle = from.lerp(to, 0.5);
        Self {
            source: from,
            control_source: middle,
            control_target: middle,
            target: to,
        }
    }

    /// The path of a loop, an edge from `node`, of node shape `shape`, back to itself
    /// (API-edges-dock-nodes-or-edges): it leaves and re-enters the side `dock` names, the top
    /// where it names the outline, a quarter of that side's length either side of its middle, the
    /// source end first clockwise, and its control points lie outward along the side's normal, as
    /// far out as the side is long and at least `MIN_PULL`. Each end then moves inward along the
    /// normal onto the outline of `shape`, its control point with it; both by the same distance, so
    /// the loop keeps its shape. So its path parameter 0.5 is its outermost point, where the path
    /// runs along the side and a label offset to its left stands outward, and it enters the node
    /// against the normal. On a rectangle and a bar nothing moves.
    pub(crate) fn looped(node: &Rect, shape: NodeShape, dock: Dock) -> Self {
        let side = match dock {
            Dock::Side(side) => side,
            Dock::Outline => Side::Top,
        };
        let (mut middle, n) = (side.connector(node), side.outward());
        let (width, height) = (node.max_x - node.min_x, node.max_y - node.min_y);
        let length = crate::shape::side_length(width, height, side);
        let (quarter, pull) = (length / 4.0, length.max(MIN_PULL));
        // Left alone where it is nil, so that a loop whose ends do not move is today's to the bit.
        // It is the same at both ends on every node shape: a pentagon's point, a notch, and a
        // note's fold reach no further along a side than a quarter of it (`depth`, `fold`).
        let inset = shape.inset(side, width, height, length / 2.0 - quarter);
        if inset > 0.0 {
            middle = Point::new(middle.x - n.x * inset, middle.y - n.y * inset);
        }
        // Clockwise: the normal turned a quarter against the clock points to the source's end.
        let along = Point::new(n.y * quarter, -n.x * quarter);
        let source = Point::new(middle.x + along.x, middle.y + along.y);
        let target = Point::new(middle.x - along.x, middle.y - along.y);
        let out = |end: Point| Point::new(end.x + n.x * pull, end.y + n.y * pull);
        Self {
            source,
            control_source: out(source),
            control_target: out(target),
            target,
        }
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
        self.split_at(0.5)
    }

    /// The part of the path between the path parameters `from` and `to`, each clamped to
    /// 0.0..=1.0, as a cubic of its own (de Casteljau).
    pub(crate) fn between_parameters(&self, from: f64, to: f64) -> Self {
        let (from, to) = (from.clamp(0.0, 1.0), to.clamp(0.0, 1.0));
        let after = self.split_at(from).1;
        // The part after `from` runs on to the end; `to` lies at its own parameter in it.
        let rest = 1.0 - from;
        let within = if rest > 0.0 { (to - from) / rest } else { 0.0 };
        after.split_at(within).0
    }

    /// The two parts of the path, split at path parameter `t` (de Casteljau).
    fn split_at(&self, t: f64) -> (Self, Self) {
        let ab = self.source.lerp(self.control_source, t);
        let bc = self.control_source.lerp(self.control_target, t);
        let cd = self.control_target.lerp(self.target, t);
        let abc = ab.lerp(bc, t);
        let bcd = bc.lerp(cd, t);
        let at = abc.lerp(bcd, t);
        (
            Self {
                source: self.source,
                control_source: ab,
                control_target: abc,
                target: at,
            },
            Self {
                source: at,
                control_source: bcd,
                control_target: cd,
                target: self.target,
            },
        )
    }

    /// The path drawn as a lightning bolt (API-edges-dock-nodes-or-edges, *Lightning bolt*): the
    /// part before `LIGHTNING_FROM`, the two turns of the zigzag across the path, each half of
    /// `LIGHTNING_WIDTH` off it on either side, at a third and two thirds of the way between
    /// `LIGHTNING_FROM` and `LIGHTNING_TO`, and the part after `LIGHTNING_TO`. The zigzag runs from
    /// the end of the first part through the turns to the start of the last.
    pub(crate) fn lightning(&self) -> (Self, [Point; 2], Self) {
        let third = (LIGHTNING_TO - LIGHTNING_FROM) / 3.0;
        let half = LIGHTNING_WIDTH / 2.0;
        (
            self.between_parameters(0.0, LIGHTNING_FROM),
            [
                self.label_position(LIGHTNING_FROM + third, half),
                self.label_position(LIGHTNING_TO - third, -half),
            ],
            self.between_parameters(LIGHTNING_TO, 1.0),
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
        let length = length(dx, dy);
        if length < f64::EPSILON {
            Point::new(1.0, 0.0)
        } else {
            Point::new(dx / length, dy / length)
        }
    }

    /// The path parameter and label offset that place a label at `p`: the parameter of the path
    /// point nearest `p`, and how far `p` lies from it along the normal there, so that
    /// `label_position` of the two is `p` where that nearest point lies inside the path (G-6).
    pub(crate) fn placement_at(&self, p: Point) -> (f64, f64) {
        let squared = |t: f64| {
            let q = self.point_at(t);
            (q.x - p.x).powi(2) + (q.y - p.y).powi(2)
        };
        // Coarsely, then within the bracket of the nearest sample by ternary search; a cubic's
        // distance has at most a few minima, which samples this close apart do not straddle.
        let n = 256;
        let best = (0..=n)
            .map(|i| f64::from(i) / f64::from(n))
            .min_by(|a, b| squared(*a).total_cmp(&squared(*b)))
            .unwrap_or(0.0);
        let step = 1.0 / f64::from(n);
        let (mut from, mut to) = ((best - step).max(0.0), (best + step).min(1.0));
        for _ in 0..100 {
            let (m1, m2) = (from + (to - from) / 3.0, to - (to - from) / 3.0);
            if squared(m1) < squared(m2) {
                to = m2;
            } else {
                from = m1;
            }
        }
        let t = (from + to) / 2.0;
        let (point, tangent) = (self.point_at(t), self.tangent_at(t));
        let offset = (p.x - point.x) * tangent.y - (p.y - point.y) * tangent.x;
        (t, offset)
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
pub(crate) mod tests {
    use super::*;

    const EPS: f64 = 1e-9;

    fn close(a: Point, b: Point) -> bool {
        (a.x - b.x).abs() < EPS && (a.y - b.y).abs() < EPS
    }

    fn straight() -> EdgePath {
        EdgePath::horizontal(Point::new(0.0, 0.0), Point::new(200.0, 0.0), 10.0)
    }

    #[test]
    fn a_lightning_bolts_turns_lie_between_045_and_055_six_off_the_path_on_either_side() {
        // Verifies: API-edges-dock-nodes-or-edges
        // A curved path from (0, 0) to (400, 120) and the parts either side of its zigzag: the
        // turns lie at their parameters, 6 off the path to its left and then its right, and the
        // parts meet the path at 0.45 and 0.55, the first from the source, the last to the target.
        let path = EdgePath::horizontal(Point::new(0.0, 0.0), Point::new(400.0, 120.0), 40.0);
        let (before, [one, other], after) = path.lightning();
        for ((turn, t), offset) in [one, other]
            .into_iter()
            .zip([0.45 + 0.1 / 3.0, 0.55 - 0.1 / 3.0])
            .zip([6.0, -6.0])
        {
            let (found, off) = path.placement_at(turn);
            assert!(
                (found - t).abs() < 1e-6 && (0.45..=0.55).contains(&found),
                "{found}"
            );
            assert!((off - offset).abs() < 1e-6, "{off}");
        }
        assert!(close(before.source, path.source) && close(after.target, path.target));
        assert!(close(before.target, path.point_at(0.45)));
        assert!(close(after.source, path.point_at(0.55)));
        // Each part is the path between its parameters.
        for i in 0..=10 {
            let u = f64::from(i) / 10.0;
            assert!(close(before.point_at(u), path.point_at(0.45 * u)), "{u}");
            assert!(
                close(after.point_at(u), path.point_at(0.55 + 0.45 * u)),
                "{u}"
            );
        }
    }

    #[test]
    fn a_length_holds_where_its_squares_would_underflow() {
        // Decides no criterion: it pins `length` where its squares alone would give 0, as a hit
        // test at a pixel of 1e-200 asks; the expected lengths are worked out by hand.
        assert_eq!(length(3.0, 4.0), 5.0);
        assert_eq!(length(-1e-170, 0.0), 1e-170);
        assert_eq!(length(0.0, 2e-300), 2e-300);
        let tiny = length(3e-160, 4e-160);
        assert!(
            (tiny - 5e-160).abs() <= 4.0 * f64::EPSILON * 5e-160,
            "{tiny}"
        );
    }

    #[test]
    fn each_of_the_sixteen_pairs_of_sides_runs_from_connector_to_connector_along_their_normals() {
        // Verifies: API-edges-dock-nodes-or-edges
        let sides = [Side::Top, Side::Right, Side::Bottom, Side::Left];
        let outward = |side: Side| match side {
            Side::Top => (0.0, -1.0),
            Side::Right => (1.0, 0.0),
            Side::Bottom => (0.0, 1.0),
            Side::Left => (-1.0, 0.0),
        };
        let source = Rect::of_node(0.0, 0.0, 220.0, 64.0);
        // Below and to the right, and above and to the left, of the source, and level with it.
        for target in [
            Rect::of_node(400.0, 300.0, 220.0, 64.0),
            Rect::of_node(-500.0, -260.0, 100.0, 40.0),
            Rect::of_node(300.0, 0.0, 220.0, 64.0),
        ] {
            for (from, to) in sides
                .iter()
                .flat_map(|&a| sides.iter().map(move |&b| (a, b)))
            {
                let path = EdgePath::between(
                    &source,
                    &target,
                    Sides {
                        source: from.into(),
                        target: to.into(),
                    },
                );
                let (sx, sy) = (
                    [110.0, 220.0, 110.0, 0.0][from as usize],
                    [0.0, 32.0, 64.0, 32.0][from as usize],
                );
                assert_eq!(path.source, Point::new(sx, sy), "{from:?} to {to:?}");
                assert_eq!(path.target, to.connector(&target), "{from:?} to {to:?}");
                // It leaves along the source side's outward normal and enters against the target
                // side's: the tangent at each end is parallel to the normal, pointing out at the
                // start and in at the end.
                let (nx, ny) = outward(from);
                let leave = path.tangent_at(0.0);
                assert!(
                    (leave.x * ny - leave.y * nx).abs() < 1e-9,
                    "{from:?} to {to:?}"
                );
                assert!(leave.x * nx + leave.y * ny > 0.0, "{from:?} to {to:?}");
                // Each control point lies on its end's normal, half the distance between the
                // ends along that normal's axis out, and at least 40.
                let pull = |side: Side, end: Point, control: Point| {
                    let (x, y) = outward(side);
                    let along = if x == 0.0 {
                        (path.target.y - path.source.y).abs()
                    } else {
                        (path.target.x - path.source.x).abs()
                    };
                    let out = (along / 2.0).max(40.0);
                    assert_eq!(control, Point::new(end.x + x * out, end.y + y * out));
                };
                pull(from, path.source, path.control_source);
                pull(to, path.target, path.control_target);
                let (mx, my) = outward(to);
                let enter = path.tangent_at(1.0);
                assert!(
                    (enter.x * my - enter.y * mx).abs() < 1e-9,
                    "{from:?} to {to:?}"
                );
                assert!(enter.x * mx + enter.y * my < 0.0, "{from:?} to {to:?}");
            }
        }
    }

    /// Asserts that `end` lies on the outline of `node`, of node shape `shape`, on the line from
    /// its centre towards `other`: hit a hair inside it, not a hair outside it, and off that line
    /// by no more than `tolerance` world units, on the side of `other`.
    pub(crate) fn on_the_outline_towards(
        end: Point,
        node: &Rect,
        shape: NodeShape,
        other: Point,
        tolerance: f64,
    ) {
        let (width, height) = (node.max_x - node.min_x, node.max_y - node.min_y);
        let c = centre(node);
        let (px, py) = (end.x - c.x, end.y - c.y);
        let (dx, dy) = (other.x - c.x, other.y - c.y);
        let towards = dx.hypot(dy);
        let context = format!("{shape:?} {node:?} towards {other:?}: {end:?}");
        assert!(
            (px * dy - py * dx).abs() / towards <= tolerance,
            "off the line, {context}"
        );
        assert!(px * dx + py * dy > 0.0, "backwards, {context}");
        let length = px.hypot(py);
        let hair = |by: f64| {
            shape.contains(
                width,
                height,
                width / 2.0 + px * (1.0 + by / length),
                height / 2.0 + py * (1.0 + by / length),
            )
        };
        assert!(hair(-tolerance), "outside the outline, {context}");
        // A note is hit as its bounding rectangle, beyond its outline at its fold.
        let (x, y) = (end.x - node.min_x, end.y - node.min_y);
        if shape == NodeShape::Note && x > width - crate::shape::fold(width, height) {
            let off = crate::shape::tests::off_outline(shape, width, height, x, y);
            assert!(off <= tolerance, "off the outline, {context}");
        } else {
            assert!(!hair(tolerance), "inside the outline, {context}");
        }
    }

    #[test]
    fn an_end_on_the_outline_lies_where_the_line_between_the_centres_crosses_it_for_every_node_shape()
     {
        // Verifies: API-edges-dock-nodes-or-edges, Q-4
        // Every pair of node shapes, the target all around the source: level, above, below,
        // behind, overlapping it, and far from the world's origin, where the end still lies
        // within Q-4's half pixel at the zoom of 1, its world units.
        let offsets = (0..24).map(|i| {
            let angle = f64::from(i) * core::f64::consts::TAU / 24.0;
            (angle.cos(), angle.sin())
        });
        let outline = Sides {
            source: Dock::Outline,
            target: Dock::Outline,
        };
        for (ox, oy) in offsets {
            for (origin, distance) in [(0.0, 400.0), (0.0, 90.0), (-3e6, 2e5), (1e7, 600.0)] {
                for from in NodeShape::ALL {
                    for to in NodeShape::ALL {
                        let source = Rect::of_node(origin, origin * 0.5, 120.0, 60.0);
                        let c = centre(&source);
                        let (tx, ty) = (c.x + ox * distance, c.y + oy * distance);
                        let target = Rect::of_node(tx - 40.0, ty - 25.0, 80.0, 50.0);
                        let path = EdgePath::docked((&source, from), (&target, to), outline);
                        let tolerance = 1e-9 * (1.0 + origin.abs());
                        on_the_outline_towards(
                            path.source,
                            &source,
                            from,
                            centre(&target),
                            tolerance,
                        );
                        on_the_outline_towards(path.target, &target, to, c, tolerance);
                        // Each control point lies on that line, outward, half the distance
                        // between the ends along it and at least 40 out; the arrowhead's tip is
                        // the target's end, and it points along the line into the target.
                        let gap =
                            (path.target.x - path.source.x).hypot(path.target.y - path.source.y);
                        let pull = (gap / 2.0).max(MIN_PULL);
                        let (ux, uy) = (ox, oy);
                        let expected =
                            Point::new(path.source.x + ux * pull, path.source.y + uy * pull);
                        assert!(
                            (path.control_source.x - expected.x).abs() <= tolerance * 10.0
                                && (path.control_source.y - expected.y).abs() <= tolerance * 10.0,
                            "{from:?} to {to:?}: {path:?}"
                        );
                        let enter = path.tangent_at(1.0);
                        assert!(
                            (enter.x - ux).abs() < 1e-6 && (enter.y - uy).abs() < 1e-6,
                            "{from:?} to {to:?}: enters along {enter:?}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn an_end_naming_a_side_keeps_its_connector_beside_an_end_on_the_outline() {
        // Verifies: API-edges-dock-nodes-or-edges
        let source = Rect::of_node(0.0, 0.0, 220.0, 64.0);
        let target = Rect::of_node(500.0, -300.0, 80.0, 80.0);
        for side in [Side::Top, Side::Right, Side::Bottom, Side::Left] {
            let path = EdgePath::docked(
                (&source, NodeShape::Diamond),
                (&target, NodeShape::Circle),
                Sides {
                    source: side.into(),
                    target: Dock::Outline,
                },
            );
            assert_eq!(path.source, side.connector(&source), "{side:?}");
            // It leaves along the side's outward normal.
            let n = side.outward();
            let leave = path.tangent_at(0.0);
            assert!((leave.x * n.y - leave.y * n.x).abs() < 1e-12, "{side:?}");
            assert!(leave.x * n.x + leave.y * n.y > 0.0, "{side:?}");
            // Its other end lies on the target's outline, towards the source's centre.
            on_the_outline_towards(
                path.target,
                &target,
                NodeShape::Circle,
                centre(&source),
                1e-9,
            );
            // And the other way round: on the outline at the source, the side at the target.
            let back = EdgePath::docked(
                (&source, NodeShape::Diamond),
                (&target, NodeShape::Circle),
                Sides {
                    source: Dock::Outline,
                    target: side.into(),
                },
            );
            assert_eq!(back.target, side.connector(&target), "{side:?}");
            on_the_outline_towards(
                back.source,
                &source,
                NodeShape::Diamond,
                centre(&target),
                1e-9,
            );
        }
    }

    #[test]
    fn an_end_on_an_edge_lies_on_its_path_at_its_parameter_and_pulls_out_along_its_normal() {
        // Verifies: API-edges-dock-nodes-or-edges, Q-4
        // On each awkward path, and on one far from the origin and far longer than a viewport, an
        // end at each parameter lies at the path's point there, and its control point on the
        // path's normal, on the side of the other end, half the distance along it and at least
        // `MIN_PULL`; an other end on the tangent takes the normal to the left.
        let far = 1.0e9;
        let mut paths = awkward_paths().to_vec();
        paths.push(EdgePath::horizontal(
            Point::new(far, far),
            Point::new(far + 3.0e6, far - 1.0e6),
            40.0,
        ));
        for path in paths {
            for t in [0.0, 0.25, 0.5, 0.9, 1.0] {
                let p = path.point_at(t);
                let tangent = path.tangent_at(t);
                let scale = p.x.abs().max(p.y.abs()).max(1.0);
                for (dx, dy) in [(300.0, -200.0), (-80.0, 500.0), (0.0, 0.0)] {
                    let other = Point::new(p.x + dx, p.y + dy);
                    let (at, n) = on_edge(&path, t, other);
                    assert_eq!(at, p, "{path:?} at {t}");
                    assert!((n.x * tangent.x + n.y * tangent.y).abs() < EPS, "{path:?}");
                    assert!((length(n.x, n.y) - 1.0).abs() < EPS, "{path:?}");
                    let side = dx * n.x + dy * n.y;
                    let left = n == Point::new(tangent.y, -tangent.x);
                    assert!(side > 0.0 || (side == 0.0 && left), "{path:?} at {t}");
                    let joined = EdgePath::joining((at, n), (other, Point::new(1.0, 0.0)));
                    let pull = (side.abs() / 2.0).max(MIN_PULL);
                    let control = joined.control_source;
                    let off = |a: f64, b: f64| (a - b).abs() <= 1e-9 * scale.max(pull);
                    assert!(off(control.x, at.x + n.x * pull), "{path:?} at {t}");
                    assert!(off(control.y, at.y + n.y * pull), "{path:?} at {t}");
                }
            }
        }
    }

    #[test]
    fn an_end_on_a_container_towards_a_node_it_holds_lies_on_its_outline_beyond_that_node() {
        // Verifies: API-edges-dock-nodes-or-edges
        // A container, a frame and an ellipse, holding a node at depth two off its centre in each
        // direction: the container's end on the outline lies on the line from its centre through
        // the held node's, past the held node's centre. Where the two centres coincide, both ends
        // look to the right of the centre, the container's on its outline at the right, the held
        // node's on its own outline there, by a load and after a move into the container; moved
        // onto the canvas the held node is no longer held, and both ends lie at the centre again.
        use crate::graph::{CANVAS, EdgeSpec, End, Graph, Nesting};
        use crate::stroke::EdgeStyle;
        let outline = Sides {
            source: Dock::Outline,
            target: Dock::Outline,
        };
        let graph_of = |held: [f32; 2]| {
            let positions = vec![0.0, 0.0, 20.0, 20.0, held[0], held[1]];
            let sizes = vec![400.0, 300.0, 360.0, 260.0, 100.0, 60.0];
            let edges = vec![EdgeSpec {
                source: End::Node(0),
                target: End::Node(2),
                sides: outline,
                labels: Vec::new(),
                style: EdgeStyle::unstyled(),
            }];
            let nesting = Nesting {
                containers: vec![CANVAS, 0, 1],
                is_container: vec![true, true, false],
            };
            Graph::nested(positions, sizes, edges, nesting).unwrap()
        };
        let container = Rect::of_node(0.0, 0.0, 400.0, 300.0);
        for shape in [NodeShape::Frame, NodeShape::Ellipse] {
            for held in [[40.0, 30.0], [260.0, 210.0], [150.0, 30.0], [30.0, 200.0]] {
                let mut graph = graph_of(held);
                graph.set_shape(0, shape).unwrap();
                let inner = Rect::of_node(f64::from(held[0]), f64::from(held[1]), 100.0, 60.0);
                let (c, h) = (centre(&container), centre(&inner));
                let end = graph.path(0).source;
                on_the_outline_towards(end, &container, shape, h, 1e-9);
                let (hx, hy) = (h.x - c.x, h.y - c.y);
                let beyond = (end.x - c.x) * hx + (end.y - c.y) * hy;
                assert!(beyond > hx * hx + hy * hy, "{shape:?} {held:?}: {end:?}");
            }
        }
        let mut graph = graph_of([150.0, 120.0]);
        let inner = Rect::of_node(150.0, 120.0, 100.0, 60.0);
        let right = |graph: &Graph| {
            let path = graph.path(0);
            assert_eq!(path.source, Point::new(400.0, 150.0));
            assert_eq!(path.target, Point::new(250.0, 150.0));
        };
        right(&graph);
        graph.move_into(2, CANVAS).unwrap();
        let path = graph.path(0);
        assert_eq!((path.source, path.target), (centre(&inner), centre(&inner)));
        graph.move_into(2, 0).unwrap();
        right(&graph);
    }

    /// A container 400 by 300 at the origin holding a node 360 by 260 at (20, 20), which holds a
    /// diamond 100 by 60 at `held`, and the edge from the container to the diamond, or from the
    /// diamond to the container where `back`, docked by `sides`, its first dock the container's.
    fn held_two_deep(held: [f32; 2], back: bool, sides: Sides) -> crate::graph::Graph {
        use crate::graph::{CANVAS, EdgeSpec, End, Graph, Nesting};
        use crate::stroke::EdgeStyle;
        let (source, target, sides) = if back {
            let swapped = Sides {
                source: sides.target,
                target: sides.source,
            };
            (End::Node(2), End::Node(0), swapped)
        } else {
            (End::Node(0), End::Node(2), sides)
        };
        let positions = vec![0.0, 0.0, 20.0, 20.0, held[0], held[1]];
        let sizes = vec![400.0, 300.0, 360.0, 260.0, 100.0, 60.0];
        let edges = vec![EdgeSpec {
            source,
            target,
            sides,
            labels: Vec::new(),
            style: EdgeStyle::unstyled(),
        }];
        let nesting = Nesting {
            containers: vec![CANVAS, 0, 1],
            is_container: vec![true, true, false],
        };
        let mut graph = Graph::nested(positions, sizes, edges, nesting).unwrap();
        graph.set_shape(2, NodeShape::Diamond).unwrap();
        graph
    }

    #[test]
    fn a_held_node_s_end_faces_the_container_s_end_and_both_control_points_pull_inward() {
        // Verifies: API-edges-dock-nodes-or-edges
        // Both ends on the outline, the held node two deep, off the centre in each direction, on
        // it, and in either direction of the edge: the container's end lies where the line from
        // its centre through the held node's crosses its outline, the held node's end where that
        // line crosses the held node's outline towards the container's end, and both control
        // points lie on the line between the two ends, so that the whole path stays inside the
        // container.
        let outline = Sides {
            source: Dock::Outline,
            target: Dock::Outline,
        };
        let container = Rect::of_node(0.0, 0.0, 400.0, 300.0);
        // A rectangle as loaded, so that the load places the path by the nesting it reads.
        for shape in [NodeShape::Rectangle, NodeShape::Frame, NodeShape::Ellipse] {
            for held in [
                [40.0, 30.0],
                [260.0, 210.0],
                [150.0, 30.0],
                [30.0, 200.0],
                [150.0, 120.0],
            ] {
                for back in [false, true] {
                    let mut graph = held_two_deep(held, back, outline);
                    if shape != NodeShape::Rectangle {
                        graph.set_shape(0, shape).unwrap();
                    }
                    let context = format!("{shape:?} {held:?} back {back}");
                    let path = graph.path(0);
                    let (end, inner_end) = if back {
                        (path.target, path.source)
                    } else {
                        (path.source, path.target)
                    };
                    let inner = Rect::of_node(f64::from(held[0]), f64::from(held[1]), 100.0, 60.0);
                    let (c, h) = (centre(&container), centre(&inner));
                    // The line runs to the right where the two centres coincide.
                    let towards = if c == h {
                        Point::new(c.x + 1.0, c.y)
                    } else {
                        h
                    };
                    on_the_outline_towards(end, &container, shape, towards, 1e-9);
                    let far = Point::new(h.x + (end.x - c.x), h.y + (end.y - c.y));
                    on_the_outline_towards(inner_end, &inner, NodeShape::Diamond, far, 1e-9);
                    let (dx, dy) = (end.x - inner_end.x, end.y - inner_end.y);
                    let squared = dx * dx + dy * dy;
                    for point in [path.control_source, path.control_target] {
                        let (px, py) = (point.x - inner_end.x, point.y - inner_end.y);
                        let along = px * dx + py * dy;
                        assert!((px * dy - py * dx).abs() <= 1e-9 * squared, "{context}");
                        assert!((0.0..=squared).contains(&along), "{context}: {point:?}");
                    }
                    for i in 0..=16 {
                        let p = path.point_at(f64::from(i) / 16.0);
                        let inside = shape.contains(400.0, 300.0, p.x, p.y);
                        assert!(inside || i == 0 || i == 16, "{context}: {p:?}");
                    }
                }
            }
        }
    }

    #[test]
    fn an_end_on_a_side_of_a_container_or_of_a_held_node_takes_the_path_between_two_nodes() {
        // Verifies: API-edges-dock-nodes-or-edges
        // A side on one end, the outline on the other: the path is that between two nodes, the
        // end on the outline facing the other node's centre, whether the side is the container's
        // or the held node's, and either way round.
        let container = Rect::of_node(0.0, 0.0, 400.0, 300.0);
        let inner = Rect::of_node(40.0, 30.0, 100.0, 60.0);
        for (first, second) in [
            (Dock::Side(Side::Top), Dock::Outline),
            (Dock::Outline, Dock::Side(Side::Left)),
        ] {
            let sides = Sides {
                source: first,
                target: second,
            };
            for back in [false, true] {
                let graph = held_two_deep([40.0, 30.0], back, sides);
                let ends = [
                    (&container, NodeShape::Rectangle),
                    (&inner, NodeShape::Diamond),
                ];
                let expected = if back {
                    let swapped = Sides {
                        source: second,
                        target: first,
                    };
                    EdgePath::docked(ends[1], ends[0], swapped)
                } else {
                    EdgePath::docked(ends[0], ends[1], sides)
                };
                assert_eq!(graph.path(0), expected, "{sides:?} back {back}");
            }
        }
    }

    #[test]
    fn a_container_and_a_held_node_on_one_centre_with_a_side_on_one_end_look_to_the_right() {
        // Verifies: API-edges-dock-nodes-or-edges
        // The held diamond centred in the container, two deep, a side on one end and the outline
        // on the other, either way round and in either direction of the edge: the end on the
        // outline lies on its node's outline to the right of the centre, the end on a side at its
        // connector, by a load, and after the diamond moves onto the canvas, where the two are
        // no longer nested and the end on the outline lies at the centre, and back in.
        use crate::graph::CANVAS;
        let centred = [150.0, 120.0];
        let container = Rect::of_node(0.0, 0.0, 400.0, 300.0);
        let inner = Rect::of_node(150.0, 120.0, 100.0, 60.0);
        let cases = [
            (Dock::Side(Side::Top), Dock::Outline),
            (Dock::Outline, Dock::Side(Side::Left)),
        ];
        for (first, second) in cases {
            for back in [false, true] {
                let sides = Sides {
                    source: first,
                    target: second,
                };
                let mut graph = held_two_deep(centred, back, sides);
                let ends = |graph: &crate::graph::Graph| {
                    let path = graph.path(0);
                    if back {
                        (path.target, path.source)
                    } else {
                        (path.source, path.target)
                    }
                };
                let (outer_end, inner_end) = if first == Dock::Outline {
                    (Point::new(400.0, 150.0), Side::Left.connector(&inner))
                } else {
                    (Side::Top.connector(&container), Point::new(250.0, 150.0))
                };
                let context = format!("{sides:?} back {back}");
                assert_eq!(ends(&graph), (outer_end, inner_end), "loaded, {context}");
                graph.move_into(2, CANVAS).unwrap();
                let apart = if first == Dock::Outline {
                    (centre(&container), inner_end)
                } else {
                    (outer_end, centre(&inner))
                };
                assert_eq!(ends(&graph), apart, "on the canvas, {context}");
                graph.move_into(2, 0).unwrap();
                assert_eq!(ends(&graph), (outer_end, inner_end), "back in, {context}");
            }
        }
    }

    #[test]
    fn an_end_on_the_outline_of_two_nodes_with_one_centre_lies_at_the_centre() {
        // Decides no criterion: two nodes stacked on one centre give no line between them; the
        // path stays finite, its ends at the centre.
        let node = Rect::of_node(10.0, 20.0, 100.0, 50.0);
        let path = EdgePath::docked(
            (&node, NodeShape::Ellipse),
            (&node, NodeShape::Ellipse),
            Sides {
                source: Dock::Outline,
                target: Dock::Outline,
            },
        );
        let c = centre(&node);
        assert_eq!(
            path,
            EdgePath {
                source: c,
                control_source: c,
                control_target: c,
                target: c
            }
        );
    }

    #[test]
    fn a_loop_leaves_and_reenters_the_side_it_names_its_outermost_point_at_the_middle_parameter() {
        // Verifies: API-edges-dock-nodes-or-edges
        // Per dock: where the loop leaves, where it re-enters, and the side's outward normal, as
        // fractions of the node's width and height, worked out by hand; the outline loops on top.
        type Fractions = (f64, f64);
        let cases: [(Dock, Fractions, Fractions, Fractions); 5] = [
            (Side::Top.into(), (0.25, 0.0), (0.75, 0.0), (0.0, -1.0)),
            (Side::Right.into(), (1.0, 0.25), (1.0, 0.75), (1.0, 0.0)),
            (Side::Bottom.into(), (0.75, 1.0), (0.25, 1.0), (0.0, 1.0)),
            (Side::Left.into(), (0.0, 0.75), (0.0, 0.25), (-1.0, 0.0)),
            (Dock::Outline, (0.25, 0.0), (0.75, 0.0), (0.0, -1.0)),
        ];
        for (x, y, w, h) in [
            (0.0, 0.0, 200.0, 40.0),
            (10.0, -30.0, 24.0, 24.0),
            (-500.0, 300.0, 60.0, 300.0),
        ] {
            let node = Rect::of_node(x, y, w, h);
            for (dock, from, to, (nx, ny)) in cases {
                let at = |(fx, fy): (f64, f64)| Point::new(x + fx * w, y + fy * h);
                let path = EdgePath::looped(&node, NodeShape::Rectangle, dock);
                let context = format!("{dock:?} on {node:?}: {path:?}");
                assert!(close(path.source, at(from)), "{context}");
                assert!(close(path.target, at(to)), "{context}");
                // Out as far as the side is long, and at least the minimum.
                let pull = if nx == 0.0 { w } else { h }.max(MIN_PULL);
                let out = |p: Point| Point::new(p.x + nx * pull, p.y + ny * pull);
                assert!(close(path.control_source, out(at(from))), "{context}");
                assert!(close(path.control_target, out(at(to))), "{context}");
                // It leaves along the normal and enters the node against it, the arrowhead's way.
                assert!(close(path.tangent_at(0.0), Point::new(nx, ny)), "{context}");
                assert!(
                    close(path.tangent_at(1.0), Point::new(-nx, -ny)),
                    "{context}"
                );
                // Its outermost point is at 0.5: three quarters of the pull beyond the middle of
                // the side, where a label offset to the left of travel stands further out.
                let side = |p: Point| (p.x - x - w / 2.0) * nx + (p.y - y - h / 2.0) * ny;
                let top = path.point_at(0.5);
                let reach = if nx == 0.0 { h } else { w } / 2.0;
                assert!((side(top) - reach - 0.75 * pull).abs() < EPS, "{context}");
                for i in 0..=100 {
                    let t = f64::from(i) / 100.0;
                    assert!(
                        side(path.point_at(t)) <= side(top) + EPS,
                        "{context} at {t}"
                    );
                }
                let label = path.label_position(0.5, 14.0);
                assert!((side(label) - side(top) - 14.0).abs() < EPS, "{context}");
            }
        }
    }

    /// The docks a loop names: each side, and the outline, which loops on the top.
    const LOOP_DOCKS: [(Dock, Side); 5] = [
        (Dock::Side(Side::Top), Side::Top),
        (Dock::Side(Side::Right), Side::Right),
        (Dock::Side(Side::Bottom), Side::Bottom),
        (Dock::Side(Side::Left), Side::Left),
        (Dock::Outline, Side::Top),
    ];

    #[test]
    fn a_loop_ends_on_the_outline_of_each_node_shape_on_each_side_and_enters_the_node() {
        // Verifies: API-edges-dock-nodes-or-edges, Q-4
        // Each node shape, each dock, wide, square, tall, small, and thin nodes, near and far
        // from the world's origin: both ends lie on the outline within Q-4's half pixel at the
        // zoom of 1, its world units; the loop leaves along the side's normal and enters against
        // it; and its four points moved inward together along the normal from where they lie on
        // the node's rectangle, so it keeps its shape and its width.
        for (w, h) in [
            (200.0, 40.0),
            (24.0, 24.0),
            (60.0, 300.0),
            (40.0, 40.0),
            (200.0, 24.0),
            (12.0, 8.0),
        ] {
            for origin in [0.0, -3e6, 1e7] {
                let node = Rect::of_node(origin, origin * 0.5, w, h);
                let tolerance = 1e-9 * (1.0 + origin.abs());
                for shape in NodeShape::ALL {
                    for (dock, side) in LOOP_DOCKS {
                        let n = side.outward();
                        let path = EdgePath::looped(&node, shape, dock);
                        let boxed = EdgePath::looped(&node, NodeShape::Rectangle, dock);
                        let context = format!("{shape:?} {dock:?} on {node:?}: {path:?}");
                        // On the outline: hit a hair inside along the normal, not a hair outside.
                        let hit = |p: Point, by: f64| {
                            shape.contains(
                                w,
                                h,
                                p.x + n.x * by - node.min_x,
                                p.y + n.y * by - node.min_y,
                            )
                        };
                        for end in [path.source, path.target] {
                            assert!(hit(end, -tolerance), "outside the outline, {context}");
                            assert!(!hit(end, tolerance), "inside the outline, {context}");
                        }
                        // It enters the node against the normal, the arrowhead's tip at the end.
                        let enter = path.tangent_at(1.0);
                        assert!(
                            (enter.x + n.x).abs() < 1e-9 && (enter.y + n.y).abs() < 1e-9,
                            "{context}: enters along {enter:?}"
                        );
                        let leave = path.tangent_at(0.0);
                        assert!(
                            (leave.x - n.x).abs() < 1e-9 && (leave.y - n.y).abs() < 1e-9,
                            "{context}: leaves along {leave:?}"
                        );
                        // Moved as a whole, inward along the normal, by no more than the node.
                        let moved = |p: Point, q: Point| (p.x - q.x, p.y - q.y);
                        let (dx, dy) = moved(path.source, boxed.source);
                        let inward = -(dx * n.x + dy * n.y);
                        assert!((dx * n.y - dy * n.x).abs() <= tolerance, "{context}");
                        assert!(inward >= 0.0 && inward <= w.max(h) / 2.0, "{context}");
                        for (p, q) in [
                            (path.control_source, boxed.control_source),
                            (path.control_target, boxed.control_target),
                            (path.target, boxed.target),
                        ] {
                            let (ex, ey) = moved(p, q);
                            assert!(
                                (ex - dx).abs() <= tolerance && (ey - dy).abs() <= tolerance,
                                "{context}: not moved as a whole"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn a_loop_on_a_rectangle_a_bar_or_a_rounded_rectangle_of_a_long_side_is_todays_to_the_bit() {
        // Verifies: API-edges-dock-nodes-or-edges
        // Today's loop, as it was computed before loops docked on the node shape, against the
        // loop of a rectangle, a bar, and a rounded rectangle whose side is at least four times
        // `ROUNDED_RADIUS` long, 40 among them, compared bit for bit.
        let todays = |node: &Rect, side: Side| {
            let (middle, n) = (side.connector(node), side.outward());
            let length = match side {
                Side::Top | Side::Bottom => node.max_x - node.min_x,
                Side::Right | Side::Left => node.max_y - node.min_y,
            };
            let (quarter, pull) = (length / 4.0, length.max(MIN_PULL));
            let along = Point::new(n.y * quarter, -n.x * quarter);
            let source = Point::new(middle.x + along.x, middle.y + along.y);
            let target = Point::new(middle.x - along.x, middle.y - along.y);
            let out = |end: Point| Point::new(end.x + n.x * pull, end.y + n.y * pull);
            [source, out(source), out(target), target]
        };
        let bits = |points: [Point; 4]| points.map(|p| (p.x.to_bits(), p.y.to_bits()));
        let long = 4.0 * crate::shape::ROUNDED_RADIUS;
        let mut rounded = 0;
        for (x, y, w, h) in [
            (0.0, 0.0, 200.0, 40.0),
            (-0.0, -0.0, 40.0, 40.0),
            (10.0, -30.0, 24.0, 24.0),
            (-500.0, 300.0, 60.0, 300.0),
            (3e7, -1e7, 220.0, 8.0),
            (1.5e36, 1.5e36, 120.0, 41.0),
        ] {
            let node = Rect::of_node(x, y, w, h);
            for (dock, side) in LOOP_DOCKS {
                let length = if side.outward().x == 0.0 { w } else { h };
                for shape in [
                    NodeShape::Rectangle,
                    NodeShape::Bar,
                    NodeShape::RoundedRectangle,
                ] {
                    if shape == NodeShape::RoundedRectangle {
                        if length < long {
                            continue;
                        }
                        rounded += 1;
                    }
                    let path = EdgePath::looped(&node, shape, dock);
                    let path = [
                        path.source,
                        path.control_source,
                        path.control_target,
                        path.target,
                    ];
                    assert_eq!(
                        bits(path),
                        bits(todays(&node, side)),
                        "{shape:?} {dock:?} on {node:?}"
                    );
                }
            }
        }
        assert!(rounded >= 15, "{rounded}");
    }

    #[test]
    fn from_the_right_to_the_left_the_path_is_the_horizontal_one_to_the_bit() {
        // Verifies: API-edges-dock-nodes-or-edges
        let source = Rect::of_node(10.0, 20.0, 220.0, 64.0);
        for target in [
            Rect::of_node(400.0, 300.0, 220.0, 64.0),
            Rect::of_node(-500.0, -260.0, 100.0, 40.5),
            Rect::of_node(0.1, 1e7, 3.0, 0.7),
        ] {
            let horizontal = EdgePath::horizontal(
                Point::new(source.max_x, (source.min_y + source.max_y) / 2.0),
                Point::new(target.min_x, (target.min_y + target.max_y) / 2.0),
                MIN_PULL,
            );
            assert_eq!(
                EdgePath::between(&source, &target, Sides::default()),
                horizontal
            );
        }
    }

    #[test]
    fn a_label_is_placed_at_the_nearest_of_several_near_points_of_a_path_that_turns_back() {
        // Verifies: G-6
        // From the right of a node to the left of one behind and below it: the path swings out to
        // the right, back across, and out to the left, so that a point beside it lies near
        // several stretches of it, and the placement has to end at a foot of a perpendicular.
        let path = EdgePath::between(
            &Rect::of_node(0.0, 0.0, 220.0, 64.0),
            &Rect::of_node(-400.0, 140.0, 220.0, 64.0),
            Sides::default(),
        );
        let distance = |t: f64, p: Point| {
            let q = path.point_at(t);
            (q.x - p.x).hypot(q.y - p.y)
        };
        // A point far beside a path that turns back, whose distance has two minima: a search near
        // the nearest sample ends at a foot of a perpendicular, where a search of the whole path
        // ends at a point that is none.
        let turning = EdgePath::between(
            &Rect::of_node(0.0, 0.0, 220.0, 64.0),
            &Rect::of_node(
                -161.603_165_735_473_57,
                0.132_577_549_044_583_52,
                220.0,
                64.0,
            ),
            Sides::default(),
        );
        let far = Point::new(-348.000_619_140_425_56, 412.989_424_779_773_57);
        let (t, offset) = turning.placement_at(far);
        let placed = turning.label_position(t, offset);
        assert!(
            (placed.x - far.x).hypot(placed.y - far.y) < 0.01,
            "{placed:?}"
        );
        for i in 0..40 {
            for j in 0..12 {
                let at = path.label_position(f64::from(i) / 40.0, f64::from(j) * 10.0 - 60.0);
                // The nearest path point by a dense scan: only one inside the path is a case.
                let nearest = (0..=20_000)
                    .map(|k| f64::from(k) / 20_000.0)
                    .min_by(|a, b| distance(*a, at).total_cmp(&distance(*b, at)))
                    .unwrap();
                if !(0.01..=0.99).contains(&nearest) {
                    continue;
                }
                let (placed_t, placed_offset) = path.placement_at(at);
                let placed = path.label_position(placed_t, placed_offset);
                let miss = (placed.x - at.x).hypot(placed.y - at.y);
                assert!(miss < 0.01, "at {at:?}: missed by {miss}");
            }
        }
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
        let path = EdgePath::between(&source, &target, Sides::default());
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
    /// reaches randomness (ARCH-one-workspace-per-example).
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
                    Sides::default(),
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
