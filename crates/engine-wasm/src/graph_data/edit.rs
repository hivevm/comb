//! The edits of an edge and the patch of a node: an edge `addEdge` adds, checked as a load checks
//! one, a patch of `updateEdge` checked as a load checks those fields, and a patch of
//! `updateNode`, whose content is checked as a load checks a node's.

use std::fmt;

use comb_engine::content::Fonts;
use comb_engine::geometry::{self as graph_side, Sides};
use std::collections::HashSet;

use comb_engine::graph::{AddEdgeError, Axis, End, Graph, SlotError};
use comb_engine::shape::{self, NodeShape};
use serde::de::{self, IgnoredAny, Visitor};
use serde::{Deserialize, Deserializer};
use tsify::Tsify;

use super::checks::{
    arrowhead_of, color_of, dash_of, edge_end_field, edge_ids_of, given_height, label_ids_of,
    label_placements, outline_of, spec_of,
};
use super::edge_columns::IdLengths;
use super::item::{EndRead, Item, content_of, edge_of, labels_of};
use super::load::checked_content;
use super::problem::{A_BORDER_SIDE, A_FLAG, A_HEIGHT, A_NUMBER, AN_OUTLINE};
use super::regions::{Divide, RegionInput};
use super::{
    Arrow, Checked, ContentInput, Dock, EdgeField, EdgeInput, Field, GraphDataProblem, GraphList,
    LabelInput, Outline, Pair, Region, Side, check_graph_size, check_regions, regions_of,
    utf16_length,
};

/// Why an edit of an edge was refused: its data, which the host application handed over, or a
/// slot that holds nothing, which is the shell's mistake (ARCH-engine-edits-graph-in-place), and
/// crosses as `SlotError` as from the removals, `edgesAt`, `setLabelSize`, and `moveLabel`.
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

/// Why the engine did not add the edge `edge`: an end that holds no node or no edge is the shell's
/// mistake, an end on an edge that itself ends on an edge is refused as `invalidEdgeEnd` naming the
/// edge and the end (API-edges-dock-nodes-or-edges, *Ends*), and a slot past those the engine
/// numbers is a refusal of the graph's size, as for a node.
fn not_added(edge: &str, error: AddEdgeError) -> EdgeRefusal {
    match error {
        AddEdgeError::Slot(error) => EdgeRefusal::Slot(error),
        AddEdgeError::OnEdgeEnd(which) => EdgeRefusal::Data(GraphDataProblem::InvalidEdgeEnd {
            edge: edge.to_owned(),
            end: edge_end_field(which).to_owned(),
        }),
        AddEdgeError::TooManySlots(error) => EdgeRefusal::Data(error.into()),
    }
}

/// Checks the edge `addEdge` hands over as a load checks an edge, the only one of its batch at
/// index 0, and refuses one from a node to itself unless `loops` allows loops
/// (API-edges-dock-side-or-outline) and one past `MAX_ITEMS` edges in use; adds it to `graph`
/// between the slots `source` and `target`, each of a node or, where its end names an edge, of an
/// edge, which `api` resolved against the maps only it keeps, and returns the slot the engine
/// chose. An end on an edge that itself ends on an edge is refused as `invalidEdgeEnd`
/// (API-edges-dock-nodes-or-edges, *Ends*). That the graph holds no edge of its identifier and
/// holds its ends is `api`'s to check (ARCH-one-workspace-per-example); a slot of an end that holds
/// no node, or no edge, is the shell's mistake. A refused edge leaves the graph as it was.
pub(crate) fn add_edge_to(
    graph: &mut Graph,
    edge: &EdgeInput,
    source: u32,
    target: u32,
    loops: bool,
) -> Result<u32, EdgeRefusal> {
    check_graph_size(0.0, f64::from(graph.edges_in_use()) + 1.0)?;
    let edge = edge_of(0, edge)?;
    let named = IdLengths {
        lengths: [edge.id, edge.source.id(), edge.target.id()].map(utf16_length),
        on_edge: [edge.source, edge.target].map(|end| matches!(end, EndRead::Edge { .. })),
    };
    edge_ids_of(
        0,
        named,
        edge.labels.iter().map(|label| utf16_length(label.id)),
    )?;
    let end = |read: EndRead, slot: u32| match read {
        EndRead::Node { .. } => End::Node(slot),
        EndRead::Edge { t, .. } => End::Edge { slot, t },
    };
    let (source, target) = (end(edge.source, source), end(edge.target, target));
    if matches!((source, target), (End::Node(s), End::Node(t)) if s == t) && !loops {
        return Err(GraphDataProblem::SelfEdge {
            edge: edge.id.to_owned(),
        }
        .into());
    }
    let spec = spec_of(&edge, source, target)?;
    graph
        .add_edge(spec)
        .map_err(|error| not_added(edge.id, error))
}

