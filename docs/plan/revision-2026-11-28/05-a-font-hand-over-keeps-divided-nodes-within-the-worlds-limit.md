# Ticket: A font hand-over keeps divided nodes within the world's limit

## What to build

ARCH-one-workspace-per-example (*World*) decides that the core keeps the graph within the world's
limit. A font handed over after a load lays every node out anew: `lay_out_heights` in
`crates/engine-wasm/src/lib.rs` hands each node its content through the engine's `set_content` in
`crates/engine/src/graph/resize.rs`, whose `arrange` in `crates/engine/src/graph/regions.rs` lays
a divided node's regions out again below the new top. Nothing checks the box that gives: a font
whose text runs taller grows a divided node near the limit past it. `setFont` refuses only metrics
that are malformed today, never by the boxes they give.

The human decided on 2026-11-28: a font hand-over, like any edit, that would push a node past the
world's limit is refused, never cut. The rest of Comb refuses what lies beyond `WORLD_LIMIT`, a
refused edit changes nothing, and a cut would change the host's data without telling it.

Evidence: the review of ticket 07 of revision-2026-11-20 (PR #109, five rounds of review) found
it; the backlog entry `a-content-patch-of-a-divided-node-is-not-held-to-the-world.md` recorded it
beside the content patch, and ticket 01 of this revision, made from that entry, takes the patch.

Let the font hand-over ask the engine's check that ticket 01 writes before anything changes, and
refuse the font where a node would pass the limit, naming that node, with the fonts and every node
left as they were. The trace the convention *A refusal added at the bridge is traced to the shell's
callers* asks finds one caller, `createComb` in `packages/comb/src/api/index.ts`, which hands each
font over before any graph exists, as the doc of `set_font` in `crates/engine-wasm/src/lib.rs` says
("before the first load"). On an empty graph no font can push a node past the limit, so the shell
never meets the refusal; the tests reach it through the WebAssembly export, in the engine's and the
bridge crate's tests.

## Acceptance criteria

- [ ] Given a loaded graph whose divided nodes lie near the limit, when a font is handed over that
      grows their content past the limit, then the hand-over is refused, naming a node it would
      push past, and the fonts, every node's box, and its regions are unchanged.
- [ ] Given the same hand-over on a graph far within the limit, when it runs, then every node is
      laid out as before, and the browser tests of `examples/metric-tree/e2e/` pass unchanged.

## Read first

- Touches: `crates/engine-wasm/src/lib.rs`, `crates/engine/src/graph/resize.rs`,
  `crates/engine/src/graph/regions.rs`, `packages/comb/src/bridge/index.ts`
- ARCH-one-workspace-per-example (*World*), ARCH-regions-are-container-slots (*Division*),
  REN-node-content-and-hits, Q-7.
- Conventions: *A refusal added at the bridge is traced to the shell's callers*.
- The seam: the tests of `set_font` and `lay_out_heights` in the bridge crate, and the regions
  tests of `crates/engine/src/graph/`.

## Blocked by

- docs/plan/revision-2026-11-28/01-the-worlds-limit-is-checked-after-the-regions-are-laid-out.md

## Mode

with the human: it touches the bridge crate, the engine's graph, and the bridge, protected parts
the maintainer reviews.
