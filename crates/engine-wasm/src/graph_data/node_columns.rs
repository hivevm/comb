//! The nodes of a load as columns (API-bridge-columns-carry-nesting): the codes of their node
//! shapes, whether they fit together, the first value refused by its type, and the nodes read off
//! them.

use comb_engine::graph::{CANVAS, Nesting};
use comb_engine::shape::NodeShape;
use wasm_bindgen::prelude::wasm_bindgen;

use super::edge_columns::SideCode;
use super::item::{Border, Item, Node};
use super::problem::{
    A_BORDER_SIDE, A_CONTENT, A_DIVIDE, A_FLAG, A_HEIGHT, A_NODE_ID_OR_NONE, A_NUMBER,
    A_REGION_LIST, A_SHAPE, A_SIZE, AN_ID, AN_ID_OR_NONE, AN_OUTLINE,
};
use super::{
    ContentColumns, Field, GraphDataProblem, GraphList, RegionColumns, Unflat, bounds_fit,
    malformed, numbered, refused_by, unshaped, value_at, values,
};
use super::{Outline, Pair, Side};

/// A field of a node that a load's first pass refuses by its type
/// (API-bridge-columns-carry-nesting), in the order a node's fields are read, as the shell names
/// the first such value it reads: `Item` for a node that is no object, refused as malformed;
/// `Content` for content that is no list; and of the shapes of content the snapshot cannot flatten,
/// `Row` for a row that is no list, `Element` for an element that is no object, `Segments` for a
/// progress bar's segments that are no list, and `Segment` for a segment that is no object. It
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
    Height,
    Shape,
    Outline,
    Container,
    IsContainer,
    Resizable,
    Divide,
    Regions,
    AttachedTo,
    Side,
    Offset,
    Content,
    Row,
    Element,
    Segments,
    Segment,
}

/// The code of a node's node shape in its column (API-bridge-columns-carry-nesting): the place of
/// the node shape in `NodeShape::ALL`, and `Unnamed` for a value that names none, which the first
/// pass refuses at its place.
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
    Pentagon,
    NotchedRectangle,
    Note,
    Frame,
    CrossedCircle,
    Cross,
    Actor,
    Hourglass,
    Unnamed,
}

/// The code of how a node's outline is drawn in its column (API-bridge-columns-carry-nesting):
/// solid, which a node that leaves it out is, none, dashed by the dash and the gap of its columns,
/// and `Unnamed` for a string that names none, which the first pass refuses at its place.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutlineCode {
    Solid,
    None,
    Dashed,
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

/// The nodes of one load as columns (API-bridge-columns-carry-nesting), each in slot order. The
/// identifiers are the values concatenated and cut into pieces, each ending where a value ends,
/// with their boundaries in UTF-16 code units across all pieces, one more than there are nodes, a
/// refused value empty. The numbers are as the host application handed them; the node shapes as
/// their codes; a node's container as whether it names one, 1 or 0, and the slot of the node it
/// names, which the snapshot found by its identifier, or one past the slots where it names none,
/// and its mark as a container as 1 or 0 (API-bridge-columns-carry-nesting); its height as whether
/// its data gives one, 1 or 0, and the number given, and whether it is resizable as 1 or 0
/// (API-edits-report-nested-changes); the content crosses
/// as the columns of `ContentColumns`. `refused` is the first value the shell read that the first
/// pass refuses, or none; a node shape that names none is no such value, and the first pass finds
/// its code.
pub struct NodeColumns<'a> {
    pub ids: &'a [String],
    pub id_bounds: &'a [u32],
    pub x: &'a [f64],
    pub y: &'a [f64],
    pub width: &'a [f64],
    pub has_height: &'a [u8],
    pub height: &'a [f64],
    pub shape: &'a [u8],
    /// How each node's outline is drawn, as the code of `OutlineCode`, and the dash and the gap
    /// of a dashed one as handed over, 0 for another (REN-node-shapes-cover-uml).
    pub outline: &'a [u8],
    pub outline_dash: &'a [f64],
    pub outline_gap: &'a [f64],
    pub has_container: &'a [u8],
    pub container: &'a [u32],
    pub is_container: &'a [u8],
    pub resizable: &'a [u8],
    /// The direction each node is divided in, as the code `divide_code` gives it, and the
    /// regions of the load (ARCH-regions-are-container-slots).
    pub divide: &'a [u8],
    pub regions: RegionColumns<'a>,
    /// Per node whether it is a border node, 1 or 0; the slot of the node it is attached to,
    /// which the snapshot found by its identifier among the nodes, or `CANVAS` where it names
    /// none; its side as the code of `SideCode`; its offset as handed over; and the first of its
    /// `x`, `y`, and `container` that stands beside its `attachedTo`, 1, 2, and 3, or of a node
    /// that is no border node its `side` or `offset`, 4 or 5, or 0
    /// (ARCH-border-nodes-ride-sides). `attached_missing` is the identifier the first border
    /// node attached to no node names, in slot order.
    pub has_attached: &'a [u8],
    pub attached: &'a [u32],
    pub side: &'a [u8],
    pub offset: &'a [f64],
    pub beside: &'a [u8],
    pub attached_missing: Option<&'a str>,
    pub content: ContentColumns<'a>,
    pub refused: Option<Refused>,
}

