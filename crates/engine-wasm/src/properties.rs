//! The property test of the bridge's validation (Q-7, ADR-0028): graph data of any shape, well
//! formed or not, ends in a typed error or a graph, never in a panic, and in a graph exactly when
//! an oracle written apart from the bridge finds nothing to refuse. Every field crosses, those the
//! engine does not keep among them: node content, label texts and backgrounds, the patch of
//! `updateNode`, the node of `addNode` and the edge of `addEdge`, each refused exactly as a load
//! of it alone is, and the patch of `updateEdge`, refused exactly as a load of the edge it makes.
//!
//! The data starts as a value of any shape, as the host application hands it over. A load's nodes
//! and edges cross as the columns the snapshot of `api` builds of it (ADR-0034), its strings in
//! pieces of a bound generated with it, each node read as the node of `addNode` is and each edge
//! as the edge of `addEdge` is, but for an arrowhead and the sides, any string of which crosses as
//! its code, so that a value of the wrong type or a missing field at any position among them, a
//! string that names no arrowhead or side, and an item that is no object, reach the bridge as the
//! shell hands them over. A
//! second oracle, written on that value alone, says which field of which node or edge is missing
//! or of another type, and whether the value has the shape of graph data at all: the bridge names
//! such a field (`invalidField`), and refuses as malformed only what has no such shape, and no
//! message names a Rust type or crate.
// Verifies: Q-7, ADR-0028, ADR-0034

use proptest::prelude::*;
use serde::Deserialize;
use serde::de::value::{MapDeserializer, SeqDeserializer};
use serde::de::{self, IntoDeserializer, Visitor};

use comb_engine::content::Fonts;

use super::{
    ContentInput, EdgeCells, EdgeInput, EdgePatch, EdgeRefusal, GraphBatch, GraphDataProblem,
    GraphList, KindCode, NodeInput, OwnedColumns, OwnedEdgeColumns,
};
use super::{
    NodePatch, add_edge_to, add_node_to, graph_of, load_of, patch_of, reading, unshaped,
    update_edge_in,
};

/// How many random batches one run feeds the bridge: the ticket's floor, which runs in seconds.
const CASES: u32 = 10_000;

/// A value as JavaScript hands it over: of any shape, whatever the field expects.
#[derive(Clone, Debug)]
enum Value {
    Null,
    Bool(bool),
    Number(f64),
    Text(String),
    List(Vec<Value>),
    Object(Vec<(String, Value)>),
}

type Error = de::value::Error;

impl IntoDeserializer<'_, Error> for Value {
    type Deserializer = Self;

    fn into_deserializer(self) -> Self {
        self
    }
}

/// Above this magnitude a JavaScript number is no longer a safe integer.
const SAFE_INTEGER: f64 = 9_007_199_254_740_992.0;

impl<'de> de::Deserializer<'de> for Value {
    type Error = Error;

    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Error> {
        match self {
            Self::Null => visitor.visit_unit(),
            Self::Bool(b) => visitor.visit_bool(b),
            // An integral number reaches an integer field, as serde-wasm-bindgen lets it.
            Self::Number(n) if n.fract() == 0.0 && n.abs() < SAFE_INTEGER => {
                visitor.visit_i64(n as i64)
            }
            Self::Number(n) => visitor.visit_f64(n),
            Self::Text(s) => visitor.visit_string(s),
            Self::List(items) => visitor.visit_seq(SeqDeserializer::new(items.into_iter())),
            Self::Object(entries) => visitor.visit_map(MapDeserializer::new(entries.into_iter())),
        }
    }

    fn deserialize_option<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Error> {
        match self {
            Self::Null => visitor.visit_none(),
            other => visitor.visit_some(other),
        }
    }

    fn deserialize_enum<V: Visitor<'de>>(
        self,
        _name: &'static str,
        _variants: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, Error> {
        match self {
            Self::Text(s) => visitor.visit_enum(s.into_deserializer()),
            other => other.deserialize_any(visitor),
        }
    }

    /// A struct is read by its fields' names, as serde-wasm-bindgen reads a JavaScript object: a
    /// list is an object too, one without the fields.
    fn deserialize_struct<V: Visitor<'de>>(
        self,
        _name: &'static str,
        _fields: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, Error> {
        match self {
            Self::List(_) => visitor.visit_map(MapDeserializer::new(
                Vec::<(String, Self)>::new().into_iter(),
            )),
            other => other.deserialize_any(visitor),
        }
    }

    /// A newtype is read as the value it wraps, as serde-wasm-bindgen reads one.
    fn deserialize_newtype_struct<V: Visitor<'de>>(
        self,
        _name: &'static str,
        visitor: V,
    ) -> Result<V::Value, Error> {
        visitor.visit_newtype_struct(self)
    }

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf unit
        unit_struct seq tuple tuple_struct map identifier ignored_any
    }
}

/// Mostly ordinary coordinates, now and then a non-finite or negative one, or any `f64` at all.
fn number() -> impl Strategy<Value = f64> {
    prop_oneof![
        200 => -1e4..1e4f64,
        1 => Just(f64::NAN),
        1 => Just(f64::INFINITY),
        1 => Just(f64::NEG_INFINITY),
        1 => Just(-1.0),
        1 => Just(0.0),
        1 => any::<f64>(),
        1 => prop::sample::select(vec![1e39, -1e300, 3.5e38, 1e-300]),
    ]
}

/// Mostly a size, now and then any number.
fn size() -> impl Strategy<Value = Value> {
    prop_oneof![20 => 0.0..500.0f64, 1 => number()].prop_map(Value::Number)
}

/// Mostly a colour, now and then one around the largest; loose, also any number.
fn color(loose: bool) -> impl Strategy<Value = Value> {
    let colour = (0_u32..=0xff_ffff).prop_map(f64::from);
    let beyond = (0xff_fff0_u32..=0x100_0010).prop_map(f64::from);
    let any = if loose {
        number().boxed()
    } else {
        colour.clone().boxed()
    };
    prop_oneof![20 => colour, 1 => beyond, 1 => any].prop_map(Value::Number)
}

