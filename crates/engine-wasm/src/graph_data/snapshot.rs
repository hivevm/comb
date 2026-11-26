//! The columns of a load the snapshot of `api` builds (API-bridge-columns-keep-no-size), written
//! by the tests: a batch of nodes and edges as the tests write it, each string column cut into
//! pieces as the shell's writer cuts it.

use serde::Deserialize;

use super::field::{Refusable, items};
use super::node_columns::Refused;
use super::{
    Arrow, ArrowCode, ContentData, ContentInput, Dock, EdgeColumns, EdgeField, EdgeInput, Field,
    GraphDataProblem, LabelInput, MAX_LABELS, NodeColumns, NodeField, NodeInput, NodeShapeCode,
    OutlineCode, Pair, SideCode, Unflat, numbered, utf16_length,
};

/// The nodes and edges of one load as the tests write them, each in slot order: the nodes as the
/// node of `addNode` crosses and the edges as the edge of `addEdge` does, which `OwnedColumns` and
/// `OwnedEdgeColumns` turn into the columns the shell builds.
#[cfg(test)]
#[derive(Deserialize)]
pub(crate) struct GraphBatch {
    #[serde(deserialize_with = "items")]
    pub nodes: Vec<NodeInput>,
    #[serde(deserialize_with = "items")]
    pub edges: Vec<EdgeInput>,
}

/// A node whose identifier, place, width, node shape, or content is missing or of another type.
impl Refusable for NodeInput {
    fn refused(&self) -> bool {
        [
            self.id.0.is_none(),
            self.x.0.is_none(),
            self.y.0.is_none(),
            self.width.0.is_none(),
            self.height.0.is_none(),
            self.shape.0.is_none(),
            self.outline.0.is_none(),
            self.container.0.is_none(),
            self.is_container.0.is_none(),
            self.resizable.0.is_none(),
            self.divide.0.is_none(),
            self.regions.0.is_none(),
            self.attached_to.0.is_none(),
            self.side.0.is_none(),
            self.offset.0.is_none(),
            self.content.0.is_none(),
        ]
        .contains(&true)
    }
}

/// An edge of which a field, or a field of its label, is missing or of another type, or an end
/// that names a node and an edge, neither, a path parameter outside 0 to 1, or a side against
/// where it lies: what reading it as `addEdge` does refuses (API-edges-dock-nodes-or-edges).
impl Refusable for EdgeInput {
    fn refused(&self) -> bool {
        super::item::edge_of(0, self).is_err()
    }
}

/// The bound on a piece of a string column the snapshot of `api` passes its writer
/// (API-bridge-columns-keep-no-size).
#[cfg(test)]
const SNAPSHOT_PIECE: usize = 1 << 28;

/// Ends a value of a string column, one value per item while the tests write it: `value`, its
/// boundary the last one and its length, so that a million items cost no count of the column
/// written so far.
#[cfg(test)]
fn push_value(values: &mut Vec<String>, bounds: &mut Vec<u32>, value: String) {
    bounds.push(bounds[bounds.len() - 1] + utf16_length(&value) as u32);
    values.push(value);
}

/// The pieces a string column of `values` crosses in, cut as the shell's writer cuts it: each
/// value appended to the piece before it while that piece stays within `bound` UTF-16 code units,
/// else starting a piece, and a column of no code units in none. The writer refuses a value
/// longer than its bound; the bound is raised here to the longest value, so that a test may give
/// any bound for any column.
#[cfg(test)]
pub(crate) fn pieces_of(values: &[String], bound: usize) -> Vec<String> {
    let longest = values.iter().map(|value| utf16_length(value)).max();
    let bound = longest.unwrap_or(0).max(bound);
    let mut pieces = Vec::new();
    let (mut piece, mut units) = (String::new(), 0);
    for value in values {
        let length = utf16_length(value);
        if units + length > bound {
            pieces.push(std::mem::take(&mut piece));
            units = 0;
        }
        piece.push_str(value);
        units += length;
    }
    if units > 0 {
        pieces.push(piece);
    }
    pieces
}

/// The columns of a load's nodes, owned: what the snapshot of `api` builds, for the tests.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct OwnedColumns {
    pub(super) ids: Vec<String>,
    pub(super) id_bounds: Vec<u32>,
    pub(super) x: Vec<f64>,
    pub(super) y: Vec<f64>,
    pub(super) width: Vec<f64>,
    pub(super) has_height: Vec<u8>,
    pub(super) height: Vec<f64>,
    pub(super) shape: Vec<u8>,
    pub(super) outline: Vec<u8>,
    pub(super) outline_dash: Vec<f64>,
    pub(super) outline_gap: Vec<f64>,
    pub(super) has_container: Vec<u8>,
    pub(super) container: Vec<u32>,
    pub(super) is_container: Vec<u8>,
    pub(super) resizable: Vec<u8>,
    pub(super) divide: Vec<u8>,
    pub(super) regions: OwnedRegions,
    pub(super) has_attached: Vec<u8>,
    pub(super) attached: Vec<u32>,
    pub(super) side: Vec<u8>,
    pub(super) offset: Vec<f64>,
    pub(super) given: Vec<u8>,
    pub(super) attached_missing: Option<String>,
    /// The identifier each border node names, resolved once every node is written.
    attached_ids: Vec<Option<String>>,
    /// The identifier each node's container names, resolved once every node is written.
    container_ids: Vec<Option<String>>,
    /// Per node whether its identifier is a string, which alone a container or an `attachedTo`
    /// resolves to.
    id_given: Vec<bool>,
    pub(crate) content: ContentData,
    pub(crate) refused: Option<Refused>,
}

/// The columns of a load's regions, owned, as the snapshot of `api` writes them
/// (API-bridge-columns-keep-no-size): each region after the nodes, depth first, `of` naming what
/// it divides, a node by its index and a region by its own index past the nodes.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct OwnedRegions {
    pub(super) ids: Vec<String>,
    pub(super) id_bounds: Vec<u32>,
    pub(super) of: Vec<u32>,
    pub(super) size: Vec<f64>,
    pub(super) divide: Vec<u8>,
    pub(super) has_dash: Vec<u8>,
    pub(super) dash: Vec<f64>,
    pub(super) gap: Vec<f64>,
    pub(super) named: Vec<u8>,
    pub(super) names: Vec<String>,
    pub(super) name_bounds: Vec<u32>,
    /// Per region whether it divides a node, by its index, or a region, by its own.
    parents: Vec<(bool, u32)>,
}