/// The fields a patch of `updateEdge` may hold, each as the host application handed it over:
/// `None` where the patch does not name it, and `dash` and `labels` `Some(Field(Some(None)))`
/// where it clears them with `null`. Read from a plain object alone, as `NodePatch` is; the first
/// other field, `label` among them, is kept by name, and the fields after it are passed over
/// unread. `labels` replaces the edge's whole list (API-edges-dock-nodes-or-edges).
#[derive(Tsify, Default)]
#[tsify(
    type = "{ color?: number; dash?: [number, number] | null; arrow?: Arrow; \
                 labels?: LabelInput[] | null; lightning?: boolean; sourceSide?: Dock; \
                 targetSide?: Dock }"
)]
pub struct EdgePatch {
    color: Option<Field<f64>>,
    dash: Option<Field<Option<Pair>>>,
    arrow: Option<Field<Arrow>>,
    labels: Option<Field<Option<Vec<Field<LabelInput>>>>>,
    lightning: Option<Field<Option<bool>>>,
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
                "labels" => patch.labels = Some(map.next_value()?),
                "lightning" => patch.lightning = Some(map.next_value()?),
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
/// patched label placements, the whole list, and style; the store merges the rest, which the engine
/// does not keep. The first offending field refuses the patch, and nothing changes; a slot that
/// holds no edge is the shell's mistake.
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
    // A side beside an end on an edge is refused as a side of another type is
    // (API-edges-dock-nodes-or-edges, *Ends*).
    let on_edge = [current.source, current.target].map(|end| end.edge().is_some());
    // Every field's type first, then their values, in the order a load reads and checks them.
    let mut item = Item::new(GraphList::Edges, 0);
    item.id = Some(id);
    let labels = patch
        .labels
        .as_ref()
        .map(|labels| labels_of(&item, labels))
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
    let lightning = patch
        .lightning
        .map(|lightning| item.edge(EdgeField::Lightning, lightning))
        .transpose()?;
    let side = |field, side: Field<Dock>, on_edge: bool| {
        item.edge(field, Field(side.0.filter(|_| !on_edge)))
    };
    let source_side = patch
        .source_side
        .map(|s| side(EdgeField::SourceSide, s, on_edge[0]))
        .transpose()?;
    let target_side = patch
        .target_side
        .map(|s| side(EdgeField::TargetSide, s, on_edge[1]))
        .transpose()?;
    let labels = match labels {
        None => current.labels.clone(),
        Some(labels) => {
            label_ids_of(0, labels.iter().map(|label| utf16_length(label.id)))?;
            label_placements(id, &labels)?
        }
    };
    let mut style = current.style;
    if let Some(color) = color {
        style.color = color_of(id, color)?;
    }
    if let Some(dash) = dash {
        style.dash = dash.map(|Pair(dash)| dash_of(id, dash)).transpose()?;
    }
    if let Some(arrow) = arrow {
        style.arrow = arrowhead_of(arrow);
    }
    if let Some(lightning) = lightning {
        style.lightning = lightning.unwrap_or(false);
    }
    let sides = Sides {
        source: source_side.map_or(current.sides.source, Into::into),
        target: target_side.map_or(current.sides.target, Into::into),
    };
    Ok(graph.update_edge(slot, labels, style, sides)?)
}

