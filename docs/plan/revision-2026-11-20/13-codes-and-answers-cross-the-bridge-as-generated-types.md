# Ticket: Codes and answers cross the bridge as generated types, or a superseding ADR says why not

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
- the column `given`, a byte of bits a load's columns carry per node, x 1, y 2, container 4,
  side 8, and offset 16, pairs `GIVEN` in `columns.ts` with `Given::of_bits` of
  `crates/engine-wasm/src/graph_data/checks.rs` by hand, without a generated type;
- the export `updateNode` takes a fourth parameter, `kept`, with `u32::MAX` as a sentinel, which the
  ADR does not name; it names `updateNode(slot, id, patch)`.

Evidence: the hand-off of ticket 02 of uml-diagrams names in *Doubts* that the removal crosses as
one array led by a count, which no ADR names. Ticket 07, finding 10: the human put `innerOf` into
the ADR as structured data, and the code kept `Vec<f64>`. Ticket 06, the second review, lesser:
`beside` 4 and 5 were refused as `invalidAttachment`, not as malformed; the bitmask `given` has
since replaced the byte `beside` of values 0 to 5, whose two meanings that finding named.

API-bridge-columns-carry-nesting is accepted since PR #106 and changes only by supersession
(NUC-decisions-are-proposed-then-accepted §6). Its proposed successor,
API-bridge-columns-keep-no-size, restates these decisions, so the superseding ADR this ticket asks
for supersedes that successor. The human chose on 2026-11-21 to settle each
departure one of two ways:

- The code moves where it can: generated enums for the side and the division, a generated type
  for `given`, and small generated structs for the removal, the place, the inner rectangle, and
  the place of a label.
- A departure stays only where moving it costs too much, such as a serde call per drag frame in
  `slide` and `moveLabel`, or the sentinel of `kept`. A superseding ADR, proposed and accepted
  before the code relies on it, names those tuples and parameters and why.

## Acceptance criteria

- [ ] Given `packages/comb/src/bridge/`, when it is searched, then it holds no table of numeric
      codes other than generated enums.
- [ ] Given `SideCode` reordered in the bridge crate, when the shell builds, then the build or a
      test fails, not the drawing.
- [ ] Given API-bridge-columns-keep-no-size, or the ADR that supersedes it, when it is read
      against `lib.rs`, then it names each export's parameters, `kept` among them, and each
      answer's shape.

## Read first

- Touches: `crates/engine-wasm/src/lib.rs`, `crates/engine-wasm/src/graph_data/regions.rs`,
  `crates/engine-wasm/src/graph_data/node_columns.rs`,
  `crates/engine-wasm/src/graph_data/checks.rs`, `packages/comb/src/bridge/index.ts`,
  `packages/comb/src/bridge/columns.ts`, and a superseding ADR under `docs/adr/` if one is due
- API-bridge-columns-keep-no-size and the ADR it supersedes, API-bridge-columns-carry-nesting,
  API-bridge-takes-serde-and-columns, SEC-pixijs-without-eval.
- The seam: `packages/comb/src/bridge/bridge.test.ts` and the bridge crate's tests.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the bridge crate and the bridge, which the maintainer keeps, and a
superseding ADR is the maintainer's to accept.