#[cfg(test)]
impl OwnedRegions {
    /// Writes `regions`, read, of the node at `node`, each after what it lies in.
    fn push(&mut self, node: u32, regions: &[super::Region]) {
        let base = self.of.len() as u32;
        for region in regions {
            self.parents.push(match region.parent {
                None => (true, node),
                Some(parent) => (false, base + parent as u32),
            });
            self.of.push(0);
            push_value(&mut self.ids, &mut self.id_bounds, region.id.clone());
            self.size.push(region.size);
            self.divide.push(match region.divide {
                None => 0,
                Some(comb_engine::graph::Axis::Across) => 1,
                Some(comb_engine::graph::Axis::Down) => 2,
            });
            self.has_dash.push(u8::from(region.dash.is_some()));
            let [dash, gap] = region.dash.unwrap_or_default();
            self.dash.push(dash);
            self.gap.push(gap);
            self.named.push(u8::from(region.name.is_some()));
            if let Some(name) = &region.name {
                push_value(&mut self.names, &mut self.name_bounds, name.clone());
            }
        }
    }

    /// Names what each region divides by its slot, once the `count` nodes are written.
    fn number(&mut self, count: u32) {
        for (of, &(node, index)) in self.of.iter_mut().zip(&self.parents) {
            *of = if node { index } else { count + index };
        }
        self.ids = pieces_of(&self.ids, SNAPSHOT_PIECE);
        self.names = pieces_of(&self.names, SNAPSHOT_PIECE);
    }

    fn view(&self) -> super::RegionColumns<'_> {
        super::RegionColumns {
            ids: &self.ids,
            id_bounds: &self.id_bounds,
            of: &self.of,
            size: &self.size,
            divide: &self.divide,
            has_dash: &self.has_dash,
            dash: &self.dash,
            gap: &self.gap,
            named: &self.named,
            names: &self.names,
            name_bounds: &self.name_bounds,
        }
    }
}