/// A text, now and then of a JavaScript value of another type; loose, of any value at all.
fn text(loose: bool) -> BoxedStrategy<Value> {
    let other = prop_oneof![
        Just(Value::Null),
        num(),
        any::<bool>().prop_map(Value::Bool)
    ];
    let wrong = if loose {
        anything().boxed()
    } else {
        other.boxed()
    };
    // Around the limit of 1,000 UTF-16 code units, with characters that count once and twice.
    let long = prop::sample::select(vec![
        "x".repeat(1_000),
        "x".repeat(1_001),
        "\u{1F600}".repeat(500),
        "\u{1F600}".repeat(500) + "x",
        "é".repeat(1_001),
    ]);
    prop_oneof![
        20 => id().prop_map(Value::Text),
        1 => long.prop_map(Value::Text),
        1 => wrong
    ]
    .boxed()
}

/// Mostly no label background or one that is a colour, now and then one around the largest or
/// below the smallest, or a fraction; loose, also any number or a value of any shape.
fn background(loose: bool) -> BoxedStrategy<Value> {
    let edges = prop::sample::select(vec![-5.0, -1.0, 0.5, 1e20, f64::NAN, f64::INFINITY]);
    let any = if loose {
        prop_oneof![num(), anything()].boxed()
    } else {
        Just(Value::Null).boxed()
    };
    prop_oneof![
        10 => Just(Value::Null),
        10 => color(false),
        1 => edges.prop_map(Value::Number),
        1 => any,
    ]
    .boxed()
}

/// The identifier of the `i`th node or edge, now and then that of one of the first four, so
/// that duplicates occur.
fn nth(prefix: &'static str, i: usize) -> impl Strategy<Value = Value> {
    let id = prop_oneof![10 => Just(i), 1 => 0..4_usize]
        .prop_map(move |k| Value::Text(format!("{prefix}{k}")));
    // Now and then an identifier of 256 or 257 UTF-16 code units, characters of one and two.
    let long = prop::sample::select(vec![256_usize, 257])
        .prop_map(move |n| Value::Text(long_id(prefix, n)));
    prop_oneof![40 => id, 1 => long]
}

/// An identifier of `units` UTF-16 code units: `prefix`, then characters of two units and of one.
fn long_id(prefix: &str, units: usize) -> String {
    let pairs = 127;
    let ones = units - prefix.len() - 2 * pairs;
    format!("{prefix}{}{}", "\u{1F600}".repeat(pairs), "y".repeat(ones))
}

/// The end of an edge among `nodes` nodes: mostly one of them, now and then one beyond, or one
/// longer than an identifier may be.
fn end(nodes: usize) -> impl Strategy<Value = Value> {
    let named = prop_oneof![20 => 0..nodes.max(1), 1 => Just(nodes)]
        .prop_map(|k| Value::Text(format!("n{k}")));
    prop_oneof![40 => named, 1 => Just(Value::Text(long_id("n", 257)))]
}

/// Identifiers from a small pool.
fn id() -> impl Strategy<Value = String> {
    prop::sample::select(vec![
        "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "",
    ])
    .prop_map(str::to_owned)
}

/// A value of any shape, nested a little.
fn anything() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        Just(Value::Null),
        any::<bool>().prop_map(Value::Bool),
        number().prop_map(Value::Number),
        id().prop_map(Value::Text),
    ];
    leaf.prop_recursive(2, 8, 3, |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..3).prop_map(Value::List),
            prop::collection::vec((id(), inner), 0..3).prop_map(Value::Object),
        ]
    })
}

type Field = Option<(String, Value)>;

/// A field that holds what `good` makes; loose, now and then a value of any shape instead, or
/// none at all.
fn field(
    name: &'static str,
    good: impl Strategy<Value = Value> + 'static,
    loose: bool,
) -> BoxedStrategy<Field> {
    let named = move |value| Some((name.to_owned(), value));
    if !loose {
        return good.prop_map(named).boxed();
    }
    prop_oneof![
        40 => good.prop_map(named),
        1 => anything().prop_map(named),
        // What the snapshot of `api` hands over in place of a value of another type.
        1 => Just(named(Value::Bool(false))),
        1 => Just(None),
    ]
    .boxed()
}

fn object(fields: Vec<BoxedStrategy<Field>>) -> impl Strategy<Value = Value> {
    fields.prop_map(|fields| Value::Object(fields.into_iter().flatten().collect()))
}

fn num() -> impl Strategy<Value = Value> {
    number().prop_map(Value::Number)
}

fn node(loose: bool, i: usize) -> impl Strategy<Value = Value> {
    object(vec![
        field("id", nth("n", i), loose),
        field("x", num(), loose),
        field("y", num(), loose),
        field("width", size(), loose),
        field("content", content(loose), loose),
    ])
}

/// Mostly a weight, now and then null, which is 1, or one the bridge refuses or of another type.
fn weight() -> BoxedStrategy<Value> {
    let bad = prop::sample::select(vec![
        Value::Number(0.0),
        Value::Number(-1.0),
        Value::Number(f64::NAN),
        Value::Number(f64::INFINITY),
        Value::Bool(false),
    ]);
    let good = prop_oneof![
        10 => Just(1.0),
        10 => 0.01..100.0f64,
        1 => Just(f64::MAX),
        1 => Just(f64::MIN_POSITIVE),
    ];
    prop_oneof![20 => good.prop_map(Value::Number), 1 => Just(Value::Null), 1 => bad].boxed()
}

/// An element of content: mostly a text in a role, now and then of a kind or a role the bridge
/// refuses, without a field, or no object.
fn element(loose: bool) -> BoxedStrategy<Value> {
    let named = |name: &str| Value::Text(name.to_owned());
    let kind = one_of(
        vec![named("text")],
        vec![named("badge"), named(""), Value::Number(1.0)],
        true,
    );
    let roles = ["title", "body", "caption"].map(named).to_vec();
    let role = one_of(roles, vec![named("headline"), Value::Bool(true)], true);
    let text_element = object(vec![
        field("kind", kind, false),
        field("role", role, false),
        // Loose, so that a weight is now and then left out, which is 1.
        field("weight", weight(), true),
        field("text", text(loose), false),
    ]);
    let odd = prop::sample::select(vec![
        Value::Bool(false),
        Value::Number(3.0),
        Value::List(Vec::new()),
        Value::Text("text".to_owned()),
        Value::Object(Vec::new()),
    ]);
    prop_oneof![30 => text_element, 1 => odd].boxed()
}

