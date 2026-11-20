//! The types of graph data the host application hands over and is handed back: a node and its
//! content and node shape, an edge and its label, and their arrowheads, sides, and dash patterns.

use std::fmt;

use comb_engine::geometry as graph_side;
use comb_engine::shape;
use serde::de::{self, IgnoredAny, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use tsify::Tsify;

use super::field::{optional_number, present, text_length};
use super::regions::{Divide, RegionInput};
use super::{ContentInput, Field};

/// A node as the host application hands it over: its identifier, the position of its top-left
/// corner, its width, its node shape, and its content, from which and its node shape the engine
/// computes its height (REN-node-content-in-rows, REN-closed-set-of-node-shapes).
// The tests read each `Field` of it through `Refusable` in `snapshot`, which names them all.
#[derive(Tsify, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    #[tsify(type = "string")]
    pub id: Field<String>,
    /// Its position, which a border node has none of: absent where left out or null, and none
    /// where of another type (ARCH-border-nodes-ride-sides).
    #[tsify(type = "number", optional)]
    #[serde(default = "Field::absent")]
    pub x: Field<Option<f64>>,
    #[tsify(type = "number", optional)]
    #[serde(default = "Field::absent")]
    pub y: Field<Option<f64>>,
    #[tsify(type = "number")]
    pub width: Field<f64>,
    /// Its node shape; `api` fills in `rectangle` (REN-closed-set-of-node-shapes).
    /// The height it is given, never less than its content needs; none where its content or
    /// its node shape alone sets it (REN-node-shapes-cover-uml).
    #[tsify(type = "number", optional)]
    pub height: Field<Option<f64>>,
    #[tsify(type = "NodeShape")]
    pub shape: Field<NodeShape>,
    /// How its outline is drawn; none where it is solid (REN-node-shapes-cover-uml, *Outline*).
    #[tsify(type = "Outline", optional)]
    #[serde(default = "Field::absent")]
    pub outline: Field<Option<Outline>>,
    /// The identifier of the container it lies in, which `api` resolves to a slot; none on the
    /// canvas (ARCH-engine-edits-nested-graph).
    #[tsify(type = "string", optional)]
    pub container: Field<Option<String>>,
    /// Whether it is a container; none where it is not.
    #[tsify(type = "boolean", optional)]
    pub is_container: Field<Option<bool>>,
    /// Whether the user may resize it by its resize handles; none where not
    /// (API-edits-report-nested-changes).
    #[tsify(type = "boolean", optional)]
    pub resizable: Field<Option<bool>>,
    /// The direction its regions divide it in; none where it has none
    /// (ARCH-regions-are-container-slots).
    #[tsify(type = "Divide", optional)]
    pub divide: Field<Option<Divide>>,
    /// Its regions, each a container of its own below its content; none where it has none.
    #[tsify(type = "RegionInput[]", optional)]
    pub regions: Field<Option<Vec<RegionInput>>>,
    /// The identifier of the node it is attached to as a border node, which `api` resolves to a
    /// slot, in place of `x`, `y`, and `container`; none where it is no border node
    /// (ARCH-border-nodes-ride-sides).
    #[tsify(type = "string", optional)]
    pub attached_to: Field<Option<String>>,
    /// The side of that node's box a border node sits on.
    #[tsify(type = "Side", optional)]
    #[serde(default = "Field::absent")]
    pub side: Field<Option<Side>>,
    /// Its offset along that side from the side's start, in world units.
    #[tsify(type = "number", optional)]
    #[serde(default = "Field::absent")]
    pub offset: Field<Option<f64>>,
    #[tsify(type = "NodeContent")]
    pub content: Field<ContentInput>,
}

/// The node shape a node is drawn and hit in, from the closed set the engine owns
/// (REN-closed-set-of-node-shapes).
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NodeShape {
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
}

