//! The node content of graph data (ADR-0013, ADR-0034): its codes and limits, the columns a load's
//! content crosses as and the content of a single node read through serde-wasm-bindgen, both
//! checked by the one function below, and the content the engine keeps to lay out.
//!
//! `text`, `action`, `badge`, `progress`, and `metric` have columns and a code so far; each further kind of
//! ADR-0013 adds its own with its ticket, in the places ADR-0034 gives them.

use std::fmt;

use comb_engine::content::{self as layout, Cell, Direction, Element, Fonts, Placed, Role};
use serde::Serialize;
use serde::de::{self, IgnoredAny, Visitor};
use serde::{Deserialize, Deserializer};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

use super::{
    ContentElement, GraphDataProblem, NodeContent, Segment, TEXT_LIMIT, TextRole, Trend,
    TrendDirection, bounds_fit, numbered, rgb, utf16_length,
};

/// The most rows of one node's content.
pub const MAX_ROWS: usize = ROW_LIMIT as usize;

/// The most columns of one row.
pub const MAX_COLUMNS: usize = COLUMN_LIMIT as usize;

/// The most UTF-16 code units of the strings of all content in one load together, the texts and
/// the names alike: at least the titles a load held before content, 1,000 code units for each of
/// 1,000,000 nodes, and below 2^32, so that every boundary fits a `Uint32Array` (ADR-0034).
pub const MAX_CONTENT_UNITS: u32 = 1_000_000_000;

/// `MAX_ROWS` as the `u32` a refusal and `rowLimit` name.
pub(crate) const ROW_LIMIT: u32 = 8;

/// `MAX_COLUMNS` as the `u32` a refusal and `columnLimit` name.
pub(crate) const COLUMN_LIMIT: u32 = 6;

/// The most segments of one progress bar.
pub const MAX_SEGMENTS: usize = SEGMENT_LIMIT as usize;

/// `MAX_SEGMENTS` as the `u32` a refusal and `segmentLimit` name.
pub(crate) const SEGMENT_LIMIT: u32 = 8;

/// How far past 1 the fractions of a progress bar may sum, so that fractions a host application
/// computed to sum to 1 are not refused for their rounding.
const PAST_ONE: f64 = 1e-9;

/// The code of an element's kind in its column (ADR-0034): `Unnamed` for an element whose kind
/// names none the snapshot codes, or that is no object, which its rule refuses.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KindCode {
    Text,
    Action,
    Badge,
    Progress,
    Metric,
    Unnamed,
}

/// The kind of an element a click reports (ADR-0013): one of the kinds the bridge accepts.
#[derive(Tsify, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ElementKind {
    Text,
    Action,
    Badge,
    Progress,
    Metric,
}

/// The element of a node a press hits (ADR-0013): its row and column, its kind, and for an
/// action its identifier.
#[derive(Tsify, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ElementHit {
    pub row: u32,
    pub column: u32,
    pub kind: ElementKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub action: Option<String>,
}

/// The code of a text's role in its column: `Unnamed` for a role that names none, which its rule
/// refuses.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoleCode {
    Title,
    Body,
    Caption,
    Unnamed,
}

/// The code of a trend's direction in its column: `Unnamed` for a direction that names none, or a
/// trend that is no object, which its rule refuses; 0 for an element of another kind.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DirectionCode {
    Up,
    Down,
    Flat,
    Unnamed,
}

/// The kind of `name`, as the snapshot codes it, `Unnamed` for a string that names none.
pub(crate) fn kind_code(name: &str) -> KindCode {
    match name {
        "text" => KindCode::Text,
        "action" => KindCode::Action,
        "badge" => KindCode::Badge,
        "progress" => KindCode::Progress,
        "metric" => KindCode::Metric,
        _ => KindCode::Unnamed,
    }
}

/// The role of `name`, `Unnamed` for a string that names none.
pub(crate) fn role_code(name: &str) -> RoleCode {
    match name {
        "title" => RoleCode::Title,
        "body" => RoleCode::Body,
        "caption" => RoleCode::Caption,
        _ => RoleCode::Unnamed,
    }
}

/// The direction of `name`, `Unnamed` for a string that names none.
pub(crate) fn direction_code(name: &str) -> DirectionCode {
    match name {
        "up" => DirectionCode::Up,
        "down" => DirectionCode::Down,
        "flat" => DirectionCode::Flat,
        _ => DirectionCode::Unnamed,
    }
}

/// The direction of `code`, or none for `Unnamed` and a code no direction has.
pub(crate) fn direction_of(code: u8) -> Option<Direction> {
    [
        (DirectionCode::Up, Direction::Up),
        (DirectionCode::Down, Direction::Down),
        (DirectionCode::Flat, Direction::Flat),
    ]
    .into_iter()
    .find(|&(of, _)| of as u8 == code)
    .map(|(_, direction)| direction)
}

/// The role of `code`, or none for `Unnamed` and a code no role has.
pub(crate) fn role_of(code: u8) -> Option<Role> {
    [
        (RoleCode::Title, Role::Title),
        (RoleCode::Body, Role::Body),
        (RoleCode::Caption, Role::Caption),
    ]
    .into_iter()
    .find(|&(of, _)| of as u8 == code)
    .map(|(_, role)| role)
}

/// The content of the nodes of one load as columns (ADR-0034), the nodes' elements in slot order,
/// each node's rows in their order and each row's elements in theirs: the boundaries of each
/// node's rows, one more than there are nodes; of each row's elements, one more than there are
/// rows; per element its kind's code, its weight as the host application handed it, NaN for one
/// of another type, a text's role's code and a trend's direction's code, each 0 for another kind,
/// and a badge's or a trend's colour as the host application handed it, NaN for one of another
/// type and for another kind; per element the
/// boundaries of a progress bar's segments, one more than there are elements, and per segment its
/// fraction and its colour as the host application handed them, NaN for one of another type; the
/// texts, every string an element shows, a metric's caption, value, and trend's text in that
/// order, concatenated in pieces as every string column is, with
/// their boundaries and per text whether it is a text; and the names, every string an element
/// names and does not show, an action's identifier, as the texts are.
#[derive(Clone, Copy)]
pub struct ContentColumns<'a> {
    pub row_bounds: &'a [u32],
    pub element_bounds: &'a [u32],
    pub kinds: &'a [u8],
    pub weights: &'a [f64],
    pub roles: &'a [u8],
    pub directions: &'a [u8],
    pub colors: &'a [f64],
    pub segment_bounds: &'a [u32],
    pub fractions: &'a [f64],
    pub segment_colors: &'a [f64],
    pub texts: &'a [String],
    pub text_bounds: &'a [u32],
    pub text_valid: &'a [u8],
    pub names: &'a [String],
    pub name_bounds: &'a [u32],
    pub name_valid: &'a [u8],
}

