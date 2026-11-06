//! The edits of an edge and the patch of a node: an edge `addEdge` adds, checked as a load checks
//! one, a patch of `updateEdge` checked as a load checks those fields, and a patch of
//! `updateNode`, whose content is checked as a load checks a node's.

use std::fmt;

use comb_engine::content::Fonts;
use comb_engine::geometry::Sides;
use comb_engine::graph::{AddEdgeError, Graph, SlotError};
use comb_engine::shape::NodeShape;
use serde::de::{self, IgnoredAny, Visitor};
use serde::{Deserialize, Deserializer};
use tsify::Tsify;

use super::checks::{color_of, dash_of, edge_ids_of, label_placement, spec_of};
use super::item::{Item, content_of, edge_of, label_of};
use super::load::checked_content;
use super::{
    Arrow, Checked, ContentInput, Dock, EdgeField, EdgeInput, Field, GraphDataProblem, GraphList,
    LabelInput, Pair, check_graph_size, utf16_length,
};

/// Why an edit of an edge was refused: its data, which the host application handed over, or a
/// slot that holds nothing, which is the shell's mistake (ADR-0023), and crosses as `SlotError`
/// as from the removals, `edgesAt`, `setLabelSize`, and `moveLabel`.
#[derive(Debug, PartialEq)]
pub enum EdgeRefusal {
    Data(GraphDataProblem),
    Slot(SlotError),
}

impl From<GraphDataProblem> for EdgeRefusal {
    fn from(problem: GraphDataProblem) -> Self {
        Self::Data(problem)
    }
}

impl From<SlotError> for EdgeRefusal {
    fn from(error: SlotError) -> Self {
        Self::Slot(error)
    }
}

/// An edge the engine did not add: an end that holds no node is the shell's mistake, and a slot
/// past those the engine numbers a refusal of the graph's size, as for a node.
impl From<AddEdgeError> for EdgeRefusal {
    fn from(error: AddEdgeError) -> Self {
        match error {
            AddEdgeError::Slot(error) => Self::Slot(error),
            AddEdgeError::TooManySlots(error) => Self::Data(error.into()),
        }
    }
}

/// Checks the edge `addEdge` hands over as a load checks an edge, the only one of its batch at
/// index 0, and refuses one from a node to itself unless `loops` allows loops (ADR-0031) and one
/// past `MAX_ITEMS` edges in use; adds it to `graph` between the node slots `source` and
/// `target`, which `api` resolved against the map only it keeps, and returns the slot the engine
/// chose. That the graph holds no edge of its identifier and holds its ends is `api`'s to check
/// (ADR-0009); a slot of an end that holds no node is the shell's mistake. A refused edge leaves
/// the graph as it was.
pub(crate) fn add_edge_to(
    graph: &mut Graph,
    edge: &EdgeInput,
    source: u32,
    target: u32,
    loops: bool,
) -> Result<u32, EdgeRefusal> {
    check_graph_size(0.0, f64::from(graph.edges_in_use()) + 1.0)?;
    let edge = edge_of(0, edge)?;
    let lengths = [edge.id, edge.source, edge.target].map(utf16_length);
    edge_ids_of(0, lengths)?;
    if edge.source == edge.target && !loops {
        return Err(GraphDataProblem::SelfEdge {
            edge: edge.id.to_owned(),
        }
        .into());
    }
    let spec = spec_of(&edge, source, target)?;
    Ok(graph.add_edge(spec)?)
}

/// The fields a patch of `updateEdge` may hold, each as the host application handed it over:
/// `None` where the patch does not name it, and `dash` and `label` `Some(Field(Some(None)))`
/// where it clears them with `null`. Read from a plain object alone, as `NodePatch` is; the first
/// other field is kept by name, and the fields after it are passed over unread.
#[derive(Tsify, Default)]
#[tsify(
    type = "{ color?: number; dash?: [number, number] | null; arrow?: Arrow; \
                 label?: LabelInput | null; sourceSide?: Dock; targetSide?: Dock }"
)]
pub struct EdgePatch {
    color: Option<Field<f64>>,
    dash: Option<Field<Option<Pair>>>,
    arrow: Option<Field<Arrow>>,
    label: Option<Field<Option<LabelInput>>>,
    source_side: Option<Field<Dock>>,
    target_side: Option<Field<Dock>>,
    other: Option<String>,
}

impl<'de> Deserialize<'de> for EdgePatch {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(EdgePatchVisitor)
    }
}

struct EdgePatchVisitor;

impl<'de> Visitor<'de> for EdgePatchVisitor {
    type Value = EdgePatch;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("an object")
    }

    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<EdgePatch, A::Error> {
        let mut patch = EdgePatch::default();
        while let Some(field) = map.next_key::<String>()? {
            match field.as_str() {
                "color" => patch.color = Some(map.next_value()?),
                "dash" => patch.dash = Some(map.next_value()?),
                "arrow" => patch.arrow = Some(map.next_value()?),
                "label" => patch.label = Some(map.next_value()?),
                "sourceSide" => patch.source_side = Some(map.next_value()?),
                "targetSide" => patch.target_side = Some(map.next_value()?),
                _ => {
                    map.next_value::<IgnoredAny>()?;
                    while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                    patch.other = Some(field);
                    break;
                }
            }
        }
        Ok(patch)
    }
}