#[cfg(test)]
impl OwnedColumns {
    /// The columns of `nodes` as the snapshot builds them, `None` for an item that is no object: a
    /// field missing or of another type empty or NaN, and the first such one named, a shape of
    /// content at its row and column, but a node shape missing or naming none by its code; the
    /// content of each node one after another; each string column in pieces of at most 2^28 UTF-16
    /// code units.
    pub(crate) fn of<'n>(nodes: impl IntoIterator<Item = Option<&'n NodeInput>>) -> Self {
        Self::in_pieces(SNAPSHOT_PIECE, nodes)
    }

    /// The columns of `nodes` as `of` builds them, each string column cut into pieces by
    /// `pieces_of` with a bound of `bound` code units.
    #[expect(
        clippy::too_many_lines,
        reason = "one column per field of a node, written in the order the snapshot writes them"
    )]
    pub(crate) fn in_pieces<'n>(
        bound: usize,
        nodes: impl IntoIterator<Item = Option<&'n NodeInput>>,
    ) -> Self {
        let mut columns = Self {
            id_bounds: vec![0],
            regions: OwnedRegions {
                id_bounds: vec![0],
                name_bounds: vec![0],
                ..OwnedRegions::default()
            },
            content: ContentData {
                row_bounds: vec![0],
                element_bounds: vec![0],
                segment_bounds: vec![0],
                text_bounds: vec![0],
                name_bounds: vec![0],
                ..ContentData::default()
            },
            ..Self::default()
        };
        let mut texts = Vec::new();
        let mut names = Vec::new();
        for (index, node) in nodes.into_iter().enumerate() {
            let index = index as u32;
            let mut refuse = |field, row, column| {
                columns.refused.get_or_insert(Refused {
                    index,
                    field,
                    row,
                    column,
                });
            };
            let Some(node) = node else {
                refuse(NodeField::Item, None, None);
                columns.id_given.push(false);
                push_value(&mut columns.ids, &mut columns.id_bounds, String::new());
                for numbers in [&mut columns.x, &mut columns.y, &mut columns.width] {
                    numbers.push(f64::NAN);
                }
                columns.has_height.push(0);
                columns.height.push(0.0);
                columns.shape.push(NodeShapeCode::Rectangle as u8);
                columns.push_outline(Some(None));
                columns.on_canvas();
                columns.resizable.push(0);
                columns.divide.push(0);
                columns.no_border(0);
                columns.content.end_node();
                continue;
            };
            if node.id.0.is_none() {
                refuse(NodeField::Id, None, None);
            }
            columns.id_given.push(node.id.0.is_some());
            let id = node.id.0.clone().unwrap_or_default();
            push_value(&mut columns.ids, &mut columns.id_bounds, id);
            // A border node has no position; any other node's left out is refused.
            let bordered = matches!(node.attached_to.0, Some(Some(_)));
            let position = |value: Field<Option<f64>>| match value.0 {
                Some(None) if bordered => Field(Some(f64::NAN)),
                Some(value) => Field(value),
                None => Field(None),
            };
            let numbers = [
                (NodeField::X, position(node.x), &mut columns.x),
                (NodeField::Y, position(node.y), &mut columns.y),
                (NodeField::Width, node.width, &mut columns.width),
            ];
            for (field, value, column) in numbers {
                if value.0.is_none() {
                    columns.refused.get_or_insert(Refused {
                        index,
                        field,
                        row: None,
                        column: None,
                    });
                }
                column.push(value.0.unwrap_or(f64::NAN));
            }
            columns.push_height(index, node);
            // A node shape of another type or naming none crosses as the code of none, which the
            // first pass refuses at its place.
            let shape = node.shape.0.map_or(NodeShapeCode::Unnamed as u8, |shape| {
                comb_engine::shape::NodeShape::ALL
                    .iter()
                    .position(|&of| of == shape.into())
                    .map_or(NodeShapeCode::Unnamed as u8, |code| code as u8)
            });
            columns.shape.push(shape);
            columns.push_outline(node.outline.0);
            columns.push_nesting(index, node);
            columns.push_resizable(index, node);
            columns.push_regions(index, node);
            columns.push_border(index, node);
            columns.push_content(index, node.content.0.as_ref(), &mut texts, &mut names);
            columns.content.end_node();
        }
        columns.resolve_borders();
        columns.resolve_containers();
        columns.ids = pieces_of(&columns.ids, bound);
        let count = columns.x.len() as u32;
        columns.regions.number(count);
        columns.content.texts = pieces_of(&texts, bound);
        columns.content.names = pieces_of(&names, bound);
        columns
    }

    /// Writes the outline `outline` of the next node as the snapshot does: its code, with the dash
    /// and the gap of a dashed one, solid where it is left out, and the code of none where it is of
    /// another type or names none, which the first pass refuses at its place.
    fn push_outline(&mut self, outline: Option<Option<super::Outline>>) {
        let (code, [dash, gap]) = match outline {
            Some(None | Some(super::Outline::Solid)) => (OutlineCode::Solid, [0.0; 2]),
            Some(Some(super::Outline::None)) => (OutlineCode::None, [0.0; 2]),
            Some(Some(super::Outline::Dashed(Pair(dash)))) => (OutlineCode::Dashed, dash),
            None => (OutlineCode::Unnamed, [0.0; 2]),
        };
        self.outline.push(code as u8);
        self.outline_dash.push(dash);
        self.outline_gap.push(gap);
    }

    /// Writes the height of the node at `index`, `node`, as whether it has one and the number; one
    /// of another type crosses as none, its refusal named.
    fn push_height(&mut self, index: u32, node: &NodeInput) {
        if node.height.0.is_none() {
            self.refuse_at(index, NodeField::Height);
        }
        let height = node.height.0.flatten();
        self.has_height.push(u8::from(height.is_some()));
        self.height.push(height.unwrap_or(0.0));
    }

    /// Writes whether the node at `index`, `node`, is resizable; a value of another type crosses as
    /// none, its refusal named.
    fn push_resizable(&mut self, index: u32, node: &NodeInput) {
        if node.resizable.0.is_none() {
            self.refuse_at(index, NodeField::Resizable);
        }
        let resizable = node.resizable.0.flatten() == Some(true);
        self.resizable.push(u8::from(resizable));
    }

    /// Writes the division and the regions of the node at `index`, `node`; a value of another type
    /// anywhere in them crosses as none, its refusal named by its field.
    fn push_regions(&mut self, index: u32, node: &NodeInput) {
        let id = node.id.0.as_deref().unwrap_or_default();
        match super::regions_of(id, index as usize, &node.divide, &node.regions) {
            Ok((divide, regions)) => {
                self.divide.push(match divide {
                    None => 0,
                    Some(comb_engine::graph::Axis::Across) => 1,
                    Some(comb_engine::graph::Axis::Down) => 2,
                });
                self.regions.push(index, &regions);
            }
            Err(GraphDataProblem::InvalidField { field, .. }) => {
                let field = if field == "divide" {
                    NodeField::Divide
                } else {
                    NodeField::Regions
                };
                self.refuse_at(index, field);
                self.divide.push(0);
            }
            Err(_) => self.divide.push(0),
        }
    }

    /// Writes the next node as no border node, its data giving the fields of the bits `given`.
    fn no_border(&mut self, given: u8) {
        self.has_attached.push(0);
        self.attached.push(0);
        self.side.push(0);
        self.offset.push(0.0);
        self.given.push(given);
        self.attached_ids.push(None);
    }

    /// Writes the attachment of the node at `index`, `node`, as the snapshot does
    /// (ARCH-border-nodes-ride-sides): its `attachedTo`, resolved once every node is written; its
    /// side as its code, `Unnamed` where missing or of another type; its offset, its refusal named
    /// where missing or of another type; and of any node which of `x`, `y`, `container`, `side`,
    /// and `offset` it gives.
    fn push_border(&mut self, index: u32, node: &NodeInput) {
        let given = super::item::given_of(node).bits();
        let Some(Some(on)) = node.attached_to.0.clone() else {
            if node.attached_to.0.is_none() {
                self.refuse_at(index, NodeField::AttachedTo);
            }
            self.no_border(given);
            return;
        };
        self.has_attached.push(1);
        self.attached.push(0);
        self.attached_ids.push(Some(on));
        let side = node
            .side
            .0
            .flatten()
            .map_or(SideCode::Unnamed as u8, |side| {
                super::Side::ALL
                    .iter()
                    .position(|&s| s == side)
                    .unwrap_or(5) as u8
            });
        self.side.push(side);
        match node.offset.0 {
            Some(Some(offset)) => self.offset.push(offset),
            _ => {
                self.refuse_at(index, NodeField::Offset);
                self.offset.push(f64::NAN);
            }
        }
        self.given.push(given);
    }

    /// Resolves the `attachedTo` of each border node against the identifiers of the nodes, as the
    /// snapshot finds a slot: `CANVAS` where it names none, the first such identifier kept.
    fn resolve_borders(&mut self) {
        let ids = self.node_ids();
        for (i, on) in self.attached_ids.iter().enumerate() {
            let Some(on) = on else { continue };
            match ids.iter().position(|id| id.as_ref() == Some(on)) {
                Some(slot) => self.attached[i] = slot as u32,
                None => {
                    self.attached[i] = comb_engine::graph::CANVAS;
                    self.attached_missing.get_or_insert_with(|| on.clone());
                }
            }
        }
    }

    /// The identifier of each node written, none where it is no string, which nothing resolves
    /// to, as the snapshot's map of identifiers holds only strings.
    fn node_ids(&self) -> Vec<Option<String>> {
        (0..self.x.len())
            .map(|i| self.id_given[i].then(|| super::value_at(&self.ids, &self.id_bounds, i)))
            .collect()
    }

    /// Names `field` of the node at `index` as refused, unless a value before it is.
    fn refuse_at(&mut self, index: u32, field: NodeField) {
        self.refused.get_or_insert(Refused {
            index,
            field,
            row: None,
            column: None,
        });
    }

    /// Writes the nesting of the next node: on the canvas, no container.
    fn on_canvas(&mut self) {
        self.has_container.push(0);
        self.container.push(0);
        self.is_container.push(0);
        self.container_ids.push(None);
    }

    /// Writes the nesting of the node at `index`, `node`, as the snapshot does
    /// (API-bridge-columns-keep-no-size): a container that is a string names one, resolved once
    /// every node is written, and whether it is a container; a value of another type in either
    /// crosses as none, its refusal named.
    fn push_nesting(&mut self, index: u32, node: &NodeInput) {
        let named = match &node.container.0 {
            Some(named) => named.clone(),
            None => {
                self.refuse_at(index, NodeField::Container);
                None
            }
        };
        self.has_container.push(u8::from(named.is_some()));
        self.container.push(0);
        self.container_ids.push(named);
        if node.is_container.0.is_none() {
            self.refuse_at(index, NodeField::IsContainer);
        }
        let mark = node.is_container.0.flatten() == Some(true);
        self.is_container.push(u8::from(mark));
    }

    /// Resolves the container each node names against the identifiers of the nodes that are
    /// strings, then of the regions, each in the slot it takes after the nodes, as the snapshot
    /// finds a slot: the first of an identifier shared, and past every slot where none has it,
    /// which the bridge refuses as no node of the graph.
    fn resolve_containers(&mut self) {
        let regions = (0..self.regions.of.len()).map(|k| {
            Some(super::value_at(
                &self.regions.ids,
                &self.regions.id_bounds,
                k,
            ))
        });
        let ids: Vec<Option<String>> = self.node_ids().into_iter().chain(regions).collect();
        for (i, named) in self.container_ids.iter().enumerate() {
            let Some(named) = named else { continue };
            self.container[i] = ids
                .iter()
                .position(|id| id.as_ref() == Some(named))
                .map_or(u32::MAX, |slot| slot as u32);
        }
    }

    /// The columns with the nesting `containers`, per node the slot it names or none, and `marks`,
    /// per node whether it is a container, as the snapshot writes them
    /// (API-bridge-columns-keep-no-size).
    pub(crate) fn nested(mut self, containers: &[Option<u32>], marks: &[bool]) -> Self {
        self.has_container = containers.iter().map(|c| u8::from(c.is_some())).collect();
        self.container = containers.iter().map(|c| c.unwrap_or(0)).collect();
        self.is_container = marks.iter().map(|&m| u8::from(m)).collect();
        self
    }

    /// Writes the content of the node at `index`, none where it is no list, and names the first
    /// shape it could not read; its texts go onto `texts` one value each.
    fn push_content(
        &mut self,
        index: u32,
        content: Option<&ContentInput>,
        texts: &mut Vec<String>,
        names: &mut Vec<String>,
    ) {
        let Some(content) = content else {
            self.refused.get_or_insert(Refused {
                index,
                field: NodeField::Content,
                row: None,
                column: None,
            });
            return;
        };
        if let Some((row, column)) = content.shape {
            let field = match content.unread {
                Unflat::Row => NodeField::Row,
                Unflat::Element => NodeField::Element,
                Unflat::Segments => NodeField::Segments,
                Unflat::Segment => NodeField::Segment,
            };
            self.refused.get_or_insert(Refused {
                index,
                field,
                row: Some(row),
                column,
            });
        }
        self.content.append(&content.data, texts, names);
    }

    pub(crate) fn view(&self) -> NodeColumns<'_> {
        NodeColumns {
            ids: &self.ids,
            id_bounds: &self.id_bounds,
            x: &self.x,
            y: &self.y,
            width: &self.width,
            has_height: &self.has_height,
            height: &self.height,
            shape: &self.shape,
            outline: &self.outline,
            outline_dash: &self.outline_dash,
            outline_gap: &self.outline_gap,
            has_container: &self.has_container,
            container: &self.container,
            is_container: &self.is_container,
            resizable: &self.resizable,
            divide: &self.divide,
            regions: self.regions.view(),
            has_attached: &self.has_attached,
            attached: &self.attached,
            side: &self.side,
            offset: &self.offset,
            given: &self.given,
            attached_missing: self.attached_missing.as_deref(),
            content: self.content.view(),
            refused: self.refused,
        }
    }
}

