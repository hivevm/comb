//! The buffers of what a query draws of node content (ADR-0013, ADR-0010): per element placed
//! its kind, role, colour, and drawn text, the pieces of a progress bar, and the parts and arrow
//! of a metric, which the shell reads through views on them.

use comb_engine::content::{self as layout, Cell, Direction, Element, Fonts, Placed};
use comb_engine::graph::Level;

use crate::graph_data::{ContentData, RoleCode, direction_of, numbered, rgb_of, utf16_length};

/// The texts of the elements a query placed, as the shell draws them (ADR-0013): per element its
/// kind's code, the code of the role whose font draws it, its colour as `0xRRGGBB`, a badge's
/// pill's, 0 for an element of no colour, and what is drawn of its text, the text or as much of it
/// as fits followed by an ellipsis, those strings one after another in `texts`, with their
/// boundaries in UTF-16 code units in `bounds`, one more than there are elements; and per element
/// the boundaries of the pieces of its bar in `bar_bounds`, one more than there are elements, a
/// progress bar's segments and then its track and no piece of another kind, each piece's
/// rectangle `x, y, width, height` relative to its node in `bars`, and its colour as `0xRRGGBB` in
/// `bar_colors`, a segment's, and 0 for a track, whose colour is the shell's. A metric's colour is
/// its trend's, and its drawn text its caption's, its value's, and its trend's text's one after
/// another, which its parts cut: per element the boundaries of its parts in `part_bounds`, one
/// more than there are elements, a metric's three and no part of another kind, each part's
/// rectangle relative to its node in `parts`, and where its text ends in `texts`, in UTF-16 code
/// units, in `part_ends`, each part's text starting where the one before it in its element ends,
/// the first where its element's does; and per element the boundaries of its arrows in
/// `arrow_bounds`, one more than there are elements, a metric's one where its column holds it and
/// none of another kind, each arrow's triangle as three points `x, y` relative to its node in
/// `arrows`, drawn in its element's colour. An icon's text in `texts` is its registered name,
/// whole, which the shell draws as the image registered under it and never as text.
#[derive(Debug, Default)]
pub struct Drawn {
    pub kinds: Vec<u8>,
    pub roles: Vec<u8>,
    pub colors: Vec<u32>,
    pub texts: String,
    pub bounds: Vec<u32>,
    pub bar_bounds: Vec<u32>,
    pub bars: Vec<f32>,
    pub bar_colors: Vec<u32>,
    pub part_bounds: Vec<u32>,
    pub parts: Vec<f32>,
    pub part_ends: Vec<u32>,
    pub arrow_bounds: Vec<u32>,
    pub arrows: Vec<f32>,
    units: u32,
    pieces: Vec<[f32; 4]>,
}

impl Drawn {
    /// Starts the texts of a query anew.
    pub(crate) fn clear(&mut self) {
        self.kinds.clear();
        self.roles.clear();
        self.colors.clear();
        self.texts.clear();
        self.bounds.clear();
        self.bounds.push(0);
        self.units = 0;
        self.bar_bounds.clear();
        self.bar_bounds.push(0);
        self.bars.clear();
        self.bar_colors.clear();
        self.part_bounds.clear();
        self.part_bounds.push(0);
        self.parts.clear();
        self.part_ends.clear();
        self.arrow_bounds.clear();
        self.arrow_bounds.push(0);
        self.arrows.clear();
    }

    /// Pushes `name`, an icon's registered name, whole onto the texts.
    fn push_name(&mut self, name: &str) {
        self.texts.push_str(name);
        self.units += numbered(utf16_length(name));
    }

    /// Pushes what is drawn of `text`, its first `at.kept` UTF-16 code units and an ellipsis
    /// after them where `at.ellipsis`, onto the texts.
    fn push_text(&mut self, text: &str, at: &Placed) {
        let mut units = 0;
        let end = text
            .char_indices()
            .find(|&(_, character)| {
                let past = units >= at.kept;
                units += numbered(character.len_utf16());
                past
            })
            .map_or(text.len(), |(byte, _)| byte);
        self.texts.push_str(&text[..end]);
        self.units += at.kept.min(units);
        if at.ellipsis {
            self.texts.push(layout::ELLIPSIS);
            self.units += 1;
        }
    }

    /// Pushes the kind, the role, the colour, the drawn text, the pieces of the bar, and the parts
    /// and the arrow of each element of the node at `node` of `content` drawn at `level`
    /// (`layout::drawn_at`), of `cells` at `placed` in the order of its rows and theirs, as
    /// `lay_out` laid them out in `fonts`; an action's, a badge's, a progress bar's, a metric's,
    /// and an icon's role is body, whose font draws the first two, whose line the third and the
    /// last lie in, and the value and the trend's text of the fourth; an icon's text is its
    /// registered name.
    pub(crate) fn draw(
        &mut self,
        content: &ContentData,
        node: usize,
        cells: &[Cell],
        placed: &[Placed],
        level: Level,
        fonts: &Fonts,
    ) {
        let laid = content.elements_of(node).zip(cells).zip(placed);
        for ((_, _, element, strings), at) in laid
            .filter(|((_, cell), _)| layout::drawn_at(&cell.element, level))
            .map(|((element, _), at)| (element, at))
        {
            let kind = content.kinds[element];
            self.kinds.push(kind);
            let shown = content.element(element, strings.text);
            let (role, color) = match shown {
                Element::Action { .. } | Element::Progress | Element::Icon => {
                    (RoleCode::Body as u8, 0)
                }
                Element::Badge { .. } | Element::Metric { .. } => {
                    (RoleCode::Body as u8, content.color(element))
                }
                Element::Text { .. } => (content.roles[element], 0),
            };
            self.roles.push(role);
            self.colors.push(color);
            if matches!(shown, Element::Progress) {
                self.draw_bar(content, element, at);
            }
            self.bar_bounds.push(numbered(self.bar_colors.len()));
            if let Element::Metric {
                caption,
                value,
                trend,
            } = shown
            {
                // A metric's direction, which the bridge checked.
                let direction =
                    direction_of(content.directions[element]).unwrap_or(Direction::Flat);
                let parts = layout::metric_parts(at, [caption, value, trend], direction, fonts);
                for (text, part) in [
                    (caption, parts.caption),
                    (value, parts.value),
                    (trend, parts.trend),
                ] {
                    self.push_text(text, &part);
                    self.parts.extend([part.x, part.y, part.width, part.height]);
                    self.part_ends.push(self.units);
                }
                self.arrows.extend(parts.arrow.iter().flatten());
            } else if matches!(shown, Element::Icon) {
                self.push_name(content.name(strings.name));
            } else {
                self.push_text(shown.text(), at);
            }
            self.part_bounds.push(numbered(self.part_ends.len()));
            self.arrow_bounds.push(numbered(self.arrows.len() / 6));
            self.bounds.push(self.units);
        }
    }

    /// Pushes the pieces of the bar of the progress bar at `element` of `content`, placed at `at`:
    /// its segments, each of its colour, and its track, of 0.
    fn draw_bar(&mut self, content: &ContentData, element: usize, at: &Placed) {
        self.pieces.clear();
        layout::bar(at, content.fractions(element), &mut self.pieces);
        for piece in &self.pieces {
            self.bars.extend(piece);
        }
        let colors = content
            .view()
            .segments(element)
            .map(|s| rgb_of(content.segment_colors[s]));
        self.bar_colors.extend(colors.chain([0]));
    }
}
