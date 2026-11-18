# Ticket: The UML example draws a notation diagram of the activity elements a load does not hold

## What to build

A notation activity diagram of the UML example shows the elements of G-20's activity diagram that
the load of ticket 12 does not hold, among them structured, conditional, and loop nodes, value pins,
parameter sets, and streaming parameters, built as the spec's implementation decisions say. Its test
and ticket 12's together assert that every element G-20 lists for the activity diagram appears in
one of the two diagrams. Where an element cannot be drawn with the building blocks, the session
stops and hands off for an ADR.

## Acceptance criteria

- [ ] Given *Example: UML* switched to the notation diagram, when it loads, then inspection reports
      each element it holds.
- [ ] Given G-20's list for the activity diagram, when the test of the two diagrams runs, then every
      element of the list appears in one of them.
- [ ] Given a parameter set around two pins, when the action moves, then the set and the pins
      follow.

## Read first

- Touches: `examples/uml/src/notation-diagram.ts`, `examples/uml/src/rules.ts`,
  `examples/uml/src/main.ts`, `examples/uml/e2e/notation-diagram.spec.ts`
- ADRs: the ten of the spec, through the public interface only.
- Conventions: as ticket 11.
- Golden path: ticket 12's diagram module.
- Seam: `examples/uml/e2e/notation-diagram.spec.ts`.

## Blocked by

- docs/plan/uml-diagrams/12-uml-activity-diagram-of-a-load.md

## Mode

unattended:

- A test decides each criterion: the browser and unit tests named above.
- The scope is isolated, and a wrong result costs one revert of the branch.
- It touches nothing DEV-implementer-and-fresh-reviewer keeps with the human: no ADR, no
  specification, no CODEOWNERS, no ticket but its own, and it fits under that ADR's cap.
- A wrong result shows in the browser tests and the fresh review; the revert undoes it, and
  `scripts/check-all.sh` green with the criteria's tests proves it right.
- Stop: two failed attempts at the same criterion, or an element no building block can draw; the
  session writes where it stands into this file and hands off.
