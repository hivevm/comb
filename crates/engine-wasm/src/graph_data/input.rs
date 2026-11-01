//! The types of graph data the host application hands over and is handed back: a node and its
//! content, an edge and its label, and their arrowheads, sides, and dash patterns.

use std::fmt;

use comb_engine::geometry as graph_side;
use serde::de::{self, IgnoredAny, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use tsify::Tsify;

use super::field::{optional_number, text_length};
use super::{ContentInput, Field};

/// A node as the host application hands it over: its identifier, the position of its top-left
/// corner, its width, and its content, from which the engine computes its height (ADR-0013).
// The tests read each `Field` of it through `Refusable` in `snapshot`, which names them all.
#[derive(Tsify, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeInput {
    #[tsify(type = "string")]
    pub id: Field<String>,
    #[tsify(type = "number")]
    pub x: Field<f64>,
    #[tsify(type = "number")]
    pub y: Field<f64>,
    #[tsify(type = "number")]
    pub width: Field<f64>,
    #[tsify(type = "NodeContent")]
    pub content: Field<ContentInput>,
}

/// The role of a text, which chooses its font (ADR-0013).
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TextRole {
    Title,
    Body,
    Caption,
}

/// One segment of a progress bar (ADR-0013): the fraction of the bar it fills, finite and not
/// negative, and its colour as `0xRRGGBB`.
#[derive(Tsify, Serialize, Debug, PartialEq)]
pub struct Segment {
    pub fraction: f64,
    pub color: u32,
}

/// The direction of a metric's trend (ADR-0013), drawn as an arrow: up ▲, down ▼, or flat ▶.
#[derive(Tsify, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrendDirection {
    Up,
    Down,
    Flat,
}

/// The trend of a metric (ADR-0013): its text, its direction, and its colour as `0xRRGGBB`, in
/// which its arrow and its text are drawn.
#[derive(Tsify, Serialize, Debug, PartialEq)]
pub struct Trend {
    pub text: String,
    pub direction: TrendDirection,
    pub color: u32,
}

/// One element of node content (ADR-0013): a text in a role; an action, a text whose click
/// reports its identifier `id` to the host application; a badge, a text on a pill of the colour
/// `color`, `0xRRGGBB`; a progress bar, a bar the width of its column divided into `segments`
/// from its left, the rest of it the track; a metric, a `caption` above a `value` and its
/// `trend`; or an icon, the image the host application registered under `name`, which draws
/// nothing while none is registered; each in a column that takes its share of the row's width by
/// `weight`, 1 where it is left out. This type names exactly the six kinds of ADR-0013.
/// Its reading is `ContentInput`'s, which takes any value, so that what it refuses is named.
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

/// What a node shows: rows of weighted columns, each holding one element (ADR-0013).
#[derive(Tsify, Serialize, Debug, PartialEq)]
pub struct NodeContent(pub Vec<Vec<ContentElement>>);

/// An edge label: its text, where it sits by path parameter `t` and label offset in pixels
/// (G-6), and the colour of its background as `0xRRGGBB`, the edge's own without one.
// The tests read each `Field` of it through `Refusable` in `snapshot`, which names them all.
#[derive(Tsify, Deserialize, Clone, Copy)]
pub struct LabelInput {
    #[tsify(type = "string")]
    #[serde(rename = "text", default, deserialize_with = "text_length")]
    pub text_length: Option<usize>,
    #[tsify(type = "number")]
    pub t: Field<f64>,
    #[tsify(type = "number")]
    pub offset: Field<f64>,
    #[tsify(optional)]
    #[serde(default, deserialize_with = "optional_number")]
    pub background: Option<f64>,
}

/// Whether an arrowhead marks the end of an edge.
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Arrow {
    End,
    None,
}

/// A side of a node, at whose middle its connector sits (ADR-0024).
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Top,
    Right,
    Bottom,
    Left,
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

/// An edge between two nodes, named by their identifiers, with the style it is drawn with: its
/// colour as `0xRRGGBB`, its dash pattern as dash and gap lengths in world units (none for a
/// solid line), and whether an arrowhead marks its end (G-11).
// The tests read each `Field` of it through `Refusable` in `snapshot`, which names them all.
#[derive(Tsify, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EdgeInput {
    #[tsify(type = "string")]
    pub id: Field<String>,
    #[tsify(type = "string")]
    pub source: Field<String>,
    #[tsify(type = "string")]
    pub target: Field<String>,
    #[tsify(type = "LabelInput", optional)]
    pub label: Field<Option<LabelInput>>,
    #[tsify(type = "number")]
    pub color: Field<f64>,
    #[tsify(type = "[number, number]", optional)]
    pub dash: Field<Option<Pair>>,
    #[tsify(type = "Arrow")]
    pub arrow: Field<Arrow>,
    /// The side of its source it leaves by; `api` fills in `right` (ADR-0024).
    #[tsify(type = "Side")]
    pub source_side: Field<Side>,
    /// The side of its target it enters by; `api` fills in `left`.
    #[tsify(type = "Side")]
    pub target_side: Field<Side>,
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
