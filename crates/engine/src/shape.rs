//! The node shapes of the closed set the engine owns (REN-node-shapes-cover-uml): each node
//! shape's height for content of a given height, the inner rectangle its content is laid out in,
//! the box of an actor's and an hourglass's drawing above it (`drawing`), its hit test, the point
//! where a line from its centre crosses its outline, how far inside a side the outline lies at a
//! point of the side (`inset`), where a border node sits on it by a side and an offset along it
//! (ARCH-border-nodes-ride-sides), and the dashes of a dashed outline.
//! All of it is in the node's own coordinates, its top-left corner at the origin, so that it holds
//! wherever the node lies in the world.

use crate::geometry::Side;

/// The radius of the corners of a rounded rectangle, which lies within the padding of content,
/// so that a rounded rectangle lays its content out as a rectangle does.
pub const ROUNDED_RADIUS: f64 = 10.0;
/// The radius of the corners of a rectangle as the shell draws them, which its dashes follow;
/// the engine hits a rectangle as its bounding rectangle, its corners included.
pub const RECTANGLE_RADIUS: f64 = 6.0;
/// The height of a bar.
pub const BAR_HEIGHT: f64 = 8.0;
/// How far a note's top right corner is folded down, at most its width and its height.
pub const NOTE_FOLD: f64 = 12.0;
/// How far the lower right corner of a frame's tab is cut, which the shell draws.
pub const FRAME_CUT: f64 = 8.0;
/// The most a captioned node shape's drawing is high, in world units (`NodeShape::drawing`).
pub const DRAWING_LIMIT: f64 = 48.0;
/// How far a dashed outline's flattened curves may lie from the curves, in world units: a
/// quarter of a screen pixel at the largest scale of 4 a viewport takes, within Q-4.
pub const OUTLINE_TOLERANCE: f64 = 1.0 / 16.0;
/// The most chords a curve of a dashed outline is flattened into: a full ellipse's, so that its
/// work stays bounded however large its node. A chord then lies at most about 2.94e-7 of the
/// ellipse's larger half axis off it: within `OUTLINE_TOLERANCE` up to some 4 × 10^5 world units
/// across, and within Q-4's half pixel at the largest scale of 4, an eighth of a world unit, up to
/// some 8.5 × 10^5; a larger ellipse's dashes stray further, which no criterion tests.
pub const MAX_CURVE_STEPS: usize = 4096;
/// The most dash segments a node's outline is laid in within a query's rectangle; a pattern that
/// would need more there is laid solid. The bound is a count, not a size on screen: within a
/// query of a viewport of up to some 4,000 pixels it lays solid only a pattern whose period is
/// below about half a pixel, which no screen tells from a solid line, but a larger rectangle
/// reaches it with a coarser pattern.
pub const MAX_DASH_SEGMENTS: usize = 1 << 15;

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
    /// A rectangle whose right side is a point as deep as half the node's height (`depth`).
    Pentagon,
    /// A rectangle whose left side is notched inwards by a point as deep as half the node's
    /// height (`depth`).
    NotchedRectangle,
    /// A rectangle whose top right corner is folded down by `NOTE_FOLD`, hit as its bounding
    /// rectangle.
    Note,
    /// A rectangle with a tab at its top left that holds its content, hit as its bounding
    /// rectangle.
    Frame,
    /// An unfilled ring crossed by an X between its diagonal points, as high as wide.
    CrossedCircle,
    /// An X between the corners of its box, as high as wide, hit as its bounding rectangle.
    Cross,
    /// A stick figure at the top of the node (`drawing`), its content below it, hit as its
    /// bounding rectangle.
    Actor,
    /// Two triangles meeting at their points at the top of the node (`drawing`), its content
    /// below it, hit as its bounding rectangle.
    Hourglass,
}

/// How a node's outline is drawn (REN-node-shapes-cover-uml, *Outline*): solid, not at all, or in
/// dashes of a length with gaps of a length, in world units along the outline, as the bridge
/// checked them, the dash positive and the gap not negative.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Outline {
    #[default]
    Solid,
    None,
    Dashed([f32; 2]),
}

/// A rectangle in a node's own coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Inner {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// How deep the point of a pentagon and the notch of a notched rectangle `width` × `height` reach
/// into it: half its height, cut at a quarter of its width, so that its centre lies within its
/// outline and a loop's two ends on its top or its bottom meet the outline where it runs along
/// the side.
pub(crate) fn depth(width: f64, height: f64) -> f64 {
    (height / 2.0).min(width / 4.0).max(0.0)
}

/// How far the corner of a note `width` × `height` is folded down: `NOTE_FOLD`, at most a quarter
/// of its width and of its height, so that a loop's two ends on its top or its right side meet the
/// outline beside the fold.
pub(crate) fn fold(width: f64, height: f64) -> f64 {
    NOTE_FOLD.min(width / 4.0).min(height / 4.0).max(0.0)
}

impl NodeShape {
    /// Every node shape, in the order of their codes.
    pub const ALL: [Self; 15] = [
        Self::Rectangle,
        Self::RoundedRectangle,
        Self::Ellipse,
        Self::Circle,
        Self::RingedCircle,
        Self::Diamond,
        Self::Bar,
        Self::Pentagon,
        Self::NotchedRectangle,
        Self::Note,
        Self::Frame,
        Self::CrossedCircle,
        Self::Cross,
        Self::Actor,
        Self::Hourglass,
    ];

    /// How many times as high as wide a captioned node shape's drawing is: 2 for an actor and 1.5
    /// for an hourglass; none for another node shape.
    const fn proportion(self) -> Option<f64> {
        match self {
            Self::Actor => Some(2.0),
            Self::Hourglass => Some(1.5),
            _ => None,
        }
    }

    /// The box of the drawing of a captioned node shape `width` wide, relative to the node
    /// (REN-node-shapes-cover-uml, *Content and node shape*): at its top, of the drawing's
    /// proportion, as wide as the node until it is `DRAWING_LIMIT` high, and above that
    /// `DRAWING_LIMIT` high and centred; none for another node shape.
    pub(crate) fn drawing(self, width: f64) -> Option<Inner> {
        let proportion = self.proportion()?;
        let height = (width.max(0.0) * proportion).min(DRAWING_LIMIT);
        let drawn = height / proportion;
        Some(Inner {
            x: (width.max(0.0) - drawn) / 2.0,
            y: 0.0,
            width: drawn,
            height,
        })
    }

    /// How high the drawing of a captioned node shape `width` wide is, nil for another node shape.
    fn drawing_height(self, width: f64) -> f64 {
        self.drawing(width).map_or(0.0, |drawing| drawing.height)
    }

    /// Whether the node shape has an outline to draw, solid or in dashes: a content node shape
    /// has one, a filled one keeps its fill whatever its outline, and a captioned one draws its
    /// drawing and its content without a border.
    const fn outlined(self) -> bool {
        self.holds_content() && self.proportion().is_none()
    }

    /// The node shape of `code`, none for a code outside the set.
    pub fn of_code(code: u8) -> Option<Self> {
        Self::ALL.get(usize::from(code)).copied()
    }

    /// Whether the node shape holds content; the filled ones hold none.
    pub const fn holds_content(self) -> bool {
        !matches!(
            self,
            Self::Circle | Self::RingedCircle | Self::Bar | Self::CrossedCircle | Self::Cross
        )
    }

    /// The share of the node's width and height a centred inner rectangle takes, on each axis,
    /// of the node shapes whose inner rectangle is centred.
    fn inner_share(self) -> f64 {
        match self {
            Self::Ellipse => core::f64::consts::FRAC_1_SQRT_2,
            Self::Diamond => 0.5,
            Self::Circle | Self::RingedCircle | Self::Bar | Self::CrossedCircle | Self::Cross => {
                0.0
            }
            _ => 1.0,
        }
    }

    /// The height of a node of this shape and `width` whose content, laid out as in a rectangle,
    /// is `content` high: as high as its inner rectangle needs for that content, as high as wide
    /// for a circle, a crossed circle, and a cross, `BAR_HEIGHT` for a bar, and as high as its
    /// drawing and its content for an actor and an hourglass. The inner rectangle of a pentagon, a
    /// notched rectangle, a note, and a frame is as high as the node, a frame's tab as high as its
    /// content.
    fn grown(self, width: f64, content: f64) -> f64 {
        match self {
            Self::Circle | Self::RingedCircle | Self::CrossedCircle | Self::Cross => width,
            Self::Bar => BAR_HEIGHT,
            Self::Actor | Self::Hourglass => self.drawing_height(width) + content,
            _ => content / self.inner_share(),
        }
    }