/// An edge as the tests hand it to the columns, read as the edge of `addEdge` is but for its
/// arrowhead and sides, which are any string, so that one naming no value crosses as its code, as
/// from the snapshot.
#[cfg(test)]
#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EdgeCells {
    pub id: Field<String>,
    #[serde(default = "Field::absent")]
    pub source: Field<Option<String>>,
    #[serde(default = "Field::absent")]
    pub source_edge: Field<Option<String>>,
    #[serde(default = "Field::absent")]
    pub source_t: Field<Option<f64>>,
    #[serde(default = "Field::absent")]
    pub target: Field<Option<String>>,
    #[serde(default = "Field::absent")]
    pub target_edge: Field<Option<String>>,
    #[serde(default = "Field::absent")]
    pub target_t: Field<Option<f64>>,
    /// Whether the edge still carries `label`, which `labels` replaced.
    #[serde(default, deserialize_with = "super::field::present")]
    pub label: bool,
    #[serde(default = "Field::absent")]
    pub labels: Field<Option<Vec<Field<LabelInput>>>>,
    pub color: Field<f64>,
    pub dash: Field<Option<Pair>>,
    pub arrow: Field<String>,
    #[serde(default = "Field::absent")]
    pub lightning: Field<Option<bool>>,
    #[serde(default = "Field::absent")]
    pub source_side: Field<Option<String>>,
    #[serde(default = "Field::absent")]
    pub target_side: Field<Option<String>>,
}

/// Whether a field the tests read was given at all: of any value but none.
#[cfg(test)]
fn given<T>(field: &Field<Option<T>>) -> bool {
    !matches!(field.0, Some(None))
}

