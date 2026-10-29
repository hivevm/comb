//! The reading and checking of graph data, the one place that validates it (ADR-0028, ADR-0032):
//! the limits of a load, the lenient readers of fields, the input types, the columns of a load's
//! nodes, and the checks that turn a load into the engine's graph and a patch of `updateNode` into
//! what the store merges. The exports in the crate root hand graph data here and pass on what it
//! returns.

use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::fmt;

use comb_engine::geometry::{self as graph_side, Sides, WORLD_LIMIT};
use comb_engine::graph::{
    self, AddEdgeError, EdgeSpec, Graph, GraphError, LabelPlacement, SlotError, TooManySlots,
};
use comb_engine::stroke::EdgeStyle;
use serde::de::{self, IgnoredAny, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

/// The most UTF-16 code units, the length JavaScript gives a string, of a node's title or an edge
/// label's text.
pub const MAX_TEXT: usize = TEXT_LIMIT as usize;

/// The most nodes, and the most edges, of one graph.
pub const MAX_ITEMS: u32 = 1_000_000;

/// The most UTF-16 code units of an identifier: a node's or an edge's, or an edge's source or
/// target.
pub const MAX_ID: usize = ID_LIMIT as usize;

/// The most UTF-16 code units of all identifiers of one load together, sources and targets
/// among them, so that the identifiers of a graph within its other limits cost a bounded copy.
pub const MAX_ID_UNITS: u32 = 64_000_000;

/// `MAX_TEXT` as the `u32` a refusal and `textLimit` name, declared in the narrower type so that
/// `MAX_TEXT` widens it.
pub(crate) const TEXT_LIMIT: u32 = 1_000;

/// `MAX_ID` as the `u32` a refusal and `idLimit` name, declared in the narrower type so that
/// `MAX_ID` widens it.
pub(crate) const ID_LIMIT: u32 = 256;

/// The length of a text in UTF-16 code units, as JavaScript counts it.
fn utf16_length(text: &str) -> usize {
    if text.is_ascii() {
        text.len()
    } else {
        text.encode_utf16().count()
    }
}

/// The length in UTF-16 code units of a field the engine does not keep, or none where it holds
/// no string. A value of another type is refused naming its node or edge and the field, not as
/// malformed data; serde-wasm-bindgen gives each value a deserializer of its own, so the refused
/// one leaves the rest to read. The text itself is not kept: the bridge only checks it.
fn text_length<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<usize>, D::Error> {
    Ok(String::deserialize(deserializer)
        .ok()
        .map(|text| utf16_length(&text)))
}

/// A field the engine does not keep that holds a number or nothing: `None` for null or
/// undefined, NaN for a value of another type, a BigInt among them, so that the check refuses
/// it by name.
fn optional_number<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<f64>, D::Error> {
    Ok(Option::<f64>::deserialize(deserializer).unwrap_or(Some(f64::NAN)))
}

/// A field of a node or an edge as the host application handed it over: its value, or none where
/// the field is missing or holds a value of another type, which the bridge refuses naming the
/// node or edge and the field (`invalidField`), not as malformed data. serde-wasm-bindgen gives
/// each value a deserializer of its own, so the refused one leaves the rest to read; the error
/// that refused it is dropped unread, and the value never reaches a message. Its TypeScript type
/// is that of the value, which each field names.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Field<T>(pub Option<T>);

impl<T> Default for Field<T> {
    fn default() -> Self {
        Self(None)
    }
}

thread_local! {
    /// Whether a field of the current `reading` was refused.
    static REFUSED: Cell<bool> = const { Cell::new(false) };
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Field<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = T::deserialize(deserializer).ok();
        if value.is_none() {
            REFUSED.set(true);
        }
        Ok(Self(value))
    }
}

/// What `read` deserializes, a batch, with the nodes and edges after the first with a refused
/// field left unread: only that field is named, so that a graph of a million refused fields costs
/// no million errors of serde-wasm-bindgen.
pub(crate) fn reading<T>(read: impl FnOnce() -> T) -> T {
    reading_after(false, read)
}

/// What `read` deserializes, the edges of a load, after nodes of which one was `refused` by its
/// type or not: after one, every edge is left unread, as it would be after a refused node in the
/// same list, so that the load names the node and costs no reading of the edges.
pub(crate) fn reading_after<T>(refused: bool, read: impl FnOnce() -> T) -> T {
    REFUSED.set(refused);
    let value = read();
    REFUSED.set(false);
    value
}

/// The items of a list of graph data, each read in full until one holds a refused field, and the
/// rest left unread, as items without fields, so that the list keeps its length.
fn items<'de, D: Deserializer<'de>, T: Deserialize<'de> + Default>(
    deserializer: D,
) -> Result<Vec<T>, D::Error> {
    deserializer.deserialize_seq(Items(std::marker::PhantomData))
}

struct Items<T>(std::marker::PhantomData<T>);

/// A value left unread.
struct Unread;

impl<'de> Deserialize<'de> for Unread {
    fn deserialize<D: Deserializer<'de>>(_deserializer: D) -> Result<Self, D::Error> {
        Ok(Self)
    }
}

impl<'de, T: Deserialize<'de> + Default> Visitor<'de> for Items<T> {
    type Value = Vec<T>;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a list")
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<T>, A::Error> {
        let mut items = Vec::new();
        loop {
            let item = if REFUSED.get() {
                seq.next_element::<Unread>()?.map(|Unread| T::default())
            } else {
                seq.next_element::<T>()?
            };
            match item {
                Some(item) => items.push(item),
                None => return Ok(items),
            }
        }
    }
}

#[cfg(test)]
impl<T> From<T> for Field<T> {
    fn from(value: T) -> Self {
        Self(Some(value))
    }
}

/// A value of the patch of `updateNode`: the string it holds, or none where it holds a value of
/// another type.
pub struct Text(pub Option<String>);

impl<'de> Deserialize<'de> for Text {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self(String::deserialize(deserializer).ok()))
    }
}

/// A node as the host application hands it over: its identifier, its title, the position of its
/// top-left corner, and its size.
#[derive(Tsify, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    #[tsify(type = "string")]
    pub id: Field<String>,
    /// Missing, it is refused by name, which makes it optional in the generated type.
    #[tsify(type = "string")]
    #[serde(rename = "title", default, deserialize_with = "text_length")]
    pub title_length: Option<usize>,
    #[tsify(type = "number")]
    pub x: Field<f64>,
    #[tsify(type = "number")]
    pub y: Field<f64>,
    #[tsify(type = "number")]
    pub width: Field<f64>,
    #[tsify(type = "number")]
    pub height: Field<f64>,
}

/// An edge label: its text, where it sits by path parameter `t` and label offset in pixels
/// (G-6), and the colour of its background as `0xRRGGBB`, the edge's own without one.
#[derive(Tsify, Deserialize, Clone, Copy)]
pub struct LabelInput {
    #[tsify(type = "string")]
    #[serde(rename = "text", default, deserialize_with = "text_length")]
    pub text_length: Option<usize>,
    #[tsify(type = "number")]
    pub t: Field<f64>,
    #[tsify(type = "number")]
    pub offset: Field<f64>,
    #[tsify(optional)]
    #[serde(default, deserialize_with = "optional_number")]
    pub background: Option<f64>,
}

/// Whether an arrowhead marks the end of an edge.
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Arrow {
    End,
    None,
}

/// A side of a node, at whose middle its connector sits (ADR-0024).
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Top,
    Right,
    Bottom,
    Left,
}

impl From<graph_side::Side> for Side {
    fn from(side: graph_side::Side) -> Self {
        match side {
            graph_side::Side::Top => Self::Top,
            graph_side::Side::Right => Self::Right,
            graph_side::Side::Bottom => Self::Bottom,
            graph_side::Side::Left => Self::Left,
        }
    }
}

impl From<Side> for graph_side::Side {
    fn from(side: Side) -> Self {
        match side {
            Side::Top => Self::Top,
            Side::Right => Self::Right,
            Side::Bottom => Self::Bottom,
            Side::Left => Self::Left,
        }
    }
}

/// An edge between two nodes, named by their identifiers, with the style it is drawn with: its
/// colour as `0xRRGGBB`, its dash pattern as dash and gap lengths in world units (none for a
/// solid line), and whether an arrowhead marks its end (G-11).
#[derive(Tsify, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInput {
    #[tsify(type = "string")]
    pub id: Field<String>,
    #[tsify(type = "string")]
    pub source: Field<String>,
    #[tsify(type = "string")]
    pub target: Field<String>,
    #[tsify(type = "LabelInput", optional)]
    pub label: Field<Option<LabelInput>>,
    #[tsify(type = "number")]
    pub color: Field<f64>,
    #[tsify(type = "[number, number]", optional)]
    pub dash: Field<Option<Pair>>,
    #[tsify(type = "Arrow")]
    pub arrow: Field<Arrow>,
    /// The side of its source it leaves by; `api` fills in `right` (ADR-0024).
    #[tsify(type = "Side")]
    pub source_side: Field<Side>,
    /// The side of its target it enters by; `api` fills in `left`.
    #[tsify(type = "Side")]
    pub target_side: Field<Side>,
}

/// A dash pattern: a list of exactly two numbers, the dash and the gap.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pair(pub [f64; 2]);

impl<'de> Deserialize<'de> for Pair {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(PairVisitor)
    }
}

struct PairVisitor;

impl<'de> Visitor<'de> for PairVisitor {
    type Value = Pair;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a list of two numbers")
    }

    /// Reads two numbers, and refuses a list that holds a third without reading the rest.
    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<Pair, A::Error> {
        let mut next = |read| {
            seq.next_element()?
                .ok_or_else(|| de::Error::invalid_length(read, &self))
        };
        let pair = [next(0)?, next(1)?];
        if seq.next_element::<IgnoredAny>()?.is_some() {
            return Err(de::Error::invalid_length(3, &self));
        }
        Ok(Pair(pair))
    }
}

