//! The rules of a node and of an edge (ARCH-one-workspace-per-example): a node's place, width, and
//! height within the world, its attachment, its container, its division, an empty list of regions
//! no regions, and the budget its regions' names count against; an edge's ends, label, colour, and
//! dash; and the lengths of the identifiers. Each rule of a node goes through one function that a
//! load, `addNode`, and `updateNode` reach alike, each where it sets what the rule reads, and each
//! rule of an edge through one that a load, `addEdge`, and `updateEdge` reach alike.

use std::collections::HashMap;

use comb_engine::content::Fonts;
use comb_engine::geometry::WORLD_LIMIT;
use comb_engine::graph::{Axis, EdgeSpec, End, LabelPlacement, Which};
use comb_engine::shape::{NodeShape, Outline};
use comb_engine::stroke::{Arrowhead, EdgeStyle};

use super::edge_columns::IdLengths;
use super::item::{Batch, Edge, EndRead, Label, Node};
use super::problem::{
    A_MARKED_CONTAINER, A_NODE_OF_THE_GRAPH, AN_OUTLINE, AN_UNDIVIDED, NOT_IN_ITSELF,
};
use super::{
    Arrow, ContentColumns, Cursor, GraphDataProblem, GraphList, ID_LIMIT, LABEL_LIMIT, MAX_ID,
    MAX_LABELS, MAX_TEXT, Region, TEXT_LIMIT, check_id_budget, slot, utf16_length, within_budget,
};

/// The nodes of a batch as the engine takes them: positions and sizes, `x, y` and `width, height`
/// per slot, their node shapes, and the map from identifier to slot.
pub(super) struct Nodes<'a> {
    pub(super) positions: Vec<f32>,
    pub(super) sizes: Vec<f32>,
    pub(super) shapes: Vec<NodeShape>,
    /// How each node's outline is drawn, as the engine keeps it (REN-node-shapes-cover-uml).
    pub(super) outlines: Vec<Outline>,
    /// The height each node's data gives, as the engine keeps it, or none, and whether the user
    /// may resize it (API-edits-report-division-moves).
    pub(super) given: Vec<Option<f32>>,
    pub(super) resizable: Vec<bool>,
    /// The height of each node's content, below which its regions lie; 0 without content
    /// (ARCH-regions-are-container-slots).
    pub(super) tops: Vec<f32>,
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

/// The height the data of `node` gives, as the engine keeps it, or none; refused as
/// `invalidSize` where, narrowed to `f32`, it is not finite or not above 0
/// (API-bridge-columns-keep-no-size).
pub(crate) fn given_height(id: &str, height: Option<f64>) -> Result<Option<f32>, GraphDataProblem> {
    let Some(height) = height else {
        return Ok(None);
    };
    // Checked as the engine keeps it: a number beyond `f32` is as infinite as infinity.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "checked as f32 below, so that what f32 cannot hold is refused"
    )]
    let height = height as f32;
    if !height.is_finite() || height <= 0.0 {
        return Err(GraphDataProblem::InvalidSize {
            node: id.to_owned(),
        });
    }
    Ok(Some(height))
}

/// The height of the node of node shape `shape`, `width` wide, whose content of `rows` rows is
/// `content` high with its padding, before the least height of a node, and whose data gives the
/// height `given`, or none, as the engine keeps it: `NodeShape::sized`
/// (REN-node-shapes-cover-uml, *Height*).
pub(crate) fn node_height(
    shape: NodeShape,
    width: f32,
    (content, rows): (f64, usize),
    given: Option<f32>,
) -> f32 {
    let content = (rows > 0).then_some(content);
    kept_height(shape.sized(f64::from(width), content, given.map(f64::from)))
}

/// The height of the node `id` at `y`, of node shape `shape` and `width` wide, whose content lays
/// out to `laid` and whose data gives the height `given`, or none, as `node_height` computes it;
/// refused as `beyondWorld` where its far side lies past the world's limit, by `within_by_height`.
/// The one rule of a node's height that a load, `addNode`, and `updateNode` reach.
pub(crate) fn checked_height(
    id: &str,
    shape: NodeShape,
    [y, width]: [f32; 2],
    laid: (f64, usize),
    given: Option<f32>,
) -> Result<f32, GraphDataProblem> {
    let height = node_height(shape, width, laid, given);
    within_by_height(id, y, height)?;
    Ok(height)
}

/// Refuses the node `id` at `y` whose far side, `y + height`, its height the one its content lays
/// out to, lies past the world's limit (ARCH-one-workspace-per-example), naming the field `height`,
/// as the world's limit refuses a far side `x + width`.
fn within_by_height(id: &str, y: f32, height: f32) -> Result<(), GraphDataProblem> {
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
    reason = "the padding and at most MAX_ROWS rows of a line height of at most MAX_METRIC, \
              grown by a node shape's inner rectangle, or a width f32 holds"
)]
pub(crate) const fn kept_height(height: f64) -> f32 {
    height as f32
}

/// How far below the top of a node of node shape `shape`, `width` wide, its regions lie, its
/// content `(content, rows)` as its layout gives it, its rows and their padding
/// (ARCH-regions-are-container-slots, *Division*): below an actor's or an hourglass's drawing and
/// its content, as high as `NodeShape::needed` makes them; below any other node's content, at
/// least the least height of a node; at 0 for another node without rows.
pub(crate) fn content_top(shape: NodeShape, width: f32, (content, rows): (f64, usize)) -> f32 {
    let content = if rows > 0 { content } else { 0.0 };
    if shape.drawing(f64::from(width)).is_some() {
        kept_height(shape.needed(f64::from(width), content))
    } else if rows > 0 {
        kept_height(content.max(comb_engine::content::MIN_HEIGHT))
    } else {
        0.0
    }
}

