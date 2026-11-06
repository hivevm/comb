# Ticket: The UML example drops the rules of connection that refuse nothing

## What to build

`examples/uml/src/rules.ts` answers `allows` from a set of refused combinations that is empty,
and its test, `examples/uml/src/rules.test.ts`, runs 113 cases that each assert "allowed". The
connection's veto in `examples/uml/src/main.ts` (`canConnect`) and `Diagram.allows` in
`examples/uml/src/diagram.ts` ask it, while `Diagram.rekind` asks nothing and says why in a
comment. It is an abstraction with no present need
([`AGENTS.md` §1](../../../AGENTS.md#1-principles), *Simplicity*): a module with no behaviour
behind its surface.

Once G-12 asks for no refusal (ticket 01), remove the rules: `allows`, `Proposed`, the refused
set, `Diagram.allows`, the veto's call of it, and `examples/uml/src/rules.test.ts`. `canConnect`
keeps naming each connection. `NODE_KINDS` and `NodeKind`, which the palette's drop and
`kindOf` use, move to the module that defines the kinds of node. Remove the convention *The UML
example's rules of connection are a table of what they refuse* from `docs/CONVENTIONS.md`, and
the rules from the UML example's entry of `docs/ARCHITECTURE.md`. The later spec that brings a
diagram with a real refusal adds a rule then, as its own decision.

## Acceptance criteria

- [ ] Given the UML example, when it is built, then no module answers whether a relationship is
      allowed, and `examples/uml/src/rules.ts` and `examples/uml/src/rules.test.ts` are gone.
- [ ] Given the class diagram, when the user connects two classifiers, then an association is
      added, and on the package diagram a dependency «use», as `examples/uml/e2e/edit.spec.ts`
      and `examples/uml/e2e/package-edit.spec.ts` decide unchanged.
- [ ] Given `docs/CONVENTIONS.md` and `docs/ARCHITECTURE.md`, when they are read, then neither
      names the rules of connection.

## Read first

- Touches: `examples/uml/src/rules.ts`, `examples/uml/src/rules.test.ts`,
  `examples/uml/src/main.ts`, `examples/uml/src/diagram.ts`, `examples/uml/src/class-diagram.ts`,
  `docs/CONVENTIONS.md`, `docs/ARCHITECTURE.md`
- The outcome of docs/plan/revision-2026-11-06/01-g-12-asks-for-no-refusal-that-cannot-arise.md.
- The UML example's entry of `docs/ARCHITECTURE.md` (*Building blocks*).

## Blocked by

- docs/plan/revision-2026-11-06/01-g-12-asks-for-no-refusal-that-cannot-arise.md

## Mode

unattended, once ticket 01 has decided that G-12 asks for no refusal; if it keeps one, ticket 01
rewrites this ticket first:
- a test decides its criteria: the UML browser tests, unchanged, and the build;
- its scope is `examples/uml/` and two documents, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a failing browser test, or a connection refused or not named; the
  browser tests and `scripts/check-all.sh` green prove it right;
- stop: when `scripts/check-all.sh` is still red after three attempts at a fix, or a browser test
  has to change, the session leaves its state here and hands off.
