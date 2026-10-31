//! The columns of a load the snapshot of `api` builds (ADR-0034), written by the tests: a batch
//! of nodes and edges as the tests write it, each string column cut into pieces as the shell's
//! writer cuts it.

use serde::Deserialize;

use super::field::items;
use super::node_columns::Refused;
use super::{
    Arrow, ArrowCode, ContentData, ContentInput, EdgeColumns, EdgeField, EdgeInput, Field,
    LabelInput, NodeColumns, NodeField, NodeInput, Pair, Side, SideCode, Unflat, numbered,
    utf16_length,
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

/// The bound on a piece of a string column the snapshot of `api` passes its writer (ADR-0034).
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
    pub(crate) content: ContentData,
    pub(crate) refused: Option<Refused>,
}

#[cfg(test)]
impl OwnedColumns {
    /// The columns of `nodes` as the snapshot builds them, `None` for an item that is no object: a
    /// field missing or of another type empty or NaN, and the first such one named, a shape of
    /// content at its row and column; the content of each node one after another; each string
    /// column in pieces of at most 2^28 UTF-16 code units.
    pub(crate) fn of<'n>(nodes: impl IntoIterator<Item = Option<&'n NodeInput>>) -> Self {
        Self::in_pieces(SNAPSHOT_PIECE, nodes)
    }

    /// The columns of `nodes` as `of` builds them, each string column cut into pieces by
    /// `pieces_of` with a bound of `bound` code units.
    pub(crate) fn in_pieces<'n>(
        bound: usize,
        nodes: impl IntoIterator<Item = Option<&'n NodeInput>>,
    ) -> Self {
        let mut columns = Self {
            id_bounds: vec![0],
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
                push_value(&mut columns.ids, &mut columns.id_bounds, String::new());
                for numbers in [&mut columns.x, &mut columns.y, &mut columns.width] {
                    numbers.push(f64::NAN);
                }
                columns.content.end_node();
                continue;
            };
            if node.id.0.is_none() {
                refuse(NodeField::Id, None, None);
            }
            let id = node.id.0.clone().unwrap_or_default();
            push_value(&mut columns.ids, &mut columns.id_bounds, id);
            let numbers = [
                (NodeField::X, node.x, &mut columns.x),
                (NodeField::Y, node.y, &mut columns.y),
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
            columns.push_content(index, node.content.0.as_ref(), &mut texts, &mut names);
            columns.content.end_node();
        }
        columns.ids = pieces_of(&columns.ids, bound);
        columns.content.texts = pieces_of(&texts, bound);
        columns.content.names = pieces_of(&names, bound);
        columns
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
            content: self.content.view(),
            refused: self.refused,
        }
    }
}

/// An edge as the tests hand it to the columns, read as the edge of `addEdge` is but for its
/// arrowhead and sides, which are any string, so that one naming no value crosses as its code, as
/// from the snapshot.
#[cfg(test)]
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EdgeCells {
    pub id: Field<String>,
    pub source: Field<String>,
    pub target: Field<String>,
    pub label: Field<Option<LabelInput>>,
    pub color: Field<f64>,
    pub dash: Field<Option<Pair>>,
    pub arrow: Field<String>,
    pub source_side: Field<String>,
    pub target_side: Field<String>,
}

#[cfg(test)]
impl EdgeCells {
    /// The first field of the edge missing or of another type, in the order an edge is read, as
    /// the snapshot names it; a string that names no arrowhead or side is none.
    fn refused(&self) -> Option<EdgeField> {
        let label = self.label.0.flatten();
        [
            (EdgeField::Id, self.id.0.is_none()),
            (EdgeField::Source, self.source.0.is_none()),
            (EdgeField::Target, self.target.0.is_none()),
            (EdgeField::Label, self.label.0.is_none()),
            (EdgeField::LabelT, label.is_some_and(|l| l.t.0.is_none())),
            (
                EdgeField::LabelOffset,
                label.is_some_and(|l| l.offset.0.is_none()),
            ),
            (EdgeField::Color, self.color.0.is_none()),
            (EdgeField::Dash, self.dash.0.is_none()),
            (EdgeField::Arrow, self.arrow.0.is_none()),
            (EdgeField::SourceSide, self.source_side.0.is_none()),
            (EdgeField::TargetSide, self.target_side.0.is_none()),
        ]
        .into_iter()
        .find(|&(_, refused)| refused)
        .map(|(field, _)| field)
    }
}