/// The outline `outline` of the node `id` at `index` as the engine keeps it, or its refusal as
/// `invalidField` naming the node and `outline`: a dash pattern is checked as an edge's is, as
/// `f32`, its dash positive and its gap not negative (REN-node-shapes-cover-uml, *Outline*). It
/// is read with the field, in the first pass, so that a dash pattern it refuses is named as a
/// value of another type is.
pub(crate) fn outline_of(
    id: &str,
    index: usize,
    outline: super::Outline,
) -> Result<Outline, GraphDataProblem> {
    Ok(match outline {
        super::Outline::Solid => Outline::Solid,
        super::Outline::None => Outline::None,
        super::Outline::Dashed(super::Pair(dash)) => {
            let (dash, gap) = dash_of(id, dash).map_err(|_| GraphDataProblem::InvalidField {
                list: GraphList::Nodes,
                index: slot(index).unwrap_or(u32::MAX),
                id: Some(id.to_owned()),
                field: "outline".to_owned(),
                expected: AN_OUTLINE.to_owned(),
            })?;
            Outline::Dashed([dash, gap])
        }
    })
}

/// Refuses content of `rows` rows in the node `id` of the filled node shape `shape`, which holds
/// none (REN-node-shapes-cover-uml).
pub(crate) fn content_fits_shape(
    id: &str,
    shape: NodeShape,
    rows: usize,
) -> Result<(), GraphDataProblem> {
    if rows > 0 && !shape.holds_content() {
        return Err(GraphDataProblem::ContentInFilledShape {
            node: id.to_owned(),
        });
    }
    Ok(())
}

/// What a node's data gives that the rule of its attachment reads (ARCH-border-nodes-ride-sides):
/// whether it gives `x`, `y`, `container`, `side`, and `offset` at all, of any type; whether it
/// marks the node a container; whether it divides it into regions, as `divided` finds; and
/// whether it makes it resizable.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Given {
    pub x: bool,
    pub y: bool,
    pub container: bool,
    pub is_container: bool,
    pub regions: bool,
    pub resizable: bool,
    pub side: bool,
    pub offset: bool,
}

impl Given {
    /// What the byte of a load's column `given` says a node gives, by its bits: 1 `x`, 2 `y`,
    /// 4 `container`, 8 `side`, and 16 `offset`; the rest the load's other columns say.
    pub(crate) const fn of_bits(bits: u8) -> Self {
        Self {
            x: bits & 1 != 0,
            y: bits & 2 != 0,
            container: bits & 4 != 0,
            is_container: false,
            regions: false,
            resizable: false,
            side: bits & 8 != 0,
            offset: bits & 16 != 0,
        }
    }

    /// The bits `of_bits` reads, as the snapshot of a load writes them.
    #[cfg(test)]
    pub(crate) fn bits(self) -> u8 {
        [self.x, self.y, self.container, self.side, self.offset]
            .into_iter()
            .enumerate()
            .map(|(bit, given)| u8::from(given) << bit)
            .sum()
    }
}

/// The refusal of the node `node` as `invalidAttachment` by its field `field`
/// (ARCH-border-nodes-ride-sides).
pub(crate) fn invalid_attachment(node: &str, field: &str) -> GraphDataProblem {
    GraphDataProblem::InvalidAttachment {
        node: node.to_owned(),
        field: field.to_owned(),
    }
}

/// Refuses as `invalidAttachment` the node `id`, a border node where `bordered`, by the first field
/// of what its data gives, `given`, that it may not have: a border node no `x`, `y`, or
/// `container`, no mark as a container, no regions, and no resizing; any other node no `side` and
/// no `offset` (ARCH-border-nodes-ride-sides). The one rule of a node's attachment that a load,
/// `addNode`, and `updateNode` reach.
pub(crate) fn check_attachment(
    id: &str,
    bordered: bool,
    given: Given,
) -> Result<(), GraphDataProblem> {
    // Each field with whether the data gives it and whether a border node, or else any other, may
    // not have it.
    let fields = [
        ("x", given.x, true),
        ("y", given.y, true),
        ("container", given.container, true),
        ("isContainer", given.is_container, true),
        ("regions", given.regions, true),
        ("resizable", given.resizable, true),
        ("side", given.side, false),
        ("offset", given.offset, false),
    ];
    fields
        .into_iter()
        .find(|&(_, given, of_a_border)| given && of_a_border == bordered)
        .map_or(Ok(()), |(field, ..)| Err(invalid_attachment(id, field)))
}

/// What the slot a node's container names holds, as the rule of the container reads it: whether
/// that node or region is divided into regions, and whether it is a container
/// (ARCH-engine-edits-nested-graph, ARCH-regions-are-container-slots).
#[derive(Clone, Copy)]
pub(super) struct Holder {
    pub(super) divided: bool,
    pub(super) is_container: bool,
}

/// Refuses as `invalidContainer` the node `id` whose container names `holder`, by what that
/// container has to be: none for a slot that holds no node of the graph, a node or a region
/// divided into regions, which holds its regions alone, a node that is no container, and, where
/// `in_itself`, the node itself or a node it holds. The one rule of a node's container that a load
/// and `addNode` reach; `updateNode` sets no container.
pub(super) fn check_container(
    id: &str,
    holder: Option<Holder>,
    in_itself: bool,
) -> Result<(), GraphDataProblem> {
    let expected = match holder {
        None => A_NODE_OF_THE_GRAPH,
        Some(holder) if holder.divided => AN_UNDIVIDED,
        Some(holder) if !holder.is_container => A_MARKED_CONTAINER,
        Some(_) if in_itself => NOT_IN_ITSELF,
        Some(_) => return Ok(()),
    };
    Err(GraphDataProblem::InvalidContainer {
        node: id.to_owned(),
        field: "container".to_owned(),
        expected: expected.to_owned(),
    })
}