/// The edges of one load, in slot order; its nodes cross as `NodeColumns`.
#[derive(Tsify, Deserialize)]
pub struct EdgeList(#[serde(deserialize_with = "items")] pub Vec<EdgeInput>);

/// A field of a node that a load's first pass refuses by its type (ADR-0032), as the shell names
/// the first such value it reads: `Item` for a node that is no object, refused as malformed. It
/// crosses as its code, a plain number, so that a code it does not know is refused as malformed
/// rather than thrown by the glue while the engine is borrowed, which would wedge it.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeField {
    Item,
    Id,
    X,
    Y,
    Width,
    Height,
}

/// The nodes of one load as columns (ADR-0032), each in slot order. The identifiers and the
/// titles are each one string, the values concatenated, with their boundaries in UTF-16 code
/// units, one more than there are nodes, a refused value empty; `title_texts` holds per node
/// whether its title is a text, 1 or 0. The numbers are as the host application handed them.
/// `refused` is the first value the shell read that the first pass refuses, its node's index and
/// its field, or none.
pub struct NodeColumns<'a> {
    pub ids: &'a str,
    pub id_bounds: &'a [u32],
    pub titles: &'a str,
    pub title_bounds: &'a [u32],
    pub title_texts: &'a [u8],
    pub x: &'a [f64],
    pub y: &'a [f64],
    pub width: &'a [f64],
    pub height: &'a [f64],
    pub refused: Option<(u32, NodeField)>,
}

/// Columns that do not fit together, which the shell never hands over.
fn unfit() -> GraphDataProblem {
    malformed("the columns of the nodes do not fit together")
}

impl NodeField {
    /// The field of `code`, its discriminant, or none for a code no field has.
    fn of(code: u32) -> Option<Self> {
        [
            Self::Item,
            Self::Id,
            Self::X,
            Self::Y,
            Self::Width,
            Self::Height,
        ]
        .into_iter()
        .find(|&field| field as u32 == code)
    }
}

/// The first value a load's first pass refuses, as `loadGraph` takes it: the index of its node
/// and the code of its field, both or neither, and a code no field has refused as malformed.
pub(crate) fn refused_of(
    at: Option<u32>,
    field: Option<u32>,
) -> Result<Option<(u32, NodeField)>, GraphDataProblem> {
    match (at, field.map(NodeField::of)) {
        (Some(at), Some(Some(field))) => Ok(Some((at, field))),
        (None, None) => Ok(None),
        _ => Err(unfit()),
    }
}

/// Whether `bounds` are the boundaries of `count` values of a string of `units` UTF-16 code
/// units: one more than there are values, from 0, never falling, and ending at its end.
fn bounds_fit(bounds: &[u32], count: usize, units: usize) -> bool {
    bounds.len() == count + 1
        && bounds.first() == Some(&0)
        && bounds.windows(2).all(|pair| pair[0] <= pair[1])
        && bounds.last().map(|&end| end as usize) == Some(units)
}

/// The lengths of the values of a string column, read off its boundaries.
fn lengths(bounds: &[u32]) -> impl Iterator<Item = usize> + '_ {
    bounds.windows(2).map(|pair| (pair[1] - pair[0]) as usize)
}

/// The value at `index` of a string column, with a character a boundary cuts in two given as
/// U+FFFD at each side, as the shell's string of the value alone would have crossed: to name a
/// node before its column is mapped, which takes no boundary as falling between characters.
fn value_at(text: &str, bounds: &[u32], index: usize) -> String {
    let (start, end) = (bounds[index] as usize, bounds[index + 1] as usize);
    let mut value = String::new();
    if start == end {
        return value;
    }
    let mut units = 0;
    for character in text.chars() {
        let next = units + character.len_utf16();
        if next > start && units < end {
            let whole = units >= start && next <= end;
            value.push(if whole { character } else { '\u{FFFD}' });
        }
        if next >= end {
            break;
        }
        units = next;
    }
    value
}

/// The values of a string column as slices of `text`, or a refusal as malformed where a boundary
/// falls inside a character. Called only once every value's length is checked: a value the shell
/// cut one code unit beyond its limit may end in half a surrogate pair, and two such values side
/// by side make one character across their boundary.
fn values<'a>(text: &'a str, bounds: &[u32]) -> Result<Vec<&'a str>, GraphDataProblem> {
    let offsets: Vec<usize> = if text.is_ascii() {
        bounds.iter().map(|&bound| bound as usize).collect()
    } else {
        let mut offsets = Vec::with_capacity(bounds.len());
        let mut next = bounds.iter().map(|&bound| bound as usize).peekable();
        let mut units = 0;
        for (byte, character) in text.char_indices() {
            while next.next_if_eq(&units).is_some() {
                offsets.push(byte);
            }
            units += character.len_utf16();
            if next.peek().is_some_and(|&bound| bound < units) {
                return Err(malformed("an identifier ends inside a character"));
            }
        }
        offsets.extend(next.map(|_| text.len()));
        offsets
    };
    Ok(offsets.windows(2).map(|at| &text[at[0]..at[1]]).collect())
}

impl NodeColumns<'_> {
    /// The number of nodes, or a refusal as malformed where the columns do not fit together.
    fn count(&self) -> Result<usize, GraphDataProblem> {
        let count = self.x.len();
        let numbers = [self.y, self.width, self.height].map(<[f64]>::len);
        let fit = numbers.iter().all(|&len| len == count)
            && self.title_texts.len() == count
            && bounds_fit(self.id_bounds, count, utf16_length(self.ids))
            && bounds_fit(self.title_bounds, count, utf16_length(self.titles))
            && self
                .refused
                .is_none_or(|(index, _)| (index as usize) < count);
        if fit { Ok(count) } else { Err(unfit()) }
    }

    /// The first pass over the nodes: the first value the shell refused by its type, named as a
    /// node of the batch names it, its identifier where it was read.
    fn first_refused(&self) -> Result<(), GraphDataProblem> {
        let Some((index, field)) = self.refused else {
            return Ok(());
        };
        let index = index as usize;
        let (name, expected) = match field {
            NodeField::Item => return Err(unshaped("a node is no object")),
            NodeField::Id => ("id", AN_ID),
            NodeField::X => ("x", A_NUMBER),
            NodeField::Y => ("y", A_NUMBER),
            NodeField::Width => ("width", A_SIZE),
            NodeField::Height => ("height", A_SIZE),
        };
        let id = (field != NodeField::Id).then(|| value_at(self.ids, self.id_bounds, index));
        let mut item = Item::new(GraphList::Nodes, index);
        item.id = id.as_deref();
        item.read(name, Field::<()>(None), expected)
    }

    /// The nodes with every field read, their identifiers mapped onto the string Rust holds.
    fn nodes(&self) -> Result<Vec<Node<'_>>, GraphDataProblem> {
        let ids = values(self.ids, self.id_bounds)?;
        let titles = lengths(self.title_bounds).zip(self.title_texts);
        Ok(ids
            .into_iter()
            .zip(titles)
            .enumerate()
            .map(|(i, (id, (length, &text)))| Node {
                id,
                title_length: (text == 1).then_some(length),
                x: self.x[i],
                y: self.y[i],
                width: self.width[i],
                height: self.height[i],
            })
            .collect())
    }
}

/// Which list of graph data an item belongs to.
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GraphList {
    Nodes,
    Edges,
}

/// Why Comb refused graph data in `load`, `updateNode`, or `addNode` (Q-7): what the bridge
/// refused, what the shell could not read, and what only the shell's map from identifiers to slots
/// knows, a node `updateNode` names that the graph does not hold and one `addNode` adds that it
/// holds already (ADR-0028). The shell builds the last three as values of this type; no kind of it
/// is written by hand in TypeScript.
/// `query` refuses a rectangle without its shape as malformed too, which no host application
/// meets.
#[derive(Tsify, Serialize, Deserialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GraphDataProblem {
    /// The value did not have the shape the export expects: graph data that is no object, a list
    /// that is no list, a node or an edge that is no object, or a patch that is no plain object.
    #[serde(rename_all = "camelCase")]
    Malformed { message: String },
    /// A field of the item at `index` of `list`, the node or edge `id` where its identifier was
    /// read, is missing or holds a value of another type; `field` names it, a label's as
    /// `label.t`, and `expected` says in words what it holds.
    #[serde(rename_all = "camelCase")]
    InvalidField {
        list: GraphList,
        index: u32,
        #[tsify(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        field: String,
        expected: String,
    },
    /// A node's coordinate is NaN or infinite.
    #[serde(rename_all = "camelCase")]
    NonFiniteCoordinate { node: String },
    /// A node's coordinate or the far side of its extent, or an edge label's offset, lies more
    /// than `limit` world units from the origin, past which what the engine derives from it could
    /// turn infinite; `field` names it, the far side of a node by its `width` or `height`, a
    /// label's offset as `label.offset`.
    #[serde(rename_all = "camelCase")]
    BeyondWorld {
        list: GraphList,
        id: String,
        field: String,
        limit: f64,
    },
    /// A node's width or height is negative, NaN, or infinite.
    #[serde(rename_all = "camelCase")]
    InvalidSize { node: String },
    /// A node's title, in a load or a patch, is not a string.
    #[serde(rename_all = "camelCase")]
    InvalidTitle { node: String },
    /// A node's title, in a load or a patch, is longer than `limit` UTF-16 code units.
    #[serde(rename_all = "camelCase")]
    TitleTooLong { node: String, limit: u32 },
    /// A patch of a node holds a field other than its title.
    #[serde(rename_all = "camelCase")]
    UnknownPatchField { node: String, field: String },
    /// Two nodes share an identifier, in a load, or `addNode` adds a node of an identifier the
    /// graph holds already.
    #[serde(rename_all = "camelCase")]
    DuplicateNode { node: String },
    /// Two edges share an identifier.
    #[serde(rename_all = "camelCase")]
    DuplicateEdge { edge: String },
    /// An edge names a node that is not in the batch, or, for `addEdge`, one the graph does not
    /// hold.
    #[serde(rename_all = "camelCase")]
    MissingNode { edge: String, node: String },
    /// An edge label's path parameter or label offset is NaN or infinite.
    #[serde(rename_all = "camelCase")]
    NonFiniteLabel { edge: String },
    /// An edge label's text is not a string.
    #[serde(rename_all = "camelCase")]
    InvalidLabelText { edge: String },
    /// An edge label's text is longer than `limit` UTF-16 code units.
    #[serde(rename_all = "camelCase")]
    LabelTextTooLong { edge: String, limit: u32 },
    /// An edge label's background is not an integer from `0` to `0xFFFFFF`.
    #[serde(rename_all = "camelCase")]
    InvalidBackground { edge: String },
    /// An edge's colour is not an integer from `0` to `0xFFFFFF`.
    #[serde(rename_all = "camelCase")]
    InvalidColor { edge: String },
    /// An edge's dash is not positive or its gap negative, or either is not finite.
    #[serde(rename_all = "camelCase")]
    InvalidDash { edge: String },
    /// A graph holds more than `limit` nodes or edges, loaded or after an addition; `list` names
    /// which.
    #[serde(rename_all = "camelCase")]
    TooMany { list: String, limit: u32 },
    /// An identifier is longer than `limit` UTF-16 code units: `field` (`id`, `source`, or
    /// `target`) of the item at `index` of `list` (`nodes` or `edges`).
    #[serde(rename_all = "camelCase")]
    IdTooLong {
        list: String,
        index: u32,
        field: String,
        limit: u32,
    },
    /// The identifiers of one load hold more than `limit` UTF-16 code units together.
    #[serde(rename_all = "camelCase")]
    IdBudgetExceeded { limit: u32 },
    /// `updateNode` or `removeNodes` names a node the graph does not hold.
    #[serde(rename_all = "camelCase")]
    UnknownNode { node: String },
    /// `removeEdges` or `updateEdge` names an edge the graph does not hold.
    #[serde(rename_all = "camelCase")]
    UnknownEdge { edge: String },
    /// `addEdge` hands over an edge from a node to itself, which a load accepts (ADR-0024).
    #[serde(rename_all = "camelCase")]
    SelfEdge { edge: String },
    /// A patch of `updateEdge` holds a field other than `color`, `dash`, `arrow`, `label`,
    /// `sourceSide`, and `targetSide`.
    #[serde(rename_all = "camelCase")]
    UnknownEdgePatchField { edge: String, field: String },
}