impl From<NodeShape> for shape::NodeShape {
    fn from(shape: NodeShape) -> Self {
        match shape {
            NodeShape::Rectangle => Self::Rectangle,
            NodeShape::RoundedRectangle => Self::RoundedRectangle,
            NodeShape::Ellipse => Self::Ellipse,
            NodeShape::Circle => Self::Circle,
            NodeShape::RingedCircle => Self::RingedCircle,
            NodeShape::Diamond => Self::Diamond,
            NodeShape::Bar => Self::Bar,
            NodeShape::Pentagon => Self::Pentagon,
            NodeShape::NotchedRectangle => Self::NotchedRectangle,
            NodeShape::Note => Self::Note,
            NodeShape::Frame => Self::Frame,
            NodeShape::CrossedCircle => Self::CrossedCircle,
            NodeShape::Cross => Self::Cross,
            NodeShape::Actor => Self::Actor,
            NodeShape::Hourglass => Self::Hourglass,
        }
    }
}

/// How a node's outline is drawn (REN-node-shapes-cover-uml, *Outline*): `"solid"`, `"none"`, or
/// a dash pattern in the form an edge takes, a dash and a gap in world units.
#[derive(Tsify, Clone, Copy, Debug, PartialEq)]
#[tsify(type = "\"solid\" | \"none\" | [number, number]")]
pub enum Outline {
    Solid,
    None,
    Dashed(Pair),
}

impl<'de> Deserialize<'de> for Outline {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(OutlineVisitor)
    }
}

struct OutlineVisitor;

impl<'de> Visitor<'de> for OutlineVisitor {
    type Value = Outline;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("\"solid\", \"none\", or a list of two numbers")
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Outline, E> {
        match value {
            "solid" => Ok(Outline::Solid),
            "none" => Ok(Outline::None),
            _ => Err(E::invalid_value(de::Unexpected::Str(value), &self)),
        }
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, seq: A) -> Result<Outline, A::Error> {
        Pair::deserialize(de::value::SeqAccessDeserializer::new(seq)).map(Outline::Dashed)
    }
}

/// The role of a text, which chooses its font (REN-node-content-in-rows).
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TextRole {
    Title,
    Body,
    Caption,
}

/// One segment of a progress bar (REN-node-content-in-rows): the fraction of the bar it fills,
/// finite and not negative, and its colour as `0xRRGGBB`.
#[derive(Tsify, Serialize, Debug, PartialEq)]
pub struct Segment {
    pub fraction: f64,
    pub color: u32,
}

/// The direction of a metric's trend (REN-node-content-in-rows), drawn as an arrow: up ▲, down ▼,
/// or flat ▶.
#[derive(Tsify, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrendDirection {
    Up,
    Down,
    Flat,
}

/// The trend of a metric (REN-node-content-in-rows): its text, its direction, and its colour as
/// `0xRRGGBB`, in which its arrow and its text are drawn.
#[derive(Tsify, Serialize, Debug, PartialEq)]
pub struct Trend {
    pub text: String,
    pub direction: TrendDirection,
    pub color: u32,
}

/// One element of node content (REN-node-content-in-rows): a text in a role; an action, a text
/// whose click reports its identifier `id` to the host application; a badge, a text on a pill of
/// the colour `color`, `0xRRGGBB`; a progress bar, a bar the width of its column divided into
/// `segments` from its left, the rest of it the track; a metric, a `caption` above a `value` and
/// its `trend`; or an icon, the image the host application registered under `name`, which draws
/// nothing while none is registered; each in a column that takes its share of the row's width by
/// `weight`, 1 where it is left out. This type names exactly the six kinds of
/// REN-node-content-in-rows. Its reading is `ContentInput`'s, which takes any value, so that what
/// it refuses is named.
#[derive(Tsify, Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContentElement {
    Text {
        role: TextRole,
        text: String,
        #[tsify(optional)]
        weight: Option<f64>,
    },
    Action {
        text: String,
        id: String,
        #[tsify(optional)]
        weight: Option<f64>,
    },
    Badge {
        text: String,
        color: u32,
        #[tsify(optional)]
        weight: Option<f64>,
    },
    Progress {
        segments: Vec<Segment>,
        #[tsify(optional)]
        weight: Option<f64>,
    },
    Metric {
        caption: String,
        value: String,
        trend: Trend,
        #[tsify(optional)]
        weight: Option<f64>,
    },
    Icon {
        name: String,
        #[tsify(optional)]
        weight: Option<f64>,
    },
}