/// The attributes `updateNode` changes on a node, by name: its content, which it replaces whole
/// (REN-node-content-in-rows), its height, whether it is resizable
/// (API-edits-report-nested-changes), and how its outline is drawn (REN-node-shapes-cover-uml).
/// Read from a plain object alone: `api` hands over a copy of a plain object's fields up to the
/// first it does not know, its content as plain data; a patch that is no plain object, a `Map` or
/// an array among them, or that has a key that is no string, `api` cannot read, and refuses as
/// malformed before it reaches the bridge. No value of the host application, and none of its code,
/// reaches the bridge.
#[derive(Tsify)]
#[tsify(
    type = "{ content?: NodeContent; height?: number; resizable?: boolean; divide?: Divide; \
                 regions?: RegionInput[]; side?: Side; offset?: number; outline?: Outline }"
)]
pub struct NodePatch(pub Vec<(String, PatchValue)>);

/// A value of a field of `NodePatch`, read as the field its name says, or none for a name it
/// does not know, which `patch_of` refuses.
#[derive(Debug)]
pub enum PatchValue {
    Content(Box<Field<ContentInput>>),
    Height(Field<f64>),
    Resizable(Field<bool>),
    Divide(Field<Option<Divide>>),
    Regions(Field<Option<Vec<RegionInput>>>),
    /// A border node's side and offset (ARCH-border-nodes-ride-sides).
    Side(Field<Side>),
    Offset(Field<f64>),
    /// How the node's outline is drawn (REN-node-shapes-cover-uml, *Outline*).
    Outline(Field<Outline>),
    Other,
}

impl From<Field<ContentInput>> for PatchValue {
    fn from(content: Field<ContentInput>) -> Self {
        Self::Content(Box::new(content))
    }
}

impl From<ContentInput> for PatchValue {
    fn from(content: ContentInput) -> Self {
        Self::Content(Box::new(Field(Some(content))))
    }
}

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

    /// Keeps the fields up to the first it does not know, which is refused, and passes over the
    /// rest unread, so that a patch of many fields costs no copy of them.
    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<NodePatch, A::Error> {
        let mut fields = Vec::new();
        while let Some(field) = map.next_key::<String>()? {
            let value = match field.as_str() {
                "content" => PatchValue::Content(Box::new(map.next_value()?)),
                "height" => PatchValue::Height(map.next_value()?),
                "resizable" => PatchValue::Resizable(map.next_value()?),
                "divide" => PatchValue::Divide(map.next_value()?),
                "regions" => PatchValue::Regions(map.next_value()?),
                "side" => PatchValue::Side(map.next_value()?),
                "offset" => PatchValue::Offset(map.next_value()?),
                "outline" => PatchValue::Outline(map.next_value()?),
                _ => {
                    map.next_value::<IgnoredAny>()?;
                    fields.push((field, PatchValue::Other));
                    while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
                    break;
                }
            };
            fields.push((field, value));
        }
        Ok(NodePatch(fields))
    }
}

/// What a patch of `updateNode` sets, checked: the content, with the height it lays out to in a
/// rectangle and its number of rows; the height the node is given, as the engine keeps it; and
/// whether it is resizable; each none where the patch sets none.
#[derive(Default)]
pub(crate) struct Patched {
    pub content: Option<(Checked, (f64, usize))>,
    pub height: Option<f32>,
    pub resizable: Option<bool>,
    /// The regions the patch divides the node into, and their direction, in place of those it
    /// has (ARCH-regions-are-container-slots, *Removing a region*).
    pub regions: Option<(Option<Axis>, Vec<Region>)>,
    /// A border node's new side and offset, each none where the patch keeps it
    /// (ARCH-border-nodes-ride-sides).
    pub side: Option<graph_side::Side>,
    pub offset: Option<f64>,
    /// How the node's outline is to be drawn, none where the patch keeps it.
    pub outline: Option<shape::Outline>,
}

impl Patched {
    /// Whether the patch set nothing.
    pub(crate) const fn is_empty(&self) -> bool {
        self.content.is_none()
            && self.height.is_none()
            && self.resizable.is_none()
            && self.regions.is_none()
            && self.side.is_none()
            && self.offset.is_none()
            && self.outline.is_none()
    }
}

