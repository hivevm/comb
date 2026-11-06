//! The node shapes of the closed set the engine owns (ADR-0032): each node shape's
//! height for content of a given height, the inner rectangle its content is laid out in, its hit
//! test, and the point where a line from its centre crosses its outline. All of it is in the
//! node's own coordinates, its top-left corner at the origin, so that it holds wherever the node
//! lies in the world.

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
mod tests {
    // Verifies: ADR-0032
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