/// A value that does not have the shape an export expects. Its message is the bridge's own: the
/// error is dropped and the value not formatted into it, so that a refused value of any size
/// costs no copy and no message names a type of the bridge crate.
pub(crate) fn unshaped(_error: impl std::fmt::Display) -> GraphDataProblem {
    malformed("the value does not have the shape the bridge expects")
}

/// Malformed data, with a message in plain words that names no type of the bridge crate.
pub(crate) fn malformed(message: &str) -> GraphDataProblem {
    GraphDataProblem::Malformed {
        message: message.to_owned(),
    }
}

/// A graph the engine refuses after the bridge's own checks is malformed data. Each refusal is
/// named, so that a new one is decided here rather than passed on by default.
impl From<GraphError> for GraphDataProblem {
    fn from(error: GraphError) -> Self {
        malformed(match error {
            GraphError::SlotCountMismatch => "the positions and sizes do not match the nodes",
            GraphError::EdgeEndOutOfRange { .. } => "an edge ends at a node beyond the graph",
            GraphError::TooManySlots => "the graph holds more items than the engine can number",
        })
    }
}

/// A count or an addition past the slots the engine numbers is refused as a graph too large for
/// it, the message of `GraphError::TooManySlots`.
impl From<TooManySlots> for GraphDataProblem {
    fn from(error: TooManySlots) -> Self {
        GraphError::from(error).into()
    }
}

/// The engine's conversion of a count to slots, so that both refuse the same counts.
pub(crate) fn slot(index: usize) -> Result<u32, GraphDataProblem> {
    Ok(graph::slot(index)?)
}

/// What a field expects, as `invalidField` says it: plain words, no type of the bridge crate.
const A_NUMBER: &str = "a finite number";
const A_SIZE: &str = "a finite number of 0 or more";
const A_COLOR: &str = "an integer from 0 to 0xFFFFFF";
const A_LABEL: &str = "an object, or none";
const A_DASH: &str = "a list of two finite numbers, or none";
const AN_ARROW: &str = "\"end\" or \"none\"";
const A_SIDE: &str = "\"top\", \"right\", \"bottom\", or \"left\"";

/// What an identifier, a source, or a target expects, by `MAX_ID`.
const AN_ID: &str = "a well-formed string of at most 256 code units";

/// A node with every field read.
struct Node<'a> {
    id: &'a str,
    title_length: Option<usize>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// An edge label with every field read.
struct Label {
    text_length: Option<usize>,
    t: f64,
    offset: f64,
    background: Option<f64>,
}

/// An edge with every field read.
struct Edge<'a> {
    id: &'a str,
    source: &'a str,
    target: &'a str,
    label: Option<Label>,
    color: f64,
    dash: Option<[f64; 2]>,
    arrow: Arrow,
    sides: Sides,
}

/// A batch with every field of every node and edge read.
struct Batch<'a> {
    nodes: Vec<Node<'a>>,
    edges: Vec<Edge<'a>>,
}

/// The item at `index` of `list` while its fields are read, `id` once its identifier is.
struct Item<'a> {
    list: GraphList,
    index: usize,
    id: Option<&'a str>,
}

impl<'a> Item<'a> {
    fn new(list: GraphList, index: usize) -> Self {
        Self {
            list,
            index,
            id: None,
        }
    }

    /// The value of `field`, or the refusal that names the item and the field.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "an index below the count of its list, which the bridge checked against \
                  `MAX_ITEMS` first (ADR-0028)"
    )]
    fn read<T>(&self, field: &str, value: Field<T>, expected: &str) -> Result<T, GraphDataProblem> {
        value.0.ok_or_else(|| GraphDataProblem::InvalidField {
            list: self.list,
            index: self.index as u32,
            id: self.id.map(str::to_owned),
            field: field.to_owned(),
            expected: expected.to_owned(),
        })
    }

    /// The identifier `field` of the item, read in place.
    fn id(&self, field: &str, value: &'a Field<String>) -> Result<&'a str, GraphDataProblem> {
        self.read(field, Field(value.0.as_deref()), AN_ID)
    }
}

/// The node at `index` with every field read, or the refusal that names its first missing or
/// mistyped field.
fn node_of(index: usize, node: &NodeInput) -> Result<Node<'_>, GraphDataProblem> {
    let mut item = Item::new(GraphList::Nodes, index);
    let id = item.id("id", &node.id)?;
    item.id = Some(id);
    Ok(Node {
        id,
        title_length: node.title_length,
        x: item.read("x", node.x, A_NUMBER)?,
        y: item.read("y", node.y, A_NUMBER)?,
        width: item.read("width", node.width, A_SIZE)?,
        height: item.read("height", node.height, A_SIZE)?,
    })
}

/// The edge at `index` with every field read, or the refusal that names its first missing or
/// mistyped field.
fn edge_of(index: usize, edge: &EdgeInput) -> Result<Edge<'_>, GraphDataProblem> {
    let mut item = Item::new(GraphList::Edges, index);
    let id = item.id("id", &edge.id)?;
    item.id = Some(id);
    let source = item.id("source", &edge.source)?;
    let target = item.id("target", &edge.target)?;
    let label = label_of(&item, edge.label)?;
    Ok(Edge {
        id,
        source,
        target,
        label,
        color: item.read("color", edge.color, A_COLOR)?,
        dash: item.read("dash", edge.dash, A_DASH)?.map(|Pair(pair)| pair),
        arrow: item.read("arrow", edge.arrow, AN_ARROW)?,
        sides: Sides {
            source: item.read("sourceSide", edge.source_side, A_SIDE)?.into(),
            target: item.read("targetSide", edge.target_side, A_SIDE)?.into(),
        },
    })
}

/// The label `field` of the edge `item`, or none, with every field read, as a load, `addEdge`, and
/// a patch of `updateEdge` read it, or the refusal that names its first missing or mistyped field.
fn label_of(
    item: &Item,
    field: Field<Option<LabelInput>>,
) -> Result<Option<Label>, GraphDataProblem> {
    item.read("label", field, A_LABEL)?
        .map(|input| {
            Ok(Label {
                text_length: input.text_length,
                t: item.read("label.t", input.t, A_NUMBER)?,
                offset: item.read("label.offset", input.offset, A_NUMBER)?,
                background: input.background,
            })
        })
        .transpose()
}

/// Reads every field of every edge of a load, or names the first that is missing or holds a value
/// of another type.
fn edges_read(edges: &[EdgeInput]) -> Result<Vec<Edge<'_>>, GraphDataProblem> {
    let edges = edges.iter().enumerate().map(|(i, e)| edge_of(i, e));
    edges.collect()
}

/// The nodes of a batch as the engine takes them: positions and sizes, `x, y` and `width, height`
/// per slot, and the map from identifier to slot.
struct Nodes<'a> {
    positions: Vec<f32>,
    sizes: Vec<f32>,
    slots: HashMap<&'a str, u32>,
}

/// The position and size of a node as the engine keeps them, `[x, y]` and `[width, height]`, or
/// why the node was refused: a coordinate or a size `f32` cannot hold, or a title that is no text
/// or too long.
fn checked_node(node: &Node) -> Result<([f32; 2], [f32; 2]), GraphDataProblem> {
    let named = || node.id.to_owned();
    // Checked as the engine keeps them: a number beyond `f32` is as infinite as infinity.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "checked as f32 below, so that what f32 cannot hold is refused"
    )]
    let [x, y, width, height] = [node.x, node.y, node.width, node.height].map(|v| v as f32);
    if !x.is_finite() || !y.is_finite() {
        return Err(GraphDataProblem::NonFiniteCoordinate { node: named() });
    }
    if !(width.is_finite() && height.is_finite()) || width < 0.0 || height < 0.0 {
        return Err(GraphDataProblem::InvalidSize { node: named() });
    }
    // Also its far side, `x + width` and `y + height`, which `f32` may hold where their sum
    // turns infinite.
    let beyond = [
        ("x", x, 0.0),
        ("y", y, 0.0),
        ("width", x, width),
        ("height", y, height),
    ]
    .into_iter()
    .find(|&(_, at, size)| (f64::from(at) + f64::from(size)).abs() > WORLD_LIMIT);
    if let Some((field, ..)) = beyond {
        return Err(GraphDataProblem::BeyondWorld {
            list: GraphList::Nodes,
            id: named(),
            field: field.to_owned(),
            limit: WORLD_LIMIT,
        });
    }
    match node.title_length {
        None => Err(GraphDataProblem::InvalidTitle { node: named() }),
        Some(length) if length > MAX_TEXT => Err(GraphDataProblem::TitleTooLong {
            node: named(),
            limit: TEXT_LIMIT,
        }),
        Some(_) => Ok(([x, y], [width, height])),
    }
}

