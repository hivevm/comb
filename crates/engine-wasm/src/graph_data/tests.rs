//! The graph data the tests of the modules of `graph_data` build: content of each kind, batches
//! of nodes and edges, and their columns, and a load of them into an engine.
//!
//! The malformed-data tests of those modules verify ADR-0010: every export that receives graph
//! data returns a typed error that names the offender, and none panics. They are the tests
//! ADR-0010 names as those of `lib.rs`, the crate root of this module.

use comb_engine::content::Fonts;
use comb_engine::geometry::WORLD_LIMIT;
use comb_engine::graph::Graph;

use super::*;
use crate::graph_data::node_columns::Refused;

/// An element of content as the tests write it: its kind, weight, role, and text.
pub(crate) type Cell<'a> = (KindCode, f64, RoleCode, Option<&'a str>);

/// A text of `role` and weight 1.
pub(crate) const fn text(role: RoleCode, text: &str) -> Cell<'_> {
    (KindCode::Text, 1.0, role, Some(text))
}

/// An element of content with an identifier, as the tests write an action: the cell, and its
/// identifier, none for one of another type.
pub(crate) type Named<'a> = (Cell<'a>, Option<&'a str>);

/// Content of `rows`, as the node of `addNode` crosses it.
pub(crate) fn content(rows: &[&[Cell]]) -> ContentInput {
    let rows: Vec<Vec<Named>> = rows
        .iter()
        .map(|row| row.iter().map(|&cell| (cell, None)).collect())
        .collect();
    let rows: Vec<&[Named]> = rows.iter().map(Vec::as_slice).collect();
    named_content(&rows)
}

/// Content of `rows` of elements with identifiers, as the node of `addNode` crosses it.
pub(crate) fn named_content(rows: &[&[Named]]) -> ContentInput {
    let mut content = ContentInput::new();
    for row in rows {
        for &((kind, weight, role, text), id) in *row {
            content.push(kind, weight, role as u8, f64::NAN, text, id);
        }
        content.end_row();
    }
    content
}

/// An action of weight 1 showing `text` and naming `id`.
pub(crate) const fn action<'a>(text: &'a str, id: &'a str) -> Named<'a> {
    (
        (KindCode::Action, 1.0, RoleCode::Title, Some(text)),
        Some(id),
    )
}

/// An icon of weight 1 naming `name`, none for one of another type.
pub(crate) const fn icon(name: Option<&str>) -> Named<'_> {
    ((KindCode::Icon, 1.0, RoleCode::Title, None), name)
}

/// Content of a title row, "Bet", then a row of a badge of weight 1 showing `text`, none for
/// one of another type, on `color`.
pub(crate) fn badged(text: Option<&str>, color: f64) -> ContentInput {
    let mut content = ContentInput::new();
    let title = (RoleCode::Title as u8, Some("Bet"));
    content.push(KindCode::Text, 1.0, title.0, f64::NAN, title.1, None);
    content.end_row();
    content.push(KindCode::Badge, 1.0, 0, color, text, None);
    content.end_row();
    content
}

/// Content of a title row, "Bet", then a row of a progress bar of weight 1 of `segments`, each
/// its fraction and its colour.
pub(crate) fn progressed(segments: &[(f64, f64)]) -> ContentInput {
    let mut content = ContentInput::new();
    content.push(
        KindCode::Text,
        1.0,
        RoleCode::Title as u8,
        f64::NAN,
        Some("Bet"),
        None,
    );
    content.end_row();
    content.push(KindCode::Progress, 1.0, 0, f64::NAN, None, None);
    for &(fraction, color) in segments {
        content.push_segment(fraction, color);
    }
    content.end_row();
    content
}

/// Content of a title row, "Bet", then a row of a metric of weight 1, its trend of the
/// direction code `direction` and the colour `color`, showing `texts`, its caption, value, and
/// trend's text, each none for one of another type.
pub(crate) fn metricked(direction: u8, color: f64, texts: [Option<&str>; 3]) -> ContentInput {
    let mut content = ContentInput::new();
    let title = (RoleCode::Title as u8, Some("Bet"));
    content.push(KindCode::Text, 1.0, title.0, f64::NAN, title.1, None);
    content.end_row();
    content.push_metric(1.0, direction, color, texts);
    content.end_row();
    content
}

