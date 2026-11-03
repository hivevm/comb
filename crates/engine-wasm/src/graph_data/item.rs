//! The reading of an item of graph data: a node, an edge, and an edge's label with every field
//! read, or the refusal that names the first field missing or of another type.

use comb_engine::geometry::Sides;

use super::content;
use super::problem::{A_CONTENT, A_NUMBER, A_ROW, A_SEGMENT_LIST, A_SIZE, AN_ELEMENT, AN_ID};
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
                  `MAX_ITEMS` first (ADR-0009)"
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
                  `MAX_ITEMS` first (ADR-0009)"
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
    let read = Node {
        id,
        x: item.read("x", node.x, A_NUMBER)?,
        y: item.read("y", node.y, A_NUMBER)?,
        width: item.read("width", node.width, A_SIZE)?,
    };
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
