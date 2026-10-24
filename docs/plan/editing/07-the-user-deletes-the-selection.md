# Ticket: The user deletes the selection, unless the host refuses

## What to build

The canvas becomes focusable and takes focus when pressed. With it focused, Delete or Backspace
deletes the selection: a node with every edge at it, or an edge alone. Before that, Comb calls
`CombOptions.canDelete({ nodes, edges })` with the identifiers of everything that would go, the
edges as the engine names them at the nodes before anything is removed, and deletes only where it
returns `true`; a throw refuses and reaches the page after the gesture ended. The deletion is
delivered as `nodesRemoved` or `edgesRemoved` with `by: "user"`, and the selection is cleared.

## Acceptance criteria

- [ ] Given a selected node with two edges and the canvas focused, when the user presses Delete,
      then the node and both edges are gone from the canvas, one `nodesRemoved` with `by: "user"`
      named all three, and the selection was reported `null` (G-4).
- [ ] Given a selected edge, when the user presses Backspace, then only the edge is gone, and the
      key's default action was prevented.
- [ ] Given `canDelete` returning `false`, `undefined`, or throwing, when the user presses Delete,
      then nothing is deleted and no change is delivered; with `true`, the deletion happens; with
      a throw, the error reaches the page as a page error after the gesture.
- [ ] Given focus outside the canvas, when the user presses Delete, then nothing is deleted.
- [ ] Given `canDelete`, when the host calls `removeNodes`, then `canDelete` is not called.
- [ ] Broken once: with the veto's result ignored, the refusal criterion fails.

## Read first

- ADR-0023 (*Vetoes*, *Deleting*), ADR-0022.
- Glossary: selection, veto, change.
- `interaction/index.ts`, `api/index.ts` (`CombOptions`).

## Blocked by

- docs/plan/editing/04-the-host-removes-nodes-and-edges.md
- docs/plan/editing/06-the-user-selects-an-edge.md

## Mode

with the human: it adds an option to `CombOptions` in `packages/comb/src/api/`, a protected part
of ADR-0007.
