//! The refusals of graph data (Q-7): `GraphDataProblem`, which every export that takes graph data
//! returns, the refusal of malformed data, and what a field expects as a refusal says it.

use comb_engine::graph::{self, GraphError, TooManySlots};
use serde::{Deserialize, Serialize};
use tsify::Tsify;

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
    /// A node's width is negative, NaN, or infinite.
    #[serde(rename_all = "camelCase")]
    InvalidSize { node: String },
    /// The content of the node at `index`, `id` where its identifier was read, holds a shape the
    /// bridge cannot read at row `row`: a row that is no list, or, where `column` is given, an
    /// element that is no object; `expected` says in words what it should be (ADR-0034).
    #[serde(rename_all = "camelCase")]
    InvalidContentShape {
        index: u32,
        #[tsify(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        row: u32,
        #[tsify(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        column: Option<u32>,
        expected: String,
    },
    /// A node's content holds more than `limit` rows.
    #[serde(rename_all = "camelCase")]
    TooManyRows { node: String, limit: u32 },
    /// A row of a node's content holds more than `limit` columns.
    #[serde(rename_all = "camelCase")]
    TooManyColumns { node: String, row: u32, limit: u32 },
    /// The element at `column` of `row` of a node's content is of no kind Comb draws.
    #[serde(rename_all = "camelCase")]
    InvalidElementKind { node: String, row: u32, column: u32 },
    /// The weight of an element of a node's content is not a positive finite number.
    #[serde(rename_all = "camelCase")]
    InvalidWeight { node: String, row: u32, column: u32 },
    /// The role of a text of a node's content is not `title`, `body`, or `caption`.
    #[serde(rename_all = "camelCase")]
    InvalidRole { node: String, row: u32, column: u32 },
    /// The direction of a metric's trend in a node's content is not `up`, `down`, or `flat`, or
    /// its trend is no object.
    #[serde(rename_all = "camelCase")]
    InvalidDirection { node: String, row: u32, column: u32 },
    /// The string `field` of an element of a node's content is missing, not a string, or holds a
    /// lone surrogate.
    #[serde(rename_all = "camelCase")]
    InvalidContentText {
        node: String,
        row: u32,
        column: u32,
        field: String,
    },
    /// The string `field` of an element of a node's content is longer than `limit` UTF-16 code
    /// units.
    #[serde(rename_all = "camelCase")]
    ContentTextTooLong {
        node: String,
        row: u32,
        column: u32,
        field: String,
        limit: u32,
    },
    /// The strings of the content the graph would hold, after a load or after an edit, hold more
    /// than `limit` UTF-16 code units together; `node` is the node whose string passed it.
    #[serde(rename_all = "camelCase")]
    ContentBudgetExceeded { node: String, limit: u32 },
    /// The colour of a badge or of a metric's trend of a node's content, or of the segment at
    /// `segment` of a progress bar, is not an integer from `0` to `0xFFFFFF`.
    #[serde(rename_all = "camelCase")]
    InvalidContentColor {
        node: String,
        row: u32,
        column: u32,
        #[tsify(optional)]
        #[serde(default, skip_serializing_if = "Option::is_none")]
        segment: Option<u32>,
    },
    /// A progress bar of a node's content holds more than `limit` segments.
    #[serde(rename_all = "camelCase")]
    TooManySegments {
        node: String,
        row: u32,
        column: u32,
        limit: u32,
    },
    /// The fraction of the segment at `segment` of a progress bar of a node's content is negative
    /// or not finite.
    #[serde(rename_all = "camelCase")]
    InvalidFraction {
        node: String,
        row: u32,
        column: u32,
        segment: u32,
    },
    /// The fractions of the segments of a progress bar of a node's content sum past 1.
    #[serde(rename_all = "camelCase")]
    FractionsPastOne { node: String, row: u32, column: u32 },
    /// A patch of a node holds a field other than its content.
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
pub(super) const A_NUMBER: &str = "a finite number";
pub(super) const A_SIZE: &str = "a finite number of 0 or more";
pub(super) const A_COLOR: &str = "an integer from 0 to 0xFFFFFF";
pub(super) const A_LABEL: &str = "an object, or none";
pub(super) const A_DASH: &str = "a list of two finite numbers, or none";
pub(super) const AN_ARROW: &str = "\"end\" or \"none\"";
pub(super) const A_SIDE: &str = "\"top\", \"right\", \"bottom\", or \"left\"";
pub(super) const A_CONTENT: &str = "a list of rows";
pub(super) const A_ROW: &str = "a list of elements";
pub(super) const AN_ELEMENT: &str = "an object";
pub(super) const A_SEGMENT_LIST: &str = "a list of segments";

/// What an identifier, a source, or a target expects, by `MAX_ID`.
pub(super) const AN_ID: &str = "a well-formed string of at most 256 code units";

// The malformed-data tests of graph data verify ADR-0034 (see `graph_data::tests`).
// Verifies: ADR-0034
#[cfg(test)]
mod tests {
    use super::super::MAX_ID;
    use super::*;

    #[test]
    fn what_an_identifier_expects_names_its_limit() {
        assert!(AN_ID.contains(&format!(" {MAX_ID} ")));
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
}
