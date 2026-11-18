//! The reading of an item of graph data: a node, an edge, and an edge's label with every field
//! read, or the refusal that names the first field missing or of another type.

use comb_engine::geometry::{Side, Sides};
use comb_engine::shape::NodeShape;

use super::content;
use super::problem::{
    A_BORDER_SIDE, A_CONTENT, A_FLAG, A_HEIGHT, A_NODE_ID_OR_NONE, A_NUMBER, A_ROW, A_SEGMENT_LIST,
    A_SHAPE, A_SIZE, AN_ELEMENT, AN_ID, AN_ID_OR_NONE,
};
#[cfg(test)]
use super::snapshot::GraphBatch;
use super::{
    Arrow, ContentData, ContentInput, EdgeField, EdgeInput, Field, GraphDataProblem, GraphList,
    LabelInput, NodeInput, Pair, Unflat,
};

/// A node with every field but its content read.
pub(super) struct Node<'a> {
    pub(super) id: &'a str,
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) shape: NodeShape,
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

/// The place of a border node as its data gives it, and the first of its fields `x`, `y`, and
/// `container` that stands beside its `attachedTo`, which refuses it.
#[derive(Clone, Copy)]
pub(super) struct Border {
    pub(super) side: Side,
    pub(super) offset: f64,
    pub(super) beside: Option<&'static str>,
}

/// An edge label with every field read.
pub(super) struct Label {
    pub(super) text_length: Option<usize>,
    pub(super) t: f64,
    pub(super) offset: f64,
    pub(super) background: Option<f64>,
}

/// An edge with every field read.
pub(super) struct Edge<'a> {
    pub(super) id: &'a str,
    pub(super) source: &'a str,
    pub(super) target: &'a str,
    pub(super) label: Option<Label>,
    pub(super) color: f64,
    pub(super) dash: Option<[f64; 2]>,
    pub(super) arrow: Arrow,
    pub(super) sides: Sides,
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
    let beside = [("x", node.x.0), ("y", node.y.0)]
        .into_iter()
        .find(|(_, value)| matches!(value, Some(Some(_))))
        .map(|(field, _)| field)
        .or_else(|| matches!(node.container.0, Some(Some(_))).then_some("container"));
    let mut read = Node {
        id,
        x: position("x", node.x)?,
        y: position("y", node.y)?,
        width: item.read("width", node.width, A_SIZE)?,
        height: item.read("height", node.height, A_HEIGHT)?,
        shape: item.read("shape", node.shape, A_SHAPE)?.into(),
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
            beside,
        });
    }
    let content = content_of(&item, node.content.0.as_ref())?;
    Ok((read, content))
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

/// The edge at `index` with every field read, or the refusal that names its first missing or
/// mistyped field.
pub(super) fn edge_of(index: usize, edge: &EdgeInput) -> Result<Edge<'_>, GraphDataProblem> {
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
        color: item.edge(EdgeField::Color, edge.color)?,
        dash: item
            .edge(EdgeField::Dash, edge.dash)?
            .map(|Pair(pair)| pair),
        arrow: item.edge(EdgeField::Arrow, edge.arrow)?,
        sides: Sides {
            source: item.edge(EdgeField::SourceSide, edge.source_side)?.into(),
            target: item.edge(EdgeField::TargetSide, edge.target_side)?.into(),
        },
    })
}

/// The label `field` of the edge `item`, or none, with every field read, as a load, `addEdge`, and
/// a patch of `updateEdge` read it, or the refusal that names its first missing or mistyped field.
pub(super) fn label_of(
    item: &Item,
    field: Field<Option<LabelInput>>,
) -> Result<Option<Label>, GraphDataProblem> {
    item.edge(EdgeField::Label, field)?
        .map(|input| {
            Ok(Label {
                text_length: input.text_length,
                t: item.edge(EdgeField::LabelT, input.t)?,
                offset: item.edge(EdgeField::LabelOffset, input.offset)?,
                background: input.background,
            })
        })
        .transpose()
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
