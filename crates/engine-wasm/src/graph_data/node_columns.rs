//! The nodes of a load as columns (ADR-0010): the codes of their node shapes, whether they fit
//! together, the first value refused by its type, and the nodes read off them.

use comb_engine::shape::NodeShape;
use wasm_bindgen::prelude::wasm_bindgen;

use super::item::{Item, Node};
use super::problem::{A_CONTENT, A_NUMBER, A_SHAPE, A_SIZE, AN_ID};
use super::{
    ContentColumns, Field, GraphDataProblem, GraphList, Unflat, bounds_fit, malformed, numbered,
    refused_by, unshaped, value_at, values,
};

/// A field of a node that a load's first pass refuses by its type (ADR-0010), in the order a node's
/// fields are read, as the shell names the first such value it reads: `Item` for a node that is no
/// object, refused as malformed; `Content` for content that is no list; and of the shapes of
/// content the snapshot cannot flatten, `Row` for a row that is no list, `Element` for an element
/// that is no object, `Segments` for a progress bar's segments that are no list, and `Segment` for
/// a segment that is no object. It crosses as its code, a plain number, so that a code it does not
/// know is refused as malformed rather than thrown by the glue while the engine is borrowed, which
/// would wedge it.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeField {
    Item,
    Id,
    X,
    Y,
    Width,
    Shape,
    Content,
    Row,
    Element,
    Segments,
    Segment,
}

/// The code of a node's node shape in its column (ADR-0010): the place of the node shape in
/// `NodeShape::ALL`, and `Unnamed` for a value that names none, which the first pass refuses at
/// its place.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeShapeCode {
    Rectangle,
    RoundedRectangle,
    Ellipse,
    Circle,
    RingedCircle,
    Diamond,
    Bar,
    Unnamed,
}

/// The first value of the nodes the first pass refuses, as the shell names it: the index of its
/// node, its field, and for a shape of content the row and, below a row, the column.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Refused {
    pub index: u32,
    pub field: NodeField,
    pub row: Option<u32>,
    pub column: Option<u32>,
}

/// The nodes of one load as columns (ADR-0010), each in slot order. The identifiers are the
/// values concatenated and cut into pieces, each ending where a value ends, with their boundaries
/// in UTF-16 code units across all pieces, one more than there are nodes, a refused value empty.
/// The numbers are as the host application handed them; the node shapes as their codes; the
/// content crosses as the columns of `ContentColumns`. `refused` is the first value the shell read
/// that the first pass refuses, or none; a node shape that names none is no such value, and the
/// first pass finds its code.
pub struct NodeColumns<'a> {
    pub ids: &'a [String],
    pub id_bounds: &'a [u32],
    pub x: &'a [f64],
    pub y: &'a [f64],
    pub width: &'a [f64],
    pub shape: &'a [u8],
    pub content: ContentColumns<'a>,
    pub refused: Option<Refused>,
}

/// Columns of the nodes that do not fit together, which the shell never hands over.
pub(super) fn unfit() -> GraphDataProblem {
    malformed("the columns of the nodes do not fit together")
}

impl NodeField {
    pub(super) const ALL: [Self; 11] = [
        Self::Item,
        Self::Id,
        Self::X,
        Self::Y,
        Self::Width,
        Self::Shape,
        Self::Content,
        Self::Row,
        Self::Element,
        Self::Segments,
        Self::Segment,
    ];
}

impl From<NodeField> for u32 {
    fn from(field: NodeField) -> Self {
        field as Self
    }
}

/// The first value of the nodes a load's first pass refuses, as `loadGraph` takes it: the index
/// of its node and the code of its `NodeField`, both or neither, a code no field has refused as
/// malformed, and the row and column of a shape of content, which a position that names none
/// fits only once the columns are read (`NodeColumns::count`).
pub(crate) fn refused_of(
    at: Option<u32>,
    field: Option<u32>,
    row: Option<u32>,
    column: Option<u32>,
) -> Result<Option<Refused>, GraphDataProblem> {
    let refused = refused_by(at, field, &NodeField::ALL, unfit)?;
    // A row or a column names a place in the content of a refused node only.
    if refused.is_none() && (row.is_some() || column.is_some()) {
        return Err(unfit());
    }
    Ok(refused.map(|(index, field)| Refused {
        index,
        field,
        row,
        column,
    }))
}

/// Whether `refused` names a position the content of its node holds: a row that is no list by
/// its row alone, an element that is no object by its row and column, a progress bar's segments
/// or a segment that are no list or no object by the row and column of a progress bar, and every
/// other field by neither.
fn refused_fits(refused: &Refused, content: &ContentColumns) -> bool {
    let node = refused.index as usize;
    let segments = [NodeField::Segments, NodeField::Segment];
    match (refused.field, refused.row, refused.column) {
        (NodeField::Row, Some(row), None) => content.holds(node, row, None),
        (NodeField::Element, Some(row), Some(column)) => content.holds(node, row, Some(column)),
        (field, Some(row), Some(column)) if segments.contains(&field) => {
            content.holds_progress(node, row, column)
        }
        (field, ..)
            if matches!(field, NodeField::Row | NodeField::Element)
                || segments.contains(&field) =>
        {
            false
        }
        (_, row, column) => row.is_none() && column.is_none(),
    }
}

