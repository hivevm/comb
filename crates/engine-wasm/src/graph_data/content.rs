//! The node content of graph data (ADR-0013, ADR-0010), split by concept: `codes` holds its
//! codes and limits, `check` the one check of a load's content columns and of a single node's
//! content, `data` the content the engine keeps and where its strings lie, `layout` the content as
//! the engine's layout and hit test read it, `node_content` the content as the host
//! application's type describes it, and `input` the content of a single node read through
//! serde-wasm-bindgen.

mod check;
mod codes;
mod data;
mod input;
mod layout;
mod node_content;

pub use check::ContentColumns;
#[cfg(test)]
pub(crate) use check::TEST_BUDGET;
pub(crate) use check::{Checked, Cursor, check_content_budget};
pub(crate) use codes::{COLUMN_LIMIT, ROW_LIMIT, SEGMENT_LIMIT, direction_of, role_of};
pub use codes::{
    DirectionCode, KindCode, MAX_COLUMNS, MAX_CONTENT_UNITS, MAX_ROWS, MAX_SEGMENTS, RoleCode,
};
pub use data::ContentData;
pub(crate) use data::rgb_of;
pub use input::{ContentInput, Shape, Unflat};
pub use layout::{ElementHit, ElementKind};

use super::{
    ContentElement, GraphDataProblem, MAX_TEXT, NodeContent, Segment, TEXT_LIMIT, TextRole, Trend,
    TrendDirection, bounds_fit, malformed, numbered, rgb, runs_fit, string_at, text_spans,
    utf16_length,
};
