# Ticket: The query places at the middle level only what the middle level draws

## What to build

ADR-0013 has the middle level draw a node's box and its texts of role title alone, at the place
the near level gives them. The rule is kept twice, in two languages:

- the engine's hit test applies it (`crates/engine-wasm/src/lib.rs:885`, `element_at` with
  `level == DetailLevel::Middle`), but the query lays out, draws into the buffers, and hands over
  every element of every found node at the middle level as at the near level
  (`lay_out_found`, lines 929–955, which leaves out only far);
- the shell applies it again, `titlesOnly` in `textsOf`, `barsOf`, `arrowsOf`, and `iconsOf` of
  `packages/comb/src/render/nodes.ts` (lines 183–317), handed down from
  `packages/comb/src/render/scene.ts` through `NodesContainer.sync` and `NodeGraphic.bind`, whose
  parameters grew to eight.

What is hit and what is drawn agree only because the browser tests check both, and at the middle
level, where the most node views are bound, the engine lays out and hands over elements no frame
draws.

The engine decides once which elements a level shows, and the query hands over at the middle level
the title texts alone, where the near level places them; the hit test asks the same rule; the
render layer draws what the query placed and loses `titlesOnly`.

## Acceptance criteria

- [ ] Given a node of several kinds of element, when the query runs at the middle level, then
      the placed elements it hands over are the texts of role title alone, at the rectangles the
      near level gives them, tested in `crates/engine-wasm`.
- [ ] Given `packages/comb/src/render/nodes.ts`, when it draws a node view, then it takes no flag
      of the level, and the levels-of-detail and node-content browser tests pass unchanged.
- [ ] Given the hit test at the middle level, when a press lands on a badge, then it hits no
      element, as now, and the rule it asks is the query's.
- [ ] Broken once: with the middle level handing over every element, the new engine test fails.

## Read first

- ADR-0013 (*Levels of detail*, *Clicks*), ADR-0027, ADR-0034; `crates/engine-wasm/src/lib.rs`
  (`lay_out_found`, `hit`), `crates/engine-wasm/src/graph_data/content.rs` (`lay_out`, `draw`,
  `element_at`), `packages/comb/src/render/nodes.ts`, `packages/comb/src/render/scene.ts`.

## Blocked by

- docs/plan/revision-2026-10-31/03-the-bridge-crate-keeps-node-content-in-one-store.md

## Mode

with the human: `crates/engine-wasm/` and the query's views in `packages/comb/src/bridge/` are
protected parts of ADR-0007.
