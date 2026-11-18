//! The node shapes of the closed set the engine owns (REN-closed-set-of-node-shapes): each node
//! shape's height for content of a given height, the inner rectangle its content is laid out in,
//! its hit test, the point where a line from its centre crosses its outline, and how far inside a
//! side the outline lies at a distance from the side's middle (`inset`), and where a border node
//! sits on it by a side and an offset along it (ARCH-border-nodes-ride-sides). All of it is in the
//! node's own coordinates, its top-left corner at the origin, so that it holds wherever the node
//! lies in the world.

use crate::geometry::Side;

/// The radius of the corners of a rounded rectangle, which lies within the padding of content,
/// so that a rounded rectangle lays its content out as a rectangle does.
pub const ROUNDED_RADIUS: f64 = 10.0;
/// The height of a bar.
pub const BAR_HEIGHT: f64 = 8.0;

/// A node's shape. The code of each is its place in `ALL`, the order the bridge hands it over in.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NodeShape {
    /// Today's node, its corners rounded by 6 as the shell draws them, hit as its bounding
    /// rectangle, its corners included, as before node shapes.
    #[default]
    Rectangle,
    /// A rectangle whose corners are rounded by `ROUNDED_RADIUS`.
    RoundedRectangle,
    /// The ellipse inscribed in the node's rectangle.
    Ellipse,
    /// A filled circle, as high as wide.
    Circle,
    /// A filled circle of half the radius inside an unfilled ring, as high as wide.
    RingedCircle,
    /// The diamond whose corners are the middles of the node rectangle's sides.
    Diamond,
    /// A filled bar `BAR_HEIGHT` high.
    Bar,
}

