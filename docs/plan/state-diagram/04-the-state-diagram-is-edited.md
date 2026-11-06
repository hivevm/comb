# Ticket: The state diagram is edited as the other diagrams are

## What to build

While the state diagram is shown, the palette offers a state, an initial state, a final state,
and a choice, each dropped under the pointer in its node shape. The sidebar renames a selected state
and names the event of a selected transition. A connection adds a transition docked on the
outline, a drag back onto a state adds a loop, and Delete removes the selection. Each diagram
keeps its edits while another is shown.

## Acceptance criteria

- [ ] Given the state diagram, when the user drops a choice, then a diamond appears centred under
  the pointer (G-12, G-1).
- [ ] Given two states, when the user connects them, then a transition docked on the outline is
  added; when the user names its event in the sidebar, then its label reads the event (G-12,
  G-3).
- [ ] Given a state, when the user drags a connection back onto it, then a loop is added (G-12).
- [ ] Given edits on all three diagrams, when the user switches between them, then each shows its
  own edits.

## Read first

- Touches: `examples/uml/`, `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`
- The spec.
- Golden path: the editing of the package diagram (`examples/uml/e2e/package-edit.spec.ts`).

## Blocked by

- docs/plan/state-diagram/03-a-loop-leads-a-node-back-to-itself.md

## Mode

with the human: how a state's and a transition's sidebar look is the maintainer's to see.