/// A string column of content as its rules read it: its boundaries, and per value whether it is
/// a string.
#[derive(Clone, Copy)]
struct Strings<'a> {
    bounds: &'a [u32],
    valid: &'a [u8],
}

/// How many strings an element of `kind` fills of the texts and of the names (ADR-0034).
fn filled(kind: u8) -> (usize, usize) {
    match kind {
        k if k == KindCode::Text as u8 => (1, 0),
        k if k == KindCode::Action as u8 => (1, 1),
        k if k == KindCode::Badge as u8 => (1, 0),
        k if k == KindCode::Metric as u8 => (3, 0),
        _ => (0, 0),
    }
}

/// Whether `bounds` are the boundaries of `count` runs of a column `total` long: one more than
/// there are runs, from 0, never falling, ending at `total`.
fn runs_fit(bounds: &[u32], count: usize, total: usize) -> bool {
    bounds.len() == count + 1
        && bounds.first() == Some(&0)
        && bounds.windows(2).all(|pair| pair[0] <= pair[1])
        && bounds.last().map(|&last| last as usize) == Some(total)
}

/// What a content check carries from one node to the next: the next text and the next name, and
/// the code units of the strings of content so far, the texts and the names alike, against the
/// budget.
pub(crate) struct Cursor {
    text: usize,
    name: usize,
    units: u64,
    budget: u64,
}

impl Default for Cursor {
    fn default() -> Self {
        Self {
            text: 0,
            name: 0,
            units: 0,
            budget: budget(),
        }
    }
}

#[cfg(test)]
thread_local! {
    /// A budget of a load's strings of content the tests lower, so that a load of a few texts
    /// passes it; none for `MAX_CONTENT_UNITS`.
    pub(crate) static TEST_BUDGET: std::cell::Cell<Option<u64>> = const { std::cell::Cell::new(None) };
}

/// The budget of a load's strings of content: `MAX_CONTENT_UNITS`, or in the tests the one they
/// lowered it to.
fn budget() -> u64 {
    #[cfg(test)]
    if let Some(budget) = TEST_BUDGET.get() {
        return budget;
    }
    u64::from(MAX_CONTENT_UNITS)
}

/// The element at `column` of `row` of the node `node`, for a refusal that names it.
struct At<'n> {
    node: &'n str,
    row: u32,
    column: u32,
}

impl At<'_> {
    fn node(&self) -> String {
        self.node.to_owned()
    }
}

