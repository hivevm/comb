//! The one check of node content (ADR-0034): a load's content columns and the content of a single
//! node, checked by the rules of ADR-0013 in their order, the strings of all content counted
//! against the budget, and the height each node lays out to.

use comb_engine::content::{self as layout, Fonts, Kind, Role};

use super::codes::{COLUMN_LIMIT, ROW_LIMIT, SEGMENT_LIMIT, direction_of, filled};
use super::{
    ContentData, DirectionCode, GraphDataProblem, KindCode, MAX_COLUMNS, MAX_CONTENT_UNITS,
    MAX_ROWS, MAX_SEGMENTS, RoleCode, TEXT_LIMIT, bounds_fit, numbered, rgb, role_of,
};

/// How far past 1 the fractions of a progress bar may sum, so that fractions a host application
/// computed to sum to 1 are not refused for their rounding.
const PAST_ONE: f64 = 1e-9;

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
/// names and does not show, an action's identifier and an icon's registered name, as the texts
/// are.
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

impl Cursor {
    /// A cursor whose count of the strings of content starts at `held`, the code units of content
    /// the graph holds besides the node an edit checks, so that `addNode` and `updateNode` count
    /// on against the budget as a load does.
    pub(crate) fn holding(held: u64) -> Self {
        Self {
            units: held,
            ..Self::default()
        }
    }

    /// The code units of the strings of content counted so far.
    pub(crate) const fn units(&self) -> u64 {
        self.units
    }
}

#[cfg(test)]
thread_local! {
    /// A budget of the strings of content the tests lower, so that a load or an edit of a few
    /// texts passes it; none for `MAX_CONTENT_UNITS`.
    pub(crate) static TEST_BUDGET: std::cell::Cell<Option<u64>> = const { std::cell::Cell::new(None) };
}

/// The budget of the strings of content the graph holds, after a load or an edit:
/// `MAX_CONTENT_UNITS`, or in the tests the one they lowered it to.
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
    /// `action`, three texts for each `metric`, and a name for each `icon`, and
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
    pub(super) fn rows(&self, node: usize) -> std::ops::Range<usize> {
        self.row_bounds[node] as usize..self.row_bounds[node + 1] as usize
    }

    /// The range of the elements of the row at `row`, counted across all nodes.
    pub(super) fn elements(&self, row: usize) -> std::ops::Range<usize> {
        self.element_bounds[row] as usize..self.element_bounds[row + 1] as usize
    }

    /// The range of the segments of the element at `element`, counted across all elements.
    pub(crate) fn segments(&self, element: usize) -> std::ops::Range<usize> {
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
        for (r, row) in rows.clone().enumerate() {
            let elements = self.elements(row);
            if elements.len() > MAX_COLUMNS {
                return Err(GraphDataProblem::TooManyColumns {
                    node: id.to_owned(),
                    row: numbered(r),
                    limit: COLUMN_LIMIT,
                });
            }
            for (c, element) in elements.enumerate() {
                let at = At {
                    node: id,
                    row: numbered(r),
                    column: numbered(c),
                };
                self.check_element(element, &at, cursor)?;
            }
        }
        Ok(self.height(rows, fonts))
    }

    /// The height the node whose rows are `rows` lays out to in `fonts`, as the engine computes
    /// it from its elements' kinds and roles (ADR-0013); of content the bridge checked.
    pub(super) fn height(&self, rows: std::ops::Range<usize>, fonts: &Fonts) -> f64 {
        layout::height(
            rows.map(|row| self.elements(row).map(|element| self.kind(element))),
            fonts,
        )
    }

    /// The kind of the element at `element`, and a text's role, of content the bridge checked.
    fn kind(&self, element: usize) -> Kind {
        let kind = self.kinds[element];
        if kind == KindCode::Action as u8 {
            Kind::Action
        } else if kind == KindCode::Icon as u8 {
            Kind::Icon
        } else if kind == KindCode::Badge as u8 {
            Kind::Badge
        } else if kind == KindCode::Progress as u8 {
            Kind::Progress
        } else if kind == KindCode::Metric as u8 {
            Kind::Metric
        } else {
            Kind::Text(role_of(self.roles[element]).unwrap_or(Role::Body))
        }
    }

    /// Checks the element at `element`, at `at`, its fields in their order.
    fn check_element(
        &self,
        element: usize,
        at: &At,
        cursor: &mut Cursor,
    ) -> Result<(), GraphDataProblem> {
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
            return check_string(self.names(), name, at, "id", cursor);
        }
        if kind == KindCode::Icon as u8 {
            let name = cursor.name;
            cursor.name += 1;
            return check_string(self.names(), name, at, "name", cursor);
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
            return Ok(());
        }
        if kind == KindCode::Progress as u8 {
            return self.check_segments(element, at);
        }
        if kind == KindCode::Metric as u8 {
            return self.check_metric(element, at, cursor);
        }
        if role_of(self.roles[element]).is_none() {
            return Err(GraphDataProblem::InvalidRole {
                node: at.node(),
                row: at.row,
                column: at.column,
            });
        }
        self.check_text(at, cursor)
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

/// The content of one node the bridge checked, mapped, and the code units of this node, as the
/// check's cursor counted them.
#[derive(Debug)]
pub(crate) struct Checked {
    pub(crate) data: ContentData,
    pub(crate) units: u64,
}

impl Checked {
    /// Checks the content of one node, as a load checks a node's, named `id`, its strings counted
    /// against the budget on from `held`, the code units of content the graph holds besides it,
    /// and returns it with its texts mapped and the height it lays out to in `fonts`.
    pub(crate) fn of(
        id: &str,
        content: &ContentData,
        fonts: &Fonts,
        held: u64,
    ) -> Result<(Self, f64), GraphDataProblem> {
        let mut cursor = Cursor::holding(held);
        let height = content.view().check(0, id, &mut cursor, fonts)?;
        let mut data = content.clone();
        data.map()?;
        let units = cursor.units() - held;
        Ok((Self { data, units }, height))
    }
}

#[cfg(test)]
impl Checked {
    /// The text at `index`, mapped.
    pub(crate) fn text(&self, index: usize) -> &str {
        self.data.text(index)
    }
}
