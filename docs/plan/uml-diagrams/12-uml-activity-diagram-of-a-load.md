# Ticket: The UML example draws an activity diagram of a load

## What to build

A new activity diagram of the UML example shows a load, from `createComb` to the first frame, in
partitions for the host application, the shell, and the engine. It shows actions, call behavior
actions, send signal and accept event actions, an accept time event, object nodes with pins, a data
store and a central buffer, the veto as a decision with guards, fork and join, an interruptible
region for the loss of the engine with its interrupting edge, an exception handler, an expansion
region over the rows of content, connectors, comments, and the frame with its activity parameter
nodes. Control flows and object flows end in open arrowheads with guards and weights. The palette,
the rules of connection, and the sidebar cover each element.

Settled with the human on 2026-11-18:

- An expansion node is three small rectangular border nodes without content, side by side on the
  expansion region's outline, since one node with separators would be at least 64 high.
- A connector is an ellipse of 64 by 64 holding its letter, as ticket 11 draws a history; one
  backlog entry for a small circle with a text covers both, filed by ticket 11 or this one,
  whichever is worked first.
- The building blocks, stated as a table in the example's diagram module, which its test asserts:
  - send signal action a `pentagon`, accept event action a `notched-rectangle`, accept time event
    an `hourglass`;
  - decision and merge a `diamond`, fork and join a `bar` given a height;
  - data store and central buffer rectangles with «datastore» and «centralBuffer»;
  - the interruptible region a dashed rounded rectangle, a container;
  - the interrupting edge and the edge to the exception handler each with `lightning`;
  - the activity parameter nodes border nodes on the frame;
  - the partitions for the host application, the shell, and the engine regions `"across"` with
    name bands.
- The example's `canMoveInto` allows a move between partitions and regions and refuses one onto
  the canvas, out of the activity's frame. Its test asserts `true` and `false` by these rules; a
  `canMoveInto` that throws is ticket 03's test.
- The mode stays unattended, with its stop.

## Acceptance criteria

- [ ] Given *Example: UML* switched to the activity diagram, when it loads, then inspection reports
      each element of the description in its node shape, partition, region, or border, as the
      example's test lists them.
- [ ] Given the palette, when the user adds each element, then it appears where it was dropped, into
      the partition under the pointer where it lands in one.
- [ ] Given an action dragged into another partition, when it is released, then the example's
      `canMoveInto` allows it and one `nodeMoved` arrives with the partition; dragged out of the
      frame onto the canvas, it is refused, the action stands where it stood, and no change arrives
      (API-edits-report-nested-changes, *Enforcement*, *Nesting*).
- [ ] Given each pair of the activity diagram's refusals, when the user connects it, then the
      example refuses it; every other pair connects.
- [ ] Given a pin dragged around its action, when it is released, then the example's copy holds its
      side and offset.

## Read first

- Touches: `examples/uml/src/activity-diagram.ts`, `examples/uml/src/rules.ts`,
  `examples/uml/src/rules.test.ts`, `examples/uml/src/sidebar.ts`, `examples/uml/src/main.ts`,
  `examples/uml/src/legend.ts`, `examples/uml/e2e/activity-diagram.spec.ts`,
  `examples/uml/e2e/activity-edit.spec.ts`, `docs/CONVENTIONS.md`
- ADRs: the ten of the spec, through the public interface only; ARCH-one-workspace-per-example.
- Conventions: as ticket 11.
- Golden path: the package diagram's module and its tests.
- Seam: `examples/uml/e2e/activity-diagram.spec.ts`, `examples/uml/src/rules.test.ts`.

## Blocked by

- docs/plan/uml-diagrams/05-nodes-are-divided-into-regions.md
- docs/plan/uml-diagrams/06-border-nodes-ride-sides.md
- docs/plan/uml-diagrams/07-content-node-shapes-and-outlines.md
- docs/plan/uml-diagrams/08-symbol-node-shapes.md
- docs/plan/uml-diagrams/09-edges-carry-labels-arrowheads-and-lightning.md
- docs/plan/uml-diagrams/10-edges-end-on-edges.md

## Mode

unattended:

- A test decides each criterion: the browser and unit tests named above.
- The scope is isolated, and a wrong result costs one revert of the branch.
- It touches nothing DEV-implementer-and-fresh-reviewer keeps with the human: no ADR, no
  specification, no CODEOWNERS, no ticket but its own, and it fits under that ADR's cap.
- A wrong result shows in the browser tests and the fresh review; the revert undoes it, and
  `scripts/check-all.sh` green with the criteria's tests proves it right.
- Stop: two failed attempts at the same criterion, or a notation element no building block can draw;
  the session writes where it stands into this file and hands off.
