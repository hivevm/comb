//! The node content of graph data (ADR-0013, ADR-0034): its codes and limits, the columns a load's
//! content crosses as and the content of a single node read through serde-wasm-bindgen, both
//! checked by the one function below, and the content the engine keeps to lay out.
//!
//! Only `text` has columns and a code so far; each further kind of ADR-0013 adds its own with its
//! ticket, in the places ADR-0034 gives them.

use std::fmt;

use comb_engine::content::{self as layout, Cell, Element, Fonts, Placed, Role};
use serde::de::{self, IgnoredAny, Visitor};
use serde::{Deserialize, Deserializer};
use wasm_bindgen::prelude::wasm_bindgen;

use super::{
    ContentElement, GraphDataProblem, NodeContent, TEXT_LIMIT, TextRole, bounds_fit, numbered,
    utf16_length,
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

/// The code of an element's kind in its column (ADR-0034): `Unnamed` for an element whose kind
/// names none the snapshot codes, or that is no object, which its rule refuses.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KindCode {
    Text,
    Unnamed,
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

/// The kind of `name`, as the snapshot codes it, `Unnamed` for a string that names none.
pub(crate) fn kind_code(name: &str) -> KindCode {
    match name {
        "text" => KindCode::Text,
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
/// of another type, and a text's role's code, 0 for another kind; and the texts, every string an
/// element shows, concatenated in pieces as every string column is, with their boundaries and per
/// text whether it is a text.
#[derive(Clone, Copy)]
pub struct ContentColumns<'a> {
    pub row_bounds: &'a [u32],
    pub element_bounds: &'a [u32],
    pub kinds: &'a [u8],
    pub weights: &'a [f64],
    pub roles: &'a [u8],
    pub texts: &'a [String],
    pub text_bounds: &'a [u32],
    pub text_valid: &'a [u8],
}

/// Whether `bounds` are the boundaries of `count` runs of a column `total` long: one more than
/// there are runs, from 0, never falling, ending at `total`.
fn runs_fit(bounds: &[u32], count: usize, total: usize) -> bool {
    bounds.len() == count + 1
        && bounds.first() == Some(&0)
        && bounds.windows(2).all(|pair| pair[0] <= pair[1])
        && bounds.last().map(|&last| last as usize) == Some(total)
}

/// What a content check carries from one node to the next: the next text, and the code units of
/// the strings of content so far, against the budget.
pub(crate) struct Cursor {
    text: usize,
    units: u64,
    budget: u64,
}

impl Default for Cursor {
    fn default() -> Self {
        Self {
            text: 0,
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
    /// the elements' columns are as long as there are elements, each code names a kind or a role,
    /// or none, each validity byte is 1 or 0, and there are as many texts as the elements' kinds
    /// fill, one for each `text`.
    pub(crate) fn fit(&self, nodes: usize) -> bool {
        let elements = self.kinds.len();
        let rows = self.element_bounds.len().saturating_sub(1);
        let texts = self.text_valid.len();
        let filled = self
            .kinds
            .iter()
            .filter(|&&kind| kind == KindCode::Text as u8)
            .count();
        runs_fit(self.row_bounds, nodes, rows)
            && runs_fit(self.element_bounds, rows, elements)
            && self.weights.len() == elements
            && self.roles.len() == elements
            && self
                .kinds
                .iter()
                .all(|&kind| kind <= KindCode::Unnamed as u8)
            && self
                .roles
                .iter()
                .all(|&role| role <= RoleCode::Unnamed as u8)
            && self.text_valid.iter().all(|&valid| valid <= 1)
            && texts == filled
            && bounds_fit(self.text_bounds, texts, self.texts)
    }

    /// The range of the rows of the node at `node`.
    fn rows(&self, node: usize) -> std::ops::Range<usize> {
        self.row_bounds[node] as usize..self.row_bounds[node + 1] as usize
    }

    /// The range of the elements of the row at `row`, counted across all nodes.
    fn elements(&self, row: usize) -> std::ops::Range<usize> {
        self.element_bounds[row] as usize..self.element_bounds[row + 1] as usize
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
            let mut height: f64 = 0.0;
            for (c, element) in elements.enumerate() {
                let at = At {
                    node: id,
                    row: numbered(r),
                    column: numbered(c),
                };
                height = height.max(self.check_element(element, &at, cursor, fonts)?);
            }
            heights += height;
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
        if self.kinds[element] != KindCode::Text as u8 {
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
        let Some(role) = role_of(self.roles[element]) else {
            return Err(GraphDataProblem::InvalidRole {
                node: at.node(),
                row: at.row,
                column: at.column,
            });
        };
        self.check_text(at, "text", cursor)?;
        Ok(fonts.of(role).line_height())
    }

    /// Checks the next text, the field `field` of the element at `at`: that it is a text, its
    /// length, and the budget of the load's strings of content with it.
    fn check_text(
        &self,
        at: &At,
        field: &str,
        cursor: &mut Cursor,
    ) -> Result<(), GraphDataProblem> {
        let index = cursor.text;
        cursor.text += 1;
        if self.text_valid[index] != 1 {
            return Err(GraphDataProblem::InvalidContentText {
                node: at.node(),
                row: at.row,
                column: at.column,
                field: field.to_owned(),
            });
        }
        let length = (self.text_bounds[index + 1] - self.text_bounds[index]) as usize;
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
/// is checked, where each text lies in its piece.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ContentData {
    pub(crate) row_bounds: Vec<u32>,
    pub(crate) element_bounds: Vec<u32>,
    pub(crate) kinds: Vec<u8>,
    pub(crate) weights: Vec<f64>,
    pub(crate) roles: Vec<u8>,
    pub(crate) texts: Vec<String>,
    pub(crate) text_bounds: Vec<u32>,
    pub(crate) text_valid: Vec<u8>,
    /// Per text, its piece and the byte range it holds there, once mapped; none where every
    /// piece is ASCII, whose texts lie at their code units.
    pub(crate) spans: Vec<(u32, u32, u32)>,
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
            texts: &self.texts,
            text_bounds: &self.text_bounds,
            text_valid: &self.text_valid,
        }
    }

    /// Maps every text onto the string Rust holds, or refuses as malformed where a boundary falls
    /// inside a character. Called only once every text's length has been checked (ADR-0034).
    pub(crate) fn map(&mut self) -> Result<(), GraphDataProblem> {
        self.spans = super::text_spans(&self.texts, &self.text_bounds)?;
        Ok(())
    }

    /// The text at `index`, once mapped.
    pub(crate) fn text(&self, index: usize) -> &str {
        if self.spans.is_empty() {
            return self.ascii_text(index);
        }
        let (piece, start, end) = self.spans[index];
        // An empty text past the last piece, or in a column of no pieces, lies in none.
        self.texts
            .get(piece as usize)
            .map_or("", |piece| &piece[start as usize..end as usize])
    }

    /// The text at `index` of ASCII pieces, at its code units in the piece it lies in.
    fn ascii_text(&self, index: usize) -> &str {
        let (start, end) = (
            self.text_bounds[index] as usize,
            self.text_bounds[index + 1] as usize,
        );
        let mut base = 0;
        for piece in &self.texts {
            // A text no longer than nothing lies in no piece; any other lies whole in one.
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
        // Every element of content the bridge accepted is a text, which fills one text: the text
        // of an element is the one of its index.
        for row in view.rows(node) {
            let elements = view.elements(row);
            rows.push(numbered(elements.len()));
            for element in elements {
                let role = role_of(self.roles[element]).unwrap_or(Role::Body);
                cells.push(Cell {
                    weight: self.weights[element],
                    element: Element::Text {
                        role,
                        text: self.text(element),
                    },
                });
            }
        }
        layout::lay_out(cells, rows, width, fonts, out);
    }
}

/// The texts of the elements a query placed, as the shell draws them (ADR-0013): per element its
/// role's code and what is drawn of its text, the text or as much of it as fits followed by an
/// ellipsis, those strings one after another in `texts`, with their boundaries in UTF-16 code
/// units in `bounds`, one more than there are elements.
#[derive(Debug, Default)]
pub struct Drawn {
    pub roles: Vec<u8>,
    pub texts: String,
    pub bounds: Vec<u32>,
    units: u32,
}

impl Drawn {
    /// Starts the texts of a query anew.
    pub(crate) fn clear(&mut self) {
        self.roles.clear();
        self.texts.clear();
        self.bounds.clear();
        self.bounds.push(0);
        self.units = 0;
    }
}

impl ContentData {
    /// Pushes onto `drawn` the role and the drawn text of each element of the node at `node`,
    /// which `placed` holds in the order of its rows and theirs, as `lay_out` placed them.
    pub(crate) fn draw(&self, node: usize, placed: &[Placed], drawn: &mut Drawn) {
        if node + 1 >= self.row_bounds.len() {
            return;
        }
        let view = self.view();
        let elements = view.rows(node).flat_map(|row| view.elements(row));
        for (element, at) in elements.zip(placed) {
            drawn.roles.push(self.roles[element]);
            let text = self.text(element);
            let mut units = 0;
            let end = text
                .char_indices()
                .find(|&(_, character)| {
                    let past = units >= at.kept;
                    units += numbered(character.len_utf16());
                    past
                })
                .map_or(text.len(), |(byte, _)| byte);
            drawn.texts.push_str(&text[..end]);
            drawn.units += at.kept.min(units);
            if at.ellipsis {
                drawn.texts.push(layout::ELLIPSIS);
                drawn.units += 1;
            }
            drawn.bounds.push(drawn.units);
        }
    }

    /// The height the content of the node at `node` lays out to in `fonts`, as the `f32` the engine
    /// keeps; that of no rows for a node without content, as only the tests build one.
    pub(crate) fn height(&self, node: usize, fonts: &Fonts) -> f32 {
        let view = self.view();
        let rows = (node + 1 < self.row_bounds.len())
            .then(|| view.rows(node))
            .into_iter()
            .flatten();
        let heights = rows.map(|row| {
            view.elements(row)
                .filter_map(|element| role_of(self.roles[element]))
                .map(|role| fonts.of(role).line_height())
                .fold(0.0, f64::max)
        });
        super::kept_height(layout::node_height(heights))
    }

    /// The content of the node at `node`, as the host application's type describes it: what
    /// inspection and the changes Comb tells report, built when asked.
    pub(crate) fn content_of(&self, node: usize) -> NodeContent {
        if node + 1 >= self.row_bounds.len() {
            return NodeContent(Vec::new());
        }
        let view = self.view();
        let row = |row| {
            view.elements(row)
                .map(|element| ContentElement::Text {
                    role: match role_of(self.roles[element]) {
                        Some(Role::Title) => TextRole::Title,
                        Some(Role::Caption) => TextRole::Caption,
                        _ => TextRole::Body,
                    },
                    text: self.text(element).to_owned(),
                    weight: Some(self.weights[element]),
                })
                .collect()
        };
        NodeContent(view.rows(node).map(row).collect())
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
    /// written, its texts one value each onto `texts`, which the caller cuts into pieces.
    pub(crate) fn append(&mut self, node: &Self, texts: &mut Vec<String>) {
        let base = numbered(self.kinds.len());
        let ends = node.element_bounds.windows(2).map(|pair| base + pair[1]);
        self.element_bounds.extend(ends);
        self.kinds.extend(&node.kinds);
        self.weights.extend(&node.weights);
        self.roles.extend(&node.roles);
        let values = super::values(&node.texts, &node.text_bounds).expect("texts of one node");
        for value in values {
            let last = self.text_bounds[self.text_bounds.len() - 1];
            self.text_bounds.push(last + numbered(utf16_length(value)));
            texts.push(value.to_owned());
        }
        self.text_valid.extend(&node.text_valid);
    }
}

/// Where the snapshot found a shape of content it cannot flatten in a node: the row, and below a
/// row the column, of a row that is no list or an element that is no object.
pub type Shape = (u32, Option<u32>);

/// The content of the node of `addNode` or of a patch of `updateNode` as the host application
/// handed it over, read through serde-wasm-bindgen as the snapshot hands a load's over in
/// columns: a row that is no list as a row of no elements, an element that is no object as one
/// of no kind, each element's kind and role by their codes, a weight left out as 1 and one of
/// another type as NaN, a text of another type as none; and the first shape it could not flatten.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ContentInput {
    pub(crate) data: ContentData,
    pub(crate) shape: Option<Shape>,
}

impl ContentInput {
    /// Starts the content of one node.
    pub(crate) fn new() -> Self {
        Self {
            data: ContentData {
                row_bounds: vec![0, 0],
                element_bounds: vec![0],
                text_bounds: vec![0],
                ..ContentData::default()
            },
            shape: None,
        }
    }

    /// Ends a row, of the elements pushed since the row before.
    pub(crate) fn end_row(&mut self) {
        let data = &mut self.data;
        data.element_bounds.push(numbered(data.kinds.len()));
        data.row_bounds[1] += 1;
    }

    /// Adds an element of `kind`, `weight`, and `role`, and where it is a `text`, its text, none
    /// for one of another type, which crosses empty and marked as no text.
    pub(crate) fn push(&mut self, kind: KindCode, weight: f64, role: u8, text: Option<&str>) {
        let data = &mut self.data;
        data.kinds.push(kind as u8);
        data.weights.push(weight);
        data.roles.push(role);
        if kind == KindCode::Text {
            let given = text.is_some();
            let text = text.unwrap_or("");
            let last = data.text_bounds[data.text_bounds.len() - 1];
            data.text_bounds.push(last + numbered(utf16_length(text)));
            data.text_valid.push(u8::from(given));
            match data.texts.first_mut() {
                Some(piece) => piece.push_str(text),
                None if !text.is_empty() => data.texts.push(text.to_owned()),
                None => {}
            }
        }
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
                content.shape.get_or_insert((row, None));
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
                    content.push(kind, cells.weight, role as u8, cells.text.as_deref());
                }
                None => {
                    content.shape.get_or_insert((row, Some(column)));
                    content.push(KindCode::Unnamed, f64::NAN, 0, None);
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

/// An element as the host application handed it over: its fields, each of its type or none, a
/// weight left out or null 1 and one of another type NaN, or none where it is no object.
struct ElementCells(Option<Fields>);

struct Fields {
    kind: Option<String>,
    role: Option<String>,
    weight: f64,
    text: Option<String>,
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
            text: None,
        };
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "kind" => fields.kind = map.next_value::<Lenient<String>>()?.0,
                "role" => fields.role = map.next_value::<Lenient<String>>()?.0,
                "weight" => {
                    let weight = map.next_value::<Lenient<Option<f64>>>()?.0;
                    fields.weight = weight.map_or(f64::NAN, |weight| weight.unwrap_or(1.0));
                }
                "text" => fields.text = map.next_value::<Lenient<String>>()?.0,
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

/// A value of `T`, or none where it holds a value of another type, which is read and dropped.
struct Lenient<T>(Option<T>);

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Lenient<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self(T::deserialize(deserializer).ok()))
    }
}