    /// The height a node of this shape and `width` needs for its content, whose rows and padding
    /// are `content` high as in a rectangle, before the least height of a node (`content::padded`),
    /// and nil for none (REN-node-shapes-cover-uml, *Height*; REN-node-content-and-hits,
    /// *Layout*): with content, an actor and an hourglass their drawing and their content, at least
    /// `MIN_HEIGHT` as a whole node, its drawing counted in, and every other node shape
    /// its content raised to `MIN_HEIGHT` and grown as `grown` grows it; without content, an actor
    /// and an hourglass their drawing, a bar `BAR_HEIGHT`, a circle, a crossed circle, and a cross
    /// their width, and every other node shape nil.
    fn needed(self, width: f64, content: f64) -> f64 {
        let least = crate::content::MIN_HEIGHT;
        match self {
            Self::Circle | Self::RingedCircle | Self::CrossedCircle | Self::Cross | Self::Bar => {
                self.grown(width, content)
            }
            _ if content <= 0.0 => self.drawing_height(width),
            Self::Actor | Self::Hourglass => self.grown(width, content).max(least),
            _ => self.grown(width, content.max(least)),
        }
    }

    /// The height of a node of this shape and `width` whose rows and padding are `content` high
    /// as in a rectangle, before the least height of a node, none for a node without rows, and
    /// whose data gives the height `given`, or none: the one function of a node's height, which
    /// a load, an edit, a change of the fonts, a resize, and `heightOf` reach
    /// (REN-node-shapes-cover-uml, *Height*; REN-node-content-and-hits, *Layout*):
    ///
    /// - a circle, a crossed circle, and a cross as high as wide;
    /// - a bar `BAR_HEIGHT` high, or as its data gives;
    /// - a node with content as high as its content needs, its inner rectangle and the least
    ///   height counted in, or as its data gives where that is more;
    /// - an actor and an hourglass without content as high as their drawing, or as their data
    ///   gives where that is more;
    /// - another node without content as high as its data gives, or as wide, however small.
    ///
    /// A `given` of 0, which every other height raises, gives the least height a resize may leave
    /// of a node that is no circle: for a node without content of a content node shape 0, not its
    /// width, as `None` would give.
    pub(crate) fn height(self, width: f64, content: Option<f64>, given: Option<f64>) -> f64 {
        match (self, content) {
            (Self::Circle | Self::RingedCircle | Self::CrossedCircle | Self::Cross, _) => width,
            (Self::Bar, _) => given.unwrap_or(BAR_HEIGHT),
            (Self::Actor | Self::Hourglass, None) => {
                let drawing = self.drawing_height(width);
                given.map_or(drawing, |given| given.max(drawing))
            }
            (_, Some(content)) => {
                let needed = self.needed(width, content);
                given.map_or(needed, |given| given.max(needed))
            }
            (_, None) => given.unwrap_or(width),
        }
    }

    /// How far below the top of a node of this shape and `width` its regions lie, its rows and
    /// padding `content` high as `height` takes them (ARCH-regions-are-container-slots,
    /// *Division*): below an actor's or an hourglass's drawing and its content, as high as
    /// `height` makes them without a height of its data; below any other node's content laid out
    /// as in a rectangle, at least the least height of a node; at 0 for another node without
    /// content.
    pub(crate) fn top(self, width: f64, content: Option<f64>) -> f64 {
        let laid = if self.proportion().is_some() {
            self
        } else {
            Self::Rectangle
        };
        laid.height(width, content, Some(0.0))
    }

    /// The rectangle of a node of this shape of `width` × `height` that its content is laid out
    /// in, as in a rectangle of that size (REN-node-shapes-cover-uml, *Content and node shape*):
    /// centred for a rectangle, a rounded rectangle, a note, an ellipse, and a diamond; left of a
    /// pentagon's point; right of a notch's depth; a frame's tab at its top left, `tab` the
    /// natural width of its content with the padding and the height of its content, cut to the
    /// node; below an actor's and an hourglass's drawing, as wide as the node; and empty for a
    /// filled node shape.
    pub fn inner(self, width: f64, height: f64, tab: [f64; 2]) -> Inner {
        match self {
            Self::Actor | Self::Hourglass => {
                let below = self.drawing_height(width).min(height.max(0.0));
                Inner {
                    x: 0.0,
                    y: below,
                    width,
                    height: height - below,
                }
            }
            Self::Pentagon => Inner {
                x: 0.0,
                y: 0.0,
                width: width - depth(width, height),
                height,
            },
            Self::NotchedRectangle => {
                let d = depth(width, height);
                Inner {
                    x: d,
                    y: 0.0,
                    width: width - d,
                    height,
                }
            }
            Self::Frame => Inner {
                x: 0.0,
                y: 0.0,
                width: tab[0].min(width).max(0.0),
                height: tab[1].min(height).max(0.0),
            },
            _ => {
                let share = self.inner_share();
                let (inner_width, inner_height) = (width * share, height * share);
                Inner {
                    x: (width - inner_width) / 2.0,
                    y: (height - inner_height) / 2.0,
                    width: inner_width,
                    height: inner_height,
                }
            }
        }
    }

    /// The five corners of the outline of a pentagon, a notched rectangle, or a note of `width` ×
    /// `height`, clockwise from its top left; none for another node shape.
    fn polygon(self, width: f64, height: f64) -> Option<[(f64, f64); 5]> {
        let b = height / 2.0;
        match self {
            Self::Pentagon => {
                let d = depth(width, height);
                Some([
                    (0.0, 0.0),
                    (width - d, 0.0),
                    (width, b),
                    (width - d, height),
                    (0.0, height),
                ])
            }
            Self::NotchedRectangle => Some([
                (0.0, 0.0),
                (width, 0.0),
                (width, height),
                (0.0, height),
                (depth(width, height), b),
            ]),
            Self::Note => {
                let c = fold(width, height);
                Some([
                    (0.0, 0.0),
                    (width - c, 0.0),
                    (width, c),
                    (width, height),
                    (0.0, height),
                ])
            }
            _ => None,
        }
    }

    /// Whether the point `(x, y)` of a node of this shape and `width` × `height` lies within its
    /// outline, the outline included; a note and a frame within their bounding rectangle.
    pub(crate) fn contains(self, width: f64, height: f64, x: f64, y: f64) -> bool {
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
            Self::Rectangle
            | Self::Bar
            | Self::Note
            | Self::Frame
            | Self::Cross
            | Self::Actor
            | Self::Hourglass => true,
            Self::RoundedRectangle => {
                let r = ROUNDED_RADIUS.min(a).min(b);
                let (ex, ey) = (dx - (a - r), dy - (b - r));
                ex <= 0.0 || ey <= 0.0 || ex * ex + ey * ey <= r * r
            }
            Self::Ellipse | Self::Circle | Self::RingedCircle | Self::CrossedCircle => {
                (dx / a).powi(2) + (dy / b).powi(2) <= 1.0
            }
            Self::Diamond => dx / a + dy / b <= 1.0,
            Self::Pentagon => {
                let d = depth(width, height);
                x <= width - d || dy * d <= (width - x) * b
            }
            Self::NotchedRectangle => x * b >= depth(width, height) * (b - dy),
        }
    }

    /// The point of the outline of a node of this shape and `width` × `height` where the line
    /// from its centre in the direction `(dx, dy)` crosses it; the centre for no direction or an
    /// empty node. A note's outline is cut at its folded corner.
    pub(crate) fn crossing(self, width: f64, height: f64, dx: f64, dy: f64) -> (f64, f64) {
        let (a, b) = (width / 2.0, height / 2.0);
        let length = crate::geometry::length(dx, dy);
        if length == 0.0 || a <= 0.0 || b <= 0.0 {
            return (a, b);
        }
        let (ux, uy) = (dx / length, dy / length);
        let t = match self {
            Self::Rectangle
            | Self::Bar
            | Self::Frame
            | Self::Cross
            | Self::Actor
            | Self::Hourglass => box_distance(a, b, ux, uy),
            Self::RoundedRectangle => rounded_distance(a, b, ux, uy),
            Self::Ellipse | Self::Circle | Self::RingedCircle | Self::CrossedCircle => {
                1.0 / ((ux / a).powi(2) + (uy / b).powi(2)).sqrt()
            }
            Self::Diamond => 1.0 / (ux.abs() / a + uy.abs() / b),
            Self::Pentagon | Self::NotchedRectangle | Self::Note => self
                .polygon(width, height)
                .and_then(|corners| polygon_distance(&corners, (a, b), (ux, uy)))
                .unwrap_or_else(|| box_distance(a, b, ux, uy)),
        };
        (a + t * ux, b + t * uy)
    }

    /// How far inward along the normal of `side` the outline of a node of this shape and `width`
    /// × `height` lies from that side, at `at` from the side's start, its left end or its top end,
    /// within the side's length. It is nil for a rectangle, a bar, and a frame, for an empty
    /// node, and wherever the outline runs along the side.
    pub(crate) fn inset(self, side: Side, width: f64, height: f64, at: f64) -> f64 {
        let along = side_length(width, height, side);
        let (a, b) = (along / 2.0, (width + height - along) / 2.0);
        if a <= 0.0 || b <= 0.0 {
            return 0.0;
        }
        let u = (at - a).abs();
        let half = height / 2.0;
        match self {
            Self::Rectangle
            | Self::Bar
            | Self::Frame
            | Self::Cross
            | Self::Actor
            | Self::Hourglass => 0.0,
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
            Self::Ellipse | Self::Circle | Self::RingedCircle | Self::CrossedCircle => {
                let s = (u / a).min(1.0);
                b * s * s / (1.0 + (1.0 - s * s).sqrt())
            }
            Self::Diamond => b * (u / a),
            Self::Pentagon => {
                let d = depth(width, height);
                match side {
                    Side::Top | Side::Bottom => (at - (width - d)).max(0.0) * half / d,
                    Side::Right => d * ((at - half).abs() / half),
                    Side::Left => 0.0,
                }
            }
            Self::NotchedRectangle => match side {
                Side::Left => depth(width, height) * (1.0 - (at - half).abs() / half).max(0.0),
                _ => 0.0,
            },
            Self::Note => {
                let c = fold(width, height);
                match side {
                    Side::Top => (at - (width - c)).max(0.0),
                    Side::Right => (c - at).max(0.0),
                    Side::Bottom | Side::Left => 0.0,
                }
            }
        }
    }
}