/// A rectangle in a node's own coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Inner {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl NodeShape {
    /// Every node shape, in the order of their codes.
    pub const ALL: [Self; 7] = [
        Self::Rectangle,
        Self::RoundedRectangle,
        Self::Ellipse,
        Self::Circle,
        Self::RingedCircle,
        Self::Diamond,
        Self::Bar,
    ];

    /// The node shape of `code`, none for a code outside the set.
    pub fn of_code(code: u8) -> Option<Self> {
        Self::ALL.get(usize::from(code)).copied()
    }

    /// Whether the node shape holds content; the filled ones hold none.
    pub const fn holds_content(self) -> bool {
        !matches!(self, Self::Circle | Self::RingedCircle | Self::Bar)
    }

    /// The share of the node's width and height its inner rectangle takes, on each axis.
    fn inner_share(self) -> f64 {
        match self {
            Self::Rectangle | Self::RoundedRectangle => 1.0,
            Self::Ellipse => core::f64::consts::FRAC_1_SQRT_2,
            Self::Diamond => 0.5,
            Self::Circle | Self::RingedCircle | Self::Bar => 0.0,
        }
    }

    /// The height of a node of this shape and `width` whose content, laid out as in a rectangle,
    /// is `content` high: as high as its inner rectangle needs for that content, as high as wide
    /// for a circle, and `BAR_HEIGHT` for a bar.
    pub fn height(self, width: f64, content: f64) -> f64 {
        match self {
            Self::Circle | Self::RingedCircle => width,
            Self::Bar => BAR_HEIGHT,
            _ => content / self.inner_share(),
        }
    }

    /// The height of a node of this shape and `width` whose content lays out to `content` high as
    /// `height` takes it, none for a node without content, and whose data gives the height
    /// `given`, or none (REN-node-shapes-cover-uml, *Height*; REN-node-content-and-hits,
    /// *Layout*): a circle as high as wide; a bar `BAR_HEIGHT` high, or as its data gives; a node
    /// with content as high as its content needs, or as its data gives where that is more; and
    /// a node without content as high as its data gives, or as wide, however small.
    pub fn sized(self, width: f64, content: Option<f64>, given: Option<f64>) -> f64 {
        match (self, content) {
            (Self::Circle | Self::RingedCircle, _) => width,
            (Self::Bar, _) => given.unwrap_or(BAR_HEIGHT),
            (_, Some(content)) => {
                let needed = self.height(width, content);
                given.map_or(needed, |given| given.max(needed))
            }
            (_, None) => given.unwrap_or(width),
        }
    }

    /// The width the content of a node of this shape and `width` is laid out to.
    pub fn content_width(self, width: f64) -> f64 {
        width * self.inner_share()
    }

    /// The rectangle, centred in a node of this shape of `width` × `height`, that its content is
    /// laid out in, as in a rectangle of that size; empty for a filled node shape.
    pub fn inner(self, width: f64, height: f64) -> Inner {
        let share = self.inner_share();
        let (inner_width, inner_height) = (width * share, height * share);
        Inner {
            x: (width - inner_width) / 2.0,
            y: (height - inner_height) / 2.0,
            width: inner_width,
            height: inner_height,
        }
    }

    /// Whether the point `(x, y)` of a node of this shape and `width` × `height` lies within its
    /// outline, the outline included.
    pub fn contains(self, width: f64, height: f64, x: f64, y: f64) -> bool {
        let (a, b) = (width / 2.0, height / 2.0);
        let (dx, dy) = ((x - a).abs(), (y - b).abs());
        if dx > a || dy > b {
            return false;
        }
        // A node so small against where it lies that rounding made it a line or a point is hit
        // as its rectangle, as before node shapes.
        if a <= 0.0 || b <= 0.0 {
            return true;
        }
        match self {
            Self::Rectangle | Self::Bar => true,
            Self::RoundedRectangle => {
                let r = ROUNDED_RADIUS.min(a).min(b);
                let (ex, ey) = (dx - (a - r), dy - (b - r));
                ex <= 0.0 || ey <= 0.0 || ex * ex + ey * ey <= r * r
            }
            Self::Ellipse | Self::Circle | Self::RingedCircle => {
                (dx / a).powi(2) + (dy / b).powi(2) <= 1.0
            }
            Self::Diamond => dx / a + dy / b <= 1.0,
        }
    }

    /// The point of the outline of a node of this shape and `width` × `height` where the line
    /// from its centre in the direction `(dx, dy)` crosses it; the centre for no direction or an
    /// empty node.
    pub fn crossing(self, width: f64, height: f64, dx: f64, dy: f64) -> (f64, f64) {
        let (a, b) = (width / 2.0, height / 2.0);
        let length = crate::geometry::length(dx, dy);
        if length == 0.0 || a <= 0.0 || b <= 0.0 {
            return (a, b);
        }
        let (ux, uy) = (dx / length, dy / length);
        let t = match self {
            Self::Rectangle | Self::Bar => box_distance(a, b, ux, uy),
            Self::RoundedRectangle => rounded_distance(a, b, ux, uy),
            Self::Ellipse | Self::Circle | Self::RingedCircle => {
                1.0 / ((ux / a).powi(2) + (uy / b).powi(2)).sqrt()
            }
            Self::Diamond => 1.0 / (ux.abs() / a + uy.abs() / b),
        };
        (a + t * ux, b + t * uy)
    }

    /// How far inward along a side's normal the outline of a node of this shape lies from that
    /// side, at `offset` from the side's middle along it: `along` is the side's length, `across`
    /// the node's extent along the normal, and the offset lies within half the side's length. It
    /// is nil for a rectangle and a bar, for an empty node, and for a rounded rectangle where the
    /// offset lies off its corners' arcs. Every node shape is symmetric about both axes, so the
    /// side and the sign of the offset do not matter.
    pub fn inset(self, along: f64, across: f64, offset: f64) -> f64 {
        let (a, b) = (along / 2.0, across / 2.0);
        if a <= 0.0 || b <= 0.0 {
            return 0.0;
        }
        let u = offset.abs();
        match self {
            Self::Rectangle | Self::Bar => 0.0,
            Self::RoundedRectangle => {
                let r = ROUNDED_RADIUS.min(a).min(b);
                let e = u - (a - r);
                if e <= 0.0 {
                    0.0
                } else {
                    r - (r * r - e * e).sqrt()
                }
            }
            // b (1 − √(1 − s²)), in the form that keeps its digits where s is small.
            Self::Ellipse | Self::Circle | Self::RingedCircle => {
                let s = u / a;
                b * s * s / (1.0 + (1.0 - s * s).sqrt())
            }
            Self::Diamond => b * (u / a),
        }
    }
}

/// The length of `side` of a box `width` × `height`: its width for the top and the bottom, its
/// height for the right and the left.
pub fn side_length(width: f64, height: f64, side: Side) -> f64 {
    match side {
        Side::Top | Side::Bottom => width,
        Side::Right | Side::Left => height,
    }
}