impl ContentColumns<'_> {
    /// Whether the columns fit together for `nodes` nodes: the boundaries bound what follows them,
    /// the elements' columns are as long as there are elements, each code names a kind, a role, or
    /// a direction, or none, each validity byte is 1 or 0, there are as many texts and names as the
    /// elements' kinds fill, a text for each `text` and `badge`, a text and a name for each
    /// `action`, and three texts for each `metric`, and
    /// only a progress bar holds segments, each with a fraction and a colour.
    pub(crate) fn fit(&self, nodes: usize) -> bool {
        let elements = self.kinds.len();
        let rows = self.element_bounds.len().saturating_sub(1);
        let (texts, names) = (self.text_valid.len(), self.name_valid.len());
        let (filled_texts, filled_names) = self
            .kinds
            .iter()
            .map(|&kind| filled(kind))
            .fold((0, 0), |(t, n), (dt, dn)| (t + dt, n + dn));
        runs_fit(self.row_bounds, nodes, rows)
            && runs_fit(self.element_bounds, rows, elements)
            && self.weights.len() == elements
            && self.roles.len() == elements
            && self.directions.len() == elements
            && self.colors.len() == elements
            && runs_fit(self.segment_bounds, elements, self.fractions.len())
            && self.segment_colors.len() == self.fractions.len()
            && self.kinds.iter().enumerate().all(|(element, &kind)| {
                kind == KindCode::Progress as u8 || self.segments(element).is_empty()
            })
            && self
                .kinds
                .iter()
                .all(|&kind| kind <= KindCode::Unnamed as u8)
            && self
                .roles
                .iter()
                .all(|&role| role <= RoleCode::Unnamed as u8)
            && self
                .directions
                .iter()
                .all(|&direction| direction <= DirectionCode::Unnamed as u8)
            && self.text_valid.iter().all(|&valid| valid <= 1)
            && self.name_valid.iter().all(|&valid| valid <= 1)
            && texts == filled_texts
            && names == filled_names
            && bounds_fit(self.text_bounds, texts, self.texts)
            && bounds_fit(self.name_bounds, names, self.names)
    }

    /// The texts.
    const fn texts(&self) -> Strings<'_> {
        Strings {
            bounds: self.text_bounds,
            valid: self.text_valid,
        }
    }

    /// The names.
    const fn names(&self) -> Strings<'_> {
        Strings {
            bounds: self.name_bounds,
            valid: self.name_valid,
        }
    }

    /// The range of the rows of the node at `node`.
    fn rows(&self, node: usize) -> std::ops::Range<usize> {
        self.row_bounds[node] as usize..self.row_bounds[node + 1] as usize
    }

    /// The range of the elements of the row at `row`, counted across all nodes.
    fn elements(&self, row: usize) -> std::ops::Range<usize> {
        self.element_bounds[row] as usize..self.element_bounds[row + 1] as usize
    }

    /// The range of the segments of the element at `element`, counted across all elements.
    fn segments(&self, element: usize) -> std::ops::Range<usize> {
        self.segment_bounds[element] as usize..self.segment_bounds[element + 1] as usize
    }

    /// Whether the node at `node` has a row `row`, and where `column` is given, that row a
    /// column `column`: a position the snapshot names a shape of content at.
    pub(crate) fn holds(&self, node: usize, row: u32, column: Option<u32>) -> bool {
        let rows = self.rows(node);
        let Some(row) = rows.clone().nth(row as usize) else {
            return false;
        };
        column.is_none_or(|column| (column as usize) < self.elements(row).len())
    }

    /// Whether the node at `node` holds a progress bar at `column` of row `row`: a position the
    /// snapshot names a shape of a progress bar's segments at.
    pub(crate) fn holds_progress(&self, node: usize, row: u32, column: u32) -> bool {
        let Some(row) = self.rows(node).nth(row as usize) else {
            return false;
        };
        self.elements(row)
            .nth(column as usize)
            .is_some_and(|element| self.kinds[element] == KindCode::Progress as u8)
    }

    /// Checks the content of the node at `node`, named `id`, by the rules of ADR-0034 in their
    /// order, the texts from `cursor` on and the budget counted on from it, and returns the
    /// height its rows lay out to in `fonts`. Reads lengths off the boundaries and maps no text.
    pub(crate) fn check(
        &self,
        node: usize,
        id: &str,
        cursor: &mut Cursor,
        fonts: &Fonts,
    ) -> Result<f64, GraphDataProblem> {
        let rows = self.rows(node);
        if rows.len() > MAX_ROWS {
            return Err(GraphDataProblem::TooManyRows {
                node: id.to_owned(),
                limit: ROW_LIMIT,
            });
        }
        let mut heights = 0.0;
        for (r, row) in rows.enumerate() {
            let elements = self.elements(row);
            if elements.len() > MAX_COLUMNS {
                return Err(GraphDataProblem::TooManyColumns {
                    node: id.to_owned(),
                    row: numbered(r),
                    limit: COLUMN_LIMIT,
                });
            }
            let mut checked = [(false, 0.0); MAX_COLUMNS];
            for (c, element) in elements.clone().enumerate() {
                let at = At {
                    node: id,
                    row: numbered(r),
                    column: numbered(c),
                };
                let height = self.check_element(element, &at, cursor, fonts)?;
                checked[c] = (self.kinds[element] == KindCode::Badge as u8, height);
            }
            heights += layout::row_height_of(checked[..elements.len()].iter().copied());
        }
        Ok(layout::node_height([heights]))
    }

    /// Checks the element at `element`, at `at`, its fields in their order, and returns its
    /// height.
    fn check_element(
        &self,
        element: usize,
        at: &At,
        cursor: &mut Cursor,
        fonts: &Fonts,
    ) -> Result<f64, GraphDataProblem> {
        let kind = self.kinds[element];
        if kind == KindCode::Unnamed as u8 {
            return Err(GraphDataProblem::InvalidElementKind {
                node: at.node(),
                row: at.row,
                column: at.column,
            });
        }
        let weight = self.weights[element];
        if !(weight.is_finite() && weight > 0.0) {
            return Err(GraphDataProblem::InvalidWeight {
                node: at.node(),
                row: at.row,
                column: at.column,
            });
        }
        if kind == KindCode::Action as u8 {
            self.check_text(at, cursor)?;
            let name = cursor.name;
            cursor.name += 1;
            check_string(self.names(), name, at, "id", cursor)?;
            return Ok(fonts.of(Role::Body).line_height());
        }
        if kind == KindCode::Badge as u8 {
            self.check_text(at, cursor)?;
            if !rgb(self.colors[element]) {
                return Err(GraphDataProblem::InvalidContentColor {
                    node: at.node(),
                    row: at.row,
                    column: at.column,
                    segment: None,
                });
            }
            return Ok(layout::element_height(&Element::Badge { text: "" }, fonts));
        }
        if kind == KindCode::Progress as u8 {
            self.check_segments(element, at)?;
            return Ok(layout::element_height(&Element::Progress, fonts));
        }
        if kind == KindCode::Metric as u8 {
            self.check_metric(element, at, cursor)?;
            let metric = Element::Metric {
                caption: "",
                value: "",
                trend: "",
            };
            return Ok(layout::element_height(&metric, fonts));
        }
        let Some(role) = role_of(self.roles[element]) else {
            return Err(GraphDataProblem::InvalidRole {
                node: at.node(),
                row: at.row,
                column: at.column,
            });
        };
        self.check_text(at, cursor)?;
        Ok(fonts.of(role).line_height())
    }

    /// Checks the segments of the progress bar at `element`, at `at`: their number, then each
    /// segment's fraction and colour in their order, then the sum of the fractions.
    fn check_segments(&self, element: usize, at: &At) -> Result<(), GraphDataProblem> {
        let segments = self.segments(element);
        if segments.len() > MAX_SEGMENTS {
            return Err(GraphDataProblem::TooManySegments {
                node: at.node(),
                row: at.row,
                column: at.column,
                limit: SEGMENT_LIMIT,
            });
        }
        let mut sum = 0.0;
        for (s, segment) in segments.enumerate() {
            let fraction = self.fractions[segment];
            if !(fraction.is_finite() && fraction >= 0.0) {
                return Err(GraphDataProblem::InvalidFraction {
                    node: at.node(),
                    row: at.row,
                    column: at.column,
                    segment: numbered(s),
                });
            }
            if !rgb(self.segment_colors[segment]) {
                return Err(GraphDataProblem::InvalidContentColor {
                    node: at.node(),
                    row: at.row,
                    column: at.column,
                    segment: Some(numbered(s)),
                });
            }
            sum += fraction;
        }
        if sum > 1.0 + PAST_ONE {
            return Err(GraphDataProblem::FractionsPastOne {
                node: at.node(),
                row: at.row,
                column: at.column,
            });
        }
        Ok(())
    }

    /// Checks the metric at `element`, at `at`: its trend's direction, then its caption, its value,
    /// and its trend's text, then its trend's colour.
    fn check_metric(
        &self,
        element: usize,
        at: &At,
        cursor: &mut Cursor,
    ) -> Result<(), GraphDataProblem> {
        if direction_of(self.directions[element]).is_none() {
            return Err(GraphDataProblem::InvalidDirection {
                node: at.node(),
                row: at.row,
                column: at.column,
            });
        }
        for field in ["caption", "value", "trend.text"] {
            let text = cursor.text;
            cursor.text += 1;
            check_string(self.texts(), text, at, field, cursor)?;
        }
        if !rgb(self.colors[element]) {
            return Err(GraphDataProblem::InvalidContentColor {
                node: at.node(),
                row: at.row,
                column: at.column,
                segment: None,
            });
        }
        Ok(())
    }

    /// Checks the next text, the field `text` of the element at `at`.
    fn check_text(&self, at: &At, cursor: &mut Cursor) -> Result<(), GraphDataProblem> {
        let text = cursor.text;
        cursor.text += 1;
        check_string(self.texts(), text, at, "text", cursor)
    }
}

/// Checks the string at `index` of `strings`, the field `field` of the element at `at`: that it
/// is a string, its length, and the budget of the load's strings of content with it, counted on
/// in `cursor`.
fn check_string(
    strings: Strings,
    index: usize,
    at: &At,
    field: &str,
    cursor: &mut Cursor,
) -> Result<(), GraphDataProblem> {
    if strings.valid[index] != 1 {
        return Err(GraphDataProblem::InvalidContentText {
            node: at.node(),
            row: at.row,
            column: at.column,
            field: field.to_owned(),
        });
    }
    let length = (strings.bounds[index + 1] - strings.bounds[index]) as usize;
    if length > super::MAX_TEXT {
        return Err(GraphDataProblem::ContentTextTooLong {
            node: at.node(),
            row: at.row,
            column: at.column,
            field: field.to_owned(),
            limit: TEXT_LIMIT,
        });
    }
    cursor.units += length as u64;
    if cursor.units > cursor.budget {
        return Err(GraphDataProblem::ContentBudgetExceeded {
            node: at.node(),
            limit: MAX_CONTENT_UNITS,
        });
    }
    Ok(())
}

