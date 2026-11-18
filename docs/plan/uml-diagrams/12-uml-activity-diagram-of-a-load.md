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

## Acceptance criteria

- [ ] Given *Example: UML* switched to the activity diagram, when it loads, then inspection reports
      each element of the description in its node shape, partition, region, or border, as the
      example's test lists them.
- [ ] Given the palette, when the user adds each element, then it appears where it was dropped, into
      the partition under the pointer where it lands in one.
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