/// The side of a box `width` × `height` nearest the point `(x, y)` of its own coordinates, ties
/// in the order top, right, bottom, left, and the point's offset along it, its distance from the
/// side's start, its left end or its top end, held within the side's length
/// (ARCH-border-nodes-ride-sides, *Drag*).
pub fn side_of(width: f64, height: f64, x: f64, y: f64) -> (Side, f64) {
    let sides = [
        (Side::Top, y),
        (Side::Right, width - x),
        (Side::Bottom, height - y),
        (Side::Left, x),
    ];
    let mut nearest = sides[0];
    for candidate in &sides[1..] {
        if candidate.1 < nearest.1 {
            nearest = *candidate;
        }
    }
    let side = nearest.0;
    let along = match side {
        Side::Top | Side::Bottom => x,
        Side::Right | Side::Left => y,
    };
    (side, held(along, side_length(width, height, side)))
}

/// `offset` held within a side `length` long: from 0 to the length, 0 for a side of none.
pub fn held(offset: f64, length: f64) -> f64 {
    offset.min(length).max(0.0)
}

impl NodeShape {
    /// The centre of a border node on `side` of a node of this shape and `width` × `height`, at
    /// `offset` from the side's start, held within its length: where the line through that point
    /// at right angles to the side meets the outline, at the meeting point nearer the side
    /// (ARCH-border-nodes-ride-sides, *Place*).
    pub fn on_side(self, width: f64, height: f64, side: Side, offset: f64) -> (f64, f64) {
        let along = side_length(width, height, side);
        let at = held(offset, along);
        let across = width + height - along;
        let inset = self.inset(along, across, at - along / 2.0);
        match side {
            Side::Top => (at, inset),
            Side::Right => (width - inset, at),
            Side::Bottom => (at, height - inset),
            Side::Left => (inset, at),
        }
    }

    /// The point of the outline of a node of this shape and `width` × `height` nearest the point
    /// `(x, y)`, inside the node or outside it (ARCH-border-nodes-ride-sides, *Drag*).
    pub fn nearest(self, width: f64, height: f64, x: f64, y: f64) -> (f64, f64) {
        let (a, b) = (width / 2.0, height / 2.0);
        if a <= 0.0 || b <= 0.0 {
            return (x.clamp(0.0, width), y.clamp(0.0, height));
        }
        match self {
            Self::Rectangle | Self::Bar => nearest_on_box(width, height, x, y, 0.0),
            Self::RoundedRectangle => {
                nearest_on_box(width, height, x, y, ROUNDED_RADIUS.min(a).min(b))
            }
            Self::Ellipse | Self::Circle | Self::RingedCircle => {
                let (dx, dy) = nearest_on_ellipse(a, b, x - a, y - b);
                (a + dx, b + dy)
            }
            Self::Diamond => {
                let corners = [(a, 0.0), (width, b), (a, height), (0.0, b)];
                let mut best = (f64::INFINITY, (a, 0.0));
                for i in 0..4 {
                    let p = nearest_on_segment(corners[i], corners[(i + 1) % 4], (x, y));
                    let d = crate::geometry::length(p.0 - x, p.1 - y);
                    if d < best.0 {
                        best = (d, p);
                    }
                }
                best.1
            }
        }
    }
}

/// The point of the outline of a box `width` × `height` whose corners are rounded by `r` nearest
/// `(x, y)`: the box less `r` at every side, grown by `r` around it. Outside that inner box the
/// nearest point lies `r` from the inner box's point nearest `(x, y)`; inside it, on the nearest
/// side, ties in the order top, right, bottom, left.
fn nearest_on_box(width: f64, height: f64, x: f64, y: f64, r: f64) -> (f64, f64) {
    let (qx, qy) = (x.clamp(r, width - r), y.clamp(r, height - r));
    let (ex, ey) = (x - qx, y - qy);
    let away = crate::geometry::length(ex, ey);
    if away > 0.0 {
        return (qx + ex / away * r, qy + ey / away * r);
    }
    match side_of(width, height, x, y).0 {
        Side::Top => (x, 0.0),
        Side::Right => (width, y),
        Side::Bottom => (x, height),
        Side::Left => (0.0, y),
    }
}

/// The point of the segment from `from` to `to` nearest `p`.
fn nearest_on_segment(from: (f64, f64), to: (f64, f64), p: (f64, f64)) -> (f64, f64) {
    let (dx, dy) = (to.0 - from.0, to.1 - from.1);
    let length = dx * dx + dy * dy;
    let t = if length > 0.0 {
        (((p.0 - from.0) * dx + (p.1 - from.1) * dy) / length).clamp(0.0, 1.0)
    } else {
        0.0
    };
    (from.0 + t * dx, from.1 + t * dy)
}

