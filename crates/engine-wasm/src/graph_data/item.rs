//! The reading of an item of graph data: a node, an edge, and an edge's label with every field
//! read, or the refusal that names the first field missing or of another type.

use comb_engine::geometry::{Dock, Side, Sides};
use comb_engine::shape::NodeShape;

use super::checks::Given;
use super::content;
use super::problem::{
    A_BORDER_SIDE, A_CONTENT, A_FLAG, A_HEIGHT, A_NODE_ID_OR_NONE, A_NUMBER, A_ROW, A_SEGMENT_LIST,
    A_SHAPE, A_SIZE, AN_ELEMENT, AN_ID, AN_ID_OR_NONE, AN_OUTLINE,
};
#[cfg(test)]
use super::snapshot::GraphBatch;
use super::{
    Arrow, ContentData, ContentInput, EdgeField, EdgeInput, Field, GraphDataProblem, GraphList,
    LabelInput, MAX_LABELS, NodeInput, Outline, Pair, Unflat,
};

/// A node with every field but its content read.
pub(super) struct Node<'a> {
    pub(super) id: &'a str,
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) shape: NodeShape,
    /// How its outline is drawn, its dash pattern checked as it is read
    /// (REN-node-shapes-cover-uml, *Outline*).
    pub(super) outline: comb_engine::shape::Outline,
    /// The height its data gives, or none (REN-node-shapes-cover-uml, *Height*), not yet checked
    /// as the engine keeps it.
    pub(super) height: Option<f64>,
    /// Whether the user may resize it by its resize handles (API-edits-report-nested-changes).
    pub(super) resizable: bool,
    /// Whether it is a container: read from the node of `addNode`; a load keeps its marks in its
    /// columns of nesting (API-bridge-columns-carry-nesting).
    pub(super) is_container: bool,
    /// Its place where it is a border node (ARCH-border-nodes-ride-sides).
    pub(super) border: Option<Border>,
}

/// The place of a border node as its data gives it.
#[derive(Clone, Copy)]
pub(super) struct Border {
    pub(super) side: Side,
    pub(super) offset: f64,
}

/// An edge label with every field read, its path parameter and offset filled in where it named
/// none (API-edges-dock-nodes-or-edges, *Edge labels*).
pub(super) struct Label<'a> {
    pub(super) id: &'a str,
    pub(super) text_length: Option<usize>,
    pub(super) t: f64,
    pub(super) offset: f64,
    pub(super) background: Option<f64>,
}

/// Where an end of an edge lies, as its data names it: on a node, by its identifier and what the
/// end docks on, or on an edge, by its identifier and a path parameter from 0 to 1
/// (API-edges-dock-nodes-or-edges, *Ends*).
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum EndRead<'a> {
    Node { id: &'a str, dock: Dock },
    Edge { id: &'a str, t: f64 },
}

impl<'a> EndRead<'a> {
    /// The identifier the end names, of a node or of an edge.
    pub(super) const fn id(self) -> &'a str {
        match self {
            Self::Node { id, .. } | Self::Edge { id, .. } => id,
        }
    }

    /// What the end docks on: its side or the outline on a node, and on an edge the default
    /// `default`, which the engine does not read there.
    pub(super) const fn dock(self, default: Dock) -> Dock {
        match self {
            Self::Node { dock, .. } => dock,
            Self::Edge { .. } => default,
        }
    }
}

/// An edge with every field read.
pub(super) struct Edge<'a> {
    pub(super) id: &'a str,
    pub(super) source: EndRead<'a>,
    pub(super) target: EndRead<'a>,
    pub(super) labels: Vec<Label<'a>>,
    pub(super) color: f64,
    pub(super) dash: Option<[f64; 2]>,
    pub(super) arrow: Arrow,
    pub(super) lightning: bool,
}

impl Edge<'_> {
    /// Where it leaves its source and enters its target, the default sides at an end on an edge.
    pub(super) fn sides(&self) -> Sides {
        let default = Sides::default();
        Sides {
            source: self.source.dock(default.source),
            target: self.target.dock(default.target),
        }
    }
}

/// A batch with every field of every node and edge read.
pub(super) struct Batch<'a> {
    pub(super) nodes: Vec<Node<'a>>,
    pub(super) edges: Vec<Edge<'a>>,
}

/// The item at `index` of `list` while its fields are read, `id` once its identifier is.
pub(super) struct Item<'a> {
    pub(super) list: GraphList,
    pub(super) index: usize,
    pub(super) id: Option<&'a str>,
}

