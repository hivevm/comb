//! The reading and checking of graph data, the one place that validates it (ADR-0028, ADR-0034).
//! The exports in the crate root hand graph data here and pass on what it returns: a load's
//! columns become the engine's graph, the node of `addNode` and the edge of `addEdge` join it, and
//! a patch of `updateNode` or `updateEdge` becomes what the graph and the store take.
//!
//! The reading and checking is split by concept: `limits` holds the limits of a load, `field` the
//! lenient reading of a field, `input` the types the host application hands over, `strings` the
//! decoding of the string columns, `node_columns` and `edge_columns` the columns of a load's nodes
//! and edges, `problem` the refusals, `item` the reading of a node or an edge, `checks` the rules
//! of each, `load` a load and `addNode`, `edit` `addEdge` and the patches, and `content` the node
//! content; `snapshot` builds, for the tests, the columns the shell builds.

mod checks;
mod content;
mod edge_columns;
mod edit;
mod field;
mod input;
mod item;
mod limits;
mod load;
mod node_columns;
mod problem;
#[cfg(test)]
mod snapshot;
mod strings;

use checks::rgb;
pub(crate) use checks::{kept_height, within_by_height};
use content::Cursor;
pub(crate) use content::{
    COLUMN_LIMIT, Checked, ROW_LIMIT, SEGMENT_LIMIT, check_content_budget, direction_of, rgb_of,
    role_of,
};
pub use content::{
    ContentColumns, ContentData, ContentInput, DirectionCode, ElementHit, ElementKind, KindCode,
    MAX_COLUMNS, MAX_CONTENT_UNITS, MAX_ROWS, MAX_SEGMENTS, RoleCode, Unflat,
};
pub(crate) use edge_columns::edge_refused_of;
pub use edge_columns::{ArrowCode, EdgeColumns, EdgeField, SideCode};
pub use edit::{EdgePatch, EdgeRefusal, NodePatch};
pub(crate) use edit::{add_edge_to, patch_of, update_edge_in};
pub use field::Field;
#[cfg(test)]
pub(crate) use field::reading;
pub use input::{
    Arrow, ContentElement, EdgeInput, LabelInput, NodeContent, NodeInput, Pair, Segment, Side,
    TextRole, Trend, TrendDirection,
};
pub(crate) use limits::{ID_LIMIT, TEXT_LIMIT, check_graph_size, check_id_budget};
pub use limits::{MAX_ID, MAX_ID_UNITS, MAX_ITEMS, MAX_TEXT};
#[cfg(test)]
pub(crate) use load::graph_of;
pub(crate) use load::{add_node_to, load_of};
pub(crate) use node_columns::refused_of;
pub use node_columns::{NodeColumns, NodeField};
pub use problem::{GraphDataProblem, GraphList};
pub(crate) use problem::{malformed, slot, unshaped};
#[cfg(test)]
pub(crate) use snapshot::{EdgeCells, GraphBatch, OwnedColumns, OwnedEdgeColumns};
use strings::{bounds_fit, lengths, string_at, value_at, values};
pub(crate) use strings::{numbered, text_spans, utf16_length};

/// The value of `values` whose code, its discriminant, is `code`, or none for a code none has.
fn coded<T: Copy + Into<u32>>(values: &[T], code: u32) -> Option<T> {
    values.iter().copied().find(|&value| value.into() == code)
}

/// The first value a load's first pass refuses, as `loadGraph` takes it: the index of its item
/// and the code of its field, both or neither, and a code none of `fields` has refused as
/// `unfit`.
fn refused_by<F: Copy + Into<u32>>(
    at: Option<u32>,
    field: Option<u32>,
    fields: &[F],
    unfit: fn() -> GraphDataProblem,
) -> Result<Option<(u32, F)>, GraphDataProblem> {
    match (at, field.map(|code| coded(fields, code))) {
        (Some(at), Some(Some(field))) => Ok(Some((at, field))),
        (None, None) => Ok(None),
        _ => Err(unfit()),
    }
}

// The property test reads graph data as `loadGraph` and `updateNode` do; its file keeps the path
// the record names it by.
#[cfg(test)]
#[path = "properties.rs"]
mod properties;

