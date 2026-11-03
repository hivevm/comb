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

/// A node one crossing hands over, checked: its place, its width, its content with its texts
/// mapped, and the height that content lays out to.
struct Single {
    x: f32,
    y: f32,
    width: f32,
    content: Checked,
    height: f32,
}

/// Checks the node of `addNode` or `heightOf` as a load checks a node, the only one of its batch at
/// index 0: every field's type, its identifier's length, its place and width, its content, its
/// strings counted against the budget on from `held`, laid out in `fonts`, and its far side by that
/// height; the one sequence both crossings refuse by, so that their problems and their order stay
/// one (ADR-0026).
fn single_of(node: &NodeInput, fonts: &Fonts, held: u64) -> Result<Single, GraphDataProblem> {
    let (node, content) = node_of(0, node)?;
    id_length("nodes", 0, "id", node.id)?;
    let ([x, y], width) = checked_node(&node)?;
    let (content, height) = checked_content(node.id, content, fonts, held)?;
    within_by_height(node.id, y, height)?;
    Ok(Single {
        x,
        y,
        width,
        content,
        height,
    })
}

/// Checks the node `addNode` hands over as a load checks a node, the only one of its batch at
/// index 0, and adds it to `graph`, whose nodes in use stay within `MAX_ITEMS`, as high as its
/// content lays out to in `fonts`, its strings of content counted against the budget on from
/// `held`, the code units of content the graph holds; returns the slot the engine chose and the
/// content it keeps, with its count. A refused node leaves the graph as it was. That the graph
/// holds no node of its identifier is `api`'s to check, against the map only it keeps (ADR-0009).
pub(crate) fn add_node_to(
    graph: &mut Graph,
    node: &NodeInput,
    fonts: &Fonts,
    held: u64,
) -> Result<(u32, Checked), GraphDataProblem> {
    let nodes = f64::from(graph.nodes_in_use()) + 1.0;
    check_graph_size(nodes, 0.0)?;
    let Single {
        x,
        y,
        width,
        content,
        height,
    } = single_of(node, fonts, held)?;
    Ok((graph.add_node(x, y, width, height)?, content))
}

