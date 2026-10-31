//! The reading and checking of graph data, the one place that validates it (ADR-0028, ADR-0034).
//! The exports in the crate root hand graph data here and pass on what it returns: a load's
//! columns become the engine's graph, the node of `addNode` and the edge of `addEdge` join it, and
//! a patch of `updateNode` or `updateEdge` becomes what the graph and the store take.
//!
//! The reading and checking is split by concept: `limits` holds the limits of a load, `field` the
//! lenient reading of a field, `input` the types the host application hands over, `strings` the
//! decoding of the string columns, `node_columns` and `edge_columns` the columns of a load's nodes
//! and edges, `problem` the refusals, `item` the reading of a node or an edge, `checks` the rules
//! of each, `load` a load and `addNode`, `edit` `addEdge` and the patches, and `content` the node
//! content; `snapshot` builds, for the tests, the columns the shell builds.

mod checks;
mod content;
mod edge_columns;
mod edit;
mod field;
mod input;
mod item;
mod limits;
mod load;
mod node_columns;
mod problem;
#[cfg(test)]
mod snapshot;
mod strings;

use checks::rgb;
pub(crate) use checks::{kept_height, within_by_height};
use content::Cursor;
#[cfg(test)]
pub(crate) use content::TEST_BUDGET;
pub(crate) use content::{
    COLUMN_LIMIT, Checked, ROW_LIMIT, SEGMENT_LIMIT, check_content_budget, direction_of, rgb_of,
    role_of,
};
pub use content::{
    ContentColumns, ContentData, ContentInput, DirectionCode, ElementHit, ElementKind, KindCode,
    MAX_COLUMNS, MAX_CONTENT_UNITS, MAX_ROWS, MAX_SEGMENTS, RoleCode, Unflat,
};
pub(crate) use edge_columns::edge_refused_of;
pub use edge_columns::{ArrowCode, EdgeColumns, EdgeField, SideCode};
pub use edit::{EdgePatch, EdgeRefusal, NodePatch};
pub(crate) use edit::{add_edge_to, patch_of, update_edge_in};
pub use field::Field;
pub use input::{
    Arrow, ContentElement, EdgeInput, LabelInput, NodeContent, NodeInput, Pair, Segment, Side,
    TextRole, Trend, TrendDirection,
};
pub(crate) use limits::{ID_LIMIT, TEXT_LIMIT, check_graph_size, check_id_budget};
pub use limits::{MAX_ID, MAX_ID_UNITS, MAX_ITEMS, MAX_TEXT};
#[cfg(test)]
pub(crate) use load::graph_of;
pub(crate) use load::{add_node_to, load_of};
pub(crate) use node_columns::refused_of;
pub use node_columns::{NodeColumns, NodeField};
pub use problem::{GraphDataProblem, GraphList};
pub(crate) use problem::{malformed, slot, unshaped};
#[cfg(test)]
pub(crate) use snapshot::{EdgeCells, GraphBatch, OwnedColumns, OwnedEdgeColumns};
use strings::{bounds_fit, lengths, runs_fit, string_at, value_at, values};
pub(crate) use strings::{numbered, text_spans, utf16_length};

/// The value of `values` whose code, its discriminant, is `code`, or none for a code none has.
fn coded<T: Copy + Into<u32>>(values: &[T], code: u32) -> Option<T> {
    values.iter().copied().find(|&value| value.into() == code)
}

/// The first value a load's first pass refuses, as `loadGraph` takes it: the index of its item
/// and the code of its field, both or neither, and a code none of `fields` has refused as
/// `unfit`.
fn refused_by<F: Copy + Into<u32>>(
    at: Option<u32>,
    field: Option<u32>,
    fields: &[F],
    unfit: fn() -> GraphDataProblem,
) -> Result<Option<(u32, F)>, GraphDataProblem> {
    match (at, field.map(|code| coded(fields, code))) {
        (Some(at), Some(Some(field))) => Ok(Some((at, field))),
        (None, None) => Ok(None),
        _ => Err(unfit()),
    }
}

// The property test reads graph data as `loadGraph` and `updateNode` do; its file keeps the path
// the record names it by.
#[cfg(test)]
#[path = "properties.rs"]
mod properties;

#[cfg(test)]
pub(crate) mod tests;