/// Checks a patch of the edge `id` in `slot` as a load checks those fields, and gives the edge the
/// patched label placement and style; the store merges the rest, which the engine does not keep.
/// The first offending field refuses the patch, and nothing changes; a slot that holds no edge is
/// the shell's mistake.
pub(crate) fn update_edge_in(
    graph: &mut Graph,
    slot: u32,
    id: &str,
    patch: EdgePatch,
) -> Result<(), EdgeRefusal> {
    if let Some(field) = patch.other {
        return Err(GraphDataProblem::UnknownEdgePatchField {
            edge: id.to_owned(),
            field,
        }
        .into());
    }
    let current = graph.edge(slot).ok_or(SlotError::NoEdge { slot })?;
    // Every field's type first, then their values, in the order a load reads and checks them.
    let mut item = Item::new(GraphList::Edges, 0);
    item.id = Some(id);
    let label = patch
        .label
        .map(|label| label_of(&item, label))
        .transpose()?;
    let color = patch
        .color
        .map(|color| item.edge(EdgeField::Color, color))
        .transpose()?;
    let dash = patch
        .dash
        .map(|dash| item.edge(EdgeField::Dash, dash))
        .transpose()?;
    let arrow = patch
        .arrow
        .map(|arrow| item.edge(EdgeField::Arrow, arrow))
        .transpose()?;
    let source_side = patch
        .source_side
        .map(|side| item.edge(EdgeField::SourceSide, side))
        .transpose()?;
    let target_side = patch
        .target_side
        .map(|side| item.edge(EdgeField::TargetSide, side))
        .transpose()?;
    let label = match label {
        None => current.label,
        Some(label) => label.map(|l| label_placement(id, &l)).transpose()?,
    };
    let mut style = current.style;
    if let Some(color) = color {
        style.color = color_of(id, color)?;
    }
    if let Some(dash) = dash {
        style.dash = dash.map(|Pair(dash)| dash_of(id, dash)).transpose()?;
    }
    if let Some(arrow) = arrow {
        style.arrow = arrow == Arrow::End;
    }
    let sides = Sides {
        source: source_side.map_or(current.sides.source, Into::into),
        target: target_side.map_or(current.sides.target, Into::into),
    };
    Ok(graph.update_edge(slot, label, style, sides)?)
}

/// The attributes `updateNode` changes on a node, by name: only its content, which it replaces
/// whole (ADR-0013). Read from a plain object alone: `api` hands over a copy of a plain object's
/// fields up to the first other than `content`, its content as plain data; a patch that is no
/// plain object, a `Map` or an array among them, or that has a key that is no string, `api` cannot
/// read, and refuses as malformed before it reaches the bridge. No value of the host application,
/// and none of its code, reaches the bridge.
#[derive(Tsify)]
#[tsify(type = "{ content?: NodeContent }")]
pub struct NodePatch(pub Vec<(String, Field<ContentInput>)>);

impl<'de> Deserialize<'de> for NodePatch {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(PatchVisitor)
    }
}

struct PatchVisitor;

impl<'de> Visitor<'de> for PatchVisitor {
    type Value = NodePatch;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("an object")
    }

    /// Keeps the fields up to the first other than `content`, which is refused, and passes over
    /// the rest unread, so that a patch of many fields costs no copy of them.
    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<NodePatch, A::Error> {
        let mut fields = Vec::new();
        while let Some(field) = map.next_key::<String>()? {
            let other = field != "content";
            if other {
                map.next_value::<IgnoredAny>()?;
                fields.push((field, Field(None)));
                while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                break;
            }
            fields.push((field, map.next_value()?));
        }
        Ok(NodePatch(fields))
    }
}

/// Checks a patch of the node `node`, of the node shape and width of `shaped`, and returns the
/// content it sets, checked as a load checks a node's at index 0, its strings counted against the
/// budget on from `held`, the code units of content the graph holds besides the node's, and the
/// height the node lays out to in `fonts` with it, or none where it sets none; or names its first
/// offending field.
pub(crate) fn patch_of(
    node: &str,
    shaped: (NodeShape, f32),
    patch: &NodePatch,
    fonts: &Fonts,
    held: u64,
) -> Result<Option<(Checked, f32)>, GraphDataProblem> {
    let mut checked = None;
    for (field, value) in &patch.0 {
        if field != "content" {
            return Err(GraphDataProblem::UnknownPatchField {
                node: node.to_owned(),
                field: field.clone(),
            });
        }
        let mut item = Item::new(GraphList::Nodes, 0);
        item.id = Some(node);
        let content = content_of(&item, value.0.as_ref())?;
        checked = Some(checked_content(node, shaped, content, fonts, held)?);
    }
    Ok(checked)
}

// The malformed-data tests of graph data verify ADR-0010 (see `graph_data::tests`).
// Verifies: ADR-0010
#[cfg(test)]
mod tests {
    use super::super::tests::{content, invalid_text, titled};
    use super::super::{KindCode, MAX_TEXT, RECTANGLE, RoleCode};
    use super::*;
    use comb_engine::graph::TooManySlots;

    #[test]
    fn a_patch_with_another_field_or_a_title_not_text_names_its_node() {
        let patch = |entries: Vec<(&str, Field<ContentInput>)>| {
            let fields = entries.into_iter().map(|(k, v)| (k.to_owned(), v));
            patch_of(
                "a",
                RECTANGLE,
                &NodePatch(fields.collect()),
                &Fonts::default(),
                0,
            )
            .map(|checked| checked.map(|(content, height)| (content.text(0).to_owned(), height)))
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
    fn an_edge_the_engine_cannot_number_is_refused_as_a_node_it_cannot_number() {
        // Verifies: ADR-0023
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
}