/// The field the snapshot names first of an end of an edge (API-edges-dock-nodes-or-edges,
/// *Ends*): an edge, given at all, beside a node given at all, or of another type, names `edge`;
/// an end that names no edge and no node by a string names `node`. Its path parameter the
/// bridge refuses itself.
#[cfg(test)]
fn end_refused(
    node: &Field<Option<String>>,
    edge: &Field<Option<String>>,
    names: (EdgeField, EdgeField),
) -> Option<EdgeField> {
    if given(edge) {
        (given(node) || edge.0.is_none()).then_some(names.1)
    } else {
        node.0
            .as_ref()
            .and_then(Option::as_ref)
            .is_none()
            .then_some(names.0)
    }
}

#[cfg(test)]
impl EdgeCells {
    /// The identifier the snapshot writes of an end: of the edge where it names one, else of the
    /// node, and nothing where it is refused.
    fn end_id(node: &Field<Option<String>>, edge: &Field<Option<String>>) -> String {
        let named = if given(edge) && !given(node) {
            edge
        } else {
            node
        };
        named.0.clone().flatten().unwrap_or_default()
    }

    /// Whether the end of `edge` names an edge, given at all.
    fn on_edge(edge: &Field<Option<String>>) -> u8 {
        u8::from(given(edge))
    }
    /// The labels the snapshot reads of the edge, at most one beyond `MAX_LABELS`, each `None`
    /// where it is no object; none where the edge's labels are absent or no list.
    fn labels(&self) -> impl Iterator<Item = Option<&LabelInput>> {
        let labels = self.labels.0.as_ref().and_then(Option::as_ref);
        labels
            .into_iter()
            .flatten()
            .take(MAX_LABELS + 1)
            .map(|label| label.0.as_ref())
    }

    /// The first field of the edge missing or of another type, in the order an edge is read, as
    /// the snapshot names it, a label's field with the label's place; a string that names no
    /// arrowhead or side is none.
    fn refused(&self) -> Option<(EdgeField, Option<u32>)> {
        let source = end_refused(
            &self.source,
            &self.source_edge,
            (EdgeField::Source, EdgeField::SourceEdge),
        );
        let target = end_refused(
            &self.target,
            &self.target_edge,
            (EdgeField::Target, EdgeField::TargetEdge),
        );
        let first = [
            (EdgeField::Id, self.id.0.is_none()),
            (source.unwrap_or(EdgeField::Source), source.is_some()),
            (target.unwrap_or(EdgeField::Target), target.is_some()),
            (EdgeField::Label, self.label),
            (EdgeField::Labels, self.labels.0.is_none()),
        ]
        .into_iter()
        .find(|&(_, refused)| refused)
        .map(|(field, _)| (field, None));
        let label = || {
            (0_u32..).zip(self.labels()).find_map(|(i, label)| {
                let field = match label {
                    None => Some(EdgeField::LabelItem),
                    Some(label) => [
                        (EdgeField::LabelId, label.id.0.is_none()),
                        (EdgeField::LabelT, label.t.0.is_none()),
                        (EdgeField::LabelOffset, label.offset.0.is_none()),
                    ]
                    .into_iter()
                    .find(|&(_, refused)| refused)
                    .map(|(field, _)| field),
                };
                field.map(|field| (field, Some(i)))
            })
        };
        let rest = || {
            [
                (EdgeField::Color, self.color.0.is_none()),
                (EdgeField::Dash, self.dash.0.is_none()),
                (EdgeField::Arrow, self.arrow.0.is_none()),
                (EdgeField::Lightning, self.lightning.0.is_none()),
                (EdgeField::SourceSide, self.source_side.0.is_none()),
                (EdgeField::TargetSide, self.target_side.0.is_none()),
            ]
            .into_iter()
            .find(|&(_, refused)| refused)
            .map(|(field, _)| (field, None))
        };
        first.or_else(label).or_else(rest)
    }
}

#[cfg(test)]
impl From<&EdgeInput> for EdgeCells {
    fn from(edge: &EdgeInput) -> Self {
        let named = |value: Option<&str>| Field(value.map(str::to_owned));
        let side = |side: Field<Option<Dock>>| {
            Field(side.0.map(|side| {
                side.map(|side| {
                    match side {
                        Dock::Top => "top",
                        Dock::Right => "right",
                        Dock::Bottom => "bottom",
                        Dock::Left => "left",
                        Dock::Outline => "outline",
                    }
                    .to_owned()
                })
            }))
        };
        Self {
            id: edge.id.clone(),
            source: edge.source.clone(),
            source_edge: edge.source_edge.clone(),
            source_t: edge.source_t,
            target: edge.target.clone(),
            target_edge: edge.target_edge.clone(),
            target_t: edge.target_t,
            label: edge.label,
            labels: edge.labels.clone(),
            color: edge.color,
            dash: edge.dash,
            arrow: named(edge.arrow.0.map(|arrow| match arrow {
                Arrow::End => "end",
                Arrow::None => "none",
                Arrow::Open => "open",
                Arrow::Hollow => "hollow",
            })),
            lightning: edge.lightning,
            source_side: side(edge.source_side),
            target_side: side(edge.target_side),
        }
    }
}

/// The columns of a load's edges, owned: what the snapshot of `api` builds, for the tests.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct OwnedEdgeColumns {
    pub(super) ids: Vec<String>,
    pub(super) id_bounds: Vec<u32>,
    pub(super) sources: Vec<String>,
    pub(super) source_bounds: Vec<u32>,
    pub(super) source_on_edge: Vec<u8>,
    pub(super) source_t: Vec<f64>,
    pub(super) targets: Vec<String>,
    pub(super) target_bounds: Vec<u32>,
    pub(super) target_on_edge: Vec<u8>,
    pub(super) target_t: Vec<f64>,
    pub(super) label_bounds: Vec<u32>,
    pub(super) label_ids: Vec<String>,
    pub(super) label_id_bounds: Vec<u32>,
    pub(super) label_texts: Vec<String>,
    pub(super) label_text_bounds: Vec<u32>,
    pub(super) label_texts_valid: Vec<u8>,
    pub(super) label_t: Vec<f64>,
    pub(super) label_offset: Vec<f64>,
    pub(super) has_background: Vec<u8>,
    pub(super) background: Vec<f64>,
    pub(super) color: Vec<f64>,
    pub(super) has_dash: Vec<u8>,
    pub(super) dash: Vec<f64>,
    pub(super) gap: Vec<f64>,
    pub(super) arrow: Vec<u8>,
    pub(super) lightning: Vec<u8>,
    pub(super) source_side: Vec<u8>,
    pub(super) target_side: Vec<u8>,
    pub(super) refused: Option<(u32, EdgeField, Option<u32>)>,
}

