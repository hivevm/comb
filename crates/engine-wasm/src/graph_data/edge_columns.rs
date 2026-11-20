//! The edges of a load as columns (API-bridge-columns-carry-nesting): the fields an edge reads in
//! their order, the codes of its arrowhead and sides, whether the columns fit together, the first
//! value refused by its type, and the edges read off them, each with its list of edge labels
//! (API-edges-dock-nodes-or-edges).

use comb_engine::geometry::{Dock, Side};
use wasm_bindgen::prelude::wasm_bindgen;

use super::item::{Edge, EndRead, Item, Label, on_the_path};
use super::problem::{
    A_COLOR, A_DASH, A_FLAG, A_LABEL, A_LABELS, A_NUMBER_OR_NONE, A_PARAMETER, A_SIDE, AN_ARROW,
    AN_EDGE_ID, AN_ID, NO_LABEL,
};
use super::{
    Arrow, Field, GraphDataProblem, GraphList, bounds_fit, lengths, malformed, refused_by,
    runs_fit, unshaped, value_at, values,
};

/// Columns of the edges that do not fit together, which the shell never hands over.
pub(super) fn unfit_edges() -> GraphDataProblem {
    malformed("the columns of the edges do not fit together")
}

/// The code units of the identifier, the source, and the target of an edge, and whether its source
/// and its target name an edge, by which a refusal of one too long names its field
/// (API-edges-dock-nodes-or-edges).
#[derive(Clone, Copy)]
pub(super) struct IdLengths {
    pub(super) lengths: [usize; 3],
    pub(super) on_edge: [bool; 2],
}

/// The first value of the edges the shell found refused by its type, as `loadGraph` takes it:
/// the index of its edge, the code of its `EdgeField`, and, for a field of a label, the label's
/// place in the edge's list, or none of them; a code no field has, or a place given or left out
/// against the field, is refused as malformed.
pub(crate) fn edge_refused_of(
    at: Option<u32>,
    field: Option<u32>,
    label: Option<u32>,
) -> Result<Option<(u32, EdgeField, Option<u32>)>, GraphDataProblem> {
    let refused = refused_by(at, field, &EdgeField::ALL, unfit_edges)?;
    match refused {
        Some((at, field)) if field.of_a_label() == label.is_some() => Ok(Some((at, field, label))),
        None if label.is_none() => Ok(None),
        _ => Err(unfit_edges()),
    }
}

/// A field of an edge that a load's first pass refuses by its type
/// (API-bridge-columns-carry-nesting), in the order an edge's fields are read, as the shell names
/// the first such value it reads: `Item` for an edge that is no object, refused as malformed;
/// `SourceEdge` and `TargetEdge` for an end that names an edge of another type or beside a node,
/// and `SourceT` and `TargetT` for its path parameter, which the bridge refuses itself
/// (API-edges-dock-nodes-or-edges, *Ends*); `Label` for an edge that still carries `label`, which
/// `labels` replaced; `LabelItem` for a label that is no object, and `LabelId`, `LabelT`, and
/// `LabelOffset`, each named by the label's place in the list. It crosses as its code, a plain
/// number, as `NodeField` does.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EdgeField {
    Item,
    Id,
    Source,
    SourceEdge,
    SourceT,
    Target,
    TargetEdge,
    TargetT,
    Label,
    Labels,
    LabelItem,
    LabelId,
    LabelT,
    LabelOffset,
    Color,
    Dash,
    Arrow,
    Lightning,
    SourceSide,
    TargetSide,
}

impl EdgeField {
    pub(super) const ALL: [Self; 20] = [
        Self::Item,
        Self::Id,
        Self::Source,
        Self::SourceEdge,
        Self::SourceT,
        Self::Target,
        Self::TargetEdge,
        Self::TargetT,
        Self::Label,
        Self::Labels,
        Self::LabelItem,
        Self::LabelId,
        Self::LabelT,
        Self::LabelOffset,
        Self::Color,
        Self::Dash,
        Self::Arrow,
        Self::Lightning,
        Self::SourceSide,
        Self::TargetSide,
    ];