/// Checks the nodes and flattens them, or names the first offending node.
fn nodes_of<'a>(batch: &Batch<'a>) -> Result<Nodes<'a>, GraphDataProblem> {
    let mut slots = HashMap::with_capacity(batch.nodes.len());
    let mut positions = Vec::with_capacity(batch.nodes.len() * 2);
    let mut sizes = Vec::with_capacity(batch.nodes.len() * 2);
    for (index, node) in batch.nodes.iter().enumerate() {
        let (position, size) = checked_node(node)?;
        if slots.insert(node.id, slot(index)?).is_some() {
            return Err(GraphDataProblem::DuplicateNode {
                node: node.id.to_owned(),
            });
        }
        positions.extend(position);
        sizes.extend(size);
    }
    Ok(Nodes {
        positions,
        sizes,
        slots,
    })
}

/// Whether `value` is a colour `0xRRGGBB`: an integer from `0` to `0xFFFFFF`.
fn rgb(value: f64) -> bool {
    value.fract() == 0.0 && (0.0..=f64::from(0xff_ffff)).contains(&value)
}

/// The placement of the label of the edge `id`, or why it was refused.
fn label_placement(id: &str, label: &Label) -> Result<LabelPlacement, GraphDataProblem> {
    let edge = || id.to_owned();
    if !(label.t.is_finite() && label.offset.is_finite()) {
        return Err(GraphDataProblem::NonFiniteLabel { edge: edge() });
    }
    if label.offset.abs() > WORLD_LIMIT {
        return Err(GraphDataProblem::BeyondWorld {
            list: GraphList::Edges,
            id: edge(),
            field: "label.offset".to_owned(),
            limit: WORLD_LIMIT,
        });
    }
    match label.text_length {
        None => return Err(GraphDataProblem::InvalidLabelText { edge: edge() }),
        Some(length) if length > MAX_TEXT => {
            return Err(GraphDataProblem::LabelTextTooLong {
                edge: edge(),
                limit: TEXT_LIMIT,
            });
        }
        Some(_) => {}
    }
    if label.background.is_some_and(|b| !rgb(b)) {
        return Err(GraphDataProblem::InvalidBackground { edge: edge() });
    }
    Ok(LabelPlacement {
        t: label.t,
        offset: label.offset,
    })
}

/// The colour of the edge `id` as the engine keeps it, or why it was refused.
fn color_of(id: &str, color: f64) -> Result<u32, GraphDataProblem> {
    if !rgb(color) {
        return Err(GraphDataProblem::InvalidColor {
            edge: id.to_owned(),
        });
    }
    #[expect(
        clippy::cast_possible_truncation,
        reason = "an integer from 0 to 0xFFFFFF, as `rgb` checked above"
    )]
    Ok(color as u32)
}

/// The dash pattern of the edge `id` as the engine keeps it, or why it was refused: checked as
/// the engine keeps it, so that a dash too short for `f32` is refused too.
fn dash_of(id: &str, dash: [f64; 2]) -> Result<(f32, f32), GraphDataProblem> {
    #[expect(
        clippy::cast_possible_truncation,
        reason = "checked as f32 below, so that what f32 cannot hold is refused"
    )]
    let (dash, gap) = (dash[0] as f32, dash[1] as f32);
    if !(dash.is_finite() && gap.is_finite() && dash > 0.0 && gap >= 0.0) {
        return Err(GraphDataProblem::InvalidDash {
            edge: id.to_owned(),
        });
    }
    Ok((dash, gap))
}

/// The label placement and style of an edge, or why they were refused.
fn placement_of(edge: &Edge) -> Result<(Option<LabelPlacement>, EdgeStyle), GraphDataProblem> {
    let label = edge
        .label
        .as_ref()
        .map(|label| label_placement(edge.id, label))
        .transpose()?;
    let style = EdgeStyle {
        color: color_of(edge.id, edge.color)?,
        dash: edge.dash.map(|dash| dash_of(edge.id, dash)).transpose()?,
        arrow: edge.arrow == Arrow::End,
    };
    Ok((label, style))
}

/// The edge as the engine keeps it between the node slots `source` and `target`, as a load and
/// `addEdge` build it, or why its label or style was refused.
fn spec_of(edge: &Edge, source: u32, target: u32) -> Result<EdgeSpec, GraphDataProblem> {
    let (label, style) = placement_of(edge)?;
    Ok(EdgeSpec {
        sides: edge.sides,
        source,
        target,
        label,
        style,
    })
}

/// Resolves every edge's ends to node slots, or names the first offending edge: the second of
/// two that share an identifier, or one whose ends, label, or style were refused.
fn edges_of(batch: &Batch, slots: &HashMap<&str, u32>) -> Result<Vec<EdgeSpec>, GraphDataProblem> {
    let mut seen = HashSet::with_capacity(batch.edges.len());
    let end = |edge: &Edge, node: &str| {
        slots
            .get(node)
            .copied()
            .ok_or_else(|| GraphDataProblem::MissingNode {
                edge: edge.id.to_owned(),
                node: node.to_owned(),
            })
    };
    batch
        .edges
        .iter()
        .map(|edge| {
            if !seen.insert(edge.id) {
                return Err(GraphDataProblem::DuplicateEdge {
                    edge: edge.id.to_owned(),
                });
            }
            spec_of(edge, end(edge, edge.source)?, end(edge, edge.target)?)
        })
        .collect()
}

/// The length of the identifier `field` of the item at `index` of `list`, or its refusal where it
/// is longer than `MAX_ID`.
fn id_length(list: &str, index: usize, field: &str, id: &str) -> Result<usize, GraphDataProblem> {
    checked_id_length(list, index, field, utf16_length(id))
}

/// `length`, the UTF-16 code units of the identifier `field` of the item at `index` of `list`, or
/// its refusal where it is longer than `MAX_ID`: the one check of an identifier's length, for an
/// identifier read as a string and for one whose length a column's boundaries give.
fn checked_id_length(
    list: &str,
    index: usize,
    field: &str,
    length: usize,
) -> Result<usize, GraphDataProblem> {
    if length > MAX_ID {
        return Err(GraphDataProblem::IdTooLong {
            list: list.to_owned(),
            index: slot(index)?,
            field: field.to_owned(),
            limit: ID_LIMIT,
        });
    }
    Ok(length)
}

/// Checks the length of every identifier of a load, the nodes' by their lengths, and of all of
/// them together.
fn ids_of(
    node_ids: impl IntoIterator<Item = usize>,
    edges: &[Edge],
) -> Result<(), GraphDataProblem> {
    let mut units = 0;
    for (index, length) in node_ids.into_iter().enumerate() {
        units += checked_id_length("nodes", index, "id", length)?;
    }
    for (index, edge) in edges.iter().enumerate() {
        units += edge_ids(index, edge)?;
    }
    check_id_budget(units as f64)
}

/// The UTF-16 code units of the identifier, the source, and the target of the edge at `index`, as
/// a load and `addEdge` check them, or the refusal of the first longer than `MAX_ID`.
fn edge_ids(index: usize, edge: &Edge) -> Result<usize, GraphDataProblem> {
    let mut units = 0;
    for (field, id) in [
        ("id", edge.id),
        ("source", edge.source),
        ("target", edge.target),
    ] {
        units += id_length("edges", index, field, id)?;
    }
    Ok(units)
}

/// Checks a load and builds the engine's graph from it, its nodes as columns and its edges as
/// `reading_after` read them: whether the columns fit together, the load's size, then every
/// field's type, the nodes' before the edges', the identifiers' lengths, the nodes, and the edges.
/// Only then are the nodes' identifiers mapped onto the string Rust holds.
pub(crate) fn load_of(nodes: &NodeColumns, edges: &[EdgeInput]) -> Result<Graph, GraphDataProblem> {
    let count = nodes.count()?;
    check_graph_size(count as f64, edges.len() as f64)?;
    nodes.first_refused()?;
    let edges = edges_read(edges)?;
    ids_of(lengths(nodes.id_bounds), &edges)?;
    let batch = Batch {
        nodes: nodes.nodes()?,
        edges,
    };
    let nodes = nodes_of(&batch)?;
    let edges = edges_of(&batch, &nodes.slots)?;
    Ok(Graph::new(nodes.positions, nodes.sizes, edges)?)
}

/// Checks the node `addNode` hands over as a load checks a node, the only one of its batch at
/// index 0, and adds it to `graph`, whose nodes in use stay within `MAX_ITEMS`; returns the slot
/// the engine chose. A refused node leaves the graph as it was. That the graph holds no node of
/// its identifier is `api`'s to check, against the map only it keeps (ADR-0028).
pub(crate) fn add_node_to(graph: &mut Graph, node: &NodeInput) -> Result<u32, GraphDataProblem> {
    let nodes = f64::from(graph.nodes_in_use()) + 1.0;
    check_graph_size(nodes, 0.0)?;
    let node = node_of(0, node)?;
    id_length("nodes", 0, "id", node.id)?;
    let ([x, y], [width, height]) = checked_node(&node)?;
    Ok(graph.add_node(x, y, width, height)?)
}

/// Why an edit of an edge was refused: its data, which the host application handed over, or a
/// slot that holds nothing, which is the shell's mistake (ADR-0022), and crosses as `SlotError`
/// as from the removals, `edgesAt`, `setLabelSize`, and `moveLabel`.
#[derive(Debug, PartialEq)]
pub enum EdgeRefusal {
    Data(GraphDataProblem),
    Slot(SlotError),
}

