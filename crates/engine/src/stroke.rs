//! The edge mesh (ADR-0027): edge paths flattened into polylines within a tolerance, and stroked
//! into triangles with each edge's colour, dash pattern, and arrowhead (G-11).
//!
//! A path is flattened by subdividing it until its control points lie within the tolerance of
//! the chord, so the polyline stays within the tolerance of the curve (Q-4). The stroke has two
//! vertices per polyline point, offset along the averaged normal, and carries the distance along
//! the path, which a shader compares with the dash pattern. An arrowhead is a triangle whose tip
//! is the path's end; the stroke stops at its base.
//!
//! The stroke of each level of detail is decided here: every level flattens within the same
//! tolerance in screen pixels; the far level draws plain lines a width in screen pixels wide, the
//! near and middle levels draw in full, a width in world units wide.
//!
//! A query's mesh has a budget. A part of a path whose control points miss the query's rectangle,
//! grown by the stroke's width, is drawn as its chord, unflattened. A segment of the flattened
//! path that meets the grown rectangle with an end outside it is split where it enters and leaves
//! it, so that what the rectangle shows rounds by its distance from the query's origin, not by
//! that of ends far beyond it (ADR-0010). Each edge's floor, its chord,
//! or its arrowhead alone where that is its full mesh, is reserved before the first edge is meshed;
//! in slot order, an edge is meshed in full while it fits beside the floors of the edges still to
//! come, and from the first that does not, it and every later edge are drawn as their floors, and
//! the mesh is coarsened. The vectors grow by
//! `try_reserve`, never beyond the budget, so that a failed allocation coarsens the mesh instead of
//! trapping.

use std::collections::TryReserveError;

use crate::geometry::{EdgePath, Point, Rect};
use crate::graph::Level;

/// The most vertices the edge mesh of one query holds (ADR-0027): the floors of a load at its
/// limit of 1,000,000 edges, four vertices each, taken to the next power of two. A mesh holds at
/// most three times as many indices.
pub const MESH_BUDGET: u32 = 1 << 22;

/// The detail of a query's edge mesh (ADR-0027): complete, or coarsened where an edge was drawn
/// as its chord, or left out, for the budget or for memory.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Detail {
    #[default]
    Complete,
    Coarsened,
}

/// How an edge is drawn: its colour as `0xRRGGBB`, its dash pattern as dash and gap lengths in
/// world units, or none for a solid line, and whether an arrowhead marks its end, as it does
/// unless the host application says otherwise.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EdgeStyle {
    pub color: u32,
    pub dash: Option<(f32, f32)>,
    pub arrow: bool,
}

#[cfg(test)]
impl EdgeStyle {
    /// The style the engine's tests draw an edge in where the host application gives it none:
    /// solid, with an arrowhead, in the shell's default colour. The crate itself holds no default
    /// style, since the bridge builds every style from the graph data.
    pub(crate) const fn unstyled() -> Self {
        Self {
            color: 0x9a_a1ad,
            dash: None,
            arrow: true,
        }
    }
}

/// How far a drawn edge may stray from its path, in screen pixels: half the 0.5 px of Q-4.
const FLATNESS: f64 = 0.25;
/// The width of an edge at the far level of detail, in screen pixels.
const FAR_WIDTH: f64 = 1.0;
/// The width of an edge at full detail, the near and middle levels, in world units.
const FULL_WIDTH: f64 = 2.0;

/// How a query strokes its edges: flattened within `tolerance` and `width` wide, in world units;
/// `plain` draws thin lines alone, without dash patterns or arrowheads, as the far level of
/// detail does (ADR-0027).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Stroke {
    pub(crate) tolerance: f64,
    pub(crate) width: f64,
    pub(crate) plain: bool,
}

impl Stroke {
    /// How edges are stroked at `level`, where a screen pixel is `pixel` world units: within the
    /// flatness at every level, at the far level the far width and plain, at the others in full.
    pub(crate) fn at(level: Level, pixel: f64) -> Self {
        match level {
            Level::Far => Self {
                tolerance: FLATNESS * pixel,
                width: FAR_WIDTH * pixel,
                plain: true,
            },
            Level::Near | Level::Middle => Self::full(FLATNESS * pixel),
        }
    }

    /// Full detail: the full width, dash patterns, and arrowheads, within `tolerance`.
    pub(crate) const fn full(tolerance: f64) -> Self {
        Self {
            tolerance,
            width: FULL_WIDTH,
            plain: false,
        }
    }
}

/// The length and half the base of an arrowhead, in world units.
const ARROW_LENGTH: f64 = 10.0;
const ARROW_HALF_WIDTH: f64 = 5.0;
/// How deep a path is subdivided at most: 2^24 segments, so that an edge from (0, 0) to
/// (-1e8, 3e7) keeps its quarter pixel inside the rectangle; the rectangle and the mesh budget,
/// not the depth, bound what an edge costs.
const MAX_DEPTH: u32 = 24;
/// How many points the flattening of an edge may take before its floor is taken to be its chord:
/// an edge whose flattened points all lie within its arrowhead draws the arrowhead alone, and
/// finding that out costs no more than this.
const ARROWHEAD_POINTS: usize = 64;

/// What a part of the mesh takes: vertices, and vertex indices.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Size {
    vertices: usize,
    indices: usize,
}

impl Size {
    /// An arrowhead: one triangle.
    const ARROWHEAD: Self = Self {
        vertices: 3,
        indices: 3,
    };

    /// A polyline of `points`: two vertices per point and two triangles per segment; a single
    /// point draws nothing.
    const fn polyline(points: usize) -> Self {
        if points < 2 {
            return Self {
                vertices: 0,
                indices: 0,
            };
        }
        Self {
            vertices: 2 * points,
            indices: 6 * (points - 1),
        }
    }

    const fn minus(self, other: Self) -> Self {
        Self {
            vertices: self.vertices - other.vertices,
            indices: self.indices - other.indices,
        }
    }

    /// Both together, or as much as `usize` holds.
    const fn plus(self, other: Self) -> Self {
        Self {
            vertices: self.vertices.saturating_add(other.vertices),
            indices: self.indices.saturating_add(other.indices),
        }
    }
}

/// What an edge drawn as its chord takes: a polyline of two points, without an arrowhead.
const CHORD: Size = Size::polyline(2);

/// The floor of an edge: its chord, or its arrowhead alone where that is its full mesh.
const fn floor_of(arrowhead: bool) -> Size {
    if arrowhead { Size::ARROWHEAD } else { CHORD }
}

/// Grows `values` to hold `additional` more, by doubling where that stays within `most`, through
/// `try_reserve_exact`, so that a failed allocation is returned, never a trap.
fn grow<T>(values: &mut Vec<T>, additional: usize, most: usize) -> Result<(), TryReserveError> {
    let needed = values.len() + additional;
    if needed <= values.capacity() {
        return Ok(());
    }
    let doubled = values.capacity().saturating_mul(2).min(most);
    values.try_reserve_exact(needed.max(doubled) - values.len())
}

