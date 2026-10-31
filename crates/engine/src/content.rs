//! The layout of node content (ADR-0013): rows of weighted columns, each holding one element,
//! laid out inside the width the host application gives a node, from the glyph advances and the
//! line height of each font the shell draws with. The layout computes each row's height, each
//! element's rectangle, where each text is cut and an ellipsis drawn after it, and the node's
//! height from its rows; the rest of the engine takes that height as the node's.
//!
//! The six elements of ADR-0013 exist: `text`, `icon`, `action`, `badge`, `progress`, and
//! `metric`. An icon is a square as high as the body's line, at most as wide as its column, at its
//! column's left and in the middle of that line; which image it shows is the bridge's to keep and
//! the shell's to draw, since the layout reads none of it. An action is a text in the font of
//! role body; what it names is the bridge's to keep, since the layout reads none of it. A badge is
//! a text in the font of role body on a pill, whose rectangle is the badge's: it hugs the text as
//! far as it is drawn, padded as an edge label's pill is, and stays within its column; its colour
//! is the bridge's to keep. A progress bar fills its column and a line of the body's height, its
//! cell, and its bar, `BAR_HEIGHT` high, lies in the middle of that line, cut into its segments
//! from the column's left by their fractions and the rest of the bar its track (`bar`); the
//! segments' colours are the bridge's to keep. A metric fills its column and two lines, its cell:
//! the caption's line in the font of role caption, and below it the value's in the body's, which
//! holds the value at the column's left, its trend's arrow after it, and the trend's text after
//! that (`metric_parts`); the trend's direction picks the arrow, and its colour is the bridge's to
//! keep.

use crate::graph::Level;

/// The space between a node's left and right sides and its columns, in world units.
pub const PADDING_X: f64 = 12.0;

/// The space above a node's first row, in world units.
pub const PADDING_TOP: f64 = 10.0;

/// The space below a node's last row, in world units.
pub const PADDING_BOTTOM: f64 = 10.0;

/// The space between two columns of a row, in world units.
pub const COLUMN_GAP: f64 = 8.0;

/// The space between a badge's text and its pill's left and right sides, in world units: an edge
/// label's pill's.
pub const BADGE_PADDING_X: f64 = 8.0;

/// The space between a badge's text and its pill's top and bottom, in world units: with the
/// body's line of 16, a pill 22 high, as an edge label's.
pub const BADGE_PADDING_Y: f64 = 3.0;

/// The height of a progress bar's bar, in world units, at most its line's.
pub const BAR_HEIGHT: f64 = 8.0;

/// The side of the square a metric's trend arrow fills, in world units: each arrow is the same
/// triangle turned, its base one side of the square and its apex the middle of the opposite one.
pub const ARROW_SIZE: f64 = 10.0;

/// The space between a metric's value and its trend's arrow, in world units: the gap between
/// columns, so that the value reads apart from its trend.
pub const VALUE_GAP: f64 = COLUMN_GAP;

/// The space between a metric's trend arrow and its trend's text, in world units: half the gap
/// before the arrow, so that arrow and text read as one.
pub const ARROW_GAP: f64 = 4.0;

/// The least height of a node, whatever its rows: a node of one row of a title is as tall as the
/// nodes of the host applications that gave a height before content replaced it.
pub const MIN_HEIGHT: f64 = 64.0;

/// The largest glyph advance or line height a font may hand over, in world units: far beyond any
/// font the shell draws with, and small enough that no layout of the rows a node may hold reaches
/// past `f32`.
pub const MAX_METRIC: f64 = 1024.0;

/// The character drawn after a cut text.
pub const ELLIPSIS: char = '\u{2026}';

/// The role of a text, which chooses its font (ADR-0013).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Title,
    Body,
    Caption,
}

/// The direction of a metric's trend, which picks its arrow (ADR-0013): up ▲, down ▼, flat ▶.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    Up,
    Down,
    Flat,
}

/// Why a font was refused: advances and code points that do not pair up, or a metric that is no
/// finite number from 0 to `MAX_METRIC`. Either is the shell's mistake (ADR-0031).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FontError {
    Unpaired,
    Metric,
}

/// The metrics of one font the shell draws text with: the advance of each glyph it handed over,
/// one for every other character, and the line height.
#[derive(Clone, Debug, PartialEq)]
pub struct Font {
    ascii: [f32; 128],
    others: Vec<(u32, f32)>,
    fallback: f32,
    line_height: f32,
}

/// Whether `value` is a metric a font may hand over.
fn metric(value: f64) -> bool {
    (0.0..=MAX_METRIC).contains(&value)
}

/// `value`, a metric, as the `f32` the font keeps.
#[expect(
    clippy::cast_possible_truncation,
    reason = "a metric from 0 to MAX_METRIC, which `metric` checked, far within f32"
)]
fn kept(value: f64) -> f32 {
    value as f32
}

impl Font {
    /// The font whose glyphs of the code points `codes` advance by `advances`, each other
    /// character by `fallback`, and whose lines are `line_height` apart, all in world units.
    pub fn new(
        codes: &[u32],
        advances: &[f64],
        fallback: f64,
        line_height: f64,
    ) -> Result<Self, FontError> {
        if codes.len() != advances.len() {
            return Err(FontError::Unpaired);
        }
        if !(advances.iter().all(|&a| metric(a)) && metric(fallback) && metric(line_height)) {
            return Err(FontError::Metric);
        }
        let mut font = Self::uniform(kept(fallback), kept(line_height));
        for (&code, &advance) in codes.iter().zip(advances) {
            match usize::try_from(code) {
                Ok(i) if i < 128 => font.ascii[i] = kept(advance),
                _ => font.others.push((code, kept(advance))),
            }
        }
        font.others.sort_unstable_by_key(|&(code, _)| code);
        font.others.dedup_by_key(|&mut (code, _)| code);
        Ok(font)
    }

    /// A font whose every glyph advances by `advance`.
    const fn uniform(advance: f32, line_height: f32) -> Self {
        Self {
            ascii: [advance; 128],
            others: Vec::new(),
            fallback: advance,
            line_height,
        }
    }

    /// The advance of `character`.
    fn advance(&self, character: char) -> f64 {
        let code = u32::from(character);
        let advance = match usize::try_from(code) {
            Ok(i) if i < 128 => self.ascii[i],
            _ => self
                .others
                .binary_search_by_key(&code, |&(code, _)| code)
                .map_or(self.fallback, |at| self.others[at].1),
        };
        f64::from(advance)
    }

    /// The height of a line of the font.
    pub fn line_height(&self) -> f64 {
        f64::from(self.line_height)
    }
}

/// The fonts of the three roles. Until the shell hands one over, a role's glyphs advance by
/// nothing and its lines are as high as the shell's own font of that role.
#[derive(Clone, Debug, PartialEq)]
pub struct Fonts {
    title: Font,
    body: Font,
    caption: Font,
}

impl Default for Fonts {
    fn default() -> Self {
        Self {
            title: Font::uniform(0.0, 18.0),
            body: Font::uniform(0.0, 16.0),
            caption: Font::uniform(0.0, 14.0),
        }
    }
}

impl Fonts {
    /// The font of `role`.
    pub const fn of(&self, role: Role) -> &Font {
        match role {
            Role::Title => &self.title,
            Role::Body => &self.body,
            Role::Caption => &self.caption,
        }
    }

    /// Hands over the font of `role`, for every layout from now on.
    pub fn set(&mut self, role: Role, font: Font) {
        match role {
            Role::Title => self.title = font,
            Role::Body => self.body = font,
            Role::Caption => self.caption = font,
        }
    }
}

/// One element of node content, as the layout reads it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Element<'a> {
    Text {
        role: Role,
        text: &'a str,
    },
    /// A square the height of the body's line, at most its column, which shows the image the host
    /// application registered under its name; it shows no text.
    Icon,
    /// A text whose click the host application gives a meaning, drawn in the font of role body.
    Action {
        text: &'a str,
    },
    /// A text on a pill of a colour the host application gives, drawn in the font of role body.
    Badge {
        text: &'a str,
    },
    /// A bar the width of its column in a line of the body's height, which shows no text.
    Progress,
    /// A caption above a value and its trend's text, each cut on its own line (`metric_parts`); as
    /// one element it shows no text of its own.
    Metric {
        caption: &'a str,
        value: &'a str,
        trend: &'a str,
    },
}

impl Element<'_> {
    /// The role whose font the element's text is drawn in.
    pub const fn role(&self) -> Role {
        match *self {
            Self::Text { role, .. } => role,
            Self::Icon
            | Self::Action { .. }
            | Self::Badge { .. }
            | Self::Progress
            | Self::Metric { .. } => Role::Body,
        }
    }

    /// The text the element shows.
    pub const fn text(&self) -> &str {
        match *self {
            Self::Text { text, .. } | Self::Action { text } | Self::Badge { text } => text,
            Self::Icon | Self::Progress | Self::Metric { .. } => "",
        }
    }

    /// The element's kind, and a text's role.
    const fn kind(&self) -> Kind {
        match *self {
            Self::Text { role, .. } => Kind::Text(role),
            Self::Icon => Kind::Icon,
            Self::Action { .. } => Kind::Action,
            Self::Badge { .. } => Kind::Badge,
            Self::Progress => Kind::Progress,
            Self::Metric { .. } => Kind::Metric,
        }
    }
}

/// One column of a row: its weight, a positive finite number the bridge checked, and its element.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cell<'a> {
    pub weight: f64,
    pub element: Element<'a>,
}

/// Where an element lies in its node, relative to the node's top-left corner, and for a text how
/// many of its UTF-16 code units are drawn, all of them unless it was cut, and whether an
/// ellipsis follows them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placed {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub kept: u32,
    pub ellipsis: bool,
}

/// What of an element its height and where it lies in its row depend on: its kind, and a text's
/// role; none of its texts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Text(Role),
    Icon,
    Action,
    Badge,
    Progress,
    Metric,
}

/// The height of an element of `kind` in `fonts`: its line's, an icon's the body's line, a
/// badge's pill's, its line and the padding above and below, and a metric's two lines, the
/// caption's and the body's below it.
fn element_height(kind: Kind, fonts: &Fonts) -> f64 {
    match kind {
        Kind::Text(role) => fonts.of(role).line_height(),
        Kind::Badge => fonts.of(Role::Body).line_height() + 2.0 * BADGE_PADDING_Y,
        Kind::Metric => fonts.of(Role::Caption).line_height() + fonts.of(Role::Body).line_height(),
        Kind::Icon | Kind::Action | Kind::Progress => fonts.of(Role::Body).line_height(),
    }
}

