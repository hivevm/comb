# Ticket: The state diagram's convention keeps only what the code does not show

## What to build

The convention *The UML example draws a state diagram in UML's node shapes* in
`docs/CONVENTIONS.md`, written by tickets 01 to 04 of the state diagram, restates
`examples/uml/src/state-diagram.ts`: the sizes of the pseudostates (24, 28, 128), a state's width
of 200, the name NewState, the label's offset of 14, and the grey `#6b7280`.
`examples/uml/e2e/state-diagram.spec.ts` and `examples/uml/e2e/state-edit.spec.ts` decide each of
them. During the work in scope the entry prevented nothing: every ticket wrote it after the code
it describes, and no review cited it. `docs/CONVENTIONS.md` says what the golden path already shows
needs no entry, and the design revision drops what prevented nothing
([`AGENTS.md` §5](../../../AGENTS.md#5-quality-bar--definition-of-done)). No ADR or criterion
cites it.

Cut the entry to the judgement calls the code does not explain: that each kind of state takes the
node shape UML gives it, that a pseudostate is as small as its node shape allows, and that a
transition the user connects docks on the outline and a loop on the side the connection left by,
with the reason. The numbers go.

## Acceptance criteria

- [ ] Given `docs/CONVENTIONS.md`, when the entry is read, then it names no size, colour, or
      offset that `examples/uml/src/state-diagram.ts` holds, and keeps the docking rule with its
      reason.
- [ ] Given the UML browser tests, when they run, then they pass unchanged.

## Read first

- Touches: `docs/CONVENTIONS.md`
- The preamble of `docs/CONVENTIONS.md`; `examples/uml/src/state-diagram.ts`.
- The merge message of 1187802, *Decisions the ticket left open*.

## Blocked by

- None (can start immediately)

## Mode

unattended:
- a test decides its criteria: `scripts/check-docs.sh`, and the UML browser tests, unchanged;
- its scope is one entry of one document, and a wrong result costs one revert;
- it touches no protected part of ADR-0007 and fits under its cap of two;
- a wrong result shows as a reason lost that the code does not state, which the review of the
  diff sees; `scripts/check-docs.sh` green and that review prove it right;
- stop: when the session finds a reader of the entry, an ADR, a test, or a ticket that relies on
  a number it would drop, it leaves its state here and hands off.