/// The point of the ellipse of half axes `a` and `b` about the origin nearest `(x, y)`, by the
/// root of Eberly's function found by bisection, which converges wherever the point lies, on the
/// axes and at the centre among them (D. Eberly, *Distance from a Point to an Ellipse, an
/// Ellipsoid, or a Hyperellipsoid*). A point on an axis with two nearest points takes the one
/// above, then the one to the right.
fn nearest_on_ellipse(a: f64, b: f64, x: f64, y: f64) -> (f64, f64) {
    // In the first quadrant, the longer half axis along the first coordinate.
    let (sx, sy) = (
        if x < 0.0 { -1.0 } else { 1.0 },
        if y > 0.0 { 1.0 } else { -1.0 },
    );
    let (u, v) = (x.abs(), y.abs());
    let (p, q) = if a >= b {
        quadrant_nearest(a, b, u, v)
    } else {
        let (q, p) = quadrant_nearest(b, a, v, u);
        (p, q)
    };
    (sx * p, sy * q)
}

/// `nearest_on_ellipse` in the first quadrant, `e0` ≥ `e1`, `y0` and `y1` not negative.
fn quadrant_nearest(e0: f64, e1: f64, y0: f64, y1: f64) -> (f64, f64) {
    if y1 > 0.0 {
        if y0 > 0.0 {
            let (z0, z1) = (y0 / e0, y1 / e1);
            let g = z0 * z0 + z1 * z1 - 1.0;
            if g == 0.0 {
                return (y0, y1);
            }
            let r0 = (e0 / e1) * (e0 / e1);
            let s = ellipse_root(r0, z0, z1, g);
            return (r0 * y0 / (s + r0), y1 / (s + 1.0));
        }
        return (0.0, e1);
    }
    let squares = e0 * e0 - e1 * e1;
    if squares > 0.0 && y0 < squares / e0 {
        let x0 = e0 * e0 * y0 / squares;
        return (x0, e1 * (1.0 - (x0 / e0) * (x0 / e0)).max(0.0).sqrt());
    }
    (e0, 0.0)
}

/// The root of Eberly's function for `r0`, `z0`, `z1`, whose value at 0 is `g`, by bisection to
/// the precision of `f64`.
fn ellipse_root(r0: f64, z0: f64, z1: f64, g: f64) -> f64 {
    let n0 = r0 * z0;
    let mut s0 = z1 - 1.0;
    let mut s1 = if g < 0.0 {
        0.0
    } else {
        crate::geometry::length(n0, z1) - 1.0
    };
    let mut s = 0.0;
    for _ in 0..1100 {
        s = (s0 + s1) / 2.0;
        if s == s0 || s == s1 {
            break;
        }
        let (ratio0, ratio1) = (n0 / (s + r0), z1 / (s + 1.0));
        let value = ratio0 * ratio0 + ratio1 * ratio1 - 1.0;
        if value > 0.0 {
            s0 = s;
        } else if value < 0.0 {
            s1 = s;
        } else {
            break;
        }
    }
    s
}

/// How far from the centre of a box of half-sides `a` × `b` the unit direction `(ux, uy)` meets
/// its border.
fn box_distance(a: f64, b: f64, ux: f64, uy: f64) -> f64 {
    let along_x = if ux == 0.0 {
        f64::INFINITY
    } else {
        a / ux.abs()
    };
    let along_y = if uy == 0.0 {
        f64::INFINITY
    } else {
        b / uy.abs()
    };
    along_x.min(along_y)
}

/// How far from the centre of a rounded rectangle of half-sides `a` × `b` the unit direction
/// `(ux, uy)` meets its outline: the box's border, or the arc of a corner where the box's border
/// lies in that corner's square.
fn rounded_distance(a: f64, b: f64, ux: f64, uy: f64) -> f64 {
    let r = ROUNDED_RADIUS.min(a).min(b);
    let t = box_distance(a, b, ux, uy);
    let (px, py) = ((t * ux).abs(), (t * uy).abs());
    if px <= a - r || py <= b - r {
        return t;
    }
    // The ray `s · (|ux|, |uy|)` meets the circle of radius `r` around the corner's centre
    // `(a - r, b - r)`: s² − 2s(c · u) + |c|² − r² = 0, its far root.
    let (cx, cy) = (a - r, b - r);
    let (vx, vy) = (ux.abs(), uy.abs());
    let along = cx * vx + cy * vy;
    let rest = cx * cx + cy * cy - r * r;
    along + (along * along - rest).max(0.0).sqrt()
}