/// Checks a patch of the node `node`, of the node shape `shape`, and returns what it sets: its
/// content checked as a load checks a node's at index 0, its strings counted against the budget
/// on from `held`, the code units of content the graph holds besides the node's, laid out in
/// `fonts`; its height as a load checks a node's; whether the node is resizable; and its regions
/// as a load checks a node's, divided as the patch says or, where it says nothing of that, as
/// `current`; or names its first offending field.
pub(crate) fn patch_of(
    node: &str,
    (shape, bordered): (NodeShape, bool),
    current: Option<Axis>,
    patch: &NodePatch,
    fonts: &Fonts,
    held: u64,
) -> Result<Patched, GraphDataProblem> {
    let mut patched = Patched::default();
    let mut item = Item::new(GraphList::Nodes, 0);
    item.id = Some(node);
    let (mut divide, mut regions) = (None, None);
    for (field, value) in &patch.0 {
        match value {
            PatchValue::Content(value) => {
                let content = content_of(&item, value.0.as_ref())?;
                patched.content = Some(checked_content(node, shape, content, fonts, held)?);
            }
            PatchValue::Height(value) => {
                let height = item.read("height", *value, A_HEIGHT)?;
                patched.height = given_height(node, Some(height))?;
            }
            PatchValue::Resizable(value) => {
                let resizable = item.read("resizable", *value, A_FLAG)?;
                if resizable && bordered {
                    return Err(attachment(node, "resizable"));
                }
                patched.resizable = Some(resizable);
            }
            // Only a border node has a side and an offset.
            PatchValue::Side(value) if bordered => {
                patched.side = Some(item.read("side", *value, A_BORDER_SIDE)?.into());
            }
            PatchValue::Offset(value) if bordered => {
                let offset = item.read("offset", *value, A_NUMBER)?;
                if !offset.is_finite() {
                    return Err(GraphDataProblem::NonFiniteCoordinate {
                        node: node.to_owned(),
                    });
                }
                patched.offset = Some(offset);
            }
            PatchValue::Outline(value) => {
                let outline = item.read("outline", *value, AN_OUTLINE)?;
                patched.outline = Some(outline_of(node, 0, outline)?);
            }
            PatchValue::Divide(value) => divide = Some(value),
            PatchValue::Regions(value) => regions = Some(value),
            // A node that is no border node has neither (ARCH-border-nodes-ride-sides).
            PatchValue::Side(_) | PatchValue::Offset(_) => return Err(attachment(node, field)),
            PatchValue::Other => {
                return Err(GraphDataProblem::UnknownPatchField {
                    node: node.to_owned(),
                    field: field.clone(),
                });
            }
        }
    }
    // The regions of a patch replace the node's, divided as the patch says or as the node is; a
    // division without regions divides it into none.
    // An empty list is no regions, as a load reads it.
    if bordered && regions.is_some_and(|r| matches!(&r.0, Some(Some(list)) if !list.is_empty())) {
        return Err(attachment(node, "regions"));
    }
    if divide.is_some() || regions.is_some() {
        let none = Field(Some(None));
        let divide = divide.map_or(Field(Some(current.map(Divide::from))), |d| *d);
        let (axis, list) = regions_of(node, 0, &divide, regions.unwrap_or(&none))?;
        let mut taken = HashSet::from([node.to_owned()]);
        check_regions(node, 0, axis, &list, &mut taken)?;
        patched.regions = Some((axis, list));
    }
    Ok(patched)
}

/// The refusal of the border node `node` by its field `field` (ARCH-border-nodes-ride-sides).
fn attachment(node: &str, field: &str) -> GraphDataProblem {
    GraphDataProblem::InvalidAttachment {
        node: node.to_owned(),
        field: field.to_owned(),
    }
}

// The malformed-data tests of graph data verify API-bridge-takes-serde-and-columns (see
// `graph_data::tests`). Verifies: API-bridge-takes-serde-and-columns
#[cfg(test)]
mod tests {
    use super::super::tests::{content, invalid_text, titled};
    use super::super::{KindCode, MAX_TEXT, RECTANGLE, RoleCode};
    use super::*;
    use comb_engine::graph::TooManySlots;