impl NodeColumns<'_> {
    /// The number of nodes, or a refusal as malformed where the columns do not fit together.
    pub(super) fn count(&self) -> Result<usize, GraphDataProblem> {
        let count = self.x.len();
        let numbers = [self.y, self.width].map(<[f64]>::len);
        let fit = numbers.iter().all(|&len| len == count)
            && self.shape.len() == count
            && self
                .shape
                .iter()
                .all(|&code| code <= NodeShapeCode::Unnamed as u8)
            && bounds_fit(self.id_bounds, count, self.ids)
            && self.content.fit(count)
            && self.refused.is_none_or(|refused| {
                (refused.index as usize) < count && refused_fits(&refused, &self.content)
            });
        if fit { Ok(count) } else { Err(unfit()) }
    }

    /// The first pass over the nodes: the first value refused by its type, the one the shell
    /// named or a node shape whose code names none, whichever comes first in the order of the
    /// nodes and of their fields, named as a node of the batch names it, its identifier where it
    /// was read.
    pub(super) fn first_refused(&self) -> Result<(), GraphDataProblem> {
        let last = self
            .refused
            .map_or(self.shape.len(), |refused| refused.index as usize + 1);
        let unnamed = (0..last).find(|&index| self.shape[index] == NodeShapeCode::Unnamed as u8);
        let refused = match (self.refused, unnamed) {
            // A node shape that names none, at a node before the one the shell named, or at that
            // node before the field it named.
            (Some(refused), Some(index))
                if index < refused.index as usize
                    || (NodeField::Shape as u32) < (refused.field as u32) =>
            {
                self.shape_at(index)
            }
            (None, Some(index)) => self.shape_at(index),
            (Some(refused), _) => refused,
            (None, None) => return Ok(()),
        };
        let index = refused.index as usize;
        let id =
            (refused.field != NodeField::Id).then(|| value_at(self.ids, self.id_bounds, index));
        let mut item = Item::new(GraphList::Nodes, index);
        item.id = id.as_deref();
        let (name, expected) = match refused.field {
            NodeField::Item => return Err(unshaped("a node is no object")),
            NodeField::Id => ("id", AN_ID),
            NodeField::X => ("x", A_NUMBER),
            NodeField::Y => ("y", A_NUMBER),
            NodeField::Width => ("width", A_SIZE),
            NodeField::Shape => ("shape", A_SHAPE),
            NodeField::Content => ("content", A_CONTENT),
            NodeField::Row | NodeField::Element | NodeField::Segments | NodeField::Segment => {
                let unread = match refused.field {
                    NodeField::Element => Unflat::Element,
                    NodeField::Segments => Unflat::Segments,
                    NodeField::Segment => Unflat::Segment,
                    _ => Unflat::Row,
                };
                let shape = (refused.row.unwrap_or(0), refused.column);
                return Err(item.shape(shape, unread));
            }
        };
        item.read(name, Field::<()>(None), expected)
    }

    /// The refusal of the node shape of the node at `index`, which names none.
    fn shape_at(&self, index: usize) -> Refused {
        Refused {
            index: numbered(index),
            field: NodeField::Shape,
            row: None,
            column: None,
        }
    }

    /// The nodes with every field read, their identifiers mapped onto the string Rust holds.
    pub(super) fn nodes(&self) -> Result<Vec<Node<'_>>, GraphDataProblem> {
        let ids = values(self.ids, self.id_bounds)?;
        ids.into_iter()
            .enumerate()
            .map(|(i, id)| {
                // The first pass refused every code that names none.
                let shape = NodeShape::of_code(self.shape[i]).ok_or_else(unfit)?;
                Ok(Node {
                    id,
                    x: self.x[i],
                    y: self.y[i],
                    width: self.width[i],
                    shape,
                })
            })
            .collect()
    }
}

// The malformed-data tests of graph data verify ADR-0010 (see `graph_data::tests`).
// Verifies: ADR-0010
#[cfg(test)]
mod tests {
    use super::super::tests::{TITLE, a_and, add, added, b_of, batch, beyond, load_columns};
    use super::super::{
        ContentInput, ID_LIMIT, KindCode, MAX_ID, OwnedColumns, RoleCode, graph_of, problem::A_ROW,
        problem::A_SEGMENT_LIST, problem::AN_ELEMENT,
    };
    use super::*;
    use comb_engine::geometry::WORLD_LIMIT;

    #[test]
    fn a_progress_bar_s_segments_that_are_no_list_or_a_segment_that_is_no_object_are_refused_where_they_lie()
     {
        // Verifies: ADR-0010
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
    fn every_refusal_of_a_node_crosses_as_columns_with_its_kind_and_names() {
        // Verifies: ADR-0010
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

    #[test]
    fn a_shape_of_content_the_snapshot_cannot_flatten_is_refused_where_it_lies() {
        // Verifies: ADR-0010
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
    fn columns_that_do_not_fit_together_are_refused_as_malformed() {
        // Verifies: ADR-0010
        let fits = || a_and(|_| {});
        let changes: [fn(&mut OwnedColumns); 9] = [
            |c| _ = c.x.pop(),
            |c| _ = c.shape.pop(),
            |c| c.shape[0] = NodeShapeCode::Unnamed as u8 + 1,
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
        for code in [11, 255, u32::MAX] {
            assert_eq!(refused_of(Some(0), Some(code), None, None), Err(unfit()));
        }
    }
}
