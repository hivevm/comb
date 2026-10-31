//! The content of a single node read through serde-wasm-bindgen (ADR-0034), the node of `addNode`
//! or a patch of `updateNode`, as the snapshot hands a load's over in columns, and the first
//! shape of it the snapshot could not flatten.

use std::fmt;

use serde::de::{self, IgnoredAny, Visitor};
use serde::{Deserialize, Deserializer};

use super::codes::{direction_code, filled, kind_code, role_code};
use super::{ContentData, DirectionCode, KindCode, RoleCode, numbered, utf16_length};
use crate::graph_data::field::other_shapes;

/// Where the snapshot found a shape of content it cannot flatten in a node: the row, and below a
/// row the column, of a row that is no list, an element that is no object, or a progress bar's
/// segments that are no list or a segment of them that is no object.
pub type Shape = (u32, Option<u32>);

/// What a shape of content the snapshot cannot flatten should have been (ADR-0034).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Unflat {
    /// A row: a list of elements.
    #[default]
    Row,
    /// An element: an object.
    Element,
    /// A progress bar's segments: a list of segments.
    Segments,
    /// A segment: an object.
    Segment,
}

/// The content of the node of `addNode` or of a patch of `updateNode` as the host application
/// handed it over, read through serde-wasm-bindgen as the snapshot hands a load's over in
/// columns: a row that is no list as a row of no elements, an element that is no object as one
/// of no kind, each element's kind and role by their codes, a weight left out as 1 and one of
/// another type as NaN, a badge's colour left out or of another type as NaN, a text of another
/// type as none, a progress bar's segments that are no list as none, and a segment that is no
/// object, or a fraction or a colour of one left out or of another type, as NaN; and the first
/// shape it could not flatten, and what that shape should have been.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ContentInput {
    pub(crate) data: ContentData,
    pub(crate) shape: Option<Shape>,
    pub(crate) unread: Unflat,
}

impl ContentInput {
    /// Starts the content of one node.
    pub(crate) fn new() -> Self {
        Self {
            data: ContentData {
                row_bounds: vec![0, 0],
                element_bounds: vec![0],
                segment_bounds: vec![0],
                text_bounds: vec![0],
                name_bounds: vec![0],
                ..ContentData::default()
            },
            shape: None,
            unread: Unflat::Row,
        }
    }

    /// Names the shape at `row` and `column`, which should have been `unread`, unless one before
    /// it was named.
    pub(crate) fn unread(&mut self, row: u32, column: Option<u32>, unread: Unflat) {
        if self.shape.is_none() {
            self.shape = Some((row, column));
            self.unread = unread;
        }
    }

    /// Adds a segment of `fraction` and `color` to the progress bar pushed last.
    pub(crate) fn push_segment(&mut self, fraction: f64, color: f64) {
        let data = &mut self.data;
        data.fractions.push(fraction);
        data.segment_colors.push(color);
        if let Some(end) = data.segment_bounds.last_mut() {
            *end += 1;
        }
    }

    /// Ends a row, of the elements pushed since the row before.
    pub(crate) fn end_row(&mut self) {
        let data = &mut self.data;
        data.element_bounds.push(numbered(data.kinds.len()));
        data.row_bounds[1] += 1;
    }

    /// Adds an element of `kind`, `weight`, and `role`, the role crossing as 0 for an action, a
    /// badge, a progress bar, a metric, and an icon, and of the colour `color`, NaN for a kind
    /// other than `badge`; where it is a `text`, an `action`, or a `badge`, its text, and where it
    /// is an `action` its identifier and an `icon` its name, `id`, each none for one of another
    /// type, which crosses empty and marked as no string.
    pub(crate) fn push(
        &mut self,
        kind: KindCode,
        weight: f64,
        role: u8,
        color: f64,
        text: Option<&str>,
        id: Option<&str>,
    ) {
        let data = &mut self.data;
        data.kinds.push(kind as u8);
        data.weights.push(weight);
        data.roles.push(
            if matches!(
                kind,
                KindCode::Action
                    | KindCode::Badge
                    | KindCode::Progress
                    | KindCode::Metric
                    | KindCode::Icon
            ) {
                0
            } else {
                role
            },
        );
        data.directions.push(0);
        data.colors.push(if kind == KindCode::Badge {
            color
        } else {
            f64::NAN
        });
        let segments = data.segment_bounds[data.segment_bounds.len() - 1];
        data.segment_bounds.push(segments);
        let (texts, names) = filled(kind as u8);
        // A metric's three texts are `push_metric`'s to fill.
        if texts == 1 {
            push_string(
                &mut data.texts,
                &mut data.text_bounds,
                &mut data.text_valid,
                text,
            );
        }
        if names > 0 {
            push_string(
                &mut data.names,
                &mut data.name_bounds,
                &mut data.name_valid,
                id,
            );
        }
    }
}