#[cfg(test)]
pub(crate) mod tests {
    // Verifies: REN-closed-set-of-node-shapes
    use super::*;

    /// Directions around the full turn, the axes and the diagonals among them.
    fn directions() -> impl Iterator<Item = (f64, f64)> {
        (0..72).map(|i| {
            let angle = f64::from(i) * core::f64::consts::TAU / 72.0;
            (angle.cos(), angle.sin())
        })
    }

    /// Node sizes: square, wide, tall, small, and large.
    const SIZES: [(f64, f64); 5] = [
        (80.0, 80.0),
        (220.0, 64.0),
        (40.0, 120.0),
        (12.0, 12.0),
        (4000.0, 900.0),
    ];

    #[test]
    fn the_codes_are_the_places_in_the_set_and_none_lies_beyond() {
        for (code, shape) in NodeShape::ALL.iter().enumerate() {
            assert_eq!(NodeShape::of_code(code as u8), Some(*shape));
        }
        assert_eq!(NodeShape::of_code(7), None);
        assert_eq!(NodeShape::of_code(255), None);
        assert_eq!(NodeShape::default(), NodeShape::Rectangle);
    }

    #[test]
    fn a_rectangle_lays_out_and_is_as_high_as_a_node_before_node_shapes() {
        for (width, height) in SIZES {
            assert_eq!(NodeShape::Rectangle.height(width, height), height);
            assert_eq!(NodeShape::Rectangle.content_width(width), width);
            assert_eq!(
                NodeShape::Rectangle.inner(width, height),
                Inner {
                    x: 0.0,
                    y: 0.0,
                    width,
                    height
                }
            );
            assert_eq!(NodeShape::RoundedRectangle.height(width, height), height);
            assert_eq!(NodeShape::RoundedRectangle.content_width(width), width);
        }
    }

    #[test]
    fn a_content_node_shape_is_as_high_as_its_inner_rectangle_needs_for_its_content() {
        for shape in [NodeShape::Ellipse, NodeShape::Diamond] {
            for (width, content) in SIZES {
                let height = shape.height(width, content);
                let inner = shape.inner(width, height);
                assert!(
                    (inner.height - content).abs() < 1e-9,
                    "{shape:?} {width} {content}"
                );
                assert!((inner.width - shape.content_width(width)).abs() < 1e-9);
                // Centred, and within the node.
                assert!((inner.x * 2.0 + inner.width - width).abs() < 1e-9);
                assert!((inner.y * 2.0 + inner.height - height).abs() < 1e-9);
                // Its corners lie within the outline.
                for (x, y) in [
                    (inner.x, inner.y),
                    (inner.x + inner.width, inner.y),
                    (inner.x, inner.y + inner.height),
                    (inner.x + inner.width, inner.y + inner.height),
                ] {
                    assert!(
                        shape.contains(width, height, x, y) || {
                            // On the outline, within rounding.
                            let (cx, cy) = (width / 2.0, height / 2.0);
                            shape.contains(
                                width,
                                height,
                                cx + (x - cx) * (1.0 - 1e-12),
                                cy + (y - cy) * (1.0 - 1e-12),
                            )
                        }
                    );
                }
            }
        }
    }

    #[test]
    fn a_filled_node_shape_holds_no_content_and_has_its_own_height() {
        for shape in NodeShape::ALL {
            assert_eq!(
                shape.holds_content(),
                !matches!(
                    shape,
                    NodeShape::Circle | NodeShape::RingedCircle | NodeShape::Bar
                )
            );
        }
        assert_eq!(NodeShape::Circle.height(30.0, 64.0), 30.0);
        assert_eq!(NodeShape::RingedCircle.height(30.0, 64.0), 30.0);
        assert_eq!(NodeShape::Bar.height(200.0, 64.0), BAR_HEIGHT);
        assert_eq!(NodeShape::Bar.content_width(200.0), 0.0);
    }