/// The direction a node is divided in by `divide` into `regions`: none for an empty list of
/// regions, which is no regions, as for no division (ARCH-regions-are-container-slots). The one
/// rule of an empty list that a load, `addNode`, and `updateNode` reach.
pub(crate) fn divided(divide: Option<Axis>, regions: &[Region]) -> Option<Axis> {
    divide.filter(|_| !regions.is_empty())
}

/// The code units of the names of `regions`, the regions of the node `id`, which count against
/// the budget of content beside `held`, the code units of content the graph or the load holds
/// besides them, the node's own among them; refused as the budget refuses where they pass it
/// (ARCH-regions-are-container-slots). The one rule of the regions' names that a load, `addNode`,
/// and `updateNode` reach.
pub(crate) fn names_within(
    id: &str,
    held: u64,
    regions: &[Region],
) -> Result<u64, GraphDataProblem> {
    let names = regions.iter().map(Region::name_units).sum();
    if names > 0 {
        within_budget(id, held + names)?;
    }
    Ok(names)
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
    let mut shapes = Vec::with_capacity(batch.nodes.len());
    let mut outlines = Vec::with_capacity(batch.nodes.len());
    let mut given = Vec::with_capacity(batch.nodes.len());
    let mut tops = Vec::with_capacity(batch.nodes.len());
    let mut cursor = Cursor::default();
    for (index, node) in batch.nodes.iter().enumerate() {
        let (position, width) = checked_node(node)?;
        let height_given = given_height(node.id, node.height)?;
        outlines.push(node.outline);
        let rows = content.rows(index).len();
        content_fits_shape(node.id, node.shape, rows)?;
        let laid = content.check(index, node.id, &mut cursor, fonts)?;
        let height = checked_height(
            node.id,
            node.shape,
            [position[1], width],
            (laid, rows),
            height_given,
        )?;
        tops.push(content_top(node.shape, width, (laid, rows)));
        if slots.insert(node.id, slot(index)?).is_some() {
            return Err(GraphDataProblem::DuplicateNode {
                node: node.id.to_owned(),
            });
        }
        positions.extend(position);
        sizes.extend([width, height]);
        shapes.push(node.shape);
        given.push(height_given);
    }
    Ok(Nodes {
        positions,
        sizes,
        shapes,
        outlines,
        resizable: batch.nodes.iter().map(|node| node.resizable).collect(),
        given,
        tops,
        slots,
        units: cursor.units(),
    })
}

/// Whether `value` is a colour `0xRRGGBB`: an integer from `0` to `0xFFFFFF`.
pub(super) fn rgb(value: f64) -> bool {
    value.fract() == 0.0 && (0.0..=f64::from(0xff_ffff)).contains(&value)
}

/// The placement of each label of the edge `id`, in its order, or why one was refused: more
/// than `MAX_LABELS` of them, then each label in turn, an identifier its edge's labels hold
/// before it, a path parameter or offset not finite, an offset past the world, a text, and a
/// background (API-edges-dock-nodes-or-edges, *Edge labels*).
pub(super) fn label_placements(
    id: &str,
    labels: &[Label],
) -> Result<Vec<LabelPlacement>, GraphDataProblem> {
    let edge = || id.to_owned();
    if labels.len() > MAX_LABELS {
        return Err(GraphDataProblem::TooManyLabels {
            edge: edge(),
            limit: LABEL_LIMIT,
        });
    }
    let mut placements = Vec::with_capacity(labels.len());
    for (i, label) in labels.iter().enumerate() {
        let named = || label.id.to_owned();
        if labels[..i].iter().any(|before| before.id == label.id) {
            return Err(GraphDataProblem::DuplicateLabel {
                edge: edge(),
                label: named(),
            });
        }
        placements.push(label_placement(id, i, label)?);
    }
    Ok(placements)
}

