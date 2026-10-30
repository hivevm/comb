# Spec: Node content

## Problem

A host application can give a node nothing but a title. A metric tree, a dataflow pipeline, or a
backlog needs more inside each node: a status badge, a progress bar, a value with its trend, an
icon, a link to details. Today the host has to fake these in the title, or draw them in its own
layer over the canvas, which does not follow panning, zooming, and culling and costs what Q-1
cannot afford at 50,000 nodes. Nor does the host learn which part of a node the user clicked.

## Solution

The host application describes what a node shows as rows of elements: texts in the roles title,
body, and caption, icons it has registered by name, progress bars in coloured segments, badges,
values with a coloured trend, and actions. Comb lays the rows out inside the node's width, sizes
the node's height to its rows, truncates what does not fit, and draws every element. Node types
differ only in their description. A click on any element tells the host which node, which
element, and, for an action, which action; the host decides what that means, such as opening its
details panel. Zoomed out, a node shows its title alone, and further out a plain box. The
metric-tree example shows bets, epics, input metrics, the north-star metric, and KPIs as G-9
describes them, and its sidebar edits them.

## Existing behaviour

- A node is an identifier, a title, a position, a width, and a height, the host's to give. Its
  title is one `BitmapText` at the node's top left, drawn at the near and middle levels. Pinned by
  the browser tests of loading, levels of detail, hostile text, malformed data, and the example,
  and by the bridge's tests and property test of node validation.
- `updateNode` changes the title alone; `nodeUpdated` reports the patch. Pinned by the
  malformed-data browser tests and the api tests of changes.
- A click on a node selects it and drags it; nothing reports where in the node the user clicked.
  Pinned by the drag and selection browser tests.
- Callers move by a breaking change, before any release: `title` and `height` leave `NodeData`
  for `content`, a title becomes a text of role title, and every test, the example, and the
  benchmark's graph describe their nodes that way in the first ticket. What every existing test
  pins otherwise stays: the same refusals, slots, ranks, culling, and hit tests, and a graph whose
  nodes hold one title drawn as today.

## Goals served

- G-10 — node content as elements, drawn inside the node, node types differing only in their
  description, a click on an element reported.
- G-9 — the example shows the node types it names, with badges, progress bars, and trends.
- G-5 — the host changes a node's content, and the canvas shows the change.
- Q-1, Q-2 — content is drawn by Comb from pooled, batched views by level of detail; the
  benchmark measures the example with its full content.
- Q-4 — the layout's rectangles are exact to 0.5 px against a reference.
- Q-5, Q-6, Q-7 — content is text and numbers only, icons are objects the host registers, never
  URLs, and malformed or oversized content is refused with typed problems.

## User stories

1. As a host developer, I want to describe a node's content as rows of elements, so that my node
   types are data, not drawing code.
2. As a host developer, I want Comb to size a node's height to its content, so that I do not
   compute layout myself.
3. As a user, I want a text too long for its column to be truncated with an ellipsis, so that
   nothing spills over the node's border.
4. As a host developer, I want texts in the roles title, body, and caption, so that a node reads
   with a clear hierarchy.
5. As a host developer, I want a badge as text on a colour, so that a status reads at a glance.
6. As a host developer, I want a progress bar in coloured segments, so that an epic shows how far
   it has come.
7. As a host developer, I want a value with a caption and a trend whose direction and colour I
   give, so that a metric shows whether it improves.
8. As a host developer, I want to register icons by name from images I have already loaded, so
   that a node shows its kind without Comb fetching anything.
9. As a host developer, I want an action element, a text with an identifier, so that a node can
   carry a "Details" link whose meaning is mine.
10. As a host developer, I want to hear a click on any element with the node, the element's row,
    column, and kind, and an action's identifier, so that I can react to what the user clicked.
11. As a user, I want a press on an element that turns into a drag to move the node and report no
    click, so that dragging works anywhere on a node.
12. As a host developer, I want to replace a node's content through `updateNode`, so that my
    sidebar's edits show on the canvas.