/// The content of a node: mostly a row or two of a text or two, now and then rows and columns at
/// and past the bridge's limits of 8 and 6, a row that is no list, or none.
fn content(loose: bool) -> BoxedStrategy<Value> {
    let row = move || {
        let columns = prop_oneof![20 => 1..=2_usize, 1 => 0..=7_usize];
        let elements = columns
            .prop_flat_map(move |n| prop::collection::vec(element(loose), n))
            .prop_map(Value::List);
        let odd = prop::sample::select(vec![
            Value::Bool(false),
            Value::Null,
            Value::Object(Vec::new()),
        ]);
        prop_oneof![30 => elements, 1 => odd]
    };
    let rows = prop_oneof![20 => 1..=2_usize, 1 => 0..=9_usize];
    let any = rows
        .prop_flat_map(move |n| prop::collection::vec(row(), n))
        .prop_map(Value::List);
    // Well-formed titles, as many rows or columns as the limits allow and one more.
    let title = || match titled("t") {
        Value::List(rows) => rows[0].clone(),
        _ => unreachable!(),
    };
    let tall = (8..=9_usize).prop_map(move |n| Value::List(vec![title(); n]));
    let wide = (6..=7_usize).prop_map(move |n| {
        let Value::List(elements) = title() else {
            unreachable!()
        };
        Value::List(vec![Value::List(vec![elements[0].clone(); n])])
    });
    prop_oneof![20 => any, 1 => tall, 1 => wide].boxed()
}

/// One of `good` and, loose, now and then one of `bad`.
fn one_of(good: Vec<Value>, bad: Vec<Value>, loose: bool) -> BoxedStrategy<Value> {
    let good = prop::sample::select(good);
    if loose {
        prop_oneof![10 => good, 1 => prop::sample::select(bad)].boxed()
    } else {
        good.boxed()
    }
}

fn edge(loose: bool, j: usize, nodes: usize) -> impl Strategy<Value = Value> {
    let placed = object(vec![
        field("text", text(loose), loose),
        field("t", num(), loose),
        field("offset", num(), loose),
        field("background", background(loose), loose),
    ]);
    let label = prop_oneof![
        one_of(vec![Value::Null], vec![Value::Object(Vec::new())], loose),
        placed,
    ];
    let length = || prop_oneof![10 => 0.5..20.0f64, 1 => number()];
    let pair = (length(), length())
        .prop_map(|(d, g)| Value::List(vec![d, g].into_iter().map(Value::Number).collect()));
    let other = prop::collection::vec(num(), 0..4).prop_map(Value::List);
    let dash = prop_oneof![
        8 => Just(Value::Null),
        8 => pair,
        1 => if loose { other.boxed() } else { Just(Value::Null).boxed() },
    ];
    let text = |arrow: &str| Value::Text(arrow.to_owned());
    let arrow = one_of(vec![text("end"), text("none")], vec![text("start")], loose);
    let sides = ["top", "right", "bottom", "left"].map(text).to_vec();
    let side = || {
        one_of(
            sides.clone(),
            vec![text("middle"), Value::Number(1.0)],
            loose,
        )
    };
    object(vec![
        field("id", nth("e", j), loose),
        field("source", end(nodes), loose),
        field("target", end(nodes), loose),
        field("label", label, loose),
        field("color", color(loose), loose),
        field("dash", dash, loose),
        field("arrow", arrow, loose),
        field("sourceSide", side(), loose),
        field("targetSide", side(), loose),
    ])
}

/// A node or an edge that `good` makes; loose, now and then the snapshot's `false` in its place,
/// which is no object, or a list, which is an object without the fields.
fn item(good: impl Strategy<Value = Value> + 'static, loose: bool) -> BoxedStrategy<Value> {
    if !loose {
        return good.boxed();
    }
    let odd = prop::sample::select(vec![Value::Bool(false), Value::List(Vec::new())]);
    prop_oneof![40 => good, 1 => odd].boxed()
}

/// Graph data as the host application might hand it over: mostly of the right shape with values
/// to refuse here and there; loose, with a value of the wrong type or a missing field now and
/// then; and now and then a value of any shape at all.
fn graph_data() -> impl Strategy<Value = Value> {
    let batch = |loose| {
        (0..8_usize, 0..8_usize).prop_flat_map(move |(nodes, edges)| {
            let nodes_of = (0..nodes)
                .map(|i| item(node(loose, i), loose))
                .collect::<Vec<_>>();
            let edges_of = (0..edges)
                .map(|j| item(edge(loose, j, nodes), loose))
                .collect::<Vec<_>>();
            object(vec![
                field("nodes", nodes_of.prop_map(Value::List), loose),
                field("edges", edges_of.prop_map(Value::List), loose),
            ])
        })
    };
    prop_oneof![
        6 => batch(false),
        3 => batch(true),
        1 => anything(),
    ]
}

/// Whether `v` stays finite as the `f32` the engine keeps.
fn finite32(v: f64) -> bool {
    v.is_finite() && (v as f32).is_finite()
}

/// Whether a load of the two nodes and `edge` alone is to be refused by nothing, by the oracle
/// above: what an added edge and a patched one are held to on their own, not only to a load.
fn accepted_alone(edge: Value) -> bool {
    let data = two_nodes(vec![edge]);
    named_fields(&data).is_empty()
        && reading(|| GraphBatch::deserialize(data.clone()))
            .is_ok_and(|batch| acceptable(&batch, &data))
}

/// Whether nothing in `batch`, read of `data`, is to be refused, by brute force over the batch
/// and, for the content of its nodes, over `data` itself.
fn acceptable(batch: &GraphBatch, data: &Value) -> bool {
    accepts(batch).unwrap_or(false) && nodes_of_data(data).iter().all(content_ok)
}

/// The nodes of graph data `data`, none where it holds no list of them.
fn nodes_of_data(data: &Value) -> &[Value] {
    match fields_of(data).and_then(|fields| get(fields, "nodes")) {
        Some(Value::List(nodes)) => nodes,
        _ => &[],
    }
}