/// How far below its row's top an element of `kind` lies in a row that holds a badge where
/// `badged`: every element but a badge by the badge's padding above its text, so that the texts of
/// the row share one line; nothing in a row without a badge.
const fn row_offset(kind: Kind, badged: bool) -> f64 {
    match kind {
        Kind::Badge => 0.0,
        _ if badged => BADGE_PADDING_Y,
        _ => 0.0,
    }
}

/// The height of a row of elements of `kinds`: as deep as its deepest element reaches below the
/// row's top, its offset (`row_offset`) and its height; none for a row of no elements.
fn row_height(kinds: impl Iterator<Item = Kind> + Clone, fonts: &Fonts) -> f64 {
    let badged = kinds.clone().any(|kind| kind == Kind::Badge);
    kinds
        .map(|kind| row_offset(kind, badged) + element_height(kind, fonts))
        .fold(0.0, f64::max)
}

/// Whether `cells` hold a badge.
fn badged(cells: &[Cell]) -> bool {
    cells
        .iter()
        .any(|cell| matches!(cell.element, Element::Badge { .. }))
}

/// The height of a node whose rows are `rows` high together: the padding above and below and the
/// rows between, at least `MIN_HEIGHT`.
fn node_height(rows: f64) -> f64 {
    (PADDING_TOP + rows + PADDING_BOTTOM).max(MIN_HEIGHT)
}

/// The height of a node whose rows hold elements of the kinds of `rows`, each row's in its order,
/// in `fonts`: the height `lay_out` returns for that content, whatever its texts and its width.
pub fn height<R>(rows: impl IntoIterator<Item = R>, fonts: &Fonts) -> f64
where
    R: IntoIterator<Item = Kind>,
    R::IntoIter: Clone,
{
    node_height(
        rows.into_iter()
            .map(|row| row_height(row.into_iter(), fonts))
            .sum(),
    )
}

/// The largest `f32` of at most `value` whose sum with `x` stays within `end`, both sums taken
/// exactly in `f64`, and 0 where none does.
fn within(x: f32, value: f64, end: f32) -> f32 {
    within_f64(x, value, f64::from(end))
}

/// `within` for an end that `f64` holds and `f32` may not.
fn within_f64(x: f32, value: f64, end: f64) -> f32 {
    let room = (end - f64::from(x)).min(value).max(0.0);
    #[expect(
        clippy::cast_possible_truncation,
        reason = "a span within a node's width, which f32 holds, stepped down below to stay in it"
    )]
    let width = room as f32;
    // Rounded to the nearest, it passes `end` by at most one step.
    if f64::from(x) + f64::from(width) > end {
        return width.next_down().max(0.0);
    }
    width
}

/// `value`, a place within a node, as the `f32` the layout hands over.
#[expect(
    clippy::cast_possible_truncation,
    reason = "a place within a node's width or height, which f32 holds"
)]
fn place(value: f64) -> f32 {
    value as f32
}

/// How many UTF-16 code units of `text` to draw in a column `width` wide in `font`, and whether
/// an ellipsis follows them: all of them where the text fits, else as many whole characters as
/// fit beside the ellipsis, and none, without an ellipsis, where the ellipsis alone does not.
pub fn cut(text: &str, width: f64, font: &Font) -> (u32, bool) {
    let whole: f64 = text.chars().map(|c| font.advance(c)).sum();
    let units = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    if whole <= width {
        return (units(text.encode_utf16().count()), false);
    }
    let room = width - font.advance(ELLIPSIS);
    if room < 0.0 {
        return (0, false);
    }
    let (mut drawn, mut kept) = (0.0, 0);
    for character in text.chars() {
        drawn += font.advance(character);
        if drawn > room {
            break;
        }
        kept += character.len_utf16();
    }
    (units(kept), true)
}

/// The advance of what is drawn of `text` in `font`: its first `kept` UTF-16 code units, and the
/// ellipsis after them where `ellipsis`.
fn drawn_width(text: &str, (kept, ellipsis): (u32, bool), font: &Font) -> f64 {
    let mut units = 0;
    let glyphs: f64 = text
        .chars()
        .take_while(|character| {
            units += character.len_utf16();
            units <= kept as usize
        })
        .map(|character| font.advance(character))
        .sum();
    glyphs
        + if ellipsis {
            font.advance(ELLIPSIS)
        } else {
            0.0
        }
}

/// Lays out content of rows `rows` long, their cells in `cells` one row after another, in a node
/// `width` wide, and pushes onto `out` where each element lies, in the order of `cells`; returns
/// the node's height. Each row's columns share the width inside the padding, less the gaps
/// between them, by their weights; the padding and the gaps shrink where the width leaves no room
/// for them, so that no element reaches past the node. In a row that holds a badge, every other
/// element lies the badge's padding lower, its text on the line of the badge's (`row_offset`).
pub fn lay_out(
    cells: &[Cell],
    rows: &[u32],
    width: f32,
    fonts: &Fonts,
    out: &mut Vec<Placed>,
) -> f64 {
    let full = f64::from(width.max(0.0));
    let pad = PADDING_X.min(full / 2.0);
    let inner = full - 2.0 * pad;
    let mut top = PADDING_TOP;
    let mut stacked = 0.0;
    let mut start = 0;
    for &length in rows {
        let row = &cells[start..start + length as usize];
        start += length as usize;
        let count = row.len() as f64;
        let gap = if row.len() > 1 {
            COLUMN_GAP.min(inner / (count - 1.0))
        } else {
            0.0
        };
        let room = (inner - gap * (count - 1.0)).max(0.0);
        let badged = badged(row);
        // Weights taken relative to the largest, so that their sum cannot overflow.
        let largest = row.iter().map(|cell| cell.weight).fold(0.0, f64::max);
        let total: f64 = row.iter().map(|cell| cell.weight / largest).sum();
        let mut left = pad;
        // How deep the row's elements reach below its top, where each lies and how high it is.
        let mut reach = 0.0_f64;
        for cell in row {
            let span = room * (cell.weight / largest) / total;
            let x = place(left.min(full));
            let column = within(x, span, place(full - pad));
            let element = cell.element;
            let height = element_height(element.kind(), fonts);
            let font = fonts.of(element.role());
            let (width, (kept, ellipsis)) = match element {
                // The pill at the column's left, as wide as its text is drawn and the padding
                // either side, the text cut to the column less that padding.
                Element::Badge { text } => {
                    let room = (f64::from(column) - 2.0 * BADGE_PADDING_X).max(0.0);
                    let cut = cut(text, room, font);
                    let pill = drawn_width(text, cut, font) + 2.0 * BADGE_PADDING_X;
                    let end = place(full - pad);
                    (within(x, pill.min(f64::from(column)), end), cut)
                }
                _ => (column, cut(element.text(), f64::from(column), font)),
            };
            let offset = row_offset(element.kind(), badged);
            reach = reach.max(offset + height);
            let y = top + offset;
            out.push(if matches!(element, Element::Icon) {
                icon_square(x, y, column, height)
            } else {
                Placed {
                    x,
                    y: place(y),
                    width,
                    height: place(height),
                    kept,
                    ellipsis,
                }
            });
            left += span + gap;
        }
        top += reach;
        stacked += reach;
    }
    node_height(stacked)
}

/// The square of an icon whose column lies from `x`, `column` wide, on a line `line` high from
/// `y`: as high as the line and at most as wide as the column, at the column's left and in the
/// middle of the line, so that an icon in a column narrower than its line stays within it.
fn icon_square(x: f32, y: f64, column: f32, line: f64) -> Placed {
    let side = f64::from(column).min(line);
    Placed {
        x,
        y: place(y + (line - side) / 2.0),
        width: column.min(place(side)),
        height: place(side),
        kept: 0,
        ellipsis: false,
    }
}

/// Pushes onto `out` the pieces of the bar of a progress bar placed at `at` whose segments are
/// `fractions` long, each piece `[x, y, width, height]` relative to its node: the bar is as wide as
/// `at`, `BAR_HEIGHT` high and at most as high as `at`, in the middle of it; each segment in order
/// from its left, as long as its fraction of the bar, and then the track, the rest of the bar. A
/// segment that would pass the bar's end, as fractions summing a little past 1 make one, ends at
/// it, so that no piece reaches past the bar; the fractions are finite and not negative, which the
/// bridge checked.
pub fn bar(at: &Placed, fractions: &[f64], out: &mut Vec<[f32; 4]>) {
    let (left, width) = (f64::from(at.x), f64::from(at.width));
    let end = left + width;
    let height = BAR_HEIGHT.min(f64::from(at.height));
    let y = place(f64::from(at.y) + (f64::from(at.height) - height) / 2.0);
    let height = place(height);
    // Each boundary as the `f32` nearest it, never past the bar's end.
    let boundary = |share: f64| {
        let mut x = place(left + width * share.min(1.0));
        while f64::from(x) > end {
            x = x.next_down();
        }
        x
    };
    let mut from = at.x;
    let mut sum = 0.0;
    for &fraction in fractions {
        sum += fraction;
        let to = boundary(sum).max(from);
        out.push([
            from,
            y,
            within_f64(from, f64::from(to) - f64::from(from), end),
            height,
        ]);
        from = to;
    }
    out.push([
        from,
        y,
        within_f64(from, end - f64::from(from), end),
        height,
    ]);
}

/// The `f32` nearest `value`, stepped down where it passes `end`, so that it lies within it.
fn at_most(value: f64, end: f64) -> f32 {
    let mut x = place(value.min(end));
    while f64::from(x) > end {
        x = x.next_down();
    }
    x
}

/// Where the parts of a metric lie, relative to its node: its caption's, its value's, and its
/// trend's text's rectangle, each with how much of its text is drawn, and its trend's arrow as
/// the three points `x, y` of its triangle, none where its column is narrower than the arrow.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MetricParts {
    pub caption: Placed,
    pub value: Placed,
    pub trend: Placed,
    pub arrow: Option<[f32; 6]>,
}

