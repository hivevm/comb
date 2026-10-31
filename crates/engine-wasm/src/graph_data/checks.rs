//! The rules of a node and of an edge (ADR-0028): a node's place, width, and height within the
//! world, an edge's ends, label, colour, and dash, and the lengths of the identifiers, each rule
//! through one function that a load, `addNode`, `addEdge`, and `updateEdge` reach alike.

use std::collections::{HashMap, HashSet};

use comb_engine::content::Fonts;
use comb_engine::geometry::WORLD_LIMIT;
use comb_engine::graph::{EdgeSpec, LabelPlacement};
use comb_engine::stroke::EdgeStyle;

use super::item::{Batch, Edge, Label, Node};
use super::{
    Arrow, ContentColumns, Cursor, GraphDataProblem, GraphList, ID_LIMIT, MAX_ID, MAX_TEXT,
    TEXT_LIMIT, check_id_budget, slot, utf16_length,
};

/// The nodes of a batch as the engine takes them: positions and sizes, `x, y` and `width, height`
/// per slot, and the map from identifier to slot.
pub(super) struct Nodes<'a> {
    pub(super) positions: Vec<f32>,
    pub(super) sizes: Vec<f32>,
    pub(super) slots: HashMap<&'a str, u32>,
    /// The code units of the strings of all their content, as the budget counted them.
    pub(super) units: u64,
}

/// The position and width of a node as the engine keeps them, `[x, y]` and `width`, or why the
/// node was refused: a coordinate or a width `f32` cannot hold, or a place past the world. Its
/// height is its content's, which `check` of its content computes.
pub(super) fn checked_node(node: &Node) -> Result<([f32; 2], f32), GraphDataProblem> {
    let named = || node.id.to_owned();
    // Checked as the engine keeps them: a number beyond `f32` is as infinite as infinity.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "checked as f32 below, so that what f32 cannot hold is refused"
    )]
    let [x, y, width] = [node.x, node.y, node.width].map(|v| v as f32);
    if !x.is_finite() || !y.is_finite() {
        return Err(GraphDataProblem::NonFiniteCoordinate { node: named() });
    }
    if !width.is_finite() || width < 0.0 {
        return Err(GraphDataProblem::InvalidSize { node: named() });
    }
    // Also its far side, `x + width`, which `f32` may hold where the sum turns infinite.
    let beyond = [("x", x, 0.0), ("y", y, 0.0), ("width", x, width)]
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
    Ok(([x, y], width))
}

/// Refuses the node `id` at `y` whose far side, `y + height`, its height the one its content lays
/// out to, lies past the world's limit (ADR-0028), naming the field `height`, as the world's
/// limit refuses a far side `x + width`.
pub(crate) fn within_by_height(id: &str, y: f32, height: f32) -> Result<(), GraphDataProblem> {
    // `y` lies within the limit and the height is not negative, so only the far side past the
    // positive limit is beyond. Compared as `height > limit - y`, which `f64` holds exactly where
    // it matters: a height of hundreds of units past a `y` on the limit, which `y + height` would
    // round back onto it.
    if f64::from(height) > WORLD_LIMIT - f64::from(y) {
        return Err(GraphDataProblem::BeyondWorld {
            list: GraphList::Nodes,
            id: id.to_owned(),
            field: "height".to_owned(),
            limit: WORLD_LIMIT,
        });
    }
    Ok(())
}

/// `height`, the height of a node's content as the layout computes it, as the `f32` the engine
/// keeps.
#[expect(
    clippy::cast_possible_truncation,
    reason = "the padding and at most MAX_ROWS rows of a line height of at most MAX_METRIC"
)]
pub(crate) const fn kept_height(height: f64) -> f32 {
    height as f32
}

/// Checks the nodes, their content in `content` laid out in `fonts`, and flattens them, or names
/// the first offending node.
pub(super) fn nodes_of<'a>(
    batch: &Batch<'a>,
    content: &ContentColumns,
    fonts: &Fonts,
) -> Result<Nodes<'a>, GraphDataProblem> {
    let mut slots = HashMap::with_capacity(batch.nodes.len());
    let mut positions = Vec::with_capacity(batch.nodes.len() * 2);
    let mut sizes = Vec::with_capacity(batch.nodes.len() * 2);
    let mut cursor = Cursor::default();
    for (index, node) in batch.nodes.iter().enumerate() {
        let (position, width) = checked_node(node)?;
        let height = content.check(index, node.id, &mut cursor, fonts)?;
        let height = kept_height(height);
        within_by_height(node.id, position[1], height)?;
        if slots.insert(node.id, slot(index)?).is_some() {
            return Err(GraphDataProblem::DuplicateNode {
                node: node.id.to_owned(),
            });
        }
        positions.extend(position);
        sizes.extend([width, height]);
    }
    Ok(Nodes {
        positions,
        sizes,
        slots,
        units: cursor.units(),
    })
}

/// Whether `value` is a colour `0xRRGGBB`: an integer from `0` to `0xFFFFFF`.
pub(super) fn rgb(value: f64) -> bool {
    value.fract() == 0.0 && (0.0..=f64::from(0xff_ffff)).contains(&value)
}

/// The placement of the label of the edge `id`, or why it was refused.
pub(super) fn label_placement(id: &str, label: &Label) -> Result<LabelPlacement, GraphDataProblem> {
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
pub(super) fn color_of(id: &str, color: f64) -> Result<u32, GraphDataProblem> {
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
pub(super) fn dash_of(id: &str, dash: [f64; 2]) -> Result<(f32, f32), GraphDataProblem> {
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
pub(super) fn spec_of(edge: &Edge, source: u32, target: u32) -> Result<EdgeSpec, GraphDataProblem> {
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
pub(super) fn edges_of(
    batch: &Batch,
    slots: &HashMap<&str, u32>,
) -> Result<Vec<EdgeSpec>, GraphDataProblem> {
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
pub(super) fn id_length(
    list: &str,
    index: usize,
    field: &str,
    id: &str,
) -> Result<usize, GraphDataProblem> {
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

/// Checks the length of every identifier of a load, the nodes' and the edges' by their lengths,
/// and of all of them together.
pub(super) fn ids_of(
    node_ids: impl IntoIterator<Item = usize>,
    edge_ids: impl IntoIterator<Item = [usize; 3]>,
) -> Result<(), GraphDataProblem> {
    let mut units = 0;
    for (index, length) in node_ids.into_iter().enumerate() {
        units += checked_id_length("nodes", index, "id", length)?;
    }
    for (index, lengths) in edge_ids.into_iter().enumerate() {
        units += edge_ids_of(index, lengths)?;
    }
    check_id_budget(units as f64)
}

/// The UTF-16 code units of the identifier, the source, and the target of the edge at `index`,
/// given as their `lengths`, as a load and `addEdge` check them, or the refusal of the first
/// longer than `MAX_ID`.
pub(super) fn edge_ids_of(index: usize, lengths: [usize; 3]) -> Result<usize, GraphDataProblem> {
    let mut units = 0;
    for (field, length) in ["id", "source", "target"].into_iter().zip(lengths) {
        units += checked_id_length("edges", index, field, length)?;
    }
    Ok(units)
}