13. As a user zoomed out, I want nodes to show their titles alone, and further out plain boxes, so
    that a graph of 50,000 nodes stays fluid and legible.
14. As a host developer, I want malformed or oversized content refused with a typed problem that
    names the node, so that a bug of mine cannot hang the page.
15. As a developer evaluating Comb, I want the example to show bets, epics, metrics, and KPIs as
    G-9 describes them, so that I see what node content can do.

## Implementation decisions

- **The model (ADR-0013):** rows of weighted columns, each holding one element of `text`, `icon`,
  `progress`, `badge`, `metric`, and `action`. A node is its identifier, position, width, and
  content; its height is the engine's. Colours are numbers, as edges' are.
- **Layout in the engine:** the shell hands the engine each `BitmapText` font's glyph advances and
  line height once, before the first layout that uses it; the engine computes each row's height,
  each element's rectangle, each text's truncation, and the node's height, and returns them with
  the query, as typed-array views for the bulk. The node's size, with its derived height, is what
  the spatial index, culling, connectors, edge ends, and the hit test use.
- **Validation:** the bridge crate checks content as it checks titles today, and states limits:
  rows per node, columns per row, code units per text, segments per progress bar, and code units of
  all texts in a load, so that accepted content stays within Q-7. Each refusal is a typed problem
  naming the node. Icons unknown at draw time draw nothing; naming one is not an error.
- **Drawing:** each element kind is pooled and batched as node views are (ADR-0027); every text is
  `BitmapText`. Near draws every element; middle the box and the texts of role title; far the
  particles of today, sized by the derived height.
- **Clicks:** the engine's hit test answers, within a node, which element lies under the point;
  a press that is released without a drag reports `onContentClick` with the node's identifier, the
  row, the column, the kind, and an action's identifier, and selects the node. A press that drags
  moves the node and reports nothing.
- **Changes:** `updateNode` takes `content` and replaces it whole; `nodeUpdated` carries it.
- **Icons:** `registerIcon(name, image)` takes an image object the host has loaded (Q-6).
- **Example:** each node type of G-9 is a function from the tree's data to content; the sidebar
  edits the selected node's fields and replaces its content; the "Details" action opens the
  sidebar.

## Testing decisions

- Layout is tested natively in `crates/engine` against an independent reference computation,
  every element kind at several widths, within 0.5 px, and no rectangle past the node's width, as
  the geometry tests do (Q-4); a property test asserts that any accepted content lays out to
  finite rectangles inside the node.
- Validation is tested in the bridge crate's tests and its property test, each limit at and past
  its bound, as titles are today.
- Drawing is tested in the browser through `comb/testing` inspection, not pixels: which element
  views a node holds at each level, and their rectangles; a reference image only where the
  edge-style tests already use one.
- Clicks are tested in the browser at the example: a click on each element kind, a drag that
  starts on an element, and a click on the node's padding, after the pattern of the selection and
  drag specs.
- The generated TypeScript type of content admits exactly the six kinds, tested as the change
  types are.
- Each ticket breaks its behaviour once and watches its test fail (`docs/CONVENTIONS.md`).

## Out of scope

- Elements beyond the six; a callback in which the host draws; fonts or sizes per node.
- Input on the canvas: an element is never editable in place (the Non-Goals).
- Kerning and right-to-left text.
- Animation of content, such as a progress bar filling.
- Hover states of elements; a cursor over an action is the most the shell shows.

## ADR impact

- ADR-0013 (proposed) binds this work and is revised here: clicks on every element, content
  replacing the title and the height, what each level of detail draws, and limits. It is
  accepted after its implementation and tests are reviewed.
- ADR-0027 (levels of detail, text as `BitmapText`, pools), ADR-0025 (one hit test, now down to
  the element), ADR-0028 (the bridge checks, the shell refuses what its map knows), ADR-0030
  (`nodeUpdated` carries content), ADR-0034 (bulk geometry as typed-array views), ADR-0029 (no
  coordinates in the store), and ADR-0020 (no eval) bind it as they stand.
- No new ADR: `registerIcon` and `onContentClick` are public interface that ADR-0013 decides.