/// The fields of a node that may stand beside its `attachedTo`, by their codes in `beside`.
/// Of a node that is no border node, a `side` or an `offset` it may not have.
const BESIDE: [Option<&str>; 6] = [
    None,
    Some("x"),
    Some("y"),
    Some("container"),
    Some("side"),
    Some("offset"),
];

/// Columns of the nodes that do not fit together, which the shell never hands over.
pub(super) fn unfit() -> GraphDataProblem {
    malformed("the columns of the nodes do not fit together")
}

impl NodeField {
    pub(super) const ALL: [Self; 21] = [
        Self::Item,
        Self::Id,
        Self::X,
        Self::Y,
        Self::Width,
        Self::Height,
        Self::Shape,
        Self::Outline,
        Self::Container,
        Self::IsContainer,
        Self::Resizable,
        Self::Divide,
        Self::Regions,
        Self::AttachedTo,
        Self::Side,
        Self::Offset,
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
        let numbers = [
            self.y,
            self.width,
            self.height,
            self.outline_dash,
            self.outline_gap,
        ]
        .map(<[f64]>::len);
        let flags = [
            self.has_container,
            self.is_container,
            self.has_height,
            self.resizable,
        ];
        let missing = (0..self.attached.len())
            .any(|i| self.has_attached[i] == 1 && self.attached[i] == CANVAS);
        let bordered = self.has_attached.len() == count
            && self.attached.len() == count
            && self.side.len() == count
            && self.offset.len() == count
            && self.beside.len() == count
            && self.has_attached.iter().all(|&byte| byte <= 1)
            && self
                .side
                .iter()
                .all(|&code| code <= SideCode::Unnamed as u8)
            && self
                .beside
                .iter()
                .all(|&code| usize::from(code) < BESIDE.len())
            && missing == self.attached_missing.is_some();
        let fit = bordered
            && numbers.iter().all(|&len| len == count)
            && self.shape.len() == count
            && self.outline.len() == count
            && self
                .outline
                .iter()
                .all(|&code| code <= OutlineCode::Unnamed as u8)
            && self.container.len() == count
            && self.divide.len() == count
            && self.divide.iter().all(|&code| code <= 2)
            && flags
                .iter()
                .all(|flag| flag.len() == count && flag.iter().all(|&byte| byte <= 1))
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
        // A node shape or an outline that names none, or a border node's side that names no side
        // of a box.
        let unnamed = (0..last).find_map(|index| {
            if self.shape[index] == NodeShapeCode::Unnamed as u8 {
                Some(self.code_at(index, NodeField::Shape))
            } else if self.outline_at(index).is_err() {
                Some(self.code_at(index, NodeField::Outline))
            } else if self.has_attached[index] == 1 && self.side[index] > SideCode::Left as u8 {
                Some(self.code_at(index, NodeField::Side))
            } else {
                None
            }
        });
        let refused = match (self.refused, unnamed) {
            // A code that names none, at a node before the one the shell named, or at that node
            // before the field it named.
            (Some(refused), Some(code))
                if code.index < refused.index
                    || (code.index == refused.index
                        && (code.field as u32) < (refused.field as u32)) =>
            {
                code
            }
            (None, Some(code)) => code,
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
            NodeField::Height => ("height", A_HEIGHT),
            NodeField::Shape => ("shape", A_SHAPE),
            NodeField::Outline => ("outline", AN_OUTLINE),
            NodeField::Container => ("container", AN_ID_OR_NONE),
            NodeField::IsContainer => ("isContainer", A_FLAG),
            NodeField::Resizable => ("resizable", A_FLAG),
            NodeField::Divide => ("divide", A_DIVIDE),
            NodeField::Regions => ("regions", A_REGION_LIST),
            NodeField::AttachedTo => ("attachedTo", A_NODE_ID_OR_NONE),
            NodeField::Side => ("side", A_BORDER_SIDE),
            NodeField::Offset => ("offset", A_NUMBER),
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

    /// How the outline of the node at `index` is drawn, as the engine keeps it, or its refusal: a
    /// code that names none, or a dash pattern an edge's rule refuses, either of which the first
    /// pass names at its place (REN-node-shapes-cover-uml, *Outline*).
    fn outline_at(&self, index: usize) -> Result<comb_engine::shape::Outline, GraphDataProblem> {
        let code = self.outline[index];
        let outline = if code == OutlineCode::Solid as u8 {
            Outline::Solid
        } else if code == OutlineCode::None as u8 {
            Outline::None
        } else if code == OutlineCode::Dashed as u8 {
            Outline::Dashed(Pair([self.outline_dash[index], self.outline_gap[index]]))
        } else {
            return Err(unfit());
        };
        super::checks::outline_of("", index, outline)
    }

    /// The refusal of the field `field` of the node at `index`, whose code names none.
    fn code_at(&self, index: usize, field: NodeField) -> Refused {
        Refused {
            index: numbered(index),
            field,
            row: None,
            column: None,
        }
    }

    /// Which node each of the `count` nodes lies in and which are containers, as the engine takes
    /// it (ARCH-engine-edits-nested-graph): a container that names no node, beyond the `slots`
    /// of the nodes and the regions after them, as the slot one past them, which
    /// `Nesting::check` refuses.
    pub(super) fn nesting(&self, count: usize, slots: usize) -> Nesting {
        let past = numbered(slots);
        let containers = (0..count)
            .map(|i| match self.has_container[i] {
                0 => CANVAS,
                _ => self.container[i].min(past),
            })
            .collect();
        let is_container = self.is_container.iter().map(|&mark| mark == 1).collect();
        Nesting {
            containers,
            is_container,
        }
    }

    /// The field, `side` or `offset`, that the node at `index`, no border node, may not have, or
    /// none (ARCH-border-nodes-ride-sides).
    pub(super) fn not_border(&self, index: usize) -> Option<&'static str> {
        let beside = usize::from(self.beside[index]);
        (self.has_attached[index] == 0 && beside >= 4)
            .then(|| BESIDE[beside])
            .flatten()
    }

    /// The nodes with every field read, their identifiers mapped onto the string Rust holds.
    pub(super) fn nodes(&self) -> Result<Vec<Node<'_>>, GraphDataProblem> {
        let ids = values(self.ids, self.id_bounds)?;
        ids.into_iter()
            .enumerate()
            .map(|(i, id)| {
                // The first pass refused every code that names none.
                let shape = NodeShape::of_code(self.shape[i]).ok_or_else(unfit)?;
                // The first pass refused every side of a border node that names none.
                let border = (self.has_attached[i] == 1)
                    .then(|| {
                        let side = Side::ALL.get(usize::from(self.side[i])).ok_or_else(unfit)?;
                        Ok::<_, GraphDataProblem>(Border {
                            side: (*side).into(),
                            offset: self.offset[i],
                            beside: BESIDE[usize::from(self.beside[i])],
                        })
                    })
                    .transpose()?;
                // A border node has no position of its own.
                let at = |values: &[f64]| if border.is_some() { 0.0 } else { values[i] };
                Ok(Node {
                    id,
                    x: at(self.x),
                    y: at(self.y),
                    border,
                    width: self.width[i],
                    height: (self.has_height[i] == 1).then(|| self.height[i]),
                    resizable: self.resizable[i] == 1,
                    shape,
                    // The first pass refused every outline that names none or is refused.
                    outline: self.outline_at(i).map_err(|_| unfit())?,
                    is_container: false,
                })
            })
            .collect()
    }
}