/// The placement of the label at `index` of the edge `id`, or why it was refused.
fn label_placement(
    id: &str,
    index: usize,
    label: &Label,
) -> Result<LabelPlacement, GraphDataProblem> {
    let (edge, named) = (|| id.to_owned(), || label.id.to_owned());
    if !(label.t.is_finite() && label.offset.is_finite()) {
        return Err(GraphDataProblem::NonFiniteLabel {
            edge: edge(),
            label: named(),
        });
    }
    if label.offset.abs() > WORLD_LIMIT {
        return Err(GraphDataProblem::BeyondWorld {
            list: GraphList::Edges,
            id: edge(),
            field: format!("labels[{index}].offset"),
            limit: WORLD_LIMIT,
        });
    }
    match label.text_length {
        None => {
            return Err(GraphDataProblem::InvalidLabelText {
                edge: edge(),
                label: named(),
            });
        }
        Some(length) if length > MAX_TEXT => {
            return Err(GraphDataProblem::LabelTextTooLong {
                edge: edge(),
                label: named(),
                limit: TEXT_LIMIT,
            });
        }
        Some(_) => {}
    }
    if label.background.is_some_and(|b| !rgb(b)) {
        return Err(GraphDataProblem::InvalidBackground {
            edge: edge(),
            label: named(),
        });
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

/// The arrowhead the engine draws for `arrow` (API-edges-dock-nodes-or-edges, *Arrowheads*).
pub(super) const fn arrowhead_of(arrow: Arrow) -> Arrowhead {
    match arrow {
        Arrow::End => Arrowhead::End,
        Arrow::None => Arrowhead::None,
        Arrow::Open => Arrowhead::Open,
        Arrow::Hollow => Arrowhead::Hollow,
    }
}

/// The label placements and style of an edge, or why they were refused.
fn placement_of(edge: &Edge) -> Result<(Vec<LabelPlacement>, EdgeStyle), GraphDataProblem> {
    let labels = label_placements(edge.id, &edge.labels)?;
    let style = EdgeStyle {
        color: color_of(edge.id, edge.color)?,
        dash: edge.dash.map(|dash| dash_of(edge.id, dash)).transpose()?,
        arrow: arrowhead_of(edge.arrow),
        lightning: edge.lightning,
    };
    Ok((labels, style))
}

/// The edge as the engine keeps it between the ends `source` and `target`, as a load and `addEdge`
/// build it, or why its label or style was refused.
pub(super) fn spec_of(edge: &Edge, source: End, target: End) -> Result<EdgeSpec, GraphDataProblem> {
    let (labels, style) = placement_of(edge)?;
    Ok(EdgeSpec {
        sides: edge.sides(),
        source,
        target,
        labels,
        style,
    })
}

/// The field that names the end `which` of an edge where it lies on an edge, as `invalidEdgeEnd`
/// names it (API-edges-dock-nodes-or-edges).
pub(super) const fn edge_end_field(which: Which) -> &'static str {
    match which {
        Which::Source => "sourceEdge",
        Which::Target => "targetEdge",
    }
}

/// Resolves every edge's ends to slots, or names the first offending edge: in the order of the
/// edges, the second of two that share an identifier, or one whose end names a node the batch
/// does not hold, or whose label or style were refused; then, once every edge is read, so that an
/// edge may end on one later in the list, one whose end names an edge the batch does not hold, the
/// edge itself, or one that ends on an edge (API-edges-dock-nodes-or-edges, *Ends*).
pub(super) fn edges_of(
    batch: &Batch,
    slots: &HashMap<&str, u32>,
) -> Result<Vec<EdgeSpec>, GraphDataProblem> {
    let mut seen = HashMap::with_capacity(batch.edges.len());
    let end = |edge: &Edge, end: EndRead| match end {
        EndRead::Node { id, .. } => {
            slots
                .get(id)
                .copied()
                .map(End::Node)
                .ok_or_else(|| GraphDataProblem::MissingNode {
                    edge: Some(edge.id.to_owned()),
                    border_node: None,
                    node: id.to_owned(),
                })
        }
        // Resolved below, once every edge is read.
        EndRead::Edge { t, .. } => Ok(End::Edge { slot: u32::MAX, t }),
    };
    let mut specs = Vec::with_capacity(batch.edges.len());
    for (index, edge) in batch.edges.iter().enumerate() {
        if seen.insert(edge.id, slot(index)?).is_some() {
            return Err(GraphDataProblem::DuplicateEdge {
                edge: edge.id.to_owned(),
            });
        }
        specs.push(spec_of(
            edge,
            end(edge, edge.source)?,
            end(edge, edge.target)?,
        )?);
    }
    let on = |edge: &Edge, end: EndRead| match end {
        EndRead::Node { .. } => Ok(None),
        EndRead::Edge { id, .. } => {
            seen.get(id)
                .copied()
                .map(Some)
                .ok_or_else(|| GraphDataProblem::MissingEdge {
                    edge: edge.id.to_owned(),
                    missing: id.to_owned(),
                })
        }
    };
    for (index, edge) in batch.edges.iter().enumerate() {
        let ends = [(Which::Source, edge.source), (Which::Target, edge.target)];
        for (which, read) in ends {
            let Some(on) = on(edge, read)? else { continue };
            let spec = &specs[on as usize];
            let ends_on_edge = spec.source.edge().is_some() || spec.target.edge().is_some();
            if on as usize == index || ends_on_edge {
                return Err(GraphDataProblem::InvalidEdgeEnd {
                    edge: edge.id.to_owned(),
                    end: edge_end_field(which).to_owned(),
                });
            }
            let resolved = &mut specs[index];
            let at = match which {
                Which::Source => &mut resolved.source,
                Which::Target => &mut resolved.target,
            };
            if let End::Edge { slot, .. } = at {
                *slot = on;
            }
        }
    }
    Ok(specs)
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
/// each edge's with its labels', and of all of them together.
pub(super) fn ids_of<L: IntoIterator<Item = usize>>(
    node_ids: impl IntoIterator<Item = usize>,
    edge_ids: impl IntoIterator<Item = (IdLengths, L)>,
) -> Result<(), GraphDataProblem> {
    let mut units = 0;
    for (index, length) in node_ids.into_iter().enumerate() {
        units += checked_id_length("nodes", index, "id", length)?;
    }
    for (index, (lengths, labels)) in edge_ids.into_iter().enumerate() {
        units += edge_ids_of(index, lengths, labels)?;
    }
    check_id_budget(units as f64)
}

/// The UTF-16 code units of the identifier, the source, and the target of the edge at `index`,
/// given as their `lengths`, and of the identifiers of its labels, given as `labels`, as a load
/// and `addEdge` check them, or the refusal of the first longer than `MAX_ID`, an end named by
/// the field that names it, `sourceEdge` or `targetEdge` for an end on an edge, and a label's
/// named as `labels`.
pub(super) fn edge_ids_of(
    index: usize,
    named: IdLengths,
    labels: impl IntoIterator<Item = usize>,
) -> Result<usize, GraphDataProblem> {
    let ends = [Which::Source, Which::Target]
        .into_iter()
        .zip(named.on_edge)
        .map(|(which, on_edge)| match (which, on_edge) {
            (_, true) => edge_end_field(which),
            (Which::Source, false) => "source",
            (Which::Target, false) => "target",
        });
    let mut units = 0;
    for (field, length) in std::iter::once("id").chain(ends).zip(named.lengths) {
        units += checked_id_length("edges", index, field, length)?;
    }
    Ok(units + label_ids_of(index, labels)?)
}

/// The UTF-16 code units of the identifiers of the labels of the edge at `index`, given as their
/// `lengths`, or the refusal of the first longer than `MAX_ID`, named as `labels`
/// (API-edges-dock-nodes-or-edges).
pub(super) fn label_ids_of(
    index: usize,
    lengths: impl IntoIterator<Item = usize>,
) -> Result<usize, GraphDataProblem> {
    let mut units = 0;
    for length in lengths {
        units += checked_id_length("edges", index, "labels", length)?;
    }
    Ok(units)
}

// The malformed-data tests of graph data verify API-bridge-columns-keep-no-size (see
// `graph_data::tests`). Verifies: API-bridge-columns-keep-no-size
#[cfg(test)]
mod tests {
    use super::super::tests::{add, added, batch, beyond, d_and, label_in, load_edges, titled};
    use super::super::{
        EdgeCells, Field, GraphBatch, LabelInput, NodeInput, OwnedEdgeColumns, Pair, graph_of,
        item::batch_of,
    };
    use super::*;
    // The export itself, as on the crate root, so that its tests go through it.
    use crate::check_id_budget;

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
        for width in [-1.0, f64::INFINITY, f64::NAN] {
            let mut data = batch(&[("a", 0.0, 0.0)], &[]);
            data.nodes[0].width = width.into();
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
                edge: Some("e".into()),
                border_node: None,
                node: "z".into()
            }
        );
    }

    #[test]
    fn a_non_finite_label_names_its_edge() {
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
        data.edges[0].labels = Some(vec![Field(Some(LabelInput {
            id: "m".to_owned().into(),
            text_length: Some(1),
            t: Some(f64::NAN).into(),
            offset: Some(0.0).into(),
            background: None,
        }))])
        .into();
        let error = graph_of(&data).unwrap_err();
        assert_eq!(
            error,
            GraphDataProblem::NonFiniteLabel {
                edge: "e".into(),
                label: "m".into(),
            }
        );
    }

    #[test]
    fn a_node_whose_place_or_far_side_lies_past_the_world_names_it_and_the_field() {
        // Verifies: Q-7, ARCH-one-workspace-per-example
        // 3e38 is a finite f32, as is 3e38 + 3e38 in f64, which f32 cannot hold.
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 3e38, 0.0)], &[]);
        data.nodes[1].width = 3e38.into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            beyond(GraphList::Nodes, "b", "x")
        );
        // Each within the limit, the far side past it: 2^119 + 2^119 + 1e30.
        let half = WORLD_LIMIT / 2.0;
        for (field, x, y, width) in [
            ("width", half, 0.0, half + 1e30),
            ("y", 0.0, -WORLD_LIMIT * 1.01, 10.0),
        ] {
            let mut data = batch(&[("a", x, y)], &[]);
            data.nodes[0].width = width.into();
            assert_eq!(
                graph_of(&data).unwrap_err(),
                beyond(GraphList::Nodes, "a", field)
            );
        }
        // On the limit, its far side past it by the height its content lays out to, 64, is refused
        // by that height; on the limit at the other side, its far side lies within, and it is
        // taken.
        let data = batch(&[("a", 0.0, WORLD_LIMIT)], &[]);
        assert_eq!(
            graph_of(&data).unwrap_err(),
            beyond(GraphList::Nodes, "a", "height")
        );
        let data = batch(&[("a", -WORLD_LIMIT, -WORLD_LIMIT)], &[]);
        assert!(graph_of(&data).is_ok());
        // So is a node `addNode` hands over.
        let mut graph = graph_of(&batch(&[("b", 0.0, 0.0)], &[])).unwrap();
        assert_eq!(
            add(&mut graph, &added(0.0, WORLD_LIMIT, |_| {})),
            Err(beyond(GraphList::Nodes, "n", "height"))
        );
        assert_eq!(graph.nodes_in_use(), 1);
    }

    #[test]
    fn a_label_offset_past_the_world_names_its_edge_and_the_field() {
        // Verifies: Q-7, ARCH-one-workspace-per-example
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
        data.edges[0].labels = Some(vec![Field(Some(LabelInput {
            id: "m".to_owned().into(),
            text_length: Some(1),
            t: Some(0.5).into(),
            offset: Some(-WORLD_LIMIT * 2.0).into(),
            background: None,
        }))])
        .into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            beyond(GraphList::Edges, "e", "labels[0].offset")
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
    fn a_label_text_or_background_pixi_cannot_draw_names_its_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let label = |text, background| {
            let mut data = batch(&two, &[("e", "a", "b")]);
            data.edges[0].labels = Some(vec![Field(Some(LabelInput {
                id: "m".to_owned().into(),
                text_length: text,
                t: Some(0.5).into(),
                offset: Some(0.0).into(),
                background,
            }))])
            .into();
            graph_of(&data)
        };
        assert!(label(Some(1), None).is_ok());
        assert!(label(Some(1), Some(0.0)).is_ok());
        assert!(label(Some(1), Some(f64::from(0xff_ffff))).is_ok());
        assert_eq!(
            label(None, None).unwrap_err(),
            GraphDataProblem::InvalidLabelText {
                edge: "e".into(),
                label: "m".into(),
            }
        );
        for background in [-5.0, 1.5, f64::NAN, 1e20, f64::from(0x100_0000)] {
            assert_eq!(
                label(Some(1), Some(background)).unwrap_err(),
                GraphDataProblem::InvalidBackground {
                    edge: "e".into(),
                    label: "m".into(),
                }
            );
        }
    }

    #[test]
    fn a_text_longer_than_its_limit_names_its_node_or_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let mut data = batch(&two, &[("e", "a", "b")]);
        data.nodes[0].content = titled(&"x".repeat(MAX_TEXT));
        data.edges[0].labels = Some(vec![Field(Some(LabelInput {
            id: "m".to_owned().into(),
            text_length: Some(MAX_TEXT),
            t: Some(0.5).into(),
            offset: Some(0.0).into(),
            background: None,
        }))])
        .into();
        assert!(graph_of(&data).is_ok());
        data.nodes[0].content = titled(&"x".repeat(MAX_TEXT + 1));
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::ContentTextTooLong {
                node: "a".into(),
                row: 0,
                column: 0,
                field: "text".into(),
                limit: 1_000
            }
        );
        data.nodes[0].content = titled(&"x".repeat(MAX_TEXT));
        if let Field(Some(Some(labels))) = &mut data.edges[0].labels
            && let Some(Field(Some(label))) = labels.first_mut()
        {
            label.text_length = Some(MAX_TEXT + 1);
        }
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::LabelTextTooLong {
                edge: "e".into(),
                label: "m".into(),
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
                    x: 0.0.into(),
                    y: 0.0.into(),
                    width: 1.0.into(),
                    shape: crate::NodeShape::Rectangle.into(),
                    container: None.into(),
                    is_container: None.into(),
                    height: None.into(),
                    resizable: None.into(),
                    outline: None.into(),
                    divide: None.into(),
                    regions: None.into(),
                    attached_to: None.into(),
                    side: None.into(),
                    offset: None.into(),
                    content: titled("x"),
                })
                .collect(),
            edges: Vec::new(),
        };
        // 250,000 identifiers of 256 code units hold 64,000,000 together.
        let ids = |count| {
            let data = nodes(count);
            let batch = batch_of(&data).unwrap();
            let edges = batch.edges.iter();
            let edges = edges.map(|e| {
                let labels = e.labels.iter().map(|label| utf16_length(label.id));
                let named = IdLengths {
                    lengths: [e.id, e.source.id(), e.target.id()].map(utf16_length),
                    on_edge: [false; 2],
                };
                (named, labels)
            });
            ids_of(batch.nodes.iter().map(|n| utf16_length(n.id)), edges)
        };
        assert_eq!(ids(250_000), Ok(()));
        assert_eq!(
            ids(250_001),
            Err(GraphDataProblem::IdBudgetExceeded { limit: 64_000_000 })
        );
    }

    #[test]
    fn every_rule_of_an_edge_refuses_its_columns_with_its_kind_and_names() {
        // Verifies: API-bridge-columns-keep-no-size
        let e = || "e".to_owned();
        let text = |value: &str| Field(Some(value.to_owned()));
        // The rules, after every field's type.
        let cases: Vec<(OwnedEdgeColumns, GraphDataProblem)> = vec![
            (
                d_and(|e| e.target = Field(Some(Some("z".to_owned())))),
                GraphDataProblem::MissingNode {
                    edge: Some(e()),
                    border_node: None,
                    node: "z".into(),
                },
            ),
            (
                d_and(|e| e.id = text("d")),
                GraphDataProblem::DuplicateEdge { edge: "d".into() },
            ),
            (
                d_and(|e| e.source = "x".repeat(MAX_ID + 1).into()),
                GraphDataProblem::IdTooLong {
                    list: "edges".into(),
                    index: 1,
                    field: "source".into(),
                    limit: ID_LIMIT,
                },
            ),
            (
                d_and(|e| e.color = 1.5.into()),
                GraphDataProblem::InvalidColor { edge: e() },
            ),
            (
                d_and(|e| e.dash = Some(Pair([0.0, 4.0])).into()),
                GraphDataProblem::InvalidDash { edge: e() },
            ),
        ];
        for (columns, problem) in cases {
            assert_eq!(load_edges(&columns).err(), Some(problem));
        }
        // Without a label, a dash, or a background, an edge holds none.
        let plain = OwnedEdgeColumns::of([Some(&EdgeCells::from(
            &batch(&[], &[("p", "a", "b")]).edges[0],
        ))]);
        let graph = load_edges(&plain).unwrap();
        let edge = graph.edge(0).unwrap();
        assert_eq!((edge.labels.as_slice(), edge.style.dash), (&[][..], None));
        assert!(load_edges(&d_and(|_| {})).is_ok());
    }

    #[test]
    fn every_rule_of_a_label_refuses_its_columns_naming_its_edge_and_the_label() {
        // Verifies: API-bridge-columns-keep-no-size, API-edges-dock-nodes-or-edges
        let (e, m) = (|| "e".to_owned(), || "m".to_owned());
        let cases: Vec<(OwnedEdgeColumns, GraphDataProblem)> = vec![
            (
                d_and(|e| label_in(e).text_length = Some(MAX_TEXT + 1)),
                GraphDataProblem::LabelTextTooLong {
                    edge: e(),
                    label: m(),
                    limit: TEXT_LIMIT,
                },
            ),
            // A label text missing, of another type, or with a lone surrogate is no text.
            (
                d_and(|e| label_in(e).text_length = None),
                GraphDataProblem::InvalidLabelText {
                    edge: e(),
                    label: m(),
                },
            ),
            // A background of another type crosses as NaN.
            (
                d_and(|e| label_in(e).background = Some(f64::NAN)),
                GraphDataProblem::InvalidBackground {
                    edge: e(),
                    label: m(),
                },
            ),
            (
                d_and(|e| label_in(e).background = Some(f64::from(0x100_0000))),
                GraphDataProblem::InvalidBackground {
                    edge: e(),
                    label: m(),
                },
            ),
            (
                d_and(|e| label_in(e).t = Some(f64::INFINITY).into()),
                GraphDataProblem::NonFiniteLabel {
                    edge: e(),
                    label: m(),
                },
            ),
            (
                d_and(|e| label_in(e).offset = Some(WORLD_LIMIT * 2.0).into()),
                beyond(GraphList::Edges, "e", "labels[0].offset"),
            ),
        ];
        for (columns, problem) in cases {
            assert_eq!(load_edges(&columns).err(), Some(problem));
        }
    }
}