/// Refuses the code units of a load's strings of content, `units`, as the snapshot counted them
/// while it read them, where they pass `MAX_CONTENT_UNITS`, at the node `node` whose string passed
/// it: the check behind the export `checkContentBudget`, so that a load past the budget is refused
/// before its strings are copied. A count that is no count is malformed.
pub(crate) fn check_content_budget(node: &str, units: f64) -> Result<(), GraphDataProblem> {
    if units.is_nan() || units < 0.0 {
        return Err(super::malformed(
            "the count of code units of content is no count",
        ));
    }
    if units > f64::from(MAX_CONTENT_UNITS) {
        return Err(GraphDataProblem::ContentBudgetExceeded {
            node: node.to_owned(),
            limit: MAX_CONTENT_UNITS,
        });
    }
    Ok(())
}

/// The content of one or more nodes as the engine keeps it, owned: the columns of a load, or the
/// content of one node `addNode` or `updateNode` handed over, as columns of one node; and once it
/// is checked, where each text and each name lies in its piece, and per node its first text and
/// its first name.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ContentData {
    pub(crate) row_bounds: Vec<u32>,
    pub(crate) element_bounds: Vec<u32>,
    pub(crate) kinds: Vec<u8>,
    pub(crate) weights: Vec<f64>,
    pub(crate) roles: Vec<u8>,
    pub(crate) directions: Vec<u8>,
    pub(crate) colors: Vec<f64>,
    pub(crate) segment_bounds: Vec<u32>,
    pub(crate) fractions: Vec<f64>,
    pub(crate) segment_colors: Vec<f64>,
    pub(crate) texts: Vec<String>,
    pub(crate) text_bounds: Vec<u32>,
    pub(crate) text_valid: Vec<u8>,
    pub(crate) names: Vec<String>,
    pub(crate) name_bounds: Vec<u32>,
    pub(crate) name_valid: Vec<u8>,
    /// Per text, its piece and the byte range it holds there, once mapped; none where every
    /// piece is ASCII, whose texts lie at their code units.
    pub(crate) spans: Vec<(u32, u32, u32)>,
    /// Per name, as `spans` per text.
    pub(crate) name_spans: Vec<(u32, u32, u32)>,
    /// Per node, the index of its first name, once indexed; none where no element names one.
    pub(crate) name_starts: Vec<u32>,
    /// Per node, the index of its first text, once indexed; none where every element fills one
    /// text, so that the text of an element is the one of its index.
    pub(crate) text_starts: Vec<u32>,
}

/// `value`, a colour the content's check found an integer from 0 to 0xFFFFFF, as a `u32`.
fn rgb_of(value: f64) -> u32 {
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "an integer from 0 to 0xFFFFFF, as the content's check made sure"
    )]
    let color = value as u32;
    color
}

/// Where the strings of an element lie: the index of its text, and of its name, where it fills
/// one.
#[derive(Clone, Copy, Debug)]
pub(crate) struct StringAt {
    pub(crate) text: usize,
    pub(crate) name: usize,
}

/// The string at `index` of a column of `pieces` cut by `bounds`, by its span in `spans`, or
/// where they are none, of ASCII pieces at its code units.
fn string_at<'a>(
    pieces: &'a [String],
    bounds: &[u32],
    spans: &[(u32, u32, u32)],
    index: usize,
) -> &'a str {
    if spans.is_empty() {
        return ascii_at(pieces, bounds, index);
    }
    let (piece, start, end) = spans[index];
    // An empty string past the last piece, or in a column of no pieces, lies in none.
    pieces
        .get(piece as usize)
        .map_or("", |piece| &piece[start as usize..end as usize])
}

/// The string at `index` of ASCII pieces, at its code units in the piece it lies in.
fn ascii_at<'a>(pieces: &'a [String], bounds: &[u32], index: usize) -> &'a str {
    let (start, end) = (bounds[index] as usize, bounds[index + 1] as usize);
    let mut base = 0;
    for piece in pieces {
        // A string no longer than nothing lies in no piece; any other lies whole in one.
        if start == end {
            break;
        }
        if end <= base + piece.len() {
            return &piece[start - base..end - base];
        }
        base += piece.len();
    }
    ""
}