    #[test]
    fn a_stale_label_twice_an_identifier_and_nine_labels_are_refused_in_a_load_addedge_and_a_patch()
    {
        // Verifies: API-edges-dock-nodes-or-edges, Q-7
        use super::super::graph_of;
        use super::super::tests::{batch, label_named, load_edges};
        use super::super::{EdgeCells, OwnedEdgeColumns};
        let edge = |change: &dyn Fn(&mut EdgeInput)| {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
            change(&mut data.edges[0]);
            data
        };
        let labels =
            |ids: &[&str]| Field(Some(Some(ids.iter().map(|id| label_named(id)).collect())));
        let field = |field: &str, expected: &str| GraphDataProblem::InvalidField {
            list: GraphList::Edges,
            index: 0,
            id: Some("e".into()),
            field: field.into(),
            expected: expected.into(),
        };
        let nine: Vec<String> = (0..9).map(|i| format!("l{i}")).collect();
        let nine: Vec<&str> = nine.iter().map(String::as_str).collect();
        type Change<'a> = &'a dyn Fn(&mut EdgeInput);
        type Problem<'a> = &'a dyn Fn() -> GraphDataProblem;
        let cases: [(Change, Problem); 3] = [
            (&|e| e.label = true, &|| {
                field("label", super::super::problem::NO_LABEL)
            }),
            (&|e| e.labels = labels(&["m", "n", "m"]), &|| {
                GraphDataProblem::DuplicateLabel {
                    edge: "e".into(),
                    label: "m".into(),
                }
            }),
            (&|e| e.labels = labels(&nine), &|| {
                GraphDataProblem::TooManyLabels {
                    edge: "e".into(),
                    limit: 8,
                }
            }),
        ];
        for (change, problem) in cases {
            let data = edge(change);
            // A load, through the columns the snapshot builds, and through the batch.
            let columns = OwnedEdgeColumns::of([Some(&EdgeCells::from(&data.edges[0]))]);
            assert_eq!(load_edges(&columns).err(), Some(problem()));
            assert_eq!(graph_of(&data).err(), Some(problem()));
            // `addEdge`, which leaves the graph as it was.
            let mut graph = graph_of(&edge(&|_| {})).unwrap();
            let added = add_edge_to(&mut graph, &data.edges[0], 0, 1, false);
            assert_eq!(added, Err(EdgeRefusal::Data(problem())));
            assert_eq!(graph.edges_in_use(), 1);
        }
    }

    /// Nodes `a` and `b`, edge `d` from `a` to `b`, and edge `e` from `a` to `b` made by `change`.
    fn d_and_e(change: &dyn Fn(&mut EdgeInput)) -> super::super::GraphBatch {
        use super::super::tests::batch;
        let mut data = batch(
            &[("a", 0.0, 0.0), ("b", 300.0, 0.0)],
            &[("d", "a", "b"), ("e", "a", "b")],
        );
        change(&mut data.edges[1]);
        data
    }

    /// `edge`'s target moved onto the middle of edge `d`, without a side.
    fn onto_d(edge: &mut EdgeInput) {
        edge.target = Field::absent();
        edge.target_edge = "d".to_owned().into();
        edge.target_t = 0.5.into();
        edge.target_side = Field::absent();
    }