#[cfg(test)]
impl OwnedEdgeColumns {
    /// The columns of `edges` as the snapshot builds them, `None` for an item that is no object:
    /// a field missing or of another type empty, NaN, or absent, and the first such one named; a
    /// label's path parameter and offset 0.5 and 0 where it names none; a label text of the length
    /// a label holds; an arrowhead or a side by its code, one whose string names none `Unnamed`;
    /// each string column in pieces of at most 2^28 UTF-16 code units.
    pub(crate) fn of<'e>(edges: impl IntoIterator<Item = Option<&'e EdgeCells>>) -> Self {
        Self::in_pieces(SNAPSHOT_PIECE, edges)
    }

    /// The columns of `edges` as `of` builds them, each string column cut into pieces by
    /// `pieces_of` with a bound of `bound` code units.
    pub(crate) fn in_pieces<'e>(
        bound: usize,
        edges: impl IntoIterator<Item = Option<&'e EdgeCells>>,
    ) -> Self {
        let mut columns = Self {
            id_bounds: vec![0],
            source_bounds: vec![0],
            target_bounds: vec![0],
            label_bounds: vec![0],
            label_id_bounds: vec![0],
            label_text_bounds: vec![0],
            ..Self::default()
        };
        for (index, edge) in edges.into_iter().enumerate() {
            let refused = edge.map_or(Some((EdgeField::Item, None)), EdgeCells::refused);
            if let Some((field, label)) = refused {
                columns.refused.get_or_insert((index as u32, field, label));
            }
            columns.push(edge.unwrap_or(&EdgeCells::default()));
        }
        for column in [
            &mut columns.ids,
            &mut columns.sources,
            &mut columns.targets,
            &mut columns.label_ids,
            &mut columns.label_texts,
        ] {
            *column = pieces_of(column, bound);
        }
        columns
    }

    /// Writes `edge` into the columns, each string column a value per edge or label until
    /// `in_pieces` cuts it.
    fn push(&mut self, edge: &EdgeCells) {
        let text = |field: &Field<String>| field.0.clone().unwrap_or_default();
        for (column, bounds, value) in [
            (&mut self.ids, &mut self.id_bounds, text(&edge.id)),
            (
                &mut self.sources,
                &mut self.source_bounds,
                EdgeCells::end_id(&edge.source, &edge.source_edge),
            ),
            (
                &mut self.targets,
                &mut self.target_bounds,
                EdgeCells::end_id(&edge.target, &edge.target_edge),
            ),
        ] {
            push_value(column, bounds, value);
        }
        let t = |t: Field<Option<f64>>| t.0.flatten().unwrap_or(f64::NAN);
        self.source_on_edge
            .push(EdgeCells::on_edge(&edge.source_edge));
        self.source_t.push(t(edge.source_t));
        self.target_on_edge
            .push(EdgeCells::on_edge(&edge.target_edge));
        self.target_t.push(t(edge.target_t));
        for label in edge.labels() {
            let id = label.map(|label| text(&label.id)).unwrap_or_default();
            push_value(&mut self.label_ids, &mut self.label_id_bounds, id);
            let text_length = label.and_then(|label| label.text_length);
            let shown = "x".repeat(text_length.unwrap_or(0));
            push_value(&mut self.label_texts, &mut self.label_text_bounds, shown);
            self.label_texts_valid.push(u8::from(text_length.is_some()));
            let number = |field: Option<Field<Option<f64>>>, absent: f64| match field {
                Some(Field(Some(value))) => value.unwrap_or(absent),
                _ => f64::NAN,
            };
            self.label_t.push(number(label.map(|l| l.t), 0.5));
            self.label_offset.push(number(label.map(|l| l.offset), 0.0));
            let background = label.and_then(|label| label.background);
            self.has_background.push(u8::from(background.is_some()));
            self.background.push(background.unwrap_or(0.0));
        }
        self.label_bounds.push(numbered(self.label_t.len()));
        self.color.push(edge.color.0.unwrap_or(f64::NAN));
        let dash = edge.dash.0.flatten();
        self.has_dash.push(u8::from(dash.is_some()));
        let [length, gap] = dash.map_or([0.0, 0.0], |Pair(pair)| pair);
        self.dash.push(length);
        self.gap.push(gap);
        let arrow = edge
            .arrow
            .0
            .as_deref()
            .map_or(ArrowCode::End, |arrow| match arrow {
                "end" => ArrowCode::End,
                "none" => ArrowCode::None,
                "open" => ArrowCode::Open,
                "hollow" => ArrowCode::Hollow,
                _ => ArrowCode::Unnamed,
            });
        self.arrow.push(arrow as u8);
        self.lightning
            .push(u8::from(edge.lightning.0.flatten().unwrap_or(false)));
        // A side left out crosses as absent, which the bridge refuses beside an end on a node; one
        // of another type the snapshot names, and its column holds the code it would default to.
        let side = |side: &Field<Option<String>>, refused: SideCode| {
            side.0.as_ref().map_or(refused, |side| {
                side.as_deref().map_or(SideCode::Absent, |side| match side {
                    "top" => SideCode::Top,
                    "right" => SideCode::Right,
                    "bottom" => SideCode::Bottom,
                    "left" => SideCode::Left,
                    "outline" => SideCode::Outline,
                    _ => SideCode::Unnamed,
                })
            }) as u8
        };
        self.source_side
            .push(side(&edge.source_side, SideCode::Right));
        self.target_side
            .push(side(&edge.target_side, SideCode::Left));
    }

    pub(crate) fn view(&self) -> EdgeColumns<'_> {
        EdgeColumns {
            ids: &self.ids,
            id_bounds: &self.id_bounds,
            sources: &self.sources,
            source_bounds: &self.source_bounds,
            source_on_edge: &self.source_on_edge,
            source_t: &self.source_t,
            targets: &self.targets,
            target_bounds: &self.target_bounds,
            target_on_edge: &self.target_on_edge,
            target_t: &self.target_t,
            label_bounds: &self.label_bounds,
            label_ids: &self.label_ids,
            label_id_bounds: &self.label_id_bounds,
            label_texts: &self.label_texts,
            label_text_bounds: &self.label_text_bounds,
            label_texts_valid: &self.label_texts_valid,
            label_t: &self.label_t,
            label_offset: &self.label_offset,
            has_background: &self.has_background,
            background: &self.background,
            color: &self.color,
            has_dash: &self.has_dash,
            dash: &self.dash,
            gap: &self.gap,
            arrow: &self.arrow,
            lightning: &self.lightning,
            source_side: &self.source_side,
            target_side: &self.target_side,
            refused: self.refused,
        }
    }
}