/// Whether the content of `node` is to be refused by nothing, by brute force over the value: a
/// list of at most 8 rows, each a list of at most 6 elements, each an object of the kind `text`,
/// a positive finite weight, a role of the three, and a text of at most 1,000 UTF-16 code units.
fn content_ok(node: &Value) -> bool {
    let Some(Value::List(rows)) = fields_of(node).and_then(|fields| get(fields, "content")) else {
        return false;
    };
    let units = |text: &str| text.chars().map(char::len_utf16).sum::<usize>();
    let element_ok = |element: &Value| {
        let Value::Object(fields) = element else {
            return false;
        };
        let named = |name, values: &[&str]| matches!(get(fields, name), Some(Value::Text(v)) if values.contains(&v.as_str()));
        // A weight left out, or null, is 1.
        let weight = match get(fields, "weight") {
            None | Some(Value::Null) => true,
            Some(Value::Number(w)) => w.is_finite() && *w > 0.0,
            Some(_) => false,
        };
        let text = matches!(get(fields, "text"), Some(Value::Text(t)) if units(t) <= 1_000);
        named("kind", &["text"]) && named("role", &["title", "body", "caption"]) && weight && text
    };
    rows.len() <= 8
        && rows.iter().all(|row| match row {
            Value::List(elements) => elements.len() <= 6 && elements.iter().all(element_ok),
            _ => false,
        })
}

/// The position of the first shape of the content of a node, `fields`, that the snapshot cannot
/// flatten: a row that is no list, or an element that is no object; or none.
fn first_shape(fields: &Fields) -> Option<(u32, Option<u32>)> {
    let Some(Value::List(rows)) = get(fields, "content") else {
        return None;
    };
    for (r, row) in rows.iter().enumerate() {
        let Value::List(elements) = row else {
            return Some((r as u32, None));
        };
        if let Some(c) = elements
            .iter()
            .position(|element| !matches!(element, Value::Object(_)))
        {
            return Some((r as u32, Some(c as u32)));
        }
    }
    None
}

/// Whether nothing in `batch` is to be refused, or none where a field is missing or of another
/// type.
fn accepts(batch: &GraphBatch) -> Option<bool> {
    let unique = |ids: &[String]| (0..ids.len()).all(|i| !ids[..i].contains(&ids[i]));
    let units = |id: &str| id.chars().map(char::len_utf16).sum::<usize>();
    let short = |id: &String| units(id) <= 256;
    let rgb = |n: f64| n.floor() == n && (0.0..16_777_216.0).contains(&n);
    let id = |field: &'_ super::Field<String>| field.0.clone();
    let nodes: Vec<String> = batch
        .nodes
        .iter()
        .map(|n| id(&n.id))
        .collect::<Option<_>>()?;
    let edges: Vec<String> = batch
        .edges
        .iter()
        .map(|e| id(&e.id))
        .collect::<Option<_>>()?;
    let mut ends = Vec::new();
    for e in &batch.edges {
        ends.extend([id(&e.source)?, id(&e.target)?]);
    }
    // The world's limit, 2^120: a node within it, its far side included, as f32 holds them, and
    // a label offset within it.
    let world = 2f64.powi(120);
    let as_f32 = |v: f64| f64::from(v as f32);
    let node_ok = |n: &NodeInput| {
        let [x, y, width] = [n.x.0?, n.y.0?, n.width.0?];
        n.content.0.as_ref()?;
        let within = [x, y, x]
            .into_iter()
            .zip([0.0, 0.0, width])
            .all(|(at, size)| (as_f32(at) + as_f32(size)).abs() <= world);
        Some([x, y, width].into_iter().all(finite32) && width as f32 >= 0.0 && within)
    };
    let edge_ok = |e: &EdgeInput| {
        let label_ok = match e.label.0? {
            None => true,
            Some(l) => {
                let (t, offset) = (l.t.0?, l.offset.0?);
                t.is_finite()
                    && offset.is_finite()
                    && offset.abs() <= world
                    && l.text_length.is_some_and(|l| l <= 1_000)
                    && l.background.is_none_or(rgb)
            }
        };
        let dash_ok = e.dash.0?.is_none_or(|super::Pair([d, g])| {
            finite32(d) && finite32(g) && d as f32 > 0.0 && g as f32 >= 0.0
        });
        e.arrow.0?;
        let named = |end: &Option<String>| end.as_ref().is_some_and(|end| nodes.contains(end));
        Some(named(&e.source.0) && named(&e.target.0) && label_ok && rgb(e.color.0?) && dash_ok)
    };
    let mut all_nodes = true;
    for n in &batch.nodes {
        all_nodes &= node_ok(n)?;
    }
    let mut all_edges = true;
    for e in &batch.edges {
        all_edges &= edge_ok(e)?;
    }
    Some(
        nodes.iter().chain(&edges).chain(&ends).all(short)
            && unique(&nodes)
            && unique(&edges)
            && all_nodes
            && all_edges,
    )
}

type Fields = [(String, Value)];

/// The fields of `value` as JavaScript reads them by name, or none where it is no object: an
/// object's own, and none of a list's.
fn fields_of(value: &Value) -> Option<&Fields> {
    match value {
        Value::Object(entries) => Some(entries),
        Value::List(_) => Some(&[]),
        _ => None,
    }
}

fn get<'v>(fields: &'v Fields, name: &str) -> Option<&'v Value> {
    fields
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value)
}

/// Whether `value` has the shape of graph data: an object whose nodes and edges are lists, of
/// objects up to the first that holds a field the bridge names, after which the bridge reads none.
fn shaped(value: &Value) -> bool {
    let list = |name| match fields_of(value).and_then(|fields| get(fields, name)) {
        Some(Value::List(items)) => Some(items.as_slice()),
        _ => None,
    };
    let (Some(nodes), Some(edges)) = (list("nodes"), list("edges")) else {
        return false;
    };
    let nodes = nodes.iter().map(|item| (GraphList::Nodes, item));
    let edges = edges.iter().map(|item| (GraphList::Edges, item));
    for (list, item) in nodes.chain(edges) {
        let Some(fields) = fields_of(item) else {
            return false;
        };
        if !mistyped(list, fields).is_empty() {
            return true;
        }
    }
    true
}

/// A field the bridge names: the list, the index, the identifier where the item has a string
/// one, and the field.
type Named = (GraphList, u32, Option<String>, String);