    #[test]
    fn a_node_is_as_high_as_its_data_gives_never_less_than_its_content_and_without_content_as_wide()
    {
        // Verifies: REN-node-shapes-cover-uml, REN-node-content-and-hits
        let content = Some(64.0);
        for shape in [NodeShape::Rectangle, NodeShape::RoundedRectangle] {
            // A height below the content's is raised to it, a greater one kept.
            assert_eq!(shape.sized(220.0, content, Some(20.0)), 64.0);
            assert_eq!(shape.sized(220.0, content, Some(300.0)), 300.0);
            assert_eq!(shape.sized(220.0, content, None), 64.0);
            // Without content, as its data gives however small, or as wide.
            assert_eq!(shape.sized(220.0, None, Some(10.0)), 10.0);
            assert_eq!(shape.sized(16.0, None, None), 16.0);
        }
        // An ellipse's content needs its inner rectangle, a height below that raised to it.
        let needed = NodeShape::Ellipse.height(220.0, 64.0);
        assert_eq!(NodeShape::Ellipse.sized(220.0, content, Some(70.0)), needed);
        assert_eq!(NodeShape::Ellipse.sized(220.0, content, Some(200.0)), 200.0);
        // A circle as high as wide whatever its data gives; a bar 8 high or as its data gives.
        assert_eq!(NodeShape::Circle.sized(30.0, None, Some(10.0)), 30.0);
        assert_eq!(NodeShape::RingedCircle.sized(30.0, None, None), 30.0);
        assert_eq!(NodeShape::Bar.sized(220.0, None, None), BAR_HEIGHT);
        assert_eq!(NodeShape::Bar.sized(8.0, None, Some(120.0)), 120.0);
    }

    #[test]
    fn a_node_is_hit_within_its_outline_and_not_beside_it() {
        // The centre of each node shape is hit, and a corner of its rectangle only by the
        // rectangle and the bar.
        for shape in NodeShape::ALL {
            for (width, height) in SIZES {
                assert!(
                    shape.contains(width, height, width / 2.0, height / 2.0),
                    "{shape:?}"
                );
                let corner = shape.contains(width, height, 0.5, 0.5);
                let boxed = matches!(shape, NodeShape::Rectangle | NodeShape::Bar);
                assert_eq!(corner, boxed, "{shape:?} {width}x{height}");
                assert!(!shape.contains(width, height, -0.5, height / 2.0));
                assert!(!shape.contains(width, height, width / 2.0, height + 0.5));
            }
        }
        // A diamond's edge: hit just inside, not just outside, at a quarter of its width.
        let (w, h) = (100.0, 60.0);
        let y_on_edge = h / 2.0 - (h / 2.0) * (1.0 - 25.0 / 50.0);
        assert!(NodeShape::Diamond.contains(w, h, 25.0, y_on_edge + 0.01));
        assert!(!NodeShape::Diamond.contains(w, h, 25.0, y_on_edge - 0.01));
    }

    #[test]
    fn a_crossing_lies_on_the_outline_in_the_direction_asked_for_every_node_shape() {
        for shape in NodeShape::ALL {
            for (width, height) in SIZES {
                let (cx, cy) = (width / 2.0, height / 2.0);
                for (dx, dy) in directions() {
                    let (x, y) = shape.crossing(width, height, dx, dy);
                    // In the direction asked: the cross product of the ray and the point is nil.
                    let (px, py) = (x - cx, y - cy);
                    assert!(
                        (px * dy - py * dx).abs() <= 1e-9 * (width + height),
                        "{shape:?}"
                    );
                    assert!(px * dx + py * dy > 0.0, "{shape:?} points backwards");
                    // On the outline: hit a hair inside, not a hair outside.
                    let scale = 1e-9 * (width + height);
                    let length = px.hypot(py);
                    let (ix, iy) = (
                        cx + px * (1.0 - scale / length),
                        cy + py * (1.0 - scale / length),
                    );
                    let (ox, oy) = (
                        cx + px * (1.0 + scale / length),
                        cy + py * (1.0 + scale / length),
                    );
                    assert!(
                        shape.contains(width, height, ix, iy),
                        "{shape:?} {width}x{height} ({dx}, {dy}) inside"
                    );
                    assert!(
                        !shape.contains(width, height, ox, oy),
                        "{shape:?} {width}x{height} ({dx}, {dy}) outside"
                    );
                }
            }
        }
    }

    #[test]
    fn a_node_rounded_to_a_line_or_a_point_is_hit_as_its_rectangle() {
        for shape in NodeShape::ALL {
            assert!(shape.contains(0.0, 60.0, 0.0, 30.0), "{shape:?}");
            assert!(shape.contains(0.0, 0.0, 0.0, 0.0), "{shape:?}");
            assert!(!shape.contains(0.0, 60.0, 0.5, 30.0), "{shape:?}");
        }
    }