    #[test]
    fn an_end_naming_a_node_and_an_edge_neither_a_parameter_off_0_to_1_or_a_side_against_it_is_refused()
     {
        // Verifies: API-edges-dock-nodes-or-edges, API-bridge-columns-carry-nesting, Q-7
        // Each refused by its field, in a load through the columns the snapshot builds and through
        // the batch, and by `addEdge`, which leaves the graph as it was.
        use super::super::graph_of;
        use super::super::problem::{A_PARAMETER, A_SIDE, AN_EDGE_ID, AN_ID};
        use super::super::tests::load_edges;
        use super::super::{EdgeCells, OwnedEdgeColumns};
        let field = |index: u32, field: &str, expected: &str| GraphDataProblem::InvalidField {
            list: GraphList::Edges,
            index,
            id: Some("e".into()),
            field: field.into(),
            expected: expected.into(),
        };
        type Change<'a> = &'a dyn Fn(&mut EdgeInput);
        let cases: [(Change, &str, &str); 9] = [
            (
                &|e| (onto_d(e), e.target = "b".to_owned().into()).1,
                "targetEdge",
                AN_EDGE_ID,
            ),
            (&|e| e.target = Field::absent(), "target", AN_ID),
            (
                &|e| (onto_d(e), e.target_edge = Field(None)).1,
                "targetEdge",
                AN_EDGE_ID,
            ),
            (
                &|e| (onto_d(e), e.target_t = Field::absent()).1,
                "targetT",
                A_PARAMETER,
            ),
            (
                &|e| (onto_d(e), e.target_t = 1.5.into()).1,
                "targetT",
                A_PARAMETER,
            ),
            (
                &|e| (onto_d(e), e.target_t = f64::NAN.into()).1,
                "targetT",
                A_PARAMETER,
            ),
            (
                &|e| (onto_d(e), e.target_side = Dock::Left.into()).1,
                "targetSide",
                A_SIDE,
            ),
            (&|e| e.source_side = Field::absent(), "sourceSide", A_SIDE),
            // The source's fields before the target's.
            (
                &|e| {
                    onto_d(e);
                    e.target_t = (-0.25).into();
                    e.source_edge = "d".to_owned().into();
                },
                "sourceEdge",
                AN_EDGE_ID,
            ),
        ];
        for (change, name, expected) in cases {
            let data = d_and_e(change);
            let cells: Vec<EdgeCells> = data.edges.iter().map(EdgeCells::from).collect();
            let columns = OwnedEdgeColumns::of(cells.iter().map(Some));
            assert_eq!(load_edges(&columns).err(), Some(field(1, name, expected)));
            assert_eq!(graph_of(&data).err(), Some(field(1, name, expected)));
            let mut graph = graph_of(&d_and_e(&|_| {})).unwrap();
            let added = add_edge_to(&mut graph, &data.edges[1], 0, 0, false);
            let problem = field(0, name, expected);
            assert_eq!(added, Err(EdgeRefusal::Data(problem)), "{name}");
            assert_eq!(graph.edges_in_use(), 2);
        }
        // Onto the middle of `d`, it loads and is added, its target on edge `d`.
        let data = d_and_e(&onto_d);
        let on_d = End::Edge { slot: 0, t: 0.5 };
        assert_eq!(graph_of(&data).unwrap().edge(1).unwrap().target, on_d);
        let mut graph = graph_of(&d_and_e(&|_| {})).unwrap();
        let added = add_edge_to(&mut graph, &data.edges[1], 0, 0, false).unwrap();
        assert_eq!(graph.edge(added).unwrap().target, on_d);
    }