/// The fields of `item` that are missing or hold a value of another type, by name: of a node,
/// its identifier and its numbers; of an edge, its identifiers, colour, and arrow, and its label
/// and dash where they are given, and a given label's placement. A title, a label text, and a
/// background are refused by kinds of their own.
fn mistyped(list: GraphList, item: &Fields) -> Vec<&'static str> {
    let text = |name| matches!(get(item, name), Some(Value::Text(_)));
    let number = |fields, name| matches!(get(fields, name), Some(Value::Number(_)));
    let absent = |value: Option<&Value>| matches!(value, None | Some(Value::Null));
    let mut wrong = Vec::new();
    let mut check = |name, ok: bool| {
        if !ok {
            wrong.push(name);
        }
    };
    match list {
        GraphList::Nodes => {
            check("id", text("id"));
            for name in ["x", "y", "width"] {
                check(name, number(item, name));
            }
            check(
                "content",
                matches!(get(item, "content"), Some(Value::List(_))),
            );
            check("content.shape", first_shape(item).is_none());
        }
        GraphList::Edges => {
            for name in ["id", "source", "target"] {
                check(name, text(name));
            }
            let label = get(item, "label");
            match label.and_then(fields_of) {
                Some(placed) => {
                    check("label.t", number(placed, "t"));
                    check("label.offset", number(placed, "offset"));
                }
                None => check("label", absent(label)),
            }
            check("color", number(item, "color"));
            let dash = get(item, "dash");
            let number = |n: &Value| matches!(n, Value::Number(_));
            let pair = matches!(dash, Some(Value::List(v)) if v.len() == 2 && v.iter().all(number));
            check("dash", absent(dash) || pair);
            let arrow =
                matches!(get(item, "arrow"), Some(Value::Text(a)) if a == "end" || a == "none");
            check("arrow", arrow);
            for name in ["sourceSide", "targetSide"] {
                let sides = ["top", "right", "bottom", "left"];
                let side =
                    matches!(get(item, name), Some(Value::Text(s)) if sides.contains(&s.as_str()));
                check(name, side);
            }
        }
    }
    wrong
}

/// Every field of graph data `value` that the bridge may name, by brute force over the value.
fn named_fields(value: &Value) -> Vec<Named> {
    let mut named = Vec::new();
    for (list, name) in [(GraphList::Nodes, "nodes"), (GraphList::Edges, "edges")] {
        let items = match fields_of(value).and_then(|fields| get(fields, name)) {
            Some(Value::List(items)) => items.as_slice(),
            _ => &[],
        };
        for (index, item) in items.iter().enumerate() {
            let Some(fields) = fields_of(item) else {
                continue;
            };
            let id = match get(fields, "id") {
                Some(Value::Text(id)) => Some(id.clone()),
                _ => None,
            };
            for field in mistyped(list, fields) {
                let id = if field == "id" { None } else { id.clone() };
                named.push((list, index as u32, id, field.to_owned()));
            }
        }
    }
    named
}

/// Whether `text` names a Rust type or crate: a path, a backtick, a primitive, a type of the
/// bridge crate, or a word in camel case.
fn names_rust(text: &str) -> bool {
    const RUST: [&str; 18] = [
        "f32",
        "f64",
        "u8",
        "u32",
        "u64",
        "i64",
        "usize",
        "str",
        "String",
        "Vec",
        "Option",
        "JsValue",
        "GraphBatch",
        "NodeInput",
        "EdgeInput",
        "LabelInput",
        "Arrow",
        "Field",
    ];
    let camel = |word: &str| {
        let mut chars = word.chars();
        chars.next().is_some_and(char::is_uppercase) && chars.any(char::is_uppercase)
    };
    text.contains("::")
        || text.contains('`')
        || text
            .split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .any(|w| RUST.contains(&w) || w.contains('_') || w.starts_with("serde") || camel(w))
}

/// The texts of `error` the bridge writes itself: a malformed value's message, and what a field
/// expects.
fn messages(error: &GraphDataProblem) -> Vec<&str> {
    match error {
        GraphDataProblem::Malformed { message } => vec![message],
        GraphDataProblem::InvalidField { expected, .. } => vec![expected],
        _ => Vec::new(),
    }
}

#[test]
fn the_items_after_one_with_a_refused_field_are_left_unread() {
    let node = |x: Value| {
        let entries = [("id", Value::Text("a".into()))];
        let mut node: Vec<_> = entries
            .into_iter()
            .map(|(k, v)| (k.to_owned(), v))
            .collect();
        let size = [("y", 0.0), ("width", 1.0)].map(|(k, v)| (k.to_owned(), Value::Number(v)));
        node.push(("x".to_owned(), x));
        node.extend(size);
        node.push(("content".to_owned(), titled("A")));
        Value::Object(node)
    };
    // The second node is no object, which the bridge leaves unread after the first is refused.
    let nodes = Value::List(vec![node(Value::Bool(false)), Value::Bool(false)]);
    let value = Value::Object(vec![
        ("nodes".to_owned(), nodes),
        ("edges".to_owned(), Value::List(Vec::new())),
    ]);
    let batch = reading(|| GraphBatch::deserialize(value)).map_err(unshaped);
    let batch = batch.unwrap_or_else(|error| panic!("refused as {error:?}"));
    assert_eq!(batch.nodes.len(), 2);
    assert!(matches!(
        graph_of(&batch),
        Err(GraphDataProblem::InvalidField { index: 0, field, .. }) if field == "x"
    ));
    // A reading after it reads every item again.
    let well = Value::Object(vec![
        (
            "nodes".to_owned(),
            Value::List(vec![node(Value::Number(0.0))]),
        ),
        ("edges".to_owned(), Value::List(Vec::new())),
    ]);
    let batch = reading(|| GraphBatch::deserialize(well)).map_err(unshaped);
    assert!(graph_of(&batch.unwrap_or_else(|error| panic!("refused as {error:?}"))).is_ok());
}

#[test]
fn content_read_through_serde_names_its_first_shape_and_reads_the_rest() {
    // Verifies: ADR-0034
    // A row that is no list and an element that is no object, as `addNode` and `updateNode`
    // read content: the first named, each read as empty in its place.
    let read = |rows: Vec<Value>| ContentInput::deserialize(Value::List(rows)).unwrap();
    let Value::List(rows) = titled("t") else {
        unreachable!()
    };
    let Value::List(elements) = rows[0].clone() else {
        unreachable!()
    };
    let title = || elements[0].clone();
    let shaped = read(vec![
        Value::List(vec![title(), Value::Bool(false)]),
        Value::Number(3.0),
    ]);
    assert_eq!(shaped.shape, Some((0, Some(1))));
    assert_eq!(shaped.data.element_bounds, [0, 2, 2]);
    assert_eq!(
        shaped.data.kinds,
        [KindCode::Text as u8, KindCode::Unnamed as u8]
    );
    let list = Value::List(vec![title()]);
    assert_eq!(read(vec![Value::Null, list.clone()]).shape, Some((0, None)));
    assert_eq!(read(vec![list.clone(), list]).shape, None);
}