/// Each rule of a node through a load, `addNode`, and `updateNode` alike: the attachment, an empty
/// list of regions, and the container, which `updateNode` does not set
/// (ARCH-one-workspace-per-example). The budget of the regions' names goes through all three in
/// the tests of `regions`.
#[cfg(test)]
mod node_rules {
    use super::super::tests::{added, load_columns};
    use super::super::{
        Divide, Field, GraphDataProblem, Line, NodeInput, NodePatch, OwnedColumns, PatchValue,
        RegionInput, Side,
    };
    use super::{A_MARKED_CONTAINER, A_NODE_OF_THE_GRAPH, AN_UNDIVIDED};
    use crate::{CallRefusal, Engine};

    /// The action `a` at (100, 50), 100 wide, which `p` rides where it is a border node.
    fn a() -> NodeInput {
        added(100.0, 50.0, |n| n.id = "a".to_owned().into())
    }

    /// The node `p`: on the top of `a` where `bordered`, else at (0, 0); made by `change`.
    fn p(bordered: bool, change: &dyn Fn(&mut NodeInput)) -> NodeInput {
        let mut p = added(0.0, 0.0, |n| n.id = "p".to_owned().into());
        if bordered {
            p.x = Field::absent();
            p.y = Field::absent();
            p.attached_to = Some("a".to_owned()).into();
            p.side = Some(Side::Top).into();
            p.offset = Some(0.0).into();
        }
        change(&mut p);
        p
    }