/// The content of a node of the time before content: one row of one title, `title`.
pub(crate) fn titled(title: &str) -> Field<ContentInput> {
    content(&[&[text(RoleCode::Title, title)]]).into()
}

pub(crate) fn batch(nodes: &[(&str, f64, f64)], edges: &[(&str, &str, &str)]) -> GraphBatch {
    GraphBatch {
        nodes: nodes
            .iter()
            .map(|&(id, x, y)| NodeInput {
                id: id.to_owned().into(),
                x: x.into(),
                y: y.into(),
                width: 100.0.into(),
                shape: crate::NodeShape::Rectangle.into(),
                content: titled("x"),
            })
            .collect(),
        edges: edges
            .iter()
            .map(|&(id, source, target)| EdgeInput {
                id: id.to_owned().into(),
                source: source.to_owned().into(),
                target: target.to_owned().into(),
                label: None.into(),
                color: f64::from(0x9a_a1ad).into(),
                dash: None.into(),
                arrow: Arrow::End.into(),
                source_side: Dock::Right.into(),
                target_side: Dock::Left.into(),
            })
            .collect(),
    }
}

/// The refusal of a node or label of `list` and `id` lying past the world's limit by `field`.
pub(super) fn beyond(list: GraphList, id: &str, field: &str) -> GraphDataProblem {
    GraphDataProblem::BeyondWorld {
        list,
        id: id.into(),
        field: field.into(),
        limit: WORLD_LIMIT,
    }
}

/// The refusal of the text at `row` and `column` of the node `node` as no text.
pub(super) fn invalid_text(node: &str, row: u32, column: u32) -> GraphDataProblem {
    GraphDataProblem::InvalidContentText {
        node: node.into(),
        row,
        column,
        field: "text".into(),
    }
}

/// The node of `batch` at `(x, y)` with `change` made to it.
pub(super) fn added(x: f64, y: f64, change: impl FnOnce(&mut NodeInput)) -> NodeInput {
    let mut node = batch(&[("n", x, y)], &[]).nodes.remove(0);
    change(&mut node);
    node
}

/// Adds `node` to `graph` as `addNode` does, in the fonts of no font handed over, and returns
/// its slot.
pub(super) fn add(graph: &mut Graph, node: &NodeInput) -> Result<u32, GraphDataProblem> {
    add_node_to(graph, node, &Fonts::default(), 0).map(|(slot, _)| slot)
}

/// The load of `columns` and no edges, as `loadGraph` checks it.
pub(super) fn load_columns(columns: &OwnedColumns) -> Result<Graph, GraphDataProblem> {
    let edges = OwnedEdgeColumns::of([]);
    load_of(&columns.view(), &edges.view(), &Fonts::default()).map(|loaded| loaded.graph)
}

/// The columns of node `a` and of `b`, made by `change` from a well-formed one.
pub(crate) fn a_and(change: impl FnOnce(&mut NodeInput)) -> OwnedColumns {
    let nodes = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]).nodes;
    let mut b = added(300.0, 0.0, |n| n.id = "b".to_owned().into());
    change(&mut b);
    OwnedColumns::of([Some(&nodes[0]), Some(&b)])
}

/// The columns of node `a` and of `b`, `b` of the content `rows`.
pub(crate) fn b_of(rows: &[&[Cell]]) -> OwnedColumns {
    let rows = content(rows);
    a_and(|n| n.content = rows.into())
}

/// A well-formed title.
pub(crate) const TITLE: Cell = text(RoleCode::Title, "t");

/// The refusal of a load of node `a` and of `b`, `b` of the content `rows`, or none.
pub(crate) fn refused(rows: &[&[Cell]]) -> Option<GraphDataProblem> {
    load_columns(&b_of(rows)).err()
}

/// The element at `row` and `column` of node `b`, as a refusal names it.
pub(super) fn at_b(row: u32, column: u32) -> (String, u32, u32) {
    ("b".to_owned(), row, column)
}