#[test]
fn the_check_for_rust_names_finds_them() {
    let message = "Failed to deserialize JsValue into type `comb_engine_wasm::GraphBatch`: \
                   Error: invalid type: string \"1\", expected f64";
    assert!(names_rust(message));
    for named in [
        "TooManySlots",
        "expected f64",
        "a usize",
        "serde_wasm_bindgen",
    ] {
        assert!(names_rust(named), "{named}");
    }
    assert!(!names_rust("an integer from 0 to 0xFFFFFF"));
    assert!(!names_rust(
        "the value does not have the shape the bridge expects"
    ));
}

/// The content of a node of the time before content: one row of one title, `title`.
fn titled(title: &str) -> Value {
    let text = |value: &str| Value::Text(value.to_owned());
    let element = Value::Object(vec![
        ("kind".to_owned(), text("text")),
        ("role".to_owned(), text("title")),
        ("weight".to_owned(), Value::Number(1.0)),
        ("text".to_owned(), text(title)),
    ]);
    Value::List(vec![Value::List(vec![element])])
}

/// A patch of `updateNode`: mostly content of any value, now and then another field of a node or
/// none, and now and then a value of any shape at all.
fn patch() -> impl Strategy<Value = Value> {
    let key = prop::sample::select(vec![
        "content", "content", "content", "id", "width", "x", "",
    ]);
    let value = prop_oneof![8 => content(true), 1 => anything()];
    let entries = prop::collection::vec((key.prop_map(str::to_owned), value), 0..3);
    prop_oneof![
        8 => entries.prop_map(Value::Object),
        1 => anything(),
    ]
}

/// A node `addNode` might be handed: mostly of the right shape with values to refuse here and
/// there, loose now and then, and now and then a value of any shape at all.
fn added_node() -> impl Strategy<Value = Value> {
    prop_oneof![
        6 => node(false, 0),
        3 => item(node(true, 0), true),
        1 => anything(),
    ]
}

/// Graph data of nodes `n0` and `n1` and the edges `edges`.
fn two_nodes(edges: Vec<Value>) -> Value {
    let node = |id: &str| {
        Value::Object(vec![
            ("id".to_owned(), Value::Text(id.to_owned())),
            ("x".to_owned(), Value::Number(0.0)),
            ("y".to_owned(), Value::Number(0.0)),
            ("width".to_owned(), Value::Number(1.0)),
            ("content".to_owned(), titled(id)),
        ])
    };
    Value::Object(vec![
        (
            "nodes".to_owned(),
            Value::List(vec![node("n0"), node("n1")]),
        ),
        ("edges".to_owned(), Value::List(edges)),
    ])
}

/// The bound on a piece of a string column (ADR-0034): mostly a few code units, so that a column
/// crosses in many pieces, now and then around the longest values, and now and then the
/// snapshot's.
fn piece_bound() -> impl Strategy<Value = usize> {
    prop_oneof![
        6 => 1..=8_usize,
        3 => 1..=1_100_usize,
        1 => Just(1_usize << 28),
    ]
}

/// The graph a load of `data` builds, or why the load was refused, as the shell hands it to the
/// bridge, each string column in pieces of at most `bound` code units, or of its longest value:
/// graph data that is no object, or whose nodes or edges are no list, the snapshot of `api` cannot
/// read and refuses as malformed itself; the nodes cross as the columns it builds, each node read
/// as the node of `addNode` is, and one that is no object, nor a list, which is an object without
/// the fields, named as such; the edges as columns too, each read as the edge of `addEdge` is but
/// for its arrowhead and sides, which cross as their codes.
fn loaded(bound: usize, data: Value) -> Result<comb_engine::graph::Graph, GraphDataProblem> {
    let (nodes, edges) = match &data {
        Value::Object(fields) => (get(fields, "nodes"), get(fields, "edges")),
        _ => (None, None),
    };
    let (Some(Value::List(nodes)), Some(Value::List(edges))) = (nodes, edges) else {
        return Err(unshaped("the snapshot cannot read it"));
    };
    /// Each item of `items` read as an object, none where it is no object.
    fn read<T: for<'de> Deserialize<'de>>(items: &[Value]) -> Vec<Option<T>> {
        let item = |item: &Value| {
            fields_of(item).map(|_| {
                reading(|| T::deserialize(item.clone()))
                    .unwrap_or_else(|error| panic!("an object read as an item: {error}"))
            })
        };
        items.iter().map(item).collect()
    }
    let nodes: Vec<Option<NodeInput>> = read(nodes);
    let edges: Vec<Option<EdgeCells>> = read(edges);
    let nodes = OwnedColumns::in_pieces(bound, nodes.iter().map(Option::as_ref));
    let edges = OwnedEdgeColumns::in_pieces(bound, edges.iter().map(Option::as_ref));
    let fonts = Fonts::default();
    let loaded = load_of(&nodes.view(), &edges.view(), &fonts)?;
    // Every node of a load the bridge accepted lays out, as a query at the near level lays it out.
    let mut content = nodes.content.clone();
    content.spans = loaded.spans;
    let (mut cells, mut rows, mut placed) = (Vec::new(), Vec::new(), Vec::new());
    let mut drawn = super::Drawn::default();
    drawn.clear();
    for node in 0..loaded.graph.nodes_in_use() as usize {
        let width = loaded.graph.sizes()[node * 2];
        let start = placed.len();
        content.lay_out(node, width, &fonts, &mut cells, &mut rows, &mut placed);
        content.draw(node, &placed[start..], &mut drawn);
        content.content_of(node);
    }
    assert_eq!(drawn.bounds.len(), placed.len() + 1);
    // Each text is read back as the column holds it, mapped or not.
    let texts = super::values(&content.texts, &content.text_bounds).expect("mapped texts");
    for (index, text) in texts.into_iter().enumerate() {
        assert_eq!(content.text(index), text);
    }
    Ok(loaded.graph)
}