    /// One solid region `r` of 50, divided by nothing of its own.
    fn regions() -> Vec<RegionInput> {
        vec![RegionInput {
            id: "r".to_owned().into(),
            name: None.into(),
            size: 50.0.into(),
            line: Line::Solid.into(),
            divide: None.into(),
            of: None.into(),
        }]
    }

    /// What a load of `a` and `p`, `addNode` of `p` beside `a`, and `updateNode` of `p`, as
    /// `p(bordered, ..)` makes it, by `patch` refuse; `updateNode` also changes nothing it refuses.
    fn three(
        bordered: bool,
        change: &dyn Fn(&mut NodeInput),
        patch: Vec<(&str, PatchValue)>,
    ) -> [Result<(), GraphDataProblem>; 3] {
        let node = p(bordered, change);
        let loaded = load_columns(&OwnedColumns::of([Some(&a()), Some(&node)])).map(drop);
        let rides = bordered.then_some(0);
        let mut engine = Engine::new();
        engine.add(&a(), (None, None)).unwrap();
        let added = engine.add(&node, (None, rides)).map(drop);
        let mut engine = Engine::new();
        engine.add(&a(), (None, None)).unwrap();
        let slot = engine.add(&p(bordered, &|_| ()), (None, rides)).unwrap();
        let before = (engine.graph.sizes().to_vec(), engine.graph.regions_of(slot));
        let patch = NodePatch(patch.into_iter().map(|(k, v)| (k.to_owned(), v)).collect());
        let updated = engine
            .update(slot, "p", &patch)
            .map_err(|refusal| match refusal {
                CallRefusal::Data(problem) => problem,
                other => panic!("a patch refused as {other:?}"),
            });
        if updated.is_err() {
            let after = (engine.graph.sizes().to_vec(), engine.graph.regions_of(slot));
            assert_eq!(after, before);
        }
        [loaded, added, updated]
    }