#[cfg(test)]
impl From<&EdgeInput> for EdgeCells {
    fn from(edge: &EdgeInput) -> Self {
        let named = |value: Option<&str>| Field(value.map(str::to_owned));
        let side = |side: Field<Side>| {
            named(side.0.map(|side| match side {
                Side::Top => "top",
                Side::Right => "right",
                Side::Bottom => "bottom",
                Side::Left => "left",
            }))
        };
        Self {
            id: edge.id.clone(),
            source: edge.source.clone(),
            target: edge.target.clone(),
            label: edge.label,
            color: edge.color,
            dash: edge.dash,
            arrow: named(edge.arrow.0.map(|arrow| match arrow {
                Arrow::End => "end",
                Arrow::None => "none",
            })),
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
    pub(super) targets: Vec<String>,
    pub(super) target_bounds: Vec<u32>,
    pub(super) has_label: Vec<u8>,
    pub(super) labels: Vec<String>,
    pub(super) label_bounds: Vec<u32>,
    pub(super) label_texts: Vec<u8>,
    pub(super) label_t: Vec<f64>,
    pub(super) label_offset: Vec<f64>,
    pub(super) has_background: Vec<u8>,
    pub(super) background: Vec<f64>,
    pub(super) color: Vec<f64>,
    pub(super) has_dash: Vec<u8>,
    pub(super) dash: Vec<f64>,
    pub(super) gap: Vec<f64>,
    pub(super) arrow: Vec<u8>,
    pub(super) source_side: Vec<u8>,
    pub(super) target_side: Vec<u8>,
    pub(super) refused: Option<(u32, EdgeField)>,
}

#[cfg(test)]
impl OwnedEdgeColumns {
    /// The columns of `edges` as the snapshot builds them, `None` for an item that is no object:
    /// a field missing or of another type empty, NaN, or absent, and the first such one named; a
    /// label text of the length a label holds; an arrowhead or a side by its code, one whose
    /// string names none `Unnamed`; each string column in pieces of at most 2^28 UTF-16 code
    /// units.
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
            ..Self::default()
        };
        for (index, edge) in edges.into_iter().enumerate() {
            let refused = edge.map_or(Some(EdgeField::Item), EdgeCells::refused);
            if let Some(field) = refused {
                columns.refused.get_or_insert((index as u32, field));
            }
            columns.push(edge.unwrap_or(&EdgeCells::default()));
        }
        for column in [
            &mut columns.ids,
            &mut columns.sources,
            &mut columns.targets,
            &mut columns.labels,
        ] {
            *column = pieces_of(column, bound);
        }
        columns
    }

    /// Writes `edge` into the columns, each string column a value per edge until `in_pieces` cuts
    /// it.
    fn push(&mut self, edge: &EdgeCells) {
        let label = edge.label.0.flatten();
        let text_length = label.and_then(|label| label.text_length);
        let text = |field: &Field<String>| field.0.clone().unwrap_or_default();
        for (column, bounds, value) in [
            (&mut self.ids, &mut self.id_bounds, text(&edge.id)),
            (
                &mut self.sources,
                &mut self.source_bounds,
                text(&edge.source),
            ),
            (
                &mut self.targets,
                &mut self.target_bounds,
                text(&edge.target),
            ),
            (
                &mut self.labels,
                &mut self.label_bounds,
                "x".repeat(text_length.unwrap_or(0)),
            ),
        ] {
            push_value(column, bounds, value);
        }
        self.label_texts.push(u8::from(text_length.is_some()));
        self.has_label.push(u8::from(label.is_some()));
        self.label_t
            .push(label.and_then(|l| l.t.0).unwrap_or(f64::NAN));
        self.label_offset
            .push(label.and_then(|l| l.offset.0).unwrap_or(f64::NAN));
        let background = label.and_then(|label| label.background);
        self.has_background.push(u8::from(background.is_some()));
        self.background.push(background.unwrap_or(0.0));
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
                _ => ArrowCode::Unnamed,
            });
        self.arrow.push(arrow as u8);
        let side = |side: &Field<String>, absent: SideCode| {
            side.0.as_deref().map_or(absent, |side| match side {
                "top" => SideCode::Top,
                "right" => SideCode::Right,
                "bottom" => SideCode::Bottom,
                "left" => SideCode::Left,
                _ => SideCode::Unnamed,
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
            targets: &self.targets,
            target_bounds: &self.target_bounds,
            has_label: &self.has_label,
            labels: &self.labels,
            label_bounds: &self.label_bounds,
            label_texts: &self.label_texts,
            label_t: &self.label_t,
            label_offset: &self.label_offset,
            has_background: &self.has_background,
            background: &self.background,
            color: &self.color,
            has_dash: &self.has_dash,
            dash: &self.dash,
            gap: &self.gap,
            arrow: &self.arrow,
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