    /// The field's name as a refusal names it, a label's field after the label's place, and what
    /// it expects.
    pub(super) fn named(self) -> (&'static str, &'static str) {
        match self {
            Self::Item => ("", ""),
            Self::Id => ("id", AN_ID),
            Self::Source => ("source", AN_ID),
            Self::SourceEdge => ("sourceEdge", AN_EDGE_ID),
            Self::SourceT => ("sourceT", A_PARAMETER),
            Self::Target => ("target", AN_ID),
            Self::TargetEdge => ("targetEdge", AN_EDGE_ID),
            Self::TargetT => ("targetT", A_PARAMETER),
            Self::Label => ("label", NO_LABEL),
            Self::Labels => ("labels", A_LABELS),
            Self::LabelItem => ("", A_LABEL),
            Self::LabelId => (".id", AN_ID),
            Self::LabelT => (".t", A_NUMBER_OR_NONE),
            Self::LabelOffset => (".offset", A_NUMBER_OR_NONE),
            Self::Color => ("color", A_COLOR),
            Self::Dash => ("dash", A_DASH),
            Self::Arrow => ("arrow", AN_ARROW),
            Self::Lightning => ("lightning", A_FLAG),
            Self::SourceSide => ("sourceSide", A_SIDE),
            Self::TargetSide => ("targetSide", A_SIDE),
        }
    }

    /// Whether the field is one of a label, named by the label's place in the edge's list.
    pub(super) const fn of_a_label(self) -> bool {
        matches!(
            self,
            Self::LabelItem | Self::LabelId | Self::LabelT | Self::LabelOffset
        )
    }

    /// The one of `self` and `other` an edge reads first.
    fn min_by_order(self, other: Self) -> Self {
        if (self as u32) <= (other as u32) {
            self
        } else {
            other
        }
    }
}

impl From<EdgeField> for u32 {
    fn from(field: EdgeField) -> Self {
        field as Self
    }
}

/// The code of an edge's arrowhead in its column (API-bridge-columns-carry-nesting): `Unnamed`
/// for a string that names none, which the first pass refuses at its place.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArrowCode {
    End,
    None,
    Open,
    Hollow,
    Unnamed,
}

/// The code of a side of an edge, or its outline, in its column
/// (API-bridge-takes-serde-and-columns, API-edges-dock-side-or-outline): `Unnamed` for a string
/// that names none of the five, which the first pass refuses at its place, and `Absent` for a side
/// left out, which an end on an edge takes and an end on a node is refused for
/// (API-edges-dock-nodes-or-edges).
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SideCode {
    Top,
    Right,
    Bottom,
    Left,
    Outline,
    Unnamed,
    Absent,
}

/// The arrowhead of `code`, or none for `Unnamed` and for a code no arrowhead has.
fn arrow_of(code: u8) -> Option<Arrow> {
    [
        (ArrowCode::End, Arrow::End),
        (ArrowCode::None, Arrow::None),
        (ArrowCode::Open, Arrow::Open),
        (ArrowCode::Hollow, Arrow::Hollow),
    ]
    .into_iter()
    .find(|&(of, _)| of as u8 == code)
    .map(|(_, arrow)| arrow)
}

/// Where the end of `code` docks, or none for `Unnamed`, `Absent`, and a code no side has.
fn side_of(code: u8) -> Option<Dock> {
    [
        (SideCode::Top, Side::Top.into()),
        (SideCode::Right, Side::Right.into()),
        (SideCode::Bottom, Side::Bottom.into()),
        (SideCode::Left, Side::Left.into()),
        (SideCode::Outline, Dock::Outline),
    ]
    .into_iter()
    .find(|&(of, _)| of as u8 == code)
    .map(|(_, dock)| dock)
}

