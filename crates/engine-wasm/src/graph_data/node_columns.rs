//! The nodes of a load as columns (ADR-0034): whether they fit together, the first value the
//! shell refused by its type, and the nodes read off them.

use wasm_bindgen::prelude::wasm_bindgen;

use super::item::{Item, Node};
use super::problem::{A_CONTENT, A_NUMBER, A_SIZE, AN_ID};
use super::{
    ContentColumns, Field, GraphDataProblem, GraphList, Unflat, bounds_fit, malformed, refused_by,
    unshaped, value_at, values,
};

/// A field of a node that a load's first pass refuses by its type (ADR-0034), as the shell names
/// the first such value it reads: `Item` for a node that is no object, refused as malformed;
/// `Content` for content that is no list; and of the shapes of content the snapshot cannot
/// flatten, `Row` for a row that is no list, `Element` for an element that is no object,
/// `Segments` for a progress bar's segments that are no list, and `Segment` for a segment that is
/// no object. It
/// crosses as its code, a plain number, so that a code it does not know is refused as malformed
/// rather than thrown by the glue while the engine is borrowed, which would wedge it.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeField {
    Item,
    Id,
    X,
    Y,
    Width,
    Content,
    Row,
    Element,
    Segments,
    Segment,
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

/// The nodes of one load as columns (ADR-0034), each in slot order. The identifiers are the
/// values concatenated and cut into pieces, each ending where a value ends, with their boundaries
/// in UTF-16 code units across all pieces, one more than there are nodes, a refused value empty.
/// The numbers are as the host application handed them; the content crosses as the columns of
/// `ContentColumns`. `refused` is the first value the shell read that the first pass refuses, or
/// none.
pub struct NodeColumns<'a> {
    pub ids: &'a [String],
    pub id_bounds: &'a [u32],
    pub x: &'a [f64],
    pub y: &'a [f64],
    pub width: &'a [f64],
    pub content: ContentColumns<'a>,
    pub refused: Option<Refused>,
}

/// Columns of the nodes that do not fit together, which the shell never hands over.
pub(super) fn unfit() -> GraphDataProblem {
    malformed("the columns of the nodes do not fit together")
}

impl NodeField {
    pub(super) const ALL: [Self; 10] = [
        Self::Item,
        Self::Id,
        Self::X,
        Self::Y,
        Self::Width,
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
            && bounds_fit(self.id_bounds, count, self.ids)
            && self.content.fit(count)
            && self.refused.is_none_or(|refused| {
                (refused.index as usize) < count && refused_fits(&refused, &self.content)
            });
        if fit { Ok(count) } else { Err(unfit()) }
    }

    /// The first pass over the nodes: the first value the shell refused by its type, named as a
    /// node of the batch names it, its identifier where it was read.
    pub(super) fn first_refused(&self) -> Result<(), GraphDataProblem> {
        let Some(refused) = self.refused else {
            return Ok(());
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

    /// The nodes with every field read, their identifiers mapped onto the string Rust holds.
    pub(super) fn nodes(&self) -> Result<Vec<Node<'_>>, GraphDataProblem> {
        let ids = values(self.ids, self.id_bounds)?;
        Ok(ids
            .into_iter()
            .enumerate()
            .map(|(i, id)| Node {
                id,
                x: self.x[i],
                y: self.y[i],
                width: self.width[i],
            })
            .collect())
    }
}