impl<'a> Item<'a> {
    pub(super) fn new(list: GraphList, index: usize) -> Self {
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
                  `MAX_ITEMS` first (ARCH-one-workspace-per-example)"
    )]
    pub(super) fn read<T>(
        &self,
        field: &str,
        value: Field<T>,
        expected: &str,
    ) -> Result<T, GraphDataProblem> {
        value.0.ok_or_else(|| GraphDataProblem::InvalidField {
            list: self.list,
            index: self.index as u32,
            id: self.id.map(str::to_owned),
            field: field.to_owned(),
            expected: expected.to_owned(),
        })
    }

    /// The value of `field` of an edge, or the refusal that names the edge and the field.
    pub(super) fn edge<T>(&self, field: EdgeField, value: Field<T>) -> Result<T, GraphDataProblem> {
        let (name, expected) = field.named();
        self.read(name, value, expected)
    }

    /// `edge` of a field of the label at `label` of the edge's list, named after the label's
    /// place, as `labels[1].t` (API-edges-dock-nodes-or-edges).
    pub(super) fn label_field<T>(
        &self,
        field: EdgeField,
        label: usize,
        value: Field<T>,
    ) -> Result<T, GraphDataProblem> {
        let (name, expected) = field.named();
        self.read(&format!("labels[{label}]{name}"), value, expected)
    }

    /// The refusal of a shape of content at `row` and, below a row, `column` of the item, which
    /// should have been `unread`.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "an index below the count of its list, which the bridge checked against \
                  `MAX_ITEMS` first (ARCH-one-workspace-per-example)"
    )]
    pub(super) fn shape(&self, (row, column): content::Shape, unread: Unflat) -> GraphDataProblem {
        let expected = match unread {
            Unflat::Row => A_ROW,
            Unflat::Element | Unflat::Segment => AN_ELEMENT,
            Unflat::Segments => A_SEGMENT_LIST,
        };
        GraphDataProblem::InvalidContentShape {
            index: self.index as u32,
            id: self.id.map(str::to_owned),
            row,
            column,
            expected: expected.to_owned(),
        }
    }

    /// The identifier `field` of the item, read in place.
    pub(super) fn id(
        &self,
        field: &str,
        value: &'a Field<String>,
    ) -> Result<&'a str, GraphDataProblem> {
        self.read(field, Field(value.0.as_deref()), AN_ID)
    }
}

/// The node at `index` with every field read, and its content, or the refusal that names its
/// first missing or mistyped field or the first shape of its content that cannot be read.
pub(super) fn node_of(
    index: usize,
    node: &NodeInput,
) -> Result<(Node<'_>, &ContentData), GraphDataProblem> {
    let mut item = Item::new(GraphList::Nodes, index);
    let id = item.id("id", &node.id)?;
    item.id = Some(id);
    // A border node has no position of its own; any other node has one.
    let bordered = matches!(node.attached_to.0, Some(Some(_)));
    let position = |field: &str, value: Field<Option<f64>>| {
        let value = item.read(field, value, A_NUMBER)?;
        match value {
            None if !bordered => item.read(field, Field::<f64>(None), A_NUMBER),
            _ => Ok(value.unwrap_or(0.0)),
        }
    };
    let mut read = Node {
        id,
        x: position("x", node.x)?,
        y: position("y", node.y)?,
        width: item.read("width", node.width, A_SIZE)?,
        height: item.read("height", node.height, A_HEIGHT)?,
        shape: item.read("shape", node.shape, A_SHAPE)?.into(),
        outline: super::checks::outline_of(
            id,
            index,
            item.read("outline", node.outline, AN_OUTLINE)?
                .unwrap_or(Outline::Solid),
        )?,
        // Its container's identifier only has to be a string or none: `api` resolves it against the
        // map only it keeps (ARCH-one-workspace-per-example).
        is_container: {
            item.read("container", node.container.clone(), AN_ID_OR_NONE)?;
            item.read("isContainer", node.is_container, A_FLAG)?
                .unwrap_or(false)
        },
        resizable: item
            .read("resizable", node.resizable, A_FLAG)?
            .unwrap_or(false),
        border: None,
    };
    if item
        .read("attachedTo", node.attached_to.clone(), A_NODE_ID_OR_NONE)?
        .is_some()
    {
        let side = item.read("side", node.side, A_BORDER_SIDE)?;
        let side = item.read("side", Field(side), A_BORDER_SIDE)?;
        let offset = item.read("offset", node.offset, A_NUMBER)?;
        let offset = item.read("offset", Field(offset), A_NUMBER)?;
        read.border = Some(Border {
            side: side.into(),
            offset,
        });
    }
    let content = content_of(&item, node.content.0.as_ref())?;
    Ok((read, content))
}

