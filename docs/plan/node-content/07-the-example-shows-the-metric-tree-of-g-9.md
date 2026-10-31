# Ticket: The example shows the metric tree of G-9

## What to build

The metric-tree example describes its node types as content: bets with a hypothesis and a status
badge, epics with a progress bar and a status badge, input metrics with values over three periods
and coloured trends, the north-star metric, and KPIs, each with an icon of its kind and a
"Details" action. Its sidebar edits the selected node's fields and replaces its content; "Details"
selects the node and opens the sidebar. The palette drops nodes of each type. The multiplier still
reaches 50,000 nodes.

Until this ticket, each node of the example shows its title and, in a row of its own below it,
the icon of its kind, so that the policy test of Q-6 draws icons; this ticket revisits that row,
and with it the browser test "a node of one title shows one text view where its title was drawn",
which pins the example's first node to one title.

## Acceptance criteria

- [ ] Given the example, when it opens, then each node type shows the elements G-9 names, as
      inspection reports them.
- [ ] Given a bet selected, when its status is changed in the sidebar, then its badge shows the new
      status.
- [ ] Given a click on "Details", then the sidebar opens on that node.
- [ ] Given `?copies=3334`, when the example opens, then it holds 50,010 nodes with their content.
- [ ] Given the golden-path browser test of the example, then it covers the node types
      (`Verifies: G-9`, `Verifies: G-10`).

## Read first

- G-9 in `docs/SPECIFICATION.md`; the example's graph and sidebar; `e2e/shared.ts` and the
  example's golden-path spec.

## Blocked by

- docs/plan/node-content/03-a-badge-shows-a-status.md
- docs/plan/node-content/04-a-progress-bar-shows-how-far-it-has-come.md
- docs/plan/node-content/05-a-value-shows-its-trend.md
- docs/plan/node-content/06-an-icon-the-host-registered.md

## Mode

unattended: a test decides each criterion (the browser tests through inspection); the scope is
the example alone, `examples/metric-tree/`, so a wrong result costs one revert; it touches no
protected part of ADR-0007 and runs under its cap; a wrong result shows as a red browser test or
in the maintainer's look at the example before merge, and the golden-path test proves it right.
Stop: when an element the example needs is missing from the library or behaves other than its
ticket said, or after three failed attempts at one criterion, write what was found here and hand
off.

## Where it stands

The human approved the first stop's options 1a (`drag.spec.ts` reads the drawn heights) and 2a
(`palette.spec.ts` centres a dropped node by its drawn height), and keeping each node's middle so
that the reference image of `edge-styles.spec.ts` stands. The example is built, uncommitted in the
ticket's worktree: content per type in `src/graph.ts` (`contentOf`, `HEIGHTS`, `metricTree`
returning the graph and each node's fields), the sidebar per type in `index.html` and
`src/main.ts`, "Details" through `onContentClick`, the palette dropping each type; the golden-path
tests in `e2e/example.spec.ts` and a palette test per type pass, as do the approved adaptations and
the one-title test moved to a loaded node. The chromium suite runs 297 green and 2 red: two more
existing tests depend on the least height or on one text per node, and the session stops on them.

1. **`e2e/drag.spec.ts`, "a node dragged across frames stays under the pointer, its edges' ends at
   its connectors in the same frame"** presses the north-star metric at `screenCentre`, which
   `e2e/shared.ts` computes as `node.y + NODE_HEIGHT / 2`, and expects the drawn centre,
   `node.y + node.height / 2`, within 1 pixel of the pointer; with the north star 84 high the press
   lies 10 world units, 6.5 pixels, above the centre.
   - a. `screenCentre` in `shared.ts` reads the drawn node's height, as its comment already says
     ("the screen point at the centre of a drawn node"); no assertion changes, and every caller
     that presses a node of one title presses the same point as before.
   - b. Change the assertion to compare with the pressed point's offset.
   - Recommendation: a.
2. **`e2e/levels-of-detail.spec.ts`, "zooming through each threshold switches the level of
   detail"**, line 22, expects at the near level `texts` to be `nodes + labels`, one text per node;
   every node of the example now draws 4 to 12 texts (107 against 22). The middle level's
   `texts == nodes` holds, since middle draws the titles alone.
   - a. Compare with the texts the drawn nodes draw: `texts` equal to the sum of each node's
     `texts.length` and the labels. What it verifies stays: at near every text of the nodes and
     every label is bound.
   - b. Load a graph of one-title nodes there, which stops the test from covering the example's
     tree.
   - Recommendation: a.
