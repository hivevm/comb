# Ticket: The UML example's notation entries of the conventions are weighed

## What to build

Over uml-diagrams, `docs/CONVENTIONS.md` grew by 184 lines and lost 25, nearly all of them in the
entries of the UML example:

- *The UML example tells a relationship by its kind's family of colour* gained the transitions,
  flows, anchors, and relationships of the state, activity, and use case diagrams;
- *The UML example draws a state diagram in UML's node shapes* gained the node shape of each kind;
- *The UML example draws an activity diagram in the building blocks settled for it* and *The UML
  example draws a use case diagram in the building blocks settled for it* are new, about 70 lines
  together;
- *The UML example's rules of connection are a table of what they refuse* gained each refusal of
  three diagrams, with its reason.

Most of these lines say what the example draws and what its palette and sidebar do: they restate
`ACTIVITY_SHAPES`, `USE_CASE_SHAPES`, `examples/uml/src/rules.ts`, and the browser tests of
`examples/uml/e2e/`, which decide the same. A convention is a judgement call of how code and tests
are written (NUC-documents-are-fixed §6), and the design revision drops what prevented nothing.
This revision found no commit, review, or rework of uml-diagrams that one of the added lines
prevented; the reviews checked the code against the tickets' *Settled with the human*.

G-20 cites the table of the pairs the example refuses as one the example states and its tests hold,
so the entry of the rules of connection stays in some form.

Read each entry with the maintainer. Keep in `docs/CONVENTIONS.md` what tells a later diagram how to
be written, such as that a diagram's refusals join the table with their reason. Move what describes
the example's notation where it is believed and checked, such as the example's own documentation or
the tests, or drop it where the code and tests say it already.

## Acceptance criteria

- [ ] Given each of the five entries, when the maintainer has read it, then it is kept, shortened,
      moved, or dropped, and the hand-off says which and why.
- [ ] Given G-20's table of refusals, when the result is read, then the example still states the
      table, and `examples/uml/src/rules.test.ts` holds it.
- [ ] Given `docs/CONVENTIONS.md`, when `git diff --stat` is read, then the hand-off names the lines
      it gained and lost.

## Read first

- Touches: `docs/CONVENTIONS.md`, `docs/ARCHITECTURE.md`
- NUC-documents-are-fixed §6, NUC-design-is-revised; G-20 in `docs/SPECIFICATION.md`.
- docs/plan/revision-2026-11-18/05-conventions-that-prevented-nothing-are-weighed.md, which weighs
  five other entries the same way.

## Blocked by

- None (can start immediately)

## Mode

with the human: what stays a convention is the maintainer's judgement, as the revision of
2026-11-18 left the like to the maintainer in its ticket 05.