    #[test]
    fn an_inset_of_an_empty_node_is_nil() {
        // Decides no criterion: a node rounded to a line or a point has no outline inside its
        // rectangle, so a loop's ends stay on its side, finite.
        for shape in NodeShape::ALL {
            assert_eq!(shape.inset(0.0, 40.0, 0.0), 0.0, "{shape:?}");
            assert_eq!(shape.inset(40.0, 0.0, 10.0), 0.0, "{shape:?}");
        }
    }

    /// How far `(x, y)` lies off the outline of a node of `shape` and `width` × `height`, by the
    /// outline's own equation, written here apart from the code under test.
    pub(crate) fn off_outline(shape: NodeShape, width: f64, height: f64, x: f64, y: f64) -> f64 {
        let (a, b) = (width / 2.0, height / 2.0);
        let (dx, dy) = ((x - a).abs(), (y - b).abs());
        let off_box = (dx - a).abs().min((dy - b).abs()) + (dx - a).max(0.0) + (dy - b).max(0.0);
        match shape {
            NodeShape::Rectangle | NodeShape::Bar => off_box,
            NodeShape::RoundedRectangle => {
                let r = ROUNDED_RADIUS.min(a).min(b);
                let (ex, ey) = (dx - (a - r), dy - (b - r));
                if ex > 0.0 && ey > 0.0 {
                    (ex.hypot(ey) - r).abs()
                } else {
                    off_box
                }
            }
            NodeShape::Ellipse | NodeShape::Circle | NodeShape::RingedCircle => {
                // The radial distance, which is within the distance's order near the outline.
                let k = ((dx / a).powi(2) + (dy / b).powi(2)).sqrt();
                (k - 1.0).abs() * a.min(b)
            }
            NodeShape::Diamond => (dx / a + dy / b - 1.0).abs() * a * b / a.hypot(b),
        }
    }

    /// Points of the outline of a node of `shape` and `width` × `height`, `n` of them, by the
    /// outline's own parametrization, written here apart from the code under test.
    pub(crate) fn outline_points(
        shape: NodeShape,
        width: f64,
        height: f64,
        n: usize,
    ) -> Vec<(f64, f64)> {
        let (a, b) = (width / 2.0, height / 2.0);
        let turn = |i: usize| i as f64 * core::f64::consts::TAU / n as f64;
        match shape {
            NodeShape::Ellipse | NodeShape::Circle | NodeShape::RingedCircle => (0..n)
                .map(|i| (a + a * turn(i).cos(), b + b * turn(i).sin()))
                .collect(),
            NodeShape::Diamond => {
                let corners = [(a, 0.0), (width, b), (a, height), (0.0, b), (a, 0.0)];
                (0..n)
                    .map(|i| {
                        let t = i as f64 * 4.0 / n as f64;
                        let (k, f) = (t.floor() as usize, t.fract());
                        let (p, q) = (corners[k], corners[k + 1]);
                        (p.0 + (q.0 - p.0) * f, p.1 + (q.1 - p.1) * f)
                    })
                    .collect()
            }
            NodeShape::Rectangle | NodeShape::Bar | NodeShape::RoundedRectangle => {
                let r = if shape == NodeShape::RoundedRectangle {
                    ROUNDED_RADIUS.min(a).min(b)
                } else {
                    0.0
                };
                // The four sides, then the four arcs, each by its share of the points.
                let mut points = Vec::with_capacity(n);
                let per = n / 8;
                for i in 0..per {
                    let f = i as f64 / per as f64;
                    let (x, y) = (r + (width - 2.0 * r) * f, r + (height - 2.0 * r) * f);
                    points.extend([(x, 0.0), (width, y), (x, height), (0.0, y)]);
                }
                for i in 0..per {
                    let angle = i as f64 / per as f64 * core::f64::consts::FRAC_PI_2;
                    let (c, s) = (r * angle.cos(), r * angle.sin());
                    points.extend([
                        (width - r + c, r - s),
                        (width - r + c, height - r + s),
                        (r - c, height - r + s),
                        (r - c, r - s),
                    ]);
                }
                points
            }
        }
    }

    /// Node sizes of border node tests: square, wide, tall, small, a bar, and large.
    const BORDERED: [(f64, f64); 6] = [
        (80.0, 80.0),
        (220.0, 64.0),
        (40.0, 120.0),
        (12.0, 12.0),
        (90.0, 8.0),
        (4000.0, 900.0),
    ];

    const SIDES: [Side; 4] = [Side::Top, Side::Right, Side::Bottom, Side::Left];

