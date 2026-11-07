# Ticket: The shaped graph's filled nodes fit their rows, and the benchmark presses any node

## What to build

`shaped` in `examples/metric-tree/src/graph.ts` keeps each node's width and place from the metric
tree, as ADR-0033 asks ("the same nodes in the same places"). A circle and a ringed circle are as
high as wide, 220, in rows spaced for nodes about 76 high, so they overlap the bars and the nodes
beside them. That overlap is why `bench/run.ts` picks the drag's node by
`nodeNearCentre(page, true)`, the nearest node whose centre a press hits as the node: after ticket
07 of the state diagram (merge 25eb7f9) a bar's own connectors no longer cover its centre, but the
bottom connector of the circle above it still does. A benchmark whose graph overlaps its own nodes
measures a layout no host application would draw, and its press needs a filter for it.

Give the filled node shapes of the shaped graph a size that fits the metric tree's row, such as a
circle as wide as the row is high, centred where the rectangle was, so that no two nodes of the
shaped graph overlap; then drop the `pressed` flag of `nodeNearCentre` in `bench/run.ts`. This
changes what ADR-0033 calls the same nodes in the same places, so its text is revised first, in a
commit of ADRs only, while it is still proposed.

## Acceptance criteria

- [ ] Given the shaped graph at 50,010 nodes, when its nodes' rectangles are compared, then no two
      overlap, as `examples/metric-tree/e2e/shaped-graph.spec.ts` decides with a count of misfits.
- [ ] Given `bench/run.ts`, when its drag picks a node, then it takes the node nearest the centre
      without a filter, and a run of each graph in the Dev Container passes every gesture's
      effect check.
- [ ] Given ADR-0033, when it is read, then it says how the shaped graph's filled nodes are sized
      and placed, revised by the maintainer before the implementation.

## Read first

- Touches: `examples/metric-tree/src/graph.ts`, `bench/run.ts`,
  `examples/metric-tree/e2e/shaped-graph.spec.ts`,
  `docs/adr/0033-the-benchmark-measures-a-graph-by-name.md`
- The merge messages of 9e8f882 and 25eb7f9, *Doubts* (the drag's node choice).
- The conventions *A timed gesture begins from the same view on every runner* and *A number says
  where it was taken*.

## Blocked by

- None (can start immediately)

## Mode

with the human: it revises ADR-0033, whose text is the maintainer's to review before anything is
implemented against it, and it changes the graph every shaped baseline is taken of, so it lands
before ticket 02 of this directory records any.
