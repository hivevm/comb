# Ticket: Codes and answers cross the bridge as generated types, or the ADR says why not

## What to build

API-bridge-columns-carry-nesting decides that structured data derives Serialize, Deserialize, and
Tsify, that its TypeScript definition is the generated one and never written by hand, and that
`innerOf(slot)` hands back the rectangle as structured data. The code departs from it:

- `innerOf` in `crates/engine-wasm/src/lib.rs` returns a `Vec<f64>`, and so do `borderOf`,
  `slide`, `labelPoint`, and `moveLabel`, which `packages/comb/src/bridge/index.ts` reads by index;
- the removal crosses as one array led by the count of nodes, which `index.ts` splits;
- `BORDER_SIDES` in `index.ts` decodes the side as an index of a hand-written table, and `DIVIDES`
  in `packages/comb/src/bridge/columns.ts` pairs with `divide_of` of
  `crates/engine-wasm/src/graph_data/regions.rs` without a generated enum;
- the `beside` byte of the columns mixes two meanings in its values 0 to 5;
- the export `updateNode` takes a fourth parameter, `kept`, with `u32::MAX` as a sentinel, which the
  ADR does not name; it names `updateNode(slot, id, patch)`.

Evidence: the hand-off of ticket 02 of uml-diagrams names in *Doubts* that the removal crosses as
one array led by a count, which no ADR names. Ticket 07, finding 10: the human put `innerOf` into
the ADR as structured data, and the code kept `Vec<f64>`. Ticket 06, the second review, lesser:
`beside` 4 and 5 are refused as `invalidAttachment`, not as malformed.

Bring code and ADR together before the ADR is accepted. Where the code moves: generated enums for
the side, the division, and `beside`, and small generated structs for the removal, the place, the
inner rectangle, and the place of a label. Where the ADR moves, because a serde call per drag frame
costs what `slide` and `moveLabel` cannot pay, the ADR names the tuples and why.

## Acceptance criteria

- [ ] Given `packages/comb/src/bridge/`, when it is searched, then it holds no table of numeric
      codes other than generated enums.
- [ ] Given `SideCode` reordered in the bridge crate, when the shell builds, then the build or a
      test fails, not the drawing.
- [ ] Given API-bridge-columns-carry-nesting, when it is read against `lib.rs`, then it names each
      export's parameters, `kept` among them, and each answer's shape.

## Read first

- Touches: `crates/engine-wasm/src/lib.rs`, `crates/engine-wasm/src/graph_data/regions.rs`,
  `crates/engine-wasm/src/graph_data/node_columns.rs`, `packages/comb/src/bridge/index.ts`,
  `packages/comb/src/bridge/columns.ts`, `docs/adr/API-bridge-columns-carry-nesting.md`
- API-bridge-columns-carry-nesting, API-bridge-takes-serde-and-columns, SEC-pixijs-without-eval.
- The seam: `packages/comb/src/bridge/bridge.test.ts` and the bridge crate's tests.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the bridge crate, the bridge, and a proposed ADR, all of which the
maintainer keeps, and which way each departure is settled is the maintainer's choice.
