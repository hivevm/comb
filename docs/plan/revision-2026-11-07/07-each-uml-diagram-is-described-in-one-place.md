# Ticket: Each UML diagram is described in one place, and the kinds of node in one module

## What to build

What makes a diagram of the UML example what it is lies in four files. The kind a connection adds
and whether the legend shows stand in `DIAGRAMS` in `examples/uml/src/main.ts`; the generic
`Diagram.added` in `examples/uml/src/diagram.ts` branches on `kind === "transition"` to dock an
edge, and `Diagram.connected` starts as an association; `examples/uml/src/sidebar.ts` tells a
dependency's form from its source's kind, a package's fields and a named state by their node kind;
and the diagram identifiers, and the kinds of node the palette drops, stand again in
`examples/uml/index.html`. The kinds of node, `CLASSIFIER_KINDS`, `STATE_KINDS`, and `NODE_KINDS`,
live in `examples/uml/src/rules.ts`, a module about the rules of connection, and
`examples/uml/src/shared.ts`, which defines the classifier and the state, imports them from there.
Smell: one concept spread over several files, which the third diagram widened.

Give each diagram one descriptor, its kinds of node, the kind a connection adds, how that kind
docks, its edge form, and its legend, which `Diagram` and `Sidebar` read instead of branching on a
kind; and move the kinds of node into the module that defines the nodes, `shared.ts`, which
`rules.ts` imports.
This carries what still holds of the withdrawn ticket revision-2026-11-06/02, whose premise, that
the rules refuse nothing, no longer holds: moving `NODE_KINDS` out of `rules.ts`.

## Acceptance criteria

- [ ] Given `examples/uml/src/diagram.ts` and `examples/uml/src/sidebar.ts`, when they are read,
      then neither names a kind of relationship or of node of one diagram.
- [ ] Given `examples/uml/src/rules.ts`, when it is read, then it defines no kind of node and
      imports them.
- [ ] Given the three diagrams, when the UML browser tests run, then they pass with their
      assertions unchanged.

## Read first

- Touches: `examples/uml/src/main.ts`, `examples/uml/src/diagram.ts`, `examples/uml/src/sidebar.ts`,
  `examples/uml/src/rules.ts`, `examples/uml/src/state-diagram.ts`,
  `examples/uml/src/class-diagram.ts`, `examples/uml/src/package-diagram.ts`,
  `examples/uml/src/shared.ts`, `examples/uml/src/modules.test.ts`,
  `examples/uml/src/rules.test.ts`, `examples/uml/src/class-diagram.test.ts`,
  `examples/uml/index.html`
- The outcome of ticket revision-2026-11-06/03 (merge 93005af), which gives the shared parts their
  module, `examples/uml/src/shared.ts`.
- The UML example's entry of `docs/ARCHITECTURE.md`.

## Blocked by

- docs/plan/revision-2026-11-06/03-a-uml-node-keeps-its-kind-and-the-diagrams-share-one-module.md

## Mode

unattended:
- a test decides its criteria: the UML browser tests, unchanged, the unit tests, and the build;
- its scope is `examples/uml/`, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a failing browser test, or a diagram that docks, labels, or shows its
  legend otherwise; `scripts/check-all.sh` green proves it right;
- stop: when a browser test's assertion has to change, or `scripts/check-all.sh` is still red
  after three attempts at a fix, the session leaves its state here and hands off.