impl From<GraphDataProblem> for EdgeRefusal {
    fn from(problem: GraphDataProblem) -> Self {
        Self::Data(problem)
    }
}

impl From<SlotError> for EdgeRefusal {
    fn from(error: SlotError) -> Self {
        Self::Slot(error)
    }
}

/// An edge the engine did not add: an end that holds no node is the shell's mistake, and a slot
/// past those the engine numbers a refusal of the graph's size, as for a node.
impl From<AddEdgeError> for EdgeRefusal {
    fn from(error: AddEdgeError) -> Self {
        match error {
            AddEdgeError::Slot(error) => Self::Slot(error),
            AddEdgeError::TooManySlots(error) => Self::Data(error.into()),
        }
    }
}

/// Checks the edge `addEdge` hands over as a load checks an edge, the only one of its batch at
/// index 0, and refuses one from a node to itself (ADR-0024) and one past `MAX_ITEMS` edges in
/// use; adds it to `graph` between the node slots `source` and `target`, which `api` resolved
/// against the map only it keeps, and returns the slot the engine chose. That the graph holds no
/// edge of its identifier and holds its ends is `api`'s to check (ADR-0028); a slot of an end that
/// holds no node is the shell's mistake. A refused edge leaves the graph as it was.
pub(crate) fn add_edge_to(
    graph: &mut Graph,
    edge: &EdgeInput,
    source: u32,
    target: u32,
) -> Result<u32, EdgeRefusal> {
    check_graph_size(0.0, f64::from(graph.edges_in_use()) + 1.0)?;
    let edge = edge_of(0, edge)?;
    edge_ids(0, &edge)?;
    if edge.source == edge.target {
        return Err(GraphDataProblem::SelfEdge {
            edge: edge.id.to_owned(),
        }
        .into());
    }
    let spec = spec_of(&edge, source, target)?;
    Ok(graph.add_edge(spec)?)
}

/// The fields a patch of `updateEdge` may hold, each as the host application handed it over:
/// `None` where the patch does not name it, and `dash` and `label` `Some(Field(Some(None)))`
/// where it clears them with `null`. Read from a plain object alone, as `NodePatch` is; the first
/// other field is kept by name, and the fields after it are passed over unread.
#[derive(Tsify, Default)]
#[tsify(
    type = "{ color?: number; dash?: [number, number] | null; arrow?: Arrow; \
                 label?: LabelInput | null; sourceSide?: Side; targetSide?: Side }"
)]
pub struct EdgePatch {
    color: Option<Field<f64>>,
    dash: Option<Field<Option<Pair>>>,
    arrow: Option<Field<Arrow>>,
    label: Option<Field<Option<LabelInput>>>,
    source_side: Option<Field<Side>>,
    target_side: Option<Field<Side>>,
    other: Option<String>,
}

impl<'de> Deserialize<'de> for EdgePatch {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(EdgePatchVisitor)
    }
}

struct EdgePatchVisitor;

impl<'de> Visitor<'de> for EdgePatchVisitor {
    type Value = EdgePatch;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("an object")
    }

    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<EdgePatch, A::Error> {
        let mut patch = EdgePatch::default();
        while let Some(field) = map.next_key::<String>()? {
            match field.as_str() {
                "color" => patch.color = Some(map.next_value()?),
                "dash" => patch.dash = Some(map.next_value()?),
                "arrow" => patch.arrow = Some(map.next_value()?),
                "label" => patch.label = Some(map.next_value()?),
                "sourceSide" => patch.source_side = Some(map.next_value()?),
                "targetSide" => patch.target_side = Some(map.next_value()?),
                _ => {
                    map.next_value::<IgnoredAny>()?;
                    while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                    patch.other = Some(field);
                    break;
                }
            }
        }
        Ok(patch)
    }
}

/// Checks a patch of the edge `id` in `slot` as a load checks those fields, and gives the edge the
/// patched label placement and style; the store merges the rest, which the engine does not keep.
/// The first offending field refuses the patch, and nothing changes; a slot that holds no edge is
/// the shell's mistake.
pub(crate) fn update_edge_in(
    graph: &mut Graph,
    slot: u32,
    id: &str,
    patch: EdgePatch,
) -> Result<(), EdgeRefusal> {
    if let Some(field) = patch.other {
        return Err(GraphDataProblem::UnknownEdgePatchField {
            edge: id.to_owned(),
            field,
        }
        .into());
    }
    let current = graph.edge(slot).ok_or(SlotError::NoEdge { slot })?;
    // Every field's type first, then their values, in the order a load reads and checks them.
    let mut item = Item::new(GraphList::Edges, 0);
    item.id = Some(id);
    let label = patch
        .label
        .map(|label| label_of(&item, label))
        .transpose()?;
    let color = patch
        .color
        .map(|color| item.read("color", color, A_COLOR))
        .transpose()?;
    let dash = patch
        .dash
        .map(|dash| item.read("dash", dash, A_DASH))
        .transpose()?;
    let arrow = patch
        .arrow
        .map(|arrow| item.read("arrow", arrow, AN_ARROW))
        .transpose()?;
    let source_side = patch
        .source_side
        .map(|side| item.read("sourceSide", side, A_SIDE))
        .transpose()?;
    let target_side = patch
        .target_side
        .map(|side| item.read("targetSide", side, A_SIDE))
        .transpose()?;
    let label = match label {
        None => current.label,
        Some(label) => label.map(|l| label_placement(id, &l)).transpose()?,
    };
    let mut style = current.style;
    if let Some(color) = color {
        style.color = color_of(id, color)?;
    }
    if let Some(dash) = dash {
        style.dash = dash.map(|Pair(dash)| dash_of(id, dash)).transpose()?;
    }
    if let Some(arrow) = arrow {
        style.arrow = arrow == Arrow::End;
    }
    let sides = Sides {
        source: source_side.map_or(current.sides.source, Into::into),
        target: target_side.map_or(current.sides.target, Into::into),
    };
    Ok(graph.update_edge(slot, label, style, sides)?)
}

/// The attributes `updateNode` changes on a node, by name: only its title, a string. Read from a
/// plain object alone: `api` hands over a copy of a plain object's fields up to the first other
/// than `title`, whose values are primitives; a patch that is no plain object, a `Map` or an array
/// among them, or that has a key that is no string, `api` cannot read, and refuses as malformed
/// before it reaches the bridge. No value of the host application, and none of its code, reaches
/// the bridge.
#[derive(Tsify)]
#[tsify(type = "{ title?: string }")]
pub struct NodePatch(pub Vec<(String, Text)>);

impl<'de> Deserialize<'de> for NodePatch {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(PatchVisitor)
    }
}

struct PatchVisitor;

impl<'de> Visitor<'de> for PatchVisitor {
    type Value = NodePatch;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("an object")
    }

    /// Keeps the fields up to the first other than `title`, which is refused, and passes over
    /// the rest unread, so that a patch of many fields costs no copy of them.
    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<NodePatch, A::Error> {
        let mut fields = Vec::new();
        while let Some(field) = map.next_key::<String>()? {
            let other = field != "title";
            fields.push((field, map.next_value()?));
            if other {
                while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                break;
            }
        }
        Ok(NodePatch(fields))
    }
}

/// The check behind the export `checkIdBudget` of the crate root.
pub(crate) fn check_id_budget(units: f64) -> Result<(), GraphDataProblem> {
    if units.is_nan() || units < 0.0 {
        return Err(malformed("the count of identifier code units is no count"));
    }
    if units > f64::from(MAX_ID_UNITS) {
        return Err(GraphDataProblem::IdBudgetExceeded {
            limit: MAX_ID_UNITS,
        });
    }
    Ok(())
}

/// The check behind the export `checkGraphSize` of the crate root.
pub(crate) fn check_graph_size(nodes: f64, edges: f64) -> Result<(), GraphDataProblem> {
    for (list, count) in [("nodes", nodes), ("edges", edges)] {
        if !(count >= 0.0 && count.fract() == 0.0) {
            return Err(malformed(&format!("{list} is not a list")));
        }
        if count > f64::from(MAX_ITEMS) {
            return Err(GraphDataProblem::TooMany {
                list: list.to_owned(),
                limit: MAX_ITEMS,
            });
        }
    }
    Ok(())
}

/// A patch of a node as the bridge checked it: what the store merges, and nothing else.
#[derive(Tsify, Serialize, Debug, PartialEq, Default)]
pub struct CheckedPatch {
    #[tsify(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// Checks a patch of the node `node` and returns the fields it changes, or names its first
/// offending field.
pub(crate) fn patch_of(node: &str, patch: NodePatch) -> Result<CheckedPatch, GraphDataProblem> {
    let mut checked = CheckedPatch::default();
    for (field, Text(value)) in patch.0 {
        if field != "title" {
            return Err(GraphDataProblem::UnknownPatchField {
                node: node.to_owned(),
                field,
            });
        }
        let title = value.ok_or_else(|| GraphDataProblem::InvalidTitle {
            node: node.to_owned(),
        })?;
        if utf16_length(&title) > MAX_TEXT {
            return Err(GraphDataProblem::TitleTooLong {
                node: node.to_owned(),
                limit: TEXT_LIMIT,
            });
        }
        checked.title = Some(title);
    }
    Ok(checked)
}

/// The nodes and edges of one load as the tests write them, each in slot order: the nodes as the
/// node of `addNode` crosses, which `OwnedColumns` turns into the columns the shell builds.
#[cfg(test)]
#[derive(Deserialize)]
pub(crate) struct GraphBatch {
    #[serde(deserialize_with = "items")]
    pub nodes: Vec<NodeInput>,
    #[serde(deserialize_with = "items")]
    pub edges: Vec<EdgeInput>,
}

/// The columns of a load's nodes, owned: what the snapshot of `api` builds, for the tests.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct OwnedColumns {
    ids: String,
    id_bounds: Vec<u32>,
    titles: String,
    title_bounds: Vec<u32>,
    title_texts: Vec<u8>,
    x: Vec<f64>,
    y: Vec<f64>,
    width: Vec<f64>,
    height: Vec<f64>,
    refused: Option<(u32, NodeField)>,
}