impl ContentInput {
    /// Adds a metric of `weight`, its trend of the direction `direction`, a code, and the colour
    /// `color`, showing `caption`, `value`, and the trend's text `trend`, each none for one of
    /// another type, which crosses empty and marked as no string.
    pub(crate) fn push_metric(
        &mut self,
        weight: f64,
        direction: u8,
        color: f64,
        [caption, value, trend]: [Option<&str>; 3],
    ) {
        self.push(KindCode::Metric, weight, 0, f64::NAN, None, None);
        let data = &mut self.data;
        if let Some(last) = data.directions.last_mut() {
            *last = direction;
        }
        if let Some(last) = data.colors.last_mut() {
            *last = color;
        }
        for text in [caption, value, trend] {
            push_string(
                &mut data.texts,
                &mut data.text_bounds,
                &mut data.text_valid,
                text,
            );
        }
    }
}

/// Appends `value` to a string column of one piece, `pieces` cut by `bounds`, and whether it is a
/// string to `valid`: none crosses empty and marked as no string.
fn push_string(
    pieces: &mut Vec<String>,
    bounds: &mut Vec<u32>,
    valid: &mut Vec<u8>,
    value: Option<&str>,
) {
    let given = value.is_some();
    let value = value.unwrap_or("");
    let last = bounds[bounds.len() - 1];
    bounds.push(last + numbered(utf16_length(value)));
    valid.push(u8::from(given));
    match pieces.first_mut() {
        Some(piece) => piece.push_str(value),
        None if !value.is_empty() => pieces.push(value.to_owned()),
        None => {}
    }
}

impl<'de> Deserialize<'de> for ContentInput {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(RowsVisitor)
    }
}

struct RowsVisitor;

impl<'de> Visitor<'de> for RowsVisitor {
    type Value = ContentInput;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a list of rows")
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<ContentInput, A::Error> {
        let mut content = ContentInput::new();
        let mut row = 0;
        // Every row is read, past the limit too, so that their count is refused; the snapshot
        // hands over at most one row beyond it.
        while let Some(read) = seq.next_element_seed(RowSeed(&mut content, row))? {
            if !read {
                content.unread(row, None, Unflat::Row);
            }
            content.end_row();
            row += 1;
        }
        Ok(content)
    }
}

/// Reads one row into the content, or reports that it is no list.
struct RowSeed<'c>(&'c mut ContentInput, u32);

impl<'de> de::DeserializeSeed<'de> for RowSeed<'_> {
    type Value = bool;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<bool, D::Error> {
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for RowSeed<'_> {
    type Value = bool;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a list of elements")
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<bool, A::Error> {
        let Self(content, row) = self;
        let mut column = 0;
        while let Some(element) = seq.next_element::<ElementCells>()? {
            match element.0 {
                Some(cells) => {
                    let kind = cells.kind.as_deref().map_or(KindCode::Unnamed, kind_code);
                    let role = cells.role.as_deref().map_or(RoleCode::Unnamed, role_code);
                    if kind == KindCode::Metric {
                        // A trend that is no object holds none of its fields.
                        let (text, direction, color) =
                            cells.trend.unwrap_or((None, None, f64::NAN));
                        let direction = direction
                            .as_deref()
                            .map_or(DirectionCode::Unnamed, direction_code);
                        content.push_metric(
                            cells.weight,
                            direction as u8,
                            color,
                            [
                                cells.caption.as_deref(),
                                cells.value.as_deref(),
                                text.as_deref(),
                            ],
                        );
                    } else {
                        // An icon names its image by `name`, an action its meaning by `id`.
                        let named = if kind == KindCode::Icon {
                            cells.name.as_deref()
                        } else {
                            cells.id.as_deref()
                        };
                        content.push(
                            kind,
                            cells.weight,
                            role as u8,
                            cells.color,
                            cells.text.as_deref(),
                            named,
                        );
                    }
                    // Only a progress bar's segments are read; any other kind holds none.
                    if kind == KindCode::Progress {
                        let at = Some(column);
                        match cells.segments {
                            Some(segments) => {
                                for segment in segments {
                                    let (fraction, color) = segment.unwrap_or_else(|| {
                                        content.unread(row, at, Unflat::Segment);
                                        (f64::NAN, f64::NAN)
                                    });
                                    content.push_segment(fraction, color);
                                }
                            }
                            None => content.unread(row, at, Unflat::Segments),
                        }
                    }
                }
                None => {
                    content.unread(row, Some(column), Unflat::Element);
                    content.push(KindCode::Unnamed, f64::NAN, 0, f64::NAN, None, None);
                }
            }
            column += 1;
        }
        Ok(true)
    }

    // Any other value is no list: a row of no elements.
    other_shapes!('de, bool, false, map);
}

/// A trend's text, direction, and colour, as `Fields` holds them.
type Trend3 = (Option<String>, Option<String>, f64);

/// An element as the host application handed it over: its fields, each of its type or none, a
/// weight left out or null 1 and one of another type NaN, or none where it is no object.
struct ElementCells(Option<Fields>);

struct Fields {
    kind: Option<String>,
    role: Option<String>,
    weight: f64,
    color: f64,
    /// A segment's fraction, read as its colour is.
    fraction: f64,
    text: Option<String>,
    id: Option<String>,
    /// An icon's registered name, read as a text is.
    name: Option<String>,
    /// A metric's caption and value, read as a text is.
    caption: Option<String>,
    value: Option<String>,
    /// A metric's trend, its text, its direction, and its colour, each read as `Fields` reads
    /// them, or none where it is no object.
    trend: Option<Trend3>,
    /// A progress bar's segments, each its fraction and its colour, NaN for one left out or of
    /// another type, or none for a segment that is no object; none where they are no list.
    segments: Option<Vec<Option<(f64, f64)>>>,
}

impl<'de> Deserialize<'de> for ElementCells {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(ElementVisitor)
    }
}

