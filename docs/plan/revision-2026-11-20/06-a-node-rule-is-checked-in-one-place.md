# Ticket: Each rule of a node is checked in one function that a load, addNode, and updateNode reach

## What to build

The module doc of `crates/engine-wasm/src/graph_data/checks.rs` says that each rule goes through
one function that a load, `addNode`, `addEdge`, and `updateEdge` reach alike. `updateNode` is not
in that list, and the rules of a node that uml-diagrams added do not follow it. Each path checks
them on its own:

- a load in `load_of`, `add_node_to`, and `ridden` of `graph_data/load.rs`;
- a patch in its own match per field in `patch_of` of `graph_data/edit.rs`;
- a border node in `check_border` of `graph_data/borders.rs`, with the `beside` byte computed in
  `packages/comb/src/bridge/columns.ts`;
- the budget of the regions' names and the height in `update_with` of
  `crates/engine-wasm/src/lib.rs`;
- `invalidContainer` in `packages/comb/src/api/editors.ts` (`refusedAs`, `containerOf`, and three
  wordings of its own), in the bridge crate, and in the engine.

ARCH-one-workspace-per-example leaves `api` the refusals it checks against the map, and every other
refusal to the bridge crate; `invalidContainer` is not among the former.

Evidence: the paths drifted apart repeatedly. Ticket 02 of uml-diagrams, finding 5:
`invalidContainer` stands in `api`, the bridge, and the engine, its wordings tied only by the
browser tests, named in *Doubts* and not fixed. Ticket 05, finding 3: the regions' names were not
counted against the budget, fixed apart in a load, `addNode`, and `updateNode`. Ticket 06, finding
7: `regions: []` taken by a load and refused by `addNode` and `updateNode` (f7885b4f); and the
human's decision built in 3aa033f8, since a load and `addNode` took `side` and `offset` on a node
that is no border node and only `updateNode` refused them.

Let one function per rule of a node decide it: the attachment, the container, the regions with an
empty list, the budget of the regions' names, and the height. A load, `addNode`, and `updateNode`
call it, and `api` passes the bridge's problem on rather than word `invalidContainer` itself.

## Acceptance criteria

- [ ] Given each of `invalidAttachment`, `invalidContainer`, the budget of the regions' names, and
      an empty list of regions, when the bridge crate is read, then one function decides it, and a
      unit test runs it through a load, `addNode`, and `updateNode` alike.
- [ ] Given `packages/comb/src/api/`, when it is read, then it constructs no `invalidContainer`, and
      the browser tests of `examples/metric-tree/e2e/containers.spec.ts` and `malformed.spec.ts` see
      the refusals they see today.
- [ ] Given the module doc of `checks.rs`, when it is read against the code, then it names
      `updateNode` among the paths and holds.

## Read first

- Touches: `crates/engine-wasm/src/graph_data/checks.rs`,
  `crates/engine-wasm/src/graph_data/load.rs`, `crates/engine-wasm/src/graph_data/edit.rs`,
  `crates/engine-wasm/src/graph_data/borders.rs`, `crates/engine-wasm/src/lib.rs`,
  `packages/comb/src/api/editors.ts`
- ARCH-one-workspace-per-example (*Validation*), API-edits-report-nested-changes,
  API-bridge-columns-carry-nesting.
- The seam: the bridge crate's tests and `crates/engine-wasm/src/properties.rs`; the browser tests
  named above.

## Blocked by

- None (can start immediately)

## Mode

with the human: it touches the bridge crate and `api`, protected parts the maintainer reviews
(DEV-implementer-and-fresh-reviewer).