    fn attachment(field: &str) -> Result<(), GraphDataProblem> {
        Err(super::invalid_attachment("p", field))
    }

    #[test]
    fn the_attachment_is_refused_by_the_same_field_in_a_load_add_node_and_update_node() {
        // Verifies: ARCH-border-nodes-ride-sides, ARCH-one-workspace-per-example
        let across = || PatchValue::Divide(Some(Divide::Across).into());
        let resizable = |n: &mut NodeInput| n.resizable = Some(true).into();
        let divided = |n: &mut NodeInput| {
            n.divide = Some(Divide::Across).into();
            n.regions = Some(regions()).into();
        };
        let sided = |n: &mut NodeInput| n.side = Some(Side::Left).into();
        let offset = |n: &mut NodeInput| n.offset = Some(4.0).into();
        // Whether `p` is a border node, the change of its data, the patch, and the field refused.
        type Case<'c> = (
            bool,
            &'c dyn Fn(&mut NodeInput),
            Vec<(&'c str, PatchValue)>,
            &'c str,
        );
        let cases: [Case; 4] = [
            (
                true,
                &resizable,
                vec![("resizable", PatchValue::Resizable(Field(Some(true))))],
                "resizable",
            ),
            (
                true,
                &divided,
                vec![
                    ("divide", across()),
                    ("regions", PatchValue::Regions(Some(regions()).into())),
                ],
                "regions",
            ),
            (
                false,
                &sided,
                vec![("side", PatchValue::Side(Side::Left.into()))],
                "side",
            ),
            (
                false,
                &offset,
                vec![("offset", PatchValue::Offset(4.0.into()))],
                "offset",
            ),
        ];
        for (bordered, change, patch, field) in cases {
            assert_eq!(
                three(bordered, change, patch),
                [0, 1, 2].map(|_| attachment(field))
            );
        }
    }