/// What one query strokes its edges with: the stroke, the query's rectangle grown by the stroke's
/// width, outside which a path is drawn as chords, and the budget of vertices.
struct Within<'a> {
    stroke: &'a Stroke,
    area: Rect,
    budget: usize,
}

/// The triangles of the edges a query found, as buffers a shader reads: per vertex its position
/// `x, y`, its distance along its path, its colour as RGBA bytes, and its dash pattern `dash,
/// gap` (0, 0 for solid); and three vertex indices per triangle. `detail` says whether every edge
/// was meshed in full.
#[derive(Debug, Default)]
pub struct Mesh {
    pub positions: Vec<f32>,
    pub distances: Vec<f32>,
    pub colors: Vec<u32>,
    pub dashes: Vec<f32>,
    pub indices: Vec<u32>,
    pub detail: Detail,
    /// Per edge of the last build, whether its full mesh is its arrowhead alone.
    arrowheads: Vec<bool>,
    /// The world point the positions of the last build are relative to (ADR-0010).
    origin: Point,
}

impl Mesh {
    pub(crate) fn clear(&mut self) {
        self.positions.clear();
        self.distances.clear();
        self.colors.clear();
        self.dashes.clear();
        self.indices.clear();
        self.detail = Detail::Complete;
    }

    /// Strokes `edges`, in slot order, into the mesh after clearing it, as `stroke` says, inside
    /// `rect` within a quarter pixel and outside it as chords, with positions relative to
    /// `origin`, and within `budget` vertices: the
    /// floors of all edges are reserved first, and from the first edge whose full mesh does not
    /// fit beside the floors of the edges after it, or for which memory runs short, every edge is
    /// drawn as its floor. Where even the floors do not fit, the mesh holds no edge.
    pub(crate) fn build<'a>(
        &mut self,
        edges: impl ExactSizeIterator<Item = (&'a EdgePath, &'a EdgeStyle)> + Clone,
        stroke: &Stroke,
        rect: &Rect,
        origin: Point,
        budget: u32,
        scratch: &mut Vec<Point>,
    ) {
        self.clear();
        self.origin = origin;
        let within = Within {
            stroke,
            area: rect.grown(stroke.width),
            budget: budget as usize,
        };
        let Some(mut later) = self.floors(edges.clone(), &within, scratch) else {
            self.detail = Detail::Coarsened;
            return;
        };
        for (i, (path, style)) in edges.enumerate() {
            let arrowhead = self.arrowheads[i];
            later = later.minus(floor_of(arrowhead));
            if arrowhead {
                let (tip, base, back) = arrow_of(path);
                self.arrowhead(tip, base, back, rgba(style.color));
                continue;
            }
            if self.detail == Detail::Complete {
                if self.add_within(path, style, &within, later, scratch) {
                    continue;
                }
                self.detail = Detail::Coarsened;
            }
            self.chord(path, style, stroke);
        }
    }

    /// Finds the floor of each of `edges` and reserves them all; returns what they take, or none
    /// where that is more than the budget or cannot be allocated.
    fn floors<'a>(
        &mut self,
        edges: impl ExactSizeIterator<Item = (&'a EdgePath, &'a EdgeStyle)>,
        within: &Within,
        scratch: &mut Vec<Point>,
    ) -> Option<Size> {
        self.arrowheads.clear();
        self.arrowheads.try_reserve_exact(edges.len()).ok()?;
        let mut floors = Size::polyline(0);
        for (path, style) in edges {
            let arrowhead = arrowhead_alone(path, style, within, scratch);
            self.arrowheads.push(arrowhead);
            floors = floors.plus(floor_of(arrowhead));
        }
        if floors.vertices > within.budget {
            return None;
        }
        self.reserve(floors, within.budget).ok()?;
        Some(floors)
    }

    /// Ensures room for `size` more, each vector within what `budget` vertices take.
    fn reserve(&mut self, size: Size, budget: usize) -> Result<(), TryReserveError> {
        grow(&mut self.positions, 2 * size.vertices, 2 * budget)?;
        grow(&mut self.distances, size.vertices, budget)?;
        grow(&mut self.colors, size.vertices, budget)?;
        grow(&mut self.dashes, 2 * size.vertices, 2 * budget)?;
        grow(&mut self.indices, size.indices, 3 * budget)
    }

    /// Strokes `path` in full where its mesh fits beside the vertices already meshed and the
    /// floors `later`, and the vectors grow to hold both; otherwise adds nothing and says so. The
    /// flattening stops once the path passes the room left.
    fn add_within(
        &mut self,
        path: &EdgePath,
        style: &EdgeStyle,
        within: &Within,
        later: Size,
        scratch: &mut Vec<Point>,
    ) -> bool {
        let room = within.budget - self.distances.len() - later.vertices;
        let Some(size) = flatten_edge(path, style, within, room, scratch) else {
            return false;
        };
        if self.reserve(size.plus(later), within.budget).is_err() {
            return false;
        }
        self.stroke_flattened(path, style, within.stroke, scratch);
        true
    }

    /// Draws `path` as its chord, in its colour and dash pattern, without an arrowhead, into room
    /// reserved before.
    fn chord(&mut self, path: &EdgePath, style: &EdgeStyle, stroke: &Stroke) {
        let dash = if stroke.plain {
            (0.0, 0.0)
        } else {
            style.dash.unwrap_or((0.0, 0.0))
        };
        let ends = [path.source, path.target];
        self.polyline(&ends, rgba(style.color), dash, stroke.width);
    }

    fn vertex_count(&self) -> u32 {
        u32::try_from(self.distances.len()).unwrap_or(u32::MAX)
    }

    /// Adds a vertex at `at`, its position written relative to the origin and only then rounded.
    fn vertex(&mut self, at: Point, distance: f64, color: u32, dash: (f32, f32)) {
        let Point { x, y } = self.origin;
        #[expect(
            clippy::cast_possible_truncation,
            reason = "less the query's origin and only then rounded (ADR-0010): a vertex the split \
                      keeps near the rectangle rounds by its distance from it, and an end left far \
                      beyond it keeps the rounding ADR-0027 records, which Q-4 allows past 2^21 \
                      px; a vertex lies within three times `WORLD_LIMIT` of the world's origin, a \
                      stroke's width within `PIXEL_LIMIT`'s, and the origin of a rectangle that \
                      finds it within 2^127 of it (ADR-0010), within f32"
        )]
        self.positions
            .extend([(at.x - x) as f32, (at.y - y) as f32]);
        #[expect(
            clippy::cast_possible_truncation,
            reason = "the distance along the path crosses as f32 from the source, rounded by up to \
                      2^-24 of itself, the residual ADR-0010 and ADR-0027 record; Q-4 bounds \
                      dashes at 2^21 px along the path, where that is under 0.5 px; a path between \
                      nodes within `WORLD_LIMIT` is far shorter than f32::MAX"
        )]
        self.distances.push(distance as f32);
        self.colors.push(color);
        self.dashes.extend([dash.0, dash.1]);
    }

    /// Strokes `path` with `style` into the mesh as `stroke` says, from its flattened `points`,
    /// which `flatten_edge` ended at the base of its arrowhead where it has one.
    fn stroke_flattened(
        &mut self,
        path: &EdgePath,
        style: &EdgeStyle,
        stroke: &Stroke,
        points: &[Point],
    ) {
        let color = rgba(style.color);
        if stroke.plain {
            self.polyline(points, color, (0.0, 0.0), stroke.width);
            return;
        }
        if style.arrow {
            let (tip, base, back) = arrow_of(path);
            self.arrowhead(tip, base, back, color);
        }
        self.polyline(
            points,
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

/// The arrowhead of `path`: its tip, the path's end, the middle of its base, and the direction it
/// points in.
fn arrow_of(path: &EdgePath) -> (Point, Point, Point) {
    let tip = path.target;
    let back = path.tangent_at(1.0);
    let base = Point::new(tip.x - back.x * ARROW_LENGTH, tip.y - back.y * ARROW_LENGTH);
    (tip, base, back)
}

/// Flattens `path` into `points`, as `within` says, ends it at the base of its arrowhead where
/// the stroke draws one, and splits it where it enters and leaves the grown rectangle; returns
/// what its mesh takes, or none once the flattened points pass `room` vertices, where the
/// flattening stops, or once the split ones do.
fn flatten_edge(
    path: &EdgePath,
    style: &EdgeStyle,
    within: &Within,
    room: usize,
    points: &mut Vec<Point>,
) -> Option<Size> {
    let arrow = !within.stroke.plain && style.arrow;
    let head = if arrow {
        Size::ARROWHEAD
    } else {
        Size::polyline(0)
    };
    let fits = |_: Point, n: usize| head.plus(Size::polyline(n)).vertices <= room;
    if !flatten(path, within.stroke.tolerance, &within.area, points, fits) {
        return None;
    }
    if arrow {
        trim_end(points, arrow_of(path).1);
    }
    if !split_at(points, &within.area) {
        return None;
    }
    let size = head.plus(Size::polyline(points.len()));
    (size.vertices <= room).then_some(size)
}

/// Whether the full mesh of `path` is its arrowhead alone: every point of its flattening lies
/// within the arrowhead, found out within `ARROWHEAD_POINTS` points.
fn arrowhead_alone(
    path: &EdgePath,
    style: &EdgeStyle,
    within: &Within,
    points: &mut Vec<Point>,
) -> bool {
    if within.stroke.plain || !style.arrow {
        return false;
    }
    let (tip, base, _) = arrow_of(path);
    let inside = reach(tip, base);
    let fits = |p: Point, n: usize| inside(&p) && n <= ARROWHEAD_POINTS;
    inside(&path.source) && flatten(path, within.stroke.tolerance, &within.area, points, fits)
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
    let within = reach(tip, base);
    while points.len() > 1 && within(&points[points.len() - 1]) {
        points.pop();
    }
    if !within(&points[0]) {
        points.push(base);
    }
}

/// Whether a point lies within the arrowhead from `tip` back to `base`: no farther from the tip
/// than the base.
fn reach(tip: Point, base: Point) -> impl Fn(&Point) -> bool {
    let reach = (base.x - tip.x).hypot(base.y - tip.y);
    move |p: &Point| (p.x - tip.x).hypot(p.y - tip.y) <= reach
}

/// Writes into `out`, after clearing it, the points of `path` flattened so that no point of the
/// curve inside `area` lies farther than `tolerance` from the polyline; a part whose control
/// points miss `area` is its chord. A tolerance that is not positive and finite gives the most
/// points. After each point it asks `fits` with that point and how many `out` holds, and stops,
/// returning false, at the first it refuses, or where `out` cannot grow.
fn flatten(
    path: &EdgePath,
    tolerance: f64,
    area: &Rect,
    out: &mut Vec<Point>,
    fits: impl Fn(Point, usize) -> bool,
) -> bool {
    out.clear();
    out.push(path.source);
    let tolerance = if tolerance.is_finite() {
        tolerance.max(0.0)
    } else {
        0.0
    };
    subdivide(path, tolerance, area, 0, out, &fits)
}

/// Where the segment `a`–`b` lies within `area`, edges included, as the fractions along it at
/// which it enters and leaves it, or none where it misses it. The bridge refuses coordinates that
/// are not finite, so none reach it.
pub(crate) fn crossing(a: Point, b: Point, area: &Rect) -> Option<(f64, f64)> {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let (mut enters, mut leaves) = (0.0_f64, 1.0_f64);
    // Per side, how fast the segment moves out across it, and how far inside it `a` lies.
    for (out, inside) in [
        (-dx, a.x - area.min_x),
        (dx, area.max_x - a.x),
        (-dy, a.y - area.min_y),
        (dy, area.max_y - a.y),
    ] {
        if out == 0.0 {
            if inside >= 0.0 {
                continue;
            }
            return None;
        }
        let at = inside / out;
        if out < 0.0 {
            enters = enters.max(at);
        } else {
            leaves = leaves.min(at);
        }
    }
    (enters <= leaves).then_some((enters, leaves))
}

/// The points a segment `a`–`b` is split at so that no part of it that meets `area` has an end
/// outside it: where it enters `area` after its start, and where it leaves it before its end.
fn splits(a: Point, b: Point, area: &Rect) -> [Option<Point>; 2] {
    let (enters, leaves) = crossing(a, b, area).unwrap_or((0.0, 1.0));
    [
        (enters > 0.0 && enters < 1.0).then(|| a.lerp(b, enters)),
        (leaves < 1.0 && leaves > enters).then(|| a.lerp(b, leaves)),
    ]
}

/// Splits each segment of the polyline `points` where it enters and leaves `area`, the query's
/// rectangle grown by the stroke's width (ADR-0027), so that no segment that meets the rectangle
/// has an end beyond `area`; the parts outside are chords. It runs after the arrowhead has cut
/// the end, whose base may lie anywhere. The points stay in order along the path, so that the
/// distance along it runs on through them. Returns false, leaving `points` as they were, where
/// they cannot grow.
fn split_at(points: &mut Vec<Point>, area: &Rect) -> bool {
    let count = |i: usize| {
        splits(points[i - 1], points[i], area)
            .iter()
            .flatten()
            .count()
    };
    let added: usize = (1..points.len()).map(count).sum();
    if added == 0 {
        return true;
    }
    let old = points.len();
    if points.try_reserve_exact(added).is_err() {
        return false;
    }
    points.resize(old + added, Point::default());
    // From the back, so that each point is read before a later one is written over it: point `i`
    // moves to `i` plus the splits of the segments up to it, and every write lands above `i - 1`.
    let mut at = old + added;
    for i in (0..old).rev() {
        at -= 1;
        points[at] = points[i];
        if i == 0 {
            break;
        }
        let (a, b) = (points[i - 1], points[at]);
        for &point in splits(a, b, area).iter().rev().flatten() {
            at -= 1;
            points[at] = point;
        }
    }
    true
}

/// Whether `p` lies within `reach` of `path` as a stroke within `tolerance` flattens it: the parts
/// of the path whose control points miss the square of side `2 · reach` around `p` are their
/// chords, which lie in those control points' hull and so no nearer than `reach` (ADR-0025).
/// `scratch` holds the flattened points afterwards.
pub(crate) fn near_path(
    path: &EdgePath,
    tolerance: f64,
    p: Point,
    reach: f64,
    scratch: &mut Vec<Point>,
) -> bool {
    let area = Rect::at(p).grown(reach);
    if !flatten(path, tolerance, &area, scratch, |_, _| true) {
        return false;
    }
    scratch
        .windows(2)
        .any(|segment| distance_to_segment(p, segment[0], segment[1]) <= reach)
}

/// How far `p` lies from the segment `a`–`b`.
pub(crate) fn distance_to_segment(p: Point, a: Point, b: Point) -> f64 {
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

fn subdivide(
    path: &EdgePath,
    tolerance: f64,
    area: &Rect,
    depth: u32,
    out: &mut Vec<Point>,
    fits: &impl Fn(Point, usize) -> bool,
) -> bool {
    if depth >= MAX_DEPTH || flatness(path) <= tolerance || !path.hull().meets(area) {
        if out.try_reserve(1).is_err() {
            return false;
        }
        out.push(path.target);
        return fits(path.target, out.len());
    }
    let (left, right) = path.split();
    subdivide(&left, tolerance, area, depth + 1, out, fits)
        && subdivide(&right, tolerance, area, depth + 1, out, fits)
}

/// The points the mesh of a query in `rect` strokes `path` through with `stroke`, without an
/// arrowhead and without a budget.
#[cfg(test)]
pub(crate) fn flattened(path: &EdgePath, stroke: &Stroke, rect: &Rect) -> Vec<Point> {
    let mut points = Vec::new();
    let area = rect.grown(stroke.width);
    assert!(flatten(
        path,
        stroke.tolerance,
        &area,
        &mut points,
        |_, _| true
    ));
    assert!(split_at(&mut points, &area));
    points
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::{PIXEL_LIMIT, Sides, WORLD_LIMIT};

    #[test]
    fn a_stroke_at_the_largest_pixel_stays_within_a_sixth_of_the_worlds_limit() {
        // Verifies: ADR-0028
        for level in [Level::Near, Level::Middle, Level::Far] {
            let stroke = Stroke::at(level, PIXEL_LIMIT);
            assert!(stroke.width <= WORLD_LIMIT / 6.0, "{level:?}");
            assert!(stroke.tolerance <= WORLD_LIMIT / 6.0, "{level:?}");
        }
    }

    /// A rectangle that holds every point: nothing is drawn as chords for lying outside it.
    const EVERYWHERE: Rect = Rect::new(
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::INFINITY,
    );

    /// `path` flattened within `tolerance` everywhere, without a limit.
    fn flatten_all(path: &EdgePath, tolerance: f64, out: &mut Vec<Point>) {
        assert!(flatten(path, tolerance, &EVERYWHERE, out, |_, _| true));
    }

    impl Mesh {
        /// Strokes `path` with `style` into the mesh as `stroke` says, everywhere and without a
        /// budget, leaving its flattened points in `scratch`.
        fn add_edge(
            &mut self,
            path: &EdgePath,
            style: &EdgeStyle,
            stroke: &Stroke,
            scratch: &mut Vec<Point>,
        ) {
            let within = Within {
                stroke,
                area: EVERYWHERE,
                budget: usize::MAX,
            };
            assert!(flatten_edge(path, style, &within, usize::MAX, scratch).is_some());
            self.stroke_flattened(path, style, stroke, scratch);
        }
    }

    /// The scales the example zooms through, from its least to its most.
    const SCALES: [f64; 6] = [0.005, 0.05, 0.25, 1.0, 2.0, 4.0];

    fn paths() -> Vec<EdgePath> {
        let node = |x, y| Rect::of_node(x, y, 220.0, 64.0);
        vec![
            EdgePath::between(&node(0.0, 0.0), &node(300.0, 110.0), Sides::default()),
            EdgePath::between(&node(0.0, 0.0), &node(300.0, -330.0), Sides::default()),
            EdgePath::between(&node(600.0, 0.0), &node(0.0, 500.0), Sides::default()),
            EdgePath::between(&node(0.0, 0.0), &node(4000.0, 2000.0), Sides::default()),
            // Backwards and level: the control points pull out beyond both ends of the chord.
            EdgePath::between(&node(500.0, 0.0), &node(0.0, 0.0), Sides::default()),
            EdgePath::between(&node(500.0, 0.0), &node(0.0, 0.5), Sides::default()),
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
                flatten_all(&path, 0.25 / scale, &mut points);
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
    fn a_path_is_subdivided_at_most_24_levels_deep() {
        // Verifies: ADR-0027
        // No tolerance stops the subdivision, so it stops at its deepest. Around the source alone,
        // each level splits off the half beyond it as a chord: the source, the end of the deepest
        // part, 2^-24 along the path, and one end per level, 24 of them.
        let path = paths()[3];
        let around = Rect::at(path.source);
        let mut points = Vec::new();
        for tolerance in [0.0, f64::NAN] {
            assert!(flatten(&path, tolerance, &around, &mut points, |_, _| true));
            assert_eq!(points.len(), 1 + 1 + 24, "tolerance {tolerance}");
            let deepest = path.point_at(2f64.powi(-24));
            assert!((points[1].x - deepest.x).abs() < 1e-9, "{:?}", points[1]);
            assert!((points[1].y - deepest.y).abs() < 1e-9, "{:?}", points[1]);
            assert!(points[1] != path.source);
        }
        // Around the target alone, the same from the other end.
        let around = Rect::at(path.target);
        assert!(flatten(&path, 0.0, &around, &mut points, |_, _| true));
        assert_eq!(points.len(), 1 + 24 + 1);
        let deepest = path.point_at(1.0 - 2f64.powi(-24));
        assert!((points[24].x - deepest.x).abs() < 1e-9, "{:?}", points[24]);
        assert!((points[24].y - deepest.y).abs() < 1e-9, "{:?}", points[24]);
    }

    #[test]
    fn zoomed_out_a_path_needs_fewer_points() {
        let path = paths()[3];
        let mut near = Vec::new();
        let mut far = Vec::new();
        flatten_all(&path, 0.25 / 4.0, &mut near);
        flatten_all(&path, 0.25 / 0.05, &mut far);
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
        assert!(((p[2] - p[0]).hypot(p[3] - p[1]) - FULL_WIDTH as f32).abs() < 1e-4);
    }

    #[test]
    fn an_arrowhead_ends_at_the_target_and_the_stroke_at_its_base() {
        let path = paths()[0];
        let mut points = Vec::new();
        let mut mesh = Mesh::default();
        mesh.add_edge(
            &path,
            &EdgeStyle::unstyled(),
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
            ..EdgeStyle::unstyled()
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
            &EdgeStyle::unstyled(),
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
        // Verifies: ADR-0027
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
        // Verifies: ADR-0027
        // Straight from (0, 0) to (60, 80), direction (0.6, 0.8): the base lies 10 back at
        // (54, 72), its corners 5 either side along (-0.8, 0.6).
        let path = straight(Point::new(0.0, 0.0), Point::new(60.0, 80.0));
        let mut points = Vec::new();
        let mut mesh = Mesh::default();
        mesh.add_edge(
            &path,
            &EdgeStyle::unstyled(),
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
        // Verifies: ADR-0027
        // Straight up from (0, 4) to (0, 0), 4 long: the base lies 10 back, at (0, 10), its
        // corners 5 either side along (1, 0); no stroke is drawn.
        let path = straight(Point::new(0.0, 4.0), Point::new(0.0, 0.0));
        let mut points = Vec::new();
        let mut mesh = Mesh::default();
        mesh.add_edge(
            &path,
            &EdgeStyle::unstyled(),
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
        let path = paths()[3];
        let around = Rect::at(path.source);
        let mut most = Vec::new();
        assert!(flatten(&path, 0.0, &around, &mut most, |_, _| true));
        for tolerance in [f64::INFINITY, f64::NEG_INFINITY] {
            assert!(flatten(&path, tolerance, &around, &mut points, |_, _| true));
            assert_eq!(points, most, "tolerance {tolerance}");
        }
    }

    #[test]
    fn a_negative_tolerance_counts_as_none() {
        // A straight path lies on its chord: within no tolerance at all, it needs no point
        // between its ends, which a tolerance below zero would never allow.
        let path = EdgePath::horizontal(Point::new(0.0, 0.0), Point::new(100.0, 0.0), 0.0);
        let mut points = Vec::new();
        for tolerance in [0.0, -1.0] {
            flatten_all(&path, tolerance, &mut points);
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
            &EdgeStyle::unstyled(),
            &Stroke::full(f64::NAN),
            &mut points,
        );
        assert!(mesh.positions.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn the_stroke_follows_the_level_and_the_size_of_a_screen_pixel() {
        let pixel = 4.0;
        let far = Stroke::at(Level::Far, pixel);
        assert_eq!((far.tolerance, far.width, far.plain), (1.0, 4.0, true));
        for level in [Level::Near, Level::Middle] {
            let full = Stroke::at(level, pixel);
            let expected = (1.0, FULL_WIDTH, false);
            assert_eq!((full.tolerance, full.width, full.plain), expected);
        }
    }

    /// The paths of `paths` as found edges, each in the colour of its index plus one, solid and
    /// without arrowheads.
    fn found(paths: &[EdgePath]) -> Vec<(EdgePath, EdgeStyle)> {
        (0..paths.len())
            .map(|i| {
                let style = EdgeStyle {
                    color: i as u32 + 1,
                    dash: None,
                    arrow: false,
                };
                (paths[i], style)
            })
            .collect()
    }

    /// The mesh of `edges` at full detail within `budget`.
    fn built(edges: &[(EdgePath, EdgeStyle)], budget: u32) -> Mesh {
        let mut mesh = Mesh::default();
        let mut points = Vec::new();
        let all = edges.iter().map(|(path, style)| (path, style));
        mesh.build(
            all,
            &Stroke::full(0.05),
            &EVERYWHERE,
            Point::default(),
            budget,
            &mut points,
        );
        mesh
    }

    #[test]
    fn edges_are_meshed_in_full_while_each_fits_beside_the_floors_after_it() {
        // Verifies: ADR-0027
        let edges = found(&paths()[..3]);
        let sizes: Vec<usize> = (0..3)
            .map(|i| built(&edges[i..=i], u32::MAX).distances.len())
            .collect();
        assert!(sizes.iter().all(|&size| size > 4), "{sizes:?}");
        let all: u32 = sizes.iter().sum::<usize>().try_into().unwrap();
        let whole = built(&edges, u32::MAX);
        let complete = built(&edges, all);
        assert_eq!(complete.detail, Detail::Complete);
        assert_eq!(complete.positions, whole.positions);
        // One vertex short: the last edge is drawn as its chord, four vertices.
        let short = built(&edges, all - 1);
        assert_eq!(short.detail, Detail::Coarsened);
        assert_eq!(short.distances.len(), sizes[0] + sizes[1] + 4);
        // The second edge does not fit beside the floor of the third: from it on, chords.
        let budget = u32::try_from(sizes[0] + sizes[1] + 4 - 1).unwrap();
        let chords = built(&edges, budget);
        assert_eq!(chords.detail, Detail::Coarsened);
        assert_eq!(chords.distances.len(), sizes[0] + 8);
        assert_eq!(
            &chords.positions[..2 * sizes[0]],
            &whole.positions[..2 * sizes[0]]
        );
        let ends = |i: usize| {
            let path = paths()[i];
            [path.source, path.target]
        };
        let mut expected = Mesh::default();
        expected.polyline(&ends(1), rgba(2), (0.0, 0.0), FULL_WIDTH);
        expected.polyline(&ends(2), rgba(3), (0.0, 0.0), FULL_WIDTH);
        assert_eq!(&chords.positions[2 * sizes[0]..], expected.positions);
        assert_eq!(&chords.distances[sizes[0]..], expected.distances);
        assert_eq!(&chords.colors[sizes[0]..], expected.colors);
    }

    #[test]
    fn where_the_floors_do_not_fit_the_mesh_holds_no_edge() {
        let edges = found(&paths()[..3]);
        let none = built(&edges, 11);
        assert_eq!(none.detail, Detail::Coarsened);
        assert!(none.distances.is_empty() && none.indices.is_empty());
        let floors = built(&edges, 12);
        assert_eq!(floors.detail, Detail::Coarsened);
        assert_eq!((floors.distances.len(), floors.indices.len()), (12, 18));
        let empty = built(&[], 0);
        assert_eq!(empty.detail, Detail::Complete);
        assert!(empty.distances.is_empty());
    }

    #[test]
    fn a_chord_keeps_the_dash_pattern_at_full_detail_and_draws_no_arrowhead() {
        let path = paths()[0];
        let style = EdgeStyle {
            color: 0x10_2030,
            dash: Some((6.0, 4.0)),
            arrow: true,
        };
        let length = (path.target.x - path.source.x).hypot(path.target.y - path.source.y);
        for (stroke, dash) in [
            (Stroke::full(0.25), [6.0, 4.0]),
            (Stroke::at(Level::Far, 1.0), [0.0, 0.0]),
        ] {
            let mut mesh = Mesh::default();
            mesh.chord(&path, &style, &stroke);
            assert_eq!(mesh.indices, [0, 1, 2, 1, 3, 2]);
            assert!(mesh.dashes.chunks(2).all(|d| d == dash));
            assert!(mesh.colors.iter().all(|&c| c == rgba(0x10_2030)));
            assert_eq!(mesh.distances[..2], [0.0, 0.0]);
            assert!((f64::from(mesh.distances[3]) - length).abs() < 1e-3);
            let p = &mesh.positions;
            let width = f64::from((p[2] - p[0]).hypot(p[3] - p[1]));
            assert!((width - stroke.width).abs() < 1e-4, "{width}");
        }
    }

    #[test]
    fn a_vector_grows_by_doubling_but_not_beyond_its_most() {
        let mut values: Vec<u8> = Vec::with_capacity(4);
        values.extend([1, 2, 3, 4]);
        grow(&mut values, 0, 100).unwrap();
        assert_eq!(values.capacity(), 4);
        grow(&mut values, 1, 100).unwrap();
        assert_eq!(values.capacity(), 8);
        grow(&mut values, 4, 100).unwrap();
        assert_eq!(values.capacity(), 8);
        let mut values: Vec<u8> = Vec::with_capacity(4);
        values.extend([1, 2, 3, 4]);
        grow(&mut values, 1, 6).unwrap();
        assert_eq!(values.capacity(), 6);
        // What is needed beyond the most is still reserved: the budget is the caller's.
        grow(&mut values, 5, 6).unwrap();
        assert_eq!(values.capacity(), 9);
        assert_eq!(values, [1, 2, 3, 4]);
    }

    #[test]
    fn the_flattening_stops_at_the_first_point_it_is_refused() {
        let mut points = Vec::new();
        assert!(!flatten(
            &paths()[3],
            0.0,
            &EVERYWHERE,
            &mut points,
            |_, n| n < 3
        ));
        assert_eq!(points.len(), 3);
    }

    #[test]
    fn an_edge_fits_while_its_flattened_points_stay_within_the_room() {
        // Verifies: ADR-0027
        // The flattening stops once its points pass the room left, counted before the arrowhead
        // cuts the end off.
        let path = paths()[0];
        let style = EdgeStyle::unstyled();
        let stroke = Stroke::full(1e-4);
        let mut untrimmed = Vec::new();
        flatten_all(&path, stroke.tolerance, &mut untrimmed);
        let within = |room: usize| Within {
            stroke: &stroke,
            area: EVERYWHERE,
            budget: room,
        };
        let room = Size::ARROWHEAD
            .plus(Size::polyline(untrimmed.len()))
            .vertices;
        let mut points = Vec::new();
        let size = flatten_edge(&path, &style, &within(room), room, &mut points).unwrap();
        assert!(
            points.len() < untrimmed.len(),
            "{} of {}",
            points.len(),
            untrimmed.len()
        );
        assert_eq!(size, Size::ARROWHEAD.plus(Size::polyline(points.len())));
        assert_eq!(
            flatten_edge(&path, &style, &within(room), room - 1, &mut points),
            None
        );
        let plain = EdgeStyle {
            arrow: false,
            ..style
        };
        let all = 2 * untrimmed.len();
        let fits = flatten_edge(&path, &plain, &within(all), all, &mut points);
        assert_eq!(fits, Some(Size::polyline(untrimmed.len())));
        assert_eq!(
            flatten_edge(&path, &plain, &within(all), all - 1, &mut points),
            None
        );
    }

    #[test]
    fn outside_the_rectangle_a_path_is_its_chords() {
        // Verifies: ADR-0027
        let path = paths()[3];
        let mut everywhere = Vec::new();
        flatten_all(&path, 0.01, &mut everywhere);
        // A rectangle around the source: far from it, the path is cut into few chords.
        let near = Rect::at(path.source).grown(20.0);
        let mut points = Vec::new();
        assert!(flatten(&path, 0.01, &near, &mut points, |_, _| true));
        assert!(
            points.len() * 4 < everywhere.len(),
            "{} of {}",
            points.len(),
            everywhere.len()
        );
        assert_eq!(points.first(), Some(&path.source));
        assert_eq!(points.last(), Some(&path.target));
        // Inside it, the points are those of the path flattened everywhere.
        let inside = |p: &&Point| near.contains(**p);
        let a: Vec<_> = points.iter().filter(inside).collect();
        let b: Vec<_> = everywhere.iter().filter(inside).collect();
        assert_eq!(a, b);
    }

    /// The rectangle the scene queries on a canvas of 1440 × 900 pixels at a scale of 4 around
    /// `at`: the viewport grown by the culling margin of 128 pixels.
    fn viewport_around(at: Point) -> Rect {
        Rect::new(at.x - 180.0, at.y - 112.5, at.x + 180.0, at.y + 112.5).grown(32.0)
    }

    /// The straight edge of the reproduction, from (-1e7, -3e6) to (1e7, 3e6), flat at once.
    fn long_straight() -> EdgePath {
        straight(Point::new(-1e7, -3e6), Point::new(1e7, 3e6))
    }

    const UNARROWED: EdgeStyle = EdgeStyle {
        color: 1,
        dash: Some((6.0, 4.0)),
        arrow: false,
    };

    /// The mesh of `path` alone in `style`, queried in `rect` at a scale of 4, its positions
    /// relative to the query's origin.
    fn queried(path: &EdgePath, style: &EdgeStyle, rect: &Rect) -> Mesh {
        let mut mesh = Mesh::default();
        mesh.build(
            [(path, style)].into_iter(),
            &Stroke::at(Level::Near, 0.25),
            rect,
            crate::graph::origin_of(rect),
            MESH_BUDGET,
            &mut Vec::new(),
        );
        mesh
    }

    /// How far, in pixels at a scale of 4, the points of `path` inside `rect` lie from half the
    /// stroke's width off either side of its mesh queried there, as f32 holds its vertices; and
    /// asserts that no vertex of a segment of a side that meets `rect` lies beyond the rectangle
    /// grown by the stroke's width and its half width at a vertex.
    fn strays_inside(path: &EdgePath, rect: &Rect) -> f64 {
        let mesh = queried(path, &UNARROWED, rect);
        assert_eq!(mesh.detail, Detail::Complete);
        // The two sides of the stroke drawn, the origin added: the first and the second vertex of
        // each point.
        let origin = crate::graph::origin_of(rect);
        let side = |first: usize| -> Vec<Point> {
            let at = |v: &[f32], axis: usize| f64::from(v[first + axis]);
            let vertices = mesh.positions.chunks(4);
            vertices
                .map(|v| Point::new(at(v, 0) + origin.x, at(v, 1) + origin.y))
                .collect()
        };
        let sides = [side(0), side(2)];
        let reach = rect.grown(2.0 * FULL_WIDTH);
        for side in &sides {
            for s in side.windows(2) {
                if crossing(s[0], s[1], rect).is_some() {
                    assert!(reach.contains(s[0]) && reach.contains(s[1]), "{s:?}");
                }
            }
        }
        // The points of the edge inside the rectangle, about a twentieth of a pixel apart.
        let length = (path.target.x - path.source.x).hypot(path.target.y - path.source.y);
        let step = 1.0 / 80.0 / length;
        let inside: Vec<Point> = (-10_000..=10_000)
            .map(|i| path.point_at(0.5 + f64::from(i) * step))
            .filter(|p| rect.contains(*p))
            .collect();
        assert!(inside.len() > 5000, "{}", inside.len());
        let half = FULL_WIDTH / 2.0;
        let worst = inside
            .iter()
            .flat_map(|&p| {
                sides.iter().map(move |side| {
                    let to_side = side
                        .windows(2)
                        .map(|s| distance_to_segment(p, s[0], s[1]))
                        .fold(f64::INFINITY, f64::min);
                    (to_side - half).abs()
                })
            })
            .fold(0.0, f64::max);
        worst * 4.0
    }

    #[test]
    fn a_straight_edge_far_beyond_the_viewport_is_drawn_within_a_quarter_pixel_inside_it() {
        // Verifies: Q-4, ADR-0027
        let rect = viewport_around(Point::default());
        let worst = strays_inside(&long_straight(), &rect);
        assert!(worst <= 0.25, "strays {worst} px");
        // At ±1e7 the ends happen to round little, since they are whole numbers f32 holds; at
        // ±1e9, unsplit, the sides would stray by pixels.
        let longer = straight(Point::new(-1e9, -3e8), Point::new(1e9, 3e8));
        let worst = strays_inside(&longer, &rect);
        assert!(worst <= 0.25, "strays {worst} px");
    }

    /// Whether `p` lies on the edge of `area`, within what rounding leaves of it.
    fn on_edge_of(area: &Rect, p: Point) -> bool {
        let close = |a: f64, b: f64| (a - b).abs() <= 1e-9 * (1.0 + a.abs());
        area.grown(1e-6).contains(p)
            && (close(p.x, area.min_x)
                || close(p.x, area.max_x)
                || close(p.y, area.min_y)
                || close(p.y, area.max_y))
    }

    #[test]
    fn a_segment_is_split_where_it_enters_and_leaves_the_rectangle_grown_by_the_stroke() {
        // Verifies: ADR-0027
        let path = long_straight();
        let rect = viewport_around(Point::default());
        let stroke = Stroke::at(Level::Near, 0.25);
        let area = rect.grown(stroke.width);
        let points = flattened(&path, &stroke, &rect);
        assert_eq!(points.len(), 4, "{points:?}");
        assert_eq!((points[0], points[3]), (path.source, path.target));
        // Along y = 0.3 x it enters by the left side, at x = -214, and leaves by the right.
        for (p, x) in [(points[1], -214.0), (points[2], 214.0)] {
            assert!(on_edge_of(&area, p), "{p:?}");
            assert!(
                (p.x - x).abs() < 1e-6 && (p.y - 0.3 * x).abs() < 1e-6,
                "{p:?}"
            );
        }
    }

    #[test]
    fn the_distance_along_the_path_runs_on_through_the_split() {
        // Verifies: ADR-0027
        let path = long_straight();
        let rect = viewport_around(Point::default());
        let mesh = queried(&path, &UNARROWED, &rect);
        let points = flattened(&path, &Stroke::at(Level::Near, 0.25), &rect);
        let length = |a: Point, b: Point| (b.x - a.x).hypot(b.y - a.y);
        let mut along = 0.0;
        let mut expected = vec![0.0_f32];
        for s in points.windows(2) {
            along += length(s[0], s[1]);
            expected.push(along as f32);
        }
        let drawn: Vec<f32> = mesh.distances.iter().step_by(2).copied().collect();
        assert_eq!(drawn, expected);
        assert_eq!(mesh.distances.chunks(2).filter(|d| d[0] != d[1]).count(), 0);
        // The whole runs as far as the unsplit chord: the split points lie on it.
        let whole = length(path.source, path.target) as f32;
        assert!(
            (drawn[3] - whole).abs() <= whole * f32::EPSILON,
            "{drawn:?}"
        );
        assert!(mesh.dashes.chunks(2).all(|d| d == [6.0, 4.0]));
    }

    #[test]
    fn a_path_wholly_inside_the_rectangle_is_meshed_as_without_one() {
        // Verifies: ADR-0027
        let edges = found(&paths());
        let around = Rect::new(-1000.0, -1000.0, 5000.0, 3000.0);
        let mut points = Vec::new();
        let stroke = Stroke::full(0.05);
        let mut inside = Mesh::default();
        inside.build(
            edges.iter().map(|(path, style)| (path, style)),
            &stroke,
            &around,
            Point::default(),
            u32::MAX,
            &mut points,
        );
        let everywhere = built(&edges, u32::MAX);
        assert_eq!(inside.positions, everywhere.positions);
        assert_eq!(inside.distances, everywhere.distances);
        assert_eq!(inside.indices, everywhere.indices);
    }

    #[test]
    fn an_arrowhead_cuts_the_path_before_it_is_split() {
        // Verifies: ADR-0027
        // From far to the left into the rectangle: the stroke enters it at x = -2, the edge of
        // the grown rectangle, and ends at the base of the arrowhead, 10 before the tip.
        let path = straight(Point::new(-1e6, 50.0), Point::new(50.0, 50.0));
        let rect = Rect::new(0.0, 0.0, 100.0, 100.0);
        let stroke = Stroke::full(0.25);
        let within = Within {
            stroke: &stroke,
            area: rect.grown(stroke.width),
            budget: usize::MAX,
        };
        let mut points = Vec::new();
        let size = flatten_edge(
            &path,
            &EdgeStyle::unstyled(),
            &within,
            usize::MAX,
            &mut points,
        );
        assert_eq!(size, Some(Size::ARROWHEAD.plus(Size::polyline(3))));
        let p = |x| Point::new(x, 50.0);
        assert_eq!(points, [p(-1e6), p(-2.0), p(40.0)]);
    }

    #[test]
    fn the_split_points_count_against_the_room_left() {
        // Verifies: ADR-0027
        // Flat at once, two points fit in 4 vertices; split, the four take 8.
        let path = long_straight();
        let stroke = Stroke::at(Level::Near, 0.25);
        let within = Within {
            stroke: &stroke,
            area: viewport_around(Point::default()).grown(stroke.width),
            budget: usize::MAX,
        };
        let mut points = Vec::new();
        let fits = flatten_edge(&path, &UNARROWED, &within, 8, &mut points);
        assert_eq!(fits, Some(Size::polyline(4)));
        assert_eq!(
            flatten_edge(&path, &UNARROWED, &within, 7, &mut points),
            None
        );
    }

    #[test]
    fn a_segment_is_split_only_where_it_crosses_the_edge_of_the_area() {
        let area = Rect::new(0.0, 0.0, 10.0, 10.0);
        let p = |x, y| Point::new(x, y);
        let split = |a: Point, b: Point| -> Vec<Point> {
            let mut points = vec![a, b];
            assert!(split_at(&mut points, &area));
            points
        };
        // Inside, outside, or of no length: as it was.
        for (a, b) in [
            (p(1.0, 1.0), p(9.0, 9.0)),
            (p(-5.0, -5.0), p(-5.0, 20.0)),
            (p(20.0, 5.0), p(20.0, 5.0)),
            (p(5.0, 5.0), p(5.0, 5.0)),
            (p(-1.0, 5.0), p(-1.0, 5.0)),
            // From the edge outward, or inward from it, or onto it: its end on the edge is its
            // own.
            (p(0.0, 5.0), p(-20.0, 5.0)),
            (p(0.0, 5.0), p(5.0, 5.0)),
            (p(-20.0, 5.0), p(0.0, 5.0)),
            (p(5.0, 5.0), p(10.0, 5.0)),
        ] {
            assert_eq!(split(a, b), [a, b], "{a:?} to {b:?}");
        }
        // Through a corner from outside to outside, it leaves where it enters: one point.
        assert_eq!(
            split(p(-5.0, 5.0), p(5.0, -5.0)),
            [p(-5.0, 5.0), p(0.0, 0.0), p(5.0, -5.0)]
        );
        // In from outside, out from inside, and through.
        assert_eq!(
            split(p(-10.0, 5.0), p(5.0, 5.0)),
            [p(-10.0, 5.0), p(0.0, 5.0), p(5.0, 5.0)]
        );
        assert_eq!(
            split(p(5.0, 5.0), p(5.0, 30.0)),
            [p(5.0, 5.0), p(5.0, 10.0), p(5.0, 30.0)]
        );
        assert_eq!(
            split(p(-10.0, 5.0), p(20.0, 5.0)),
            [p(-10.0, 5.0), p(0.0, 5.0), p(10.0, 5.0), p(20.0, 5.0)]
        );
        // Along the edge itself, it is split at the corners.
        assert_eq!(
            split(p(-10.0, 0.0), p(20.0, 0.0)),
            [p(-10.0, 0.0), p(0.0, 0.0), p(10.0, 0.0), p(20.0, 0.0)]
        );
        // An area without bounds splits nothing.
        let mut points = vec![p(-1e9, 3.0), p(1e9, 7.0)];
        assert!(split_at(&mut points, &EVERYWHERE));
        assert_eq!(points.len(), 2);
        // Several segments: each is split in place, the points in order along the path.
        let mut points = vec![p(-10.0, 5.0), p(5.0, 5.0), p(5.0, 30.0), p(5.0, 40.0)];
        assert!(split_at(&mut points, &area));
        assert_eq!(
            points,
            [
                p(-10.0, 5.0),
                p(0.0, 5.0),
                p(5.0, 5.0),
                p(5.0, 10.0),
                p(5.0, 30.0),
                p(5.0, 40.0)
            ]
        );
    }

    #[test]
    fn the_size_of_a_part_is_what_the_mesh_takes_for_it() {
        let p = |x| Point::new(x, 0.0);
        for n in 0..6 {
            let points: Vec<Point> = (0..n).map(|i| p(f64::from(i) * 10.0)).collect();
            let mut mesh = Mesh::default();
            mesh.polyline(&points, 1, (0.0, 0.0), 2.0);
            let size = Size::polyline(n as usize);
            assert_eq!(
                (mesh.distances.len(), mesh.indices.len()),
                (size.vertices, size.indices)
            );
        }
        let mut mesh = Mesh::default();
        mesh.arrowhead(p(10.0), p(0.0), Point::new(1.0, 0.0), 1);
        mesh.polyline(&[p(0.0), p(5.0), p(9.0)], 1, (0.0, 0.0), 2.0);
        let size = Size::ARROWHEAD.plus(Size::polyline(3));
        assert_eq!(
            (mesh.distances.len(), mesh.indices.len()),
            (size.vertices, size.indices)
        );
        assert_eq!((CHORD.vertices, CHORD.indices), (4, 6));
        let most = Size {
            vertices: usize::MAX,
            indices: usize::MAX,
        };
        assert_eq!(most.plus(CHORD), most);
        assert_eq!(most.minus(CHORD).plus(CHORD), most);
    }

    #[test]
    fn a_reservation_makes_room_in_every_vector_within_what_the_budget_takes() {
        let mut mesh = Mesh::default();
        let size = |vertices, indices| Size { vertices, indices };
        mesh.reserve(size(10, 20), 15).unwrap();
        let capacities = |mesh: &Mesh| {
            [
                mesh.positions.capacity(),
                mesh.distances.capacity(),
                mesh.colors.capacity(),
                mesh.dashes.capacity(),
                mesh.indices.capacity(),
            ]
        };
        assert_eq!(capacities(&mesh), [20, 10, 10, 20, 20]);
        // Doubling stops at what 15 vertices take: 30 values of positions, 45 indices.
        mesh.reserve(size(11, 22), 15).unwrap();
        assert_eq!(capacities(&mesh), [30, 15, 15, 30, 40]);
    }

    /// An edge shorter than its arrowhead, at `x`: its full mesh is the arrowhead alone.
    fn short(x: f64) -> (EdgePath, EdgeStyle) {
        let path = straight(Point::new(x, 4.0), Point::new(x, 0.0));
        (path, EdgeStyle::unstyled())
    }

    #[test]
    fn an_edge_whose_full_mesh_is_its_arrowhead_has_that_for_its_floor() {
        // Verifies: ADR-0027
        let mut edges = found(&paths()[..1]);
        edges.extend((0..4).map(|i| short(f64::from(i) * 100.0)));
        let first = built(&edges[..1], u32::MAX).distances.len();
        let all = u32::try_from(first + 4 * 3).unwrap();
        // Beside four floors of three, the first edge fits in full: complete.
        let complete = built(&edges, all);
        assert_eq!(complete.detail, Detail::Complete);
        assert_eq!(complete.positions, built(&edges, u32::MAX).positions);
        // One vertex short, it is drawn as its chord, and the others still as their arrowheads.
        let short_of = built(&edges, all - 1);
        assert_eq!(short_of.detail, Detail::Coarsened);
        assert_eq!(short_of.distances.len(), 4 + 4 * 3);
        assert_eq!(short_of.indices.len(), 6 + 4 * 3);
        // The floors alone: 16 vertices fit, 15 do not.
        assert_eq!(built(&edges, 16).distances.len(), 16);
        assert!(built(&edges, 15).distances.is_empty());
    }

    #[test]
    fn finding_an_arrowhead_alone_stops_at_the_first_point_beyond_it_or_after_64() {
        let within = |stroke| Within {
            stroke,
            area: EVERYWHERE,
            budget: usize::MAX,
        };
        let mut points = Vec::new();
        let (path, style) = short(0.0);
        let full = Stroke::full(0.25);
        assert!(arrowhead_alone(&path, &style, &within(&full), &mut points));
        let plain = Stroke::at(Level::Far, 1.0);
        assert!(!arrowhead_alone(
            &path,
            &style,
            &within(&plain),
            &mut points
        ));
        let unarrowed = EdgeStyle {
            arrow: false,
            ..style
        };
        assert!(!arrowhead_alone(
            &path,
            &unarrowed,
            &within(&full),
            &mut points
        ));
        // A bend within the arrowhead's reach takes more than 64 points at no tolerance.
        let bend = EdgePath {
            source: Point::new(0.0, 4.0),
            control_source: Point::new(3.0, 4.0),
            control_target: Point::new(-3.0, 0.0),
            target: Point::new(0.0, 0.0),
        };
        let mut all = Vec::new();
        flatten_all(&bend, 1e-9, &mut all);
        assert!(all.len() > 65, "{}", all.len());
        let fine = Stroke::full(1e-9);
        assert!(!arrowhead_alone(&bend, &style, &within(&fine), &mut points));
        assert_eq!(points.len(), 64 + 1);
        let coarse = Stroke::full(5.0);
        assert!(arrowhead_alone(
            &bend,
            &style,
            &within(&coarse),
            &mut points
        ));
        // A path that leaves the reach is not its arrowhead alone.
        let long = straight(Point::new(0.0, 40.0), Point::new(0.0, 0.0));
        assert!(!arrowhead_alone(&long, &style, &within(&full), &mut points));
    }
}
