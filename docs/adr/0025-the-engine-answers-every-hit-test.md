# ADR-0025: The engine answers every hit test in one call, a connector before an edge label, a node, and an edge

- **Status:** 🟡 proposed
- **Date:** 2026-10-24
- **Deciders:** Markus Brigl
- **Applies to:** the hit test of `crates/engine/src/graph.rs` and its export in `crates/engine-wasm/`, the label extents the render layer of `packages/comb/src/render/` hands the engine, and the press and hover of `packages/comb/src/interaction/`

## Context

G-5 asks that the user selects a node or an edge, and G-6 that the user drags an edge label; G-3
starts a connection on a connector (ADR-0024). Today only nodes can be hit: the engine answers
which node is drawn on top at a point from its spatial index, at every level of detail, and node
views take no events (ADR-0027). An edge cannot be selected, though the store's selection already
has a kind for it, and nothing under the pointer tells a label from the edge or the node behind
it.

The canvas draws, from the bottom, the edges as one mesh in slot order, the nodes in the order of
their ranks (ADR-0022), the edge labels in slot order, and the connectors (ADR-0027, ADR-0024). A
user expects to grab what they see on top. An edge is a curve, drawn one pixel wide at the far level
and a few pixels wide nearer, so it can only be hit within a tolerance. An edge label is a pill
whose width follows its text, which the shell measures with its `BitmapText` font and the engine
cannot; the query receives only the widest pill's reach, one number for all labels (ADR-0010).

ADR-0026 keeps geometry out of the shell, and the engine's spatial index already holds the nodes,
the edges, and the label points.

## Decision

We will answer every hit test in the engine, from its spatial index, with one call that takes a
world point, the size of a screen pixel, and the level of detail, and returns the target drawn on
top there: a connector, else an edge label, else a node, else an edge, else none.

- **Connector:** within 8 screen pixels of its point, at the near and the middle level, the node
  and side it belongs to (ADR-0024).
- **Edge label:** at the near level only, where labels are drawn, the label whose pill holds the
  point. The shell hands the engine the half width and half height of each label's pill, in world
  units, when it draws the label's text and whenever that text changes; a label the shell has
  not measured is not hit.
- **Node:** inside its bounds, at every level, as today.
- **Edge:** within 4 screen pixels of its path as the stroke flattens it at the current zoom, at
  every level.
- **On top:** within one kind, the item drawn last: the node of the highest rank (ADR-0022), and
  the edge or label in the highest slot.
- **One call:** the result crosses as one generated structured value (ADR-0010) naming the kind
  and the slot, and for a connector its side. Interaction calls it on press and on hover, and
  draws the cursor from it.
- **What a press does:** on a connector it begins a connection; on an edge label it selects the
  label's edge and begins a drag of the label; on a node it selects the node and begins a drag of
  it; on an edge it selects the edge; on none it clears the selection and begins a pan.

**Out of scope:** hitting a content element of a node (G-10, ADR-0013); a selection of more than
one item; hitting an edge's arrowhead apart from its path.

## Alternatives considered

- **The shell hit-tests what it drew** — PixiJS's events on the bound views, or their bounds, know
  every label's pill, but node views take no events (ADR-0027) and particles have none at all;
  the order between layers would be the shell's, and the distance to a curve geometry the shell
  does not hold (ADR-0026).
- **A label hit by the widest pill's reach** — no extents cross the bridge, but beside a long
  label every short one would be hit far beyond its pill, grabbing a label where the user meant
  the empty canvas.
- **Separate calls per kind** — each simpler, but a press asks up to four times and the shell
  decides the precedence, so a change of the drawing order has two places to follow.
- **Edges hit by their bounds** — cheap, but the bounds of a curved edge cover much empty canvas,
  and the pan the user meant would select an edge.
- **A node before an edge label** — labels sit on edges between nodes and are drawn above them;
  where a label overlaps a node, the user sees the label and expects to grab it.

## Sources / Prior art

- `Graph::hit` and the query in `crates/engine/src/graph.rs`, the labels layer in
  `packages/comb/src/render/labels.ts`, and the press in `packages/comb/src/interaction/index.ts`,
  as they stand (read on 2026-10-24).
- The layer order and the hit test of ADR-0027 (*Layers*, *Hit testing*).

## Consequences

- Positive: what the user grabs is what they see on top, at every level, from one place that
  follows the drawing order.
- Positive: edges become selectable, and the sidebar of G-9 can edit them.
- Negative / trade-offs: a hover now flattens the edges near the pointer, a few for most points
  and every edge of the overflow list whose bounds hold the point; the benchmark's frames show
  whether that matters (Q-1).
- Negative / trade-offs: label extents cross the bridge once per label drawn and per change of
  its text, and the engine keeps two numbers per edge slot for them.
- Follow-ups: hitting content elements; whether the edge tolerance follows the edge's width once
  edges have widths.

## Enforcement

Each test below cites this ADR with `Verifies: ADR-0025`.

- **Against a scan:** a test of `crates/engine/src/graph.rs` hits random points of random graphs
  with labels and connectors, at each level, and asserts the target a brute-force scan finds in
  the order of the decision, the distance to an edge measured to its flattened path.
- **Precedence:** browser tests in `examples/metric-tree/e2e/` press on a label above a node, on
  a connector on a node, on a node above an edge, on an edge, and on the empty canvas, and assert
  what is selected or dragged; they also `Verifies: G-5, G-6`.
- **Unmeasured labels:** a test asserts that a label without extents is not hit, and one with
  them is hit inside its pill and not beyond it.