/// What `node` gives of `x`, `y`, `container`, `side`, and `offset`, each given where it holds a
/// value, of any type, as the snapshot of a load says it in its column `given`; the rest of what
/// the rule of its attachment reads its reading says (ARCH-border-nodes-ride-sides).
pub(super) const fn given_of(node: &NodeInput) -> Given {
    const fn gives<T>(field: &Field<Option<T>>) -> bool {
        !matches!(field.0, Some(None))
    }
    Given {
        x: gives(&node.x),
        y: gives(&node.y),
        container: gives(&node.container),
        is_container: false,
        regions: false,
        resizable: false,
        side: gives(&node.side),
        offset: gives(&node.offset),
    }
}

/// The content of the item `item`, or the refusal of content that is no list or of its first
/// shape that cannot be read.
pub(super) fn content_of<'c>(
    item: &Item,
    content: Option<&'c ContentInput>,
) -> Result<&'c ContentData, GraphDataProblem> {
    let content = item.read("content", Field(content), A_CONTENT)?;
    match content.shape {
        Some(shape) => Err(item.shape(shape, content.unread)),
        None => Ok(&content.data),
    }
}

/// The fields that name one end of an edge: the node's identifier, the edge's identifier, the path
/// parameter on that edge, and the side, each as the host application handed it over.
struct EndFields<'a> {
    node: &'a Field<Option<String>>,
    edge: &'a Field<Option<String>>,
    t: Field<Option<f64>>,
}

/// The fields of an end and of its side, refused by their fields: `node`, `edge`, `t`, then
/// `side`.
#[derive(Clone, Copy)]
struct EndNames {
    node: EdgeField,
    edge: EdgeField,
    t: EdgeField,
    side: EdgeField,
}

const SOURCE: EndNames = EndNames {
    node: EdgeField::Source,
    edge: EdgeField::SourceEdge,
    t: EdgeField::SourceT,
    side: EdgeField::SourceSide,
};
const TARGET: EndNames = EndNames {
    node: EdgeField::Target,
    edge: EdgeField::TargetEdge,
    t: EdgeField::TargetT,
    side: EdgeField::TargetSide,
};

/// Whether `t` is a path parameter an end on an edge lies at: a number from 0 to 1.
pub(super) fn on_the_path(t: f64) -> bool {
    (0.0..=1.0).contains(&t)
}

/// One end of the edge `item` read off `fields`, its side still to read, or the refusal of its
/// first field (API-edges-dock-nodes-or-edges, *Ends*): an end that names an edge by `edge`, given
/// at all, beside a node given at all refuses `edge`, as does an identifier of an edge of another
/// type, and its path parameter missing, of another type, or outside 0 to 1 refuses `t`; an end
/// that names no edge refuses `node` where it names no node by a string. An end on a node docks on
/// `Dock::Outline` until its side is read.
fn end_of<'a>(
    item: &Item,
    names: EndNames,
    fields: EndFields<'a>,
) -> Result<EndRead<'a>, GraphDataProblem> {
    let given = |field: &Field<Option<String>>| !matches!(field.0, Some(None));
    if !given(fields.edge) {
        let id = item.edge(names.node, fields.node.as_ref())?.as_deref();
        let id = item.edge(names.node, Field(id))?;
        return Ok(EndRead::Node {
            id,
            dock: Dock::Outline,
        });
    }
    let edge = fields.edge.0.as_ref().and_then(Option::as_deref);
    let id = item.edge(names.edge, Field(edge.filter(|_| !given(fields.node))))?;
    let t = fields.t.0.flatten().filter(|&t| on_the_path(t));
    Ok(EndRead::Edge {
        id,
        t: item.edge(names.t, Field(t))?,
    })
}

/// The end `end` with the side `side` read: what it docks on where it lies on a node, which names
/// a side or the outline, and none where it lies on an edge (API-edges-dock-nodes-or-edges).
fn sided<'a>(
    item: &Item,
    names: EndNames,
    end: EndRead<'a>,
    side: Field<Option<super::Dock>>,
) -> Result<EndRead<'a>, GraphDataProblem> {
    let side = item.edge(names.side, side)?;
    match (end, side) {
        (EndRead::Node { id, .. }, Some(dock)) => Ok(EndRead::Node {
            id,
            dock: dock.into(),
        }),
        (EndRead::Edge { .. }, None) => Ok(end),
        _ => item.edge(names.side, Field(None)),
    }
}