/// The edges of one load as columns (API-bridge-columns-carry-nesting), each in slot order. The
/// identifiers, sources, and targets are each the values concatenated and cut into pieces, each
/// ending where a value ends, with their boundaries in UTF-16 code units across all pieces, one
/// more than there are edges, a refused value empty. `label_bounds` holds the boundaries of each
/// edge's labels among all labels, one more than there are edges; the labels' columns hold all
/// labels, edge by edge, each edge's in the order of its list: their identifiers and texts as
/// string columns, `label_texts_valid` per label whether its text is a text, 1 or 0, and their
/// path parameters and offsets, each 0.5 and 0 where the label names none, and `has_background`
/// whether it has a background, 1 or 0. `has_dash` and `lightning` hold per edge whether it has
/// one, 1 or 0; where a value is absent, the columns of its values hold anything. The numbers are
/// as the host application handed them, a background of another type NaN; the arrowhead and the
/// sides as their codes. A source or a target is the identifier of the node it names, or of the
/// edge where `source_on_edge` or `target_on_edge` holds 1, at the path parameter `source_t` or
/// `target_t` as handed over, NaN where it is of another type; both hold anything at an end on a
/// node (API-edges-dock-nodes-or-edges, *Ends*). `refused` is the first value the shell read that
/// the first pass refuses by its type, its edge's index, its field, and for a field of a label the
/// label's place, or none; an arrowhead or a side whose string names none, a side beside an end on
/// an edge or left out beside one on a node, and a path parameter outside 0 to 1 are no such
/// value, and the first pass finds them.
pub struct EdgeColumns<'a> {
    pub ids: &'a [String],
    pub id_bounds: &'a [u32],
    pub sources: &'a [String],
    pub source_bounds: &'a [u32],
    pub source_on_edge: &'a [u8],
    pub source_t: &'a [f64],
    pub targets: &'a [String],
    pub target_bounds: &'a [u32],
    pub target_on_edge: &'a [u8],
    pub target_t: &'a [f64],
    pub label_bounds: &'a [u32],
    pub label_ids: &'a [String],
    pub label_id_bounds: &'a [u32],
    pub label_texts: &'a [String],
    pub label_text_bounds: &'a [u32],
    pub label_texts_valid: &'a [u8],
    pub label_t: &'a [f64],
    pub label_offset: &'a [f64],
    pub has_background: &'a [u8],
    pub background: &'a [f64],
    pub color: &'a [f64],
    pub has_dash: &'a [u8],
    pub dash: &'a [f64],
    pub gap: &'a [f64],
    pub arrow: &'a [u8],
    pub lightning: &'a [u8],
    pub source_side: &'a [u8],
    pub target_side: &'a [u8],
    pub refused: Option<(u32, EdgeField, Option<u32>)>,
}