/// The edge `e0` from `n0` to `n1`, styled, dashed, and labelled, which a patch of `updateEdge`
/// changes.
fn base_edge() -> Vec<(String, Value)> {
    vec![
        ("id".to_owned(), Value::Text("e0".to_owned())),
        ("source".to_owned(), Value::Text("n0".to_owned())),
        ("target".to_owned(), Value::Text("n1".to_owned())),
        ("color".to_owned(), Value::Number(f64::from(0x12_3456))),
        ("arrow".to_owned(), Value::Text("end".to_owned())),
        ("sourceSide".to_owned(), Value::Text("bottom".to_owned())),
        ("targetSide".to_owned(), Value::Text("top".to_owned())),
        // A dash and a label too, so that a patch that names neither is seen to keep them.
        (
            "dash".to_owned(),
            Value::List(vec![Value::Number(8.0), Value::Number(4.0)]),
        ),
        (
            "label".to_owned(),
            Value::Object(vec![
                ("text".to_owned(), Value::Text("x".to_owned())),
                ("t".to_owned(), Value::Number(0.3)),
                ("offset".to_owned(), Value::Number(5.0)),
            ]),
        ),
    ]
}

/// The fields a patch of `updateEdge` may set.
const PATCHED: [&str; 6] = [
    "color",
    "dash",
    "arrow",
    "label",
    "sourceSide",
    "targetSide",
];

