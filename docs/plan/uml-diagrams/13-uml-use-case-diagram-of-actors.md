# Ticket: The UML example draws a use case diagram of Comb's actors

## What to build

A new use case diagram of the UML example shows the developer, the user, and the host application as
actors, and the use cases of G-1 to G-17 inside the subject Comb. Use cases carry extension points
below a separator. Associations carry multiplicities at both ends. Include and extend relationships
are dashed with open arrowheads and their keywords, and an extend's condition is a comment anchored
on it. Generalizations between actors and between use cases end in hollow triangles. The palette,
the rules of connection, and the sidebar cover each element.

## Acceptance criteria

- [ ] Given *Example: UML* switched to the use case diagram, when it loads, then inspection reports
      each element of the description, the use cases in the subject, the condition anchored on its
      extend, and the hollow triangles of the generalizations.
- [ ] Given the palette, when the user adds an actor and a use case into the subject, then they
      appear there, the actor's name below its drawing.
- [ ] Given each pair of the use case diagram's refusals, when the user connects it, then the
      example refuses it; every other pair connects.
- [ ] Given a use case at an end of an extend moved, when it is released, then the condition stays
      anchored on the extend.

## Read first

- Touches: `examples/uml/src/use-case-diagram.ts`, `examples/uml/src/rules.ts`,
  `examples/uml/src/rules.test.ts`, `examples/uml/src/sidebar.ts`, `examples/uml/src/main.ts`,
  `examples/uml/src/legend.ts`, `examples/uml/e2e/use-case-diagram.spec.ts`, `docs/CONVENTIONS.md`
- ADRs: the ten of the spec, through the public interface only.
- Conventions: as ticket 11.
- Golden path: ticket 12's diagram module.
- Seam: `examples/uml/e2e/use-case-diagram.spec.ts`, `examples/uml/src/rules.test.ts`.

## Blocked by

- docs/plan/uml-diagrams/07-content-node-shapes-and-outlines.md
- docs/plan/uml-diagrams/08-symbol-node-shapes.md
- docs/plan/uml-diagrams/09-edges-carry-labels-arrowheads-and-lightning.md
- docs/plan/uml-diagrams/10-edges-end-on-edges.md
- docs/plan/uml-diagrams/12-uml-activity-diagram-of-a-load.md

## Mode

unattended:

- A test decides each criterion: the browser and unit tests named above.
- The scope is isolated, and a wrong result costs one revert of the branch.
- It touches nothing DEV-implementer-and-fresh-reviewer keeps with the human: no ADR, no
  specification, no CODEOWNERS, no ticket but its own, and it fits under that ADR's cap.
- A wrong result shows in the browser tests and the fresh review; the revert undoes it, and
  `scripts/check-all.sh` green with the criteria's tests proves it right.
- Stop: two failed attempts at the same criterion; the session writes where it stands into this file
  and hands off.