    #[test]
    fn an_end_on_a_later_edge_loads_and_one_on_a_missing_edge_itself_or_an_edge_on_an_edge_is_refused()
     {
        // Verifies: API-edges-dock-nodes-or-edges, Q-7
        use super::super::graph_of;
        use super::super::tests::batch;
        let three = |ends: [(&str, Option<&str>); 3]| {
            let mut data = batch(
                &[("a", 0.0, 0.0), ("b", 300.0, 0.0)],
                &[("d", "a", "b"), ("e", "a", "b"), ("f", "a", "b")],
            );
            for (edge, (node, on)) in data.edges.iter_mut().zip(ends) {
                if let Some(on) = on {
                    edge.source = Field::absent();
                    edge.source_edge = on.to_owned().into();
                    edge.source_t = 0.25.into();
                    edge.source_side = Field::absent();
                } else {
                    edge.source = node.to_owned().into();
                }
            }
            data
        };
        let invalid = |edge: &str| GraphDataProblem::InvalidEdgeEnd {
            edge: edge.into(),
            end: "sourceEdge".into(),
        };
        let (a, z) = (("a", None), ("z", None));
        // `d` ends on `f`, later in the list.
        let graph = graph_of(&three([("", Some("f")), a, a])).unwrap();
        assert_eq!(
            graph.edge(0).unwrap().source,
            End::Edge { slot: 2, t: 0.25 }
        );
        // An edge whose two ends both lie on one other edge is no cycle, and loads (the human's
        // reading of "on one of its own ends", 2026-11-19).
        let mut both = three([a, ("", Some("d")), a]);
        let edge = &mut both.edges[1];
        edge.target = Field::absent();
        edge.target_edge = "d".to_owned().into();
        edge.target_t = 0.75.into();
        edge.target_side = Field::absent();
        let graph = graph_of(&both).unwrap();
        let spec = graph.edge(1).unwrap();
        assert_eq!(
            (spec.source, spec.target),
            (
                End::Edge { slot: 0, t: 0.25 },
                End::Edge { slot: 0, t: 0.75 }
            )
        );
        let cases = [
            (
                [a, ("", Some("y")), a],
                GraphDataProblem::MissingEdge {
                    edge: "e".into(),
                    missing: "y".into(),
                },
            ),
            // A missing node is named in the order of the edges, before any end on an edge.
            (
                [("", Some("y")), a, z],
                GraphDataProblem::MissingNode {
                    edge: Some("f".into()),
                    border_node: None,
                    node: "z".into(),
                },
            ),
            ([a, ("", Some("e")), a], invalid("e")),
            ([a, ("", Some("d")), ("", Some("e"))], invalid("f")),
            ([("", Some("e")), ("", Some("d")), a], invalid("d")),
        ];
        for (ends, problem) in cases {
            assert_eq!(graph_of(&three(ends)).err(), Some(problem));
        }
        // `addEdge` of an edge onto `e`, which ends on `d`.
        let mut graph = graph_of(&three([a, ("", Some("d")), a])).unwrap();
        let data = d_and_e(&onto_d);
        let added = add_edge_to(&mut graph, &data.edges[1], 0, 1, false);
        let problem = GraphDataProblem::InvalidEdgeEnd {
            edge: "e".into(),
            end: "targetEdge".into(),
        };
        assert_eq!(added, Err(EdgeRefusal::Data(problem)));
        assert_eq!(graph.edges_in_use(), 3);
        // Onto a slot that holds no edge: the shell's mistake.
        let added = add_edge_to(&mut graph, &data.edges[1], 0, 7, false);
        assert_eq!(added, Err(EdgeRefusal::Slot(SlotError::NoEdge { slot: 7 })));
    }

    #[test]
    fn a_patch_that_gives_a_side_to_an_end_on_an_edge_is_refused_by_its_field() {
        // Verifies: API-edges-dock-nodes-or-edges
        use super::super::graph_of;
        use super::super::problem::A_SIDE;
        let mut graph = graph_of(&d_and_e(&onto_d)).unwrap();
        let patch = |field: &str| EdgePatch {
            source_side: (field == "sourceSide").then_some(Field(Some(Dock::Top))),
            target_side: (field == "targetSide").then_some(Field(Some(Dock::Top))),
            ..EdgePatch::default()
        };
        assert_eq!(
            update_edge_in(&mut graph, 1, "e", patch("targetSide")),
            Err(EdgeRefusal::Data(GraphDataProblem::InvalidField {
                list: GraphList::Edges,
                index: 0,
                id: Some("e".into()),
                field: "targetSide".into(),
                expected: A_SIDE.into(),
            }))
        );
        assert_eq!(
            update_edge_in(&mut graph, 1, "e", patch("sourceSide")),
            Ok(())
        );
        let sides = graph.edge(1).unwrap().sides;
        assert_eq!(sides.source, graph_side::Side::Top.into());
    }