    #[test]
    fn a_border_node_sits_on_the_outline_at_its_offset_on_the_half_of_its_side() {
        // Verifies: ARCH-border-nodes-ride-sides
        for shape in NodeShape::ALL {
            for (width, height) in BORDERED {
                for side in SIDES {
                    let length = side_length(width, height, side);
                    for offset in [-10.0, 0.0, length / 7.0, length / 2.0, length, length * 2.0] {
                        let (x, y) = shape.on_side(width, height, side, offset);
                        let scale = width.max(height);
                        let off = off_outline(shape, width, height, x, y);
                        assert!(off <= 1e-9 * scale, "{shape:?} {side:?} {offset}: {off}");
                        // At the offset held within the side, on the half nearer the side.
                        let held = offset.clamp(0.0, length);
                        let (along, near) = match side {
                            Side::Top => (x, y <= height / 2.0),
                            Side::Right => (y, x >= width / 2.0),
                            Side::Bottom => (x, y >= height / 2.0),
                            Side::Left => (y, x <= width / 2.0),
                        };
                        assert!((along - held).abs() <= 1e-9 * scale, "{shape:?} {side:?}");
                        assert!(near, "{shape:?} {side:?} {offset}: ({x}, {y})");
                    }
                }
            }
        }
    }

    #[test]
    fn the_nearest_point_of_the_outline_is_nearer_than_every_point_a_scan_of_it_finds() {
        // Verifies: ARCH-border-nodes-ride-sides
        let mut far = 0;
        let mut inside = 0;
        for shape in NodeShape::ALL {
            for (width, height) in BORDERED {
                let scan = outline_points(shape, width, height, 8_000);
                let scale = width.max(height);
                for i in 0..120 {
                    // Points around and inside the node, the centre and the axes among them.
                    let angle = i as f64 * core::f64::consts::TAU / 120.0;
                    let reach = [0.0, 0.1, 0.45, 0.5, 0.9, 1.0, 1.5, 4.0][i % 8];
                    let (x, y) = (
                        width / 2.0 + angle.cos() * reach * width,
                        height / 2.0 + angle.sin() * reach * height,
                    );
                    let (px, py) = shape.nearest(width, height, x, y);
                    let off = off_outline(shape, width, height, px, py);
                    assert!(off <= 1e-9 * scale, "{shape:?} ({x}, {y}): off by {off}");
                    let found = (px - x).hypot(py - y);
                    let scanned = scan
                        .iter()
                        .map(|&(sx, sy)| (sx - x).hypot(sy - y))
                        .fold(f64::INFINITY, f64::min);
                    assert!(
                        found <= scanned + 1e-9 * scale,
                        "{shape:?} {width}x{height} ({x}, {y}): {found} > {scanned}"
                    );
                    if shape.contains(width, height, x, y) {
                        inside += 1;
                    } else {
                        far += 1;
                    }
                }
            }
        }
        assert!(inside > 200 && far > 200, "{inside} inside, {far} outside");
    }

    #[test]
    fn a_point_of_the_outline_leads_back_to_itself_by_its_nearest_side_and_its_offset() {
        // Verifies: ARCH-border-nodes-ride-sides
        for shape in NodeShape::ALL {
            for (width, height) in BORDERED {
                let scale = width.max(height);
                for (x, y) in outline_points(shape, width, height, 2_000) {
                    let (side, offset) = side_of(width, height, x, y);
                    let (bx, by) = shape.on_side(width, height, side, offset);
                    assert!(
                        (bx - x).hypot(by - y) <= 1e-7 * scale,
                        "{shape:?} {width}x{height} ({x}, {y}) by {side:?} {offset}: ({bx}, {by})"
                    );
                }
            }
        }
        // Ties go to the top, then the right, then the bottom.
        assert_eq!(side_of(80.0, 40.0, 80.0, 0.0), (Side::Top, 80.0));
        assert_eq!(side_of(80.0, 40.0, 80.0, 40.0), (Side::Right, 40.0));
        assert_eq!(side_of(80.0, 40.0, 0.0, 40.0), (Side::Bottom, 0.0));
    }

    #[test]
    fn a_crossing_of_no_direction_or_of_an_empty_node_is_its_centre() {
        assert_eq!(
            NodeShape::Ellipse.crossing(80.0, 40.0, 0.0, 0.0),
            (40.0, 20.0)
        );
        assert_eq!(
            NodeShape::Diamond.crossing(0.0, 40.0, 1.0, 0.0),
            (0.0, 20.0)
        );
    }
}