// The malformed-data tests below verify ADR-0034: every export that receives graph data returns a
// typed error that names the offender, and none panics. They are the tests ADR-0034 names as
// those of `lib.rs`, the crate root of this module.
// Verifies: ADR-0034
#[cfg(test)]
pub(crate) mod tests {
    use super::content::check_content_budget;
    use super::*;
    use super::{
        checks::*, edge_columns::*, edit::*, field::*, input::*, item::*, node_columns::*,
        problem::*, snapshot::*, strings::*,
    };
    use comb_engine::content::Fonts;
    use comb_engine::geometry::WORLD_LIMIT;
    use comb_engine::graph::{self, AddEdgeError, Graph, SlotError, TooManySlots};
    // The exports themselves, as on the crate root, so that their tests go through them.
    use crate::{check_graph_size, check_id_budget};

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
                    source_side: Side::Right.into(),
                    target_side: Side::Left.into(),
                })
                .collect(),
        }
    }

    #[test]
    fn what_an_identifier_expects_names_its_limit() {
        assert!(AN_ID.contains(&format!(" {MAX_ID} ")));
    }

    #[test]
    fn a_batch_flattens_into_slot_order() {
        // Each node of one title is as high as the least height of a node.
        let data = batch(&[("a", 1.0, 2.0), ("b", 3.0, 4.0)], &[]);
        let graph = graph_of(&data).unwrap();
        assert_eq!(graph.positions(), [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(graph.sizes(), [100.0, 64.0, 100.0, 64.0]);
    }

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

    /// The refusal of a node or label of `list` and `id` lying past the world's limit by `field`.
    fn beyond(list: GraphList, id: &str, field: &str) -> GraphDataProblem {
        GraphDataProblem::BeyondWorld {
            list,
            id: id.into(),
            field: field.into(),
            limit: WORLD_LIMIT,
        }
    }

    #[test]
    fn a_node_whose_place_or_far_side_lies_past_the_world_names_it_and_the_field() {
        // Verifies: Q-7, ADR-0028
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
    fn a_load_whose_strings_of_content_pass_the_budget_is_refused_at_the_node_that_passes_it() {
        // Verifies: ADR-0034, Q-7
        // The budget lowered to 5 code units: node `a`'s two texts of 2 and 3 hold it, and `b`'s
        // text of 1 passes it.
        content::TEST_BUDGET.set(Some(5));
        let two =
            |a: &str, b: &str| content(&[&[text(RoleCode::Title, a), text(RoleCode::Body, b)]]);
        let load = |b_text: &str| {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[0].content = two("aa", "aaa").into();
            data.nodes[1].content = titled(b_text);
            graph_of(&data)
        };
        let held = load("");
        let passed = load("b");
        content::TEST_BUDGET.set(None);
        assert!(held.is_ok(), "{:?}", held.err());
        assert_eq!(
            passed.err(),
            Some(GraphDataProblem::ContentBudgetExceeded {
                node: "b".into(),
                limit: MAX_CONTENT_UNITS
            })
        );
    }

    /// An engine of a load at the budget lowered to 6 code units: node `a` of a title "abc", and
    /// `b` of an action showing "de" and naming "f", 3 + 2 + 1.
    fn at_the_budget() -> crate::Engine {
        content::TEST_BUDGET.set(Some(6));
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        data.nodes[0].content = titled("abc");
        data.nodes[1].content = named_content(&[&[action("de", "f")]]).into();
        let mut engine = crate::Engine::new();
        let nodes = OwnedColumns::of(data.nodes.iter().map(Some));
        let none = OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        assert_eq!(engine.content.units(), 6);
        engine
    }

    /// The node `id` at (0, 200), 100 wide, of `content`.
    fn node_of(id: &str, content: ContentInput) -> NodeInput {
        NodeInput {
            id: id.to_owned().into(),
            x: 0.0.into(),
            y: 200.0.into(),
            width: 100.0.into(),
            content: content.into(),
        }
    }

    /// A patch of a node's content to `content`.
    fn patch_to(content: ContentInput) -> NodePatch {
        NodePatch(vec![("content".to_owned(), content.into())])
    }

    /// The refusal of a string of content of the node `node` past the budget.
    fn past_budget(node: &str) -> GraphDataProblem {
        GraphDataProblem::ContentBudgetExceeded {
            node: node.into(),
            limit: MAX_CONTENT_UNITS,
        }
    }

    #[test]
    fn a_node_added_to_a_graph_at_the_budget_is_refused_naming_it_and_the_graph_kept() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        let mut engine = at_the_budget();
        let one = node_of("c", content(&[&[text(RoleCode::Title, "x")]]));
        let added = engine.add(&one);
        // A node whose content holds no string adds no code unit and is taken.
        let none = engine.add(&node_of("d", content(&[])));
        content::TEST_BUDGET.set(None);
        assert_eq!(added, Err(past_budget("c")));
        assert_eq!(none, Ok(2));
        assert_eq!(engine.graph.nodes_in_use(), 3);
        assert_eq!(engine.content.units(), 6);
        assert_eq!(engine.content.edited_slots(), [2]);
    }

    #[test]
    fn an_update_past_the_budget_is_refused_and_one_of_as_many_code_units_or_fewer_taken() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        let mut engine = at_the_budget();
        let sizes = engine.graph.sizes().to_vec();
        // `b`'s action of 3 code units grows to 4: refused, and nothing changes.
        let grown = engine.update(1, "b", &patch_to(named_content(&[&[action("dex", "f")]])));
        let kept = (
            engine.graph.sizes().to_vec(),
            engine.content.edited_slots().len(),
            engine.content.units(),
        );
        // Two rows of as many code units, and then of fewer: taken.
        let rows = content(&[&[text(RoleCode::Title, "d")], &[text(RoleCode::Body, "ef")]]);
        let as_many = engine.update(1, "b", &patch_to(rows));
        let after_as_many = engine.content.units();
        let fewer = engine.update(1, "b", &patch_to(content(&[&[text(RoleCode::Title, "d")]])));
        // A patch of `a`, a loaded node, counts on from what the others hold: 4 of 3 + 1 = 6 fits.
        let a = engine.update(
            0,
            "a",
            &patch_to(content(&[&[text(RoleCode::Title, "abcd")]])),
        );
        let past = engine.update(
            0,
            "a",
            &patch_to(content(&[&[text(RoleCode::Title, "abcdef")]])),
        );
        content::TEST_BUDGET.set(None);
        assert_eq!(grown, Err(crate::CallRefusal::Data(past_budget("b"))));
        assert_eq!(kept, (sizes, 0, 6));
        assert_eq!(as_many, Ok(()));
        assert_eq!(after_as_many, 6);
        assert_eq!(fewer, Ok(()));
        assert_eq!(a, Ok(()));
        assert_eq!(past, Err(crate::CallRefusal::Data(past_budget("a"))));
        assert_eq!(engine.content.units(), 5);
        let abcd = ContentElement::Text {
            role: TextRole::Title,
            text: "abcd".into(),
            weight: Some(1.0),
        };
        assert_eq!(engine.content.content_of(0).0, [[abcd]]);
    }

    #[test]
    fn a_deleted_nodes_code_units_are_free_for_a_node_added_after_it() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        let mut engine = at_the_budget();
        // A removal that names a slot holding no node is refused and leaves the count.
        let no_node = Err(crate::SlotError::NoNode { slot: 99 });
        assert_eq!(engine.remove_nodes(&[0, 99]), no_node);
        assert_eq!(engine.content.units(), 6);
        // `a` named twice leaves the count once.
        assert_eq!(engine.remove_nodes(&[0, 0]), Ok(Vec::new()));
        let units = engine.content.units();
        let three = engine.add(&node_of("c", content(&[&[text(RoleCode::Title, "xyz")]])));
        let one = engine.add(&node_of("d", content(&[&[text(RoleCode::Title, "x")]])));
        // An added node deleted frees its code units too.
        assert_eq!(engine.remove_nodes(&[0]), Ok(Vec::new()));
        let again = engine.add(&node_of("e", content(&[&[text(RoleCode::Title, "x")]])));
        content::TEST_BUDGET.set(None);
        assert_eq!(units, 3);
        assert_eq!(three, Ok(0));
        assert_eq!(one, Err(past_budget("d")));
        assert_eq!(again, Ok(0));
        assert_eq!(engine.content.units(), 4);
    }

    #[test]
    fn a_label_offset_past_the_world_names_its_edge_and_the_field() {
        // Verifies: Q-7, ADR-0028
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
    fn a_title_that_is_not_text_names_its_node() {
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        data.nodes[1].content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
        assert_eq!(graph_of(&data).unwrap_err(), invalid_text("b", 0, 0));
    }

    #[test]
    fn an_action_whose_identifier_is_no_string_or_too_long_names_its_node() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        // A title and an action beside it, whose identifier is checked as a string of content is,
        // against the limit of a text, after the action's text; through a load and through
        // `addNode` alike.
        let long = "d".repeat(MAX_TEXT + 1);
        let held = "d".repeat(MAX_TEXT);
        let with = |id: Option<&str>| {
            let action = (
                (KindCode::Action, 1.0, RoleCode::Title, Some("Details")),
                id,
            );
            named_content(&[&[(text(RoleCode::Title, "Bet"), None), action]])
        };
        let field = |problem: GraphDataProblem| match problem {
            GraphDataProblem::InvalidContentText {
                node,
                row,
                column,
                field,
            } => (node, row, column, field, None),
            GraphDataProblem::ContentTextTooLong {
                node,
                row,
                column,
                field,
                limit,
            } => (node, row, column, field, Some(limit)),
            other => panic!("{other:?}"),
        };
        let cases = [(None, None), (Some(long.as_str()), Some(TEXT_LIMIT))];
        for (id, limit) in cases {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = with(id).into();
            let refused = field(graph_of(&data).unwrap_err());
            assert_eq!(refused, ("b".into(), 0, 1, "id".into(), limit));
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            let node = added(0.0, 0.0, |node| node.content = with(id).into());
            let refused = field(add(&mut graph, &node).unwrap_err());
            assert_eq!(refused, ("n".into(), 0, 1, "id".into(), limit));
        }
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        data.nodes[1].content = with(Some(&held)).into();
        assert!(graph_of(&data).is_ok());
        // Its text is a text's: missing, it is refused as the field `text`.
        let mut data = batch(&[("a", 0.0, 0.0)], &[]);
        let no_text = ((KindCode::Action, 1.0, RoleCode::Title, None), Some("d"));
        data.nodes[0].content = named_content(&[&[no_text]]).into();
        assert_eq!(graph_of(&data).unwrap_err(), invalid_text("a", 0, 0));
    }

    #[test]
    fn a_badge_whose_colour_is_no_rgb_or_whose_text_is_malformed_names_its_node() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        // A badge below a title, its text checked as a string of content is, then its colour, an
        // integer from 0 to 0xFFFFFF as an edge's; through a load and through `addNode` alike.
        let long = "d".repeat(MAX_TEXT + 1);
        let color = |node: &str| GraphDataProblem::InvalidContentColor {
            node: node.into(),
            row: 1,
            column: 0,
            segment: None,
        };
        let too_long = |node: &str| GraphDataProblem::ContentTextTooLong {
            node: node.into(),
            row: 1,
            column: 0,
            field: "text".into(),
            limit: TEXT_LIMIT,
        };
        type Refusal = fn(&str) -> GraphDataProblem;
        let cases: Vec<(Option<&str>, f64, Refusal)> = vec![
            (Some("Done"), -1.0, color),
            (Some("Done"), f64::from(0x100_0000), color),
            (Some("Done"), 0.5, color),
            (Some("Done"), f64::NAN, color),
            (Some("Done"), f64::INFINITY, color),
            (None, 0.0, |node| invalid_text(node, 1, 0)),
            (Some(&long), 0.0, too_long),
            // The text is checked before the colour.
            (None, f64::NAN, |node| invalid_text(node, 1, 0)),
        ];
        for (text, shade, problem) in cases {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = badged(text, shade).into();
            assert_eq!(
                graph_of(&data).unwrap_err(),
                problem("b"),
                "{text:?} {shade}"
            );
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            let node = added(0.0, 0.0, |node| node.content = badged(text, shade).into());
            assert_eq!(add(&mut graph, &node).unwrap_err(), problem("n"));
        }
        // At both ends of the colours, and a text at the limit, the badge is accepted.
        for (text, shade) in [
            ("Done", 0.0),
            ("Done", f64::from(0xff_ffff)),
            (&*"d".repeat(MAX_TEXT), 0.0),
        ] {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = badged(Some(text), shade).into();
            assert!(graph_of(&data).is_ok(), "{shade}");
        }
    }

    #[test]
    fn a_progress_bar_whose_segments_are_refused_names_its_node_and_the_segment() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        // A progress bar below a title: its number of segments, then each segment's fraction and
        // colour in their order, then their sum; through a load and through `addNode` alike.
        let green = f64::from(0x22_c55e);
        type Refusal = Box<dyn Fn(&str) -> GraphDataProblem>;
        let fraction = |segment| -> Refusal {
            Box::new(move |node| GraphDataProblem::InvalidFraction {
                node: node.into(),
                row: 1,
                column: 0,
                segment,
            })
        };
        let color = || -> Refusal {
            Box::new(|node| GraphDataProblem::InvalidContentColor {
                node: node.into(),
                row: 1,
                column: 0,
                segment: Some(1),
            })
        };
        let too_many = || -> Refusal {
            Box::new(|node| GraphDataProblem::TooManySegments {
                node: node.into(),
                row: 1,
                column: 0,
                limit: SEGMENT_LIMIT,
            })
        };
        let past = || -> Refusal {
            Box::new(|node| GraphDataProblem::FractionsPastOne {
                node: node.into(),
                row: 1,
                column: 0,
            })
        };
        let nine = vec![(0.1, green); MAX_SEGMENTS + 1];
        let cases: Vec<(Vec<(f64, f64)>, Refusal)> = vec![
            (vec![(-0.1, green)], fraction(0)),
            (vec![(0.3, green), (f64::NAN, green)], fraction(1)),
            (vec![(0.3, green), (f64::INFINITY, green)], fraction(1)),
            (vec![(0.3, green), (-1e-300, green)], fraction(1)),
            (vec![(0.3, green), (0.2, -1.0)], color()),
            (vec![(0.3, green), (0.2, f64::from(0x100_0000))], color()),
            (vec![(0.3, green), (0.2, 0.5)], color()),
            (vec![(0.3, green), (0.2, f64::NAN)], color()),
            // The fraction before the colour, the count before either, the sum after both.
            (vec![(0.3, green), (f64::NAN, f64::NAN)], fraction(1)),
            (
                nine.iter().map(|&(_, c)| (f64::NAN, c)).collect(),
                too_many(),
            ),
            (nine, too_many()),
            (vec![(0.6, green), (0.4 + 2e-9, green)], past()),
            (vec![(0.7, green), (0.5, f64::NAN)], color()),
            (vec![(f64::MAX, green), (f64::MAX, green)], past()),
        ];
        for (segments, problem) in cases {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = progressed(&segments).into();
            assert_eq!(graph_of(&data).unwrap_err(), problem("b"), "{segments:?}");
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            let node = added(0.0, 0.0, |node| node.content = progressed(&segments).into());
            assert_eq!(add(&mut graph, &node).unwrap_err(), problem("n"));
        }
        // At the limit of segments, at both ends of the colours, with fractions of 0, and summing
        // to 1 and a little past it, the bar is accepted; so is a bar of no segments.
        let accepted: [&[(f64, f64)]; 5] = [
            &[(0.125, 0.0); MAX_SEGMENTS],
            &[(0.0, 0.0), (1.0, f64::from(0xff_ffff))],
            &[(0.6, green), (0.4 + 5e-10, green)],
            &[(0.1, green), (0.2, green), (0.7, green)],
            &[],
        ];
        for segments in accepted {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = progressed(segments).into();
            assert!(graph_of(&data).is_ok(), "{segments:?}");
        }
    }

    #[test]
    fn a_progress_bar_fills_its_segments_alone_and_segments_that_do_not_fit_are_malformed() {
        // Verifies: ADR-0034
        let green = f64::from(0x22_c55e);
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = progressed(&[(0.3, green), (0.2, 0.0)]).into();
        }))]);
        let c = &columns.content;
        assert_eq!(c.kinds, [KindCode::Text as u8, KindCode::Progress as u8]);
        assert_eq!(c.roles, [RoleCode::Title as u8, 0]);
        assert!(c.colors.iter().all(|color| color.is_nan()));
        assert_eq!(c.segment_bounds, [0, 0, 2]);
        assert_eq!(c.fractions, [0.3, 0.2]);
        assert_eq!(c.segment_colors, [green, 0.0]);
        // The title's text alone: a progress bar fills no text and no name.
        assert_eq!((c.text_valid.len(), c.name_valid.len()), (1, 0));
        assert!(columns.content.view().fit(1));
        // A colour per segment: one too many or one too few does not fit.
        columns.content.segment_colors.push(0.0);
        assert!(!columns.content.view().fit(1));
        columns.content.segment_colors.truncate(1);
        assert!(!columns.content.view().fit(1));
        columns.content.segment_colors.push(0.0);
        assert_eq!(
            load_columns(&columns).map(|graph| graph.nodes_in_use()),
            Ok(1)
        );
        // A progress bar with a text does not fit.
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = progressed(&[]).into();
        }))]);
        columns.content.text_valid.push(1);
        columns.content.text_bounds.push(0);
        assert!(!columns.content.view().fit(1));
    }

    /// The refusal of the metric at row 1, column 0 of the node `node` by its rule `rule`: the
    /// direction, the colour, or a text by its field.
    fn metric_refusal(rule: &str, node: &str) -> GraphDataProblem {
        let (node, row, column) = (node.to_owned(), 1, 0);
        match rule {
            "direction" => GraphDataProblem::InvalidDirection { node, row, column },
            "color" => GraphDataProblem::InvalidContentColor {
                node,
                row,
                column,
                segment: None,
            },
            "long value" => GraphDataProblem::ContentTextTooLong {
                node,
                row,
                column,
                field: "value".into(),
                limit: TEXT_LIMIT,
            },
            field => GraphDataProblem::InvalidContentText {
                node,
                row,
                column,
                field: field.into(),
            },
        }
    }

    #[test]
    fn a_metric_whose_direction_texts_or_colour_are_refused_names_its_node_and_the_field() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        // A metric below a title: its trend's direction, then its caption, its value, and its
        // trend's text, each a string of content, then its trend's colour, as a badge's; through
        // a load and through `addNode` alike.
        let (up, green) = (DirectionCode::Up as u8, f64::from(0x22_c55e));
        let unnamed = DirectionCode::Unnamed as u8;
        let long = "d".repeat(MAX_TEXT + 1);
        let fine = [Some("Revenue"), Some("42"), Some("+3%")];
        let cases: Vec<(u8, f64, [Option<&str>; 3], &str)> = vec![
            (unnamed, green, fine, "direction"),
            (up, -1.0, fine, "color"),
            (up, f64::from(0x100_0000), fine, "color"),
            (up, 0.5, fine, "color"),
            (up, f64::NAN, fine, "color"),
            (up, green, [None, fine[1], fine[2]], "caption"),
            (up, green, [fine[0], None, fine[2]], "value"),
            (up, green, [fine[0], fine[1], None], "trend.text"),
            (up, green, [fine[0], Some(&long), fine[2]], "long value"),
            // The direction before the texts, the caption before the value, the texts before the
            // colour.
            (unnamed, f64::NAN, [None; 3], "direction"),
            (up, green, [None, None, None], "caption"),
            (up, f64::NAN, [fine[0], fine[1], None], "trend.text"),
        ];
        for (direction, shade, texts, rule) in cases {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = metricked(direction, shade, texts).into();
            let refused = graph_of(&data).unwrap_err();
            assert_eq!(refused, metric_refusal(rule, "b"), "{texts:?} {shade}");
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            let node = added(0.0, 0.0, |node| {
                node.content = metricked(direction, shade, texts).into();
            });
            let refused = add(&mut graph, &node).unwrap_err();
            assert_eq!(refused, metric_refusal(rule, "n"));
        }
    }

    #[test]
    fn a_metric_of_each_direction_and_colours_and_texts_at_their_limits_is_accepted() {
        // Verifies: ADR-0013, ADR-0034
        let held = "d".repeat(MAX_TEXT);
        let fine = [Some("Revenue"), Some("42"), Some("+3%")];
        for direction in [DirectionCode::Up, DirectionCode::Down, DirectionCode::Flat] {
            for (shade, texts) in [
                (0.0, fine),
                (
                    f64::from(0xff_ffff),
                    [Some(&*held), Some(&*held), Some(&*held)],
                ),
                (1.0, [Some(""), Some(""), Some("")]),
            ] {
                let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
                data.nodes[1].content = metricked(direction as u8, shade, texts).into();
                assert!(graph_of(&data).is_ok(), "{direction:?} {shade}");
            }
        }
    }

    #[test]
    fn a_metric_fills_its_direction_colour_and_three_texts_and_columns_that_do_not_fit_are_malformed()
     {
        // Verifies: ADR-0034
        let green = f64::from(0x22_c55e);
        let texts = [Some("Revenue"), Some("42"), Some("+3%")];
        let content = metricked(DirectionCode::Down as u8, green, texts);
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = content.into();
        }))]);
        let c = &columns.content;
        assert_eq!(c.kinds, [KindCode::Text as u8, KindCode::Metric as u8]);
        assert_eq!(c.roles, [RoleCode::Title as u8, 0]);
        assert_eq!(c.directions, [0, DirectionCode::Down as u8]);
        assert!(c.colors[0].is_nan());
        assert_eq!(c.colors[1], green);
        // The title's text, then the metric's caption, value, and trend's text; no name.
        assert_eq!(c.text_bounds, [0, 3, 10, 12, 15]);
        assert_eq!((c.text_valid.len(), c.name_valid.len()), (4, 0));
        assert!(columns.content.view().fit(1));
        assert_eq!(
            load_columns(&columns).map(|graph| graph.nodes_in_use()),
            Ok(1)
        );
        // A direction per element: one too many or too few, or a code that is none, does not fit.
        columns.content.directions.push(0);
        assert!(!columns.content.view().fit(1));
        columns.content.directions.truncate(1);
        assert!(!columns.content.view().fit(1));
        columns
            .content
            .directions
            .push(DirectionCode::Unnamed as u8 + 1);
        assert_eq!(load_columns(&columns).err(), Some(unfit()));
        columns.content.directions[1] = DirectionCode::Unnamed as u8;
        assert!(columns.content.view().fit(1));
        // A metric of fewer than three texts does not fit.
        columns.content.text_valid.pop();
        columns.content.text_bounds.pop();
        assert!(!columns.content.view().fit(1));
    }

    #[test]
    fn boundaries_of_segments_that_do_not_bound_them_or_bound_another_kind_s_are_malformed() {
        // Verifies: ADR-0034
        // A title, then a progress bar of two segments: their boundaries are [0, 0, 2].
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = progressed(&[(0.3, 0.0), (0.2, 0.0)]).into();
        }))]);
        // Boundaries that do not start at 0, fall, end short of the segments or past them, or
        // are one too few; and segments of the title, which is no progress bar.
        let unfit_bounds = [
            vec![1, 1, 2],
            vec![0, 2, 1],
            vec![0, 0, 1],
            vec![0, 0, 3],
            vec![0, 0],
            vec![0, 1, 2],
        ];
        for bounds in unfit_bounds {
            columns.content.segment_bounds.clone_from(&bounds);
            assert_eq!(load_columns(&columns).err(), Some(unfit()), "{bounds:?}");
        }
        columns.content.segment_bounds = vec![0, 0, 2];
        assert!(columns.content.view().fit(1));
    }

    #[test]
    fn a_progress_bar_s_segments_that_are_no_list_or_a_segment_that_is_no_object_are_refused_where_they_lie()
     {
        // Verifies: ADR-0034
        let shape = |column, expected: &str| GraphDataProblem::InvalidContentShape {
            index: 1,
            id: Some("b".into()),
            row: 1,
            column: Some(column),
            expected: expected.into(),
        };
        // Node `b`: a title row, then a title beside a progress bar of no segments, at row 1,
        // column 1.
        let at = |field, row, column| {
            let mut b = ContentInput::new();
            let title = (KindCode::Text, 1.0, RoleCode::Title as u8, f64::NAN);
            b.push(title.0, title.1, title.2, title.3, Some("t"), None);
            b.end_row();
            b.push(title.0, title.1, title.2, title.3, Some("t"), None);
            b.push(KindCode::Progress, 1.0, 0, f64::NAN, None, None);
            b.end_row();
            let mut columns = a_and(|n| n.content = b.into());
            columns.refused = Some(Refused {
                index: 1,
                field,
                row,
                column,
            });
            load_columns(&columns).err()
        };
        assert_eq!(
            at(NodeField::Segments, Some(1), Some(1)),
            Some(shape(1, A_SEGMENT_LIST))
        );
        assert_eq!(
            at(NodeField::Segment, Some(1), Some(1)),
            Some(shape(1, AN_ELEMENT))
        );
        // A position that names no element of the columns, or an element that is no progress
        // bar, is malformed.
        for (field, row, column) in [
            (NodeField::Segments, Some(1), None),
            (NodeField::Segments, Some(1), Some(2)),
            (NodeField::Segments, Some(1), Some(0)),
            (NodeField::Segment, Some(0), Some(0)),
            (NodeField::Segment, None, Some(1)),
            (NodeField::Segment, Some(2), Some(1)),
        ] {
            assert_eq!(at(field, row, column), Some(unfit()), "{field:?}");
        }
        // Read as `addNode` and `updateNode` read content: the first shape named, segments that
        // are no list read as none and a segment that is no object as one of NaN.
        let mut content = ContentInput::new();
        content.push(KindCode::Progress, 1.0, 0, f64::NAN, None, None);
        content.unread(0, Some(0), Unflat::Segment);
        content.push_segment(f64::NAN, f64::NAN);
        content.unread(0, Some(0), Unflat::Segments);
        content.end_row();
        assert_eq!(
            (content.shape, content.unread),
            (Some((0, Some(0))), Unflat::Segment)
        );
        let node = added(0.0, 0.0, |node| node.content = content.into());
        let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
        assert_eq!(
            add(&mut graph, &node).unwrap_err(),
            GraphDataProblem::InvalidContentShape {
                index: 0,
                id: Some("n".into()),
                row: 0,
                column: Some(0),
                expected: AN_ELEMENT.into(),
            }
        );
    }

    #[test]
    fn a_badge_fills_one_text_and_its_colour_and_columns_of_colours_that_do_not_fit_are_malformed()
    {
        // Verifies: ADR-0034
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = badged(Some("Done"), f64::from(0x22_c55e)).into();
        }))]);
        let c = &columns.content;
        assert_eq!(c.kinds, [KindCode::Text as u8, KindCode::Badge as u8]);
        assert_eq!(c.roles, [RoleCode::Title as u8, 0]);
        assert!(c.colors[0].is_nan());
        assert_eq!(c.colors[1], f64::from(0x22_c55e));
        assert_eq!((c.text_valid.len(), c.name_valid.len()), (2, 0));
        assert!(columns.content.view().fit(1));
        // A colour per element: one too many or one too few does not fit.
        columns.content.colors.push(0.0);
        assert!(!columns.content.view().fit(1));
        columns.content.colors.truncate(1);
        assert!(!columns.content.view().fit(1));
        // A badge without its text does not fit either.
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = badged(Some("Done"), 0.0).into();
        }))]);
        columns.content.text_valid.pop();
        columns.content.text_bounds.pop();
        assert!(!columns.content.view().fit(1));
    }

    #[test]
    fn an_actions_identifier_counts_against_the_budget_of_a_loads_strings_of_content() {
        // Verifies: ADR-0034, Q-7
        // The budget lowered to 5 code units: `a`'s action of the text "ab" and the identifier
        // "cde" holds it, and `b`'s title of 1 passes it.
        content::TEST_BUDGET.set(Some(5));
        let load = |b_text: &str| {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[0].content = named_content(&[&[action("ab", "cde")]]).into();
            data.nodes[1].content = titled(b_text);
            graph_of(&data)
        };
        let held = load("");
        let passed = load("b");
        content::TEST_BUDGET.set(None);
        assert!(held.is_ok(), "{:?}", held.err());
        assert_eq!(
            passed.err(),
            Some(GraphDataProblem::ContentBudgetExceeded {
                node: "b".into(),
                limit: MAX_CONTENT_UNITS
            })
        );
    }

    #[test]
    fn columns_of_names_that_do_not_follow_from_the_kinds_are_malformed() {
        // Verifies: ADR-0034
        // One action fills one text and one name: a name too many, or none, does not fit.
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = named_content(&[&[action("Details", "d")]]).into();
        }))]);
        assert!(columns.content.view().fit(1));
        columns.content.name_valid.push(1);
        columns.content.name_bounds.push(1);
        assert!(!columns.content.view().fit(1));
        columns.content.name_valid.clear();
        columns.content.name_bounds = vec![0];
        columns.content.names.clear();
        assert!(!columns.content.view().fit(1));
    }

    #[test]
    fn an_icon_whose_name_is_no_string_or_too_long_names_its_node() {
        // Verifies: ADR-0013, ADR-0034, Q-7
        // A title and an icon beside it, whose name is checked as a string of content is, against
        // the limit of a text, as the field `name`; through a load and through `addNode` alike.
        let long = "d".repeat(MAX_TEXT + 1);
        let held = "d".repeat(MAX_TEXT);
        let with = |name: Option<&str>| {
            named_content(&[&[(text(RoleCode::Title, "Bet"), None), icon(name)]])
        };
        let invalid = |node: &str| GraphDataProblem::InvalidContentText {
            node: node.into(),
            row: 0,
            column: 1,
            field: "name".into(),
        };
        let too_long = |node: &str| GraphDataProblem::ContentTextTooLong {
            node: node.into(),
            row: 0,
            column: 1,
            field: "name".into(),
            limit: TEXT_LIMIT,
        };
        type Refusal = fn(&str) -> GraphDataProblem;
        let cases: [(Option<&str>, Refusal); 2] = [(None, invalid), (Some(&long), too_long)];
        for (name, problem) in cases {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = with(name).into();
            assert_eq!(graph_of(&data).unwrap_err(), problem("b"));
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            let node = added(0.0, 0.0, |node| node.content = with(name).into());
            assert_eq!(add(&mut graph, &node).unwrap_err(), problem("n"));
        }
        // A name of the limit, and an empty one, which names an icon no host registers.
        for name in [held.as_str(), ""] {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[1].content = with(Some(name)).into();
            assert!(graph_of(&data).is_ok());
        }
    }

    #[test]
    fn an_icons_name_counts_against_the_budget_of_a_loads_strings_of_content() {
        // Verifies: ADR-0034, Q-7
        // The budget lowered to 5 code units: `a`'s icon named "abcde" holds it, and `b`'s title
        // of 1 passes it.
        content::TEST_BUDGET.set(Some(5));
        let load = |b_text: &str| {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
            data.nodes[0].content = named_content(&[&[icon(Some("abcde"))]]).into();
            data.nodes[1].content = titled(b_text);
            graph_of(&data)
        };
        let held = load("");
        let passed = load("b");
        content::TEST_BUDGET.set(None);
        assert!(held.is_ok(), "{:?}", held.err());
        assert_eq!(
            passed.err(),
            Some(GraphDataProblem::ContentBudgetExceeded {
                node: "b".into(),
                limit: MAX_CONTENT_UNITS
            })
        );
    }

    #[test]
    fn columns_of_an_icon_that_do_not_follow_from_its_kind_are_malformed() {
        // Verifies: ADR-0034
        // An icon fills one name and no text: a text, or no name, does not fit.
        let mut columns = OwnedColumns::of([Some(&added(0.0, 0.0, |node| {
            node.content = named_content(&[&[icon(Some("bet"))]]).into();
        }))]);
        assert!(columns.content.view().fit(1));
        assert_eq!(columns.content.kinds, [KindCode::Icon as u8]);
        assert!(columns.content.text_valid.is_empty());
        columns.content.text_valid.push(1);
        columns.content.text_bounds.push(0);
        assert!(!columns.content.view().fit(1));
        columns.content.text_valid.clear();
        columns.content.text_bounds = vec![0];
        assert!(columns.content.view().fit(1));
        columns.content.name_valid.clear();
        columns.content.name_bounds = vec![0];
        columns.content.names.clear();
        assert!(!columns.content.view().fit(1));
    }

    /// The refusal of the text at `row` and `column` of the node `node` as no text.
    fn invalid_text(node: &str, row: u32, column: u32) -> GraphDataProblem {
        GraphDataProblem::InvalidContentText {
            node: node.into(),
            row,
            column,
            field: "text".into(),
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
    fn a_graph_beyond_a_million_nodes_or_edges_is_refused_naming_the_list() {
        assert_eq!(check_graph_size(1e6, 1e6), Ok(()));
        let too_many = |list: &str| GraphDataProblem::TooMany {
            list: list.into(),
            limit: 1_000_000,
        };
        assert_eq!(check_graph_size(1e6 + 1.0, 0.0), Err(too_many("nodes")));
        assert_eq!(
            check_graph_size(0.0, 4_294_967_295.0),
            Err(too_many("edges"))
        );
        for count in [f64::NAN, -1.0, 0.5] {
            assert!(matches!(
                check_graph_size(count, 0.0),
                Err(GraphDataProblem::Malformed { .. })
            ));
        }
    }

    #[test]
    fn a_patch_with_another_field_or_a_title_not_text_names_its_node() {
        let patch = |entries: Vec<(&str, Field<ContentInput>)>| {
            let fields = entries.into_iter().map(|(k, v)| (k.to_owned(), v));
            patch_of("a", &NodePatch(fields.collect()), &Fonts::default(), 0).map(|checked| {
                checked.map(|(content, height)| (content.text(0).to_owned(), height))
            })
        };
        assert_eq!(patch(Vec::new()), Ok(None));
        assert_eq!(
            patch(vec![("content", titled("A"))]),
            Ok(Some(("A".to_owned(), 64.0)))
        );
        assert_eq!(
            patch(vec![("content", titled("A")), ("width", Field(None))]),
            Err(GraphDataProblem::UnknownPatchField {
                node: "a".into(),
                field: "width".into()
            })
        );
        let long = "x".repeat(MAX_TEXT + 1);
        assert_eq!(
            patch(vec![("content", titled(&long))]),
            Err(GraphDataProblem::ContentTextTooLong {
                node: "a".into(),
                row: 0,
                column: 0,
                field: "text".into(),
                limit: 1_000
            })
        );
        let none = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]);
        assert_eq!(
            patch(vec![("content", none.into())]),
            Err(invalid_text("a", 0, 0))
        );
    }

    #[test]
    fn a_count_beyond_u32_is_refused_as_the_engine_refuses_it() {
        let beyond = u32::MAX as usize + 1;
        assert_eq!(slot(u32::MAX as usize), Ok(u32::MAX));
        assert_eq!(
            slot(beyond),
            Err(GraphDataProblem::from(graph::slot(beyond).unwrap_err()))
        );
        assert_eq!(
            slot(beyond),
            Err(GraphDataProblem::Malformed {
                message: "the graph holds more items than the engine can number".into()
            })
        );
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

    /// The node of `batch` at `(x, y)` with `change` made to it.
    fn added(x: f64, y: f64, change: impl FnOnce(&mut NodeInput)) -> NodeInput {
        let mut node = batch(&[("n", x, y)], &[]).nodes.remove(0);
        change(&mut node);
        node
    }

    #[test]
    fn an_edge_the_engine_cannot_number_is_refused_as_a_node_it_cannot_number() {
        // Verifies: ADR-0022
        let node = GraphDataProblem::from(TooManySlots);
        assert_eq!(
            EdgeRefusal::from(AddEdgeError::TooManySlots(TooManySlots)),
            EdgeRefusal::Data(node)
        );
        let slot = SlotError::NoNode { slot: 3 };
        assert_eq!(
            EdgeRefusal::from(AddEdgeError::Slot(slot)),
            EdgeRefusal::Slot(slot)
        );
    }

    #[test]
    fn an_added_node_takes_the_next_slot_where_it_was_placed() {
        // Verifies: ADR-0022
        let mut graph = graph_of(&batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[])).unwrap();
        assert_eq!(add(&mut graph, &added(40.0, 50.0, |_| {})), Ok(2));
        assert_eq!(&graph.positions()[4..], [40.0, 50.0]);
        // On an engine that never loaded a graph too.
        let mut empty = Graph::default();
        assert_eq!(add(&mut empty, &added(1.0, 2.0, |_| {})), Ok(0));
        assert_eq!(empty.positions(), [1.0, 2.0]);
    }

    /// Adds `node` to `graph` as `addNode` does, in the fonts of no font handed over, and returns
    /// its slot.
    fn add(graph: &mut Graph, node: &NodeInput) -> Result<u32, GraphDataProblem> {
        add_node_to(graph, node, &Fonts::default(), 0).map(|(slot, _)| slot)
    }

    #[test]
    fn an_added_node_is_refused_as_a_load_refuses_it_and_the_graph_kept() {
        // Verifies: ADR-0028, Q-7
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
    fn a_node_added_to_a_graph_at_the_limit_of_a_load_is_refused() {
        // Verifies: ADR-0028, Q-7
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

    /// The load of `columns` and no edges, as `loadGraph` checks it.
    fn load_columns(columns: &OwnedColumns) -> Result<Graph, GraphDataProblem> {
        let edges = OwnedEdgeColumns::of([]);
        load_of(&columns.view(), &edges.view(), &Fonts::default()).map(|loaded| loaded.graph)
    }

    /// The columns of node `a` and of `b`, made by `change` from a well-formed one.
    fn a_and(change: impl FnOnce(&mut NodeInput)) -> OwnedColumns {
        let nodes = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]).nodes;
        let mut b = added(300.0, 0.0, |n| n.id = "b".to_owned().into());
        change(&mut b);
        OwnedColumns::of([Some(&nodes[0]), Some(&b)])
    }

    #[test]
    fn every_refusal_of_a_node_crosses_as_columns_with_its_kind_and_names() {
        // Verifies: ADR-0034
        let b = || "b".to_owned();
        let field =
            |field: &str, id: Option<String>, expected: &str| GraphDataProblem::InvalidField {
                list: GraphList::Nodes,
                index: 1,
                id,
                field: field.into(),
                expected: expected.into(),
            };
        // A field missing or of another type, or an identifier with a lone surrogate, which the
        // snapshot hands over as `false`: the column holds none of it, and names its position.
        let mut cases: Vec<(OwnedColumns, GraphDataProblem)> = vec![
            (a_and(|n| n.id = Field(None)), field("id", None, AN_ID)),
            (
                a_and(|n| n.x = Field(None)),
                field("x", Some(b()), A_NUMBER),
            ),
            (
                a_and(|n| n.y = Field(None)),
                field("y", Some(b()), A_NUMBER),
            ),
            (
                a_and(|n| n.width = Field(None)),
                field("width", Some(b()), A_SIZE),
            ),
            (
                a_and(|n| n.content = Field(None)),
                field("content", Some(b()), A_CONTENT),
            ),
            // The first of a node's fields refused, in the order a node is read.
            (
                a_and(|n| (n.content, n.y) = (Field(None), Field(None))),
                field("y", Some(b()), A_NUMBER),
            ),
            (
                a_and(|n| n.id = "x".repeat(MAX_ID + 1).into()),
                GraphDataProblem::IdTooLong {
                    list: "nodes".into(),
                    index: 1,
                    field: "id".into(),
                    limit: ID_LIMIT,
                },
            ),
            (
                a_and(|n| n.id = "a".to_owned().into()),
                GraphDataProblem::DuplicateNode { node: "a".into() },
            ),
            (
                a_and(|n| n.x = f64::INFINITY.into()),
                GraphDataProblem::NonFiniteCoordinate { node: b() },
            ),
            (
                a_and(|n| n.width = (-1.0).into()),
                GraphDataProblem::InvalidSize { node: b() },
            ),
            (
                a_and(|n| n.y = (-WORLD_LIMIT * 1.01).into()),
                beyond(GraphList::Nodes, "b", "y"),
            ),
        ];
        // A node that is no object, refused as malformed as one that is no object was.
        let a = batch(&[("a", 0.0, 0.0)], &[]).nodes;
        cases.push((
            OwnedColumns::of([Some(&a[0]), None]),
            unshaped("a node is no object"),
        ));
        for (columns, problem) in cases {
            assert_eq!(load_columns(&columns).err(), Some(problem));
        }
        assert!(load_columns(&a_and(|_| {})).is_ok());
    }

    /// The columns of node `a` and of `b`, `b` of the content `rows`.
    pub(crate) fn b_of(rows: &[&[Cell]]) -> OwnedColumns {
        let rows = content(rows);
        a_and(|n| n.content = rows.into())
    }

    /// A well-formed title.
    pub(crate) const TITLE: Cell = text(RoleCode::Title, "t");

    #[test]
    fn a_title_that_is_no_text_or_too_long_crosses_as_columns_with_its_kind_and_names() {
        // Verifies: ADR-0034
        let b = || "b".to_owned();
        let cases: Vec<(OwnedColumns, GraphDataProblem)> = vec![
            // A title missing, of another type, or with a lone surrogate is no text.
            (
                a_and(|n| {
                    n.content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
                }),
                invalid_text("b", 0, 0),
            ),
            (
                a_and(|n| n.content = titled(&"x".repeat(MAX_TEXT + 1))),
                GraphDataProblem::ContentTextTooLong {
                    node: b(),
                    row: 0,
                    column: 0,
                    field: "text".into(),
                    limit: TEXT_LIMIT,
                },
            ),
        ];
        for (columns, problem) in cases {
            assert_eq!(load_columns(&columns).err(), Some(problem));
        }
    }

    /// The refusal of a load of node `a` and of `b`, `b` of the content `rows`, or none.
    fn refused(rows: &[&[Cell]]) -> Option<GraphDataProblem> {
        load_columns(&b_of(rows)).err()
    }

    /// The element at `row` and `column` of node `b`, as a refusal names it.
    fn at_b(row: u32, column: u32) -> (String, u32, u32) {
        ("b".to_owned(), row, column)
    }

    #[test]
    fn rows_and_columns_past_their_limits_are_refused_naming_the_node() {
        // Verifies: ADR-0034, ADR-0013, Q-7
        let title_row: &[Cell] = &[TITLE];
        assert_eq!(refused(&[title_row; MAX_ROWS]), None);
        let too_many = || GraphDataProblem::TooManyRows {
            node: "b".into(),
            limit: 8,
        };
        assert_eq!(refused(&[title_row; MAX_ROWS + 1]), Some(too_many()));
        let wide = [TITLE; MAX_COLUMNS];
        assert_eq!(refused(&[title_row, &wide]), None);
        let wider = [TITLE; MAX_COLUMNS + 1];
        assert_eq!(
            refused(&[title_row, &wider]),
            Some(GraphDataProblem::TooManyColumns {
                node: "b".into(),
                row: 1,
                limit: 6
            })
        );
        // The rows are counted before any row's elements are read.
        let unnamed: &[Cell] = &[(KindCode::Unnamed, 1.0, RoleCode::Title, None)];
        assert_eq!(refused(&[unnamed; MAX_ROWS + 1]), Some(too_many()));
    }

    #[test]
    fn every_content_refusal_crosses_as_columns_with_its_kind_and_names() {
        // Verifies: ADR-0034, ADR-0013, Q-7
        let title_row: &[Cell] = &[TITLE];
        // An element of no kind, at row 1 and column 1.
        let (node, row, column) = at_b(1, 1);
        let unnamed = (KindCode::Unnamed, 1.0, RoleCode::Title, None);
        assert_eq!(
            refused(&[title_row, &[TITLE, unnamed]]),
            Some(GraphDataProblem::InvalidElementKind { node, row, column })
        );
        // A weight at the bounds of the positive finite numbers, and past them.
        for weight in [f64::MIN_POSITIVE, 1.0, f64::MAX] {
            let weighted = (KindCode::Text, weight, RoleCode::Body, Some("w"));
            assert_eq!(refused(&[title_row, &[TITLE, weighted]]), None, "{weight}");
        }
        for weight in [0.0, -0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let weighted = (KindCode::Text, weight, RoleCode::Body, Some("w"));
            let (node, row, column) = at_b(1, 1);
            assert_eq!(
                refused(&[title_row, &[TITLE, weighted]]),
                Some(GraphDataProblem::InvalidWeight { node, row, column }),
                "{weight}"
            );
        }
        let roleless = (KindCode::Text, 1.0, RoleCode::Unnamed, Some("r"));
        let (node, row, column) = at_b(0, 1);
        assert_eq!(
            refused(&[&[TITLE, roleless]]),
            Some(GraphDataProblem::InvalidRole { node, row, column })
        );
        // A text missing, of another type, or holding a lone surrogate crosses as no text.
        let textless = (KindCode::Text, 1.0, RoleCode::Caption, None);
        assert_eq!(
            refused(&[title_row, title_row, &[textless]]),
            Some(invalid_text("b", 2, 0))
        );
        // Texts at the limit and past it, in UTF-16 code units, pairs counted twice.
        let long = |text: &str| {
            refused(&[
                title_row,
                &[TITLE, (KindCode::Text, 1.0, RoleCode::Body, Some(text))],
            ])
        };
        let too_long = Some(GraphDataProblem::ContentTextTooLong {
            node: "b".into(),
            row: 1,
            column: 1,
            field: "text".into(),
            limit: 1_000,
        });
        assert_eq!(long(&"x".repeat(MAX_TEXT)), None);
        assert_eq!(long(&"\u{1F600}".repeat(500)), None);
        assert_eq!(long(&"x".repeat(MAX_TEXT + 1)), too_long);
        assert_eq!(long(&("\u{1F600}".repeat(500) + "x")), too_long);
    }

    #[test]
    fn an_elements_fields_are_checked_in_their_order() {
        // Verifies: ADR-0034
        // A kind before a weight, a weight before a role, a role before the text.
        let (node, row, column) = at_b(0, 0);
        assert_eq!(
            refused(&[&[(KindCode::Unnamed, f64::NAN, RoleCode::Unnamed, None)]]),
            Some(GraphDataProblem::InvalidElementKind { node, row, column })
        );
        let (node, row, column) = at_b(0, 0);
        assert_eq!(
            refused(&[&[(KindCode::Text, f64::NAN, RoleCode::Unnamed, None)]]),
            Some(GraphDataProblem::InvalidWeight { node, row, column })
        );
        let (node, row, column) = at_b(0, 0);
        assert_eq!(
            refused(&[&[(KindCode::Text, 1.0, RoleCode::Unnamed, None)]]),
            Some(GraphDataProblem::InvalidRole { node, row, column })
        );
        assert_eq!(
            refused(&[&[(KindCode::Text, 1.0, RoleCode::Body, None)]]),
            Some(invalid_text("b", 0, 0))
        );
    }

    #[test]
    fn the_strings_of_a_loads_content_are_refused_past_their_budget_at_the_node_that_passes_it() {
        // Verifies: ADR-0034, Q-7
        // A million nodes of one text of 1,000 code units hold the budget of 1,000,000,000
        // exactly; one code unit more is refused at the node whose text passes it. The rule reads
        // the lengths off the boundaries alone, so the texts need not be held.
        let count = 1_000_000;
        let budget = |last: u32| {
            let mut text_bounds: Vec<u32> = (0..=count).map(|i| i * 1_000).collect();
            text_bounds[count as usize] = text_bounds[count as usize - 1] + last;
            let nodes: Vec<u32> = (0..=count).collect();
            let columns = ContentColumns {
                row_bounds: &nodes,
                element_bounds: &nodes,
                kinds: &vec![KindCode::Text as u8; count as usize],
                weights: &vec![1.0; count as usize],
                roles: &vec![RoleCode::Title as u8; count as usize],
                directions: &vec![0; count as usize],
                colors: &vec![f64::NAN; count as usize],
                segment_bounds: &vec![0; count as usize + 1],
                fractions: &[],
                segment_colors: &[],
                texts: &[],
                text_bounds: &text_bounds,
                text_valid: &vec![1; count as usize],
                names: &[],
                name_bounds: &[0],
                name_valid: &[],
            };
            let mut cursor = Cursor::default();
            let fonts = Fonts::default();
            (0..count as usize).try_for_each(|node| {
                let id = format!("n{node}");
                columns.check(node, &id, &mut cursor, &fonts).map(|_| ())
            })
        };
        assert_eq!(MAX_CONTENT_UNITS, 1_000_000_000);
        assert_eq!(budget(1_000), Ok(()));
        // The last text at 1,000 code units holds the budget; the limit of a text keeps it there,
        // so past it the text is refused for its length first.
        assert_eq!(
            budget(1_001)
                .err()
                .map(|problem| matches!(problem, GraphDataProblem::ContentTextTooLong { .. })),
            Some(true)
        );
        // The budget's own refusal, at the node whose string passes it.
        assert_eq!(
            check_content_budget("n9", f64::from(MAX_CONTENT_UNITS)),
            Ok(())
        );
        assert_eq!(
            check_content_budget("n9", f64::from(MAX_CONTENT_UNITS) + 1.0),
            Err(GraphDataProblem::ContentBudgetExceeded {
                node: "n9".into(),
                limit: 1_000_000_000
            })
        );
    }

    #[test]
    fn a_shape_of_content_the_snapshot_cannot_flatten_is_refused_where_it_lies() {
        // Verifies: ADR-0034
        let shape = |row, column: Option<u32>| GraphDataProblem::InvalidContentShape {
            index: 1,
            id: Some("b".into()),
            row,
            column,
            expected: (if column.is_some() { AN_ELEMENT } else { A_ROW }).into(),
        };
        let at = |field, row, column| {
            let mut columns = b_of(&[&[TITLE], &[TITLE, TITLE]]);
            columns.refused = Some(Refused {
                index: 1,
                field,
                row,
                column,
            });
            load_columns(&columns).err()
        };
        assert_eq!(at(NodeField::Row, Some(1), None), Some(shape(1, None)));
        assert_eq!(
            at(NodeField::Element, Some(1), Some(1)),
            Some(shape(1, Some(1)))
        );
        // A position that names no row or column of the columns is malformed.
        for (field, row, column) in [
            (NodeField::Row, Some(2), None),
            (NodeField::Row, None, None),
            (NodeField::Row, Some(0), Some(0)),
            (NodeField::Element, Some(0), Some(1)),
            (NodeField::Element, Some(1), None),
            (NodeField::Element, Some(5), Some(0)),
            (NodeField::X, Some(0), None),
            (NodeField::Content, None, Some(0)),
        ] {
            assert_eq!(
                at(field, row, column),
                Some(unfit()),
                "{field:?} {row:?} {column:?}"
            );
        }
    }

    #[test]
    fn content_columns_that_do_not_fit_together_are_refused_as_malformed() {
        // Verifies: ADR-0034
        let fits = || b_of(&[&[TITLE], &[TITLE, TITLE]]);
        assert!(load_columns(&fits()).is_ok());
        let changes: [fn(&mut ContentData); 14] = [
            // The boundaries of the rows: from 0, never falling, to the rows there are.
            |c| c.row_bounds[0] = 1,
            |c| c.row_bounds = vec![0, 2, 1],
            |c| _ = c.row_bounds.pop(),
            // Of the elements, likewise.
            |c| c.element_bounds[0] = 1,
            |c| c.element_bounds[2] = 0,
            |c| c.element_bounds.push(4),
            // Every element's columns as long as there are elements.
            |c| _ = c.weights.pop(),
            |c| c.roles.push(0),
            // A code that is no code, and a validity byte above 1.
            |c| c.kinds[0] = KindCode::Unnamed as u8 + 1,
            |c| c.roles[1] = RoleCode::Unnamed as u8 + 1,
            |c| c.text_valid[2] = 2,
            // As many texts as the kinds fill: none for an element of no kind.
            |c| c.kinds[3] = KindCode::Unnamed as u8,
            |c| _ = c.text_bounds.pop(),
            |c| c.texts.push("x".to_owned()),
        ];
        for (i, change) in changes.into_iter().enumerate() {
            let mut columns = fits();
            change(&mut columns.content);
            assert_eq!(load_columns(&columns).err(), Some(unfit()), "change {i}");
        }
    }

    #[test]
    fn texts_of_content_cut_inside_a_pair_are_refused_for_their_length_before_any_is_mapped() {
        // Verifies: ADR-0034
        // Two texts of 1,100 code units, cut to 1,001: the first ends in the high half of a pair
        // and the second begins with the low one.
        let texts = format!("{}\u{1F600}{}", "a".repeat(1_000), "b".repeat(1_000));
        let mut columns = b_of(&[&[TITLE]]);
        columns.content.texts = vec![texts];
        columns.content.text_bounds = vec![0, 1_001, 2_002];
        assert_eq!(
            load_columns(&columns).err(),
            Some(GraphDataProblem::ContentTextTooLong {
                node: "a".into(),
                row: 0,
                column: 0,
                field: "text".into(),
                limit: 1_000,
            })
        );
        // A boundary inside a character no length refuses is malformed, never mapped.
        let mut columns = b_of(&[&[TITLE]]);
        columns.content.texts = vec!["\u{1F600}".to_owned()];
        columns.content.text_bounds = vec![0, 1, 2];
        assert_eq!(load_columns(&columns).err(), Some(malformed(TEXT_INSIDE)));
    }

    #[test]
    fn a_coordinate_not_finite_in_an_early_node_is_named_before_a_title_in_a_later_one() {
        // Verifies: ADR-0034
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

    /// The columns of nodes of identifiers `ids`, given as the string Rust holds and the
    /// boundaries the shell computed, with the field `refused` of a node named.
    fn cut(ids: &str, bounds: &[u32], refused: Option<(u32, NodeField)>) -> OwnedColumns {
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

    #[test]
    fn identifiers_cut_inside_a_pair_are_refused_for_their_length_before_any_is_mapped() {
        // Verifies: ADR-0034
        // Two identifiers of 300 code units, cut to 257: the first ends in the high half of a
        // pair and the second begins with the low one, one character across their boundary.
        let ids = format!("{}\u{1F600}{}", "a".repeat(256), "b".repeat(256));
        assert_eq!(
            load_columns(&cut(&ids, &[0, 257, 514], None)).unwrap_err(),
            GraphDataProblem::IdTooLong {
                list: "nodes".into(),
                index: 0,
                field: "id".into(),
                limit: ID_LIMIT,
            }
        );
        // A boundary inside a character no length refuses is malformed, never mapped.
        assert_eq!(
            load_columns(&cut("\u{1F600}", &[0, 1, 2], None)).unwrap_err(),
            malformed("an identifier ends inside a character")
        );
        // A node refused by its type in the first pass is named by its identifier as the shell
        // read it, each half of a pair cut in two U+FFFD, as it crossed alone.
        let named = |at, id: String| {
            let columns = cut(&ids, &[0, 257, 514], Some((at, NodeField::X)));
            let problem = load_columns(&columns).unwrap_err();
            assert!(
                matches!(&problem, GraphDataProblem::InvalidField { id: Some(named), .. } if *named == id),
                "{problem:?}"
            );
        };
        named(0, format!("{}\u{FFFD}", "a".repeat(256)));
        named(1, format!("\u{FFFD}{}", "b".repeat(256)));
    }

    #[test]
    fn columns_that_do_not_fit_together_are_refused_as_malformed() {
        // Verifies: ADR-0034
        let fits = || a_and(|_| {});
        let changes: [fn(&mut OwnedColumns); 7] = [
            |c| _ = c.x.pop(),
            |c| _ = c.content.text_valid.pop(),
            |c| _ = c.id_bounds.pop(),
            |c| c.id_bounds[0] = 1,
            |c| c.id_bounds = vec![0, 2, 1],
            |c| c.content.texts.push("x".to_owned()),
            |c| {
                c.refused = Some(Refused {
                    index: 2,
                    field: NodeField::X,
                    row: None,
                    column: None,
                })
            },
        ];
        for change in changes {
            let mut columns = fits();
            change(&mut columns);
            assert_eq!(load_columns(&columns).err(), Some(unfit()));
        }
        assert_eq!(refused_of(Some(0), None, None, None), Err(unfit()));
        assert_eq!(
            refused_of(None, Some(NodeField::Id as u32), None, None),
            Err(unfit())
        );
        assert_eq!(refused_of(None, None, None, None), Ok(None));
        // A row or a column without a refused field names no place.
        assert_eq!(refused_of(None, None, Some(0), None), Err(unfit()));
        assert_eq!(refused_of(None, None, None, Some(0)), Err(unfit()));
        // Every field by its code, and a code no field has refused as malformed.
        for field in NodeField::ALL {
            let refused = refused_of(Some(1), Some(field as u32), None, None);
            assert_eq!(
                refused.map(|r| r.map(|r| (r.index, r.field))),
                Ok(Some((1, field)))
            );
        }
        for code in [10, 255, u32::MAX] {
            assert_eq!(refused_of(Some(0), Some(code), None, None), Err(unfit()));
        }
    }

    /// The load of nodes `a` and `b` and of `edges`, as `loadGraph` checks it.
    fn load_edges(edges: &OwnedEdgeColumns) -> Result<Graph, GraphDataProblem> {
        let nodes = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]).nodes;
        load_of(
            &OwnedColumns::of(nodes.iter().map(Some)).view(),
            &edges.view(),
            &Fonts::default(),
        )
        .map(|loaded| loaded.graph)
    }

    /// Edge `d` from `a` to `b`, labelled, dashed, and with a background, as an edge of a load.
    fn labelled(id: &str) -> EdgeCells {
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
    fn d_and(change: impl FnOnce(&mut EdgeCells)) -> OwnedEdgeColumns {
        let mut e = labelled("e");
        change(&mut e);
        OwnedEdgeColumns::of([Some(&labelled("d")), Some(&e)])
    }

    /// The label of `edge`, which `labelled` gave it.
    fn label_in(edge: &mut EdgeCells) -> &mut LabelInput {
        let Field(Some(Some(label))) = &mut edge.label else {
            unreachable!("a labelled edge")
        };
        label
    }

    #[test]
    fn every_refusal_of_an_edge_crosses_as_columns_with_its_kind_and_names() {
        // Verifies: ADR-0034
        let e = || "e".to_owned();
        let field =
            |field: &str, id: Option<String>, expected: &str| GraphDataProblem::InvalidField {
                list: GraphList::Edges,
                index: 1,
                id,
                field: field.into(),
                expected: expected.into(),
            };
        let text = |value: &str| Field(Some(value.to_owned()));
        // A field missing or of another type, or an identifier with a lone surrogate, which the
        // snapshot hands over as `false`: the column holds none of it, and names its position.
        type Change = fn(&mut EdgeCells);
        let by_type: [(Change, &str, &str); 11] = [
            (|e| e.id = Field(None), "id", AN_ID),
            (|e| e.source = Field(None), "source", AN_ID),
            (|e| e.target = Field(None), "target", AN_ID),
            (|e| e.label = Field(None), "label", A_LABEL),
            (|e| label_in(e).t = Field(None), "label.t", A_NUMBER),
            (
                |e| label_in(e).offset = Field(None),
                "label.offset",
                A_NUMBER,
            ),
            (|e| e.color = Field(None), "color", A_COLOR),
            (|e| e.dash = Field(None), "dash", A_DASH),
            (|e| e.arrow = Field(None), "arrow", AN_ARROW),
            (|e| e.source_side = Field(None), "sourceSide", A_SIDE),
            (|e| e.target_side = Field(None), "targetSide", A_SIDE),
        ];
        let mut cases: Vec<(OwnedEdgeColumns, GraphDataProblem)> = by_type
            .into_iter()
            .map(|(change, name, expected)| {
                let id = (name != "id").then(e);
                (d_and(change), field(name, id, expected))
            })
            .collect();
        cases.extend([
            // A string that names no arrowhead or side crosses as its code and is refused at its
            // place, a side outside the four naming the four.
            (
                d_and(|e| e.arrow = text("start")),
                field("arrow", Some(e()), AN_ARROW),
            ),
            (
                d_and(|e| e.source_side = text("middle")),
                field("sourceSide", Some(e()), A_SIDE),
            ),
            (
                d_and(|e| e.target_side = text("")),
                field("targetSide", Some(e()), A_SIDE),
            ),
            // The first of an edge's fields refused, in the order an edge is read, whether the
            // shell named it or its code names nothing.
            (
                d_and(|e| (e.target_side, e.arrow) = (Field(None), text("start"))),
                field("arrow", Some(e()), AN_ARROW),
            ),
            (
                d_and(|e| (e.source_side, e.color) = (text("middle"), Field(None))),
                field("color", Some(e()), A_COLOR),
            ),
            (
                d_and(|e| (e.target_side, e.source_side) = (text("up"), Field(None))),
                field("sourceSide", Some(e()), A_SIDE),
            ),
        ]);
        // An edge that is no object, refused as malformed as one that is no object was.
        let d = labelled("d");
        cases.push((
            OwnedEdgeColumns::of([Some(&d), None]),
            unshaped("an edge is no object"),
        ));
        for (columns, problem) in cases {
            assert_eq!(load_edges(&columns).err(), Some(problem));
        }
    }

    #[test]
    fn every_rule_of_an_edge_refuses_its_columns_with_its_kind_and_names() {
        // Verifies: ADR-0034
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

    #[test]
    fn the_first_value_refused_by_its_type_is_named_across_nodes_and_edges() {
        // Verifies: ADR-0034
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

    #[test]
    fn edge_columns_that_do_not_fit_together_are_refused_as_malformed() {
        // Verifies: ADR-0034
        let changes: [fn(&mut OwnedEdgeColumns); 14] = [
            |c| _ = c.color.pop(),
            // A presence or validity byte is 1 or 0.
            |c| c.has_label[1] = 2,
            |c| c.label_texts[0] = 2,
            |c| c.has_background[1] = u8::MAX,
            |c| c.has_dash[0] = 2,
            |c| _ = c.gap.pop(),
            |c| _ = c.has_dash.pop(),
            |c| _ = c.target_side.pop(),
            |c| _ = c.source_bounds.pop(),
            |c| c.target_bounds = vec![0, 2, 1],
            |c| c.labels.push("x".to_owned()),
            |c| c.arrow[0] = ArrowCode::Unnamed as u8 + 1,
            |c| c.source_side[1] = SideCode::Unnamed as u8 + 1,
            |c| c.refused = Some((2, EdgeField::Id)),
        ];
        for change in changes {
            let mut columns = d_and(|_| {});
            change(&mut columns);
            assert_eq!(load_edges(&columns).err(), Some(unfit_edges()));
        }
        // A source and a target are identifiers, never mapped inside a character.
        let mut columns = d_and(|_| {});
        columns.sources = vec!["\u{1F600}".to_owned()];
        columns.source_bounds = vec![0, 1, 2];
        assert_eq!(
            load_edges(&columns).err(),
            Some(malformed("an identifier ends inside a character"))
        );
        assert_eq!(edge_refused_of(Some(0), None), Err(unfit_edges()));
        assert_eq!(edge_refused_of(None, None), Ok(None));
        // Every field by its code, and a code no field has refused as malformed.
        for field in EdgeField::ALL {
            assert_eq!(
                edge_refused_of(Some(1), Some(field as u32)),
                Ok(Some((1, field)))
            );
        }
        for code in [12, 255, u32::MAX] {
            assert_eq!(edge_refused_of(Some(0), Some(code)), Err(unfit_edges()));
        }
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

    /// `values` as the pieces of a string column.
    fn pieces(values: &[&str]) -> Vec<String> {
        values.iter().map(|&value| value.to_owned()).collect()
    }

    #[test]
    fn pieces_that_miss_the_last_boundary_or_end_inside_a_value_are_refused_as_malformed() {
        // Verifies: ADR-0034
        // Nodes `ab` and `cd`, and edges `d` and `e` with label texts of 1 and 3 code units.
        let nodes = |ids: &[&str]| {
            let mut columns = cut("abcd", &[0, 2, 4], None);
            columns.ids = pieces(ids);
            columns
        };
        let edges = |labels: &[&str]| {
            let mut columns = d_and(|e| label_in(e).text_length = Some(3));
            columns.labels = pieces(labels);
            columns
        };
        let no_edges = OwnedEdgeColumns::of([]);
        let mut engine = crate::Engine::new();
        // Pieces that end where values end, an empty one among them, map piece by piece.
        for ids in [&["abcd"][..], &["ab", "cd"], &["ab", "", "cd"]] {
            assert_eq!(load_into(&mut engine, &nodes(ids), &no_edges), Ok(2));
        }
        assert_eq!(engine.positions_len(), 4);
        for labels in [&["xxxx"][..], &["x", "xxx"]] {
            assert!(load_edges(&edges(labels)).is_ok(), "{labels:?}");
        }
        // Lengths that sum short of the last boundary, or past it, or no piece at all.
        let short: [&[&str]; 3] = [&["ab"], &["ab", "cd", "x"], &[]];
        // A piece that ends inside a value, the lengths summing to the last boundary.
        let inside: [&[&str]; 3] = [&["a", "bcd"], &["abc", "d"], &["a", "b", "cd"]];
        for ids in short.into_iter().chain(inside) {
            let refused = load_into(&mut engine, &nodes(ids), &no_edges);
            assert_eq!(refused, Err(unfit()), "{ids:?}");
        }
        assert_eq!(load_edges(&edges(&["x"])).err(), Some(unfit_edges()));
        assert_eq!(load_edges(&edges(&["xx", "xx"])).err(), Some(unfit_edges()));
        // The engine keeps the graph it held, and takes the next load.
        assert_eq!(engine.positions_len(), 4);
        let one = OwnedColumns::of(batch(&[("a", 0.0, 0.0)], &[]).nodes.iter().map(Some));
        assert_eq!(load_into(&mut engine, &one, &no_edges), Ok(1));
        assert_eq!(engine.positions_len(), 2);
    }

    #[test]
    fn a_title_validity_byte_other_than_one_or_zero_is_refused_as_malformed() {
        // Verifies: ADR-0034
        for byte in [2, u8::MAX] {
            let mut columns = a_and(|_| {});
            columns.content.text_valid[1] = byte;
            assert_eq!(load_columns(&columns).err(), Some(unfit()));
        }
    }

    #[test]
    fn a_later_edge_refused_by_its_type_is_named_before_an_earlier_one_refused_by_a_rule() {
        // Verifies: ADR-0034
        // Edge `d`'s label text holds a lone surrogate, which the snapshot hands over as no text
        // and its rule refuses; edge `e`'s colour is of another type, which the first pass
        // refuses, before any rule.
        let mut d = labelled("d");
        label_in(&mut d).text_length = None;
        let mut e = labelled("e");
        e.color = Field(None);
        assert_eq!(
            load_edges(&OwnedEdgeColumns::of([Some(&d), Some(&e)])).err(),
            Some(GraphDataProblem::InvalidField {
                list: GraphList::Edges,
                index: 1,
                id: Some("e".into()),
                field: "color".into(),
                expected: A_COLOR.into(),
            })
        );
        e.color = f64::from(0x12_3456).into();
        assert_eq!(
            load_edges(&OwnedEdgeColumns::of([Some(&d), Some(&e)])).err(),
            Some(GraphDataProblem::InvalidLabelText { edge: "d".into() })
        );
    }
}