/// The height the content of `node` lays out to at its width in `fonts`, checked as `add_node_to`
/// checks a node, its strings counted against the budget alone, and added to nothing: the node
/// `heightOf` hands over, named `""` and at the origin (ADR-0026).
pub(crate) fn height_of(node: &NodeInput, fonts: &Fonts) -> Result<f32, GraphDataProblem> {
    Ok(single_of(node, fonts, 0)?.height)
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

// The malformed-data tests of graph data verify ADR-0010 (see `graph_data::tests`).
// Verifies: ADR-0010
#[cfg(test)]
mod tests {
    use super::super::tests::{
        add, added, badged, batch, content, invalid_text, labelled, load_edges, metricked, titled,
    };
    use super::super::{
        Field, GraphList, ID_LIMIT, KindCode, MAX_ID, MAX_ITEMS, MAX_TEXT, RoleCode, TEXT_LIMIT,
        item::batch_of, problem::A_NUMBER, problem::AN_ARROW, problem::AN_ID,
    };
    use super::*;

    #[test]
    fn a_batch_flattens_into_slot_order() {
        // Each node of one title is as high as the least height of a node.
        let data = batch(&[("a", 1.0, 2.0), ("b", 3.0, 4.0)], &[]);
        let graph = graph_of(&data).unwrap();
        assert_eq!(graph.positions(), [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(graph.sizes(), [100.0, 64.0, 100.0, 64.0]);
    }

    #[test]
    fn edges_resolve_to_the_slots_of_their_nodes() {
        let data = batch(
            &[("a", 0.0, 0.0), ("b", 300.0, 0.0), ("c", 600.0, 0.0)],
            &[("e", "c", "a")],
        );
        let columns = OwnedColumns::of(data.nodes.iter().map(Some));
        let data = batch_of(&data).unwrap();
        let fonts = Fonts::default();
        let nodes = nodes_of(&data, &columns.view().content, &fonts).unwrap();
        let edges = edges_of(&data, &nodes.slots).unwrap();
        assert_eq!((edges[0].source, edges[0].target), (2, 0));
    }

    #[test]
    fn an_added_node_takes_the_next_slot_where_it_was_placed() {
        // Verifies: ADR-0023
        let mut graph = graph_of(&batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[])).unwrap();
        assert_eq!(add(&mut graph, &added(40.0, 50.0, |_| {})), Ok(2));
        assert_eq!(&graph.positions()[4..], [40.0, 50.0]);
        // On an engine that never loaded a graph too.
        let mut empty = Graph::default();
        assert_eq!(add(&mut empty, &added(1.0, 2.0, |_| {})), Ok(0));
        assert_eq!(empty.positions(), [1.0, 2.0]);
    }

    #[test]
    fn an_added_node_is_refused_as_a_load_refuses_it_and_the_graph_kept() {
        // Verifies: ADR-0009, Q-7
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
                added(0.0, 0.0, |n| {
                    n.content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
                }),
                invalid_text("n", 0, 0),
            ),
            (
                added(0.0, 0.0, |n| n.content = titled(&"x".repeat(MAX_TEXT + 1))),
                GraphDataProblem::ContentTextTooLong {
                    node: named(),
                    row: 0,
                    column: 0,
                    field: "text".into(),
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
            assert_eq!(add(&mut graph, &node), Err(problem));
            assert_eq!(graph.positions(), [0.0, 0.0]);
            assert_eq!(graph.nodes_in_use(), 1);
        }
    }

    #[test]
    fn the_height_of_content_is_the_one_an_added_node_of_it_takes_whatever_its_texts_and_width() {
        // Verifies: ADR-0026
        let shapes = [
            |text: &str| titled(text),
            |text: &str| badged(Some(text), 0x22_a5_5b.into()).into(),
            |text: &str| metricked(0, 0x22_a5_5b.into(), [Some(text); 3]).into(),
        ];
        for shape in shapes {
            let asked = |text: &str, width: f64| {
                let node = added(0.0, 0.0, |n| {
                    n.id = String::new().into();
                    n.width = width.into();
                    n.content = shape(text);
                });
                height_of(&node, &Fonts::default()).unwrap()
            };
            let mut graph = Graph::default();
            let node = added(40.0, 50.0, |n| n.content = shape("Go"));
            let slot = add(&mut graph, &node).unwrap() as usize;
            assert_eq!(asked("Go", 100.0), graph.sizes()[slot * 2 + 1]);
            assert_eq!(asked(&"x".repeat(MAX_TEXT), 3.0), asked("Go", 100.0));
        }
    }

    #[test]
    fn the_height_of_content_is_refused_as_an_added_node_of_it_naming_no_node() {
        // Verifies: ADR-0026
        let unnamed = |change: fn(&mut NodeInput)| {
            let node = added(0.0, 0.0, |n| {
                n.id = String::new().into();
                change(n);
            });
            height_of(&node, &Fonts::default())
        };
        assert_eq!(
            unnamed(|n| n.width = (-1.0).into()),
            Err(GraphDataProblem::InvalidSize {
                node: String::new()
            })
        );
        assert_eq!(
            unnamed(|n| {
                n.content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
            }),
            Err(invalid_text("", 0, 0))
        );
        assert_eq!(
            unnamed(|n| n.content = titled(&"x".repeat(MAX_TEXT + 1))),
            Err(GraphDataProblem::ContentTextTooLong {
                node: String::new(),
                row: 0,
                column: 0,
                field: "text".into(),
                limit: TEXT_LIMIT,
            })
        );
    }

    #[test]
    fn a_node_added_to_a_graph_at_the_limit_of_a_load_is_refused() {
        // Verifies: ADR-0009, Q-7
        let count = MAX_ITEMS as usize;
        let positions = (0..count).flat_map(|i| [i as f32, 0.0]).collect();
        let mut graph = Graph::new(positions, vec![1.0; count * 2], Vec::new()).unwrap();
        assert_eq!(
            add(&mut graph, &added(0.0, 0.0, |_| {})),
            Err(GraphDataProblem::TooMany {
                list: "nodes".into(),
                limit: MAX_ITEMS,
            })
        );
        assert_eq!(graph.nodes_in_use(), MAX_ITEMS);
        assert_eq!(graph.positions().len(), count * 2);
    }

    #[test]
    fn a_coordinate_not_finite_in_an_early_node_is_named_before_a_title_in_a_later_one() {
        // Verifies: ADR-0010
        // The first pass names only the values `Field<T>` reads; a title is checked at its rule,
        // in the second pass, after the nodes before it.
        let ids: Vec<String> = (0..6).map(|i| format!("n{i}")).collect();
        let nodes: Vec<_> = ids.iter().map(|id| (id.as_str(), 0.0, 0.0)).collect();
        let mut data = batch(&nodes, &[]);
        data.nodes[0].x = f64::INFINITY.into();
        // The title of node 5 holds a lone surrogate, which the snapshot hands over as no text.
        data.nodes[5].content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::NonFiniteCoordinate { node: "n0".into() }
        );
        data.nodes[0].x = 0.0.into();
        assert_eq!(graph_of(&data).unwrap_err(), invalid_text("n5", 0, 0));
    }

    #[test]
    fn the_first_value_refused_by_its_type_is_named_across_nodes_and_edges() {
        // Verifies: ADR-0010
        // A node's refused field is named before any edge's, and an earlier edge's arrowhead
        // that names nothing before a later edge's field the shell named.
        let mut nodes = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]).nodes;
        nodes[1].y = Field(None);
        let nodes = OwnedColumns::of(nodes.iter().map(Some));
        let mut d = labelled("d");
        d.arrow = Field(Some("start".to_owned()));
        let mut e = labelled("e");
        e.id = Field(None);
        let edges = OwnedEdgeColumns::of([Some(&d), Some(&e)]);
        let refused = |list, index, id: Option<&str>, field: &str, expected: &str| {
            GraphDataProblem::InvalidField {
                list,
                index,
                id: id.map(str::to_owned),
                field: field.into(),
                expected: expected.into(),
            }
        };
        assert_eq!(
            load_of(&nodes.view(), &edges.view(), &Fonts::default()).err(),
            Some(refused(GraphList::Nodes, 1, Some("b"), "y", A_NUMBER))
        );
        assert_eq!(
            load_edges(&edges).err(),
            Some(refused(GraphList::Edges, 0, Some("d"), "arrow", AN_ARROW))
        );
        d.arrow = Field(Some("none".to_owned()));
        let edges = OwnedEdgeColumns::of([Some(&d), Some(&e)]);
        assert_eq!(
            load_edges(&edges).err(),
            Some(refused(GraphList::Edges, 1, None, "id", AN_ID))
        );
    }
}
