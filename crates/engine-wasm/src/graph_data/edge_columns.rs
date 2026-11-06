//! The edges of a load as columns (ADR-0010): the fields an edge reads in their order, the codes
//! of its arrowhead and sides, whether the columns fit together, the first value refused by its
//! type, and the edges read off them.

use comb_engine::geometry::{Dock, Side, Sides};
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

/// A field of an edge that a load's first pass refuses by its type (ADR-0010), in the order an
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

/// The code of an edge's arrowhead in its column (ADR-0010): `Unnamed` for a string that names
/// neither, which the first pass refuses at its place.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArrowCode {
    End,
    None,
    Unnamed,
}

/// The code of a side of an edge, or its outline, in its column (ADR-0010, ADR-0031): `Unnamed`
/// for a string that names none of the five, which the first pass refuses at its place.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SideCode {
    Top,
    Right,
    Bottom,
    Left,
    Outline,
    Unnamed,
}

/// The arrowhead of `code`, or none for `Unnamed` and for a code no arrowhead has.
fn arrow_of(code: u8) -> Option<Arrow> {
    [(ArrowCode::End, Arrow::End), (ArrowCode::None, Arrow::None)]
        .into_iter()
        .find(|&(of, _)| of as u8 == code)
        .map(|(_, arrow)| arrow)
}

/// Where the end of `code` docks, or none for `Unnamed` and for a code no side has.
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

/// The edges of one load as columns (ADR-0010), each in slot order. The identifiers, sources,
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

// The malformed-data tests of graph data verify ADR-0010 (see `graph_data::tests`).
// Verifies: ADR-0010
#[cfg(test)]
mod tests {
    use super::super::tests::{d_and, label_in, labelled, load_edges};
    use super::super::{EdgeCells, OwnedEdgeColumns};
    use super::*;

    #[test]
    fn every_refusal_of_an_edge_crosses_as_columns_with_its_kind_and_names() {
        // Verifies: ADR-0010
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
            // place, a side outside the five naming the five.
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
    fn each_of_the_four_sides_and_the_outline_crosses_as_where_the_end_docks() {
        // Verifies: ADR-0031
        let text = |value: &str| Field(Some(value.to_owned()));
        for (name, dock) in [
            ("top", Side::Top.into()),
            ("right", Side::Right.into()),
            ("bottom", Side::Bottom.into()),
            ("left", Side::Left.into()),
            ("outline", Dock::Outline),
        ] {
            let graph = load_edges(&d_and(|e| {
                (e.source_side, e.target_side) = (text(name), text("outline"));
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
            Sides::default()
        );
    }

    #[test]
    fn edge_columns_that_do_not_fit_together_are_refused_as_malformed() {
        // Verifies: ADR-0010
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

    #[test]
    fn a_later_edge_refused_by_its_type_is_named_before_an_earlier_one_refused_by_a_rule() {
        // Verifies: ADR-0010
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