/// The length of `side` of a box `width` × `height`: its width for the top and the bottom, its
/// height for the right and the left.
pub(crate) fn side_length(width: f64, height: f64, side: Side) -> f64 {
    match side {
        Side::Top | Side::Bottom => width,
        Side::Right | Side::Left => height,
    }
}

/// The sides of a box `width` × `height` in the order of their distance from the point `(x, y)` of
/// its own coordinates, ties in the order top, right, bottom, left, each with that distance.
fn sides_by_distance(width: f64, height: f64, x: f64, y: f64) -> [(Side, f64); 4] {
    let mut sides = [
        (Side::Top, y),
        (Side::Right, width - x),
        (Side::Bottom, height - y),
        (Side::Left, x),
    ];
    // An insertion sort, which keeps the order of ties.
    for i in 1..sides.len() {
        let mut j = i;
        while j > 0 && sides[j].1 < sides[j - 1].1 {
            sides.swap(j, j - 1);
            j -= 1;
        }
    }
    sides
}

/// The offset along `side` of a box `width` × `height` of the point `(x, y)`: its distance from
/// the side's start, held within the side's length.
fn along(width: f64, height: f64, side: Side, (x, y): (f64, f64)) -> f64 {
    let along = match side {
        Side::Top | Side::Bottom => x,
        Side::Right | Side::Left => y,
    };
    held(along, side_length(width, height, side))
}

/// The side of a box `width` × `height` nearest the point `(x, y)` of its own coordinates, ties
/// in the order top, right, bottom, left, and the point's offset along it, its distance from the
/// side's start, its left end or its top end, held within the side's length
/// (ARCH-border-nodes-ride-sides, *Drag*).
pub(crate) fn side_of(width: f64, height: f64, x: f64, y: f64) -> (Side, f64) {
    let side = sides_by_distance(width, height, x, y)[0].0;
    (side, along(width, height, side, (x, y)))
}

/// `offset` held within a side `length` long: from 0 to the length, 0 for a side of none.
pub(crate) fn held(offset: f64, length: f64) -> f64 {
    offset.min(length).max(0.0)
}

impl NodeShape {
    /// The centre of a border node on `side` of a node of this shape and `width` × `height`, at
    /// `offset` from the side's start, held within its length: where the line through that point
    /// at right angles to the side meets the outline, at the meeting point nearer the side
    /// (ARCH-border-nodes-ride-sides, *Place*).
    pub(crate) fn on_side(self, width: f64, height: f64, side: Side, offset: f64) -> (f64, f64) {
        let at = held(offset, side_length(width, height, side));
        let inset = self.inset(side, width, height, at);
        match side {
            Side::Top => (at, inset),
            Side::Right => (width - inset, at),
            Side::Bottom => (at, height - inset),
            Side::Left => (inset, at),
        }
    }

    /// The side and the offset along it by which `on_side` places a border node at the point
    /// `(x, y)` of the outline of a node of this shape and `width` × `height`: the nearest side of
    /// the box whose perpendicular through the point meets the outline there first, ties in the
    /// order top, right, bottom, left; the nearest side of the box where none does, as for a point
    /// off the outline (ARCH-border-nodes-ride-sides, *Drag*). A point of a notch, which no
    /// perpendicular from the top or the bottom reaches, takes the left side.
    pub(crate) fn side_of(self, width: f64, height: f64, x: f64, y: f64) -> (Side, f64) {
        let sides = sides_by_distance(width, height, x, y);
        let reach = 1e-9 * width.max(height).max(1.0);
        for (side, _) in sides {
            let offset = along(width, height, side, (x, y));
            let (bx, by) = self.on_side(width, height, side, offset);
            if (bx - x).abs() <= reach && (by - y).abs() <= reach {
                return (side, offset);
            }
        }
        let side = sides[0].0;
        (side, along(width, height, side, (x, y)))
    }

    /// The point of the outline of a node of this shape and `width` × `height` nearest the point
    /// `(x, y)`, inside the node or outside it (ARCH-border-nodes-ride-sides, *Drag*).
    pub(crate) fn nearest(self, width: f64, height: f64, x: f64, y: f64) -> (f64, f64) {
        let (a, b) = (width / 2.0, height / 2.0);
        if a <= 0.0 || b <= 0.0 {
            return (x.clamp(0.0, width), y.clamp(0.0, height));
        }
        match self {
            Self::Rectangle
            | Self::Bar
            | Self::Frame
            | Self::Cross
            | Self::Actor
            | Self::Hourglass => nearest_on_box(width, height, x, y, 0.0),
            Self::RoundedRectangle => {
                nearest_on_box(width, height, x, y, ROUNDED_RADIUS.min(a).min(b))
            }
            Self::Ellipse | Self::Circle | Self::RingedCircle | Self::CrossedCircle => {
                let (dx, dy) = nearest_on_ellipse(a, b, x - a, y - b);
                (a + dx, b + dy)
            }
            Self::Diamond => {
                let corners = [(a, 0.0), (width, b), (a, height), (0.0, b)];
                nearest_on_polygon(&corners, (x, y))
            }
            Self::Pentagon | Self::NotchedRectangle | Self::Note => self
                .polygon(width, height)
                .map_or((x, y), |corners| nearest_on_polygon(&corners, (x, y))),
        }
    }

    /// Pushes onto `out` the points of the outline of a node of this shape and `width` × `height`
    /// as it is drawn, a closed polyline whose first point is not repeated at its end, clockwise
    /// from the point of the outline nearest the top left corner of the node's box: a rectangle's
    /// corners rounded by `RECTANGLE_RADIUS`, a rounded rectangle's by `ROUNDED_RADIUS`, and an
    /// ellipse's curve, each flattened within `OUTLINE_TOLERANCE` and at most `MAX_CURVE_STEPS`
    /// chords. A node shape that is not `outlined` has none, nor has an empty node.
    pub(crate) fn outline(self, width: f64, height: f64, out: &mut Vec<(f64, f64)>) {
        out.clear();
        let (a, b) = (width / 2.0, height / 2.0);
        if !self.outlined() || a <= 0.0 || b <= 0.0 {
            return;
        }
        match self {
            Self::Rectangle => rounded_outline(width, height, RECTANGLE_RADIUS.min(a).min(b), out),
            Self::RoundedRectangle => {
                rounded_outline(width, height, ROUNDED_RADIUS.min(a).min(b), out);
            }
            Self::Frame => rounded_outline(width, height, 0.0, out),
            Self::Ellipse => {
                let steps = curve_steps(core::f64::consts::TAU, a.max(b));
                for i in 0..steps {
                    let angle = core::f64::consts::PI
                        + core::f64::consts::TAU * f64::from(numbered(i))
                            / f64::from(numbered(steps));
                    out.push((a + a * angle.cos(), b + b * angle.sin()));
                }
            }
            Self::Diamond => out.extend([(0.0, b), (a, 0.0), (width, b), (a, height)]),
            _ => out.extend(self.polygon(width, height).into_iter().flatten()),
        }
        start_nearest_top_left(out);
    }

