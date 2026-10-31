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

// The malformed-data tests of graph data verify ADR-0034 (see `graph_data::tests`).
// Verifies: ADR-0034
#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph_data::tests::{
        Cell, TITLE, a_and, action, add, added, at_b, b_of, badged, batch, content, icon,
        invalid_text, load_columns, metricked, named_content, progressed, refused, text, titled,
    };
    use crate::graph_data::{MAX_TEXT, OwnedColumns, content, graph_of, node_columns::unfit};

    #[test]
    fn a_load_whose_strings_of_content_pass_the_budget_is_refused_at_the_node_that_passes_it() {
        // Verifies: ADR-0034, Q-7
        // The budget lowered to 5 code units: node `a`'s two texts of 2 and 3 hold it, and `b`'s
        // text of 1 passes it.
        content::TEST_BUDGET.set(Some(5));
        let two =
            |a: &str, b: &str| content(&[&[text(RoleCode::Title, a), text(RoleCode::Body, b)]]);
        let load = |b_text: &str| {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[0].content = two("aa", "aaa").into();
            data.nodes[1].content = titled(b_text);
            graph_of(&data)
        };
        let held = load("");
        let passed = load("b");
        content::TEST_BUDGET.set(None);
        assert!(held.is_ok(), "{:?}", held.err());
        assert_eq!(
            passed.err(),
            Some(GraphDataProblem::ContentBudgetExceeded {
                node: "b".into(),
                limit: MAX_CONTENT_UNITS
            })
        );
    }

    #[test]
    fn a_title_that_is_not_text_names_its_node() {
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        data.nodes[1].content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
        assert_eq!(graph_of(&data).unwrap_err(), invalid_text("b", 0, 0));
    }

    #[test]
    fn an_action_whose_identifier_is_no_string_or_too_long_names_its_node() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        // A title and an action beside it, whose identifier is checked as a string of content is,
        // against the limit of a text, after the action's text; through a load and through
        // `addNode` alike.
        let long = "d".repeat(MAX_TEXT + 1);
        let held = "d".repeat(MAX_TEXT);
        let with = |id: Option<&str>| {
            let action = (
                (KindCode::Action, 1.0, RoleCode::Title, Some("Details")),
                id,
            );
            named_content(&[&[(text(RoleCode::Title, "Bet"), None), action]])
        };
        let field = |problem: GraphDataProblem| match problem {
            GraphDataProblem::InvalidContentText {
                node,
                row,
                column,
                field,
            } => (node, row, column, field, None),
            GraphDataProblem::ContentTextTooLong {
                node,
                row,
                column,
                field,
                limit,
            } => (node, row, column, field, Some(limit)),
            other => panic!("{other:?}"),
        };
        let cases = [(None, None), (Some(long.as_str()), Some(TEXT_LIMIT))];
        for (id, limit) in cases {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = with(id).into();
            let refused = field(graph_of(&data).unwrap_err());
            assert_eq!(refused, ("b".into(), 0, 1, "id".into(), limit));
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            let node = added(0.0, 0.0, |node| node.content = with(id).into());
            let refused = field(add(&mut graph, &node).unwrap_err());
            assert_eq!(refused, ("n".into(), 0, 1, "id".into(), limit));
        }
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        data.nodes[1].content = with(Some(&held)).into();
        assert!(graph_of(&data).is_ok());
        // Its text is a text's: missing, it is refused as the field `text`.
        let mut data = batch(&[("a", 0.0, 0.0)], &[]);
        let no_text = ((KindCode::Action, 1.0, RoleCode::Title, None), Some("d"));
        data.nodes[0].content = named_content(&[&[no_text]]).into();
        assert_eq!(graph_of(&data).unwrap_err(), invalid_text("a", 0, 0));
    }

    #[test]
    fn a_badge_whose_colour_is_no_rgb_or_whose_text_is_malformed_names_its_node() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        // A badge below a title, its text checked as a string of content is, then its colour, an
        // integer from 0 to 0xFFFFFF as an edge's; through a load and through `addNode` alike.
        let long = "d".repeat(MAX_TEXT + 1);
        let color = |node: &str| GraphDataProblem::InvalidContentColor {
            node: node.into(),
            row: 1,
            column: 0,
            segment: None,
        };
        let too_long = |node: &str| GraphDataProblem::ContentTextTooLong {
            node: node.into(),
            row: 1,
            column: 0,
            field: "text".into(),
            limit: TEXT_LIMIT,
        };
        type Refusal = fn(&str) -> GraphDataProblem;
        let cases: Vec<(Option<&str>, f64, Refusal)> = vec![
            (Some("Done"), -1.0, color),
            (Some("Done"), f64::from(0x100_0000), color),
            (Some("Done"), 0.5, color),
            (Some("Done"), f64::NAN, color),
            (Some("Done"), f64::INFINITY, color),
            (None, 0.0, |node| invalid_text(node, 1, 0)),
            (Some(&long), 0.0, too_long),
            // The text is checked before the colour.
            (None, f64::NAN, |node| invalid_text(node, 1, 0)),
        ];
        for (text, shade, problem) in cases {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = badged(text, shade).into();
            assert_eq!(
                graph_of(&data).unwrap_err(),
                problem("b"),
                "{text:?} {shade}"
            );
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            let node = added(0.0, 0.0, |node| node.content = badged(text, shade).into());
            assert_eq!(add(&mut graph, &node).unwrap_err(), problem("n"));
        }
        // At both ends of the colours, and a text at the limit, the badge is accepted.
        for (text, shade) in [
            ("Done", 0.0),
            ("Done", f64::from(0xff_ffff)),
            (&*"d".repeat(MAX_TEXT), 0.0),
        ] {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = badged(Some(text), shade).into();
            assert!(graph_of(&data).is_ok(), "{shade}");
        }
    }

    #[test]
    fn a_progress_bar_whose_segments_are_refused_names_its_node_and_the_segment() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        // A progress bar below a title: its number of segments, then each segment's fraction and
        // colour in their order, then their sum; through a load and through `addNode` alike.
        let green = f64::from(0x22_c55e);
        type Refusal = Box<dyn Fn(&str) -> GraphDataProblem>;
        let fraction = |segment| -> Refusal {
            Box::new(move |node| GraphDataProblem::InvalidFraction {
                node: node.into(),
                row: 1,
                column: 0,
                segment,
            })
        };
        let color = || -> Refusal {
            Box::new(|node| GraphDataProblem::InvalidContentColor {
                node: node.into(),
                row: 1,
                column: 0,
                segment: Some(1),
            })
        };
        let too_many = || -> Refusal {
            Box::new(|node| GraphDataProblem::TooManySegments {
                node: node.into(),
                row: 1,
                column: 0,
                limit: SEGMENT_LIMIT,
            })
        };
        let past = || -> Refusal {
            Box::new(|node| GraphDataProblem::FractionsPastOne {
                node: node.into(),
                row: 1,
                column: 0,
            })
        };
        let nine = vec![(0.1, green); MAX_SEGMENTS + 1];
        let cases: Vec<(Vec<(f64, f64)>, Refusal)> = vec![
            (vec![(-0.1, green)], fraction(0)),
            (vec![(0.3, green), (f64::NAN, green)], fraction(1)),
            (vec![(0.3, green), (f64::INFINITY, green)], fraction(1)),
            (vec![(0.3, green), (-1e-300, green)], fraction(1)),
            (vec![(0.3, green), (0.2, -1.0)], color()),
            (vec![(0.3, green), (0.2, f64::from(0x100_0000))], color()),
            (vec![(0.3, green), (0.2, 0.5)], color()),
            (vec![(0.3, green), (0.2, f64::NAN)], color()),
            // The fraction before the colour, the count before either, the sum after both.
            (vec![(0.3, green), (f64::NAN, f64::NAN)], fraction(1)),
            (
                nine.iter().map(|&(_, c)| (f64::NAN, c)).collect(),
                too_many(),
            ),
            (nine, too_many()),
            (vec![(0.6, green), (0.4 + 2e-9, green)], past()),
            (vec![(0.7, green), (0.5, f64::NAN)], color()),
            (vec![(f64::MAX, green), (f64::MAX, green)], past()),
        ];
        for (segments, problem) in cases {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = progressed(&segments).into();
            assert_eq!(graph_of(&data).unwrap_err(), problem("b"), "{segments:?}");
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            let node = added(0.0, 0.0, |node| node.content = progressed(&segments).into());
            assert_eq!(add(&mut graph, &node).unwrap_err(), problem("n"));
        }
        // At the limit of segments, at both ends of the colours, with fractions of 0, and summing
        // to 1 and a little past it, the bar is accepted; so is a bar of no segments.
        let accepted: [&[(f64, f64)]; 5] = [
            &[(0.125, 0.0); MAX_SEGMENTS],
            &[(0.0, 0.0), (1.0, f64::from(0xff_ffff))],
            &[(0.6, green), (0.4 + 5e-10, green)],
            &[(0.1, green), (0.2, green), (0.7, green)],
            &[],
        ];
        for segments in accepted {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = progressed(segments).into();
            assert!(graph_of(&data).is_ok(), "{segments:?}");
        }
    }

    #[test]
    fn a_progress_bar_fills_its_segments_alone_and_segments_that_do_not_fit_are_malformed() {
        // Verifies: ADR-0034
        let green = f64::from(0x22_c55e);
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = progressed(&[(0.3, green), (0.2, 0.0)]).into();
        }))]);
        let c = &columns.content;
        assert_eq!(c.kinds, [KindCode::Text as u8, KindCode::Progress as u8]);
        assert_eq!(c.roles, [RoleCode::Title as u8, 0]);
        assert!(c.colors.iter().all(|color| color.is_nan()));
        assert_eq!(c.segment_bounds, [0, 0, 2]);
        assert_eq!(c.fractions, [0.3, 0.2]);
        assert_eq!(c.segment_colors, [green, 0.0]);
        // The title's text alone: a progress bar fills no text and no name.
        assert_eq!((c.text_valid.len(), c.name_valid.len()), (1, 0));
        assert!(columns.content.view().fit(1));
        // A colour per segment: one too many or one too few does not fit.
        columns.content.segment_colors.push(0.0);
        assert!(!columns.content.view().fit(1));
        columns.content.segment_colors.truncate(1);
        assert!(!columns.content.view().fit(1));
        columns.content.segment_colors.push(0.0);
        assert_eq!(
            load_columns(&columns).map(|graph| graph.nodes_in_use()),
            Ok(1)
        );
        // A progress bar with a text does not fit.
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = progressed(&[]).into();
        }))]);
        columns.content.text_valid.push(1);
        columns.content.text_bounds.push(0);
        assert!(!columns.content.view().fit(1));
    }

    /// The refusal of the metric at row 1, column 0 of the node `node` by its rule `rule`: the
    /// direction, the colour, or a text by its field.
    fn metric_refusal(rule: &str, node: &str) -> GraphDataProblem {
        let (node, row, column) = (node.to_owned(), 1, 0);
        match rule {
            "direction" => GraphDataProblem::InvalidDirection { node, row, column },
            "color" => GraphDataProblem::InvalidContentColor {
                node,
                row,
                column,
                segment: None,
            },
            "long value" => GraphDataProblem::ContentTextTooLong {
                node,
                row,
                column,
                field: "value".into(),
                limit: TEXT_LIMIT,
            },
            field => GraphDataProblem::InvalidContentText {
                node,
                row,
                column,
                field: field.into(),
            },
        }
    }

    #[test]
    fn a_metric_whose_direction_texts_or_colour_are_refused_names_its_node_and_the_field() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        // A metric below a title: its trend's direction, then its caption, its value, and its
        // trend's text, each a string of content, then its trend's colour, as a badge's; through
        // a load and through `addNode` alike.
        let (up, green) = (DirectionCode::Up as u8, f64::from(0x22_c55e));
        let unnamed = DirectionCode::Unnamed as u8;
        let long = "d".repeat(MAX_TEXT + 1);
        let fine = [Some("Revenue"), Some("42"), Some("+3%")];
        let cases: Vec<(u8, f64, [Option<&str>; 3], &str)> = vec![
            (unnamed, green, fine, "direction"),
            (up, -1.0, fine, "color"),
            (up, f64::from(0x100_0000), fine, "color"),
            (up, 0.5, fine, "color"),
            (up, f64::NAN, fine, "color"),
            (up, green, [None, fine[1], fine[2]], "caption"),
            (up, green, [fine[0], None, fine[2]], "value"),
            (up, green, [fine[0], fine[1], None], "trend.text"),
            (up, green, [fine[0], Some(&long), fine[2]], "long value"),
            // The direction before the texts, the caption before the value, the texts before the
            // colour.
            (unnamed, f64::NAN, [None; 3], "direction"),
            (up, green, [None, None, None], "caption"),
            (up, f64::NAN, [fine[0], fine[1], None], "trend.text"),
        ];
        for (direction, shade, texts, rule) in cases {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = metricked(direction, shade, texts).into();
            let refused = graph_of(&data).unwrap_err();
            assert_eq!(refused, metric_refusal(rule, "b"), "{texts:?} {shade}");
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            let node = added(0.0, 0.0, |node| {
                node.content = metricked(direction, shade, texts).into();
            });
            let refused = add(&mut graph, &node).unwrap_err();
            assert_eq!(refused, metric_refusal(rule, "n"));
        }
    }

    #[test]
    fn a_metric_of_each_direction_and_colours_and_texts_at_their_limits_is_accepted() {
        // Verifies: ADR-0013, ADR-0034
        let held = "d".repeat(MAX_TEXT);
        let fine = [Some("Revenue"), Some("42"), Some("+3%")];
        for direction in [DirectionCode::Up, DirectionCode::Down, DirectionCode::Flat] {
            for (shade, texts) in [
                (0.0, fine),
                (
                    f64::from(0xff_ffff),
                    [Some(&*held), Some(&*held), Some(&*held)],
                ),
                (1.0, [Some(""), Some(""), Some("")]),
            ] {
                let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
                data.nodes[1].content = metricked(direction as u8, shade, texts).into();
                assert!(graph_of(&data).is_ok(), "{direction:?} {shade}");
            }
        }
    }

    #[test]
    fn a_metric_fills_its_direction_colour_and_three_texts_and_columns_that_do_not_fit_are_malformed()
     {
        // Verifies: ADR-0034
        let green = f64::from(0x22_c55e);
        let texts = [Some("Revenue"), Some("42"), Some("+3%")];
        let content = metricked(DirectionCode::Down as u8, green, texts);
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = content.into();
        }))]);
        let c = &columns.content;
        assert_eq!(c.kinds, [KindCode::Text as u8, KindCode::Metric as u8]);
        assert_eq!(c.roles, [RoleCode::Title as u8, 0]);
        assert_eq!(c.directions, [0, DirectionCode::Down as u8]);
        assert!(c.colors[0].is_nan());
        assert_eq!(c.colors[1], green);
        // The title's text, then the metric's caption, value, and trend's text; no name.
        assert_eq!(c.text_bounds, [0, 3, 10, 12, 15]);
        assert_eq!((c.text_valid.len(), c.name_valid.len()), (4, 0));
        assert!(columns.content.view().fit(1));
        assert_eq!(
            load_columns(&columns).map(|graph| graph.nodes_in_use()),
            Ok(1)
        );
        // A direction per element: one too many or too few, or a code that is none, does not fit.
        columns.content.directions.push(0);
        assert!(!columns.content.view().fit(1));
        columns.content.directions.truncate(1);
        assert!(!columns.content.view().fit(1));
        columns
            .content
            .directions
            .push(DirectionCode::Unnamed as u8 + 1);
        assert_eq!(load_columns(&columns).err(), Some(unfit()));
        columns.content.directions[1] = DirectionCode::Unnamed as u8;
        assert!(columns.content.view().fit(1));
        // A metric of fewer than three texts does not fit.
        columns.content.text_valid.pop();
        columns.content.text_bounds.pop();
        assert!(!columns.content.view().fit(1));
    }

    #[test]
    fn boundaries_of_segments_that_do_not_bound_them_or_bound_another_kind_s_are_malformed() {
        // Verifies: ADR-0034
        // A title, then a progress bar of two segments: their boundaries are [0, 0, 2].
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = progressed(&[(0.3, 0.0), (0.2, 0.0)]).into();
        }))]);
        // Boundaries that do not start at 0, fall, end short of the segments or past them, or
        // are one too few; and segments of the title, which is no progress bar.
        let unfit_bounds = [
            vec![1, 1, 2],
            vec![0, 2, 1],
            vec![0, 0, 1],
            vec![0, 0, 3],
            vec![0, 0],
            vec![0, 1, 2],
        ];
        for bounds in unfit_bounds {
            columns.content.segment_bounds.clone_from(&bounds);
            assert_eq!(load_columns(&columns).err(), Some(unfit()), "{bounds:?}");
        }
        columns.content.segment_bounds = vec![0, 0, 2];
        assert!(columns.content.view().fit(1));
    }

    #[test]
    fn a_badge_fills_one_text_and_its_colour_and_columns_of_colours_that_do_not_fit_are_malformed()
    {
        // Verifies: ADR-0034
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = badged(Some("Done"), f64::from(0x22_c55e)).into();
        }))]);
        let c = &columns.content;
        assert_eq!(c.kinds, [KindCode::Text as u8, KindCode::Badge as u8]);
        assert_eq!(c.roles, [RoleCode::Title as u8, 0]);
        assert!(c.colors[0].is_nan());
        assert_eq!(c.colors[1], f64::from(0x22_c55e));
        assert_eq!((c.text_valid.len(), c.name_valid.len()), (2, 0));
        assert!(columns.content.view().fit(1));
        // A colour per element: one too many or one too few does not fit.
        columns.content.colors.push(0.0);
        assert!(!columns.content.view().fit(1));
        columns.content.colors.truncate(1);
        assert!(!columns.content.view().fit(1));
        // A badge without its text does not fit either.
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = badged(Some("Done"), 0.0).into();
        }))]);
        columns.content.text_valid.pop();
        columns.content.text_bounds.pop();
        assert!(!columns.content.view().fit(1));
    }

    #[test]
    fn an_actions_identifier_counts_against_the_budget_of_a_loads_strings_of_content() {
        // Verifies: ADR-0034, Q-7
        // The budget lowered to 5 code units: `a`'s action of the text "ab" and the identifier
        // "cde" holds it, and `b`'s title of 1 passes it.
        content::TEST_BUDGET.set(Some(5));
        let load = |b_text: &str| {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[0].content = named_content(&[&[action("ab", "cde")]]).into();
            data.nodes[1].content = titled(b_text);
            graph_of(&data)
        };
        let held = load("");
        let passed = load("b");
        content::TEST_BUDGET.set(None);
        assert!(held.is_ok(), "{:?}", held.err());
        assert_eq!(
            passed.err(),
            Some(GraphDataProblem::ContentBudgetExceeded {
                node: "b".into(),
                limit: MAX_CONTENT_UNITS
            })
        );
    }

    #[test]
    fn columns_of_names_that_do_not_follow_from_the_kinds_are_malformed() {
        // Verifies: ADR-0034
        // One action fills one text and one name: a name too many, or none, does not fit.
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = named_content(&[&[action("Details", "d")]]).into();
        }))]);
        assert!(columns.content.view().fit(1));
        columns.content.name_valid.push(1);
        columns.content.name_bounds.push(1);
        assert!(!columns.content.view().fit(1));
        columns.content.name_valid.clear();
        columns.content.name_bounds = vec![0];
        columns.content.names.clear();
        assert!(!columns.content.view().fit(1));
    }

    #[test]
    fn an_icon_whose_name_is_no_string_or_too_long_names_its_node() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        // A title and an icon beside it, whose name is checked as a string of content is, against
        // the limit of a text, as the field `name`; through a load and through `addNode` alike.
        let long = "d".repeat(MAX_TEXT + 1);
        let held = "d".repeat(MAX_TEXT);
        let with = |name: Option<&str>| {
            named_content(&[&[(text(RoleCode::Title, "Bet"), None), icon(name)]])
        };
        let invalid = |node: &str| GraphDataProblem::InvalidContentText {
            node: node.into(),
            row: 0,
            column: 1,
            field: "name".into(),
        };
        let too_long = |node: &str| GraphDataProblem::ContentTextTooLong {
            node: node.into(),
            row: 0,
            column: 1,
            field: "name".into(),
            limit: TEXT_LIMIT,
        };
        type Refusal = fn(&str) -> GraphDataProblem;
        let cases: [(Option<&str>, Refusal); 2] = [(None, invalid), (Some(&long), too_long)];
        for (name, problem) in cases {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = with(name).into();
            assert_eq!(graph_of(&data).unwrap_err(), problem("b"));
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            let node = added(0.0, 0.0, |node| node.content = with(name).into());
            assert_eq!(add(&mut graph, &node).unwrap_err(), problem("n"));
        }
        // A name of the limit, and an empty one, which names an icon no host registers.
        for name in [held.as_str(), ""] {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = with(Some(name)).into();
            assert!(graph_of(&data).is_ok());
        }
    }

    #[test]
    fn an_icons_name_counts_against_the_budget_of_a_loads_strings_of_content() {
        // Verifies: ADR-0034, Q-7
        // The budget lowered to 5 code units: `a`'s icon named "abcde" holds it, and `b`'s title
        // of 1 passes it.
        content::TEST_BUDGET.set(Some(5));
        let load = |b_text: &str| {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[0].content = named_content(&[&[icon(Some("abcde"))]]).into();
            data.nodes[1].content = titled(b_text);
            graph_of(&data)
        };
        let held = load("");
        let passed = load("b");
        content::TEST_BUDGET.set(None);
        assert!(held.is_ok(), "{:?}", held.err());
        assert_eq!(
            passed.err(),
            Some(GraphDataProblem::ContentBudgetExceeded {
                node: "b".into(),
                limit: MAX_CONTENT_UNITS
            })
        );
    }

    #[test]
    fn columns_of_an_icon_that_do_not_follow_from_its_kind_are_malformed() {
        // Verifies: ADR-0034
        // An icon fills one name and no text: a text, or no name, does not fit.
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = named_content(&[&[icon(Some("bet"))]]).into();
        }))]);
        assert!(columns.content.view().fit(1));
        assert_eq!(columns.content.kinds, [KindCode::Icon as u8]);
        assert!(columns.content.text_valid.is_empty());
        columns.content.text_valid.push(1);
        columns.content.text_bounds.push(0);
        assert!(!columns.content.view().fit(1));
        columns.content.text_valid.clear();
        columns.content.text_bounds = vec![0];
        assert!(columns.content.view().fit(1));
        columns.content.name_valid.clear();
        columns.content.name_bounds = vec![0];
        columns.content.names.clear();
        assert!(!columns.content.view().fit(1));
    }

    #[test]
    fn a_title_that_is_no_text_or_too_long_crosses_as_columns_with_its_kind_and_names() {
        // Verifies: ADR-0034
        let b = || "b".to_owned();
        let cases: Vec<(OwnedColumns, GraphDataProblem)> = vec![
            // A title missing, of another type, or with a lone surrogate is no text.
            (
                a_and(|n| {
                    n.content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
                }),
                invalid_text("b", 0, 0),
            ),
            (
                a_and(|n| n.content = titled(&"x".repeat(MAX_TEXT + 1))),
                GraphDataProblem::ContentTextTooLong {
                    node: b(),
                    row: 0,
                    column: 0,
                    field: "text".into(),
                    limit: TEXT_LIMIT,
                },
            ),
        ];
        for (columns, problem) in cases {
            assert_eq!(load_columns(&columns).err(), Some(problem));
        }
    }

    #[test]
    fn rows_and_columns_past_their_limits_are_refused_naming_the_node() {
        // Verifies: ADR-0034, ADR-0013, Q-7
        let title_row: &[Cell] = &[TITLE];
        assert_eq!(refused(&[title_row; MAX_ROWS]), None);
        let too_many = || GraphDataProblem::TooManyRows {
            node: "b".into(),
            limit: 8,
        };
        assert_eq!(refused(&[title_row; MAX_ROWS + 1]), Some(too_many()));
        let wide = [TITLE; MAX_COLUMNS];
        assert_eq!(refused(&[title_row, &wide]), None);
        let wider = [TITLE; MAX_COLUMNS + 1];
        assert_eq!(
            refused(&[title_row, &wider]),
            Some(GraphDataProblem::TooManyColumns {
                node: "b".into(),
                row: 1,
                limit: 6
            })
        );
        // The rows are counted before any row's elements are read.
        let unnamed: &[Cell] = &[(KindCode::Unnamed, 1.0, RoleCode::Title, None)];
        assert_eq!(refused(&[unnamed; MAX_ROWS + 1]), Some(too_many()));
    }

    #[test]
    fn every_content_refusal_crosses_as_columns_with_its_kind_and_names() {
        // Verifies: ADR-0034, ADR-0013, Q-7
        let title_row: &[Cell] = &[TITLE];
        // An element of no kind, at row 1 and column 1.
        let (node, row, column) = at_b(1, 1);
        let unnamed = (KindCode::Unnamed, 1.0, RoleCode::Title, None);
        assert_eq!(
            refused(&[title_row, &[TITLE, unnamed]]),
            Some(GraphDataProblem::InvalidElementKind { node, row, column })
        );
        // A weight at the bounds of the positive finite numbers, and past them.
        for weight in [f64::MIN_POSITIVE, 1.0, f64::MAX] {
            let weighted = (KindCode::Text, weight, RoleCode::Body, Some("w"));
            assert_eq!(refused(&[title_row, &[TITLE, weighted]]), None, "{weight}");
        }
        for weight in [0.0, -0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let weighted = (KindCode::Text, weight, RoleCode::Body, Some("w"));
            let (node, row, column) = at_b(1, 1);
            assert_eq!(
                refused(&[title_row, &[TITLE, weighted]]),
                Some(GraphDataProblem::InvalidWeight { node, row, column }),
                "{weight}"
            );
        }
        let roleless = (KindCode::Text, 1.0, RoleCode::Unnamed, Some("r"));
        let (node, row, column) = at_b(0, 1);
        assert_eq!(
            refused(&[&[TITLE, roleless]]),
            Some(GraphDataProblem::InvalidRole { node, row, column })
        );
        // A text missing, of another type, or holding a lone surrogate crosses as no text.
        let textless = (KindCode::Text, 1.0, RoleCode::Caption, None);
        assert_eq!(
            refused(&[title_row, title_row, &[textless]]),
            Some(invalid_text("b", 2, 0))
        );
        // Texts at the limit and past it, in UTF-16 code units, pairs counted twice.
        let long = |text: &str| {
            refused(&[
                title_row,
                &[TITLE, (KindCode::Text, 1.0, RoleCode::Body, Some(text))],
            ])
        };
        let too_long = Some(GraphDataProblem::ContentTextTooLong {
            node: "b".into(),
            row: 1,
            column: 1,
            field: "text".into(),
            limit: 1_000,
        });
        assert_eq!(long(&"x".repeat(MAX_TEXT)), None);
        assert_eq!(long(&"\u{1F600}".repeat(500)), None);
        assert_eq!(long(&"x".repeat(MAX_TEXT + 1)), too_long);
        assert_eq!(long(&("\u{1F600}".repeat(500) + "x")), too_long);
    }

    #[test]
    fn an_elements_fields_are_checked_in_their_order() {
        // Verifies: ADR-0034
        // A kind before a weight, a weight before a role, a role before the text.
        let (node, row, column) = at_b(0, 0);
        assert_eq!(
            refused(&[&[(KindCode::Unnamed, f64::NAN, RoleCode::Unnamed, None)]]),
            Some(GraphDataProblem::InvalidElementKind { node, row, column })
        );
        let (node, row, column) = at_b(0, 0);
        assert_eq!(
            refused(&[&[(KindCode::Text, f64::NAN, RoleCode::Unnamed, None)]]),
            Some(GraphDataProblem::InvalidWeight { node, row, column })
        );
        let (node, row, column) = at_b(0, 0);
        assert_eq!(
            refused(&[&[(KindCode::Text, 1.0, RoleCode::Unnamed, None)]]),
            Some(GraphDataProblem::InvalidRole { node, row, column })
        );
        assert_eq!(
            refused(&[&[(KindCode::Text, 1.0, RoleCode::Body, None)]]),
            Some(invalid_text("b", 0, 0))
        );
    }

    #[test]
    fn the_strings_of_a_loads_content_are_refused_past_their_budget_at_the_node_that_passes_it() {
        // Verifies: ADR-0034, Q-7
        // A million nodes of one text of 1,000 code units hold the budget of 1,000,000,000
        // exactly; one code unit more is refused at the node whose text passes it. The rule reads
        // the lengths off the boundaries alone, so the texts need not be held.
        let count = 1_000_000;
        let budget = |last: u32| {
            let mut text_bounds: Vec<u32> = (0..=count).map(|i| i * 1_000).collect();
            text_bounds[count as usize] = text_bounds[count as usize - 1] + last;
            let nodes: Vec<u32> = (0..=count).collect();
            let columns = ContentColumns {
                row_bounds: &nodes,
                element_bounds: &nodes,
                kinds: &vec![KindCode::Text as u8; count as usize],
                weights: &vec![1.0; count as usize],
                roles: &vec![RoleCode::Title as u8; count as usize],
                directions: &vec![0; count as usize],
                colors: &vec![f64::NAN; count as usize],
                segment_bounds: &vec![0; count as usize + 1],
                fractions: &[],
                segment_colors: &[],
                texts: &[],
                text_bounds: &text_bounds,
                text_valid: &vec![1; count as usize],
                names: &[],
                name_bounds: &[0],
                name_valid: &[],
            };
            let mut cursor = Cursor::default();
            let fonts = Fonts::default();
            (0..count as usize).try_for_each(|node| {
                let id = format!("n{node}");
                columns.check(node, &id, &mut cursor, &fonts).map(|_| ())
            })
        };
        assert_eq!(MAX_CONTENT_UNITS, 1_000_000_000);
        assert_eq!(budget(1_000), Ok(()));
        // The last text at 1,000 code units holds the budget; the limit of a text keeps it there,
        // so past it the text is refused for its length first.
        assert_eq!(
            budget(1_001)
                .err()
                .map(|problem| matches!(problem, GraphDataProblem::ContentTextTooLong { .. })),
            Some(true)
        );
        // The budget's own refusal, at the node whose string passes it.
        assert_eq!(
            check_content_budget("n9", f64::from(MAX_CONTENT_UNITS)),
            Ok(())
        );
        assert_eq!(
            check_content_budget("n9", f64::from(MAX_CONTENT_UNITS) + 1.0),
            Err(GraphDataProblem::ContentBudgetExceeded {
                node: "n9".into(),
                limit: 1_000_000_000
            })
        );
    }

    #[test]
    fn content_columns_that_do_not_fit_together_are_refused_as_malformed() {
        // Verifies: ADR-0034
        let fits = || b_of(&[&[TITLE], &[TITLE, TITLE]]);
        assert!(load_columns(&fits()).is_ok());
        let changes: [fn(&mut ContentData); 14] = [
            // The boundaries of the rows: from 0, never falling, to the rows there are.
            |c| c.row_bounds[0] = 1,
            |c| c.row_bounds = vec![0, 2, 1],
            |c| _ = c.row_bounds.pop(),
            // Of the elements, likewise.
            |c| c.element_bounds[0] = 1,
            |c| c.element_bounds[2] = 0,
            |c| c.element_bounds.push(4),
            // Every element's columns as long as there are elements.
            |c| _ = c.weights.pop(),
            |c| c.roles.push(0),
            // A code that is no code, and a validity byte above 1.
            |c| c.kinds[0] = KindCode::Unnamed as u8 + 1,
            |c| c.roles[1] = RoleCode::Unnamed as u8 + 1,
            |c| c.text_valid[2] = 2,
            // As many texts as the kinds fill: none for an element of no kind.
            |c| c.kinds[3] = KindCode::Unnamed as u8,
            |c| _ = c.text_bounds.pop(),
            |c| c.texts.push("x".to_owned()),
        ];
        for (i, change) in changes.into_iter().enumerate() {
            let mut columns = fits();
            change(&mut columns.content);
            assert_eq!(load_columns(&columns).err(), Some(unfit()), "change {i}");
        }
    }

    #[test]
    fn a_title_validity_byte_other_than_one_or_zero_is_refused_as_malformed() {
        // Verifies: ADR-0034
        for byte in [2, u8::MAX] {
            let mut columns = a_and(|_| {});
            columns.content.text_valid[1] = byte;
            assert_eq!(load_columns(&columns).err(), Some(unfit()));
        }
    }
}
