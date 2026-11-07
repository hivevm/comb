# Ticket: A UML node keeps its kind, and what both diagrams share stands in one module

## What to build

Three findings of the design revision in `examples/uml/src/`, which touch the same files:

- **The kind is read from free text.** `kindOf` in `examples/uml/src/class-diagram.ts` tells a
  node's kind from its stereotype, and the sidebar edits the stereotype as free text. A class
  whose stereotype the user types as «package» becomes a package: after it is selected again,
  `Sidebar.fillNode` in `examples/uml/src/sidebar.ts` hides its stereotype, attributes, and
  operations, and the sidebar can no longer turn it back. A package is also stored as a
  `Classifier` with empty members, which the glossary's *Classifier* (a class, an interface, or
  an abstract class) does not cover.
- **The shared parts stand in one diagram's file.** `laidOut`, `contentOf`, `DiagramData`,
  `Classifier`, `kindOf`, `newClassifier`, and `NODE_WIDTH` live in
  `examples/uml/src/class-diagram.ts`, and `examples/uml/src/package-diagram.ts` imports them
  from there. `element()` is written twice, in `examples/uml/src/main.ts` and
  `examples/uml/src/sidebar.ts`.
- **The copy runs ahead of Comb.** `Diagram.rekind` in `examples/uml/src/diagram.ts` sets the
  kind before `updateEdge`. The convention *A host application's copy follows what Comb took*
  asks the reverse. (The palette's drop, which stored the classifier before `addNode`, follows
  Comb since 3cc0c4e.)

Since the ticket was cut, the state diagram (`examples/uml/src/state-diagram.ts`) joined the two:
its nodes keep their kind in their `State` already, but it imports `DiagramData` from
`examples/uml/src/class-diagram.ts`, and `class-diagram.ts` imports its `State` back, so it takes
what is shared from the new module too.

Give each node a kind of its own, set when it is created (from the diagram's data or the
palette) and never changed by its stereotype's text; the stereotype stays text the node shows.
Move what both diagrams share into a module of its own, which neither diagram's file imports
the other for, and write `element()` once. Store a relationship's kind only after Comb took the
change.

## Acceptance criteria

- [ ] Given a class selected on the class diagram, when the user types «package» as its
      stereotype and selects it again, then the sidebar still shows its stereotype, attributes,
      and operations, and the node is still a class.
- [ ] Given `examples/uml/src/package-diagram.ts`, when it is read, then it imports nothing from
      `examples/uml/src/class-diagram.ts`.
- [ ] Given a change of a relationship's kind Comb refuses, when it ends, then the example's copy
      keeps the old kind, as a test that makes `updateEdge` throw decides.
- [ ] Given the UML browser tests and `bun test`, when they run, then they pass, each test the
      change alters with a reason.

## Read first

- Touches: `examples/uml/src/class-diagram.ts`, `examples/uml/src/package-diagram.ts`,
  `examples/uml/src/state-diagram.ts`, `examples/uml/src/sidebar.ts`, `examples/uml/src/main.ts`,
  `examples/uml/src/diagram.ts`, the new shared module under `examples/uml/src/`,
  `examples/uml/e2e/`, `docs/ARCHITECTURE.md`, `docs/GLOSSARY.md`
- Glossary: *Classifier*, *Stereotype*, *Relationship kind*.
- Conventions: *A host application's copy follows what Comb took*.
- Golden path: `examples/uml/e2e/edit.spec.ts`, its refused-edit test.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria: the browser tests above and `bun test`;
- its scope is `examples/uml/` and the overview's and glossary's entries, and a wrong result
  costs one revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a failing browser test or a node whose sidebar fields are wrong; the
  UML browser tests and `scripts/check-all.sh` green prove it right;
- stop: when `scripts/check-all.sh` is still red after three attempts at a fix, or the kind
  cannot be kept without a change to Comb, the session leaves its state here and hands off.