    /// Pushes onto `out` the dash segments of the outline of a node of this shape and `width` ×
    /// `height` dashed in `dash` world units with gaps of `gap`, each segment's two ends
    /// `[x0, y0, x1, y1]` relative to the node, laid along the outline as `outline` draws it,
    /// clockwise from its first point, the pattern starting there with a dash
    /// (REN-node-shapes-cover-uml, *Outline*). It lays only the dashes within `clip`, `[min_x,
    /// min_y, max_x, max_y]` relative to the node, cut at its border, and lays the outline there
    /// solid where it would take more than `MAX_DASH_SEGMENTS` segments; a dash that turns a
    /// corner of the polyline is a segment on each side. `points` is the caller's to reuse. The
    /// dash is positive and finite and the gap finite and not negative, as the bridge checked.
    pub fn dashes(
        self,
        (width, height): (f64, f64),
        [dash, gap]: [f64; 2],
        clip: [f64; 4],
        points: &mut Vec<(f64, f64)>,
        out: &mut Vec<[f32; 4]>,
    ) {
        self.outline(width, height, points);
        let period = dash + gap;
        if points.is_empty() || !(dash > 0.0 && period.is_finite()) {
            return;
        }
        let edges = || (0..points.len()).map(|i| (points[i], points[(i + 1) % points.len()]));
        // The dashes the clipped outline takes, at most, before any is laid.
        let mut needed = 0.0;
        for (p, q) in edges() {
            if let Some((t0, t1)) = clipped(p, q, clip) {
                needed += (t1 - t0) * distance(p, q) / period + 2.0;
            }
        }
        let solid = needed > MAX_DASH_SEGMENTS as f64;
        let mut walked = 0.0;
        for (p, q) in edges() {
            let length = distance(p, q);
            let Some((t0, t1)) = clipped(p, q, clip).filter(|_| length > 0.0) else {
                walked += length;
                continue;
            };
            let point = |t: f64| (p.0 + (q.0 - p.0) * t, p.1 + (q.1 - p.1) * t);
            if solid {
                out.push(segment(point(t0), point(t1)));
                walked += length;
                continue;
            }
            let (from, to) = (walked + t0 * length, walked + t1 * length);
            let first = (from / period).floor();
            // Counted, so that a pattern whose period no longer moves a sum this far along still
            // ends.
            let count = ((to - first * period) / period).ceil().max(0.0) + 1.0;
            let mut k = 0.0;
            while k < count {
                let start = (first + k) * period;
                let (on, off) = (start.max(from), (start + dash).min(to));
                if off > on {
                    out.push(segment(
                        point((on - walked) / length),
                        point((off - walked) / length),
                    ));
                }
                k += 1.0;
            }
            walked += length;
        }
    }
}

/// `count`, a number of steps far below `u32::MAX`, as a `u32`.
fn numbered(count: usize) -> u32 {
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// The distance between `p` and `q`.
fn distance(p: (f64, f64), q: (f64, f64)) -> f64 {
    crate::geometry::length(q.0 - p.0, q.1 - p.1)
}

/// The segment from `p` to `q` as the `f32` the bridge hands over.
#[expect(
    clippy::cast_possible_truncation,
    reason = "a point of a node's outline relative to the node, within its size, which f32 holds"
)]
fn segment(p: (f64, f64), q: (f64, f64)) -> [f32; 4] {
    [p.0 as f32, p.1 as f32, q.0 as f32, q.1 as f32]
}

/// The part of the segment from `p` to `q` within `[min_x, min_y, max_x, max_y]`, as the range of
/// its parameter from 0 at `p` to 1 at `q`, by Liang and Barsky's clipping; none where no part
/// lies within it.
fn clipped(
    p: (f64, f64),
    q: (f64, f64),
    [min_x, min_y, max_x, max_y]: [f64; 4],
) -> Option<(f64, f64)> {
    let (dx, dy) = (q.0 - p.0, q.1 - p.1);
    let (mut t0, mut t1) = (0.0_f64, 1.0_f64);
    for (towards, room) in [
        (-dx, p.0 - min_x),
        (dx, max_x - p.0),
        (-dy, p.1 - min_y),
        (dy, max_y - p.1),
    ] {
        if towards == 0.0 {
            if room < 0.0 {
                return None;
            }
        } else {
            let t = room / towards;
            if towards < 0.0 {
                t0 = t0.max(t);
            } else {
                t1 = t1.min(t);
            }
        }
    }
    (t0 <= t1).then_some((t0, t1))
}

/// How many chords a curve turning by `angle` at a radius of at most `radius` is flattened into,
/// so that each lies within `OUTLINE_TOLERANCE` of it: at least one, at most `MAX_CURVE_STEPS`.
fn curve_steps(angle: f64, radius: f64) -> usize {
    if radius <= OUTLINE_TOLERANCE {
        return 1;
    }
    let step = 2.0 * (1.0 - OUTLINE_TOLERANCE / radius).acos();
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a count of chords held from 1 to MAX_CURVE_STEPS"
    )]
    let steps = (angle / step).ceil().clamp(1.0, MAX_CURVE_STEPS as f64) as usize;
    steps
}

/// Pushes onto `out` the outline of a box `width` × `height` whose corners are rounded by `r`,
/// clockwise from the start of its top side, each corner flattened (`curve_steps`).
fn rounded_outline(width: f64, height: f64, r: f64, out: &mut Vec<(f64, f64)>) {
    use core::f64::consts::{FRAC_PI_2, PI};
    let corners = [
        ((width - r, r), -FRAC_PI_2),
        ((width - r, height - r), 0.0),
        ((r, height - r), FRAC_PI_2),
        ((r, r), PI),
    ];
    let steps = curve_steps(FRAC_PI_2, r);
    for ((cx, cy), from) in corners {
        if r <= 0.0 {
            out.push((cx, cy));
            continue;
        }
        for i in 0..=steps {
            let angle = from + FRAC_PI_2 * f64::from(numbered(i)) / f64::from(numbered(steps));
            out.push((cx + r * angle.cos(), cy + r * angle.sin()));
        }
    }
}

/// Turns the closed polyline `points` to start at its point nearest the top left corner of its
/// node's box, the origin, ties at the first in its order, splitting the segment it lies on.
fn start_nearest_top_left(points: &mut Vec<(f64, f64)>) {
    let n = points.len();
    let mut best = (f64::INFINITY, 0, points[0]);
    for i in 0..n {
        let p = nearest_on_segment(points[i], points[(i + 1) % n], (0.0, 0.0));
        let d = crate::geometry::length(p.0, p.1);
        if d < best.0 {
            best = (d, i, p);
        }
    }
    let (_, i, p) = best;
    points.rotate_left((i + 1) % n);
    if points[0] != p && points[n - 1] != p {
        points.insert(0, p);
    } else if points[n - 1] == p {
        points.rotate_right(1);
    }
}

/// The point of the closed polygon of `corners` nearest `p`, ties at its first side.
fn nearest_on_polygon(corners: &[(f64, f64)], p: (f64, f64)) -> (f64, f64) {
    let mut best = (f64::INFINITY, corners[0]);
    for i in 0..corners.len() {
        let q = nearest_on_segment(corners[i], corners[(i + 1) % corners.len()], p);
        let d = crate::geometry::length(q.0 - p.0, q.1 - p.1);
        if d < best.0 {
            best = (d, q);
        }
    }
    best.1
}

