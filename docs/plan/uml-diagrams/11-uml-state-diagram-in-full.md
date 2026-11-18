# Ticket: The UML example draws its state diagram in the full notation

## What to build

The UML example's state diagram of a Comb's life shows, in the notation of UML 2.5.1:
- states with their entry, do, and exit behaviours, internal transitions, and deferred triggers
  below a separator;
- composite states with orthogonal regions, and submachine states;
- initial, terminate, choice, junction, fork, and join pseudostates, and final states;
- shallow and deep history, and entry and exit points as border nodes;
- connection point references, and state lists;
- transitions with trigger, guard, and effect, and the send and receive signal symbols of a
  transition;
- comments anchored on states and on transitions;
- the frame of the state machine.

The palette adds each of these. A connection adds a transition, which `examples/uml/src/rules.ts`
refuses where UML 2.5.1 does not let it connect, written into its table of refusals. The sidebar
edits each property the notation shows.

Settled with the human on 2026-11-18:

- The rules of connection stay a table of refusals; G-20 now says so (the commit "docs(spec): G-20's
  rules of connection are a table of the pairs the example refuses", which the human lands).
- Shallow and deep history are ellipses of 64 by 64 holding `H` and `H*`, since a node with content
  is at least 64 high; a smaller circle with a text goes to the backlog, for it needs a revision of
  REN-node-content-and-hits.
- The name of an entry point, an exit point, or a connection point reference is a further border
  node with an outline of `"none"`, attached to the composite or submachine state on the same side
  beside the point, as the spec places a pin's name; ticket 06 refuses a border node on a border
  node.
- A comment is a `note`. Its anchor is a dashed edge without an arrowhead, ending on a state or, by
  `targetEdge` at `targetT` 0.5, on a transition.
- The send and receive signal symbols are nodes of their own, a `pentagon` and a
  `notched-rectangle`, in the transition's chain: the transition is two edges through the symbol,
  its trigger and guard on the first. The sidebar edits the symbol's signal name.
- The mode stays unattended, with its stop.

## Acceptance criteria

- [ ] Given *Example: UML* on its state diagram, when it loads, then inspection reports each
      notation element of G-20's state diagram in its node shape, its container, its region, or its
      border, as the example's test lists them.
- [ ] Given the palette, when the user adds each element of the list, then it appears where it was
      dropped, a pseudostate as small as its node shape allows.
- [ ] Given each pair of the table of refusals, when the user connects it, then the example refuses
      it and the sidebar says why; every other pair connects.
- [ ] Given a transition selected, when the user edits its trigger, guard, and effect in the
      sidebar, then its label shows them.

## Read first

- Touches: `examples/uml/src/state-diagram.ts`, `examples/uml/src/rules.ts`,
  `examples/uml/src/rules.test.ts`, `examples/uml/src/sidebar.ts`, `examples/uml/src/diagram.ts`,
  `examples/uml/src/element.ts`, `examples/uml/src/legend.ts`,
  `examples/uml/e2e/state-diagram.spec.ts`, `examples/uml/e2e/state-edit.spec.ts`,
  `docs/CONVENTIONS.md`
- ADRs: the ten of the spec, through the public interface only; ARCH-one-workspace-per-example.
- Conventions: *The UML example draws a state diagram in UML's node shapes*, *The UML example's
  rules of connection are a table of what they refuse*, *A host application's copy follows what Comb
  took*.
- Golden path: today's state diagram and `examples/uml/e2e/state-edit.spec.ts`.
- Seam: `examples/uml/e2e/state-diagram.spec.ts`, `examples/uml/src/rules.test.ts`.

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
