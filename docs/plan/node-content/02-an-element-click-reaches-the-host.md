# Ticket: A click on an element reaches the host

## What to build

The engine's hit test answers, within a node, which element lies under a point. A press on a node
that is released without a drag reports `onContentClick` with the node's identifier, the element's
row, column, and kind, and selects the node as today. The `action` element, a text with an
identifier, joins the kinds, drawn as a text in the link colour, and its click report carries its
identifier. A press that drags moves the node and reports no click. A load's `action` fills the
columns ADR-0034 gives it, its text among the texts and its identifier among the names, with the
name column itself and the kind's code.

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

## Where it stands

Stopped before any code, on a question the ticket, ADR-0013, ADR-0025, ADR-0034, and the
specification leave open: **the drag threshold** the third criterion names.

- No threshold exists for a node. `interaction/node-drag.ts` moves the node on the first
  pointer move of any non-zero delta and tells `nodeMoved` where it moved at all. The one slop in
  the code is `PAN_SLOP`, 4 screen pixels, in `interaction/pan.ts`, which ADR-0025 decides for a
  press on an edge only. ADR-0013 says "without a drag" and names no distance.
- The choices, each a decision for the human:
  1. **No threshold:** a click is a press and release with no pointer move between; any move
     drags. Nothing changes in the drag, but a hand's jitter of one pixel loses the click.
  2. **A click slop beside an immediate drag:** the node moves from the first pixel as today, and
     a release within N screen pixels of the press reports the click too, the node then also
     moved and `nodeMoved` told; the two reports together contradict "a press that drags reports
     no click" unless the small move is undone or not told.
  3. **A drag slop on a node, as ADR-0025 gives an edge:** the node stays until the pointer has
     moved more than N screen pixels (4, as `PAN_SLOP`), and a release before that is a click.
     This changes how a node drag begins, which ADR-0025 states as "begins a drag of it"; the
     existing drag specs move 9 or more pixels per step and would still pass. It reads as a
     revision of ADR-0025 or a clause of ADR-0013.
- Settled by an ADR and not open: an action's identifier is a string of content among the
  *names* (ADR-0034), checked as `invalidContentText` and `contentTextTooLong` against the limit
  of code units per text, 1,000, and counted in the budget of a load's strings of content, whose
  doc comment in `graph_data/content.rs` already says "the texts and the names alike".
- A second, smaller gap, with a proposed answer: whether an element is hit at the middle and far
  levels, where it is not drawn. The proposal follows ADR-0025's labels, hit only where drawn: at
  near every element, at middle only texts of role title, at far none (a press then selects and
  drags the node and reports no click). ADR-0013 is silent; it would be recorded there.
- Where the code goes, once the threshold is decided: the content lives in the bridge crate
  (`ContentData`), not in `crates/engine/src/graph.rs`, so the element hit is
  `content::element_at(placed, x, y)` in `crates/engine` over the rectangles `lay_out` places,
  asked by the bridge crate's hit export for the node `hit_at` found, its result row, column,
  kind, and an action's name crossing in the generated `Hit`.