impl EdgeColumns<'_> {
    /// The number of edges, or a refusal as malformed where the columns do not fit together or a
    /// code is one no arrowhead or side has.
    pub(super) fn count(&self) -> Result<usize, GraphDataProblem> {
        let count = self.color.len();
        let labels = self.label_t.len();
        let numbers = [self.dash, self.gap, self.source_t, self.target_t];
        let label_numbers = [self.label_offset, self.background];
        // The presence and validity bytes, 1 or 0, then the codes.
        let bytes = [
            self.has_dash,
            self.lightning,
            self.source_on_edge,
            self.target_on_edge,
            self.arrow,
            self.source_side,
            self.target_side,
        ];
        let label_bytes = [self.label_texts_valid, self.has_background];
        let strings = [
            (self.ids, self.id_bounds),
            (self.sources, self.source_bounds),
            (self.targets, self.target_bounds),
        ];
        let label_strings = [
            (self.label_ids, self.label_id_bounds),
            (self.label_texts, self.label_text_bounds),
        ];
        let flags = |column: &&[u8]| column.iter().all(|&flag| flag <= 1);
        let fit = numbers.iter().all(|column| column.len() == count)
            && bytes.iter().all(|column| column.len() == count)
            && runs_fit(self.label_bounds, count, labels)
            && label_numbers.iter().all(|column| column.len() == labels)
            && label_bytes.iter().all(|column| column.len() == labels)
            && bytes[..4].iter().all(flags)
            && label_bytes.iter().all(flags)
            && strings
                .iter()
                .all(|&(pieces, bounds)| bounds_fit(bounds, count, pieces))
            && label_strings
                .iter()
                .all(|&(pieces, bounds)| bounds_fit(bounds, labels, pieces))
            && self
                .arrow
                .iter()
                .all(|&code| code <= ArrowCode::Unnamed as u8)
            && [self.source_side, self.target_side]
                .iter()
                .all(|column| column.iter().all(|&code| code <= SideCode::Absent as u8))
            && self.refused.is_none_or(|(index, _, label)| {
                (index as usize) < count
                    && label.is_none_or(|label| {
                        let i = index as usize;
                        label < self.label_bounds[i + 1] - self.label_bounds[i]
                    })
            });
        if fit { Ok(count) } else { Err(unfit_edges()) }
    }

    /// The field of the edge at `index` the bridge refuses itself, the first of them, or none
    /// (API-edges-dock-nodes-or-edges, *Ends*): a path parameter of an end on an edge outside 0
    /// to 1, a code that names no arrowhead or side, and a side beside an end on an edge or left
    /// out beside one on a node.
    fn unnamed(&self, index: usize) -> Option<EdgeField> {
        let on_edge = |column: &[u8]| column[index] == 1;
        let off_path = |on: &[u8], t: &[f64]| on_edge(on) && !on_the_path(t[index]);
        let side = |on: &[u8], side: &[u8]| {
            let code = side[index];
            code == SideCode::Unnamed as u8 || (code == SideCode::Absent as u8) != on_edge(on)
        };
        [
            (
                EdgeField::SourceT,
                off_path(self.source_on_edge, self.source_t),
            ),
            (
                EdgeField::TargetT,
                off_path(self.target_on_edge, self.target_t),
            ),
            (
                EdgeField::Arrow,
                self.arrow[index] == ArrowCode::Unnamed as u8,
            ),
            (
                EdgeField::SourceSide,
                side(self.source_on_edge, self.source_side),
            ),
            (
                EdgeField::TargetSide,
                side(self.target_on_edge, self.target_side),
            ),
        ]
        .into_iter()
        .find(|&(_, unnamed)| unnamed)
        .map(|(field, _)| field)
    }

    /// The first pass over the edges: the first value refused by its type, the one the shell
    /// named or an arrowhead or a side whose code names none, whichever comes first in the order
    /// of the edges and of their fields, named as an edge of the batch names it, its identifier
    /// where it was read.
    pub(super) fn first_refused(&self, count: usize) -> Result<(), GraphDataProblem> {
        let last = self
            .refused
            .map_or(count, |(index, _, _)| index as usize + 1);
        for index in 0..last {
            let named = self.refused.filter(|&(at, _, _)| at as usize == index);
            let unnamed = self.unnamed(index);
            let first = match (named, unnamed) {
                (Some((_, field, label)), Some(unnamed)) => {
                    Some(if unnamed.min_by_order(field) == field {
                        (field, label)
                    } else {
                        (unnamed, None)
                    })
                }
                (Some((_, field, label)), None) => Some((field, label)),
                (None, unnamed) => unnamed.map(|field| (field, None)),
            };
            if let Some((field, label)) = first {
                return self.refuse(index, field, label);
            }
        }
        Ok(())
    }

    /// The refusal of `field` of the edge at `index` by its type, of the label at `label` for a
    /// field of a label.
    fn refuse(
        &self,
        index: usize,
        field: EdgeField,
        label: Option<u32>,
    ) -> Result<(), GraphDataProblem> {
        if field == EdgeField::Item {
            return Err(unshaped("an edge is no object"));
        }
        let id = (field != EdgeField::Id).then(|| value_at(self.ids, self.id_bounds, index));
        let mut item = Item::new(GraphList::Edges, index);
        item.id = id.as_deref();
        match label {
            Some(label) => item.label_field(field, label as usize, Field::<()>(None)),
            None => item.edge(field, Field::<()>(None)),
        }
    }

    /// The UTF-16 code units of the identifier, the source, and the target of each edge, the
    /// fields that name them, and of the identifier of each of its labels, read off their
    /// boundaries.
    pub(super) fn id_lengths(
        &self,
    ) -> impl Iterator<Item = (IdLengths, impl Iterator<Item = usize> + '_)> + '_ {
        lengths(self.id_bounds)
            .zip(lengths(self.source_bounds))
            .zip(lengths(self.target_bounds))
            .zip(self.label_bounds.windows(2))
            .enumerate()
            .map(|(i, (((id, source), target), labels))| {
                let ids = &self.label_id_bounds[labels[0] as usize..=labels[1] as usize];
                let named = IdLengths {
                    lengths: [id, source, target],
                    on_edge: [self.source_on_edge[i] == 1, self.target_on_edge[i] == 1],
                };
                (named, lengths(ids))
            })
    }

    /// The edges with every field read, their identifiers, sources, and targets, and their
    /// labels' identifiers, mapped onto the strings Rust holds.
    pub(super) fn edges(&self) -> Result<Vec<Edge<'_>>, GraphDataProblem> {
        let ids = values(self.ids, self.id_bounds)?;
        let sources = values(self.sources, self.source_bounds)?;
        let targets = values(self.targets, self.target_bounds)?;
        let label_ids = values(self.label_ids, self.label_id_bounds)?;
        let texts: Vec<usize> = lengths(self.label_text_bounds).collect();
        let present = |column: &[u8], i: usize| column[i] == 1;
        let label = |k: usize| Label {
            id: label_ids[k],
            text_length: present(self.label_texts_valid, k).then_some(texts[k]),
            t: self.label_t[k],
            offset: self.label_offset[k],
            background: present(self.has_background, k).then(|| self.background[k]),
        };
        ids.into_iter()
            .zip(sources)
            .zip(targets)
            .enumerate()
            .map(|(i, ((id, source), target))| {
                let labels = (self.label_bounds[i] as usize..self.label_bounds[i + 1] as usize)
                    .map(label)
                    .collect();
                let end = |id, on: &[u8], t: &[f64], side: &[u8]| {
                    if present(on, i) {
                        Some(EndRead::Edge { id, t: t[i] })
                    } else {
                        side_of(side[i]).map(|dock| EndRead::Node { id, dock })
                    }
                };
                let (Some(arrow), Some(source), Some(target)) = (
                    arrow_of(self.arrow[i]),
                    end(source, self.source_on_edge, self.source_t, self.source_side),
                    end(target, self.target_on_edge, self.target_t, self.target_side),
                ) else {
                    // The first pass refused every code that names none.
                    return Err(unfit_edges());
                };
                Ok(Edge {
                    id,
                    source,
                    target,
                    labels,
                    color: self.color[i],
                    dash: present(self.has_dash, i).then(|| [self.dash[i], self.gap[i]]),
                    arrow,
                    lightning: present(self.lightning, i),
                })
            })
            .collect()
    }
}