/// What a node shows: rows of weighted columns, each holding one element, and per row whether it
/// is a separator instead, which holds none and the host application writes as the string
/// `"separator"` in place of the row's elements (REN-node-content-and-hits, *Separator*).
#[derive(Tsify, Debug, PartialEq)]
#[tsify(type = "(ContentElement[] | \"separator\")[]")]
pub struct NodeContent(pub Vec<Vec<ContentElement>>, pub Vec<bool>);

impl Serialize for NodeContent {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeSeq;
        let mut rows = serializer.serialize_seq(Some(self.0.len()))?;
        for (i, row) in self.0.iter().enumerate() {
            if self.1.get(i).copied().unwrap_or(false) {
                rows.serialize_element("separator")?;
            } else {
                rows.serialize_element(row)?;
            }
        }
        rows.end()
    }
}

/// An edge label: its identifier, unique within its edge, its text, where it sits by path
/// parameter `t` and label offset in pixels (G-6), 0.5 and 0 where it names none, and the colour
/// of its background as `0xRRGGBB`, the edge's own without one (API-edges-dock-nodes-or-edges,
/// *Edge labels*).
// The tests read each `Field` of it through `Refusable` in `snapshot`, which names them all.
#[derive(Tsify, Deserialize, Clone)]
pub struct LabelInput {
    #[tsify(type = "string")]
    pub id: Field<String>,
    #[tsify(type = "string")]
    #[serde(rename = "text", default, deserialize_with = "text_length")]
    pub text_length: Option<usize>,
    #[tsify(type = "number", optional)]
    #[serde(default = "Field::absent")]
    pub t: Field<Option<f64>>,
    #[tsify(type = "number", optional)]
    #[serde(default = "Field::absent")]
    pub offset: Field<Option<f64>>,
    #[tsify(optional)]
    #[serde(default, deserialize_with = "optional_number")]
    pub background: Option<f64>,
}

/// The arrowhead that marks the end of an edge: a filled triangle, two open strokes, a hollow
/// triangle, or none (API-edges-dock-nodes-or-edges, *Arrowheads*).
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Arrow {
    End,
    None,
    Open,
    Hollow,
}

/// A side of a node, at whose middle its connector sits (API-edges-dock-side-or-outline).
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Top,
    Right,
    Bottom,
    Left,
}

impl Side {
    /// Every side, in the order of the codes of `SideCode`.
    pub const ALL: [Self; 4] = [Self::Top, Self::Right, Self::Bottom, Self::Left];
}

impl From<graph_side::Side> for Side {
    fn from(side: graph_side::Side) -> Self {
        match side {
            graph_side::Side::Top => Self::Top,
            graph_side::Side::Right => Self::Right,
            graph_side::Side::Bottom => Self::Bottom,
            graph_side::Side::Left => Self::Left,
        }
    }
}

impl From<Side> for graph_side::Side {
    fn from(side: Side) -> Self {
        match side {
            Side::Top => Self::Top,
            Side::Right => Self::Right,
            Side::Bottom => Self::Bottom,
            Side::Left => Self::Left,
        }
    }
}

/// Where an end of an edge docks: at the connector of one of the four sides, or on the node's
/// outline (API-edges-dock-side-or-outline).
#[derive(Tsify, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Dock {
    Top,
    Right,
    Bottom,
    Left,
    Outline,
}

impl From<Dock> for graph_side::Dock {
    fn from(dock: Dock) -> Self {
        match dock {
            Dock::Top => graph_side::Side::Top.into(),
            Dock::Right => graph_side::Side::Right.into(),
            Dock::Bottom => graph_side::Side::Bottom.into(),
            Dock::Left => graph_side::Side::Left.into(),
            Dock::Outline => Self::Outline,
        }
    }
}