impl ContentData {
    /// The columns of the content.
    pub(crate) fn view(&self) -> ContentColumns<'_> {
        ContentColumns {
            row_bounds: &self.row_bounds,
            element_bounds: &self.element_bounds,
            kinds: &self.kinds,
            weights: &self.weights,
            roles: &self.roles,
            directions: &self.directions,
            colors: &self.colors,
            segment_bounds: &self.segment_bounds,
            fractions: &self.fractions,
            segment_colors: &self.segment_colors,
            texts: &self.texts,
            text_bounds: &self.text_bounds,
            text_valid: &self.text_valid,
            names: &self.names,
            name_bounds: &self.name_bounds,
            name_valid: &self.name_valid,
        }
    }

    /// Maps every text and every name onto the string Rust holds, or refuses as malformed where a
    /// boundary falls inside a character, and indexes the names. Called only once every string's
    /// length has been checked (ADR-0034).
    pub(crate) fn map(&mut self) -> Result<(), GraphDataProblem> {
        self.spans = super::text_spans(&self.texts, &self.text_bounds)?;
        self.name_spans = super::text_spans(&self.names, &self.name_bounds)?;
        self.index_strings();
        Ok(())
    }

    /// Notes the index of each node's first text and first name, so that a node's strings are
    /// found without counting those before it; no texts' where every element fills one text, and
    /// no names' where no element names one.
    pub(crate) fn index_strings(&mut self) {
        let one_text_each = self.kinds.iter().all(|&kind| filled(kind).0 == 1);
        self.text_starts = if one_text_each {
            Vec::new()
        } else {
            self.starts(|kind| filled(kind).0)
        };
        self.name_starts = if self.name_valid.is_empty() {
            Vec::new()
        } else {
            self.starts(|kind| filled(kind).1)
        };
    }

    /// Per node, how many strings the elements before it fill, each filling `of` its kind.
    fn starts(&self, of: impl Fn(u8) -> usize) -> Vec<u32> {
        let view = self.view();
        let mut count = 0;
        let mut starts = Vec::with_capacity(self.row_bounds.len());
        for node in 0..self.row_bounds.len().saturating_sub(1) {
            starts.push(numbered(count));
            let elements = view.rows(node).flat_map(|row| view.elements(row));
            count += elements
                .map(|element| of(self.kinds[element]))
                .sum::<usize>();
        }
        starts
    }

    /// The text at `index`, once mapped.
    pub(crate) fn text(&self, index: usize) -> &str {
        string_at(&self.texts, &self.text_bounds, &self.spans, index)
    }

    /// The name at `index`, once mapped.
    fn name(&self, index: usize) -> &str {
        string_at(&self.names, &self.name_bounds, &self.name_spans, index)
    }

    /// The elements of the node at `node`, each with its row and column, its index, the index of
    /// its text, and the index of its name where it names one.
    pub(crate) fn elements_of(
        &self,
        node: usize,
    ) -> impl Iterator<Item = (u32, u32, usize, StringAt)> + '_ {
        let view = self.view();
        let rows = (node + 1 < self.row_bounds.len())
            .then(|| view.rows(node))
            .into_iter()
            .flatten();
        let first = |starts: &[u32]| starts.get(node).map(|&start| start as usize);
        // Where every element fills one text, the node's first is that of its first element.
        let mut text = first(&self.text_starts).unwrap_or_else(|| {
            rows.clone()
                .next()
                .map_or(0, |row| view.elements(row).start)
        });
        let mut name = first(&self.name_starts).unwrap_or(0);
        rows.enumerate()
            .flat_map(move |(r, row)| {
                view.elements(row)
                    .enumerate()
                    .map(move |(c, element)| (r, c, element))
            })
            .map(move |(r, c, element)| {
                let at = (numbered(r), numbered(c), element, StringAt { text, name });
                let (texts, names) = filled(self.kinds[element]);
                text += texts;
                name += names;
                at
            })
    }

    /// The element at `element`, its text, where it shows one, the one at `text`, and a metric's
    /// three from there, as the layout reads it.
    fn element(&self, element: usize, text: usize) -> Element<'_> {
        let kind = self.kinds[element];
        if kind == KindCode::Progress as u8 {
            return Element::Progress;
        }
        if kind == KindCode::Metric as u8 {
            return Element::Metric {
                caption: self.text(text),
                value: self.text(text + 1),
                trend: self.text(text + 2),
            };
        }
        self.element_with(element, self.text(text))
    }

    /// The element at `element` as the layout reads it, showing `text` where it shows one, a
    /// metric `text` in each of its three.
    fn element_with<'t>(&self, element: usize, text: &'t str) -> Element<'t> {
        let kind = self.kinds[element];
        if kind == KindCode::Progress as u8 {
            return Element::Progress;
        }
        if kind == KindCode::Metric as u8 {
            return Element::Metric {
                caption: text,
                value: text,
                trend: text,
            };
        }
        if kind == KindCode::Action as u8 {
            return Element::Action { text };
        }
        if kind == KindCode::Badge as u8 {
            return Element::Badge { text };
        }
        let role = role_of(self.roles[element]).unwrap_or(Role::Body);
        Element::Text { role, text }
    }

    /// The fractions of the segments of the progress bar at `element`, none for another kind.
    fn fractions(&self, element: usize) -> &[f64] {
        &self.fractions[self.view().segments(element)]
    }

    /// Lays out the content of the node at `node`, `width` wide, in `fonts`, and pushes where its
    /// elements lie onto `out`; `cells` and `rows` are the caller's to reuse.
    pub(crate) fn lay_out<'a>(
        &'a self,
        node: usize,
        width: f32,
        fonts: &Fonts,
        cells: &mut Vec<Cell<'a>>,
        rows: &mut Vec<u32>,
        out: &mut Vec<Placed>,
    ) {
        cells.clear();
        rows.clear();
        // A slot of a graph built without content, as only the tests build one, holds none.
        if node + 1 >= self.row_bounds.len() {
            return;
        }
        let view = self.view();
        for row in view.rows(node) {
            rows.push(numbered(view.elements(row).len()));
        }
        for (_, _, element, at) in self.elements_of(node) {
            cells.push(Cell {
                weight: self.weights[element],
                element: self.element(element, at.text),
            });
        }
        layout::lay_out(cells, rows, width, fonts, out);
    }

    /// The element of the node at `node`, `width` wide and laid out in `fonts`, whose rectangle
    /// holds the point `(x, y)` relative to the node's top-left corner, of the elements drawn,
    /// texts of role title alone where `titles_only` (ADR-0013); `cells`, `rows`, and `placed` are
    /// the caller's to reuse.
    #[expect(
        clippy::too_many_arguments,
        reason = "the node, its point, and the buffers the caller reuses, as `lay_out` takes them"
    )]
    pub(crate) fn element_at<'a>(
        &'a self,
        node: usize,
        width: f32,
        fonts: &Fonts,
        (x, y): (f64, f64),
        titles_only: bool,
        cells: &mut Vec<Cell<'a>>,
        rows: &mut Vec<u32>,
        placed: &mut Vec<Placed>,
    ) -> Option<ElementHit> {
        placed.clear();
        self.lay_out(node, width, fonts, cells, rows, placed);
        let hit = layout::element_at(cells, placed, x, y, titles_only)?;
        let (row, column, element, at) = self.elements_of(node).nth(hit)?;
        let (kind, action) = match self.element(element, at.text) {
            Element::Action { .. } => (ElementKind::Action, Some(self.name(at.name).to_owned())),
            Element::Badge { .. } => (ElementKind::Badge, None),
            Element::Progress => (ElementKind::Progress, None),
            Element::Metric { .. } => (ElementKind::Metric, None),
            Element::Text { .. } => (ElementKind::Text, None),
        };
        Some(ElementHit {
            row,
            column,
            kind,
            action,
        })
    }
}

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
/// `arrows`, drawn in its element's colour.
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
}

impl ContentData {
    /// Pushes onto `drawn` the kind, the role, the colour, the drawn text, the pieces of the bar,
    /// and the parts and the arrow of each element of the node at `node`, which `placed` holds in
    /// the order of its rows and theirs, as `lay_out` placed them in `fonts`; an action's, a
    /// badge's, a progress bar's, and a metric's role is body, whose font draws the first two,
    /// whose line the third lies in, and the value and the trend's text of the last.
    pub(crate) fn draw(&self, node: usize, placed: &[Placed], fonts: &Fonts, drawn: &mut Drawn) {
        for ((_, _, element, strings), at) in self.elements_of(node).zip(placed) {
            let kind = self.kinds[element];
            drawn.kinds.push(kind);
            let shown = self.element(element, strings.text);
            let (role, color) = match shown {
                Element::Action { .. } | Element::Progress => (RoleCode::Body as u8, 0),
                Element::Badge { .. } | Element::Metric { .. } => {
                    (RoleCode::Body as u8, self.color(element))
                }
                Element::Text { .. } => (self.roles[element], 0),
            };
            drawn.roles.push(role);
            drawn.colors.push(color);
            if matches!(shown, Element::Progress) {
                self.draw_bar(element, at, drawn);
            }
            drawn.bar_bounds.push(numbered(drawn.bar_colors.len()));
            if let Element::Metric {
                caption,
                value,
                trend,
            } = shown
            {
                // A metric's direction, which the bridge checked.
                let direction = direction_of(self.directions[element]).unwrap_or(Direction::Flat);
                let parts = layout::metric_parts(at, [caption, value, trend], direction, fonts);
                for (text, part) in [
                    (caption, parts.caption),
                    (value, parts.value),
                    (trend, parts.trend),
                ] {
                    drawn.push_text(text, &part);
                    drawn
                        .parts
                        .extend([part.x, part.y, part.width, part.height]);
                    drawn.part_ends.push(drawn.units);
                }
                drawn.arrows.extend(parts.arrow.iter().flatten());
            } else {
                drawn.push_text(shown.text(), at);
            }
            drawn.part_bounds.push(numbered(drawn.part_ends.len()));
            drawn.arrow_bounds.push(numbered(drawn.arrows.len() / 6));
            drawn.bounds.push(drawn.units);
        }
    }

