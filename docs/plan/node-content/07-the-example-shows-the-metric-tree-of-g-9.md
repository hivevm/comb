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

Stopped before any code: two existing browser tests besides the approved one pin the example's
nodes to the least height of 64, and G-9's content for an input metric cannot be laid out that
low. The engine lays a node out to its rows and 10 above and below them, at least 64
(`crates/engine/src/content.rs`), so its rows may hold at most 44: a title's line is 18 and a
metric's two lines 30, so an input metric with its title in a row of its own and its three
periods below is at least 10 + 18 + 30 + 10 = 68 high. The library behaves as its tickets said;
the conflict is with the example's tests.

1. **`e2e/drag.spec.ts`, "dragging a node moves it with its edges and edge labels, and a click
   shows it in the sidebar"** drags the north-star metric `0:3.0` and expects the edge from the
   input metric `0:2.3` to end at `after.y + NODE_HEIGHT / 2`, and its label at
   `(source.y + after.y + NODE_HEIGHT) / 2`, both to 0.05. That holds only where both nodes are 64
   high; an input metric of 68 moves the label by 1.
   - a. Read the heights the canvas draws: the end at `after.y + after.height / 2`, the label at
     the midpoint of `source.y + source.height / 2` and `after.y + after.height / 2`. What it
     verifies stays: the edge ends at the moved node's left connector, the label sits midway
     between the connectors.
   - b. Keep the test and squeeze the input metric into one row, icon, title, three metrics, and
     "Details" side by side in 196: each column about 20 wide, the title and every trend cut to
     nothing.
   - Recommendation: a.
2. **`e2e/palette.spec.ts`, "a kind dragged from the palette and dropped on the canvas becomes a
   node under the drop"** drops an epic and expects its top at `centre.y - NODE_HEIGHT / 2`. An
   epic of G-9, a title, a progress bar, and a status badge, is at least 10 + 18 + 16 + 22 + 10 =
   76 high.
   - a. Read the dropped node's drawn height there too (`centre.y - node.height / 2`), and centre
     each dropped node by the height of its type.
   - b. Keep the test, and offset every drop by half the least height, so that a taller node
     hangs below the drop rather than being centred on it.
   - Recommendation: a.
3. **`e2e/edge-styles.spec.ts`** compares the default tree's edges with a reference image. Not
   open: the example keeps every node's middle where it is today, its top half its height above
   its row's middle, so that the edges, which enter and leave at the middle of a side, and the
   reference image stay as they are; the image then also proves the middles kept.

The rest is ready to build once 1 and 2 are answered: the content per type in
`examples/metric-tree/src/graph.ts`, the icon in the title's row (icon weight 1, title weight 9,
as `content-click.spec.ts` lays one out) rather than a row of its own, the sidebar's form per
type in `index.html` and `main.ts`, "Details" through `onContentClick`, the palette dropping each
type's content, and the golden-path test in `example.spec.ts` covering every type through
inspection; the one-title test of `node-content.spec.ts` moves to a node of one title loaded
through `loaded`, which the human approved.