/// The parts of a metric placed at `at`, its cell, that shows `caption`, `value`, and the text
/// `trend` of a trend of `direction`, in `fonts` (ADR-0013). The caption fills the cell's first
/// line, the caption's, cut to the column. On the line below it, the body's, the value lies at
/// the column's left as wide as it is drawn; the arrow, a square `ARROW_SIZE` wide and at most as
/// high as the line, in the middle of the line, `VALUE_GAP` after the value; and the trend's text
/// `ARROW_GAP` after the arrow, to the column's end. Where the column is too narrow, the trend's
/// text is cut first, to what the value, the gaps, and the arrow leave; where the value and both
/// gaps and the arrow do not fit, the trend's text shows nothing and the value is cut to the
/// column less `VALUE_GAP` and the arrow, the gap before the arrow shrinking where even that
/// leaves no room; and a column narrower than the arrow, or a line of no height, draws none.
pub fn metric_parts(
    at: &Placed,
    [caption, value, trend]: [&str; 3],
    direction: Direction,
    fonts: &Fonts,
) -> MetricParts {
    let (captions, body) = (fonts.of(Role::Caption), fonts.of(Role::Body));
    let (left, column) = (f64::from(at.x), f64::from(at.width));
    let end = left + column;
    let caption_line = captions.line_height();
    let (kept, ellipsis) = cut(caption, column, captions);
    let caption = Placed {
        height: place(caption_line),
        kept,
        ellipsis,
        ..*at
    };
    let y = f64::from(at.y) + caption_line;
    let line = body.line_height();
    // The value whole where it leaves room for both gaps and the arrow, else cut beside the arrow.
    let size = ARROW_SIZE.min(line);
    let whole = cut(value, f64::INFINITY, body);
    let fits = drawn_width(value, whole, body) + VALUE_GAP + size + ARROW_GAP <= column;
    let value_cut = if fits {
        whole
    } else {
        cut(value, (column - VALUE_GAP - size).max(0.0), body)
    };
    let value_width = drawn_width(value, value_cut, body);
    let value = Placed {
        x: at.x,
        y: place(y),
        width: within_f64(at.x, value_width, end),
        height: place(line),
        kept: value_cut.0,
        ellipsis: value_cut.1,
    };
    let arrow_x =
        (size > 0.0 && column >= size).then(|| left + (value_width + VALUE_GAP).min(column - size));
    let line_end = y + line;
    let arrow = arrow_x.map(|x| {
        let top = y + (line - size) / 2.0;
        let (bottom, middle) = (top + size, top + size / 2.0);
        let (right, apex) = (x + size, x + size / 2.0);
        let points = match direction {
            Direction::Up => [x, bottom, right, bottom, apex, top],
            Direction::Down => [x, top, right, top, apex, bottom],
            Direction::Flat => [x, top, x, bottom, right, middle],
        };
        let mut out = [0.0; 6];
        for (i, point) in points.into_iter().enumerate() {
            out[i] = at_most(point, if i % 2 == 0 { end } else { line_end });
        }
        out
    });
    let trend_left = arrow_x.map_or(end, |x| (x + size + ARROW_GAP).min(end));
    // Once the value is cut, the trend's text shows nothing, though a glyph of it might fit the
    // room the value's cut leaves.
    let (kept, ellipsis) = if fits {
        cut(trend, end - trend_left, body)
    } else {
        (0, false)
    };
    let x = at_most(trend_left, end);
    let trend = Placed {
        x,
        y: place(y),
        width: within_f64(x, end - f64::from(x), end),
        height: place(line),
        kept,
        ellipsis,
    };
    MetricParts {
        caption,
        value,
        trend,
        arrow,
    }
}

/// Whether `element` is drawn at `level` (ADR-0013): at the near level every element, at the
/// middle level the texts of role title, and at the far level none; a level keeps a subset of the
/// near level's. Which elements are kept, not where: the query lays a node out alike at every
/// level, and hands over and the hit test names only the elements kept.
pub const fn drawn_at(element: &Element, level: Level) -> bool {
    match level {
        Level::Near => true,
        Level::Middle => matches!(
            element,
            Element::Text {
                role: Role::Title,
                ..
            }
        ),
        Level::Far => false,
    }
}