#[cfg(test)]
impl OwnedColumns {
    /// The columns of `nodes` as the snapshot builds them, `None` for an item that is no object: a
    /// field missing or of another type empty or NaN, and the first such one named; a title of
    /// the length a node holds.
    pub(crate) fn of<'n>(nodes: impl IntoIterator<Item = Option<&'n NodeInput>>) -> Self {
        let mut columns = Self {
            id_bounds: vec![0],
            title_bounds: vec![0],
            ..Self::default()
        };
        for (index, node) in nodes.into_iter().enumerate() {
            let index = index as u32;
            let Some(node) = node else {
                columns.refused.get_or_insert((index, NodeField::Item));
                columns.id_bounds.push(utf16_length(&columns.ids) as u32);
                columns
                    .title_bounds
                    .push(utf16_length(&columns.titles) as u32);
                columns.title_texts.push(0);
                for numbers in [
                    &mut columns.x,
                    &mut columns.y,
                    &mut columns.width,
                    &mut columns.height,
                ] {
                    numbers.push(f64::NAN);
                }
                continue;
            };
            match &node.id.0 {
                Some(id) => columns.ids.push_str(id),
                None => _ = columns.refused.get_or_insert((index, NodeField::Id)),
            }
            let numbers = [
                (NodeField::X, node.x, &mut columns.x),
                (NodeField::Y, node.y, &mut columns.y),
                (NodeField::Width, node.width, &mut columns.width),
                (NodeField::Height, node.height, &mut columns.height),
            ];
            for (field, value, column) in numbers {
                if value.0.is_none() {
                    columns.refused.get_or_insert((index, field));
                }
                column.push(value.0.unwrap_or(f64::NAN));
            }
            if let Some(length) = node.title_length {
                columns.titles.push_str(&"x".repeat(length));
            }
            columns
                .title_texts
                .push(u8::from(node.title_length.is_some()));
            columns.id_bounds.push(utf16_length(&columns.ids) as u32);
            columns
                .title_bounds
                .push(utf16_length(&columns.titles) as u32);
        }
        columns
    }

    pub(crate) fn view(&self) -> NodeColumns<'_> {
        NodeColumns {
            ids: &self.ids,
            id_bounds: &self.id_bounds,
            titles: &self.titles,
            title_bounds: &self.title_bounds,
            title_texts: &self.title_texts,
            x: &self.x,
            y: &self.y,
            width: &self.width,
            height: &self.height,
            refused: self.refused,
        }
    }
}

/// A load of `batch` as `loadGraph` checks one, its nodes crossed as columns.
#[cfg(test)]
pub(crate) fn graph_of(batch: &GraphBatch) -> Result<Graph, GraphDataProblem> {
    load_of(
        &OwnedColumns::of(batch.nodes.iter().map(Some)).view(),
        &batch.edges,
    )
}

/// Reads every field of every node and edge of a batch, or names the first that is missing or
/// holds a value of another type, as `addNode` reads a node.
#[cfg(test)]
fn batch_of(batch: &GraphBatch) -> Result<Batch<'_>, GraphDataProblem> {
    let nodes = batch.nodes.iter().enumerate().map(|(i, n)| node_of(i, n));
    Ok(Batch {
        nodes: nodes.collect::<Result<_, _>>()?,
        edges: edges_read(&batch.edges)?,
    })
}

// The property test reads graph data as `loadGraph` and `updateNode` do; its file keeps the path
// the record names it by.
#[cfg(test)]
#[path = "properties.rs"]
mod properties;

