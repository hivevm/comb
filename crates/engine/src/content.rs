//! The layout of node content (ADR-0013): rows of weighted columns, each holding one element,
//! laid out inside the width the host application gives a node, from the glyph advances and the
//! line height of each font the shell draws with. The layout computes each row's height, each
//! element's rectangle, where each text is cut and an ellipsis drawn after it, and the node's
//! height from its rows; the rest of the engine takes that height as the node's.
//!
//! The elements `text`, `action`, and `badge` exist so far; each further kind of ADR-0013 joins
//! `Element` with the ticket that builds it. An action is a text in the font of role body; what it
//! names is the bridge's to keep, since the layout reads none of it. A badge is a text in the font
//! of role body on a pill, whose rectangle is the badge's: it hugs the text as far as it is drawn,
//! padded as an edge label's pill is, and stays within its column; its colour is the bridge's to
//! keep.

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
    /// A text whose click the host application gives a meaning, drawn in the font of role body.
    Action {
        text: &'a str,
    },
    /// A text on a pill of a colour the host application gives, drawn in the font of role body.
    Badge {
        text: &'a str,
    },
}

impl Element<'_> {
    /// The role whose font the element's text is drawn in.
    pub const fn role(&self) -> Role {
        match *self {
            Self::Text { role, .. } => role,
            Self::Action { .. } | Self::Badge { .. } => Role::Body,
        }
    }

    /// The text the element shows.
    pub const fn text(&self) -> &str {
        match *self {
            Self::Text { text, .. } | Self::Action { text } | Self::Badge { text } => text,
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

/// The height of `element` in `fonts`: its line's, and a badge's pill's, its line and the padding
/// above and below.
pub fn element_height(element: &Element, fonts: &Fonts) -> f64 {
    let line = fonts.of(element.role()).line_height();
    match element {
        Element::Badge { .. } => line + 2.0 * BADGE_PADDING_Y,
        _ => line,
    }
}

/// The height of a row of `cells`: that of its tallest element, none for a row of no elements.
pub fn row_height(cells: &[Cell], fonts: &Fonts) -> f64 {
    cells
        .iter()
        .map(|cell| element_height(&cell.element, fonts))
        .fold(0.0, f64::max)
}

/// The height of a node whose rows are `rows` high: the padding above and below and the rows
/// between, at least `MIN_HEIGHT`.
pub fn node_height(rows: impl IntoIterator<Item = f64>) -> f64 {
    let rows: f64 = rows.into_iter().sum();
    (PADDING_TOP + rows + PADDING_BOTTOM).max(MIN_HEIGHT)
}

/// The largest `f32` of at most `value` whose sum with `x` stays within `end`, both sums taken
/// exactly in `f64`, and 0 where none does.
fn within(x: f32, value: f64, end: f32) -> f32 {
    let room = (f64::from(end) - f64::from(x)).min(value).max(0.0);
    #[expect(
        clippy::cast_possible_truncation,
        reason = "a span within a node's width, which f32 holds, stepped down below to stay in it"
    )]
    let width = room as f32;
    // Rounded to the nearest, it passes `end` by at most one step.
    if f64::from(x) + f64::from(width) > f64::from(end) {
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
/// for them, so that no element reaches past the node.
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
        // Weights taken relative to the largest, so that their sum cannot overflow.
        let largest = row.iter().map(|cell| cell.weight).fold(0.0, f64::max);
        let total: f64 = row.iter().map(|cell| cell.weight / largest).sum();
        let mut left = pad;
        for cell in row {
            let span = room * (cell.weight / largest) / total;
            let x = place(left.min(full));
            let column = within(x, span, place(full - pad));
            let height = element_height(&cell.element, fonts);
            let element = cell.element;
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
            out.push(Placed {
                x,
                y: place(top),
                width,
                height: place(height),
                kept,
                ellipsis,
            });
            left += span + gap;
        }
        top += row_height(row, fonts);
    }
    node_height(std::iter::once(top - PADDING_TOP))
}

/// The index of the element of `cells`, which `lay_out` placed at `placed`, whose rectangle holds
/// the point `(x, y)` relative to its node's top-left corner, each rectangle taken with its left
/// and top sides and without its right and bottom ones, so that two elements that touch never both
/// hold a point; none on the padding, in a gap, or below a shorter element of its row. Where
/// `titles_only`, as at the middle level, only a text of role title is hit, the one drawn there
/// (ADR-0013).
pub fn element_at(
    cells: &[Cell],
    placed: &[Placed],
    x: f64,
    y: f64,
    titles_only: bool,
) -> Option<usize> {
    cells.iter().zip(placed).position(|(cell, at)| {
        let drawn = !titles_only
            || matches!(
                cell.element,
                Element::Text {
                    role: Role::Title,
                    ..
                }
            );
        let [left, top, width, height] = [at.x, at.y, at.width, at.height].map(f64::from);
        drawn && left <= x && x < left + width && top <= y && y < top + height
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
        let sum: f64 = rows.iter().map(|row| row_height(row, &fonts)).sum();
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
        // least height 64.
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
                [12.0, 28.0, 47.0, 14.0],
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
    fn a_point_beside_a_badge_s_pill_in_its_column_hits_no_element() {
        // Verifies: ADR-0013
        // The badge "Done" at 220: its pill from (67, 28) 40 × 22, in a column 141 wide.
        let cells = [
            text(Role::Title, "Bet", 1.0),
            text(Role::Caption, "c", 1.0),
            badge("Done", 3.0),
        ];
        let (placed, _) = laid_out(&cells, &[1, 2], 220.0);
        let at = |x, y| element_at(&cells, &placed, x, y, false);
        assert_eq!(at(67.0, 28.0), Some(2));
        assert_eq!(at(106.9, 49.9), Some(2));
        assert_eq!(at(107.0, 35.0), None);
        assert_eq!(at(180.0, 35.0), None);
        // The caption's cell ends at its line, 14 high, though its row is 22.
        assert_eq!(at(20.0, 41.0), Some(1));
        assert_eq!(at(20.0, 43.0), None);
        // At the middle level no badge is hit.
        assert_eq!(element_at(&cells, &placed, 80.0, 35.0, true), None);
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
        let at = |x, y| element_at(&cells, &placed, x, y, false);
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
        assert_eq!(element_at(&cells, &placed, 100.0, 15.0, true), Some(0));
        assert_eq!(element_at(&cells, &placed, 100.0, 35.0, true), None);
        assert_eq!(element_at(&cells, &placed, 20.0, 35.0, true), None);
        // A column with no width holds no point.
        let (squeezed, _) = laid_out(&cells, &[1, 2], 16.0);
        assert_eq!(element_at(&cells, &squeezed, 8.0, 35.0, false), None);
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
        // units, with weights from the smallest to the largest positive finite numbers, at widths
        // from 0 to the largest the world holds, in fonts of any metric up to the largest.
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
                    // A role, or past them an action.
                    let element = match rng.below(4) {
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