    #[test]
    fn a_patch_is_checked_by_every_field_before_the_rule_of_its_attachment_as_a_load_is() {
        // Verifies: ARCH-border-nodes-ride-sides, ARCH-one-workspace-per-example
        // A border node's regions without a division are refused by the division they lack.
        let undivided = |n: &mut NodeInput| n.regions = Some(regions()).into();
        let patch = vec![("regions", PatchValue::Regions(Some(regions()).into()))];
        for refused in three(true, &undivided, patch) {
            assert!(
                matches!(&refused, Err(GraphDataProblem::InvalidField { field, .. }) if field == "divide"),
                "{refused:?}"
            );
        }
        // A side of a node that is no border node, beside a height not above 0, by the height.
        let low = |n: &mut NodeInput| {
            n.side = Some(Side::Left).into();
            n.height = Some(0.0).into();
        };
        let patch = vec![
            ("side", PatchValue::Side(Side::Left.into())),
            ("height", PatchValue::Height(0.0.into())),
        ];
        let invalid = || Err(GraphDataProblem::InvalidSize { node: "p".into() });
        assert_eq!(three(false, &low, patch), [0, 1, 2].map(|_| invalid()));
    }

    #[test]
    fn a_patch_is_held_to_the_budget_of_its_regions_names_before_the_rule_of_its_attachment() {
        // Verifies: ARCH-border-nodes-ride-sides, ARCH-regions-are-container-slots
        use super::super::TEST_BUDGET;
        // The titles of `a` and `p` hold 2 code units; a border node's region named by 6 passes a
        // budget of 4 before its regions are refused, in all three as in a load.
        let named = || {
            let mut named = regions();
            named[0].name = Some("123456".to_owned()).into();
            named
        };
        let divided = |n: &mut NodeInput| {
            n.divide = Some(Divide::Across).into();
            n.regions = Some(named()).into();
        };
        let patch = vec![
            ("divide", PatchValue::Divide(Some(Divide::Across).into())),
            ("regions", PatchValue::Regions(Some(named()).into())),
        ];
        TEST_BUDGET.set(Some(4));
        let refused = three(true, &divided, patch);
        TEST_BUDGET.set(None);
        for refused in refused {
            assert!(
                matches!(&refused, Err(GraphDataProblem::ContentBudgetExceeded { node, .. }) if node == "p"),
                "{refused:?}"
            );
        }
    }

    #[test]
    fn an_empty_list_of_regions_divides_no_node_and_no_border_node_in_a_load_add_node_and_update_node()
     {
        // Verifies: ARCH-regions-are-container-slots, ARCH-border-nodes-ride-sides
        let none = |n: &mut NodeInput| {
            n.divide = Some(Divide::Across).into();
            n.regions = Some(Vec::new()).into();
        };
        for bordered in [true, false] {
            let patch = vec![
                ("divide", PatchValue::Divide(Some(Divide::Across).into())),
                ("regions", PatchValue::Regions(Some(Vec::new()).into())),
            ];
            assert_eq!(three(bordered, &none, patch), [Ok(()), Ok(()), Ok(())]);
        }
    }

    #[test]
    fn a_container_is_refused_by_the_same_words_in_a_load_and_add_node_and_a_load_in_slot_order() {
        // Verifies: ARCH-engine-edits-nested-graph, ARCH-regions-are-container-slots
        let invalid = |node: &str, expected: &str| {
            Err(GraphDataProblem::InvalidContainer {
                node: node.into(),
                field: "container".into(),
                expected: expected.into(),
            })
        };
        let n = added(10.0, 10.0, |n| n.id = "n".to_owned().into());
        // `a` divided across into `r`, marked a container or not.
        let divided = || {
            added(100.0, 50.0, |n| {
                n.id = "a".to_owned().into();
                n.divide = Some(Divide::Across).into();
                n.regions = Some(regions()).into();
            })
        };
        let cases = [
            (a(), false, Some(7), A_NODE_OF_THE_GRAPH),
            (a(), false, Some(0), A_MARKED_CONTAINER),
            (divided(), true, Some(0), AN_UNDIVIDED),
        ];
        for (mut container, marked, slot, expected) in cases {
            let columns = OwnedColumns::of([Some(&container), Some(&n)])
                .nested(&[None, slot], &[marked, false]);
            assert_eq!(load_columns(&columns).map(drop), invalid("n", expected));
            let mut engine = Engine::new();
            container.is_container = Some(marked).into();
            engine.add(&container, (None, None)).unwrap();
            // A slot that holds no node, as `api` names an identifier its map does not hold.
            let slot = slot.map(|s| if s == 7 { u32::MAX } else { s });
            assert_eq!(
                engine.add(&n, (slot, None)).map(drop),
                invalid("n", expected)
            );
        }
        // The first node in slot order whose container is refused, whatever it is refused for: `n`
        // in `a`, no container, before `m` in `d`, divided.
        let m = added(10.0, 10.0, |n| n.id = "m".to_owned().into());
        let mut d = divided();
        d.id = "d".to_owned().into();
        let columns = OwnedColumns::of([Some(&d), Some(&a()), Some(&n), Some(&m)]).nested(
            &[None, None, Some(1), Some(0)],
            &[false, false, false, false],
        );
        assert_eq!(
            load_columns(&columns).map(drop),
            invalid("n", A_MARKED_CONTAINER)
        );
    }
}
