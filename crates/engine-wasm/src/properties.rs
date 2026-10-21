//! The property test of the bridge's validation (Q-7): graph data of any shape, well formed or
//! not, ends in a typed error or a graph, never in a panic, and in a graph exactly when an oracle
//! written apart from the bridge finds nothing to refuse.
//!
//! The data crosses as serde-wasm-bindgen would hand it over, through a value of any shape that
//! `GraphBatch` is deserialized from, so that values of the wrong type and missing fields reach
//! the same conversion `loadGraph` makes.
// Verifies: Q-7, ADR-0010

use proptest::prelude::*;
use serde::Deserialize;
use serde::de::value::{MapDeserializer, SeqDeserializer};
use serde::de::{self, IntoDeserializer, Visitor};

use super::{GraphBatch, graph_of, malformed};

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

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf unit
        unit_struct newtype_struct seq tuple tuple_struct map struct identifier ignored_any
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

/// The identifier of the `i`th node or edge, now and then that of one of the first four, so
/// that duplicates occur.
fn nth(prefix: &'static str, i: usize) -> impl Strategy<Value = Value> {
    prop_oneof![10 => Just(i), 1 => 0..4_usize]
        .prop_map(move |k| Value::Text(format!("{prefix}{k}")))
}

/// The end of an edge among `nodes` nodes: mostly one of them, now and then one beyond.
fn end(nodes: usize) -> impl Strategy<Value = Value> {
    prop_oneof![20 => 0..nodes.max(1), 1 => Just(nodes)].prop_map(|k| Value::Text(format!("n{k}")))
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
        field("height", size(), loose),
    ])
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
        field("t", num(), loose),
        field("offset", num(), loose),
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
    object(vec![
        field("id", nth("e", j), loose),
        field("source", end(nodes), loose),
        field("target", end(nodes), loose),
        field("label", label, loose),
        field("color", color(loose), loose),
        field("dash", dash, loose),
        field("arrow", arrow, loose),
    ])
}

/// Graph data as the host application might hand it over: mostly of the right shape with values
/// to refuse here and there; loose, with a value of the wrong type or a missing field now and
/// then; and now and then a value of any shape at all.
fn graph_data() -> impl Strategy<Value = Value> {
    let batch = |loose| {
        (0..8_usize, 0..8_usize).prop_flat_map(move |(nodes, edges)| {
            let nodes_of = (0..nodes)
                .map(|i| node(loose, i).boxed())
                .collect::<Vec<_>>();
            let edges_of = (0..edges)
                .map(|j| edge(loose, j, nodes).boxed())
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

/// Whether nothing in `batch` is to be refused, by brute force over the batch alone.
fn acceptable(batch: &GraphBatch) -> bool {
    let unique = |ids: &[&str]| (0..ids.len()).all(|i| !ids[..i].contains(&ids[i]));
    let nodes: Vec<&str> = batch.nodes.iter().map(|n| n.id.as_str()).collect();
    let edges: Vec<&str> = batch.edges.iter().map(|e| e.id.as_str()).collect();
    let node_ok = |n: &super::NodeInput| {
        [n.x, n.y, n.width, n.height].into_iter().all(finite32)
            && n.width as f32 >= 0.0
            && n.height as f32 >= 0.0
    };
    let edge_ok = |e: &super::EdgeInput| {
        nodes.contains(&e.source.as_str())
            && nodes.contains(&e.target.as_str())
            && e.label
                .is_none_or(|l| l.t.is_finite() && l.offset.is_finite())
            && e.color <= 0xff_ffff
            && e.dash.is_none_or(|[d, g]| {
                finite32(d) && finite32(g) && d as f32 > 0.0 && g as f32 >= 0.0
            })
    };
    unique(&nodes)
        && unique(&edges)
        && batch.nodes.iter().all(node_ok)
        && batch.edges.iter().all(edge_ok)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(CASES))]

    #[test]
    fn any_graph_data_ends_in_a_typed_error_or_a_graph(value in graph_data()) {
        // A panic anywhere below fails the case; the runner catches it and shrinks the input.
        match GraphBatch::deserialize(value).map_err(malformed) {
            // A value of the wrong shape is refused before any check of the bridge's own.
            Err(_) => {}
            Ok(batch) => match graph_of(&batch) {
                Ok(graph) => {
                    prop_assert!(acceptable(&batch));
                    prop_assert_eq!(graph.positions().len(), 2 * batch.nodes.len());
                }
                Err(error) => {
                    prop_assert!(!acceptable(&batch), "refused {:?}", error);
                }
            },
        }
    }
}