/// The columns of nodes of identifiers `ids`, given as the string Rust holds and the
/// boundaries the shell computed, with the field `refused` of a node named.
pub(super) fn cut(ids: &str, bounds: &[u32], refused: Option<(u32, NodeField)>) -> OwnedColumns {
    let refused = refused.map(|(index, field)| Refused {
        index,
        field,
        row: None,
        column: None,
    });
    let count = bounds.len() - 1;
    let nodes = batch(&vec![("", 0.0, 0.0); count], &[]).nodes;
    let mut columns = OwnedColumns::of(nodes.iter().map(Some));
    columns.ids = vec![ids.to_owned()];
    columns.id_bounds = bounds.to_vec();
    columns.refused = refused;
    columns
}

/// The load of nodes `a` and `b` and of `edges`, as `loadGraph` checks it.
pub(super) fn load_edges(edges: &OwnedEdgeColumns) -> Result<Graph, GraphDataProblem> {
    let nodes = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]).nodes;
    load_of(
        &OwnedColumns::of(nodes.iter().map(Some)).view(),
        &edges.view(),
        &Fonts::default(),
    )
    .map(|loaded| loaded.graph)
}

/// Edge `d` from `a` to `b`, labelled, dashed, and with a background, as an edge of a load.
pub(super) fn labelled(id: &str) -> EdgeCells {
    let mut data = batch(&[], &[(id, "a", "b")]);
    let edge = &mut data.edges[0];
    edge.label = Some(LabelInput {
        text_length: Some(1),
        t: 0.5.into(),
        offset: 0.0.into(),
        background: Some(f64::from(0x12_3456)),
    })
    .into();
    edge.dash = Some(Pair([6.0, 4.0])).into();
    EdgeCells::from(&*edge)
}

/// The columns of edge `d` and of `e`, made by `change` from a well-formed one, both from `a`
/// to `b`.
pub(super) fn d_and(change: impl FnOnce(&mut EdgeCells)) -> OwnedEdgeColumns {
    let mut e = labelled("e");
    change(&mut e);
    OwnedEdgeColumns::of([Some(&labelled("d")), Some(&e)])
}

/// The label of `edge`, which `labelled` gave it.
pub(super) fn label_in(edge: &mut EdgeCells) -> &mut LabelInput {
    let Field(Some(Some(label))) = &mut edge.label else {
        unreachable!("a labelled edge")
    };
    label
}

/// A load of `nodes` and `edges` through the engine's `loadGraph`, as the shell hands it
/// over.
pub(crate) fn load_into(
    engine: &mut crate::Engine,
    nodes: &OwnedColumns,
    edges: &OwnedEdgeColumns,
) -> Result<u32, GraphDataProblem> {
    let (n, e) = (nodes, edges);
    let c = &n.content;
    engine.load_graph(
        n.ids.clone(),
        &n.id_bounds,
        &n.x,
        &n.y,
        &n.width,
        &n.shape,
        c.row_bounds.clone(),
        c.element_bounds.clone(),
        c.kinds.clone(),
        c.weights.clone(),
        c.roles.clone(),
        c.directions.clone(),
        c.colors.clone(),
        c.segment_bounds.clone(),
        c.fractions.clone(),
        c.segment_colors.clone(),
        c.texts.clone(),
        c.text_bounds.clone(),
        c.text_valid.clone(),
        c.names.clone(),
        c.name_bounds.clone(),
        c.name_valid.clone(),
        n.refused.map(|r| r.index),
        n.refused.map(|r| r.field.into()),
        n.refused.and_then(|r| r.row),
        n.refused.and_then(|r| r.column),
        e.ids.clone(),
        &e.id_bounds,
        e.sources.clone(),
        &e.source_bounds,
        e.targets.clone(),
        &e.target_bounds,
        &e.has_label,
        e.labels.clone(),
        &e.label_bounds,
        &e.label_texts,
        &e.label_t,
        &e.label_offset,
        &e.has_background,
        &e.background,
        &e.color,
        &e.has_dash,
        &e.dash,
        &e.gap,
        &e.arrow,
        &e.source_side,
        &e.target_side,
        e.refused.map(|(at, _)| at),
        e.refused.map(|(_, field)| field.into()),
    )
}
