# Ticket: The example shows the metric tree of G-9

## What to build

The metric-tree example describes its node types as content: bets with a hypothesis and a status
badge, epics with a progress bar and a status badge, input metrics with values over three periods
and coloured trends, the north-star metric, and KPIs, each with an icon of its kind and a
"Details" action. Its sidebar edits the selected node's fields and replaces its content; "Details"
selects the node and opens the sidebar. The palette drops nodes of each type. The multiplier still
reaches 50,000 nodes.

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
