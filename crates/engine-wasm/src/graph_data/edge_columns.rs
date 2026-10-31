//! The edges of a load as columns (ADR-0034): the fields an edge reads in their order, the codes
//! of its arrowhead and sides, whether the columns fit together, the first value refused by its
//! type, and the edges read off them.

use comb_engine::geometry::{self as graph_side, Sides};
use wasm_bindgen::prelude::wasm_bindgen;

use super::item::{Edge, Item, Label};
use super::problem::{A_COLOR, A_DASH, A_LABEL, A_NUMBER, A_SIDE, AN_ARROW, AN_ID};
use super::{
    Arrow, Field, GraphDataProblem, GraphList, bounds_fit, lengths, malformed, refused_by,
    unshaped, value_at, values,
};

/// Columns of the edges that do not fit together, which the shell never hands over.
pub(super) fn unfit_edges() -> GraphDataProblem {
    malformed("the columns of the edges do not fit together")
}

/// The first value of the edges the shell found refused by its type, as `loadGraph` takes it:
/// the index of its edge and the code of its `EdgeField`, both or neither, and a code no field
/// has refused as malformed.
pub(crate) fn edge_refused_of(
    at: Option<u32>,
    field: Option<u32>,
) -> Result<Option<(u32, EdgeField)>, GraphDataProblem> {
    refused_by(at, field, &EdgeField::ALL, unfit_edges)
}

/// A field of an edge that a load's first pass refuses by its type (ADR-0034), in the order an
/// edge's fields are read, as the shell names the first such value it reads: `Item` for an edge
/// that is no object, refused as malformed. It crosses as its code, a plain number, as
/// `NodeField` does.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EdgeField {
    Item,
    Id,
    Source,
    Target,
    Label,
    LabelT,
    LabelOffset,
    Color,
    Dash,
    Arrow,
    SourceSide,
    TargetSide,
}

impl EdgeField {
    pub(super) const ALL: [Self; 12] = [
        Self::Item,
        Self::Id,
        Self::Source,
        Self::Target,
        Self::Label,
        Self::LabelT,
        Self::LabelOffset,
        Self::Color,
        Self::Dash,
        Self::Arrow,
        Self::SourceSide,
        Self::TargetSide,
    ];

    /// The field's name as a refusal names it, and what it expects.
    pub(super) fn named(self) -> (&'static str, &'static str) {
        match self {
            Self::Item => ("", ""),
            Self::Id => ("id", AN_ID),
            Self::Source => ("source", AN_ID),
            Self::Target => ("target", AN_ID),
            Self::Label => ("label", A_LABEL),
            Self::LabelT => ("label.t", A_NUMBER),
            Self::LabelOffset => ("label.offset", A_NUMBER),
            Self::Color => ("color", A_COLOR),
            Self::Dash => ("dash", A_DASH),
            Self::Arrow => ("arrow", AN_ARROW),
            Self::SourceSide => ("sourceSide", A_SIDE),
            Self::TargetSide => ("targetSide", A_SIDE),
        }
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

/// The code of an edge's arrowhead in its column (ADR-0034): `Unnamed` for a string that names
/// neither, which the first pass refuses at its place.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArrowCode {
    End,
    None,
    Unnamed,
}

/// The code of a side of an edge in its column (ADR-0034): `Unnamed` for a string that names
/// none of the four, which the first pass refuses at its place.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SideCode {
    Top,
    Right,
    Bottom,
    Left,
    Unnamed,
}

/// The arrowhead of `code`, or none for `Unnamed` and for a code no arrowhead has.
fn arrow_of(code: u8) -> Option<Arrow> {
    [(ArrowCode::End, Arrow::End), (ArrowCode::None, Arrow::None)]
        .into_iter()
        .find(|&(of, _)| of as u8 == code)
        .map(|(_, arrow)| arrow)
}

/// The side of `code`, or none for `Unnamed` and for a code no side has.
fn side_of(code: u8) -> Option<graph_side::Side> {
    use graph_side::Side;
    [
        (SideCode::Top, Side::Top),
        (SideCode::Right, Side::Right),
        (SideCode::Bottom, Side::Bottom),
        (SideCode::Left, Side::Left),
    ]
    .into_iter()
    .find(|&(of, _)| of as u8 == code)
    .map(|(_, side)| side)
}

/// The edges of one load as columns (ADR-0034), each in slot order. The identifiers, sources,
/// targets, and label texts are each the values concatenated and cut into pieces, each ending
/// where a value ends, with their boundaries in UTF-16 code units across all pieces, one more
/// than there are edges, a refused or absent value empty;
/// `label_texts` holds per edge whether its label's text is a text, 1 or 0. `has_label`,
/// `has_background`, and `has_dash` hold per edge whether it has one, 1 or 0; where it has none,
/// the columns of its values hold anything. The numbers are as the host application handed them,
/// a background of another type NaN; the arrowhead and the sides as their codes. `refused` is
/// the first value the shell read that the first pass refuses by its type, its edge's index and
/// its field, or none; an arrowhead or a side whose string names none is no such value, and the
/// first pass finds its code.
pub struct EdgeColumns<'a> {
    pub ids: &'a [String],
    pub id_bounds: &'a [u32],
    pub sources: &'a [String],
    pub source_bounds: &'a [u32],
    pub targets: &'a [String],
    pub target_bounds: &'a [u32],
    pub has_label: &'a [u8],
    pub labels: &'a [String],
    pub label_bounds: &'a [u32],
    pub label_texts: &'a [u8],
    pub label_t: &'a [f64],
    pub label_offset: &'a [f64],
    pub has_background: &'a [u8],
    pub background: &'a [f64],
    pub color: &'a [f64],
    pub has_dash: &'a [u8],
    pub dash: &'a [f64],
    pub gap: &'a [f64],
    pub arrow: &'a [u8],
    pub source_side: &'a [u8],
    pub target_side: &'a [u8],
    pub refused: Option<(u32, EdgeField)>,
}

