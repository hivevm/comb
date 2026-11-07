# Ticket: The legend names the «import» of the package diagram

## What to build

The sidebar's legend (`examples/uml/src/legend.ts`) lists each kind of relationship once, from
`KINDS` and the `STYLES` table of `examples/uml/src/relationships.ts`, and is filled once for
every diagram; each diagram's `DiagramDescriptor` (`examples/uml/src/shared.ts`) says only whether
it shows. So it names the dependency with the label «use» alone. The
package diagram draws most of its dependencies with the label «import», which the legend does not
name, as `docs/CONVENTIONS.md` records (*The UML example tells a relationship by its kind's
family of colour*). The hand-offs of tickets 02 and 04 of docs/plan/uml-example both left it as
a doubt.

Let the legend name the dependency with either label, «import» or «use», on both diagrams or on
the package diagram's legend alone, whichever is simpler. No test caught the gap, because the
legend's test reads the seven kinds and no diagram's labels: the test this ticket adds checks the
legend against the labels the diagram shown draws.

## Acceptance criteria

- [ ] Given the package diagram, when the legend is read, then it names a dependency «import» and
      a dependency «use», as a browser test decides.
- [ ] Given the class diagram, when the legend is read, then it still names the seven kinds, as
      `examples/uml/e2e/class-diagram.spec.ts` decides.
- [ ] Given each label an edge of the diagram shown carries, when the legend is read, then the
      legend names it, as a browser test decides for both diagrams.

## Read first

- Touches: `examples/uml/src/legend.ts`, `examples/uml/src/relationships.ts`,
  `examples/uml/src/shared.ts`, `examples/uml/src/package-diagram.ts`,
  `examples/uml/src/main.ts`, `examples/uml/e2e/package-diagram.spec.ts`,
  `examples/uml/e2e/class-diagram.spec.ts`
- Conventions: *The UML example tells a relationship by its kind's family of colour*.
- Golden path: the legend test of `examples/uml/e2e/class-diagram.spec.ts`.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria: the browser tests above;
- its scope is `examples/uml/`, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a failing browser test or a legend that names a label no edge draws;
  the UML browser tests and `scripts/check-all.sh` green prove it right;
- stop: when `scripts/check-all.sh` is still red after three attempts at a fix, the session
  leaves its state here and hands off.
