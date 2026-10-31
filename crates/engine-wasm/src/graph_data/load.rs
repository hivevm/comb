//! A load and `addNode`: the columns of a load checked and built into the engine's graph, and a
//! node checked as a load checks one and added to it.

use comb_engine::content::Fonts;
use comb_engine::graph::Graph;

use super::checks::{
    checked_node, edges_of, id_length, ids_of, kept_height, nodes_of, within_by_height,
};
use super::item::{Batch, node_of};
#[cfg(test)]
use super::snapshot::{EdgeCells, GraphBatch, OwnedColumns, OwnedEdgeColumns};
use super::{
    Checked, ContentData, EdgeColumns, GraphDataProblem, NodeColumns, NodeInput, check_graph_size,
    lengths, text_spans,
};

/// A load the bridge accepted: the engine's graph, where each text of its content lies in its
/// piece, which `ContentData` keeps, and the code units of the strings of its content.
pub(crate) struct Loaded {
    pub graph: Graph,
    pub spans: Vec<(u32, u32, u32)>,
    pub name_spans: Vec<(u32, u32, u32)>,
    pub units: u64,
}

/// Checks a load and builds the engine's graph from it, its nodes and its edges as columns, each
/// node as high as its content lays out to in `fonts`: whether the columns fit together, the
/// load's size, then every field's type, the nodes' before the edges', the identifiers' lengths,
/// the nodes, their content among them, and the edges. Only then are the identifiers and the
/// texts mapped onto the strings Rust holds, the texts once every node is checked.
pub(crate) fn load_of(
    nodes: &NodeColumns,
    edges: &EdgeColumns,
    fonts: &Fonts,
) -> Result<Loaded, GraphDataProblem> {
    let count = nodes.count()?;
    let edge_count = edges.count()?;
    check_graph_size(count as f64, edge_count as f64)?;
    nodes.first_refused()?;
    edges.first_refused(edge_count)?;
    ids_of(lengths(nodes.id_bounds), edges.id_lengths())?;
    let batch = Batch {
        nodes: nodes.nodes()?,
        edges: edges.edges()?,
    };
    let content = &nodes.content;
    let nodes = nodes_of(&batch, content, fonts)?;
    let spans = text_spans(content.texts, content.text_bounds)?;
    let name_spans = text_spans(content.names, content.name_bounds)?;
    let edges = edges_of(&batch, &nodes.slots)?;
    Ok(Loaded {
        graph: Graph::new(nodes.positions, nodes.sizes, edges)?,
        spans,
        name_spans,
        units: nodes.units,
    })
}

/// Checks the content of one node, as a load checks a node's, named `id`, its strings counted
/// against the budget on from `held`, the code units of content the graph holds besides it, and
/// returns it with its texts mapped and the height it lays out to in `fonts`.
pub(super) fn checked_content(
    id: &str,
    content: &ContentData,
    fonts: &Fonts,
    held: u64,
) -> Result<(Checked, f32), GraphDataProblem> {
    let (checked, height) = Checked::of(id, content, fonts, held)?;
    Ok((checked, kept_height(height)))
}

/// Checks the node `addNode` hands over as a load checks a node, the only one of its batch at
/// index 0, and adds it to `graph`, whose nodes in use stay within `MAX_ITEMS`, as high as its
/// content lays out to in `fonts`, its strings of content counted against the budget on from
/// `held`, the code units of content the graph holds; returns the slot the engine chose and the
/// content it keeps, with its count. A refused node leaves the graph as it was. That the graph
/// holds no node of its identifier is `api`'s to check, against the map only it keeps (ADR-0028).
pub(crate) fn add_node_to(
    graph: &mut Graph,
    node: &NodeInput,
    fonts: &Fonts,
    held: u64,
) -> Result<(u32, Checked), GraphDataProblem> {
    let nodes = f64::from(graph.nodes_in_use()) + 1.0;
    check_graph_size(nodes, 0.0)?;
    let (node, content) = node_of(0, node)?;
    id_length("nodes", 0, "id", node.id)?;
    let ([x, y], width) = checked_node(&node)?;
    let (content, height) = checked_content(node.id, content, fonts, held)?;
    within_by_height(node.id, y, height)?;
    Ok((graph.add_node(x, y, width, height)?, content))
}

/// A load of `batch` as `loadGraph` checks one, its nodes and edges crossed as columns.
#[cfg(test)]
pub(crate) fn graph_of(batch: &GraphBatch) -> Result<Graph, GraphDataProblem> {
    let edges: Vec<EdgeCells> = batch.edges.iter().map(EdgeCells::from).collect();
    load_of(
        &OwnedColumns::of(batch.nodes.iter().map(Some)).view(),
        &OwnedEdgeColumns::of(edges.iter().map(Some)).view(),
        &Fonts::default(),
    )
    .map(|loaded| loaded.graph)
}