/// The edge at `index` with every field read, or the refusal that names its first missing or
/// mistyped field.
pub(super) fn edge_of(index: usize, edge: &EdgeInput) -> Result<Edge<'_>, GraphDataProblem> {
    let mut item = Item::new(GraphList::Edges, index);
    let id = item.id("id", &edge.id)?;
    item.id = Some(id);
    let source = EndFields {
        node: &edge.source,
        edge: &edge.source_edge,
        t: edge.source_t,
    };
    let source = end_of(&item, SOURCE, source)?;
    let target = EndFields {
        node: &edge.target,
        edge: &edge.target_edge,
        t: edge.target_t,
    };
    let target = end_of(&item, TARGET, target)?;
    if edge.label {
        item.edge(EdgeField::Label, Field::<()>(None))?;
    }
    let labels = labels_of(&item, &edge.labels)?;
    let color = item.edge(EdgeField::Color, edge.color)?;
    let dash = item
        .edge(EdgeField::Dash, edge.dash)?
        .map(|Pair(pair)| pair);
    let arrow = item.edge(EdgeField::Arrow, edge.arrow)?;
    let lightning = item
        .edge(EdgeField::Lightning, edge.lightning)?
        .unwrap_or(false);
    Ok(Edge {
        id,
        source: sided(&item, SOURCE, source, edge.source_side)?,
        target: sided(&item, TARGET, target, edge.target_side)?,
        labels,
        color,
        dash,
        arrow,
        lightning,
    })
}

/// The path parameter and label offset a label takes where it names none: today's one label's
/// (API-edges-dock-nodes-or-edges, *Edge labels*).
pub(super) const DEFAULT_T: f64 = 0.5;
pub(super) const DEFAULT_OFFSET: f64 = 0.0;

/// The labels `field` of the edge `item`, none where it is left out, each with every field read,
/// as `addEdge` and a patch of `updateEdge` read them, or the refusal that names the first missing
/// or mistyped field: the list, then each label in its order, as an object, its identifier, its
/// `t`, and its `offset`.
pub(super) fn labels_of<'a>(
    item: &Item,
    field: &'a Field<Option<Vec<Field<LabelInput>>>>,
) -> Result<Vec<Label<'a>>, GraphDataProblem> {
    let Some(labels) = item.edge(EdgeField::Labels, field.as_ref())?.as_ref() else {
        return Ok(Vec::new());
    };
    // One past the limit is read, and refused by its rule; the rest is not, as from the snapshot.
    let mut read = Vec::with_capacity(labels.len().min(MAX_LABELS + 1));
    for (i, label) in labels.iter().take(MAX_LABELS + 1).enumerate() {
        let input = item.label_field(EdgeField::LabelItem, i, label.as_ref())?;
        let id = item.label_field(EdgeField::LabelId, i, input.id.as_ref())?;
        let t = item.label_field(EdgeField::LabelT, i, input.t)?;
        let offset = item.label_field(EdgeField::LabelOffset, i, input.offset)?;
        read.push(Label {
            id: id.as_str(),
            text_length: input.text_length,
            t: t.unwrap_or(DEFAULT_T),
            offset: offset.unwrap_or(DEFAULT_OFFSET),
            background: input.background,
        });
    }
    Ok(read)
}

/// Reads every field of every edge of the tests' batch, or names the first that is missing or
/// holds a value of another type, as `addEdge` reads an edge.
#[cfg(test)]
pub(super) fn edges_read(edges: &[EdgeInput]) -> Result<Vec<Edge<'_>>, GraphDataProblem> {
    let edges = edges.iter().enumerate().map(|(i, e)| edge_of(i, e));
    edges.collect()
}

/// Reads every field of every node and edge of a batch, or names the first that is missing or
/// holds a value of another type, as `addNode` reads a node.
#[cfg(test)]
pub(super) fn batch_of(batch: &GraphBatch) -> Result<Batch<'_>, GraphDataProblem> {
    let nodes = batch
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| node_of(i, n).map(|(node, _)| node));
    Ok(Batch {
        nodes: nodes.collect::<Result<_, _>>()?,
        edges: edges_read(&batch.edges)?,
    })
}