    /// Pushes onto `drawn` the pieces of the bar of the progress bar at `element`, placed at
    /// `at`: its segments, each of its colour, and its track, of 0.
    fn draw_bar(&self, element: usize, at: &Placed, drawn: &mut Drawn) {
        drawn.pieces.clear();
        layout::bar(at, self.fractions(element), &mut drawn.pieces);
        for piece in &drawn.pieces {
            drawn.bars.extend(piece);
        }
        let colors = self
            .view()
            .segments(element)
            .map(|s| rgb_of(self.segment_colors[s]));
        drawn.bar_colors.extend(colors.chain([0]));
    }

    /// The colour of the badge or the trend of the metric at `element`, which the bridge checked.
    fn color(&self, element: usize) -> u32 {
        rgb_of(self.colors[element])
    }

    /// The segments of the progress bar at `element`, as the host application's type describes
    /// them.
    fn segments_of(&self, element: usize) -> Vec<Segment> {
        self.view()
            .segments(element)
            .map(|s| Segment {
                fraction: self.fractions[s],
                color: rgb_of(self.segment_colors[s]),
            })
            .collect()
    }

    /// The height the content of the node at `node` lays out to in `fonts`, as the `f32` the engine
    /// keeps; that of no rows for a node without content, as only the tests build one.
    pub(crate) fn height(&self, node: usize, fonts: &Fonts) -> f32 {
        let view = self.view();
        let rows = (node + 1 < self.row_bounds.len())
            .then(|| view.rows(node))
            .into_iter()
            .flatten();
        // The height of an element is that of its kind and role, whatever its text.
        let heights = rows.map(|row| {
            layout::row_height_of(view.elements(row).map(|element| {
                let element = self.element_with(element, "");
                let badge = matches!(element, Element::Badge { .. });
                (badge, layout::element_height(&element, fonts))
            }))
        });
        super::kept_height(layout::node_height(heights))
    }

    /// The content of the node at `node`, as the host application's type describes it: what
    /// inspection and the changes Comb tells report, built when asked.
    pub(crate) fn content_of(&self, node: usize) -> NodeContent {
        let count = if node + 1 < self.row_bounds.len() {
            self.view().rows(node).len()
        } else {
            0
        };
        let mut rows: Vec<Vec<ContentElement>> = (0..count).map(|_| Vec::new()).collect();
        for (row, _, element, at) in self.elements_of(node) {
            let shown = self.element(element, at.text);
            let text = shown.text().to_owned();
            let weight = Some(self.weights[element]);
            rows[row as usize].push(match shown {
                Element::Action { .. } => ContentElement::Action {
                    text,
                    id: self.name(at.name).to_owned(),
                    weight,
                },
                Element::Progress => ContentElement::Progress {
                    segments: self.segments_of(element),
                    weight,
                },
                Element::Badge { .. } => ContentElement::Badge {
                    text,
                    color: self.color(element),
                    weight,
                },
                Element::Metric {
                    caption,
                    value,
                    trend,
                } => ContentElement::Metric {
                    caption: caption.to_owned(),
                    value: value.to_owned(),
                    trend: Trend {
                        text: trend.to_owned(),
                        direction: match direction_of(self.directions[element]) {
                            Some(Direction::Up) => TrendDirection::Up,
                            Some(Direction::Down) => TrendDirection::Down,
                            _ => TrendDirection::Flat,
                        },
                        color: self.color(element),
                    },
                    weight,
                },
                Element::Text { role, .. } => ContentElement::Text {
                    role: match role {
                        Role::Title => TextRole::Title,
                        Role::Caption => TextRole::Caption,
                        Role::Body => TextRole::Body,
                    },
                    text,
                    weight,
                },
            });
        }
        NodeContent(rows)
    }
}

#[cfg(test)]
impl ContentData {
    /// Ends a node of the columns of a load being written.
    pub(crate) fn end_node(&mut self) {
        self.row_bounds
            .push(numbered(self.element_bounds.len() - 1));
    }

    /// Appends the rows of `node`, the content of one node, to the columns of a load being
    /// written, its texts one value each onto `texts` and its names onto `names`, which the caller
    /// cuts into pieces.
    pub(crate) fn append(&mut self, node: &Self, texts: &mut Vec<String>, names: &mut Vec<String>) {
        let base = numbered(self.kinds.len());
        let ends = node.element_bounds.windows(2).map(|pair| base + pair[1]);
        self.element_bounds.extend(ends);
        self.kinds.extend(&node.kinds);
        self.weights.extend(&node.weights);
        self.roles.extend(&node.roles);
        self.directions.extend(&node.directions);
        self.colors.extend(&node.colors);
        let base = numbered(self.fractions.len());
        let ends = node.segment_bounds.windows(2).map(|pair| base + pair[1]);
        self.segment_bounds.extend(ends);
        self.fractions.extend(&node.fractions);
        self.segment_colors.extend(&node.segment_colors);
        let values = super::values(&node.texts, &node.text_bounds).expect("texts of one node");
        for value in values {
            let last = self.text_bounds[self.text_bounds.len() - 1];
            self.text_bounds.push(last + numbered(utf16_length(value)));
            texts.push(value.to_owned());
        }
        self.text_valid.extend(&node.text_valid);
        let values = super::values(&node.names, &node.name_bounds).expect("names of one node");
        for value in values {
            let last = self.name_bounds[self.name_bounds.len() - 1];
            self.name_bounds.push(last + numbered(utf16_length(value)));
            names.push(value.to_owned());
        }
        self.name_valid.extend(&node.name_valid);
    }
}

/// Where the snapshot found a shape of content it cannot flatten in a node: the row, and below a
/// row the column, of a row that is no list, an element that is no object, or a progress bar's
/// segments that are no list or a segment of them that is no object.
pub type Shape = (u32, Option<u32>);

/// What a shape of content the snapshot cannot flatten should have been (ADR-0034).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Unflat {
    /// A row: a list of elements.
    #[default]
    Row,
    /// An element: an object.
    Element,
    /// A progress bar's segments: a list of segments.
    Segments,
    /// A segment: an object.
    Segment,
}