struct ElementVisitor;

impl<'de> Visitor<'de> for ElementVisitor {
    type Value = ElementCells;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("an object")
    }

    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<ElementCells, A::Error> {
        // A weight left out, or null, is 1, as the snapshot hands one over.
        let mut fields = Fields {
            kind: None,
            role: None,
            weight: 1.0,
            color: f64::NAN,
            fraction: f64::NAN,
            text: None,
            id: None,
            name: None,
            caption: None,
            value: None,
            trend: None,
            segments: None,
        };
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "kind" => fields.kind = map.next_value::<Lenient<String>>()?.0,
                "role" => fields.role = map.next_value::<Lenient<String>>()?.0,
                "weight" => {
                    let weight = map.next_value::<Lenient<Option<f64>>>()?.0;
                    fields.weight = weight.map_or(f64::NAN, |weight| weight.unwrap_or(1.0));
                }
                "color" => {
                    let color = map.next_value::<Lenient<f64>>()?.0;
                    fields.color = color.unwrap_or(f64::NAN);
                }
                "fraction" => {
                    let fraction = map.next_value::<Lenient<f64>>()?.0;
                    fields.fraction = fraction.unwrap_or(f64::NAN);
                }
                "text" => fields.text = map.next_value::<Lenient<String>>()?.0,
                "id" => fields.id = map.next_value::<Lenient<String>>()?.0,
                "name" => fields.name = map.next_value::<Lenient<String>>()?.0,
                "caption" => fields.caption = map.next_value::<Lenient<String>>()?.0,
                "value" => fields.value = map.next_value::<Lenient<String>>()?.0,
                "trend" => fields.trend = map.next_value::<TrendCells>()?.0,
                "segments" => fields.segments = map.next_value::<SegmentsCells>()?.0,
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(ElementCells(Some(fields)))
    }

    // Any other value is no object.
    other_shapes!('de, ElementCells, ElementCells(None), seq);
}

/// A metric's trend as the host application handed it over: its text, its direction, and its
/// colour, each of its type or none, the colour NaN, every other field ignored; or none where it
/// is no object.
struct TrendCells(Option<Trend3>);

impl<'de> Deserialize<'de> for TrendCells {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(TrendVisitor)
    }
}

struct TrendVisitor;

impl<'de> Visitor<'de> for TrendVisitor {
    type Value = TrendCells;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("an object")
    }

    fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<TrendCells, A::Error> {
        let (mut text, mut direction, mut color) = (None, None, f64::NAN);
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "text" => text = map.next_value::<Lenient<String>>()?.0,
                "direction" => direction = map.next_value::<Lenient<String>>()?.0,
                "color" => color = map.next_value::<Lenient<f64>>()?.0.unwrap_or(f64::NAN),
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(TrendCells(Some((text, direction, color))))
    }

    // Any other value is no object.
    other_shapes!('de, TrendCells, TrendCells(None), seq);
}

/// A progress bar's segments as the host application handed them over, as `Fields` holds them.
struct SegmentsCells(Option<Vec<Option<(f64, f64)>>>);

impl<'de> Deserialize<'de> for SegmentsCells {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let segments = Lenient::<Vec<SegmentCells>>::deserialize(deserializer)?.0;
        Ok(Self(segments.map(|segments| {
            segments.into_iter().map(|segment| segment.0).collect()
        })))
    }
}

/// A segment as the host application handed it over: its fraction and its colour, NaN for one
/// left out or of another type, or none where it is no object.
struct SegmentCells(Option<(f64, f64)>);

impl<'de> Deserialize<'de> for SegmentCells {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let element = ElementCells::deserialize(deserializer)?;
        Ok(Self(
            element.0.map(|fields| (fields.fraction, fields.color)),
        ))
    }
}

/// A value of `T`, or none where it holds a value of another type, which is read and dropped.
struct Lenient<T>(Option<T>);

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Lenient<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self(T::deserialize(deserializer).ok()))
    }
}
