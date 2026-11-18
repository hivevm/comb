# Ticket: An edge carries a list of labels, an open or hollow arrowhead, and a lightning bolt

## What to build

`EdgeData.labels` replaces `label`: each label has an identifier, its text, its path parameter, its
label offset, and its background, and each is placed and kept as G-6 says. A label drag moves the
one label pressed, and `labelMoved` names it. A query returns a found label as its edge's slot and
its place in the list. `arrow` takes `"open"` and `"hollow"` beside `"end"` and `"none"`, and
`lightning` draws a zigzag in the path's middle. Both examples move to `labels`, and so does the UML
example's convention on relationships.

## Acceptance criteria

- [ ] Given an association with a multiplicity at each end and a name in the middle, when it loads,
      then three labels are drawn at their path parameters and follow as a node moves (G-6).
- [ ] Given the user dragging the label at the source end, when it is released, then only that label
      moved, and `labelMoved` names the edge and the label.
- [ ] Given edges with `arrow` `"open"` and `"hollow"`, when they are drawn, then their tips lie at
      the target's end within Q-4's precision, the hollow one drawn around a white fill.
- [ ] Given an edge with `lightning`, when it is drawn, then its turns lie between the path
      parameters 0.45 and 0.55.
- [ ] Given the metric tree and the UML example's class and package diagrams with their labels as
      lists of one, when their tests run, then they pass, the reference image of the edges among
      them.

## Read first

- Touches: `crates/engine/src/graph/labels.rs`, `crates/engine/src/stroke.rs`,
  `crates/engine/src/geometry.rs`, `crates/engine-wasm/src/graph_data.rs`,
  `crates/engine-wasm/src/lib.rs`, `crates/engine-wasm/src/properties.rs`,
  `packages/comb/src/api/snapshot.ts`, `packages/comb/src/api/editors.ts`,
  `packages/comb/src/store/index.ts`, `packages/comb/src/render/labels.ts`,
  `packages/comb/src/interaction/label-drag.ts`, `examples/metric-tree/src/`,
  `examples/uml/src/relationships.ts`, `docs/CONVENTIONS.md`
- ADRs: API-edges-dock-nodes-or-edges (*Edge labels*, *Arrowheads*, *Lightning bolt*),
  API-bridge-columns-carry-nesting, API-edits-report-nested-changes (*Changes*),
  REN-virtualized-nested-scene (*Edges*).
- Glossary: Edge label, Arrowhead, Label offset, Path parameter. Conventions: *The UML example tells
  a relationship by its kind's family of colour*, *What stays is pinned by assertions, not by
  unchanged files*.
- Golden path: the one label of today, `examples/metric-tree/e2e/label-drag.spec.ts`; the arrowhead
  in `crates/engine/src/stroke.rs`.
- Seam: stroke tests, the bridge's property test, browser tests in `examples/metric-tree/e2e/`.

## Blocked by

- None (can start immediately)

## Mode

with the human: it implements a proposed ADR whose acceptance, and the flip of its predecessor to
superseded, is the human's; it changes the public interface or the engine's graph, where a wrong
turn costs more than a revert.