/// The content of the node of `addNode` or of a patch of `updateNode` as the host application
/// handed it over, read through serde-wasm-bindgen as the snapshot hands a load's over in
/// columns: a row that is no list as a row of no elements, an element that is no object as one
/// of no kind, each element's kind and role by their codes, a weight left out as 1 and one of
/// another type as NaN, a badge's colour left out or of another type as NaN, a text of another
/// type as none, a progress bar's segments that are no list as none, and a segment that is no
/// object, or a fraction or a colour of one left out or of another type, as NaN; and the first
/// shape it could not flatten, and what that shape should have been.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ContentInput {
    pub(crate) data: ContentData,
    pub(crate) shape: Option<Shape>,
    pub(crate) unread: Unflat,
}

impl ContentInput {
    /// Starts the content of one node.
    pub(crate) fn new() -> Self {
        Self {
            data: ContentData {
                row_bounds: vec![0, 0],
                element_bounds: vec![0],
                segment_bounds: vec![0],
                text_bounds: vec![0],
                name_bounds: vec![0],
                ..ContentData::default()
            },
            shape: None,
            unread: Unflat::Row,
        }
    }

    /// Names the shape at `row` and `column`, which should have been `unread`, unless one before
    /// it was named.
    pub(crate) fn unread(&mut self, row: u32, column: Option<u32>, unread: Unflat) {
        if self.shape.is_none() {
            self.shape = Some((row, column));
            self.unread = unread;
        }
    }

    /// Adds a segment of `fraction` and `color` to the progress bar pushed last.
    pub(crate) fn push_segment(&mut self, fraction: f64, color: f64) {
        let data = &mut self.data;
        data.fractions.push(fraction);
        data.segment_colors.push(color);
        if let Some(end) = data.segment_bounds.last_mut() {
            *end += 1;
        }
    }

    /// Ends a row, of the elements pushed since the row before.
    pub(crate) fn end_row(&mut self) {
        let data = &mut self.data;
        data.element_bounds.push(numbered(data.kinds.len()));
        data.row_bounds[1] += 1;
    }

    /// Adds an element of `kind`, `weight`, and `role`, the role crossing as 0 for an action, a
    /// badge, a progress bar, and a metric, and of the colour `color`, NaN for a kind other than `badge`; where it is a
    /// `text`, an `action`, or a `badge`, its text, and where it is an `action`, its identifier
    /// `id`, each none for one of another type, which crosses empty and marked as no string.
    pub(crate) fn push(
        &mut self,
        kind: KindCode,
        weight: f64,
        role: u8,
        color: f64,
        text: Option<&str>,
        id: Option<&str>,
    ) {
        let data = &mut self.data;
        data.kinds.push(kind as u8);
        data.weights.push(weight);
        data.roles.push(
            if matches!(
                kind,
                KindCode::Action | KindCode::Badge | KindCode::Progress | KindCode::Metric
            ) {
                0
            } else {
                role
            },
        );
        data.directions.push(0);
        data.colors.push(if kind == KindCode::Badge {
            color
        } else {
            f64::NAN
        });
        let segments = data.segment_bounds[data.segment_bounds.len() - 1];
        data.segment_bounds.push(segments);
        let (texts, names) = filled(kind as u8);
        // A metric's three texts are `push_metric`'s to fill.
        if texts == 1 {
            push_string(
                &mut data.texts,
                &mut data.text_bounds,
                &mut data.text_valid,
                text,
            );
        }
        if names > 0 {
            push_string(
                &mut data.names,
                &mut data.name_bounds,
                &mut data.name_valid,
                id,
            );
        }
    }
}

impl ContentInput {
    /// Adds a metric of `weight`, its trend of the direction `direction`, a code, and the colour
    /// `color`, showing `caption`, `value`, and the trend's text `trend`, each none for one of
    /// another type, which crosses empty and marked as no string.
    pub(crate) fn push_metric(
        &mut self,
        weight: f64,
        direction: u8,
        color: f64,
        [caption, value, trend]: [Option<&str>; 3],
    ) {
        self.push(KindCode::Metric, weight, 0, f64::NAN, None, None);
        let data = &mut self.data;
        if let Some(last) = data.directions.last_mut() {
            *last = direction;
        }
        if let Some(last) = data.colors.last_mut() {
            *last = color;
        }
        for text in [caption, value, trend] {
            push_string(
                &mut data.texts,
                &mut data.text_bounds,
                &mut data.text_valid,
                text,
            );
        }
    }
}

/// Appends `value` to a string column of one piece, `pieces` cut by `bounds`, and whether it is a
/// string to `valid`: none crosses empty and marked as no string.
fn push_string(
    pieces: &mut Vec<String>,
    bounds: &mut Vec<u32>,
    valid: &mut Vec<u8>,
    value: Option<&str>,
) {
    let given = value.is_some();
    let value = value.unwrap_or("");
    let last = bounds[bounds.len() - 1];
    bounds.push(last + numbered(utf16_length(value)));
    valid.push(u8::from(given));
    match pieces.first_mut() {
        Some(piece) => piece.push_str(value),
        None if !value.is_empty() => pieces.push(value.to_owned()),
        None => {}
    }
}

impl<'de> Deserialize<'de> for ContentInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(RowsVisitor)
    }
}

struct RowsVisitor;

impl<'de> Visitor<'de> for RowsVisitor {
    type Value = ContentInput;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a list of rows")
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<ContentInput, A::Error> {
        let mut content = ContentInput::new();
        let mut row = 0;
        // Every row is read, past the limit too, so that their count is refused; the snapshot
        // hands over at most one row beyond it.
        while let Some(read) = seq.next_element_seed(RowSeed(&mut content, row))? {
            if !read {
                content.unread(row, None, Unflat::Row);
            }
            content.end_row();
            row += 1;
        }
        Ok(content)
    }
}

/// Reads one row into the content, or reports that it is no list.
struct RowSeed<'c>(&'c mut ContentInput, u32);