/// The index of the element of `cells`, which `lay_out` placed at `placed`, drawn at `level`
/// (`drawn_at`) whose rectangle holds the point `(x, y)` relative to its node's top-left corner,
/// each rectangle taken with its left and top sides and without its right and bottom ones, so
/// that two elements that touch never both hold a point; none on the padding, in a gap, or below a
/// shorter element of its row.
pub fn element_at(
    cells: &[Cell],
    placed: &[Placed],
    x: f64,
    y: f64,
    level: Level,
) -> Option<usize> {
    cells.iter().zip(placed).position(|(cell, at)| {
        let [left, top, width, height] = [at.x, at.y, at.width, at.height].map(f64::from);
        let inside = left <= x && x < left + width && top <= y && y < top + height;
        inside && drawn_at(&cell.element, level)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fonts whose title glyphs advance by 7, body glyphs by 6, caption glyphs by 5, and whose
    /// ellipses advance by 10, 9, and 8, with lines 18, 16, and 14 high.
    fn fonts() -> Fonts {
        let font = |advance: f64, ellipsis: f64, line: f64| {
            Font::new(&[u32::from(ELLIPSIS)], &[ellipsis], advance, line).unwrap()
        };
        let mut fonts = Fonts::default();
        fonts.set(Role::Title, font(7.0, 10.0, 18.0));
        fonts.set(Role::Body, font(6.0, 9.0, 16.0));
        fonts.set(Role::Caption, font(5.0, 8.0, 14.0));
        fonts
    }

    fn text(role: Role, text: &str, weight: f64) -> Cell<'_> {
        Cell {
            weight,
            element: Element::Text { role, text },
        }
    }

    /// The kinds of the elements of `cells`.
    fn kinds<'c>(cells: &'c [Cell]) -> impl Iterator<Item = Kind> + Clone + 'c {
        cells.iter().map(|cell| cell.element.kind())
    }

    fn laid_out(cells: &[Cell], rows: &[u32], width: f32) -> (Vec<Placed>, f64) {
        let mut out = Vec::new();
        let height = lay_out(cells, rows, width, &fonts(), &mut out);
        (out, height)
    }

    /// A rectangle `[x, y, width, height]` of the reference.
    type Expected = [f64; 4];

    fn assert_near(placed: &[Placed], expected: &[Expected]) {
        assert_eq!(placed.len(), expected.len());
        for (p, e) in placed.iter().zip(expected) {
            let got = [p.x, p.y, p.width, p.height].map(f64::from);
            for (g, w) in got.iter().zip(e) {
                assert!((g - w).abs() <= 0.5, "{got:?} against {e:?}");
            }
        }
    }

    #[test]
    fn rows_of_titles_bodies_and_captions_lie_where_the_reference_puts_them() {
        // Verifies: ADR-0013, Q-4
        // A title row, a body row of columns weighted 1 and 3, and a caption row of three equal
        // columns, worked out by hand at each width: the columns share the width inside the
        // padding of 12 less gaps of 8, by weight, and the rows stack from 10 down, 18, 16, and
        // 14 high.
        let cells = [
            text(Role::Title, "", 1.0),
            text(Role::Body, "", 1.0),
            text(Role::Body, "", 3.0),
            text(Role::Caption, "", 2.0),
            text(Role::Caption, "", 2.0),
            text(Role::Caption, "", 2.0),
        ];
        let rows = [1, 2, 3];
        let cases: [(f32, [Expected; 6]); 3] = [
            (
                220.0,
                [
                    [12.0, 10.0, 196.0, 18.0],
                    [12.0, 28.0, 47.0, 16.0],
                    [67.0, 28.0, 141.0, 16.0],
                    [12.0, 44.0, 60.0, 14.0],
                    [80.0, 44.0, 60.0, 14.0],
                    [148.0, 44.0, 60.0, 14.0],
                ],
            ),
            (
                100.0,
                [
                    [12.0, 10.0, 76.0, 18.0],
                    [12.0, 28.0, 17.0, 16.0],
                    [37.0, 28.0, 51.0, 16.0],
                    [12.0, 44.0, 20.0, 14.0],
                    [40.0, 44.0, 20.0, 14.0],
                    [68.0, 44.0, 20.0, 14.0],
                ],
            ),
            // Narrower than the padding and the gaps: the padding halves the width, nothing is
            // left between, and every column is empty at the middle.
            (
                16.0,
                [
                    [8.0, 10.0, 0.0, 18.0],
                    [8.0, 28.0, 0.0, 16.0],
                    [8.0, 28.0, 0.0, 16.0],
                    [8.0, 44.0, 0.0, 14.0],
                    [8.0, 44.0, 0.0, 14.0],
                    [8.0, 44.0, 0.0, 14.0],
                ],
            ),
        ];
        for (width, expected) in cases {
            let (placed, height) = laid_out(&cells, &rows, width);
            assert_near(&placed, &expected);
            // Below the least height: the padding and the rows hold 10 + 48 + 10 = 68.
            assert_eq!(height, 68.0);
            for p in &placed {
                assert!(f64::from(p.x) + f64::from(p.width) <= f64::from(width));
            }
        }
        // At 64 wide the caption row's columns share 40 less two gaps of 8: 8 each.
        let (placed, _) = laid_out(&cells, &rows, 64.0);
        assert_near(
            &placed[3..],
            &[
                [12.0, 44.0, 8.0, 14.0],
                [28.0, 44.0, 8.0, 14.0],
                [44.0, 44.0, 8.0, 14.0],
            ],
        );
    }

    #[test]
    fn a_node_is_as_high_as_its_rows_and_padding_and_at_least_the_least_height() {
        // Verifies: ADR-0013
        let title = text(Role::Title, "a", 1.0);
        let body = text(Role::Body, "b", 1.0);
        // One title row: 10 + 18 + 10 = 38, below the least height of 64.
        assert_eq!(laid_out(&[title], &[1], 220.0).1, 64.0);
        // No rows at all.
        assert_eq!(laid_out(&[], &[], 220.0).1, 64.0);
        // Five rows: 10 + 18 + 4 * 16 + 10 = 102, a row as high as its tallest element.
        let cells = [title, body, body, body, body, text(Role::Caption, "c", 1.0)];
        let height = laid_out(&cells, &[1, 1, 1, 1, 2], 220.0).1;
        assert_eq!(height, 102.0);
        let fonts = fonts();
        let rows = [
            &cells[..1],
            &cells[1..2],
            &cells[2..3],
            &cells[3..4],
            &cells[4..],
        ];
        let sum: f64 = rows.iter().map(|row| row_height(kinds(row), &fonts)).sum();
        assert_eq!(height, PADDING_TOP + sum + PADDING_BOTTOM);
    }

    #[test]
    fn a_text_wider_than_its_column_is_cut_before_an_ellipsis_within_it() {
        // Verifies: ADR-0013
        let font = fonts();
        let title = font.of(Role::Title);
        // Ten glyphs of 7 fit in 70, not in 69: then six glyphs, 42, beside the ellipsis's 10.
        assert_eq!(cut("abcdefghij", 70.0, title), (10, false));
        assert_eq!(cut("abcdefghij", 69.0, title), (8, true));
        assert_eq!(cut("abcdefghij", 52.0, title), (6, true));
        assert_eq!(cut("abcdefghij", 51.9, title), (5, true));
        // Room for the ellipsis alone, and for not even that.
        assert_eq!(cut("abcdefghij", 10.0, title), (0, true));
        assert_eq!(cut("abcdefghij", 9.9, title), (0, false));
        // A character of two UTF-16 code units is kept or cut whole.
        assert_eq!(cut("a\u{1F600}bcdefghij", 30.0, title), (3, true));
        // Laid out in a column of 76, a title of 20 glyphs keeps 9: 63 beside the ellipsis.
        let long = text(Role::Title, "abcdefghijklmnopqrst", 1.0);
        let (placed, _) = laid_out(&[long], &[1], 100.0);
        assert_eq!((placed[0].kept, placed[0].ellipsis), (9, true));
        let drawn = 9.0 * 7.0 + 10.0;
        assert!(drawn <= f64::from(placed[0].width));
    }

    #[test]
    fn an_action_lies_and_is_cut_as_a_text_of_role_body() {
        // Verifies: ADR-0013, Q-4
        // A title row, then a row of a body text beside an action weighted 1 and 3, at 220: the
        // action takes the body's line, 16, and its column, 141 from 67.
        let action = Cell {
            weight: 3.0,
            element: Element::Action {
                text: "Details of the bet",
            },
        };
        let cells = [
            text(Role::Title, "Bet", 1.0),
            text(Role::Body, "b", 1.0),
            action,
        ];
        let (placed, height) = laid_out(&cells, &[1, 2], 220.0);
        assert_near(
            &placed,
            &[
                [12.0, 10.0, 196.0, 18.0],
                [12.0, 28.0, 47.0, 16.0],
                [67.0, 28.0, 141.0, 16.0],
            ],
        );
        assert_eq!(height, 64.0);
        // Eighteen glyphs of the body's 6 fit in 141; in 100 wide the action is cut beside the
        // body's ellipsis of 9: in 51, seven glyphs, 42.
        assert_eq!((placed[2].kept, placed[2].ellipsis), (18, false));
        let (narrow, _) = laid_out(&cells, &[1, 2], 100.0);
        assert_eq!(narrow[2].width, 51.0);
        assert_eq!((narrow[2].kept, narrow[2].ellipsis), (7, true));
    }

    fn badge(text: &str, weight: f64) -> Cell<'_> {
        Cell {
            weight,
            element: Element::Badge { text },
        }
    }

    #[test]
    fn a_badge_s_pill_hugs_its_text_within_its_column_and_its_text_is_cut_inside_the_padding() {
        // Verifies: ADR-0013, Q-4
        // A title row, then a row of a caption beside a badge weighted 1 and 3. At 220 the badge's
        // column is 141 wide from 67; its pill lies at the column's left, the text's advance, four
        // body glyphs of 6, and 8 either side wide: 40; and 22 high, the body's line of 16 and 3
        // above and below, which makes the row 22 high and the node 10 + 18 + 22 + 10 = 60, the
        // least height 64. The caption beside it lies 3 lower, on the line of the badge's text.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            text(Role::Caption, "c", 1.0),
            badge("Done", 3.0),
        ];
        let (placed, height) = laid_out(&cells, &[1, 2], 220.0);
        assert_near(
            &placed,
            &[
                [12.0, 10.0, 196.0, 18.0],
                [12.0, 31.0, 47.0, 14.0],
                [67.0, 28.0, 40.0, 22.0],
            ],
        );
        assert_eq!((placed[2].kept, placed[2].ellipsis), (4, false));
        assert_eq!(height, 64.0);
        // Three rows of badges: 10 + 3 * 22 + 10 = 86.
        let stacked = [badge("a", 1.0), badge("b", 1.0), badge("c", 1.0)];
        assert_eq!(laid_out(&stacked, &[1, 1, 1], 220.0).1, 86.0);
        assert_near(
            &laid_out(&stacked, &[1, 1, 1], 220.0).0[2..],
            &[[12.0, 54.0, 22.0, 22.0]],
        );

        // Twenty-six glyphs, 156, do not fit in 141 less 16: cut beside the body's ellipsis of 9,
        // in 125 nineteen glyphs, 114, and the pill 114 + 9 + 16 = 139, inside the column.
        let long = "abcdefghijklmnopqrstuvwxyz";
        let cells = [
            text(Role::Title, "Bet", 1.0),
            text(Role::Caption, "c", 1.0),
            badge(long, 3.0),
        ];
        let (placed, _) = laid_out(&cells, &[1, 2], 220.0);
        assert_near(&placed[2..], &[[67.0, 28.0, 139.0, 22.0]]);
        assert_eq!((placed[2].kept, placed[2].ellipsis), (19, true));
        // At 100 the column is 51 wide from 37: in 35, four glyphs and the ellipsis, 33, and the
        // pill 49.
        let (narrow, _) = laid_out(&cells, &[1, 2], 100.0);
        assert_near(&narrow[2..], &[[37.0, 28.0, 49.0, 22.0]]);
        assert_eq!((narrow[2].kept, narrow[2].ellipsis), (4, true));
        // At 40 the badge's column is 6 wide from 22, narrower than the padding: it holds no
        // text, and the pill is no wider than it.
        let (squeezed, _) = laid_out(&cells, &[1, 2], 40.0);
        assert_near(&squeezed[2..], &[[22.0, 28.0, 6.0, 22.0]]);
        assert_eq!((squeezed[2].kept, squeezed[2].ellipsis), (0, false));
        // An empty badge is its padding.
        let (empty, _) = laid_out(&[badge("", 1.0)], &[1], 220.0);
        assert_near(&empty, &[[12.0, 10.0, 16.0, 22.0]]);
    }

    #[test]
    fn the_elements_beside_a_badge_lie_on_its_text_s_line_and_a_row_without_one_is_unchanged() {
        // Verifies: ADR-0013, Q-4
        // At 220, a title row, then a row of a body, an action, and a badge, three columns of 60
        // from 12, 80, and 148, then a row of a body and an action alone. Beside the badge the
        // body and the action lie 3 below the row's top, 28, on the line of the badge's text; the
        // row is 22 high, from 28 to 50, and the row below lies from 50 unshifted. The node is
        // 10 + 18 + 22 + 16 + 10 = 76 high.
        let action = |text| Cell {
            weight: 1.0,
            element: Element::Action { text },
        };
        let cells = [
            text(Role::Title, "Bet", 1.0),
            text(Role::Body, "b", 1.0),
            action("Open"),
            badge("Done", 1.0),
            text(Role::Body, "b", 1.0),
            action("Open"),
        ];
        let (placed, height) = laid_out(&cells, &[1, 3, 2], 220.0);
        assert_near(
            &placed,
            &[
                [12.0, 10.0, 196.0, 18.0],
                [12.0, 31.0, 60.0, 16.0],
                [80.0, 31.0, 60.0, 16.0],
                [148.0, 28.0, 40.0, 22.0],
                [12.0, 50.0, 94.0, 16.0],
                [114.0, 50.0, 94.0, 16.0],
            ],
        );
        assert_eq!(height, 76.0);
        // A title beside a badge reaches 3 + 18 = 21 into its row, within the pill's 22; in a
        // title font of lines 30, 33, which the row takes: 10 + 33 + 10 = 53, the least height 64,
        // and with a second row of a title, 10 + 33 + 30 + 10 = 83.
        let mut fonts = fonts();
        let tall = Font::new(&[u32::from(ELLIPSIS)], &[10.0], 7.0, 30.0).unwrap();
        fonts.set(Role::Title, tall);
        let cells = [
            text(Role::Title, "Bet", 1.0),
            badge("Done", 1.0),
            text(Role::Title, "Next", 1.0),
        ];
        let mut out = Vec::new();
        let height = lay_out(&cells, &[2, 1], 220.0, &fonts, &mut out);
        assert_near(
            &out,
            &[
                [12.0, 13.0, 94.0, 30.0],
                [114.0, 10.0, 40.0, 22.0],
                [12.0, 43.0, 196.0, 30.0],
            ],
        );
        assert_eq!(height, 83.0);
        assert_eq!(row_height(kinds(&cells[..2]), &fonts), 33.0);
        assert_eq!(row_height(kinds(&cells[2..]), &fonts), 30.0);
    }

    #[test]
    fn rows_mixing_badges_and_texts_lay_out_inside_their_node() {
        // Verifies: ADR-0013, Q-4
        // Rows of badges beside texts of every role, in fonts of any line, at widths from none to
        // the largest: every element within the node's width and height.
        let roles = [Role::Title, Role::Body, Role::Caption];
        let mut rng = Lcg(13);
        for _ in 0..2_000 {
            let mut fonts = Fonts::default();
            for role in roles {
                let metric = |rng: &mut Lcg| [0.0, 1.0, 7.5, MAX_METRIC][rng.below(4)];
                let font = Font::new(&[], &[], metric(&mut rng), metric(&mut rng)).unwrap();
                fonts.set(role, font);
            }
            let rows: Vec<u32> = (0..rng.below(9)).map(|_| rng.below(7) as u32).collect();
            let cells: Vec<Cell> = (0..rows.iter().sum::<u32>())
                .map(|_| match rng.below(5) {
                    4 => icon(1.0),
                    3 => badge("Done", 1.0),
                    role => text(roles[role], "w", 1.0),
                })
                .collect();
            let width = [0.0, 23.0, 220.0, 1.3e36][rng.below(4)];
            let mut placed = Vec::new();
            let height = lay_out(&cells, &rows, width, &fonts, &mut placed);
            for p in &placed {
                let [x, y, w, h] = [p.x, p.y, p.width, p.height].map(f64::from);
                assert!(x + w <= f64::from(width), "{p:?} in {width}");
                assert!(y + h <= height, "{p:?} in {height}");
            }
        }
    }

    #[test]
    fn a_point_beside_a_badge_s_pill_in_its_column_hits_no_element() {
        // Verifies: ADR-0013
        // The badge "Done" at 220: its pill from (67, 28) 40 × 22, in a column 141 wide.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            text(Role::Caption, "c", 1.0),
            badge("Done", 3.0),
        ];
        let (placed, _) = laid_out(&cells, &[1, 2], 220.0);
        let at = |x, y| element_at(&cells, &placed, x, y, Level::Near);
        assert_eq!(at(67.0, 28.0), Some(2));
        assert_eq!(at(106.9, 49.9), Some(2));
        assert_eq!(at(107.0, 35.0), None);
        assert_eq!(at(180.0, 35.0), None);
        // The caption's cell, 3 below its row's top, ends at its line, 14 high, though its row
        // is 22: from 31 to 45.
        assert_eq!(at(20.0, 30.0), None);
        assert_eq!(at(20.0, 31.0), Some(1));
        assert_eq!(at(20.0, 44.9), Some(1));
        assert_eq!(at(20.0, 45.0), None);
        // At the middle level no badge is hit.
        assert_eq!(element_at(&cells, &placed, 80.0, 35.0, Level::Middle), None);
    }

    #[test]
    fn every_level_draws_a_subset_of_the_near_levels_elements_and_the_far_level_none() {
        // Verifies: ADR-0013
        let roles = [Role::Title, Role::Body, Role::Caption];
        let texts = roles.map(|role| Element::Text { role, text: "t" });
        let others = [
            Element::Icon,
            Element::Action { text: "a" },
            Element::Badge { text: "b" },
            Element::Progress,
            Element::Metric {
                caption: "c",
                value: "v",
                trend: "t",
            },
        ];
        for element in texts.iter().chain(&others) {
            assert!(drawn_at(element, Level::Near), "{element:?}");
            assert!(!drawn_at(element, Level::Far), "{element:?}");
            let middle = drawn_at(element, Level::Middle);
            assert!(!middle || drawn_at(element, Level::Near), "{element:?}");
            assert_eq!(middle, *element == texts[0], "{element:?}");
        }
    }

    #[test]
    fn any_badge_lays_out_inside_its_column() {
        // Verifies: ADR-0013, Q-4
        const WIDTHS: [f32; 7] = [0.0, 1.0, 16.0, 23.0, 220.0, 1e6, 1.3e36];
        let texts = ["", "x", &"w".repeat(1_000), &"\u{1F600}".repeat(500)];
        let mut rng = Lcg(11);
        for _ in 0..2_000 {
            let mut fonts = Fonts::default();
            let metric = |rng: &mut Lcg| [0.0, 1.0, 7.5, MAX_METRIC][rng.below(4)];
            let font = Font::new(&[], &[], metric(&mut rng), metric(&mut rng)).unwrap();
            fonts.set(Role::Body, font);
            let columns = 1 + rng.below(6);
            let cells: Vec<Cell> = (0..columns)
                .map(|_| badge(texts[rng.below(texts.len())], [0.5, 1.0, 3.0][rng.below(3)]))
                .collect();
            let width = WIDTHS[rng.below(WIDTHS.len())];
            // The same row of texts gives each column, which the pill stays within.
            let columns_of: Vec<Cell> = cells
                .iter()
                .map(|cell| text(Role::Body, "", cell.weight))
                .collect();
            let rows = [cells.len() as u32];
            let mut placed = Vec::new();
            let mut column = Vec::new();
            lay_out(&cells, &rows, width, &fonts, &mut placed);
            lay_out(&columns_of, &rows, width, &fonts, &mut column);
            for (pill, column) in placed.iter().zip(&column) {
                assert_eq!(pill.x, column.x);
                assert!(
                    pill.width >= 0.0 && pill.width <= column.width,
                    "{pill:?} {column:?}"
                );
                let line = fonts.of(Role::Body).line_height();
                assert_eq!(pill.height, place(line + 2.0 * BADGE_PADDING_Y));
            }
        }
    }

    fn progress(weight: f64) -> Cell<'static> {
        Cell {
            weight,
            element: Element::Progress,
        }
    }

    /// The pieces of the bar of the progress bar placed at `at` with segments of `fractions`.
    fn pieces(at: &Placed, fractions: &[f64]) -> Vec<[f32; 4]> {
        let mut out = Vec::new();
        bar(at, fractions, &mut out);
        out
    }

    /// Asserts that `pieces` match `expected` within 0.5, in order.
    fn assert_pieces(pieces: &[[f32; 4]], expected: &[Expected]) {
        assert_eq!(pieces.len(), expected.len(), "{pieces:?}");
        for (piece, e) in pieces.iter().zip(expected) {
            let got = piece.map(f64::from);
            for (g, w) in got.iter().zip(e) {
                assert!((g - w).abs() <= 0.5, "{got:?} against {e:?}");
            }
        }
    }

    #[test]
    fn a_progress_bar_s_segments_lie_in_order_from_its_column_s_left_and_its_track_after_them() {
        // Verifies: ADR-0013, Q-4
        // At 220, a title row, then a progress bar alone in its row: its cell the column from 12,
        // 196 wide, and a body's line of 16 from 28; its bar 8 high in the middle of it, from 32.
        // Segments of 0.3 and 0.2 are 58.8 and 39.2 long from the column's left, and the track
        // the rest, 98. The row is 16 high: 10 + 18 + 16 + 10 = 54, the least height 64.
        let cells = [text(Role::Title, "Bet", 1.0), progress(1.0)];
        let (placed, height) = laid_out(&cells, &[1, 1], 220.0);
        assert_near(&placed[1..], &[[12.0, 28.0, 196.0, 16.0]]);
        assert_eq!((placed[1].kept, placed[1].ellipsis), (0, false));
        assert_eq!(height, 64.0);
        assert_pieces(
            &pieces(&placed[1], &[0.3, 0.2]),
            &[
                [12.0, 32.0, 58.8, 8.0],
                [70.8, 32.0, 39.2, 8.0],
                [110.0, 32.0, 98.0, 8.0],
            ],
        );
        // Beside a caption, weighted 3 to its 1, the bar's column lies from 67, 141 wide: the
        // segments 42.3 and 28.2 long from there.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            text(Role::Caption, "c", 1.0),
            progress(3.0),
        ];
        let (placed, _) = laid_out(&cells, &[1, 2], 220.0);
        assert_near(&placed[2..], &[[67.0, 28.0, 141.0, 16.0]]);
        assert_pieces(
            &pieces(&placed[2], &[0.3, 0.2]),
            &[
                [67.0, 32.0, 42.3, 8.0],
                [109.3, 32.0, 28.2, 8.0],
                [137.5, 32.0, 70.5, 8.0],
            ],
        );
        // A bar of no segments is its track; one whose segments sum to 1, no track to speak of.
        assert_pieces(&pieces(&placed[2], &[]), &[[67.0, 32.0, 141.0, 8.0]]);
        assert_pieces(
            &pieces(&placed[2], &[0.5, 0.5]),
            &[
                [67.0, 32.0, 70.5, 8.0],
                [137.5, 32.0, 70.5, 8.0],
                [208.0, 32.0, 0.0, 8.0],
            ],
        );
        // Beside a badge the bar's line lies 3 lower, as every element but the badge does.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            badge("Done", 1.0),
            progress(1.0),
        ];
        let (placed, _) = laid_out(&cells, &[1, 2], 220.0);
        assert_near(&placed[2..], &[[114.0, 31.0, 94.0, 16.0]]);
        assert_pieces(
            &pieces(&placed[2], &[1.0]),
            &[[114.0, 35.0, 94.0, 8.0], [208.0, 35.0, 0.0, 8.0]],
        );
    }

    #[test]
    fn a_bar_never_reaches_past_its_column_and_is_no_higher_than_its_line() {
        // Verifies: ADR-0013, Q-4
        // Fractions that sum a little past 1, as the bridge admits them, or far past it: the
        // segment that would pass the bar's end ends at it, and every one after it is empty.
        let at = Placed {
            x: 12.0,
            y: 28.0,
            width: 196.0,
            height: 16.0,
            kept: 0,
            ellipsis: false,
        };
        let past = pieces(&at, &[0.6, 0.4 + 1e-9]);
        assert_eq!(past[1][0] + past[1][2], 208.0);
        assert_eq!(past[2][2], 0.0);
        assert_pieces(
            &pieces(&at, &[0.7, 0.5, 0.2]),
            &[
                [12.0, 32.0, 137.2, 8.0],
                [149.2, 32.0, 58.8, 8.0],
                [208.0, 32.0, 0.0, 8.0],
                [208.0, 32.0, 0.0, 8.0],
            ],
        );
        // In a line lower than the bar, the bar is as high as the line.
        let low = Placed { height: 6.0, ..at };
        assert_pieces(
            &pieces(&low, &[0.5]),
            &[[12.0, 28.0, 98.0, 6.0], [110.0, 28.0, 98.0, 6.0]],
        );
        // Any fractions the bridge admits, and some it refuses, at any width: the pieces abut in
        // order from the bar's left, and none reaches past its end.
        let mut rng = Lcg(17);
        for _ in 0..5_000 {
            let width = [0.0, 1.0, 23.0, 196.0, 1e6, 1.3e36][rng.below(6)];
            let at = Placed {
                x: [0.0, 12.0, 1e5][rng.below(3)],
                width,
                ..at
            };
            let fractions: Vec<f64> = (0..rng.below(9))
                .map(|_| [0.0, 1e-9, 0.1, 0.3, rng.next(), 1.0][rng.below(6)])
                .collect();
            let out = pieces(&at, &fractions);
            assert_eq!(out.len(), fractions.len() + 1);
            let end = f64::from(at.x) + f64::from(at.width);
            // Each piece from where the one before it ends, as `f32` rounds its width.
            let mut from = f64::from(at.x);
            for piece in &out {
                let [x, _, w, _] = piece.map(f64::from);
                assert!((x - from).abs() <= from.abs() * 1e-6, "{out:?}");
                assert!(w >= 0.0 && x + w <= end, "{out:?}");
                assert_eq!([piece[1], piece[3]], [32.0, 8.0]);
                from = x + w;
            }
        }
    }

    #[test]
    fn a_progress_bar_is_hit_across_its_line_in_its_column_and_not_at_the_middle_level() {
        // Verifies: ADR-0013
        // The bar of the reference at 220: its cell from (12, 28), 196 × 16, its bar 8 high in
        // the middle of it; a press anywhere in the cell hits it, above or below the bar too.
        let cells = [text(Role::Title, "Bet", 1.0), progress(1.0)];
        let (placed, _) = laid_out(&cells, &[1, 1], 220.0);
        let at = |x, y| element_at(&cells, &placed, x, y, Level::Near);
        assert_eq!(at(12.0, 28.0), Some(1));
        assert_eq!(at(200.0, 30.0), Some(1));
        assert_eq!(at(207.9, 43.9), Some(1));
        assert_eq!(at(208.0, 35.0), None);
        assert_eq!(at(100.0, 44.0), None);
        assert_eq!(
            element_at(&cells, &placed, 100.0, 35.0, Level::Middle),
            None
        );
    }

    fn metric(caption: &'static str, value: &'static str, trend: &'static str) -> Cell<'static> {
        Cell {
            weight: 1.0,
            element: Element::Metric {
                caption,
                value,
                trend,
            },
        }
    }

    /// The parts of the metric `cell` placed at `at`, its trend of `direction`.
    fn parts(at: &Placed, cell: &Cell, direction: Direction) -> MetricParts {
        let Element::Metric {
            caption,
            value,
            trend,
        } = cell.element
        else {
            panic!("no metric: {cell:?}");
        };
        metric_parts(at, [caption, value, trend], direction, &fonts())
    }

    /// The rectangles of the caption, the value, and the trend's text of `parts`.
    fn texts_of(parts: &MetricParts) -> [Placed; 3] {
        [parts.caption, parts.value, parts.trend]
    }

    /// How much of each text of `parts` is drawn: its code units kept, and whether an ellipsis
    /// follows them.
    fn kept_of(parts: &MetricParts) -> [(u32, bool); 3] {
        texts_of(parts).map(|p| (p.kept, p.ellipsis))
    }

    /// Asserts that `arrow` holds the points `expected` within 0.5.
    fn assert_arrow(arrow: Option<[f32; 6]>, expected: [f64; 6]) {
        let arrow = arrow.expect("an arrow").map(f64::from);
        let near = arrow
            .iter()
            .zip(expected)
            .all(|(g, w)| (g - w).abs() <= 0.5);
        assert!(near, "{arrow:?} against {expected:?}");
    }

    #[test]
    fn a_metric_s_caption_value_and_trend_lie_where_the_reference_puts_them() {
        // Verifies: ADR-0013, Q-4
        // At 220, a title row, then a metric alone in its row: its cell the column from 12, 196
        // wide, from 28 down, 30 high, the caption's line of 14 and the body's of 16 below it;
        // the node 10 + 18 + 30 + 10 = 68. The caption fills its line, 35 of it drawn; the value
        // "42", two body glyphs of 6, lies from 12 at 42, 12 wide; the arrow 8 after it from 32,
        // a square of 10 in the middle of the value's line, 45 to 55; and the trend's text 4
        // after the arrow, from 46 to the column's end, 162.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            metric("Revenue", "42", "+3%"),
        ];
        let (placed, height) = laid_out(&cells, &[1, 1], 220.0);
        assert_near(&placed[1..], &[[12.0, 28.0, 196.0, 30.0]]);
        assert_eq!(height, 68.0);
        let up = parts(&placed[1], &cells[1], Direction::Up);
        assert_near(
            &texts_of(&up),
            &[
                [12.0, 28.0, 196.0, 14.0],
                [12.0, 42.0, 12.0, 16.0],
                [46.0, 42.0, 162.0, 16.0],
            ],
        );
        assert_eq!(kept_of(&up), [(7, false), (2, false), (3, false)]);
        // Each direction the same triangle turned in that square: up its base below, down its base
        // above, flat its base at the left, each apex the middle of the side opposite.
        assert_arrow(up.arrow, [32.0, 55.0, 42.0, 55.0, 37.0, 45.0]);
        let down = parts(&placed[1], &cells[1], Direction::Down);
        assert_arrow(down.arrow, [32.0, 45.0, 42.0, 45.0, 37.0, 55.0]);
        let flat = parts(&placed[1], &cells[1], Direction::Flat);
        assert_arrow(flat.arrow, [32.0, 45.0, 32.0, 55.0, 42.0, 50.0]);
        assert_eq!(
            (texts_of(&down), texts_of(&flat)),
            (texts_of(&up), texts_of(&up))
        );

        // At 100 the column is 76 wide, to 88: the value "1234", 24, leaves the trend's text 30
        // from 58, in which "+3.5% wk", 48, is cut beside the body's ellipsis of 9 to three glyphs.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            metric("Revenue", "1234", "+3.5% wk"),
        ];
        let (placed, _) = laid_out(&cells, &[1, 1], 100.0);
        let cut_trend = parts(&placed[1], &cells[1], Direction::Up);
        assert_near(
            &texts_of(&cut_trend)[1..],
            &[[12.0, 42.0, 24.0, 16.0], [58.0, 42.0, 30.0, 16.0]],
        );
        assert_eq!(kept_of(&cut_trend)[1..], [(4, false), (3, true)]);
        assert_arrow(cut_trend.arrow, [44.0, 55.0, 54.0, 55.0, 49.0, 45.0]);
        // At 60 the column is 36 wide, to 48: the value and both gaps and the arrow, 46, do not
        // fit, so the trend's text is cut to nothing and the value to 36 less 18, one glyph and
        // the ellipsis, 15; the arrow 8 after it, from 35 to 45.
        let (placed, _) = laid_out(&cells, &[1, 1], 60.0);
        let cut_value = parts(&placed[1], &cells[1], Direction::Up);
        assert_near(
            &texts_of(&cut_value),
            &[
                [12.0, 28.0, 36.0, 14.0],
                [12.0, 42.0, 15.0, 16.0],
                [48.0, 42.0, 0.0, 16.0],
            ],
        );
        assert_eq!(kept_of(&cut_value), [(7, false), (1, true), (0, false)]);
        assert_arrow(cut_value.arrow, [35.0, 55.0, 45.0, 55.0, 40.0, 45.0]);
        // At 36 the column is 12 wide, to 24: no value, and the gap before the arrow shrinks to 2,
        // so that the arrow ends at the column's end.
        let (placed, _) = laid_out(&cells, &[1, 1], 36.0);
        let squeezed = parts(&placed[1], &cells[1], Direction::Up);
        assert_eq!(kept_of(&squeezed)[1..], [(0, false), (0, false)]);
        assert_arrow(squeezed.arrow, [14.0, 55.0, 24.0, 55.0, 19.0, 45.0]);
        // At 32 the column is 8 wide, narrower than the arrow: none is drawn.
        let (placed, _) = laid_out(&cells, &[1, 1], 32.0);
        assert_eq!(parts(&placed[1], &cells[1], Direction::Up).arrow, None);
    }

    #[test]
    fn a_metric_s_row_holds_its_two_lines_and_the_rows_rules_place_it() {
        // Verifies: ADR-0013, Q-4
        // Beside a body text, both weighted 1, at 220: two columns of 94 from 12 and 114; the
        // text at the row's top, the metric from there too, and the row 30 high, the metric's.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            text(Role::Body, "Q3", 1.0),
            metric("Revenue", "42", "+3%"),
        ];
        let (placed, height) = laid_out(&cells, &[1, 2], 220.0);
        assert_near(
            &placed[1..],
            &[[12.0, 28.0, 94.0, 16.0], [114.0, 28.0, 94.0, 30.0]],
        );
        assert_eq!(height, 68.0);
        // Beside a badge, it lies 3 lower, as every element but a badge does, its caption on the
        // line of the badge's text, and the row 33 high: the node 10 + 18 + 33 + 10 = 71.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            badge("Done", 1.0),
            metric("Revenue", "42", "+3%"),
        ];
        let (placed, height) = laid_out(&cells, &[1, 2], 220.0);
        assert_near(&placed[2..], &[[114.0, 31.0, 94.0, 30.0]]);
        assert_eq!(height, 71.0);
        // Three metrics side by side, values over three periods, share one top and one height.
        let cells = [
            metric("Q1", "1", "+1%"),
            metric("Q2", "2", "0%"),
            metric("Q3", "3", "-1%"),
        ];
        let (placed, height) = laid_out(&cells, &[3], 220.0);
        assert!(
            placed.iter().all(|p| p.y == 10.0 && p.height == 30.0),
            "{placed:?}"
        );
        assert_eq!(height, 64.0);
    }

    #[test]
    fn a_metric_is_hit_across_its_two_lines_and_not_at_the_middle_level() {
        // Verifies: ADR-0013
        // The metric of the reference at 220: its cell from (12, 28), 196 × 30; a press on its
        // caption, beside its value, or on its trend hits it, and below the cell none.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            metric("Revenue", "42", "+3%"),
        ];
        let (placed, _) = laid_out(&cells, &[1, 1], 220.0);
        let at = |x, y| element_at(&cells, &placed, x, y, Level::Near);
        assert_eq!(at(150.0, 30.0), Some(1));
        assert_eq!(at(28.0, 50.0), Some(1));
        assert_eq!(at(207.9, 57.9), Some(1));
        assert_eq!(at(100.0, 58.0), None);
        assert_eq!(
            element_at(&cells, &placed, 100.0, 40.0, Level::Middle),
            None
        );
    }

    /// The fonts of `fonts`, but a body whose `W` advances by 11, `-` by 4, the ellipsis by 9, and
    /// every other glyph by 6, with lines `line` high.
    fn uneven_body(line: f64) -> Fonts {
        let mut fonts = fonts();
        let codes = ['W', '-', ELLIPSIS].map(u32::from);
        fonts.set(
            Role::Body,
            Font::new(&codes, &[11.0, 4.0, 9.0], 6.0, line).unwrap(),
        );
        fonts
    }

    #[test]
    fn a_metric_whose_value_is_cut_shows_none_of_its_trend_s_text_though_a_glyph_would_fit() {
        // Verifies: ADR-0013, Q-4
        // A metric alone in a column of 46 from (12, 10): its value "WWWWWW", 66, does not fit with
        // both gaps and the arrow, so it is cut to 46 less 18, beside the ellipsis of 9 to one W,
        // 20 wide; the arrow 8 after it from 40 to 50, 3 below the value's line at 24; and the
        // trend's text from 54, 4 to the column's end at 58. Its "-", 4, would fit there, but a
        // trend is cut before its value: it shows nothing. Likewise in a column of 48, 6 left.
        let fonts = uneven_body(16.0);
        for (width, room) in [(70.0, 4.0), (72.0, 6.0)] {
            let cells = [metric("Cap", "WWWWWW", "-")];
            let mut placed = Vec::new();
            lay_out(&cells, &[1], width, &fonts, &mut placed);
            let parts = metric_parts(&placed[0], ["Cap", "WWWWWW", "-"], Direction::Up, &fonts);
            assert_near(
                &[parts.value, parts.trend],
                &[[12.0, 24.0, 20.0, 16.0], [54.0, 24.0, room, 16.0]],
            );
            assert_eq!(kept_of(&parts)[1..], [(1, true), (0, false)]);
            assert_arrow(parts.arrow, [40.0, 37.0, 50.0, 37.0, 45.0, 27.0]);
        }
    }

    #[test]
    fn an_arrow_is_no_higher_than_the_value_s_line() {
        // Verifies: ADR-0013, Q-4
        // With a body's line of 6, the arrow's square is 6 too, in the line from 24 to 30: its
        // value "42", 12, from 12, the arrow 8 after it from 32 to 38, and the trend's text 4
        // after it from 42. With a line of no height, no arrow is drawn.
        let fonts = uneven_body(6.0);
        let cells = [metric("Cap", "42", "+3%")];
        let mut placed = Vec::new();
        lay_out(&cells, &[1], 220.0, &fonts, &mut placed);
        let parts = metric_parts(&placed[0], ["Cap", "42", "+3%"], Direction::Down, &fonts);
        assert_arrow(parts.arrow, [32.0, 24.0, 38.0, 24.0, 35.0, 30.0]);
        assert_near(&[parts.trend], &[[42.0, 24.0, 166.0, 6.0]]);
        let flat = uneven_body(0.0);
        placed.clear();
        lay_out(&cells, &[1], 220.0, &flat, &mut placed);
        let parts = metric_parts(&placed[0], ["Cap", "42", "+3%"], Direction::Down, &flat);
        assert_eq!(parts.arrow, None);
    }

    /// Asserts that the parts of the metric `parts`, placed at `at` and showing `value` in a body's
    /// line `line` high, lie inside its cell, the arrow in the value's line, without overlapping,
    /// and that a value cut leaves the trend's text nothing.
    fn assert_parts_inside(at: &Placed, parts: &MetricParts, value: &str, line: f64) {
        let [left, top, width, height] = [at.x, at.y, at.width, at.height].map(f64::from);
        let (end, bottom) = (left + width, top + height);
        let tolerance = 1e-6 * (end.abs() + 1.0);
        for p in [parts.caption, parts.value, parts.trend] {
            let [x, y, w, h] = [p.x, p.y, p.width, p.height].map(f64::from);
            assert!(
                [x, y, w, h].iter().all(|v| v.is_finite() && *v >= 0.0),
                "{p:?}"
            );
            assert!(x >= left && x + w <= end, "{p:?} in {at:?}");
            assert!(y >= top && y + h <= bottom, "{p:?} in {at:?}");
        }
        let units = value.encode_utf16().count();
        if parts.value.ellipsis || (parts.value.kept as usize) < units {
            assert_eq!(kept_of(parts)[2], (0, false), "{parts:?}");
        }
        let size = ARROW_SIZE.min(line);
        assert_eq!(
            parts.arrow.is_some(),
            size > 0.0 && width >= size,
            "{parts:?}"
        );
        let Some(arrow) = parts.arrow else {
            return;
        };
        let [line_top, line_bottom] = [parts.value.y, parts.value.y + parts.value.height];
        for (i, &v) in arrow.iter().enumerate() {
            let inside = if i % 2 == 0 {
                v >= at.x && f64::from(v) <= end
            } else {
                v >= line_top && v <= line_bottom
            };
            assert!(inside, "{arrow:?} in {at:?}");
        }
        let arrow_left = f64::from(arrow[0].min(arrow[2]).min(arrow[4]));
        let arrow_right = f64::from(arrow[0].max(arrow[2]).max(arrow[4]));
        let value_right = f64::from(parts.value.x) + f64::from(parts.value.width);
        assert!(value_right <= arrow_left + tolerance, "{parts:?}");
        if f64::from(parts.value.width) + VALUE_GAP + size <= width {
            assert!(
                value_right + VALUE_GAP <= arrow_left + tolerance,
                "{parts:?}"
            );
        }
        assert!(
            arrow_right <= f64::from(parts.trend.x) + tolerance,
            "{parts:?}"
        );
    }

    #[test]
    fn any_metric_s_parts_lie_inside_its_column_and_its_node() {
        // Verifies: ADR-0013, Q-4
        // Metrics of any texts, at any width, in fonts of any metric, glyphs of the body's of
        // uneven advances among them: every part lies inside the metric's cell, the arrow in the
        // value's line, drawn only where the column holds it, the parts in order without
        // overlapping, and a value cut leaves the trend's text nothing.
        const WIDTHS: [f32; 9] = [0.0, 1.0, 8.0, 23.0, 36.0, 46.0, 60.0, 220.0, 1e6];
        let texts = [
            "",
            "x",
            "-",
            "1234",
            "WWWWWW",
            "W-W-",
            &"w".repeat(1_000),
            &"\u{1F600}".repeat(500),
        ];
        let directions = [Direction::Up, Direction::Down, Direction::Flat];
        let codes = ['W', '-', ELLIPSIS].map(u32::from);
        let mut rng = Lcg(11);
        let (mut arrows, mut cut_values) = (0, 0);
        for _ in 0..5_000 {
            let mut fonts = Fonts::default();
            for role in [Role::Title, Role::Body, Role::Caption] {
                let metric =
                    |rng: &mut Lcg| [0.0, 1.0, 4.0, 7.5, 11.0, 30.0, MAX_METRIC][rng.below(7)];
                let advances = [metric(&mut rng), metric(&mut rng), metric(&mut rng)];
                let line = [0.0, 6.0, 9.5, 16.0, 30.0, MAX_METRIC][rng.below(6)];
                let font = Font::new(&codes, &advances, metric(&mut rng), line).unwrap();
                fonts.set(role, font);
            }
            let pick = |rng: &mut Lcg| texts[rng.below(texts.len())];
            let strings = [pick(&mut rng), pick(&mut rng), pick(&mut rng)];
            let cells = [Cell {
                weight: 1.0,
                element: Element::Metric {
                    caption: strings[0],
                    value: strings[1],
                    trend: strings[2],
                },
            }];
            let width = WIDTHS[rng.below(WIDTHS.len())];
            let mut placed = Vec::new();
            lay_out(&cells, &[1], width, &fonts, &mut placed);
            let direction = directions[rng.below(3)];
            let parts = metric_parts(&placed[0], strings, direction, &fonts);
            assert_parts_inside(
                &placed[0],
                &parts,
                strings[1],
                fonts.of(Role::Body).line_height(),
            );
            arrows += usize::from(parts.arrow.is_some());
            cut_values += usize::from(parts.value.ellipsis);
        }
        assert!(arrows > 100 && cut_values > 100, "{arrows} {cut_values}");
    }

    fn icon(weight: f64) -> Cell<'static> {
        Cell {
            weight,
            element: Element::Icon,
        }
    }

    #[test]
    fn an_icon_is_a_square_of_the_body_s_line_at_its_column_s_left() {
        // Verifies: ADR-0013, Q-4
        // At 220, a row of an icon beside a title weighted 1 and 3, columns of 47 from 12 and 141
        // from 67: the icon's square lies at its column's left, as high and as wide as the body's
        // line, 16, at the row's top; the row is the title's 18 high. Below it a badge beside an
        // icon, columns of 94 from 12 and 114: the icon lies 3 lower, as every element beside a
        // badge does, and the row is the pill's 22. The node is 10 + 18 + 22 + 10 = 60, the least
        // height 64.
        let cells = [
            icon(1.0),
            text(Role::Title, "Bet", 3.0),
            badge("Done", 1.0),
            icon(1.0),
        ];
        let (placed, height) = laid_out(&cells, &[2, 2], 220.0);
        assert_near(
            &placed,
            &[
                [12.0, 10.0, 16.0, 16.0],
                [67.0, 10.0, 141.0, 18.0],
                [12.0, 28.0, 40.0, 22.0],
                [114.0, 31.0, 16.0, 16.0],
            ],
        );
        assert_eq!((placed[0].kept, placed[0].ellipsis), (0, false));
        assert_eq!(height, 64.0);
        // An icon alone in a row makes it the body's line high: 10 + 16 * 8 + 10 = 148.
        let stacked = [icon(1.0); 8];
        assert_eq!(laid_out(&stacked, &[1; 8], 220.0).1, 148.0);
        // At 40 its column is 16 wide, the square whole; at 30 it is 6 wide from 12, and the
        // square 6 on a side, in the middle of the line: from 10 + 5.
        assert_near(
            &laid_out(&[icon(1.0)], &[1], 40.0).0,
            &[[12.0, 10.0, 16.0, 16.0]],
        );
        assert_near(
            &laid_out(&[icon(1.0)], &[1], 30.0).0,
            &[[12.0, 15.0, 6.0, 6.0]],
        );
        // A column of no width holds a square of none.
        assert_near(
            &laid_out(&[icon(1.0)], &[1], 0.0).0,
            &[[0.0, 18.0, 0.0, 0.0]],
        );
    }

    #[test]
    fn an_icon_is_hit_on_its_square_and_not_beside_it_nor_at_the_middle_level() {
        // Verifies: ADR-0013
        // An icon alone in a column 196 wide at 220: its square from (12, 10), 16 × 16.
        let cells = [icon(1.0), text(Role::Body, "b", 1.0)];
        let (placed, _) = laid_out(&cells, &[1, 1], 220.0);
        let at = |x, y| element_at(&cells, &placed, x, y, Level::Near);
        assert_eq!(at(12.0, 10.0), Some(0));
        assert_eq!(at(27.9, 25.9), Some(0));
        // Beside the square in its column, and below it, no element.
        assert_eq!(at(28.0, 15.0), None);
        assert_eq!(at(150.0, 15.0), None);
        assert_eq!(at(20.0, 26.0), Some(1));
        // At the middle level no icon is hit.
        assert_eq!(element_at(&cells, &placed, 20.0, 15.0, Level::Middle), None);
    }

    #[test]
    fn any_icon_lies_inside_its_column_and_its_line() {
        // Verifies: ADR-0013, Q-4
        const WIDTHS: [f32; 7] = [0.0, 1.0, 16.0, 23.0, 220.0, 1e6, 1.3e36];
        let mut rng = Lcg(17);
        for _ in 0..2_000 {
            let mut fonts = Fonts::default();
            let metric = |rng: &mut Lcg| [0.0, 1.0, 7.5, 16.0, MAX_METRIC][rng.below(5)];
            let font = Font::new(&[], &[], metric(&mut rng), metric(&mut rng)).unwrap();
            fonts.set(Role::Body, font);
            let columns = 1 + rng.below(6);
            let cells: Vec<Cell> = (0..columns)
                .map(|_| icon([0.5, 1.0, 3.0][rng.below(3)]))
                .collect();
            let width = WIDTHS[rng.below(WIDTHS.len())];
            // The same row of texts gives each column and its line, which the square stays within.
            let columns_of: Vec<Cell> = cells
                .iter()
                .map(|cell| text(Role::Body, "", cell.weight))
                .collect();
            let rows = [cells.len() as u32];
            let mut placed = Vec::new();
            let mut column = Vec::new();
            lay_out(&cells, &rows, width, &fonts, &mut placed);
            lay_out(&columns_of, &rows, width, &fonts, &mut column);
            for (square, column) in placed.iter().zip(&column) {
                assert_eq!(square.x, column.x);
                assert_eq!(square.width, square.height, "{square:?}");
                assert!(square.width <= column.width, "{square:?} {column:?}");
                assert!(square.y >= column.y, "{square:?} {column:?}");
                let (bottom, line) = (square.y + square.height, column.y + column.height);
                assert!(bottom <= line, "{square:?} {column:?}");
            }
        }
    }

    #[test]
    fn a_point_hits_the_element_whose_rectangle_holds_it_and_none_between() {
        // Verifies: ADR-0013
        // The cells of the test above at 220: a title at (12, 10) 196 × 18, a body at (12, 28)
        // 47 × 16, and an action at (67, 28) 141 × 16, in a node 64 high.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            text(Role::Body, "b", 1.0),
            Cell {
                weight: 3.0,
                element: Element::Action { text: "Details" },
            },
        ];
        let (placed, _) = laid_out(&cells, &[1, 2], 220.0);
        let at = |x, y| element_at(&cells, &placed, x, y, Level::Near);
        assert_eq!(at(12.0, 10.0), Some(0));
        assert_eq!(at(207.9, 27.9), Some(0));
        // The title's bottom is the body's top: the point is the row below's.
        assert_eq!(at(20.0, 28.0), Some(1));
        assert_eq!(at(100.0, 35.0), Some(2));
        // The padding left and right, above the first row and below the last, and the gap of 8
        // between the body and the action.
        for (x, y) in [
            (5.0, 20.0),
            (214.0, 20.0),
            (100.0, 5.0),
            (100.0, 50.0),
            (63.0, 35.0),
        ] {
            assert_eq!(at(x, y), None, "({x}, {y})");
        }
        // At the middle level only the title is hit, where it is drawn.
        assert_eq!(
            element_at(&cells, &placed, 100.0, 15.0, Level::Middle),
            Some(0)
        );
        assert_eq!(
            element_at(&cells, &placed, 100.0, 35.0, Level::Middle),
            None
        );
        assert_eq!(element_at(&cells, &placed, 20.0, 35.0, Level::Middle), None);
        // A column with no width holds no point.
        let (squeezed, _) = laid_out(&cells, &[1, 2], 16.0);
        assert_eq!(element_at(&cells, &squeezed, 8.0, 35.0, Level::Near), None);
    }

    #[test]
    fn a_font_refuses_metrics_that_are_not_finite_or_do_not_pair_up() {
        assert_eq!(Font::new(&[65], &[], 1.0, 1.0), Err(FontError::Unpaired));
        for bad in [f64::NAN, f64::INFINITY, -1.0, MAX_METRIC * 2.0] {
            assert_eq!(Font::new(&[65], &[bad], 1.0, 1.0), Err(FontError::Metric));
            assert_eq!(Font::new(&[], &[], bad, 1.0), Err(FontError::Metric));
            assert_eq!(Font::new(&[], &[], 1.0, bad), Err(FontError::Metric));
        }
        let font = Font::new(&[65, 0x1F600, 0x1F600], &[3.0, 5.0, 6.0], 2.0, 1.0).unwrap();
        assert_eq!(font.advance('A'), 3.0);
        assert_eq!(font.advance('\u{1F600}'), 5.0);
        assert_eq!(font.advance('B'), 2.0);
        assert_eq!(font.advance('\u{1F601}'), 2.0);
    }

    #[test]
    fn a_node_s_height_from_its_kinds_is_the_height_its_content_lays_out_to() {
        // Verifies: ADR-0013
        // Random content of every kind and role, in fonts of any line, at any width: the height of
        // its rows' kinds alone is exactly the height `lay_out` returns, which stacks its rows by
        // where it places their elements. Lines too small or too inexact for `f64` to sum exactly
        // make the order in which the rows are summed count too.
        const METRICS: [f64; 9] = [0.0, 1e-30, 1e-7, 0.1, 1.0, 7.5, 13.3, 1023.3, MAX_METRIC];
        const WEIGHTS: [f64; 4] = [1.0, 0.25, 3.0, 1e300];
        const WIDTHS: [f32; 5] = [0.0, 23.0, 220.0, 1e6, 1.3e36];
        let roles = [Role::Title, Role::Body, Role::Caption];
        let texts = ["", "Done", &"w".repeat(100)];
        let mut rng = Lcg(19);
        let mut badged_rows = 0;
        for _ in 0..5_000 {
            let mut fonts = Fonts::default();
            for role in roles {
                let metric = |rng: &mut Lcg| METRICS[rng.below(METRICS.len())];
                let font = Font::new(&[], &[], metric(&mut rng), metric(&mut rng)).unwrap();
                fonts.set(role, font);
            }
            let rows: Vec<u32> = (0..rng.below(9)).map(|_| rng.below(7) as u32).collect();
            let cells: Vec<Cell> = (0..rows.iter().sum::<u32>())
                .map(|_| {
                    let text = texts[rng.below(texts.len())];
                    let element = match rng.below(8) {
                        7 => Element::Icon,
                        6 => Element::Action { text },
                        5 | 4 => Element::Badge { text },
                        3 => Element::Progress,
                        2 => Element::Metric {
                            caption: text,
                            value: text,
                            trend: text,
                        },
                        _ => Element::Text {
                            role: roles[rng.below(roles.len())],
                            text,
                        },
                    };
                    Cell {
                        weight: WEIGHTS[rng.below(WEIGHTS.len())],
                        element,
                    }
                })
                .collect();
            let mut start = 0;
            let mut row_kinds = Vec::new();
            for &length in &rows {
                let row = &cells[start..start + length as usize];
                start += length as usize;
                let others = row
                    .iter()
                    .any(|cell| !matches!(cell.element, Element::Badge { .. }));
                badged_rows += usize::from(badged(row) && others);
                row_kinds.push(kinds(row));
            }
            let width = WIDTHS[rng.below(WIDTHS.len())];
            let mut placed = Vec::new();
            let laid = lay_out(&cells, &rows, width, &fonts, &mut placed);
            assert_eq!(height(row_kinds, &fonts), laid, "{cells:?} in {rows:?}");
        }
        // Rows of a badge beside another element are reached, where the badge's offset counts.
        assert!(badged_rows > 1_000, "{badged_rows}");
    }

    /// A small deterministic generator, so that a failure repeats.
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> f64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }

        fn below(&mut self, n: usize) -> usize {
            ((self.next() * n as f64) as usize).min(n - 1)
        }
    }

    #[test]
    fn any_content_the_bridge_accepts_lays_out_finite_inside_its_node() {
        // Verifies: ADR-0013, Q-4
        // Up to the bridge's limits, 8 rows of 6 columns of texts and actions of up to 1,000 code
        // units and icons, with weights from the smallest to the largest positive finite numbers,
        // at widths from 0 to the largest the world holds, in fonts of any metric up to the
        // largest.
        const WEIGHTS: [f64; 6] = [f64::MIN_POSITIVE, 1e-300, 0.5, 1.0, 1e300, f64::MAX];
        const WIDTHS: [f32; 6] = [0.0, 1.0, 23.0, 220.0, 1e6, 1.3e36];
        let roles = [Role::Title, Role::Body, Role::Caption];
        let texts = ["", "x", &"w".repeat(1_000), &"\u{1F600}".repeat(500)];
        let mut rng = Lcg(7);
        let (mut cut_cases, mut narrow_cases) = (0, 0);
        for _ in 0..2_000 {
            let mut fonts = Fonts::default();
            for role in roles {
                let metric = |rng: &mut Lcg| [0.0, 1.0, 7.5, MAX_METRIC][rng.below(4)];
                let font = Font::new(&[], &[], metric(&mut rng), metric(&mut rng)).unwrap();
                fonts.set(role, font);
            }
            let rows: Vec<u32> = (0..rng.below(9)).map(|_| rng.below(7) as u32).collect();
            let cells: Vec<Cell> = (0..rows.iter().sum::<u32>())
                .map(|_| {
                    let text = texts[rng.below(texts.len())];
                    // A role, or past them an action or an icon.
                    let element = match rng.below(5) {
                        4 => Element::Icon,
                        3 => Element::Action { text },
                        role => Element::Text {
                            role: roles[role],
                            text,
                        },
                    };
                    Cell {
                        weight: WEIGHTS[rng.below(WEIGHTS.len())],
                        element,
                    }
                })
                .collect();
            let width = WIDTHS[rng.below(WIDTHS.len())];
            let mut placed = Vec::new();
            let height = lay_out(&cells, &rows, width, &fonts, &mut placed);
            assert!(height.is_finite() && (height as f32).is_finite());
            assert_eq!(placed.len(), cells.len());
            for p in &placed {
                let [x, y, w, h] = [p.x, p.y, p.width, p.height].map(f64::from);
                assert!(
                    [x, y, w, h].iter().all(|v| v.is_finite() && *v >= 0.0),
                    "{p:?}"
                );
                assert!(x + w <= f64::from(width), "{p:?} in {width}");
                assert!(y + h <= height, "{p:?} in {height}");
                cut_cases += usize::from(p.ellipsis);
                narrow_cases += usize::from(w == 0.0);
            }
        }
        // Both clauses are reached: texts cut, and columns left no room.
        assert!(
            cut_cases > 100 && narrow_cases > 100,
            "{cut_cases} {narrow_cases}"
        );
    }
}