// The malformed-data tests below verify ADR-0032: every export that receives graph data returns a
// typed error that names the offender, and none panics. They are the tests ADR-0032 names as
// those of `lib.rs`, the crate root of this module.
// Verifies: ADR-0032
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    // The exports themselves, as on the crate root, so that their tests go through them.
    use crate::{check_graph_size, check_id_budget};

    pub(crate) fn batch(nodes: &[(&str, f64, f64)], edges: &[(&str, &str, &str)]) -> GraphBatch {
        GraphBatch {
            nodes: nodes
                .iter()
                .map(|&(id, x, y)| NodeInput {
                    id: id.to_owned().into(),
                    title_length: Some(1),
                    x: x.into(),
                    y: y.into(),
                    width: 100.0.into(),
                    height: 50.0.into(),
                })
                .collect(),
            edges: edges
                .iter()
                .map(|&(id, source, target)| EdgeInput {
                    id: id.to_owned().into(),
                    source: source.to_owned().into(),
                    target: target.to_owned().into(),
                    label: None.into(),
                    color: f64::from(0x9a_a1ad).into(),
                    dash: None.into(),
                    arrow: Arrow::End.into(),
                    source_side: Side::Right.into(),
                    target_side: Side::Left.into(),
                })
                .collect(),
        }
    }

    #[test]
    fn what_an_identifier_expects_names_its_limit() {
        assert!(AN_ID.contains(&format!(" {MAX_ID} ")));
    }

    #[test]
    fn a_batch_flattens_into_slot_order() {
        let data = batch(&[("a", 1.0, 2.0), ("b", 3.0, 4.0)], &[]);
        let nodes = nodes_of(&batch_of(&data).unwrap()).unwrap();
        assert_eq!(nodes.positions, [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(nodes.sizes, [100.0, 50.0, 100.0, 50.0]);
    }

    #[test]
    fn a_non_finite_coordinate_names_its_node() {
        let error = graph_of(&batch(&[("a", 0.0, 0.0), ("b", f64::NAN, 0.0)], &[])).unwrap_err();
        assert_eq!(
            error,
            GraphDataProblem::NonFiniteCoordinate { node: "b".into() }
        );
    }

    #[test]
    fn a_size_that_is_negative_or_not_finite_names_its_node() {
        for (width, height) in [(-1.0, 10.0), (10.0, f64::INFINITY), (f64::NAN, 10.0)] {
            let mut data = batch(&[("a", 0.0, 0.0)], &[]);
            data.nodes[0].width = width.into();
            data.nodes[0].height = height.into();
            let error = graph_of(&data).unwrap_err();
            assert_eq!(error, GraphDataProblem::InvalidSize { node: "a".into() });
        }
    }

    #[test]
    fn a_number_beyond_f32_is_refused_as_a_non_finite_one() {
        let error = graph_of(&batch(&[("a", 1e300, 0.0)], &[])).unwrap_err();
        assert_eq!(
            error,
            GraphDataProblem::NonFiniteCoordinate { node: "a".into() }
        );
        let mut data = batch(&[("a", 0.0, 0.0)], &[]);
        data.nodes[0].width = 1e300.into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::InvalidSize { node: "a".into() }
        );
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let mut data = batch(&two, &[("e", "a", "b")]);
        data.edges[0].dash = Some(Pair([1e-300, 1e300])).into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::InvalidDash { edge: "e".into() }
        );
    }

    #[test]
    fn a_duplicate_identifier_names_its_node() {
        let error = graph_of(&batch(&[("a", 0.0, 0.0), ("a", 1.0, 1.0)], &[])).unwrap_err();
        assert_eq!(error, GraphDataProblem::DuplicateNode { node: "a".into() });
    }

    #[test]
    fn a_duplicate_identifier_names_its_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let error = graph_of(&batch(&two, &[("e", "a", "b"), ("e", "b", "a")])).unwrap_err();
        assert_eq!(error, GraphDataProblem::DuplicateEdge { edge: "e".into() });
    }

    #[test]
    fn an_edge_to_a_missing_node_names_the_edge_and_the_node() {
        let error = graph_of(&batch(&[("a", 0.0, 0.0)], &[("e", "a", "z")])).unwrap_err();
        assert_eq!(
            error,
            GraphDataProblem::MissingNode {
                edge: "e".into(),
                node: "z".into()
            }
        );
    }

    #[test]
    fn a_non_finite_label_names_its_edge() {
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
        data.edges[0].label = Some(LabelInput {
            text_length: Some(1),
            t: f64::NAN.into(),
            offset: 0.0.into(),
            background: None,
        })
        .into();
        let error = graph_of(&data).unwrap_err();
        assert_eq!(error, GraphDataProblem::NonFiniteLabel { edge: "e".into() });
    }

    /// The refusal of a node or label of `list` and `id` lying past the world's limit by `field`.
    fn beyond(list: GraphList, id: &str, field: &str) -> GraphDataProblem {
        GraphDataProblem::BeyondWorld {
            list,
            id: id.into(),
            field: field.into(),
            limit: WORLD_LIMIT,
        }
    }

    #[test]
    fn a_node_whose_place_or_far_side_lies_past_the_world_names_it_and_the_field() {
        // Verifies: Q-7, ADR-0028
        // 3e38 is a finite f32, as is 3e38 + 3e38 in f64, which f32 cannot hold.
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 3e38, 0.0)], &[]);
        data.nodes[1].width = 3e38.into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            beyond(GraphList::Nodes, "b", "x")
        );
        // Each within the limit, the far side past it: 2^119 + 2^119 + 1e30.
        let half = WORLD_LIMIT / 2.0;
        for (field, x, y, width, height) in [
            ("width", half, 0.0, half + 1e30, 10.0),
            ("height", 0.0, half, 10.0, half + 1e30),
            ("y", 0.0, -WORLD_LIMIT * 1.01, 10.0, 10.0),
        ] {
            let mut data = batch(&[("a", x, y)], &[]);
            data.nodes[0].width = width.into();
            data.nodes[0].height = height.into();
            assert_eq!(
                graph_of(&data).unwrap_err(),
                beyond(GraphList::Nodes, "a", field)
            );
        }
        // At the limit, its far side on it, it is taken.
        let mut data = batch(&[("a", -WORLD_LIMIT, WORLD_LIMIT - 64.0)], &[]);
        data.nodes[0].height = 0.0.into();
        assert!(graph_of(&data).is_ok());
    }

    #[test]
    fn a_label_offset_past_the_world_names_its_edge_and_the_field() {
        // Verifies: Q-7, ADR-0028
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
        data.edges[0].label = Some(LabelInput {
            text_length: Some(1),
            t: 0.5.into(),
            offset: (-WORLD_LIMIT * 2.0).into(),
            background: None,
        })
        .into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            beyond(GraphList::Edges, "e", "label.offset")
        );
    }

    #[test]
    fn a_colour_beyond_rgb_or_a_bad_dash_names_its_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let mut data = batch(&two, &[("e", "a", "b")]);
        data.edges[0].color = f64::from(0x100_0000).into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::InvalidColor { edge: "e".into() }
        );
        for dash in [
            [0.0, 4.0],
            [6.0, -1.0],
            [f64::NAN, 4.0],
            [6.0, f64::INFINITY],
        ] {
            let mut data = batch(&two, &[("e", "a", "b")]);
            data.edges[0].dash = Some(Pair(dash)).into();
            assert_eq!(
                graph_of(&data).unwrap_err(),
                GraphDataProblem::InvalidDash { edge: "e".into() }
            );
        }
    }

    #[test]
    fn a_title_that_is_not_text_names_its_node() {
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        data.nodes[1].title_length = None;
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::InvalidTitle { node: "b".into() }
        );
    }

    #[test]
    fn a_label_text_or_background_pixi_cannot_draw_names_its_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let label = |text, background| {
            let mut data = batch(&two, &[("e", "a", "b")]);
            data.edges[0].label = Some(LabelInput {
                text_length: text,
                t: 0.5.into(),
                offset: 0.0.into(),
                background,
            })
            .into();
            graph_of(&data)
        };
        assert!(label(Some(1), None).is_ok());
        assert!(label(Some(1), Some(0.0)).is_ok());
        assert!(label(Some(1), Some(f64::from(0xff_ffff))).is_ok());
        assert_eq!(
            label(None, None).unwrap_err(),
            GraphDataProblem::InvalidLabelText { edge: "e".into() }
        );
        for background in [-5.0, 1.5, f64::NAN, 1e20, f64::from(0x100_0000)] {
            assert_eq!(
                label(Some(1), Some(background)).unwrap_err(),
                GraphDataProblem::InvalidBackground { edge: "e".into() }
            );
        }
    }

    #[test]
    fn a_text_longer_than_its_limit_names_its_node_or_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let mut data = batch(&two, &[("e", "a", "b")]);
        data.nodes[0].title_length = Some(MAX_TEXT);
        data.edges[0].label = Some(LabelInput {
            text_length: Some(MAX_TEXT),
            t: 0.5.into(),
            offset: 0.0.into(),
            background: None,
        })
        .into();
        assert!(graph_of(&data).is_ok());
        data.nodes[0].title_length = Some(MAX_TEXT + 1);
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::TitleTooLong {
                node: "a".into(),
                limit: 1_000
            }
        );
        data.nodes[0].title_length = Some(MAX_TEXT);
        if let Field(Some(Some(label))) = &mut data.edges[0].label {
            label.text_length = Some(MAX_TEXT + 1);
        }
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::LabelTextTooLong {
                edge: "e".into(),
                limit: 1_000
            }
        );
        // JavaScript's length: a character beyond the basic plane counts twice.
        assert_eq!(utf16_length(&"\u{1F600}".repeat(500)), 1_000);
    }

    #[test]
    fn an_identifier_beyond_its_limit_or_the_budget_is_refused() {
        let long = "x".repeat(MAX_ID);
        let longer = "x".repeat(MAX_ID + 1);
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
        data.nodes[1].id = long.clone().into();
        data.edges[0].target = long.into();
        assert!(graph_of(&data).is_ok());
        data.edges[0].source = longer.into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::IdTooLong {
                list: "edges".into(),
                index: 0,
                field: "source".into(),
                limit: 256
            }
        );
        assert_eq!(check_id_budget(64e6), Ok(()));
        assert_eq!(
            check_id_budget(64e6 + 1.0),
            Err(GraphDataProblem::IdBudgetExceeded { limit: 64_000_000 })
        );
        assert!(matches!(
            check_id_budget(f64::NAN),
            Err(GraphDataProblem::Malformed { .. })
        ));
    }

    #[test]
    fn a_load_counts_the_code_units_of_all_its_identifiers_against_the_budget() {
        let id = |i: usize| format!("{i:0>256}");
        let nodes = |count: usize| GraphBatch {
            nodes: (0..count)
                .map(|i| NodeInput {
                    id: id(i).into(),
                    title_length: Some(1),
                    x: 0.0.into(),
                    y: 0.0.into(),
                    width: 1.0.into(),
                    height: 1.0.into(),
                })
                .collect(),
            edges: Vec::new(),
        };
        // 250,000 identifiers of 256 code units hold 64,000,000 together.
        let ids = |count| {
            let data = nodes(count);
            let batch = batch_of(&data).unwrap();
            ids_of(batch.nodes.iter().map(|n| utf16_length(n.id)), &batch.edges)
        };
        assert_eq!(ids(250_000), Ok(()));
        assert_eq!(
            ids(250_001),
            Err(GraphDataProblem::IdBudgetExceeded { limit: 64_000_000 })
        );
    }

    #[test]
    fn a_graph_beyond_a_million_nodes_or_edges_is_refused_naming_the_list() {
        assert_eq!(check_graph_size(1e6, 1e6), Ok(()));
        let too_many = |list: &str| GraphDataProblem::TooMany {
            list: list.into(),
            limit: 1_000_000,
        };
        assert_eq!(check_graph_size(1e6 + 1.0, 0.0), Err(too_many("nodes")));
        assert_eq!(
            check_graph_size(0.0, 4_294_967_295.0),
            Err(too_many("edges"))
        );
        for count in [f64::NAN, -1.0, 0.5] {
            assert!(matches!(
                check_graph_size(count, 0.0),
                Err(GraphDataProblem::Malformed { .. })
            ));
        }
    }

    #[test]
    fn a_patch_with_another_field_or_a_title_not_text_names_its_node() {
        let patch = |entries: &[(&str, Option<&str>)]| {
            let text = |v: Option<&str>| Text(v.map(str::to_owned));
            let fields = entries.iter().map(|&(k, v)| (k.to_owned(), text(v)));
            patch_of("a", NodePatch(fields.collect()))
        };
        assert_eq!(patch(&[]), Ok(CheckedPatch { title: None }));
        assert_eq!(
            patch(&[("title", Some("A"))]),
            Ok(CheckedPatch {
                title: Some("A".into())
            })
        );
        assert_eq!(
            patch(&[("title", Some("A")), ("width", None)]),
            Err(GraphDataProblem::UnknownPatchField {
                node: "a".into(),
                field: "width".into()
            })
        );
        let long = "x".repeat(MAX_TEXT + 1);
        assert_eq!(
            patch(&[("title", Some(long.as_str()))]),
            Err(GraphDataProblem::TitleTooLong {
                node: "a".into(),
                limit: 1_000
            })
        );
        assert_eq!(
            patch(&[("title", None)]),
            Err(GraphDataProblem::InvalidTitle { node: "a".into() })
        );
    }

    #[test]
    fn a_count_beyond_u32_is_refused_as_the_engine_refuses_it() {
        let beyond = u32::MAX as usize + 1;
        assert_eq!(slot(u32::MAX as usize), Ok(u32::MAX));
        assert_eq!(
            slot(beyond),
            Err(GraphDataProblem::from(graph::slot(beyond).unwrap_err()))
        );
        assert_eq!(
            slot(beyond),
            Err(GraphDataProblem::Malformed {
                message: "the graph holds more items than the engine can number".into()
            })
        );
    }

    #[test]
    fn edges_resolve_to_the_slots_of_their_nodes() {
        let data = batch(
            &[("a", 0.0, 0.0), ("b", 300.0, 0.0), ("c", 600.0, 0.0)],
            &[("e", "c", "a")],
        );
        let data = batch_of(&data).unwrap();
        let edges = edges_of(&data, &nodes_of(&data).unwrap().slots).unwrap();
        assert_eq!((edges[0].source, edges[0].target), (2, 0));
    }

    /// The node of `batch` at `(x, y)` with `change` made to it.
    fn added(x: f64, y: f64, change: impl FnOnce(&mut NodeInput)) -> NodeInput {
        let mut node = batch(&[("n", x, y)], &[]).nodes.remove(0);
        change(&mut node);
        node
    }

    #[test]
    fn an_edge_the_engine_cannot_number_is_refused_as_a_node_it_cannot_number() {
        // Verifies: ADR-0022
        let node = GraphDataProblem::from(TooManySlots);
        assert_eq!(
            EdgeRefusal::from(AddEdgeError::TooManySlots(TooManySlots)),
            EdgeRefusal::Data(node)
        );
        let slot = SlotError::NoNode { slot: 3 };
        assert_eq!(
            EdgeRefusal::from(AddEdgeError::Slot(slot)),
            EdgeRefusal::Slot(slot)
        );
    }

    #[test]
    fn an_added_node_takes_the_next_slot_where_it_was_placed() {
        // Verifies: ADR-0022
        let mut graph = graph_of(&batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[])).unwrap();
        assert_eq!(add_node_to(&mut graph, &added(40.0, 50.0, |_| {})), Ok(2));
        assert_eq!(&graph.positions()[4..], [40.0, 50.0]);
        // On an engine that never loaded a graph too.
        let mut empty = Graph::default();
        assert_eq!(add_node_to(&mut empty, &added(1.0, 2.0, |_| {})), Ok(0));
        assert_eq!(empty.positions(), [1.0, 2.0]);
    }

    #[test]
    fn an_added_node_is_refused_as_a_load_refuses_it_and_the_graph_kept() {
        // Verifies: ADR-0028, Q-7
        let named = || "n".to_owned();
        let cases: Vec<(NodeInput, GraphDataProblem)> = vec![
            (
                added(f64::INFINITY, 0.0, |_| {}),
                GraphDataProblem::NonFiniteCoordinate { node: named() },
            ),
            (
                added(0.0, 1e39, |_| {}),
                GraphDataProblem::NonFiniteCoordinate { node: named() },
            ),
            (
                added(0.0, 0.0, |n| n.width = (-1.0).into()),
                GraphDataProblem::InvalidSize { node: named() },
            ),
            (
                added(0.0, 0.0, |n| n.title_length = None),
                GraphDataProblem::InvalidTitle { node: named() },
            ),
            (
                added(0.0, 0.0, |n| n.title_length = Some(MAX_TEXT + 1)),
                GraphDataProblem::TitleTooLong {
                    node: named(),
                    limit: TEXT_LIMIT,
                },
            ),
            (
                added(0.0, 0.0, |n| n.id = "x".repeat(MAX_ID + 1).into()),
                GraphDataProblem::IdTooLong {
                    list: "nodes".into(),
                    index: 0,
                    field: "id".into(),
                    limit: ID_LIMIT,
                },
            ),
            (
                added(0.0, 0.0, |n| n.x = Field(None)),
                GraphDataProblem::InvalidField {
                    list: GraphList::Nodes,
                    index: 0,
                    id: Some(named()),
                    field: "x".into(),
                    expected: A_NUMBER.into(),
                },
            ),
        ];
        for (node, problem) in cases {
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            assert_eq!(add_node_to(&mut graph, &node), Err(problem));
            assert_eq!(graph.positions(), [0.0, 0.0]);
            assert_eq!(graph.nodes_in_use(), 1);
        }
    }

    #[test]
    fn a_node_added_to_a_graph_at_the_limit_of_a_load_is_refused() {
        // Verifies: ADR-0028, Q-7
        let count = MAX_ITEMS as usize;
        let positions = (0..count).flat_map(|i| [i as f32, 0.0]).collect();
        let mut graph = Graph::new(positions, vec![1.0; count * 2], Vec::new()).unwrap();
        assert_eq!(
            add_node_to(&mut graph, &added(0.0, 0.0, |_| {})),
            Err(GraphDataProblem::TooMany {
                list: "nodes".into(),
                limit: MAX_ITEMS,
            })
        );
        assert_eq!(graph.nodes_in_use(), MAX_ITEMS);
        assert_eq!(graph.positions().len(), count * 2);
    }

    /// The load of `columns` and no edges, as `loadGraph` checks it.
    fn load_columns(columns: &OwnedColumns) -> Result<Graph, GraphDataProblem> {
        load_of(&columns.view(), &[])
    }

    /// The columns of node `a` and of `b`, made by `change` from a well-formed one.
    fn a_and(change: impl FnOnce(&mut NodeInput)) -> OwnedColumns {
        let nodes = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]).nodes;
        let mut b = added(300.0, 0.0, |n| n.id = "b".to_owned().into());
        change(&mut b);
        OwnedColumns::of([Some(&nodes[0]), Some(&b)])
    }

    #[test]
    fn every_refusal_of_a_node_crosses_as_columns_with_its_kind_and_names() {
        // Verifies: ADR-0032
        let b = || "b".to_owned();
        let field =
            |field: &str, id: Option<String>, expected: &str| GraphDataProblem::InvalidField {
                list: GraphList::Nodes,
                index: 1,
                id,
                field: field.into(),
                expected: expected.into(),
            };
        // A field missing or of another type, or an identifier with a lone surrogate, which the
        // snapshot hands over as `false`: the column holds none of it, and names its position.
        let mut cases: Vec<(OwnedColumns, GraphDataProblem)> = vec![
            (a_and(|n| n.id = Field(None)), field("id", None, AN_ID)),
            (
                a_and(|n| n.x = Field(None)),
                field("x", Some(b()), A_NUMBER),
            ),
            (
                a_and(|n| n.y = Field(None)),
                field("y", Some(b()), A_NUMBER),
            ),
            (
                a_and(|n| n.width = Field(None)),
                field("width", Some(b()), A_SIZE),
            ),
            (
                a_and(|n| n.height = Field(None)),
                field("height", Some(b()), A_SIZE),
            ),
            // The first of a node's fields refused, in the order a node is read.
            (
                a_and(|n| (n.height, n.y) = (Field(None), Field(None))),
                field("y", Some(b()), A_NUMBER),
            ),
            // A title missing, of another type, or with a lone surrogate is no text.
            (
                a_and(|n| n.title_length = None),
                GraphDataProblem::InvalidTitle { node: b() },
            ),
            (
                a_and(|n| n.title_length = Some(MAX_TEXT + 1)),
                GraphDataProblem::TitleTooLong {
                    node: b(),
                    limit: TEXT_LIMIT,
                },
            ),
            (
                a_and(|n| n.id = "x".repeat(MAX_ID + 1).into()),
                GraphDataProblem::IdTooLong {
                    list: "nodes".into(),
                    index: 1,
                    field: "id".into(),
                    limit: ID_LIMIT,
                },
            ),
            (
                a_and(|n| n.id = "a".to_owned().into()),
                GraphDataProblem::DuplicateNode { node: "a".into() },
            ),
            (
                a_and(|n| n.x = f64::INFINITY.into()),
                GraphDataProblem::NonFiniteCoordinate { node: b() },
            ),
            (
                a_and(|n| n.width = (-1.0).into()),
                GraphDataProblem::InvalidSize { node: b() },
            ),
            (
                a_and(|n| n.y = (-WORLD_LIMIT * 1.01).into()),
                beyond(GraphList::Nodes, "b", "y"),
            ),
        ];
        // A node that is no object, refused as malformed as one that is no object was.
        let a = batch(&[("a", 0.0, 0.0)], &[]).nodes;
        cases.push((
            OwnedColumns::of([Some(&a[0]), None]),
            unshaped("a node is no object"),
        ));
        for (columns, problem) in cases {
            assert_eq!(load_columns(&columns).err(), Some(problem));
        }
        assert!(load_columns(&a_and(|_| {})).is_ok());
    }

    #[test]
    fn a_coordinate_not_finite_in_an_early_node_is_named_before_a_title_in_a_later_one() {
        // Verifies: ADR-0032
        // The first pass names only the values `Field<T>` reads; a title is checked at its rule,
        // in the second pass, after the nodes before it.
        let ids: Vec<String> = (0..6).map(|i| format!("n{i}")).collect();
        let nodes: Vec<_> = ids.iter().map(|id| (id.as_str(), 0.0, 0.0)).collect();
        let mut data = batch(&nodes, &[]);
        data.nodes[0].x = f64::INFINITY.into();
        // The title of node 5 holds a lone surrogate, which the snapshot hands over as no text.
        data.nodes[5].title_length = None;
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::NonFiniteCoordinate { node: "n0".into() }
        );
        data.nodes[0].x = 0.0.into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::InvalidTitle { node: "n5".into() }
        );
    }

    /// The columns of nodes of identifiers `ids`, given as the string Rust holds and the
    /// boundaries the shell computed, with the field `refused` of a node named.
    fn cut(ids: &str, bounds: &[u32], refused: Option<(u32, NodeField)>) -> OwnedColumns {
        let count = bounds.len() - 1;
        let nodes = batch(&vec![("", 0.0, 0.0); count], &[]).nodes;
        let mut columns = OwnedColumns::of(nodes.iter().map(Some));
        columns.ids = ids.to_owned();
        columns.id_bounds = bounds.to_vec();
        columns.refused = refused;
        columns
    }

    #[test]
    fn identifiers_cut_inside_a_pair_are_refused_for_their_length_before_any_is_mapped() {
        // Verifies: ADR-0032
        // Two identifiers of 300 code units, cut to 257: the first ends in the high half of a
        // pair and the second begins with the low one, one character across their boundary.
        let ids = format!("{}\u{1F600}{}", "a".repeat(256), "b".repeat(256));
        assert_eq!(
            load_columns(&cut(&ids, &[0, 257, 514], None)).unwrap_err(),
            GraphDataProblem::IdTooLong {
                list: "nodes".into(),
                index: 0,
                field: "id".into(),
                limit: ID_LIMIT,
            }
        );
        // A boundary inside a character no length refuses is malformed, never mapped.
        assert_eq!(
            load_columns(&cut("\u{1F600}", &[0, 1, 2], None)).unwrap_err(),
            malformed("an identifier ends inside a character")
        );
        // A node refused by its type in the first pass is named by its identifier as the shell
        // read it, each half of a pair cut in two U+FFFD, as it crossed alone.
        let named = |at, id: String| {
            let columns = cut(&ids, &[0, 257, 514], Some((at, NodeField::X)));
            let problem = load_columns(&columns).unwrap_err();
            assert!(
                matches!(&problem, GraphDataProblem::InvalidField { id: Some(named), .. } if *named == id),
                "{problem:?}"
            );
        };
        named(0, format!("{}\u{FFFD}", "a".repeat(256)));
        named(1, format!("\u{FFFD}{}", "b".repeat(256)));
    }

    #[test]
    fn columns_that_do_not_fit_together_are_refused_as_malformed() {
        // Verifies: ADR-0032
        let fits = || a_and(|_| {});
        let changes: [fn(&mut OwnedColumns); 7] = [
            |c| _ = c.x.pop(),
            |c| _ = c.title_texts.pop(),
            |c| _ = c.id_bounds.pop(),
            |c| c.id_bounds[0] = 1,
            |c| c.id_bounds = vec![0, 2, 1],
            |c| c.titles.push('x'),
            |c| c.refused = Some((2, NodeField::X)),
        ];
        for change in changes {
            let mut columns = fits();
            change(&mut columns);
            assert_eq!(load_columns(&columns).err(), Some(unfit()));
        }
        assert_eq!(refused_of(Some(0), None), Err(unfit()));
        assert_eq!(refused_of(None, Some(NodeField::Id as u32)), Err(unfit()));
        assert_eq!(refused_of(None, None), Ok(None));
        // Every field by its code, and a code no field has refused as malformed.
        for field in [
            NodeField::Item,
            NodeField::Id,
            NodeField::X,
            NodeField::Y,
            NodeField::Width,
            NodeField::Height,
        ] {
            assert_eq!(
                refused_of(Some(1), Some(field as u32)),
                Ok(Some((1, field)))
            );
        }
        for code in [6, 255, u32::MAX] {
            assert_eq!(refused_of(Some(0), Some(code)), Err(unfit()));
        }
    }
}