impl<'de> de::DeserializeSeed<'de> for RowSeed<'_> {
    type Value = bool;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<bool, D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for RowSeed<'_> {
    type Value = bool;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a list of elements")
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<bool, A::Error> {
        let Self(content, row) = self;
        let mut column = 0;
        while let Some(element) = seq.next_element::<ElementCells>()? {
            match element.0 {
                Some(cells) => {
                    let kind = cells.kind.as_deref().map_or(KindCode::Unnamed, kind_code);
                    let role = cells.role.as_deref().map_or(RoleCode::Unnamed, role_code);
                    if kind == KindCode::Metric {
                        // A trend that is no object holds none of its fields.
                        let (text, direction, color) =
                            cells.trend.unwrap_or((None, None, f64::NAN));
                        let direction = direction
                            .as_deref()
                            .map_or(DirectionCode::Unnamed, direction_code);
                        content.push_metric(
                            cells.weight,
                            direction as u8,
                            color,
                            [
                                cells.caption.as_deref(),
                                cells.value.as_deref(),
                                text.as_deref(),
                            ],
                        );
                    } else {
                        content.push(
                            kind,
                            cells.weight,
                            role as u8,
                            cells.color,
                            cells.text.as_deref(),
                            cells.id.as_deref(),
                        );
                    }
                    // Only a progress bar's segments are read; any other kind holds none.
                    if kind == KindCode::Progress {
                        let at = Some(column);
                        match cells.segments {
                            Some(segments) => {
                                for segment in segments {
                                    let (fraction, color) = segment.unwrap_or_else(|| {
                                        content.unread(row, at, Unflat::Segment);
                                        (f64::NAN, f64::NAN)
                                    });
                                    content.push_segment(fraction, color);
                                }
                            }
                            None => content.unread(row, at, Unflat::Segments),
                        }
                    }
                }
                None => {
                    content.unread(row, Some(column), Unflat::Element);
                    content.push(KindCode::Unnamed, f64::NAN, 0, f64::NAN, None, None);
                }
            }
            column += 1;
        }
        Ok(true)
    }

    // Any other value is no list: a row of no elements.
    fn visit_bool<E>(self, _: bool) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_i64<E>(self, _: i64) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_u64<E>(self, _: u64) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_f64<E>(self, _: f64) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_str<E>(self, _: &str) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_unit<E>(self) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_none<E>(self) -> Result<bool, E> {
        Ok(false)
    }
    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<bool, D::Error> {
        deserializer.deserialize_any(self)
    }
    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<bool, A::Error> {
        while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(false)
    }
}

/// A trend's text, direction, and colour, as `Fields` holds them.
type Trend3 = (Option<String>, Option<String>, f64);

/// An element as the host application handed it over: its fields, each of its type or none, a
/// weight left out or null 1 and one of another type NaN, or none where it is no object.
struct ElementCells(Option<Fields>);

struct Fields {
    kind: Option<String>,
    role: Option<String>,
    weight: f64,
    color: f64,
    /// A segment's fraction, read as its colour is.
    fraction: f64,
    text: Option<String>,
    id: Option<String>,
    /// A trend's direction, read as a kind is.
    direction: Option<String>,
    /// A metric's caption and value, read as a text is.
    caption: Option<String>,
    value: Option<String>,
    /// A metric's trend, its text, its direction, and its colour, each read as `Fields` reads
    /// them, or none where it is no object.
    trend: Option<Trend3>,
    /// A progress bar's segments, each its fraction and its colour, NaN for one left out or of
    /// another type, or none for a segment that is no object; none where they are no list.
    segments: Option<Vec<Option<(f64, f64)>>>,
}

impl<'de> Deserialize<'de> for ElementCells {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(ElementVisitor)
    }
}

struct ElementVisitor;

impl<'de> Visitor<'de> for ElementVisitor {
    type Value = ElementCells;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("an object")
    }

    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<ElementCells, A::Error> {
        // A weight left out, or null, is 1, as the snapshot hands one over.
        let mut fields = Fields {
            kind: None,
            role: None,
            weight: 1.0,
            color: f64::NAN,
            fraction: f64::NAN,
            text: None,
            id: None,
            direction: None,
            caption: None,
            value: None,
            trend: None,
            segments: None,
        };
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "kind" => fields.kind = map.next_value::<Lenient<String>>()?.0,
                "role" => fields.role = map.next_value::<Lenient<String>>()?.0,
                "weight" => {
                    let weight = map.next_value::<Lenient<Option<f64>>>()?.0;
                    fields.weight = weight.map_or(f64::NAN, |weight| weight.unwrap_or(1.0));
                }
                "color" => {
                    let color = map.next_value::<Lenient<f64>>()?.0;
                    fields.color = color.unwrap_or(f64::NAN);
                }
                "fraction" => {
                    let fraction = map.next_value::<Lenient<f64>>()?.0;
                    fields.fraction = fraction.unwrap_or(f64::NAN);
                }
                "text" => fields.text = map.next_value::<Lenient<String>>()?.0,
                "id" => fields.id = map.next_value::<Lenient<String>>()?.0,
                "direction" => fields.direction = map.next_value::<Lenient<String>>()?.0,
                "caption" => fields.caption = map.next_value::<Lenient<String>>()?.0,
                "value" => fields.value = map.next_value::<Lenient<String>>()?.0,
                "trend" => {
                    let trend = map.next_value::<ElementCells>()?.0;
                    fields.trend = trend.map(|t| (t.text, t.direction, t.color));
                }
                "segments" => fields.segments = map.next_value::<SegmentsCells>()?.0,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(ElementCells(Some(fields)))
    }

    // Any other value is no object.
    fn visit_bool<E>(self, _: bool) -> Result<ElementCells, E> {
        Ok(ElementCells(None))
    }
    fn visit_i64<E>(self, _: i64) -> Result<ElementCells, E> {
        Ok(ElementCells(None))
    }
    fn visit_u64<E>(self, _: u64) -> Result<ElementCells, E> {
        Ok(ElementCells(None))
    }
    fn visit_f64<E>(self, _: f64) -> Result<ElementCells, E> {
        Ok(ElementCells(None))
    }
    fn visit_str<E>(self, _: &str) -> Result<ElementCells, E> {
        Ok(ElementCells(None))
    }
    fn visit_unit<E>(self) -> Result<ElementCells, E> {
        Ok(ElementCells(None))
    }
    fn visit_none<E>(self) -> Result<ElementCells, E> {
        Ok(ElementCells(None))
    }
    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<ElementCells, D::Error> {
        deserializer.deserialize_any(self)
    }
    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<ElementCells, A::Error> {
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(ElementCells(None))
    }
}

/// A progress bar's segments as the host application handed them over, as `Fields` holds them.
struct SegmentsCells(Option<Vec<Option<(f64, f64)>>>);

impl<'de> Deserialize<'de> for SegmentsCells {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let segments = Lenient::<Vec<SegmentCells>>::deserialize(deserializer)?.0;
        Ok(Self(segments.map(|segments| {
            segments.into_iter().map(|segment| segment.0).collect()
        })))
    }
}

/// A segment as the host application handed it over: its fraction and its colour, NaN for one
/// left out or of another type, or none where it is no object.
struct SegmentCells(Option<(f64, f64)>);

impl<'de> Deserialize<'de> for SegmentCells {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let element = ElementCells::deserialize(deserializer)?;
        Ok(Self(
            element.0.map(|fields| (fields.fraction, fields.color)),
        ))
    }
}

/// A value of `T`, or none where it holds a value of another type, which is read and dropped.
struct Lenient<T>(Option<T>);

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Lenient<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self(T::deserialize(deserializer).ok()))
    }
}