// The malformed-data tests of graph data verify API-bridge-takes-serde-and-columns (see
// `graph_data::tests`). Verifies: API-bridge-takes-serde-and-columns
#[cfg(test)]
mod tests {
    use super::super::tests::{d_and, label_in, label_named, labelled, labels_in, load_edges};
    use super::super::{EdgeCells, OwnedEdgeColumns};
    use super::*;

    #[test]
    fn every_refusal_of_an_edge_crosses_as_columns_with_its_kind_and_names() {
        // Verifies: API-bridge-takes-serde-and-columns
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
        let given = |value: &str| Field(Some(Some(value.to_owned())));
        // A field missing or of another type, or an identifier with a lone surrogate, which the
        // snapshot hands over as `false`: the column holds none of it, and names its position.
        type Change = fn(&mut EdgeCells);
        let by_type: [(Change, &str, &str); 11] = [
            (|e| e.id = Field(None), "id", AN_ID),
            (|e| e.source = Field(None), "source", AN_ID),
            (|e| e.target = Field(None), "target", AN_ID),
            (|e| e.labels = Field(None), "labels", A_LABELS),
            (
                |e| label_in(e).t = Field(None),
                "labels[0].t",
                A_NUMBER_OR_NONE,
            ),
            (|e| e.color = Field(None), "color", A_COLOR),
            (|e| e.dash = Field(None), "dash", A_DASH),
            (|e| e.arrow = Field(None), "arrow", AN_ARROW),
            (|e| e.lightning = Field(None), "lightning", A_FLAG),
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
            // place, a side outside the five naming the five.
            (
                d_and(|e| e.arrow = text("start")),
                field("arrow", Some(e()), AN_ARROW),
            ),
            (
                d_and(|e| e.source_side = given("middle")),
                field("sourceSide", Some(e()), A_SIDE),
            ),
            (
                d_and(|e| e.target_side = given("")),
                field("targetSide", Some(e()), A_SIDE),
            ),
            // The first of an edge's fields refused, in the order an edge is read, whether the
            // shell named it or its code names nothing.
            (
                d_and(|e| (e.target_side, e.arrow) = (Field(None), text("start"))),
                field("arrow", Some(e()), AN_ARROW),
            ),
            (
                d_and(|e| (e.source_side, e.color) = (given("middle"), Field(None))),
                field("color", Some(e()), A_COLOR),
            ),
            (
                d_and(|e| (e.target_side, e.source_side) = (given("up"), Field(None))),
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
    fn a_stale_label_and_each_label_refused_by_its_type_cross_named_by_its_place() {
        // Verifies: API-edges-dock-nodes-or-edges, API-bridge-columns-carry-nesting
        let field = |field: &str, expected: &str| GraphDataProblem::InvalidField {
            list: GraphList::Edges,
            index: 1,
            id: Some("e".into()),
            field: field.into(),
            expected: expected.into(),
        };
        type Change = fn(&mut EdgeCells);
        let cases: [(Change, &str, &str); 7] = [
            // An edge that still carries `label`, which `labels` replaced, before its labels.
            (
                |e| (e.label, e.labels) = (true, Field(None)),
                "label",
                NO_LABEL,
            ),
            (|e| e.labels = Field(None), "labels", A_LABELS),
            (|e| labels_in(e).push(Field(None)), "labels[1]", A_LABEL),
            (|e| label_in(e).id = Field(None), "labels[0].id", AN_ID),
            (
                |e| label_in(e).t = Field(None),
                "labels[0].t",
                A_NUMBER_OR_NONE,
            ),
            (
                |e| label_in(e).offset = Field(None),
                "labels[0].offset",
                A_NUMBER_OR_NONE,
            ),
            // The second label's field, named by its place, before the edge's colour.
            (
                |e| {
                    let mut second = label_named("n");
                    second.0.as_mut().unwrap().t = Field(None);
                    labels_in(e).push(second);
                    e.color = Field(None);
                },
                "labels[1].t",
                A_NUMBER_OR_NONE,
            ),
        ];
        for (change, name, expected) in cases {
            assert_eq!(
                load_edges(&d_and(change)).err(),
                Some(field(name, expected))
            );
        }
    }

    #[test]
    fn each_of_the_four_sides_and_the_outline_crosses_as_where_the_end_docks() {
        // Verifies: API-edges-dock-side-or-outline
        let given = |value: &str| Field(Some(Some(value.to_owned())));
        for (name, dock) in [
            ("top", Side::Top.into()),
            ("right", Side::Right.into()),
            ("bottom", Side::Bottom.into()),
            ("left", Side::Left.into()),
            ("outline", Dock::Outline),
        ] {
            let graph = load_edges(&d_and(|e| {
                (e.source_side, e.target_side) = (given(name), given("outline"));
            }))
            .unwrap();
            let sides = graph.edge(1).unwrap().sides;
            assert_eq!(
                (sides.source, sides.target),
                (dock, Dock::Outline),
                "{name}"
            );
        }
        // Edge `d` names its sides as `labelled` left them: from the right to the left.
        assert_eq!(
            load_edges(&d_and(|_| {})).unwrap().edge(0).unwrap().sides,
            comb_engine::geometry::Sides::default()
        );
    }

    #[test]
    fn edge_columns_that_do_not_fit_together_are_refused_as_malformed() {
        // Verifies: API-bridge-takes-serde-and-columns
        let changes: [fn(&mut OwnedEdgeColumns); 27] = [
            |c| _ = c.color.pop(),
            // A presence or validity byte is 1 or 0.
            |c| c.label_texts_valid[0] = 2,
            |c| c.has_background[1] = u8::MAX,
            |c| c.has_dash[0] = 2,
            |c| c.lightning[1] = 2,
            |c| _ = c.lightning.pop(),
            // The boundaries of each edge's labels start at 0, never fall, and end at the labels'
            // count, by which each column of the labels is as long.
            |c| c.label_bounds = vec![0, 1],
            |c| c.label_bounds = vec![1, 1, 2],
            |c| c.label_bounds = vec![0, 2, 1],
            |c| c.label_bounds = vec![0, 1, 3],
            |c| _ = c.label_t.pop(),
            |c| _ = c.has_background.pop(),
            |c| c.label_ids.push("x".to_owned()),
            |c| _ = c.gap.pop(),
            |c| _ = c.has_dash.pop(),
            |c| _ = c.target_side.pop(),
            |c| _ = c.source_bounds.pop(),
            |c| c.target_bounds = vec![0, 2, 1],
            |c| c.label_texts.push("x".to_owned()),
            |c| c.arrow[0] = ArrowCode::Unnamed as u8 + 1,
            |c| c.source_side[1] = SideCode::Absent as u8 + 1,
            // Whether an end lies on an edge is 1 or 0, and its path parameter is one per edge.
            |c| c.source_on_edge[0] = 2,
            |c| _ = c.target_on_edge.pop(),
            |c| _ = c.source_t.pop(),
            |c| c.target_t.push(0.5),
            |c| c.refused = Some((2, EdgeField::Id, None)),
            // A label refused past its edge's labels.
            |c| c.refused = Some((1, EdgeField::LabelT, Some(1))),
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
        assert_eq!(edge_refused_of(Some(0), None, None), Err(unfit_edges()));
        assert_eq!(edge_refused_of(None, None, None), Ok(None));
        assert_eq!(edge_refused_of(None, None, Some(0)), Err(unfit_edges()));
        // Every field by its code, a field of a label with its place and no other without one,
        // and a code no field has refused as malformed.
        for field in EdgeField::ALL {
            let label = field.of_a_label().then_some(2);
            assert_eq!(
                edge_refused_of(Some(1), Some(field as u32), label),
                Ok(Some((1, field, label)))
            );
            let other = if field.of_a_label() { None } else { Some(2) };
            assert_eq!(
                edge_refused_of(Some(1), Some(field as u32), other),
                Err(unfit_edges())
            );
        }
        for code in [20, 255, u32::MAX] {
            assert_eq!(
                edge_refused_of(Some(0), Some(code), None),
                Err(unfit_edges())
            );
        }
    }

    #[test]
    fn a_later_edge_refused_by_its_type_is_named_before_an_earlier_one_refused_by_a_rule() {
        // Verifies: API-bridge-takes-serde-and-columns
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
            Some(GraphDataProblem::InvalidLabelText {
                edge: "d".into(),
                label: "m".into()
            })
        );
    }
}
