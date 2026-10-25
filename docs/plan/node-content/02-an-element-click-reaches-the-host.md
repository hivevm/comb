# Ticket: A click on an element reaches the host

## What to build

The engine's hit test answers, within a node, which element lies under a point. A press on a node
that is released without a drag reports `onContentClick` with the node's identifier, the element's
row, column, and kind, and selects the node as today. The `action` element, a text with an
identifier, joins the kinds, drawn as a text in the link colour, and its click report carries its
identifier. A press that drags moves the node and reports no click.

## Acceptance criteria

- [ ] Given a node with a title text and an action, when the user clicks the action, then
      `onContentClick` reports the node, row, column, kind `action`, and the action's identifier,
      and the node is selected.
- [ ] Given the same node, when the user clicks the title, then the report names kind `text` and
      no action identifier.
- [ ] Given a press on an element, when the pointer moves past the drag threshold before release,
      then the node moves and no click is reported.
- [ ] Given a click on the node's padding, between elements, then the node is selected and no click
      is reported.
- [ ] Given an action whose identifier is no string or too long, when it is loaded, then a typed
      problem names the node.
- [ ] Given the type test of content, then it admits `text` and `action`.

## Read first

- ADR-0013 (*Clicks*), ADR-0025 (one hit test), ADR-0030 (how events reach the host).
- The interaction's gesture modules and the selection and drag browser specs, as the pattern.

## Blocked by

- docs/plan/node-content/01-a-node-shows-its-content-as-rows-of-text.md

## Mode

with the human: it changes the public interface (`packages/comb/src/api/`, `index.ts`), the
bridge crate's validation (`crates/engine-wasm/`), and the engine's graph
(`crates/engine/src/graph.rs`), protected parts of ADR-0007.