    #[test]
    fn eight_labels_are_taken_none_is_no_labels_and_a_label_without_a_place_sits_at_the_middle() {
        // Verifies: API-edges-dock-nodes-or-edges
        use super::super::graph_of;
        use super::super::tests::{batch, label_named, load_edges};
        use super::super::{EdgeCells, OwnedEdgeColumns};
        let edge = |change: &dyn Fn(&mut EdgeInput)| {
            let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[("e", "a", "b")]);
            change(&mut data.edges[0]);
            data
        };
        let labels =
            |ids: &[&str]| Field(Some(Some(ids.iter().map(|id| label_named(id)).collect())));
        let eight = ["l0", "l1", "l2", "l3", "l4", "l5", "l6", "l7"];
        // Eight labels are taken, and an empty list is no labels.
        assert_eq!(
            graph_of(&edge(&|e| e.labels = labels(&eight)))
                .unwrap()
                .edge(0)
                .unwrap()
                .labels
                .len(),
            8
        );
        let empty = graph_of(&edge(&|e| e.labels = labels(&[]))).unwrap();
        assert!(empty.edge(0).unwrap().labels.is_empty());
        // A label without a path parameter or an offset sits at 0.5 and 0.
        let unplaced = edge(&|e| {
            let mut label = label_named("m");
            let placed = label.0.as_mut().unwrap();
            (placed.t, placed.offset) = (Field::absent(), Field::absent());
            e.labels = Field(Some(Some(vec![label])));
        });
        let placed = graph_of(&unplaced).unwrap().edge(0).unwrap().labels[0];
        assert_eq!((placed.t, placed.offset), (0.5, 0.0));
        let columns = OwnedEdgeColumns::of([Some(&EdgeCells::from(&unplaced.edges[0]))]);
        let placed = load_edges(&columns).unwrap().edge(0).unwrap().labels[0];
        assert_eq!((placed.t, placed.offset), (0.5, 0.0));
        // A patch replaces the whole list, a label without a place back at 0.5, and refuses
        // `label` as a field it does not know.
        let mut graph = graph_of(&edge(&|e| e.labels = labels(&["m", "n"]))).unwrap();
        let patch = EdgePatch {
            labels: Some(unplaced.edges[0].labels.clone()),
            ..EdgePatch::default()
        };
        update_edge_in(&mut graph, 0, "e", patch).unwrap();
        let kept = &graph.edge(0).unwrap().labels;
        assert_eq!(kept.len(), 1);
        assert_eq!((kept[0].t, kept[0].offset), (0.5, 0.0));
        let stale = EdgePatch {
            other: Some("label".into()),
            ..EdgePatch::default()
        };
        assert_eq!(
            update_edge_in(&mut graph, 0, "e", stale),
            Err(EdgeRefusal::Data(GraphDataProblem::UnknownEdgePatchField {
                edge: "e".into(),
                field: "label".into()
            }))
        );
    }

    #[test]
    fn a_patch_with_another_field_or_a_title_not_text_names_its_node() {
        let patch = |entries: Vec<(&str, PatchValue)>| {
            let fields = entries.into_iter().map(|(k, v)| (k.to_owned(), v));
            patch_of(
                "a",
                (RECTANGLE.0, false),
                None,
                &NodePatch(fields.collect()),
                &Fonts::default(),
                0,
            )
            .map(|patched| {
                let content = patched.content;
                content.map(|(content, laid)| (content.text(0).to_owned(), laid))
            })
        };
        assert_eq!(patch(Vec::new()), Ok(None));
        assert_eq!(
            patch(vec![("content", titled("A").into())]),
            // Its rows and padding, 38, before the least height its node shape applies.
            Ok(Some(("A".to_owned(), (38.0, 1))))
        );
        assert_eq!(
            patch(vec![
                ("content", titled("A").into()),
                ("width", PatchValue::Other)
            ]),
            Err(GraphDataProblem::UnknownPatchField {
                node: "a".into(),
                field: "width".into()
            })
        );
        let long = "x".repeat(MAX_TEXT + 1);
        assert_eq!(
            patch(vec![("content", titled(&long).into())]),
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
            patch(vec![("content", Field::from(none).into())]),
            Err(invalid_text("a", 0, 0))
        );
    }

    #[test]
    fn an_edge_the_engine_cannot_number_is_refused_as_a_node_it_cannot_number() {
        // Verifies: ARCH-engine-edits-graph-in-place
        let node = GraphDataProblem::from(TooManySlots);
        assert_eq!(
            not_added("e", AddEdgeError::TooManySlots(TooManySlots)),
            EdgeRefusal::Data(node)
        );
        let slot = SlotError::NoNode { slot: 3 };
        assert_eq!(
            not_added("e", AddEdgeError::Slot(slot)),
            EdgeRefusal::Slot(slot)
        );
    }
}