/// An edge between two ends, each a node named by its identifier, `source` or `target`, or an edge
/// named by its identifier, `sourceEdge` or `targetEdge`, at a path parameter of its path,
/// `sourceT` or `targetT` (API-edges-dock-nodes-or-edges, *Ends*), with its edge labels and the
/// style it is drawn with: its colour as `0xRRGGBB`, its dash pattern as dash and gap lengths in
/// world units (none for a solid line), the arrowhead that marks its end (G-11), and whether its
/// middle is a lightning bolt. `label`, the one label an edge carried before `labels`, is read only
/// to be refused. A field left out reads as absent, and one of another type as refused, so that an
/// end that names both a node and an edge, or neither, is told apart from one of another type.
// The tests read each `Field` of it through `Refusable` in `snapshot`, which names them all.
#[derive(Tsify, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInput {
    #[tsify(type = "string")]
    pub id: Field<String>,
    #[tsify(type = "string", optional)]
    #[serde(default = "Field::absent")]
    pub source: Field<Option<String>>,
    #[tsify(type = "string", optional)]
    #[serde(default = "Field::absent")]
    pub source_edge: Field<Option<String>>,
    #[tsify(type = "number", optional)]
    #[serde(default = "Field::absent")]
    pub source_t: Field<Option<f64>>,
    #[tsify(type = "string", optional)]
    #[serde(default = "Field::absent")]
    pub target: Field<Option<String>>,
    #[tsify(type = "string", optional)]
    #[serde(default = "Field::absent")]
    pub target_edge: Field<Option<String>>,
    #[tsify(type = "number", optional)]
    #[serde(default = "Field::absent")]
    pub target_t: Field<Option<f64>>,
    /// Whether the edge still carries `label`, which `labels` replaced: never typed, and refused.
    #[tsify(type = "never", optional)]
    #[serde(default, deserialize_with = "present")]
    pub label: bool,
    #[tsify(type = "LabelInput[]", optional)]
    #[serde(default = "Field::absent")]
    pub labels: Field<Option<Vec<Field<LabelInput>>>>,
    #[tsify(type = "number")]
    pub color: Field<f64>,
    #[tsify(type = "[number, number]", optional)]
    pub dash: Field<Option<Pair>>,
    #[tsify(type = "Arrow")]
    pub arrow: Field<Arrow>,
    #[tsify(type = "boolean", optional)]
    #[serde(default = "Field::absent")]
    pub lightning: Field<Option<bool>>,
    /// The side of its source node it leaves by, or its outline; `api` fills in `right`
    /// (API-edges-dock-nodes-or-edges), and none for an end on an edge, which takes none.
    #[tsify(type = "Dock", optional)]
    #[serde(default = "Field::absent")]
    pub source_side: Field<Option<Dock>>,
    /// The side of its target node it enters by, or its outline; `api` fills in `left`.
    #[tsify(type = "Dock", optional)]
    #[serde(default = "Field::absent")]
    pub target_side: Field<Option<Dock>>,
}

/// A dash pattern: a list of exactly two numbers, the dash and the gap.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pair(pub [f64; 2]);

impl<'de> Deserialize<'de> for Pair {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(PairVisitor)
    }
}

struct PairVisitor;

impl<'de> Visitor<'de> for PairVisitor {
    type Value = Pair;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a list of two numbers")
    }

    /// Reads two numbers, and refuses a list that holds a third without reading the rest.
    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<Pair, A::Error> {
        let mut next = |read| {
            seq.next_element()?
                .ok_or_else(|| de::Error::invalid_length(read, &self))
        };
        let pair = [next(0)?, next(1)?];
        if seq.next_element::<IgnoredAny>()?.is_some() {
            return Err(de::Error::invalid_length(3, &self));
        }
        Ok(Pair(pair))
    }
}
