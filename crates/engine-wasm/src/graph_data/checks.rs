//! The rules of a node and of an edge (ADR-0009): a node's place, width, and height within the
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
/// out to, lies past the world's limit (ADR-0009), naming the field `height`, as the world's
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

// The malformed-data tests of graph data verify ADR-0010 (see `graph_data::tests`).
// Verifies: ADR-0010
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
                edge: "e".into(),
                node: "z".into()
            }
        );
    }

    #[test]
    fn a_non_finite_label_names_its_edge() {
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
        data.edges[0].label = Some(LabelInput {
            text_length: Some(1),
            t: f64::NAN.into(),
            offset: 0.0.into(),
            background: None,
        })
        .into();
        let error = graph_of(&data).unwrap_err();
        assert_eq!(error, GraphDataProblem::NonFiniteLabel { edge: "e".into() });
    }

    #[test]
    fn a_node_whose_place_or_far_side_lies_past_the_world_names_it_and_the_field() {
        // Verifies: Q-7, ADR-0030
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
        // Verifies: Q-7, ADR-0030
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
        data.edges[0].label = Some(LabelInput {
            text_length: Some(1),
            t: 0.5.into(),
            offset: (-WORLD_LIMIT * 2.0).into(),
            background: None,
        })
        .into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            beyond(GraphList::Edges, "e", "label.offset")
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
            data.edges[0].label = Some(LabelInput {
                text_length: text,
                t: 0.5.into(),
                offset: 0.0.into(),
                background,
            })
            .into();
            graph_of(&data)
        };
        assert!(label(Some(1), None).is_ok());
        assert!(label(Some(1), Some(0.0)).is_ok());
        assert!(label(Some(1), Some(f64::from(0xff_ffff))).is_ok());
        assert_eq!(
            label(None, None).unwrap_err(),
            GraphDataProblem::InvalidLabelText { edge: "e".into() }
        );
        for background in [-5.0, 1.5, f64::NAN, 1e20, f64::from(0x100_0000)] {
            assert_eq!(
                label(Some(1), Some(background)).unwrap_err(),
                GraphDataProblem::InvalidBackground { edge: "e".into() }
            );
        }
    }

    #[test]
    fn a_text_longer_than_its_limit_names_its_node_or_edge() {
        let two = [("a", 0.0, 0.0), ("b", 300.0, 0.0)];
        let mut data = batch(&two, &[("e", "a", "b")]);
        data.nodes[0].content = titled(&"x".repeat(MAX_TEXT));
        data.edges[0].label = Some(LabelInput {
            text_length: Some(MAX_TEXT),
            t: 0.5.into(),
            offset: 0.0.into(),
            background: None,
        })
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
        if let Field(Some(Some(label))) = &mut data.edges[0].label {
            label.text_length = Some(MAX_TEXT + 1);
        }
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::LabelTextTooLong {
                edge: "e".into(),
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
            let edges = edges.map(|e| [e.id, e.source, e.target].map(utf16_length));
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
        // Verifies: ADR-0010
        let e = || "e".to_owned();
        let text = |value: &str| Field(Some(value.to_owned()));
        // The rules, after every field's type.
        let cases: Vec<(OwnedEdgeColumns, GraphDataProblem)> = vec![
            (
                d_and(|e| e.target = text("z")),
                GraphDataProblem::MissingNode {
                    edge: e(),
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
                d_and(|e| label_in(e).text_length = Some(MAX_TEXT + 1)),
                GraphDataProblem::LabelTextTooLong {
                    edge: e(),
                    limit: TEXT_LIMIT,
                },
            ),
            // A label text missing, of another type, or with a lone surrogate is no text.
            (
                d_and(|e| label_in(e).text_length = None),
                GraphDataProblem::InvalidLabelText { edge: e() },
            ),
            // A background of another type crosses as NaN.
            (
                d_and(|e| label_in(e).background = Some(f64::NAN)),
                GraphDataProblem::InvalidBackground { edge: e() },
            ),
            (
                d_and(|e| label_in(e).background = Some(f64::from(0x100_0000))),
                GraphDataProblem::InvalidBackground { edge: e() },
            ),
            (
                d_and(|e| e.color = 1.5.into()),
                GraphDataProblem::InvalidColor { edge: e() },
            ),
            (
                d_and(|e| e.dash = Some(Pair([0.0, 4.0])).into()),
                GraphDataProblem::InvalidDash { edge: e() },
            ),
            (
                d_and(|e| label_in(e).t = f64::INFINITY.into()),
                GraphDataProblem::NonFiniteLabel { edge: e() },
            ),
            (
                d_and(|e| label_in(e).offset = (WORLD_LIMIT * 2.0).into()),
                beyond(GraphList::Edges, "e", "label.offset"),
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
        assert_eq!((edge.label, edge.style.dash), (None, None));
        assert!(load_edges(&d_and(|_| {})).is_ok());
    }
}
