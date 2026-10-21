# Ticket: A value of the wrong shape names its node, edge, and field

## What to build

ADR-0010 (*Errors*) says every export that receives graph data returns a typed error that names
the offending node, edge, or field. The bridge crate's `malformed` problem does not. Loading a
node whose `x` is the string `"1"` throws a problem of kind `malformed` whose message reads:

```
Failed to deserialize JsValue into type `comb_engine_wasm::GraphBatch`: Error: invalid type: string "1", expected f64
```

No node, no field, and the name of a Rust type inside the bridge crate. The same holds for a
missing width, a colour of `-1` or `1.5`, and an identifier that is a number (checked with the
bridge built from `main` at 46e35d2). A host application cannot tell its user which node is
wrong.

The problem names where the value was refused, the node or edge by identifier where it has one
and by index where it has none, and the field, and its message says what was expected without
naming a Rust type. Its shape is the generated one of ADR-0010.

## Acceptance criteria

- [ ] Given a node or an edge with a field of the wrong type, or a field missing, when it is
      loaded, then the problem names the node or edge and the field (`Verifies: ADR-0010`).
- [ ] Given any refused value, when the message is read, then it names no Rust type or crate.
- [ ] Given a table of single-field corruptions (each field of a node and an edge, with a
      wrong type and missing), when each is loaded through the bridge, then the problem names
      that field and its node or edge.
- [ ] Broken once: the problem without its field fails the first criterion's test.

## Read first

- ADR-0010 in full, ADR-0007 (protected parts).
- `crates/engine-wasm/src/lib.rs` (`BridgeError`, `malformed`, `load_graph`),
  `crates/engine-wasm/src/properties.rs`, `packages/comb/src/bridge/bridge.test.ts`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it changes the data format of the bridge and the validation of graph data,
protected parts of ADR-0007.