/// How far from `centre` the unit direction `(ux, uy)` leaves the closed polygon of `corners`:
/// where it crosses the polygon's sides last, so that a notch it crosses first is passed by;
/// none where it crosses no side.
fn polygon_distance(
    corners: &[(f64, f64)],
    centre: (f64, f64),
    (ux, uy): (f64, f64),
) -> Option<f64> {
    let mut far: Option<f64> = None;
    for i in 0..corners.len() {
        let (p, q) = (corners[i], corners[(i + 1) % corners.len()]);
        let (ex, ey) = (q.0 - p.0, q.1 - p.1);
        let across = ux * ey - uy * ex;
        if across == 0.0 {
            continue;
        }
        let (wx, wy) = (p.0 - centre.0, p.1 - centre.1);
        let t = (wx * ey - wy * ex) / across;
        let s = (wx * uy - wy * ux) / across;
        if t > 0.0 && (-1e-12..=1.0 + 1e-12).contains(&s) {
            far = Some(far.map_or(t, |far| far.max(t)));
        }
    }
    far
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
    // Verifies: REN-node-shapes-cover-uml
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
        assert_eq!(NodeShape::of_code(15), None);
        assert_eq!(NodeShape::of_code(255), None);
        assert_eq!(NodeShape::default(), NodeShape::Rectangle);
    }

    #[test]
    fn a_rectangle_lays_out_and_is_as_high_as_a_node_before_node_shapes() {
        for (width, height) in SIZES {
            assert_eq!(NodeShape::Rectangle.grown(width, height), height);
            assert_eq!(
                NodeShape::Rectangle.inner(width, height, [0.0; 2]),
                Inner {
                    x: 0.0,
                    y: 0.0,
                    width,
                    height
                }
            );
            assert_eq!(NodeShape::RoundedRectangle.grown(width, height), height);
            assert_eq!(
                NodeShape::RoundedRectangle
                    .inner(width, height, [0.0; 2])
                    .width,
                width
            );
        }
    }

    #[test]
    fn a_content_node_shape_is_as_high_as_its_inner_rectangle_needs_for_its_content() {
        for shape in [NodeShape::Ellipse, NodeShape::Diamond] {
            for (width, content) in SIZES {
                let height = shape.grown(width, content);
                let inner = shape.inner(width, height, [0.0; 2]);
                assert!(
                    (inner.height - content).abs() < 1e-9,
                    "{shape:?} {width} {content}"
                );
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
                    NodeShape::Circle
                        | NodeShape::RingedCircle
                        | NodeShape::Bar
                        | NodeShape::CrossedCircle
                        | NodeShape::Cross
                )
            );
        }
        assert_eq!(NodeShape::Circle.height(30.0, Some(64.0), None), 30.0);
        assert_eq!(NodeShape::RingedCircle.height(30.0, Some(64.0), None), 30.0);
        assert_eq!(NodeShape::Bar.height(200.0, Some(64.0), None), BAR_HEIGHT);
        assert_eq!(NodeShape::Bar.inner(200.0, 8.0, [0.0; 2]).width, 0.0);
    }

    #[test]
    fn a_node_is_as_high_as_its_data_gives_never_less_than_its_content_and_without_content_as_wide()
    {
        // Verifies: REN-node-shapes-cover-uml, REN-node-content-and-hits
        let content = Some(64.0);
        for shape in [NodeShape::Rectangle, NodeShape::RoundedRectangle] {
            // A height below the content's is raised to it, a greater one kept.
            assert_eq!(shape.height(220.0, content, Some(20.0)), 64.0);
            assert_eq!(shape.height(220.0, content, Some(300.0)), 300.0);
            assert_eq!(shape.height(220.0, content, None), 64.0);
            // Without content, as its data gives however small, or as wide.
            assert_eq!(shape.height(220.0, None, Some(10.0)), 10.0);
            assert_eq!(shape.height(16.0, None, None), 16.0);
        }
        // An ellipse's content needs its inner rectangle, a height below that raised to it.
        let needed = NodeShape::Ellipse.height(220.0, Some(64.0), None);
        assert_eq!(
            NodeShape::Ellipse.height(220.0, content, Some(70.0)),
            needed
        );
        assert_eq!(
            NodeShape::Ellipse.height(220.0, content, Some(200.0)),
            200.0
        );
        // A circle as high as wide whatever its data gives; a bar 8 high or as its data gives.
        assert_eq!(NodeShape::Circle.height(30.0, None, Some(10.0)), 30.0);
        assert_eq!(NodeShape::RingedCircle.height(30.0, None, None), 30.0);
        assert_eq!(NodeShape::Bar.height(220.0, None, None), BAR_HEIGHT);
        assert_eq!(NodeShape::Bar.height(8.0, None, Some(120.0)), 120.0);
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
                // The corner of the box the outline of each of these runs through, or a note's
                // and a frame's, hit as their bounding rectangles.
                let boxed = matches!(
                    shape,
                    NodeShape::Rectangle
                        | NodeShape::Bar
                        | NodeShape::Pentagon
                        | NodeShape::NotchedRectangle
                        | NodeShape::Note
                        | NodeShape::Frame
                        | NodeShape::Cross
                        | NodeShape::Actor
                        | NodeShape::Hourglass
                );
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
                    // A note is hit as its bounding rectangle, beyond the outline at its fold.
                    let fold = shape == NodeShape::Note
                        && ox > width - fold(width, height)
                        && oy < fold(width, height);
                    assert!(
                        fold || !shape.contains(width, height, ox, oy),
                        "{shape:?} {width}x{height} ({dx}, {dy}) outside"
                    );
                    assert!(
                        off_outline(shape, width, height, x, y) <= scale,
                        "{shape:?} {width}x{height} ({dx}, {dy}) off the outline"
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
            for side in SIDES {
                assert_eq!(shape.inset(side, 0.0, 40.0, 0.0), 0.0, "{shape:?}");
                assert_eq!(shape.inset(side, 40.0, 0.0, 10.0), 0.0, "{shape:?}");
            }
        }
    }

    /// How far `(x, y)` lies off the outline of a node of `shape` and `width` × `height`, by the
    /// outline's own equation, written here apart from the code under test.
    pub(crate) fn off_outline(shape: NodeShape, width: f64, height: f64, x: f64, y: f64) -> f64 {
        let (a, b) = (width / 2.0, height / 2.0);
        let (dx, dy) = ((x - a).abs(), (y - b).abs());
        let off_box = (dx - a).abs().min((dy - b).abs()) + (dx - a).max(0.0) + (dy - b).max(0.0);
        match shape {
            NodeShape::Rectangle
            | NodeShape::Bar
            | NodeShape::Cross
            | NodeShape::Actor
            | NodeShape::Hourglass => off_box,
            NodeShape::RoundedRectangle => {
                let r = ROUNDED_RADIUS.min(a).min(b);
                let (ex, ey) = (dx - (a - r), dy - (b - r));
                if ex > 0.0 && ey > 0.0 {
                    (ex.hypot(ey) - r).abs()
                } else {
                    off_box
                }
            }
            NodeShape::Ellipse
            | NodeShape::Circle
            | NodeShape::RingedCircle
            | NodeShape::CrossedCircle => {
                // The radial distance, which is within the distance's order near the outline.
                let k = ((dx / a).powi(2) + (dy / b).powi(2)).sqrt();
                (k - 1.0).abs() * a.min(b)
            }
            NodeShape::Diamond => (dx / a + dy / b - 1.0).abs() * a * b / a.hypot(b),
            NodeShape::Frame => off_box,
            NodeShape::Pentagon | NodeShape::NotchedRectangle | NodeShape::Note => {
                let corners = corners_of(shape, width, height);
                (0..5)
                    .map(|i| {
                        let (p, q) = (corners[i], corners[(i + 1) % 5]);
                        let (ex, ey) = (q.0 - p.0, q.1 - p.1);
                        let t = (((x - p.0) * ex + (y - p.1) * ey) / (ex * ex + ey * ey))
                            .clamp(0.0, 1.0);
                        (x - p.0 - t * ex).hypot(y - p.1 - t * ey)
                    })
                    .fold(f64::INFINITY, f64::min)
            }
        }
    }

    /// The five corners of a pentagon, a notched rectangle, or a note, as REN-node-shapes-cover-uml
    /// draws them, written here apart from the code under test: the point and the notch half the
    /// height deep, at most a quarter of the width, and the fold 12, at most a quarter of the width
    /// and of the height.
    pub(crate) fn corners_of(shape: NodeShape, width: f64, height: f64) -> [(f64, f64); 5] {
        let (d, c, b) = (
            (height / 2.0).min(width / 4.0),
            12.0_f64.min(width / 4.0).min(height / 4.0),
            height / 2.0,
        );
        match shape {
            NodeShape::Pentagon => [
                (0.0, 0.0),
                (width - d, 0.0),
                (width, b),
                (width - d, height),
                (0.0, height),
            ],
            NodeShape::NotchedRectangle => [
                (0.0, 0.0),
                (width, 0.0),
                (width, height),
                (0.0, height),
                (d, b),
            ],
            NodeShape::Note => [
                (0.0, 0.0),
                (width - c, 0.0),
                (width, c),
                (width, height),
                (0.0, height),
            ],
            _ => unreachable!("{shape:?} has no five corners"),
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
            NodeShape::Ellipse
            | NodeShape::Circle
            | NodeShape::RingedCircle
            | NodeShape::CrossedCircle => (0..n)
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
            NodeShape::Pentagon | NodeShape::NotchedRectangle | NodeShape::Note => {
                let corners = corners_of(shape, width, height);
                let lengths: Vec<f64> = (0..5)
                    .map(|i| {
                        let (p, q) = (corners[i], corners[(i + 1) % 5]);
                        (q.0 - p.0).hypot(q.1 - p.1)
                    })
                    .collect();
                let perimeter: f64 = lengths.iter().sum();
                (0..n)
                    .map(|i| {
                        let mut at = i as f64 * perimeter / n as f64;
                        let mut k = 0;
                        while k < 4 && at > lengths[k] {
                            at -= lengths[k];
                            k += 1;
                        }
                        let (p, q) = (corners[k], corners[(k + 1) % 5]);
                        let f = if lengths[k] > 0.0 {
                            at / lengths[k]
                        } else {
                            0.0
                        };
                        (p.0 + (q.0 - p.0) * f, p.1 + (q.1 - p.1) * f)
                    })
                    .collect()
            }
            NodeShape::Rectangle
            | NodeShape::Bar
            | NodeShape::RoundedRectangle
            | NodeShape::Frame
            | NodeShape::Cross
            | NodeShape::Actor
            | NodeShape::Hourglass => {
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
                    let (side, offset) = shape.side_of(width, height, x, y);
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
    fn a_pentagon_a_notched_rectangle_a_note_and_a_frame_lay_their_content_out_in_their_inner_rectangle()
     {
        // Verifies: REN-node-shapes-cover-uml
        let inner = |x: f64, y: f64, width: f64, height: f64| Inner {
            x,
            y,
            width,
            height,
        };
        let tab = [120.0, 38.0];
        // Left of the point and right of the notch, each half the height deep; a note whole.
        assert_eq!(
            NodeShape::Pentagon.inner(220.0, 64.0, tab),
            inner(0.0, 0.0, 188.0, 64.0)
        );
        assert_eq!(
            NodeShape::NotchedRectangle.inner(220.0, 64.0, tab),
            inner(32.0, 0.0, 188.0, 64.0)
        );
        assert_eq!(
            NodeShape::Note.inner(220.0, 64.0, tab),
            inner(0.0, 0.0, 220.0, 64.0)
        );
        // A frame's tab at its top left, as wide as its content and its padding, at most the
        // frame's width, and as high as its content.
        assert_eq!(
            NodeShape::Frame.inner(300.0, 200.0, tab),
            inner(0.0, 0.0, 120.0, 38.0)
        );
        assert_eq!(
            NodeShape::Frame.inner(100.0, 200.0, tab),
            inner(0.0, 0.0, 100.0, 38.0)
        );
        // A point or a notch half the height of a tall node is cut at a quarter of its width.
        assert_eq!(
            NodeShape::Pentagon.inner(40.0, 300.0, tab),
            inner(0.0, 0.0, 30.0, 300.0)
        );
        assert_eq!(
            NodeShape::NotchedRectangle.inner(40.0, 300.0, tab),
            inner(10.0, 0.0, 30.0, 300.0)
        );
        // Each as high as its content, a height its data gives below that raised to it.
        for shape in [
            NodeShape::Pentagon,
            NodeShape::NotchedRectangle,
            NodeShape::Note,
            NodeShape::Frame,
        ] {
            assert_eq!(shape.height(220.0, Some(64.0), None), 64.0, "{shape:?}");
            assert_eq!(
                shape.height(220.0, Some(64.0), Some(20.0)),
                64.0,
                "{shape:?}"
            );
            assert_eq!(
                shape.height(220.0, Some(64.0), Some(300.0)),
                300.0,
                "{shape:?}"
            );
            assert_eq!(shape.height(220.0, None, Some(10.0)), 10.0, "{shape:?}");
        }
    }

    #[test]
    fn a_press_beyond_a_pentagon_s_point_or_in_a_notch_hits_nothing_and_a_note_or_a_frame_is_hit_as_its_rectangle()
     {
        // Verifies: REN-node-shapes-cover-uml
        let (w, h) = (220.0, 64.0);
        // Beyond the point, inside the bounding rectangle: what lies below is hit.
        assert!(!NodeShape::Pentagon.contains(w, h, 215.0, 5.0));
        assert!(!NodeShape::Pentagon.contains(w, h, 215.0, 59.0));
        assert!(NodeShape::Pentagon.contains(w, h, 215.0, 32.0));
        assert!(NodeShape::Pentagon.contains(w, h, 188.0, 1.0));
        // Just inside and just outside the point's upper edge at x = 204, where it lies at 16.
        assert!(NodeShape::Pentagon.contains(w, h, 204.0, 16.01));
        assert!(!NodeShape::Pentagon.contains(w, h, 204.0, 15.99));
        // In the notch, and beside it.
        assert!(!NodeShape::NotchedRectangle.contains(w, h, 5.0, 32.0));
        assert!(!NodeShape::NotchedRectangle.contains(w, h, 31.0, 32.0));
        assert!(NodeShape::NotchedRectangle.contains(w, h, 33.0, 32.0));
        assert!(NodeShape::NotchedRectangle.contains(w, h, 5.0, 2.0));
        // A note at its fold and a frame anywhere in its rectangle.
        assert!(NodeShape::Note.contains(w, h, 219.0, 1.0));
        assert!(NodeShape::Frame.contains(w, h, 219.0, 63.0));
        assert!(!NodeShape::Frame.contains(w, h, 220.5, 63.0));
    }

    /// How far `(x, y)` lies off the outline of a node of `shape` and `width` × `height` as the
    /// shell draws it, a rectangle's corners rounded by 6: `off_outline`, but for a rectangle.
    fn off_drawn(shape: NodeShape, width: f64, height: f64, x: f64, y: f64) -> f64 {
        if shape != NodeShape::Rectangle {
            return off_outline(shape, width, height, x, y);
        }
        let (a, b) = (width / 2.0, height / 2.0);
        let (dx, dy) = ((x - a).abs(), (y - b).abs());
        let r = 6.0_f64.min(a).min(b);
        let (ex, ey) = (dx - (a - r), dy - (b - r));
        if ex > 0.0 && ey > 0.0 {
            (ex.hypot(ey) - r).abs()
        } else {
            off_outline(shape, width, height, x, y)
        }
    }

    /// A dash: its start, its end, and its length along its segments.
    type Dash = ((f64, f64), (f64, f64), f64);

    /// The dashes of `segments`, each run of segments that meet end to end, as its start, its
    /// end, and its length along them.
    fn dashes_of(segments: &[[f32; 4]]) -> Vec<Dash> {
        let mut dashes: Vec<Dash> = Vec::new();
        for s in segments {
            let [x0, y0, x1, y1] = s.map(f64::from);
            let length = (x1 - x0).hypot(y1 - y0);
            match dashes.last_mut() {
                Some(last) if (last.1.0 - x0).hypot(last.1.1 - y0) < 1e-3 => {
                    last.1 = (x1, y1);
                    last.2 += length;
                }
                _ => dashes.push(((x0, y0), (x1, y1), length)),
            }
        }
        dashes
    }

    const EVERYWHERE: [f64; 4] = [-1e9, -1e9, 1e9, 1e9];

    /// The length of the outline of a node of `shape` and `width` × `height` as it is drawn, by
    /// the formula of a box of rounded corners or by a fine scan of it.
    fn drawn_perimeter(shape: NodeShape, width: f64, height: f64) -> f64 {
        let radius = match shape {
            NodeShape::Rectangle => Some(6.0),
            NodeShape::RoundedRectangle => Some(ROUNDED_RADIUS),
            NodeShape::Frame => Some(0.0),
            _ => None,
        };
        if let Some(r) = radius {
            let r = r.min(width / 2.0).min(height / 2.0);
            return 2.0 * (width + height) - 8.0 * r + core::f64::consts::TAU * r;
        }
        let points = outline_points(shape, width, height, 20_000);
        let n = points.len();
        (0..n)
            .map(|i| {
                let (p, q) = (points[i], points[(i + 1) % n]);
                (q.0 - p.0).hypot(q.1 - p.1)
            })
            .sum()
    }

    /// The distance from the top left corner of a node of `shape` and `width` × `height` to its
    /// outline as it is drawn, a rectangle's corner an arc of 6 about (6, 6).
    fn drawn_nearest(shape: NodeShape, width: f64, height: f64) -> f64 {
        if shape == NodeShape::Rectangle {
            return 6.0 * core::f64::consts::SQRT_2 - 6.0;
        }
        outline_points(shape, width, height, 20_000)
            .into_iter()
            .map(|(x, y)| x.hypot(y))
            .fold(f64::INFINITY, f64::min)
    }

    /// Asserts that `out`, the dash segments of a node of `shape` and `width` × `height` dashed 6
    /// and 4, lie on its outline as it is drawn and follow the pattern clockwise from the point of
    /// the outline nearest the node's top left corner.
    fn assert_dashed(shape: NodeShape, width: f64, height: f64, out: &[[f32; 4]]) {
        let context = format!("{shape:?} {width}x{height}");
        // Every end and every middle of a segment on the outline as it is drawn.
        for s in out {
            let [x0, y0, x1, y1] = s.map(f64::from);
            for (x, y) in [(x0, y0), (x1, y1), ((x0 + x1) / 2.0, (y0 + y1) / 2.0)] {
                let off = off_drawn(shape, width, height, x, y);
                assert!(
                    off <= OUTLINE_TOLERANCE + 1e-3,
                    "{context} ({x}, {y}) off by {off}"
                );
            }
        }
        // Dashes of 6 and gaps of 4 along it, but the last, which the start cuts.
        let dashes = dashes_of(out);
        assert!(dashes.len() > 1, "{context}");
        for pair in dashes.windows(2) {
            let (dash, next) = (pair[0], pair[1]);
            assert!(
                (dash.2 - 6.0).abs() < 1e-2,
                "{context}: a dash of {}",
                dash.2
            );
            // A gap measured as its chord, shorter where it turns a corner.
            let gap = (next.0.0 - dash.1.0).hypot(next.0.1 - dash.1.1);
            assert!(gap <= 4.0 + 1e-2 && gap > 0.0, "{context}: a gap of {gap}");
        }
        assert!(dashes.last().unwrap().2 <= 6.0 + 1e-2, "{context}");
        // One dash for every 10 of the outline's length, so that the gaps are 4 along it.
        let perimeter = drawn_perimeter(shape, width, height);
        let count = dashes.len() as f64;
        assert!(
            count * 10.0 >= perimeter - 0.05 && (count - 1.0) * 10.0 < perimeter + 0.05,
            "{context}: {count} dashes along {perimeter}"
        );
        // From the point of the outline nearest the top left corner, clockwise: the first dash
        // runs to the right or upwards from there, as the outline turns there.
        let start = dashes[0].0;
        let nearest = drawn_nearest(shape, width, height);
        assert!(
            (start.0.hypot(start.1) - nearest).abs() <= OUTLINE_TOLERANCE + 0.05,
            "{context}: starts at {start:?}"
        );
        let (sx, sy) = (dashes[0].1.0 - start.0, dashes[0].1.1 - start.1);
        assert!(sx - sy > 0.0, "{context}: runs {sx}, {sy}");
    }

    #[test]
    fn the_dashes_of_an_outline_lie_on_it_and_follow_its_pattern_clockwise_from_the_top_left() {
        // Verifies: REN-node-shapes-cover-uml, Q-4
        let mut points = Vec::new();
        let mut checked = 0;
        for shape in NodeShape::ALL {
            for (width, height) in SIZES {
                let mut out = Vec::new();
                let size = (width, height);
                shape.dashes(size, [6.0, 4.0], EVERYWHERE, &mut points, &mut out);
                let captioned = matches!(shape, NodeShape::Actor | NodeShape::Hourglass);
                if shape.holds_content() && !captioned {
                    assert_dashed(shape, width, height, &out);
                    checked += 1;
                } else {
                    // A filled node shape keeps its fill and lays no dashes, nor does a captioned
                    // one, whose drawing is no outline and whose content has no border.
                    assert!(out.is_empty(), "{shape:?}");
                }
            }
        }
        assert_eq!(checked, 8 * SIZES.len());
    }

    #[test]
    fn a_rounded_rectangle_dashed_six_and_four_starts_at_its_top_left_arc() {
        // Verifies: REN-node-shapes-cover-uml
        let mut points = Vec::new();
        let mut out = Vec::new();
        NodeShape::RoundedRectangle.dashes(
            (220.0, 64.0),
            [6.0, 4.0],
            EVERYWHERE,
            &mut points,
            &mut out,
        );
        let dashes = dashes_of(&out);
        // The arc's middle, 10 (1 - 1/√2) in from both sides.
        let corner = 10.0 * (1.0 - core::f64::consts::FRAC_1_SQRT_2);
        assert!((dashes[0].0.0 - corner).abs() < 0.05 && (dashes[0].0.1 - corner).abs() < 0.05);
        // Six tenths of its perimeter dashed, within a dash.
        let perimeter = 2.0 * (220.0 + 64.0) - 8.0 * 10.0 + core::f64::consts::TAU * 10.0;
        let dashed: f64 = dashes.iter().map(|d| d.2).sum();
        assert!(
            (dashed - perimeter * 0.6).abs() <= 6.0,
            "{dashed} of {perimeter}"
        );
        assert_eq!(dashes.len(), (perimeter / 10.0).ceil() as usize);
    }

    #[test]
    fn dashes_are_laid_only_within_the_clip_and_a_pattern_too_fine_is_laid_solid() {
        // Verifies: REN-node-shapes-cover-uml
        let mut points = Vec::new();
        let (width, height) = (4000.0, 900.0);
        let mut whole = Vec::new();
        let shape = NodeShape::Frame;
        shape.dashes(
            (width, height),
            [6.0, 4.0],
            EVERYWHERE,
            &mut points,
            &mut whole,
        );
        // Clipped to the node's left half: each segment within it, and the ones there alike.
        let clip = [-10.0, -10.0, 2000.0, 910.0];
        let mut half = Vec::new();
        shape.dashes((width, height), [6.0, 4.0], clip, &mut points, &mut half);
        assert!(!half.is_empty() && half.len() < whole.len());
        for s in &half {
            assert!(s[0] <= 2000.0 && s[2] <= 2000.0, "{s:?}");
        }
        let inside: Vec<_> = whole
            .iter()
            .filter(|s| s[0] < 1999.0 && s[2] < 1999.0)
            .collect();
        for s in inside {
            assert!(half.contains(s), "{s:?}");
        }
        // A clip that holds none of the outline lays none: inside the frame, apart from it.
        let mut none = Vec::new();
        shape.dashes(
            (width, height),
            [6.0, 4.0],
            [100.0, 100.0, 200.0, 200.0],
            &mut points,
            &mut none,
        );
        assert!(none.is_empty());
        // A pattern of a thousandth: laid solid, one segment per side, the whole outline.
        let mut fine = Vec::new();
        shape.dashes(
            (width, height),
            [1e-3, 1e-3],
            EVERYWHERE,
            &mut points,
            &mut fine,
        );
        assert_eq!(fine.len(), 4);
        let laid: f64 = dashes_of(&fine).iter().map(|d| d.2).sum();
        assert!((laid - 2.0 * (width + height)).abs() < 1e-3, "{laid}");
        // Within the budget even on an ellipse 10^6 wide, whose curve is cut at its steps.
        let mut large = Vec::new();
        NodeShape::Ellipse.dashes(
            (1e6, 4e5),
            [6.0, 4.0],
            [-10.0, -10.0, 4000.0, 4e5],
            &mut points,
            &mut large,
        );
        assert!(!large.is_empty() && large.len() <= MAX_DASH_SEGMENTS + 2 * MAX_CURVE_STEPS);
    }

    #[test]
    fn a_crossed_circle_and_a_cross_hold_no_content_and_are_as_high_as_wide_however_small() {
        // Verifies: REN-node-shapes-cover-uml
        for shape in [NodeShape::CrossedCircle, NodeShape::Cross] {
            assert!(!shape.holds_content(), "{shape:?}");
            // 12 wide without a height: 12 by 12; a height its data gives does not count.
            assert_eq!(shape.height(12.0, None, None), 12.0, "{shape:?}");
            assert_eq!(shape.height(12.0, None, Some(40.0)), 12.0, "{shape:?}");
            assert_eq!(shape.height(30.0, None, Some(4.0)), 30.0, "{shape:?}");
            assert_eq!(shape.height(30.0, Some(64.0), None), 30.0, "{shape:?}");
            assert_eq!(shape.inner(30.0, 30.0, [0.0; 2]).width, 0.0, "{shape:?}");
            assert_eq!(shape.drawing(30.0), None, "{shape:?}");
        }
        // A crossed circle is hit as its circle, a cross as its box: at a corner of the box, only
        // the cross; beside the circle on its diagonal, just outside, nothing.
        assert!(!NodeShape::CrossedCircle.contains(12.0, 12.0, 0.5, 0.5));
        assert!(NodeShape::Cross.contains(12.0, 12.0, 0.5, 0.5));
        let on = 6.0 - 6.0 * core::f64::consts::FRAC_1_SQRT_2;
        assert!(NodeShape::CrossedCircle.contains(12.0, 12.0, on + 0.01, on + 0.01));
        assert!(!NodeShape::CrossedCircle.contains(12.0, 12.0, on - 0.01, on - 0.01));
    }

    #[test]
    fn an_actor_s_and_an_hourglass_s_drawing_is_of_its_proportion_at_the_top_at_most_48_high() {
        // Verifies: REN-node-shapes-cover-uml
        let boxed = |x: f64, y: f64, width: f64, height: f64| Inner {
            x,
            y,
            width,
            height,
        };
        // The drawing at the top, 2 or 1.5 times as high as wide, as wide as the node until it
        // is 48 high, then centred and 48 high.
        assert_eq!(
            NodeShape::Actor.drawing(12.0),
            Some(boxed(0.0, 0.0, 12.0, 24.0))
        );
        assert_eq!(
            NodeShape::Actor.drawing(100.0),
            Some(boxed(38.0, 0.0, 24.0, 48.0))
        );
        assert_eq!(
            NodeShape::Hourglass.drawing(12.0),
            Some(boxed(0.0, 0.0, 12.0, 18.0))
        );
        assert_eq!(
            NodeShape::Hourglass.drawing(100.0),
            Some(boxed(34.0, 0.0, 32.0, 48.0))
        );
        assert_eq!(NodeShape::Rectangle.drawing(100.0), None);
    }

    #[test]
    fn an_actor_and_an_hourglass_lay_their_content_out_below_their_drawing_as_high_as_both() {
        // Verifies: REN-node-shapes-cover-uml, REN-node-content-and-hits
        let boxed = |x: f64, y: f64, width: f64, height: f64| Inner {
            x,
            y,
            width,
            height,
        };
        for shape in [NodeShape::Actor, NodeShape::Hourglass] {
            assert!(shape.holds_content(), "{shape:?}");
            // The content below the drawing, to the node's width.
            assert_eq!(
                shape.inner(100.0, 86.0, [0.0; 2]),
                boxed(0.0, 48.0, 100.0, 38.0),
                "{shape:?}"
            );
            // As high as its drawing and its content, a height below that raised to it.
            assert_eq!(shape.height(100.0, Some(38.0), None), 86.0, "{shape:?}");
            assert_eq!(
                shape.height(100.0, Some(38.0), Some(20.0)),
                86.0,
                "{shape:?}"
            );
            assert_eq!(
                shape.height(100.0, Some(38.0), Some(200.0)),
                200.0,
                "{shape:?}"
            );
            // Without content as high as its drawing, a height below it raised to it.
            assert_eq!(shape.height(100.0, None, None), 48.0, "{shape:?}");
            assert_eq!(shape.height(100.0, None, Some(20.0)), 48.0, "{shape:?}");
            assert_eq!(shape.height(100.0, None, Some(90.0)), 90.0, "{shape:?}");
        }
        assert_eq!(NodeShape::Actor.height(12.0, None, Some(10.0)), 24.0);
        assert_eq!(NodeShape::Hourglass.height(12.0, None, None), 18.0);
        // Hit as its bounding rectangle, beside the drawing too.
        assert!(NodeShape::Actor.contains(100.0, 86.0, 1.0, 1.0));
        assert!(!NodeShape::Actor.contains(100.0, 86.0, -0.5, 1.0));
    }

    #[test]
    fn a_node_with_content_is_at_least_the_least_height_whole_an_actor_s_drawing_counted_in() {
        // Verifies: REN-node-shapes-cover-uml, REN-node-content-and-hits
        // Content of one title, 10 + 18 + 10 = 38 with its padding, as a rectangle lays it out
        // before the least height of 64. REN-node-shapes-cover-uml (*Height*): a captioned node
        // shape with content is at least the least height as a whole, its drawing counted in.
        let one_title = Some(38.0);
        assert_eq!(NodeShape::Actor.height(100.0, one_title, None), 86.0);
        assert_eq!(NodeShape::Hourglass.height(100.0, one_title, None), 86.0);
        assert_eq!(NodeShape::Actor.height(100.0, one_title, Some(20.0)), 86.0);
        // A small actor's drawing and its title below 64 together are raised to it.
        assert_eq!(NodeShape::Actor.height(12.0, one_title, None), 64.0);
        // Every other node shape raises its content to 64 first, as before.
        assert_eq!(NodeShape::Rectangle.height(220.0, one_title, None), 64.0);
        assert_eq!(NodeShape::Frame.height(220.0, one_title, None), 64.0);
        assert_eq!(
            NodeShape::Ellipse.height(220.0, one_title, None),
            64.0 / core::f64::consts::FRAC_1_SQRT_2
        );
        assert_eq!(NodeShape::Diamond.height(220.0, one_title, None), 128.0);
        // More content grows with its rows.
        assert_eq!(NodeShape::Actor.height(100.0, Some(74.0), None), 122.0);
        assert_eq!(NodeShape::Rectangle.height(220.0, Some(74.0), None), 74.0);
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

    /// The functions this source declares outside its tests, each with its visibility (`pub`,
    /// `pub(crate)`, or empty for a private one) and its name, a method of `NodeShape` named
    /// `NodeShape::name`: those at the top level, and those of a block `impl NodeShape`.
    fn declared() -> Vec<(&'static str, String)> {
        let source = include_str!("shape.rs");
        let code = source.split("\n#[cfg(test)]\n").next().unwrap();
        let mut in_node_shape = false;
        let mut found = Vec::new();
        for line in code.lines() {
            if line.starts_with("impl ") {
                in_node_shape = line == "impl NodeShape {";
                continue;
            }
            if line == "}" {
                in_node_shape = false;
                continue;
            }
            let (method, rest) = match line.strip_prefix("    ") {
                Some(rest) if in_node_shape && !rest.starts_with(' ') => (true, rest),
                _ if line.starts_with(' ') => continue,
                _ => (false, line),
            };
            if rest.starts_with("//") || !rest.split_whitespace().any(|word| word == "fn") {
                continue;
            }
            // A declaration whose visibility or qualifiers it does not know fails, naming the
            // line, rather than drop out of the count.
            let (visibility, rest) = ["pub(crate) ", "pub "]
                .into_iter()
                .find_map(|v| rest.strip_prefix(v).map(|rest| (v.trim_end(), rest)))
                .unwrap_or(("", rest));
            let rest = rest.strip_prefix("const ").unwrap_or(rest);
            let Some(rest) = rest.strip_prefix("fn ") else {
                panic!("shape.rs declares a function in a form this test does not read: {line:?}");
            };
            let name = rest.split(['(', '<']).next().unwrap();
            let name = if method {
                format!("NodeShape::{name}")
            } else {
                name.to_owned()
            };
            found.push((visibility, name));
        }
        found
    }

    #[test]
    fn the_public_functions_of_shape_are_those_the_bridge_calls() {
        // Decides no ADR clause and no criterion: it guards the rule of docs/ARCHITECTURE.md,
        // *Engine*, that only what the bridge uses is public, which no ADR decides. The bridge
        // crate calls these four; a change that makes it call another adds it here.
        let bridge = [
            "NodeShape::of_code",
            "NodeShape::holds_content",
            "NodeShape::inner",
            "NodeShape::dashes",
        ];
        let public: Vec<String> = declared()
            .into_iter()
            .filter(|(visibility, _)| *visibility == "pub")
            .map(|(_, name)| name)
            .collect();
        assert!(!public.is_empty());
        let extra: Vec<&String> = public
            .iter()
            .filter(|name| !bridge.contains(&name.as_str()))
            .collect();
        let missing: Vec<&&str> = bridge
            .iter()
            .filter(|name| !public.iter().any(|p| p == *name))
            .collect();
        assert!(
            extra.is_empty() && missing.is_empty(),
            "public but not called by the bridge: {extra:?}; called by the bridge but not public: {missing:?}"
        );
    }

    #[test]
    fn a_node_shape_has_one_function_of_a_node_s_height() {
        // Verifies: REN-node-shapes-cover-uml
        // The functions of `NodeShape` that give a height, of any visibility, read from this
        // source: those named for a height and those of the least height a node needs or is sized
        // to. `height` alone is one; `needed` and `drawing_height` are steps of it, the least
        // height of a node's content and the height of a captioned node shape's drawing, and stay
        // private, so that either made visible counts again.
        let steps = ["NodeShape::needed", "NodeShape::drawing_height"];
        let methods: Vec<(&str, String)> = declared()
            .into_iter()
            .filter(|(_, name)| name.starts_with("NodeShape::"))
            .collect();
        assert!(!methods.is_empty());
        let heights: Vec<&str> = methods
            .iter()
            .filter(|(visibility, name)| !(visibility.is_empty() && steps.contains(&name.as_str())))
            .map(|(_, name)| name.trim_start_matches("NodeShape::"))
            .filter(|name| name.contains("height") || ["needed", "sized"].contains(name))
            .collect();
        assert_eq!(heights, ["height"]);
    }
}