#[cfg(test)]
impl ContentData {
    /// Ends a node of the columns of a load being written.
    pub(crate) fn end_node(&mut self) {
        self.row_bounds
            .push(numbered(self.element_bounds.len() - 1));
    }

    /// Appends the rows of `node`, the content of one node, to the columns of a load being
    /// written, its texts one value each onto `texts` and its names onto `names`, which the caller
    /// cuts into pieces.
    pub(crate) fn append(&mut self, node: &Self, texts: &mut Vec<String>, names: &mut Vec<String>) {
        let base = numbered(self.kinds.len());
        let ends = node.element_bounds.windows(2).map(|pair| base + pair[1]);
        self.element_bounds.extend(ends);
        self.separators.extend(&node.separators);
        self.kinds.extend(&node.kinds);
        self.weights.extend(&node.weights);
        self.roles.extend(&node.roles);
        self.directions.extend(&node.directions);
        self.colors.extend(&node.colors);
        let base = numbered(self.fractions.len());
        let ends = node.segment_bounds.windows(2).map(|pair| base + pair[1]);
        self.segment_bounds.extend(ends);
        self.fractions.extend(&node.fractions);
        self.segment_colors.extend(&node.segment_colors);
        let values = super::values(&node.texts, &node.text_bounds).expect("texts of one node");
        for value in values {
            let last = self.text_bounds[self.text_bounds.len() - 1];
            self.text_bounds.push(last + numbered(utf16_length(value)));
            texts.push(value.to_owned());
        }
        self.text_valid.extend(&node.text_valid);
        let values = super::values(&node.names, &node.name_bounds).expect("names of one node");
        for value in values {
            let last = self.name_bounds[self.name_bounds.len() - 1];
            self.name_bounds.push(last + numbered(utf16_length(value)));
            names.push(value.to_owned());
        }
        self.name_valid.extend(&node.name_valid);
    }
}

#[cfg(test)]
mod tests {
    use super::super::properties::{Value, titled};
    use super::*;

    /// `fields` as an object.
    fn object(fields: &[(&str, Value)]) -> Value {
        let owned = fields
            .iter()
            .map(|(name, value)| ((*name).to_owned(), value.clone()));
        Value::Object(owned.collect())
    }

    /// `T` read of `fields` as an object.
    fn read<T: for<'de> Deserialize<'de>>(fields: &[(&str, Value)]) -> T {
        T::deserialize(object(fields)).unwrap_or_else(|error| panic!("an object refused: {error}"))
    }

