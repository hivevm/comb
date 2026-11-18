# Ticket: The UML example draws a notation diagram of the activity elements a load does not hold

## What to build

A notation activity diagram of the UML example shows the elements of G-20's activity diagram that
the load of ticket 12 does not hold, among them structured, conditional, and loop nodes, value pins,
parameter sets, and streaming parameters, built as the spec's implementation decisions say. Its test
and ticket 12's together assert that every element G-20 lists for the activity diagram appears in
one of the two diagrams. Where an element cannot be drawn with the building blocks, the session
stops and hands off for an ADR.

Settled with the human on 2026-11-18:

- The building blocks, stated as a table in the example's diagram module, as tickets 12 and 13
  do:
  - a structured activity node a dashed rounded rectangle with «structured», a container;
  - a conditional node and a loop node the same with «conditional» and «loop», divided `"down"`
    into named regions, the clauses or setup, test, and body, their names in the turned band at
    the left;
  - an initial node a `circle`, an activity final a `ringed-circle`, a flow final a
    `crossed-circle`, a merge a `diamond`;
  - nested partitions regions within regions;
  - a value pin's value and `{stream}` border nodes with an outline of `"none"` beside the pin, as
    the spec says.
- A parameter set is a dashed border node around its pins, as the spec says. Its white fill hides
  the action's outline where it lies; that is accepted, the set is added before its pins so that
  they are drawn above it, and a node without a fill goes to the backlog.
- G-20's list for the activity diagram is a constant in the example's test, one entry per element;
  the test asserts that each appears at least once in ticket 12's or this diagram, told by the kind
  the example gives each node and edge.
- The mode stays unattended; with the parameter set settled, its stop no longer applies to it.

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