/// A patch of `updateEdge`: some of the fields of an edge, of any value, and now and then a field
/// of another name among them.
fn edge_patch() -> impl Strategy<Value = Vec<(String, Value)>> {
    let other = prop::sample::select(vec!["id", "source", "width", "", "colour"]);
    (
        edge(true, 0, 2),
        0..16_u32,
        prop::option::of((0..5_usize, other)),
    )
        .prop_map(|(edge, keep, other)| {
            let Value::Object(fields) = edge else {
                unreachable!()
            };
            let mut patch: Vec<(String, Value)> = fields
                .into_iter()
                .filter(|(name, _)| {
                    let bit = PATCHED.iter().position(|f| f == name);
                    bit.is_some_and(|bit| keep & (1 << bit) != 0)
                })
                .collect();
            if let Some((at, name)) = other {
                patch.insert(at.min(patch.len()), (name.to_owned(), Value::Bool(false)));
            }
            patch
        })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn an_added_edge_is_refused_exactly_as_a_load_of_it_alone_and_a_self_edge_besides(
        value in prop_oneof![9 => edge(true, 0, 2), 1 => anything()],
        bound in piece_bound(),
    ) {
        // Verifies: ADR-0028, ADR-0024, Q-7
        let as_load = loaded(bound, two_nodes(vec![value.clone()]));
        // An end the graph does not hold is `api`'s to refuse, against its map.
        prop_assume!(!matches!(as_load, Err(GraphDataProblem::MissingNode { .. })));
        let end = |name: &str| match &value {
            Value::Object(fields) => fields.iter().find(|(k, _)| k == name).and_then(|(_, v)| match v {
                Value::Text(t) if t == "n0" || t == "n1" => Some(t.clone()),
                _ => None,
            }),
            _ => None,
        };
        let (source, target) = (end("source"), end("target"));
        let slot_of = |end: &Option<String>| u32::from(end.as_deref() == Some("n1"));
        let mut graph = loaded(bound, two_nodes(Vec::new())).unwrap();
        let added = reading(|| EdgeInput::deserialize(value.clone()))
            .map_err(|error| EdgeRefusal::Data(unshaped(error)))
            .and_then(|edge| add_edge_to(&mut graph, &edge, slot_of(&source), slot_of(&target)));
        let typed = matches!(
            as_load,
            Err(GraphDataProblem::InvalidField { .. } | GraphDataProblem::IdTooLong { .. }
                | GraphDataProblem::Malformed { .. })
        );
        if source.is_some() && source == target && !typed {
            prop_assert!(
                matches!(added, Err(EdgeRefusal::Data(GraphDataProblem::SelfEdge { .. }))),
                "{:?}",
                added
            );
            prop_assert_eq!(graph.edges_in_use(), 0);
            return Ok(());
        }
        // Held to the oracle on its own too, so that a check a load shares with it, dropped, is seen.
        prop_assert_eq!(added.is_ok(), accepted_alone(value.clone()), "{:?}", added);
        match (added, as_load) {
            (Ok(slot), Ok(expected)) => {
                prop_assert_eq!(slot, 0);
                prop_assert_eq!(graph.edge(0), expected.edge(0));
            }
            (Err(error), Err(expected)) => {
                prop_assert_eq!(error, EdgeRefusal::Data(expected));
                prop_assert_eq!(graph.edges_in_use(), 0);
            }
            (added, as_load) => prop_assert!(false, "added {:?}, loaded {:?}", added, as_load.map(|_| ())),
        }
    }

    #[test]
    fn an_edge_patch_is_refused_exactly_as_a_load_of_the_edge_it_makes_and_the_edge_kept(
        patch in edge_patch(),
        bound in piece_bound(),
    ) {
        // Verifies: ADR-0028, ADR-0030, Q-7
        let mut graph = loaded(bound, two_nodes(vec![Value::Object(base_edge())])).unwrap();
        let before = graph.edge(0);
        let other = patch
            .iter()
            .find(|(name, _)| !PATCHED.contains(&name.as_str()))
            .map(|(name, _)| name.clone());
        let mut merged = base_edge();
        for (name, value) in patch.iter().take_while(|(name, _)| Some(name) != other.as_ref()) {
            merged.retain(|(k, _)| k != name);
            merged.push((name.clone(), value.clone()));
        }
        let updated = reading(|| EdgePatch::deserialize(Value::Object(patch)))
            .map_err(|error| EdgeRefusal::Data(unshaped(error)))
            .and_then(|patch| update_edge_in(&mut graph, 0, "e0", patch));
        if let Some(field) = other {
            prop_assert_eq!(updated, Err(EdgeRefusal::Data(GraphDataProblem::UnknownEdgePatchField {
                edge: "e0".to_owned(),
                field,
            })));
            prop_assert_eq!(graph.edge(0), before);
            return Ok(());
        }
        // Held to the oracle on its own too, as an added edge is.
        prop_assert_eq!(updated.is_ok(), accepted_alone(Value::Object(merged.clone())), "{:?}", updated);
        match (updated, loaded(bound, two_nodes(vec![Value::Object(merged)]))) {
            (Ok(()), Ok(expected)) => prop_assert_eq!(graph.edge(0), expected.edge(0)),
            (Err(error), Err(expected)) => {
                prop_assert_eq!(error, EdgeRefusal::Data(expected));
                prop_assert_eq!(graph.edge(0), before);
            }
            (updated, as_load) => prop_assert!(false, "updated {:?}, loaded {:?}", updated, as_load.map(|_| ())),
        }
    }

    #[test]
    fn an_added_node_is_refused_exactly_as_a_load_of_it_alone_and_the_graph_kept(
        value in added_node(),
        bound in piece_bound(),
    ) {
        // Verifies: ADR-0028, ADR-0022, Q-7
        let with_a = || {
            let a = Value::Object(vec![
                ("id".to_owned(), Value::Text("a".to_owned())),
                ("x".to_owned(), Value::Number(0.0)),
                ("y".to_owned(), Value::Number(0.0)),
                ("width".to_owned(), Value::Number(1.0)),
                ("content".to_owned(), titled("A")),
            ]);
            let data = Value::Object(vec![
                ("nodes".to_owned(), Value::List(vec![a])),
                ("edges".to_owned(), Value::List(Vec::new())),
            ]);
            graph_of(&GraphBatch::deserialize(data).unwrap()).unwrap()
        };
        let alone = Value::Object(vec![
            ("nodes".to_owned(), Value::List(vec![value.clone()])),
            ("edges".to_owned(), Value::List(Vec::new())),
        ]);
        let as_load = loaded(bound, alone)
            .map(|graph| (graph.positions().to_vec(), graph.sizes().to_vec()));
        let mut graph = with_a();
        let added = reading(|| NodeInput::deserialize(value))
            .map_err(unshaped)
            .and_then(|node| add_node_to(&mut graph, &node, &Fonts::default()));
        match (added, as_load) {
            (Ok((slot, _)), Ok((positions, sizes))) => {
                prop_assert_eq!(slot, 1);
                prop_assert_eq!(&graph.positions()[2..], &positions[..]);
                prop_assert_eq!(&graph.sizes()[2..], &sizes[..]);
            }
            (Err(error), Err(expected)) => {
                prop_assert_eq!(error, expected);
                prop_assert_eq!(graph.positions(), &[0.0, 0.0][..]);
                prop_assert_eq!(graph.nodes_in_use(), 1);
            }
            (added, as_load) => prop_assert!(false, "added {:?}, loaded {:?}", added, as_load),
        }
    }

    #[test]
    fn any_graph_data_ends_in_a_typed_error_or_a_graph(
        value in graph_data(),
        bound in piece_bound(),
    ) {
        // Verifies: ADR-0034
        // A panic anywhere below fails the case; the runner catches it and shrinks the input.
        // The load crosses as columns, its strings in pieces of the bound generated with it, and
        // is held to the oracles of the value it was built of.
        let named = named_fields(&value);
        let batch = || reading(|| GraphBatch::deserialize(value.clone())).ok();
        match loaded(bound, value.clone()) {
            // A value without the shape of graph data is refused before any check of the
            // bridge's own, as malformed.
            Err(error @ GraphDataProblem::Malformed { .. }) => {
                prop_assert!(!shaped(&value), "refused {:?}", error);
                prop_assert!(!messages(&error).into_iter().any(names_rust), "{:?}", error);
            }
            Ok(graph) => {
                prop_assert!(shaped(&value));
                let batch = batch().expect("graph data of its shape reads as a batch");
                prop_assert!(named.is_empty() && acceptable(&batch, &value));
                prop_assert_eq!(graph.positions().len(), 2 * batch.nodes.len());
            }
            Err(error) => {
                prop_assert!(shaped(&value), "refused {:?}", error);
                prop_assert!(!messages(&error).into_iter().any(names_rust), "{:?}", error);
                match &error {
                    // A field missing or of another type is named before any other check.
                    GraphDataProblem::InvalidField { list, index, id, field, .. } => {
                        let at = (*list, *index, id.clone(), field.clone());
                        prop_assert!(named.contains(&at), "refused {:?}", error);
                    }
                    // So is a shape of content the snapshot cannot flatten, at its position.
                    GraphDataProblem::InvalidContentShape { index, id, row, column, .. } => {
                        let at = (GraphList::Nodes, *index, id.clone(), "content.shape".to_owned());
                        prop_assert!(named.contains(&at), "refused {:?}", error);
                        let node = &nodes_of_data(&value)[*index as usize];
                        let shape = fields_of(node).and_then(first_shape);
                        prop_assert_eq!(shape, Some((*row, *column)));
                    }
                    _ => {
                        let batch = batch().expect("graph data of its shape reads as a batch");
                        prop_assert!(named.is_empty(), "refused {:?}, not {:?}", error, named);
                        prop_assert!(!acceptable(&batch, &value), "refused {:?}", error);
                    }
                }
            }
        }
    }

    #[test]
    fn any_patch_ends_in_a_typed_error_or_is_accepted(value in patch()) {
        // Verifies: ADR-0013, Q-7
        // A patch is accepted exactly where each of its fields is content a load of the node
        // accepts, up to the first field of another name, after which nothing is read.
        let entries = match &value {
            Value::Object(entries) => Some(entries.clone()),
            _ => None,
        };
        match NodePatch::deserialize(value).map_err(unshaped) {
            Err(error) => prop_assert!(!messages(&error).into_iter().any(names_rust)),
            Ok(patch) => {
                let entries = entries.expect("a patch read of an object");
                let read: Vec<_> = entries.iter().scan(false, |done, (key, value)| {
                    (!*done).then(|| { *done = key != "content"; (key, value) })
                }).collect();
                let fine = read.iter().all(|(key, value)| {
                    let node = Value::Object(vec![("content".to_owned(), (*value).clone())]);
                    *key == "content" && content_ok(&node)
                });
                let sets = read.iter().any(|(key, _)| *key == "content");
                match patch_of("n", &patch, &Fonts::default()) {
                    Ok(checked) => prop_assert!(fine && checked.is_some() == sets),
                    Err(error) => {
                        prop_assert!(!fine);
                        prop_assert!(!messages(&error).into_iter().any(names_rust));
                    }
                }
            }
        }
    }
}
