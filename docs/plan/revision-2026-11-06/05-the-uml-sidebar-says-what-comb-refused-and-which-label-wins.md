# Ticket: The UML sidebar says what Comb refused, and which label wins a change of kind

## What to build

Three behaviours of the UML example's sidebar (`examples/uml/src/sidebar.ts`) that ticket 03 of
docs/plan/uml-example left as doubts, because neither the spec nor the ticket decided them:

- **A refused edit leaves no sign.** After Comb refuses an edit, such as a member past its
  limit of 1,000 code units, the node and the example's copy keep the old content
  (`Diagram.edit` in `examples/uml/src/diagram.ts`), but the form keeps the refused text without
  a sign, so the user believes it was taken.
- **A change of kind overwrites the label.** `Sidebar.changeKind` replaces a label the user typed
  with the new kind's own label, or with none. Which should win was never decided.
- **A refused label is untested.** `Diagram.updateLabel` catches Comb's refusal and warns; no
  test covers it, and its only observable effect is that nothing throws.

The maintainer decides the first two: how the form shows a refusal (restores the content Comb
kept, or marks the field), and whether a typed label survives a change of kind. Then the sidebar
does that, and a browser test pins each, the refused label among them.

## Acceptance criteria

- [ ] Given a classifier selected, when the user types a member Comb refuses, then the sidebar
      shows the refusal as the maintainer decided, as a browser test decides.
- [ ] Given a relationship with a label the user typed, when its kind changes, then its label is
      the one the maintainer decided, as a browser test decides.
- [ ] Given a relationship selected, when the user types a label Comb refuses, then the edge
      keeps its label, the page throws nothing, and the sidebar shows the refusal, as a browser
      test decides.

## Read first

- Touches: `examples/uml/src/sidebar.ts`, `examples/uml/src/diagram.ts`, `examples/uml/index.html`,
  `examples/uml/src/style.css`, `examples/uml/e2e/edit.spec.ts`
- The merge commit of ticket 03 on feat/dev (de82155), section *Doubts*.
- Golden path: the refused-edit test of `examples/uml/e2e/edit.spec.ts`.
- Conventions: *A host application's copy follows what Comb took*.

## Blocked by

- None (can start immediately)

## Mode

with the human: how a refusal shows and which label wins are the maintainer's to decide, at the
start; the rest could run unattended once both are answered.