    /// `fields` with the field `name` holding a value of another type, `false`.
    fn wrong<'a>(fields: &[(&'a str, Value)], name: &str) -> Vec<(&'a str, Value)> {
        let wrong = |(field, value): &(&'a str, Value)| {
            let value = if *field == name {
                Value::Bool(false)
            } else {
                value.clone()
            };
            (*field, value)
        };
        fields.iter().map(wrong).collect()
    }

    /// `fields` without the field `name`.
    fn without<'a>(fields: &[(&'a str, Value)], name: &str) -> Vec<(&'a str, Value)> {
        let kept = fields.iter().filter(|(field, _)| *field != name);
        kept.cloned().collect()
    }

    /// Asserts that `T` read of `fields` holds no refused field, and that it holds one where any
    /// field of `refusable` holds a value of another type or, where it is required, is left out.
    fn assert_refusable<T: Refusable + for<'de> Deserialize<'de>>(
        fields: &[(&str, Value)],
        refusable: &[(&str, bool)],
    ) {
        assert!(!read::<T>(fields).refused());
        for &(name, required) in refusable {
            assert!(
                read::<T>(&wrong(fields, name)).refused(),
                "{name} of another type"
            );
            if required {
                assert!(
                    read::<T>(&without(fields, name)).refused(),
                    "{name} left out"
                );
            }
        }
    }

    /// An edge read as `addEdge` reads one, of the label `label`.
    fn edge(labels: Value) -> [(&'static str, Value); 10] {
        let text = |value: &str| Value::Text(value.to_owned());
        [
            ("id", text("e")),
            ("source", text("a")),
            ("target", text("b")),
            ("labels", labels),
            ("color", Value::Number(0.0)),
            (
                "dash",
                Value::List(vec![Value::Number(4.0), Value::Number(2.0)]),
            ),
            ("arrow", text("end")),
            ("lightning", Value::Bool(true)),
            ("sourceSide", text("right")),
            ("targetSide", text("left")),
        ]
    }

    fn label() -> [(&'static str, Value); 5] {
        [
            ("id", Value::Text("m".to_owned())),
            ("text", Value::Text("l".to_owned())),
            ("t", Value::Number(0.5)),
            ("offset", Value::Number(0.0)),
            ("background", Value::Number(0.0)),
        ]
    }

    /// The list of labels of one label of `fields`.
    fn one(fields: &[(&str, Value)]) -> Value {
        Value::List(vec![object(fields)])
    }

    // A field added to an input fails to compile in the tests below until they and `Refusable`
    // name it.

    #[test]
    fn a_container_or_an_attached_to_resolves_to_a_node_by_an_identifier_that_is_a_string() {
        // Verifies: API-bridge-columns-keep-no-size
        // An identifier of another type is in no map of the snapshot: `""` names no node.
        let unnamed = read::<NodeInput>(&[("id", Value::Number(1.0))]);
        let named = |field: &str| read::<NodeInput>(&[(field, Value::Text(String::new()))]);
        let columns = OwnedColumns::of([
            Some(&unnamed),
            Some(&named("container")),
            Some(&named("attachedTo")),
        ]);
        assert_eq!(columns.container[1], u32::MAX);
        assert_eq!(columns.attached[2], comb_engine::graph::CANVAS);
        assert_eq!(columns.attached_missing.as_deref(), Some(""));
    }

    #[test]
    fn every_field_of_a_node_is_refusable() {
        let NodeInput {
            id: _,
            x: _,
            y: _,
            width: _,
            height: _,
            shape: _,
            outline: _,
            container: _,
            is_container: _,
            resizable: _,
            divide: _,
            regions: _,
            attached_to: _,
            side: _,
            offset: _,
            content: _,
        } = NodeInput::default();
        let node = [
            ("id", Value::Text("n".to_owned())),
            ("x", Value::Number(0.0)),
            ("y", Value::Number(0.0)),
            ("width", Value::Number(100.0)),
            ("height", Value::Number(80.0)),
            ("shape", Value::Text("diamond".to_owned())),
            ("outline", Value::Text("none".to_owned())),
            ("container", Value::Text("c".to_owned())),
            ("isContainer", Value::Bool(true)),
            ("resizable", Value::Bool(true)),
            ("attachedTo", Value::Text("a".to_owned())),
            ("side", Value::Text("top".to_owned())),
            ("offset", Value::Number(3.0)),
            ("content", titled("A")),
        ];
        // The container and the mark may be left out: none is no refused value. Nor is a position
        // left out, which a border node has none of; reading a node refuses it then
        // (ARCH-border-nodes-ride-sides).
        let required = [
            ("id", true),
            ("x", false),
            ("y", false),
            ("width", true),
            ("height", false),
            ("shape", true),
            ("outline", false),
            ("container", false),
            ("attachedTo", false),
            ("side", false),
            ("offset", false),
            ("content", true),
        ];
        assert_refusable::<NodeInput>(&node, &required);
        // `false` is a mark, so the mark of another type is a number.
        let mut numbered = without(&node, "isContainer");
        numbered.push(("isContainer", Value::Number(1.0)));
        assert!(
            read::<NodeInput>(&numbered).refused(),
            "isContainer of another type"
        );
        assert!(!read::<NodeInput>(&without(&node, "isContainer")).refused());
        // So is `false` whether it is resizable.
        let mut numbered = without(&node, "resizable");
        numbered.push(("resizable", Value::Number(1.0)));
        assert!(
            read::<NodeInput>(&numbered).refused(),
            "resizable of another type"
        );
        assert!(!read::<NodeInput>(&without(&node, "resizable")).refused());
    }

    #[test]
    fn every_field_of_an_edge_is_refusable() {
        let EdgeInput {
            id: _,
            source: _,
            source_edge: _,
            source_t: _,
            target: _,
            target_edge: _,
            target_t: _,
            label: _,
            labels: _,
            color: _,
            dash: _,
            arrow: _,
            lightning: _,
            source_side: _,
            target_side: _,
        } = EdgeInput::default();
        // The labels, the dash, and the lightning bolt may be left out: none is no refused value.
        let required = [
            ("id", true),
            ("source", true),
            ("target", true),
            ("labels", false),
            ("color", true),
            ("dash", false),
            ("arrow", true),
            ("sourceSide", true),
            ("targetSide", true),
        ];
        let fields = edge(one(&label()));
        assert_refusable::<EdgeInput>(&fields, &required);
        // A lightning bolt of another type than `true` or `false`, which `wrong` gives.
        let mut numbered = fields.to_vec();
        numbered[8].1 = Value::Number(1.0);
        assert!(
            read::<EdgeInput>(&numbered).refused(),
            "lightning of another type"
        );
        assert!(!read::<EdgeInput>(&without(&fields, "lightning")).refused());
        // `label`, which `labels` replaced, of any value but none (API-edges-dock-nodes-or-edges).
        for stale in [object(&label()), Value::Bool(false), Value::Number(0.0)] {
            let mut carried = fields.to_vec();
            carried.push(("label", stale));
            assert!(read::<EdgeInput>(&carried).refused(), "label");
        }
        let mut none = fields.to_vec();
        none.push(("label", Value::Null));
        assert!(!read::<EdgeInput>(&none).refused(), "label of null");
    }

    #[test]
    fn a_label_its_identifier_and_its_place_are_refusable_and_its_text_and_background_are_not() {
        let read_with = |label: &[(&str, Value)]| read::<EdgeInput>(&edge(one(label)));
        let LabelInput {
            id: _,
            text_length: _,
            t: _,
            offset: _,
            background: _,
        } = read_with(&label()).labels.0.flatten().expect("labels")[0]
            .0
            .clone()
            .expect("a label");
        // A label's text and background are checked by its rules, not refused by their type; its
        // place may be left out, and takes 0.5 and 0 (API-edges-dock-nodes-or-edges).
        let fields = [
            ("id", true),
            ("t", false),
            ("offset", false),
            ("text", false),
            ("background", false),
        ];
        for (name, required) in fields {
            let typed = read_with(&wrong(&label(), name)).refused();
            let refusable = ["id", "t", "offset"].contains(&name);
            assert_eq!(typed, refusable, "labels[0].{name} of another type");
            let left_out = read_with(&without(&label(), name)).refused();
            assert_eq!(left_out, required, "labels[0].{name} left out");
        }
        // A label that is no object, and labels that are no list.
        let no_object = read::<EdgeInput>(&edge(Value::List(vec![Value::Number(1.0)])));
        assert!(no_object.refused());
        assert!(read::<EdgeInput>(&edge(Value::Number(1.0))).refused());
    }
}