// The malformed-data tests of graph data verify API-bridge-columns-carry-nesting (see
// `graph_data::tests`). Verifies: API-bridge-columns-carry-nesting
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
        // Verifies: API-bridge-columns-carry-nesting
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
            b.end_row(false);
            b.push(title.0, title.1, title.2, title.3, Some("t"), None);
            b.push(KindCode::Progress, 1.0, 0, f64::NAN, None, None);
            b.end_row(false);
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
        content.end_row(false);
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
        // Verifies: API-bridge-columns-carry-nesting
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
        // Verifies: API-bridge-columns-carry-nesting
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
        // Verifies: API-bridge-columns-carry-nesting
        let fits = || a_and(|_| {});
        let changes: [fn(&mut OwnedColumns); 17] = [
            |c| _ = c.x.pop(),
            |c| _ = c.height.pop(),
            |c| _ = c.has_height.pop(),
            |c| _ = c.resizable.pop(),
            |c| c.resizable[0] = 2,
            |c| _ = c.has_container.pop(),
            |c| _ = c.container.pop(),
            |c| _ = c.is_container.pop(),
            |c| c.has_container[0] = 2,
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
        for code in [NodeField::ALL.len() as u32, 255, u32::MAX] {
            assert_eq!(refused_of(Some(0), Some(code), None, None), Err(unfit()));
        }
    }
}