impl EdgeColumns<'_> {
    /// The number of edges, or a refusal as malformed where the columns do not fit together or a
    /// code is one no arrowhead or side has.
    pub(super) fn count(&self) -> Result<usize, GraphDataProblem> {
        let count = self.color.len();
        let numbers = [
            self.label_t,
            self.label_offset,
            self.background,
            self.dash,
            self.gap,
        ];
        // The presence and validity bytes, 1 or 0, then the codes.
        let bytes = [
            self.has_label,
            self.label_texts,
            self.has_background,
            self.has_dash,
            self.arrow,
            self.source_side,
            self.target_side,
        ];
        let strings = [
            (self.ids, self.id_bounds),
            (self.sources, self.source_bounds),
            (self.targets, self.target_bounds),
            (self.labels, self.label_bounds),
        ];
        let fit = numbers.iter().all(|column| column.len() == count)
            && bytes.iter().all(|column| column.len() == count)
            && bytes[..4]
                .iter()
                .all(|column| column.iter().all(|&flag| flag <= 1))
            && strings
                .iter()
                .all(|&(pieces, bounds)| bounds_fit(bounds, count, pieces))
            && self
                .arrow
                .iter()
                .all(|&code| code <= ArrowCode::Unnamed as u8)
            && [self.source_side, self.target_side]
                .iter()
                .all(|column| column.iter().all(|&code| code <= SideCode::Unnamed as u8))
            && self
                .refused
                .is_none_or(|(index, _)| (index as usize) < count);
        if fit { Ok(count) } else { Err(unfit_edges()) }
    }

    /// The field of the edge at `index` whose code names no arrowhead or side, the first of
    /// them, or none.
    fn unnamed(&self, index: usize) -> Option<EdgeField> {
        [
            (
                EdgeField::Arrow,
                self.arrow[index] == ArrowCode::Unnamed as u8,
            ),
            (
                EdgeField::SourceSide,
                self.source_side[index] == SideCode::Unnamed as u8,
            ),
            (
                EdgeField::TargetSide,
                self.target_side[index] == SideCode::Unnamed as u8,
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
        let last = self.refused.map_or(count, |(index, _)| index as usize + 1);
        for index in 0..last {
            let named = self
                .refused
                .filter(|&(at, _)| at as usize == index)
                .map(|(_, field)| field);
            let first = match (named, self.unnamed(index)) {
                (Some(named), Some(unnamed)) => Some(named.min_by_order(unnamed)),
                (named, unnamed) => named.or(unnamed),
            };
            if let Some(field) = first {
                return self.refuse(index, field);
            }
        }
        Ok(())
    }

    /// The refusal of `field` of the edge at `index` by its type.
    fn refuse(&self, index: usize, field: EdgeField) -> Result<(), GraphDataProblem> {
        if field == EdgeField::Item {
            return Err(unshaped("an edge is no object"));
        }
        let id = (field != EdgeField::Id).then(|| value_at(self.ids, self.id_bounds, index));
        let mut item = Item::new(GraphList::Edges, index);
        item.id = id.as_deref();
        item.edge(field, Field::<()>(None))
    }

    /// The UTF-16 code units of the identifier, the source, and the target of each edge, read
    /// off their boundaries.
    pub(super) fn id_lengths(&self) -> impl Iterator<Item = [usize; 3]> + '_ {
        lengths(self.id_bounds)
            .zip(lengths(self.source_bounds))
            .zip(lengths(self.target_bounds))
            .map(|((id, source), target)| [id, source, target])
    }

    /// The edges with every field read, their identifiers, sources, and targets mapped onto the
    /// strings Rust holds.
    pub(super) fn edges(&self) -> Result<Vec<Edge<'_>>, GraphDataProblem> {
        let ids = values(self.ids, self.id_bounds)?;
        let sources = values(self.sources, self.source_bounds)?;
        let targets = values(self.targets, self.target_bounds)?;
        let texts = lengths(self.label_bounds).zip(self.label_texts);
        let present = |column: &[u8], i: usize| column[i] == 1;
        ids.into_iter()
            .zip(sources)
            .zip(targets)
            .zip(texts)
            .enumerate()
            .map(|(i, (((id, source), target), (length, &text)))| {
                let label = present(self.has_label, i).then(|| Label {
                    text_length: (text == 1).then_some(length),
                    t: self.label_t[i],
                    offset: self.label_offset[i],
                    background: present(self.has_background, i).then(|| self.background[i]),
                });
                let (Some(arrow), Some(source_side), Some(target_side)) = (
                    arrow_of(self.arrow[i]),
                    side_of(self.source_side[i]),
                    side_of(self.target_side[i]),
                ) else {
                    // The first pass refused every code that names none.
                    return Err(unfit_edges());
                };
                Ok(Edge {
                    id,
                    source,
                    target,
                    label,
                    color: self.color[i],
                    dash: present(self.has_dash, i).then(|| [self.dash[i], self.gap[i]]),
                    arrow,
                    sides: Sides {
                        source: source_side,
                        target: target_side,
                    },
                })
            })
            .collect()
    }
}
