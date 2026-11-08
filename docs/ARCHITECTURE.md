# Architecture — Comb

> The system **as it stands today**: the parts it is built from, what each is responsible for, and
> how they fit together. It holds no rule and no decision. It names the ADR behind each structural
> choice; where it disagrees with an accepted ADR, the ADR is right and this document is stale. It
> is updated in the same change as the structure it describes
> ([ADR-0001](adr/0001-agent-governance-model.md)).
>
> **Last design revision:** 2026-11-07, due after 20 changes. The revision that took the count
> moves the date; the number is this project's to set; a sensor counts the changes outside
> `docs/` since the commit that set the date and says when the next is due
> ([ADR-0006](adr/0006-feature-layer.md)).

## Context

```
 host application (its HTML sidebar, palette, persistence)
        │  graph data and edits in; changes, selection,  ▲
        │  and veto questions out                        │
        ▼                                                │
 ┌──────────────── packages/comb (TypeScript) ──────────┴──┐
 │ api → store ← interaction        render (PixiJS, WebGL2) │
 │              bridge ──────────────────────────────┐      │
 └──────────────────────────────────────────────────┼──────┘
                                                    ▼
 ┌──────── crates/engine-wasm → crates/engine (Rust, WebAssembly) ┐
 │ node positions and sizes, edges, spatial index, edge paths      │
 └────────────────────────────────────────────────────────────────┘
```

Graph data from the host application is untrusted, and every field of it crosses the bridge before
the store keeps any of it. The bridge crate refuses, each with a typed error: a field that is
missing or holds a value of another type, naming the node or edge by index, and by identifier where
it has one, the field, and what the field expects in plain words (`invalidField`); graph data that
is no object of node and edge lists of objects, as malformed; coordinates, sizes, and dash patterns
that are not finite as the engine keeps them (`f32`), negative sizes, a dash that is not positive or
a negative gap, a node whose coordinate or far side (`x + width`) lies more than the
world's limit, 2^120 world units, from the origin, and a label offset beyond it (`beyondWorld`),
naming the node or edge and the field, duplicate node or edge identifiers, edges to missing nodes,
non-finite label placements, a colour that is not an integer from `0` to `0xFFFFFF`, a text of
node content, an action's identifier (`id`), an icon's name (`name`), or a label text that is not
a string or longer than 1,000 UTF-16 code units, node
content that is no list of rows, a row that is no list or an element that is no object
(`invalidContentShape`, naming the node, row, and column), more than 8 rows or a row of more than
6 columns, an element of a kind other than `text`, `action`, `badge`, `progress`, `metric`, and
`icon`, a
weight that is not a positive finite number, a role of a text other than `title`, `body`, and
`caption`, a trend's direction other than `up`, `down`, and `flat` or a trend that is no object
(`invalidDirection`), a badge's, a trend's, or a segment's colour that is not an integer from `0`
to `0xFFFFFF` (`invalidContentColor`), a progress bar's segments that are no list or a segment
that is no object (`invalidContentShape`), more than 8 segments (`tooManySegments`), a
segment's fraction that is negative or not finite (`invalidFraction`) and fractions that sum past
1 (`fractionsPastOne`), each naming the segment where it names one, the texts and the
actions' identifiers of a load's content holding more than 1,000,000,000 code units together,
each naming the node and, where it has them, the row and column, a label background that is
not an integer from `0` to `0xFFFFFF`, more than 1,000,000 nodes or edges, an identifier, source, or
target longer than 256 UTF-16 code units, and identifiers of one load that hold more than 64,000,000
code units together, a node shape other than `rectangle`, `rounded-rectangle`, `ellipse`,
`circle`, `ringed-circle`, `diamond`, and `bar` (`invalidField`), content in a filled node shape,
a circle, a ringed circle, or a bar (`contentInFilledShape`), and an edge side other than `top`,
`right`, `bottom`, `left`, and `outline`. `api` refuses, against the store's map from identifiers to
slots (ADR-0030), an identifier `updateNode` or `removeNodes` names that the graph does not hold
(`unknownNode`), one `updateEdge` or `removeEdges` names (`unknownEdge`), one `addNode`, `addEdge`,
or a user's connection adds that it holds already (`duplicateNode`, `duplicateEdge`), and an end of
an added edge it does not hold (`missingNode`).
The bridge crate checks the node `addNode` and the edge `addEdge` hand over as a load checks one,
refuses an edge from a node to itself (`selfEdge`) unless `CombOptions.allowLoops` allows loops,
which a load accepts either way (ADR-0031), and an addition past the 1,000,000 nodes or edges
a load may hold, and `api` has it check the code units of identifiers the store counts with the new
ones. The engine keeps the count of the code units of the strings of content its nodes hold, set by
a load and moved by every addition, patch, and removal of a node, and refuses an addition or a
patch whose strings would pass the budget a load is held to (`contentBudgetExceeded`), before
anything changes. It refuses a patch of `updateNode` that holds a field other than `content`, a
patch of `updateEdge` that holds a field other than a colour, dash, arrowhead, label, or side
(`unknownEdgePatchField`), and a field it would refuse in a load. Label texts and label backgrounds
are checked there but not kept by the engine; the content of a node it keeps, to lay it out. `api`
reads the host's graph data once, in JavaScript, into a snapshot (`api/snapshot.ts`) of plain data
whose every field is a primitive of
the type it expects, any other value replaced by `false`, and whose texts and identifiers are cut
one code unit beyond the bridge's limits, so that no value of the host application and none of its
code reaches the engine, and a text of any length costs no more than that to check. The bridge's
`loadGraph`, `addNode`, `updateNode`, `addEdge`, and `updateEdge` take only the types
`GraphSnapshot`, `NodeSnapshot`, `PlainPatch`, `EdgeSnapshot`, and `PlainEdgePatch` that the
snapshot's functions return, so that the type checker refuses the host's graph data, node, edge, or
patch handed to the bridge directly (`bridge/snapshot-only.test.ts`). The bridge checks the counts
of nodes and edges before anything is copied, then the code units of the identifiers, counted while
the snapshot is read and read no further once they exceed the budget, then the code units of the
texts of content, counted and stopped at their budget alike (`checkContentBudget`, naming the node
whose text passed it), then the snapshot, and the
store keeps the snapshot's edges, whose sides `api` fills in where the host leaves them out,
`right` to `left`, and `top` for both of a loop, and of each node its identifier, width, and node
shape, which `api` fills in as `rectangle` where the host leaves it out; a node's content is the
engine's alone, which the snapshot of a load writes straight into its columns, and which the
engine's `content` builds when inspection or a change Comb tells asks for it. One walk reads a
node's content, `walkContent`, and hands what it read to a sink: a load's writes its columns and
counts its texts against the budget, that of `addNode`, `updateNode`, and `heightOf` builds the
plain data serde reads. A load's nodes and
edges cross as columns the snapshot writes while it reads them, through the bridge's
`nodeColumns` and `edgeColumns`: each string field, the identifiers, sources, targets, label texts,
the texts of content, and its names, the actions' identifiers, as pieces of at
most 2^28 UTF-16 code units, each ending where a value ends, with its boundaries in UTF-16 code
units across all pieces, per label text, text, and name of content whether it is a string, the
numbers as
`Float64Array`, an arrowhead, the sides, a node shape, an element's kind, and a text's role as
byte codes, the
boundaries of each node's rows and each row's elements as `Uint32Array`, whether a label, its
background, and a dash are present as bytes, and the first value refused by its type as its
position, a shape of
content the snapshot cannot flatten with its row and column
([ADR-0010](adr/0010-bridge-data-format.md)); serde-wasm-bindgen converts
nothing of a load. A string with a lone surrogate, which the bridge would read as U+FFFD,
`api` hands over as `false`, so that it is refused. `updateNode` and `updateEdge` read their patch
the same way, every own key of a plain object, before they look up the item it names, and merge only
the fields the bridge returns as checked. The bridge never formats a refused value into its message.
Graph data that cannot be read at all, such as nodes that are not a list, a list with a hole, a
patch that is no plain object, or a getter that throws, is refused as malformed before the bridge
sees it. That no code of the host application runs in the engine holds while nothing on the page has
patched JavaScript's built-ins, such as a setter on `Object.prototype` or a `Symbol.hasInstance` of
`Uint8Array`, which the generated glue reaches.

## Building blocks

The functional core and its shell follow
[ADR-0030](adr/0030-one-workspace-per-example.md), which restates the superseded ADR-0009 with
one workspace for each example.

- **Engine** (`crates/engine`) — pure geometry: `geometry` holds edge paths as cubic Bézier curves
  between the docks of two nodes, each end at the connector of a side, the middle of its `top`,
  `right`, `bottom`, or `left`, its control point pulled out along the side's outward normal, or on
  the outline, where the line from its node's centre towards the other node's centre crosses it, its
  control point pulled out along that line, and loops, an edge from a node back to itself, which
  leave and re-enter the one side their source's dock names, the top for the outline, a quarter of
  its length either side of its middle, clockwise, pulled out as far as the side is long, and moved
  inward as a whole along the side's normal until their ends meet the outline of the node's node
  shape ([ADR-0031](adr/0031-edges-dock-on-a-side-or-the-outline.md)), their exact bounds, the point
  and normal at a path parameter, and edge-label placement. `shape` holds the closed set of node
  shapes ([ADR-0032](adr/0032-node-shapes.md)): each one's height for content of a given height, the
  inner rectangle its content is laid out in, its hit test, the point where a line from its centre
  crosses its outline, and how far inward from a side its outline lies at an offset along it, all
  in the node's own coordinates. `graph` keeps the loaded graph, node
  positions and sizes per slot, a node shape per node slot, a rectangle by default, by which
  `node_at` hits a node within its outline and its edges' ends on the outline lie, and edges per
  slot, a rank per node slot, a list of the edges at each node slot, a list each of free node and
  edge slots, and a spatial index (`spatial`, a uniform grid each for nodes and edges, with an
  overflow list for items that cover many cells) that loads, additions, and moves keep current and
  that is built again once many items have moved or been added beyond its extent, or the nodes or
  the edges in use pass twice the count it was built for
  ([ADR-0023](adr/0023-the-engine-edits-its-graph-in-place.md)). Its modules under `graph/` follow
  its concepts: `slots`, the free slots of a kind, one type kept once for nodes and once for edges;
  `nodes` and `edges`, the edits of each, each with the one check that the slots a call names hold
  one, and `nodes` with the moves of the positions buffer; `index`, the grids and the one function
  that holds the rule that builds them again, called after every addition and move, a removal
  building nothing, and a rebuild building the grids from the edges as they are placed: a load
  places every edge once, and each edit places the edges it changes; `hit`, `labels`, and `query`;
  each with its tests, `tests` with the graphs they build and the property tests of the whole graph
  against a scan, and `budget`, the property test of the mesh budget. `add_node` takes the free
  slot freed last, or a new one after the highest, and the next rank, and puts the node into
  the grid in place; a load ranks node `i` as `i`; `add_edge` takes the edge slot freed last, or a
  new one, and puts the edge into the lists of its ends and the grid in place, and `update_edge`
  restyles and re-places one; `remove_nodes` frees the node slots and those of the edges at them,
  `remove_edges` edge slots, and both take the items out of the grids and the lists at the nodes; a
  free slot holds nothing, no query or hit returns it, a rebuild covers only the slots in use, and a
  call that names one refuses it as it refuses a slot beyond the graph, as a slot that holds
  nothing (`SlotError`). Its query returns the slots a rectangle
  meets, node slots in ascending rank, and `hit_at` what a press at a point hits
  ([ADR-0013](adr/0013-node-content-model.md)): the node drawn on top there, the one
  of the highest rank, else the edge in the highest slot within 4 screen pixels of its path as the
  stroke of the level flattens it, the parts of the path far from the point as chords; where the
  shell asks for connectors, at the near and middle level, a connector within 8 screen pixels, of
  the node of the highest rank, comes before them all. Inside its node's outline a connector
  reaches no further than a quarter of the node's height (top, bottom) or width (right, left), so
  that the middle half of a node, a bar's too, is the node's; beside the outline, in a corner of
  a circle's rectangle too, it reaches the 8 pixels. At the near level a label whose pill,
  as the labels layer measures and hands it over (`setLabelSize`), holds the point comes before a
  node; `move_label` places a dragged label at the path parameter nearest a point and its distance
  along the normal there; `mesh_at` meshes every edge at given node slots and of given edge slots,
  found by a query or not, as the query meshes the edges it found, what a drag redraws of the nodes
  it moves and an edit of what it added
  ([ADR-0027](adr/0027-a-drag-or-an-edit-redraws-what-it-changed.md)). `stroke` flattens the found
  edges within a tolerance and strokes them into the triangles of one mesh, with each edge's
  colour, dash pattern, and arrowhead, or as thin lines alone at the far level of detail; it decides
  the stroke of each level. A part of a path whose control points miss the query's rectangle, grown
  by the stroke's width, is drawn as its chord, a segment that meets the grown rectangle with an
  end outside it is split where it enters and leaves it, so that what the rectangle shows rounds by
  its distance from the query's origin, and a path is subdivided at most 24 levels deep; the mesh
  of one query holds at most the mesh budget, 2^22 vertices: each edge's floor, its chord or its
  arrowhead alone where that is its full mesh, is reserved first, edges are meshed in full in slot
  order while each fits beside the floors of those after it, and from the first that does not,
  every edge is drawn as its floor and the mesh is coarsened; its vectors grow by `try_reserve`, so
  that memory running short coarsens the mesh instead of trapping; the mesh records where each
  edge's indices start, so that the shell can leave an edge out of a mesh it keeps. `content` lays
  a node's content out ([ADR-0013](adr/0013-node-content-model.md)): from each role's font, the
  glyph advances and the line height the shell hands over, an action in the font of role body, a
  badge in it on a pill at its column's left that hugs the drawn text with 8 either side and 3
  above and below, the pill being the badge's rectangle and every other element of its row 3 lower,
  a progress bar as its column and a body's line, its bar 8 high in the middle of that line cut by
  `bar` into its segments from the column's left and the track after them, none past the column's
  end, a metric as its column and two lines, the caption's and the body's, which `metric_parts`
  divides into its caption on the first, its value at the left of the second, its trend's arrow, a
  triangle in a square of 10, 8 after the value, and its trend's text 4 after the arrow to the
  column's end, the trend's text cut first and then the value, an icon as a square of the body's
  line at its column's left, at most the column and in the middle of the line, a row as deep as its
  deepest element, the columns of a row sharing the width inside a padding of 12 less gaps of 8
  by their weights, each text advanced glyph by glyph from the left, without kerning, a character
  the shell hands no advance for by the font's fallback, and cut before an ellipsis where it
  passes its column, and the node as high as the padding of 10 above and below and its rows, at
  least 64; `drawn_at` is the one rule of which elements a level draws, every element near, the
  texts of role title middle, none far, by which the bridge's query places a found node's elements
  and `element_at` finds the element whose rectangle holds a point of the node, which the bridge's
  `hit` names beside the node it hits;
  `graph`'s `resize_node` gives a node a new height and re-places its
  edges and its place in the index. It depends on no crate that reaches the browser. `graph` keeps
  each edge's path and its bounds as of its last move, so that a query computes no bounds;
  `graph::slot` is the
  one conversion of a count to slots, which the bridge uses too. Only what the bridge uses is
  public; the rest is private to the crate, so that the `dead_code` lint finds what only tests
  reach.
- **Bridge** — `crates/engine-wasm` holds every WebAssembly export: `loadGraph` checks graph data
  and resolves edge ends to slots, keeps the content of the nodes, gives each node its node shape,
  refusing content in a filled one, and makes each node as high as its node shape needs for its
  content laid out in its inner rectangle in the fonts `setFont` handed over
  ([ADR-0032](adr/0032-node-shapes.md)), which the sizes buffer holds beside
  the positions buffer, and a font handed over later lays every node out anew; a node whose far
  side, by that height, lies past the world's limit is refused; `updateNode` checks a patch of a
  node's content as a load checks it and gives the node the new content and its height, `addNode`
  checks one node as a load would and returns the slot the engine chose for it, `heightOf` checks
  a node named `""` at the origin as `addNode` does and returns the height its content lays out to,
  adding nothing (ADR-0026), `addEdge` checks one edge as a load would, refuses one from a node to
  itself unless it is handed that loops are allowed, and adds it between the node slots `api`
  resolved, `updateEdge` checks a patch of an edge's colour, dash, arrowhead, label, and sides as a
  load checks those fields and restyles and re-places the edge, `edgesAt` names the edges at given
  nodes without removing anything, `removeNodes` removes nodes and the edges at them and returns
  those edges' slots, `removeEdges` removes edges, `translate` moves nodes, each as far as keeps it
  within the world's limit, so that every point the engine derives stays within `f32`, `query` takes
  a rectangle, a level of detail, the size of a screen pixel, at most 2^114 world units for a
  stroke, and how far an edge label's pill reaches from its point, and writes the found node slots,
  the edge-label slots and points (at the near level only), at the near and the middle level where
  the elements of each found node drawn at the level lie (`drawn_at`), and their kinds, roles, and
  colours (`contentBounds…`, `contentRects…`, `contentKinds…`, `contentRoles…`, `contentColors…`),
  the pieces of each progress bar's bar and their colours (`contentBarBounds…`, `contentBars…`,
  `contentBarColors…`), the parts of each metric and the end of each part's text
  (`contentPartBounds…`, `contentParts…`, `contentPartEnds…`) and its arrow (`contentArrowBounds…`,
  `contentArrows…`), what of each text is drawn, and each icon's registered name whole, as one
  string `contentTexts` returns, cut by `contentTextBounds…`, the found edge slots, and the edge
  mesh into buffers the engine owns, the label points and the mesh's positions relative to the
  query's origin, which `originX` and `originY` read ([ADR-0010](adr/0010-bridge-data-format.md)),
  and returns the mesh's detail, complete or coarsened, and refuses a pixel that is not a finite
  number above zero, with where each found edge's indices start in the mesh (`meshEdgeStarts…`);
  `meshAt` meshes the edges at given node slots and the given edge slots, each once, in the
  rectangle, at the level, and at the pixel of the query the scene keeps, relative to its origin,
  into a mesh of their own, their slots in `movingEdges…`, refuses a slot that holds no node or no
  edge and a pixel as `query` does, and returns the mesh's detail
  (ADR-0027); `meshPtr` and `meshLen` read a buffer of either mesh, named by a `MeshOf`, the
  query's or the moving layer's, by a `MeshBuffer`, so that the shell reads both through one
  function;
  `drawnEdges` computes the ends of the found edges and of the moving mesh's when inspection
  asks, as they lie then, and
  `hit` names what a press at a point hits, a connector where the shell asks for connectors, a
  label, a node, or an edge by its slot, or nothing, as one generated value, and refuses a pixel as
  `query` does and a point that is not finite;
  `setLabelSize` takes the measure of a label's pill, `labelPoint` names where a label lies, and
  `moveLabel` places a dragged label, one dragged beyond the world's limit stopping there, refuses
  a point that is not finite as `hit` does, and returns its path parameter and offset; it generates
  the type of every problem of graph data the methods of `Comb` throw, `GraphDataProblem`, which
  `comb` exports, and keeps the refusals of the shell's mistakes in types of their own: `SlotError`
  of a slot that holds nothing, which `translate`, the removals, `edgesAt`, `setLabelSize`,
  `moveLabel`, `content`, `updateNode`, `addEdge`, and `updateEdge` throw alike, and `NumberError`
  of a number the shell computed that an export cannot take, whose kind names it: `nonFinitePoint`
  of `hit` and `moveLabel`, `invalidPixel` of `query` and `hit`, `invalidFont` of `setFont`, and
  `nonFiniteDelta` of `translate`, which
  `TranslateError` names, never a `GraphDataProblem`
  ([ADR-0022](adr/0022-a-shell-mistake-is-refused-as-the-shells.md)). The shell
  guards each such number before it calls the export. It checks the screen
  pixel of a query and of a hit test in one function, and the point of a hit test and of a label's
  move in another; the core bounds a pixel beyond any zoom for both, in one function. Its crate
  root holds the exports and their conversions; its module `graph_data` reads and checks graph data,
  the one place that does, each rule of an edge through one function that a load, `addEdge`, and
  `updateEdge` reach alike, and a node and an edge of a load's columns by the checks of the node of
  `addNode` and the edge of `addEdge`, mapping the columns' boundaries onto the identifiers and the
  texts of content only once their lengths are checked
  ([ADR-0030](adr/0030-one-workspace-per-example.md)). It is split by concept: `limits` holds
  the limits of a load, `field` the lenient reading of a field, `input` the types the host
  application hands over, `strings` the decoding of every string column, `node_columns` and
  `edge_columns` the columns of a load's nodes and edges, `problem` the refusals, `item` the reading
  of a node or an edge, `checks` the rules of each, `load` a load and `addNode`, `edit` `addEdge`
  and the patches, and `content` node content, itself split into `codes`, its codes and limits,
  `check`, the one check of a load's content columns and of a single node's content, `data`, the
  content the engine keeps, `layout`, the content as the engine's layout and hit test read it,
  `node_content`, the content as the host application's type describes it, and `input`, the content
  of a single node read through serde-wasm-bindgen; `snapshot`, built for the tests alone, writes
  the columns the shell writes, and `tests` holds the builders the tests share. Its module `kept`
  holds what the bridge keeps of node content between calls: the content of the nodes by slot
  (`ContentStore`) and the buffers of what a query places of it (`Drawn`).
  `packages/comb/src/bridge` is the one module that imports the WebAssembly package and reads those
  buffers through fresh typed-array views per read
  ([ADR-0010](adr/0010-bridge-data-format.md)): its `columns.ts` holds the writers of a
  load's columns and the codes they cross as, its `index.ts` the facade of the engine, which
  re-exports them.
- **Store** (`packages/comb/src/store`) — a vanilla Zustand store with the graph's structure, its
  nodes and edges by slot with holes at free slots, which every reader skips, the maps from node and
  edge identifiers to slots, the code units of the identifiers it holds, counted for a node and for
  an edge by one function each and for a load taken as its snapshot counted them, the change the
  last action that changed the graph made, by kind and identifier, the selection, the node under the
  pointer, the connection the user drags, its source, side, the node under the pointer,
  compatibility, and the connector a release connects to, the viewport, the slots a drag moves
  (`dragged`), a counter for changes of positions a kept query does not survive
  (`positionsVersion`), a counter for a drag's moves (`movesVersion`), and a counter for moves of
  the point a connection is dragged to (`pointerVersion`); no coordinates of
  nodes, edges, or the pointer
  ([ADR-0011](adr/0011-store.md)).
  `GraphView` is its state without the actions, the type the render layer reads.
  `store/viewport.ts` holds the viewport's arithmetic, the transform between world and screen and
  the level of detail of a scale included, for interaction, the scene, `api`'s `fitView`,
  `setViewport`, and `worldPointAt`, and the testing entry; it imports none of them, so the render
  layer takes it from the store, not from interaction.
- **Interaction** (`packages/comb/src/interaction`) — pointer, wheel, and key input into store
  actions and engine moves. `index.ts` dispatches: a press begins the gesture of what it hits, each
  a module of its own behind the `Gesture` of `gesture.ts`, which says how it moves, how it ends at
  a release or at a later press, and whether a change of the graph takes its subject, which ends it
  without a word; `guard.ts` holds the guard every handler runs under once the engine is lost.
  `node-drag.ts` selects a node on press and drags it once the pointer has moved more than the
  slop of 4 screen pixels (`SLOP` of `gesture.ts`), and on a release on the canvas within it
  tells a click on the element of the node's content under the release, hit anew, through the
  `click` of the gestures' `Context`; a cancelled pointer ends a gesture as no release;
  `pan.ts` selects an edge on press and pans once the pointer has moved beyond the same slop, or
  clears the selection on the empty canvas and pans; `index.ts` zooms around the pointer and sets
  the cursor over what a press would hit;
  `connect.ts` begins a connection on a press on a connector, where `CombOptions.canConnect` is set,
  follows the pointer with it, marks compatible the connectors of a node the source does not reach
  yet, the source's own where `CombOptions.allowLoops` allows loops but for the one it starts from,
  and proposes the edge on a release over one, through the connection `api` hands it;
  `delete.ts` makes the canvas focusable and, on Delete or Backspace, names what deleting the
  selection would remove, a node with the edges the engine names at it (`edgesAt`) before anything
  is removed, and hands it to the deletion `api` hands it; neither asks a veto itself;
  a key held down or pressed with Control, Alt, or Meta deletes nothing beyond its first press. A
  connection's source and what it is over are the store's, written only where they change; the
  world point it is dragged to is interaction's `pointer`, which `attachInteraction` returns, and a
  move signals it with the store's `pointerMoved`, as a drag of a node signals its moves; its
  gesture ends it at a load or a removal of its source. `label-drag.ts`: a press on a label, at the
  near level, selects its edge and drags the label, held where it was grabbed, which the engine
  places on every move; its release, or a later press, records `labelMoved` once, and a load, a
  removal of its edge, or a label the host cleared ends the drag. A drag that moved its node records
  `nodeMoved` once, when the pointer is released on the canvas or outside it; a load ends a drag.
  The engine's `hit` says what the pointer is on, at the level of detail of the scale; the world's
  layers take no events.
  `targetAt` of `gesture.ts` is the one hit test: `attachInteraction` asks it from the store's
  viewport, connectors only where `CombOptions.canConnect` is set, as `hitAt`, which the gestures'
  `Context` carries, for the press, the hover, and every move of a connection, and returns it, for
  the testing entry, beside the `pointer` of a connection and the function that detaches the input.
  Where the viewport puts a screen point beyond any finite world point, `targetAt` answers nothing
  without asking the engine, and a label drag skips a move to such a point.
- **Render** (`packages/comb/src/render`) — the PixiJS scene (`scene.ts`), which imports nothing
  from interaction: a `world` render group with the layers `EdgesContainer` (`edges.ts`),
  `NodeParticles` (`particles.ts`), `NodesContainer` (`nodes.ts`), `LabelsContainer` (`labels.ts`),
  and `ConnectorsLayer` (`connectors.ts`), the moving layer of a drag and of edits at the far
  level, `MovingLayer` (`moving.ts`), whose second edges layer stands directly above the edges and
  whose second `NodeParticles` directly above the particles
  ([ADR-0027](adr/0027-a-drag-or-an-edit-redraws-what-it-changed.md)), which holds the state of
  that drawing, reads the edits through `edits.ts` from the store's arrays against the kept
  query's, tells the scene whether its query survives them, hides in the query's layers what moved
  or was removed, and answers inspection for what it drew, with the connectors of the node under the
  pointer and, while the user connects, of the source and the node under the pointer, and an
  `overlay` with the line of the connection being dragged, to the pointer `api` hands each render
  from interaction ([ADR-0012](adr/0012-virtualized-scene-graph.md)); `bindings.ts`
  is the pool of views the nodes and labels layers bind to slots, keeping the layer's children in
  the order a render binds them. The scale chooses the level of detail: near (from 0.6) draws node
  views and edge labels, middle (from 0.3) node views alone, and far nodes as particles of one
  `ParticleContainer` (`render/particles.ts`) and edges as lines one pixel wide. A render queries
  the engine for the viewport grown by the culling margin and binds pooled node views and edge-label
  views to exactly the slots it found, node views and particles in the order of the nodes' ranks,
  which the query returns, edge labels in slot order; while the viewport stays within what it last
  queried, that rectangle within the viewport grown by twice the culling margin, at about its scale
  and the same level of detail, and the graph and the selection are unchanged, a render moves the
  world alone; a drag keeps its query and draws its frames as **How it runs** says. The world stands
  at the screen point of the last query's origin, the edges, labels, and connectors at (0, 0) in it,
  drawn less the origin, the nodes and particles at minus the origin, so that the GPU sees no far
  coordinate of edges, labels, and node views. `EdgesContainer` (`render/edges.ts`) draws the edge
  mesh with a shader that leaves out the gaps of dash patterns; on the Canvas 2D renderer a host
  application opts into ([ADR-0018](adr/0018-webgl2-or-an-opted-in-canvas-fallback.md)), which runs
  no shader, `EdgeFill` (`render/edges-canvas.ts`) takes its place, builds no mesh, and fills the
  same triangles into one `Graphics`, one fill per run of one colour, dash patterns solid; both are
  an `EdgeLayer`, which the scene and the moving layer draw and hide edges in alike. The mesh
  remembers how much of its index buffer the syncs marked for upload until PixiJS next draws it,
  a hidden mesh, which it does not draw, included, so that a later sync and a hide in between keep
  that mark, since WebGL uploads by the range marked last. A node
  view draws its node shape (`drawShape`, in the pooled `Graphics` that drew a node's box, the
  content node shapes white and bordered, the filled ones near-black, inspection reading its
  primitives back) and its content ([ADR-0013](adr/0013-node-content-model.md)): each text a
  pooled `BitmapText` of its role's style where the query placed it, cut where the engine cut it and
  followed by an ellipsis, a badge's on its pill, which one `Graphics` per view draws of the colour
  the query hands over, placed by the padding the engine states (`badgePaddingX`, `badgePaddingY`),
  in white or near-black by WCAG contrast (`badgeTextColor`), inspection reading the pills back from
  that `Graphics`, and a progress bar's pieces, which another `Graphics` per view fills within the
  bar's outline, only its outer ends rounded by 4 (`pieceOutline`), the track in `TRACK_COLOR`,
  inspection reading them back likewise, and a metric's caption in the caption's style, its value
  in the body's, and its trend's text in the body's font and the trend's colour, each where the
  query placed its part, and its arrow, which a third `Graphics` per view fills in the trend's
  colour, inspection reading it back likewise, and an icon as a pooled `Sprite` of the texture the
  host application registered under its name (`render/icons.ts`), fitted into its square with its
  aspect kept, none where none is registered, inspection reading the sprites back, what the
  query placed and nothing of the level; a view draws anew only where its node, which the store
  replaces when its content changes, its size, its selection, or the number of elements the
  query placed of it changed; a registration of an icon has every bound view draw its icons anew
  at once, without a query, so that it draws once the engine is lost too, and destroys the
  texture it replaced, a view bound later drawing its icons anew;
  `fontMetricsOf` of `nodes.ts` measures each role's glyph advances, which `createComb` hands the
  engine once, before the first load, with the line height of each role, which the render layer
  states rather than measures.
- **API** (`packages/comb/src/api`) — `api/index.ts` imports `pixi.js/unsafe-eval` before PixiJS, so
  that no PixiJS renderer on the page generates code with eval
  ([ADR-0020](adr/0020-pixijs-without-eval.md)); `createComb`, which takes the engine's WebAssembly
  from the host application as `engine` and refuses with an `EngineSourceError` where it is missing,
  a string, `URL`, or `Request`, or none of a `Response`, a module, and the bytes (`api/engine.ts`,
  [ADR-0019](adr/0019-the-host-hands-comb-its-engine.md)), before it touches the host element, and
  with a `RendererUnavailableError` where PixiJS finds no WebGL2 unless `allowCanvasFallback` lets
  it draw on Canvas 2D (`api/renderers.ts`), and paints the canvas in `background`; and the `Comb`
  it returns: the graph data (`load`, `updateNode`, `addNode`, `addEdge`, `updateEdge`,
  `removeNodes`, `removeEdges`), read once into a snapshot (`api/snapshot.ts`) and handed to the
  engine by `api/editors.ts`, which also gives interaction the user's connection and deletion,
  each after its veto, `CombOptions.canConnect` or `CombOptions.canDelete`, `heightOf`, the
  height a node's content lays out to in a node shape, the rectangle where none is named, read
  and checked there as `addNode` reads and checks a
  node, changing nothing ([ADR-0026](adr/0026-the-host-asks-the-height-content-lays-out-to.md)),
  the viewport (`fitView`, `setViewport`, `viewport`, and `worldPointAt`,
  the world point under a point of the page, which needs no engine), the events to the host
  application (`onChange`, `onSelectionChange`, `onContentClick`, which interaction tells of each
  click on an element, `onEngineLost`), `registerIcon`, which refuses with an `IconError` a name no
  icon element can give and an image Comb would fetch, cannot draw, that has not loaded, or whose
  pixels the page may not read, and copies the image into a canvas of its own (`api/icons.ts`), and
  `destroy`; `onChange` delivers each change the store
  records as a `GraphChange`
  ([ADR-0024](adr/0024-edits-are-reported-as-typed-changes.md)), its positions read
  from the engine's buffer, synchronously from one subscription to the store that tells a change
  before the selection it cleared (`api/changes.ts`); `whenRendered` resolves once a change is
  drawn, with one render per animation frame scheduled by `api/frames.ts`. `api/scenes.ts` is the
  one way from a `Comb` to its scene and to the hit test its presses ask, for the testing entry.
- **Testing entry** (`comb/testing`, `packages/comb/src/testing.ts`) — `inspect` returns what the
  scene draws, each node view's texts with where they lie and what of them is drawn, its icons'
  sprites with their rectangles and the names their textures are registered under, its content and
  the text of its first title, which the engine builds when asked (`content`), its node shape
  (`shape`) and the primitives of its outline (`outline`), a rounded rectangle's with its corner
  radius, its pills, bars, and arrows, and the labels drawn included, the connectors drawn with
  where each is centred and how often the layer drew them anew, and the size and detail of the edge
  mesh, which the host application is not told; `viewport` and `renderCount`, cheap enough for every
  frame, return its transform and how often it rendered; `screenPoint` and `visibleRect` apply the
  scene's transform between world and screen; `hitKind` names what a press at a screen point hits,
  asking interaction's hit test from the viewport a press reads, which is the drawn one once
  `whenRendered` resolves, connectors only where the Comb lets the user connect; `isDrawn` finds
  whether one node or edge is drawn without building every drawn view, as `inspect` does, an edge
  from the slots the scene holds, the query's and the moving layer's, without asking the engine;
  `showLayers` hides layers for a reference image; `sceneNumbers` gives the numbers the scene draws
  by (where the levels of detail begin, the culling margin, the label reach, the rescale); `work`
  counts what the canvas did: GPU buffers created and allocated, bytes uploaded, those of the edge
  mesh among them, and texture uploads, counted at the WebGL context from its first call, resizes of
  the edge mesh's buffers, and views the pools made, and refuses with an `UncountedRendererError`
  where the canvas draws without WebGL; `edgeVertices` gives the screen point of every vertex of the
  edge mesh as its shader computes it in `f32`, and `gpuEdgeIndices` the indices its GPU buffer
  holds, read back; for tests, the benchmark, and tooling. Its shape follows the scene and is
  outside the stable interface of `comb`.
- **Example** (`examples/metric-tree`) — a host application with a metric tree and an HTML sidebar
  (G-9), each type of node told only by the content the example describes from its fields (G-10):
  a bet its hypothesis and status badge, an epic its progress bar and status badge, an input
  metric its values over three periods, the north-star metric and a KPI theirs, each with the icon
  of its type beside its title, which the example draws on a canvas and registers before its first
  load, and a "Details" action, whose click puts the sidebar's focus on the node; each node lies
  with its middle on its row whatever its height, which the example asks of `heightOf`; a sidebar
  edits the selected node's fields and replaces its content through `updateNode`, of a node whose
  content another caller replaced its title alone, or the selected edge's colour, dash, arrowhead,
  and label, with a palette whose types HTML drag and drop puts onto the canvas, where the example
  adds a node of that type centred by the height `heightOf` gives on `worldPointAt` of the drop
  (G-1); it keeps its own copy of the graph from every kind of change `onChange` tells, in one table
  by kind, the sidebar's edits following from the changes Comb tells, and `window.exampleGraph`
  hands a browser test that copy; it names each edge the user connects after its ends, and hands its
  vetoes to `window.canConnect` and `window.canDelete` where a browser test sets them;
  `?connect=none` gives Comb no `canConnect`; `?copies=` sets its size, the copies lie in a grid
  about as wide as tall, and it reports its load time as `window.loadReport`; `?fallback=canvas`
  allows the Canvas 2D fallback; `?loops=allow` sets `allowLoops`, and `?graph=shaped` loads the
  benchmark's shaped graph with loops allowed; it fetches the engine file Vite emits for its
  `comb/engine.wasm?url` import and hands over the promise of the response, or with
  `?engine=response`, `module`, `bytes`, or `view` that form; `window.createComb` and
  `window.engineUrl` let a browser test make a second Comb in a host element of its own,
  `window.useGraph` loads a graph as the example's own, `window.comb` is its Comb, and the functions
  of `comb/testing` stand on `window`, bound to its Comb.
- **UML example** (`examples/uml`) — a second host application, of its own workspace, which imports
  Comb by its entries alone and nothing of the metric tree (G-12, ADR-0030); a sidebar chooses
  between its three diagrams, the class diagram first, and lists the legend of the kinds of
  relationship, each a line drawn in its colour, dash pattern, and arrowhead beside its name and
  label, one legend for the class and the package diagram. Chosen, the state diagram
  (`src/state-diagram.ts`) shows a Comb's life, its states rounded rectangles of their name, its
  initial state a circle, its final states ringed circles, and the choice of whether its engine
  loaded a diamond, placed by the heights `heightOf` gives their node shapes, and its transitions
  grey edges docked on the outline labelled by their event or guard, and a loop on ready's left side
  labelled edit, for which the example's Comb allows loops; its legend hidden, it is edited as the
  others are: the palette drops a state, an initial state, a final state, or a choice, each in its
  node shape and centred on the drop; the sidebar renames a selected state and names a selected
  transition's event, its label; a connection adds a transition docked on the outline at both ends,
  or a loop on the side it left by. Chosen, the package diagram (`src/package-diagram.ts`) shows
  Comb's modules and crates as nodes of «package» and their name and their dependencies as dashed
  edges with an arrowhead and the label «import» or «use»; each diagram is kept as it was left, its
  edits among it, while another is shown, for as long as the page lives. `src/class-diagram.ts`
  describes Comb's public interface, and the render layer's edges layer for its one realization, as
  classifiers whose content is a caption for the stereotype, a title for the name, and a body text
  per member, at most the eight rows Comb lays out and "…" for those left out, placed in rows laid
  out by hand by the heights `heightOf` gives; both diagrams are held to Comb's source by a Bun
  test (`src/comb-source.test.ts`), which reads the library's files by path, never by import,
  and fails where a package, a dependency between the modules of `packages/comb/src` or the
  crates, or a member of the `Comb` interface is missing from the diagram or drawn there and
  not in the source, and on a source it reads nothing from; `src/relationships.ts` maps each kind of
  relationship, the state diagram's transition among them, to the colour, dash pattern,
  arrowhead, and label `docs/CONVENTIONS.md` records, in one table from which the kinds and the
  legend's list follow, and builds every edge's label, for the diagrams' data and the sidebar's
  edits alike, from its kind, its text, and the place it already has. The diagram is edited as
  the metric tree is, and so is the package diagram: the palette drops a class, an
  interface, or an abstract class, or on the package diagram a package, centred on the drop; the
  sidebar (`src/sidebar.ts`) edits the selected classifier's name, stereotype, and members, one per
  line of two text areas, or a package's name, through `updateNode`, and the selected relationship's
  kind and label, or a dependency's «import» or «use», through `updateEdge`, an edit Comb refuses
  staying in its field, which is marked invalid and says why under it until the next edit of the
  form Comb takes clears every mark of the form, since a classifier's edit sends every field of
  it, and a change of kind keeping a label the user typed and replacing only the old kind's own
  label, or none, by the new kind's, or none; a connection becomes an
  association, on the package diagram a dependency «use», and on the state diagram a transition,
  where the rules of `src/rules.ts`, a pure function of the kinds of the ends, of the relationship,
  and of whether it is a loop, allow it: they refuse a transition into an initial state or out of a
  final state, and every loop but a state's, which Comb offers in every diagram since it allows
  loops; and Delete removes the selection. Each node keeps its node kind, set when it is created
  from the diagram's data or the palette: a class, an interface, an abstract class, or a package,
  kept in its record `Classifier` (which carries a package too, though UML counts no package as a
  classifier), and changed by no edit of its stereotype; and a state's, state, initial, final, or
  choice, with its state. What the diagrams share stands in `src/shared.ts`, which imports no
  diagram's file and no diagram's file imports another's: the diagram as data (`DiagramData`), the
  kinds of node, which the rules import, the classifier and the state, the classifier's content
  (`contentOf`), and the layout by rows (`laidOut`) of the class and the package diagram; the
  lookup of an element of the page stands in `src/element.ts`. Each diagram is described in one
  place, the descriptor (`DiagramDescriptor`) its file exports: its identifier and name in the
  choice of diagram, how it is built, its kinds of node with their names in the palette and the
  form the sidebar edits each in, the kind a connection adds and how it docks, the form the
  sidebar edits an edge in, the headings of a selection, and whether the legend shows. The host
  application fills the choice of diagram and the palette from the descriptors, and
  `src/diagram.ts` and `src/sidebar.ts` read the one of the diagram shown instead of branching on
  a kind. `src/diagram.ts` keeps the example's copy of the graph, the classifier or the state of
  each node, and the kind of each edge, each from a change `onChange` tells or after Comb took the
  call that changes it, and `src/legend.ts` draws the legend. Its hooks stand under `window.uml`, so
  that it declares nothing on `window` the metric tree declares; Vite serves it on port 5176, the
  launch configuration **Example: UML** opens it, and its browser tests run in the Playwright
  project `uml` against it in test mode on a port of their own.
- **Benchmark** (`bench/run.ts`) — the example at 50,010 nodes in Chromium, each node with the
  content of its type, measuring the time to the first frame and p95 frame times over the frames
  Comb rendered of drag, pan, zoom, and edits one a frame, a node and an edge added and removed
  again, each gesture checked for its effect (Q-1, Q-2): first at the view the example opens
  with, the whole graph fitted, in the order `bench/fitted.ts` holds, the edits beginning at the
  fitted view's scale and position again and recording that scale; then at each level of detail,
  centred in the graph, the pans first, near and middle at the scale where each begins; where the
  fitted view draws far, as at 50,010 nodes, its gestures are far's and far adds only its zoom. A
  run records the level the fitted view draws (`fitted`) and the content loaded, nodes by type and
  elements by kind (`load.content`). It is
  served from the example's production build by `vite preview` on port 4173, in a Chromium
  started by `bench/chromium.ts`, or attached through its debugging port to a Chrome on the host
  where `BENCH_CDP` names one (ADR-0028); `BENCH_CPU_THROTTLE` slows the measured page's CPU
  (ADR-0029); `BENCH_GRAPH` names the graph, `metric-tree` or `shaped`, which the example loads
  with `?graph=shaped`: the metric tree's nodes and edges in the same columns and order, the
  nodes in the node shapes in turn, a node in a filled node shape without content, a circle and a
  ringed circle 64 wide, each node centred on its row and column, the rows spaced for the tallest
  node by the gap the metric tree leaves under its own, so that no two nodes overlap, the ends
  docked on the outline, and a loop on one node in a hundred (`shaped` in `src/graph.ts`,
  ADR-0033).
  `bench/options.ts` reads all three and refuses a value it cannot take; a run records `graph`, and
  checks that the example loaded it, and the type checker holds the graphs `bench/options.ts` names
  to the example's `GraphName`, which ADR-0030 keeps from importing `bench`. After the first frame
  and before the gestures it times the reference workload of `bench/reference.ts` in the same page,
  which uses the browser's JavaScript, WebAssembly, and WebGL2 and none of Comb's code.
  `bench/compare.ts` compares the median of several runs with the baseline of the runner's kind, the
  CPU model the run records, and of the run's graph, in `bench/baselines/` (`<kind>.json` for the
  metric tree, `<kind>.shaped.json` for the shaped graph), with a margin of 25 %, reports a gesture
  the baseline lacks as `no baseline` without judging it, refuses a run on a kind without a baseline
  of its graph, a run of another graph, a run whose reference differs from its kind's baseline by
  more than 25 % in a part, a run of another size, mode, or GPU or of none named, a run of an
  attached browser against a launched baseline or the reverse, a run of another CPU slowdown factor,
  and a median of runs that differ in these; a kind's baseline is the median of three runs on a
  GitHub runner of that kind on `main`; the **Benchmark** workflow
  (`.github/workflows/benchmark.yml`) runs the benchmark three times on each graph and compares each
  graph's median with its own baseline on a GitHub runner, weekly and on demand, within 90 minutes;
  the shaped graph's comparison fails the job only where its kind has a baseline, and otherwise
  reports its median (`bench/compare.ts` exits 3 for a kind without a baseline of the runs' graph, 2
  for the other refusals).
- **Mutation testing** (`.github/workflows/mutation.yml`) — cargo-mutants mutates `crates/engine`
  on a GitHub runner, weekly and on demand; `scripts/check-mutants.sh` compares the surviving
  mutants with `crates/engine/mutants-missed.txt` by file, function, and replacement, and fails
  on a survivor the list does not name, and on a run that caught none (ADR-0008).

**Test pattern:** Rust unit tests beside the code they test (`#[cfg(test)]`); a property test of the
bridge crate's validation (`crates/engine-wasm/src/properties.rs`, proptest) that feeds it 10,000
random batches per run against a brute-force oracle, and one of the mesh budget
(`crates/engine/src/graph/budget.rs`) that queries random graphs of long edges with the budget
lowered; the hit test held to one scan of every kind, whose oracle, `Model` of `graph/tests.rs`,
computes bounds, connectors and their reach clipped by the outline, paths, and label points from
the inputs the test gave the graph and reads nothing of it; Bun tests beside their module as
`*.test.ts`, the bridge's against the built WebAssembly module, the lint's rules for Comb's library
sources in `packages/comb/src/lint.test.ts`, and those of `bench/compare.ts`, `bench/chromium.ts`,
`bench/options.ts`, and `bench/fitted.ts` beside them, with
`bench/content.test.ts` of the content the benchmark names as loaded and `bench/workflow.test.ts`
of the Benchmark workflow's gate, its comparison steps run with a stand-in for `bun`; browser
tests under `examples/*/e2e`, a file for the golden path and one for each concern they verify,
each example sharing its helpers through its own `e2e/shared.ts` (the metric tree's: a graph
loaded as the example's own through `useGraph` with what Comb tells recorded, the one read of the
drawn nodes and edges each spec narrows, a node of the size the example's source states, also in
the page as `window.node`, and the page point of a world point, a click and a drag there; the UML
example's: opening it, the styles of the kinds of relationship as the conventions record them, and
the page point, a click, and the drawn place of a node), run by Playwright on Bun against each
example, reading what is drawn through `comb/testing` rather than pixels, apart from one reference
image of the edges alone.

The Bun tests and the browser tests on the development server run the bridge in test mode, which
grows the engine's memory before each of its calls, so a view kept across a call reads empty, and
counts each call by its name, which `bridgeCalls(name)` of `comb/testing` reads, so that a test
sees whether a load crossed into the engine. The browser tests serve the example in Vite's `test`
mode for it, and assert it through `testMode()` of `comb/testing`; the bundle check fails a
bundle that carries it. In test mode the
engine traps on demand: `trapNextCall()` of `comb/testing` arms an export the bridge crate carries
only when built with its feature `test-mode`, and the next call of an `Engine` traps. The example's
Vite configuration hands that engine, from `packages/comb/wasm/test-mode/`, over in place of
`comb/engine.wasm` on the development server in test mode; the Bun test of the trap reads it in a
process of its own (`packages/comb/src/bridge/trap.fixture.ts`), since a trap loses the engine for
the process; and the bundle check fails an engine file that carries the export.

In test mode each example's Vite configuration also sends every response with the Content Security
Policy of Q-6, `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'`, from the development
server and from `vite preview`, so every browser test runs under it. `e2e/policy.spec.ts` records
every request and `securitypolicyviolation` while the graph loads, is panned, and is zoomed, once
on the development server and once, tagged `@built`, on the example's production build, which
`vite preview` serves; that build runs without test mode, as a host application ships it. The
three servers of a run listen on ports the system had free when it began, which
`playwright.config.ts` chooses once and hands its workers in `COMB_TEST_PORTS`, so that runs in two
worktrees at once neither collide nor test each other's tree. Two such runs also fit the Dev
Container's process limit: `devcontainer.json` raises it with `--pids-limit=8192` from Podman's
default of 2048 tasks, threads included, and one run peaks at about 1400 tasks, most of them
Chromium's. Playwright and the benchmark start headless Chromium without the displays a Dev
Container forwards, so WebGL2 runs on SwiftShader instead of PixiJS falling back to Canvas 2D.

## How it runs

**Dragging a node.** `interaction` turns the pointer delta into world units and calls
`bridge.translate`, which moves the slot in the engine's positions buffer and recomputes the
node's edges and their place in the spatial index; its first move names the slot in the store's
`dragged` (`dragStarted`), each later one bumps `movesVersion` (`dragMoved`), and the release
clears it and bumps `positionsVersion` (`dragEnded`). The store notifies the scene, which renders
once per animation frame and keeps the query it drew at the press (ADR-0027): the first frame
leaves the dragged node's edges out of the query's mesh, uploading its indices alone, and at the
far level its particle; every frame asks the engine for the mesh of the edges at the node
(`meshAt`), uploads it whole into the moving layer above the edges, and moves the node's view, or
draws its particle in the moving layer, and its edges' labels where they are now, so edges and
labels follow the node in the same frame. The release queries once. At the far level an edit of
up to 256 slots keeps the query too (ADR-0027): the scene reads from the store's arrays which
slots were added or removed, draws the added nodes' particles and edges in the moving layer,
hides the removed ones in the query's mesh by the span of their indices, and queries anew past
the bound, for a slot filled in both by another object, or for a removal that ends a drag.

**Editing.** A method of `Comb` that changes the graph runs through one function of
`api/editors.ts`, which holds the order: it refuses once the engine is lost, reads the input once,
whole, into a snapshot, refuses what the store's map shows as it stands after the read, checks the
code units of identifiers the graph would hold, and hands the snapshot to the bridge, which checks
it and has the engine add, change, or remove the items in place; the store then takes the result and
records the change, and `api`, subscribed to the store, delivers it to `onChange` as a `GraphChange`
before the call returns, and the next frame draws it. What the bridge refuses of the data becomes a
`GraphDataError`; a `SlotError`, the shell's own mistake, an `Error` naming the slot. A user's
connection and deletion, which `interaction` hands to `api/editors.ts`, are asked of their veto
there, in one place: only an identifier `canConnect` returns connects and only `true` from
`canDelete` deletes, and a veto during whose call Comb tells a change to `onChange` ends its gesture
with nothing done and no error, whatever it returned
([ADR-0024](adr/0024-edits-are-reported-as-typed-changes.md)). Then they run through the
same function, the deletion through `removeNodes` where its `Deletion` names nodes, else through
`removeEdges`, recorded as `by: "user"`, which every store action whose change may be either's
requires; a dragged node or label writes the engine alone while it moves and records `nodeMoved` or
`labelMoved` once, at release.

**Panning and zooming.** `interaction` sets the store's viewport. While the viewport stays inside
the rectangle the scene last queried, and that rectangle within the viewport grown by twice the
culling margin, at a scale within a factor of 1.25 of the one it queried at and the same level of
detail, the world moves alone; beyond that the scene renders as above, so what leaves the
viewport and its margin returns its views to the pools and what enters takes them from there. The
mesh is flattened within a quarter pixel at the current zoom, so zoomed out it has fewer points. A
resize of the canvas renders too.

**Building.** `bun run build:engine` compiles `crates/engine-wasm` with wasm-pack into
`packages/comb/wasm/` (generated, not tracked), with glue that has no default path to the engine
file (`omit-default-module-path` in its `Cargo.toml`); the library imports the glue from there,
`comb` exports the file `wasm/engine_bg.wasm` as `comb/engine.wasm`, and Vite serves the example
from source. It compiles the crate again with the feature `test-mode` into
`packages/comb/wasm/test-mode/`, for the tests, with the same glue. `bun run build:lib` bundles
the library without PixiJS into `packages/comb/dist/`, without the WebAssembly, which the host
application hands over (ADR-0019); that bundle and the engine file are what the budget of Q-3
measures, and the bundle check fails a bundle that inlines the engine.

**Loading the engine.** `createComb` settles the host application's promise, if it handed one
over, refuses what is missing, would be fetched, or is none of a `Response`, a module, and the
bytes, and passes the rest to the glue's initialiser, which compiles a `Response` while it streams
and instantiates a module or bytes. The glue instantiates once per page and returns that instance
to every later call, so a later `createComb` checks its engine but does not use it. The Bun tests
create the bridge from the bytes with `createBridgeSync`.

**Losing the engine.** The bridge passes every call of the engine through a guard: a
`WebAssembly.RuntimeError`, or the glue's refusal of an object a trapped call left borrowed, marks
the engine lost for the page and calls the listeners of `onEngineLost` once; from then on the
guard, `createComb`, and the calls of `Comb` that need the engine throw an `EngineLostError`
(ADR-0021). The frame that finds the engine lost stops rendering and resolves its waiters, and
input handlers do nothing, so no trap escapes as a page error.

**Holding the shape.** `scripts/check-all.sh` and the **Checks** workflow
(`.github/workflows/checks.yml`), on every pull request, run the template's checks (the
documentation, plan modes, traceability, and Dev Container checks, the sensors, the shell lint,
and the self-tests of the check runner and the hooks), the structural, the dependency, the
container, the overview, and the comment width checks below, each after its self-test, the
self-tests of the engine, the bundle, and the mutants checks, and `scripts/check-code.sh`, which
runs the build, the lint, the tests, and then the bundle check; the `pre-commit` and `pre-push`
hooks run `scripts/check-all.sh --changed`, as the Git hooks of CONTRIBUTING.md say.
`scripts/check-engine.sh`, which `bun run test`, `bun run dev`, and the bundle check run first,
fails when `engine_bg.wasm` of `packages/comb/wasm/` or of `packages/comb/wasm/test-mode/` is
missing or older than a file under `crates/` other than those no build reads (the list of surviving
mutants, proptest's regressions, a run of cargo-mutants, editors' swap files), `Cargo.toml`, or
`Cargo.lock`, naming the file and `bun run build:engine`. `scripts/check-structure.sh` fails when
the engine's core names or, through `Cargo.lock`, reaches a crate that touches the browser, the
clock, randomness, or I/O, when a module other than the bridge imports the WebAssembly package, when
the render layer reaches the store instead of the action-free `GraphView`, or when an example
imports past the library's entries and its engine file or imports another example (ADR-0030,
ADR-0019), and when the render
layer names PixiJS's `Text`, `HTMLText`, or `SplitText` or the edges layer a `Graphics` (ADR-0012),
and when its Canvas 2D fallback names `Graphics` outside its imports and its one field (ADR-0018);
it also fails a render file that imports from interaction by a relative path, a boundary no ADR
decides, which the check holds as its own rule and this overview describes.
`scripts/check-overview.sh` fails, naming each, where this overview holds no code span of its own
for a method or property of the `Comb` interface, an option of `CombOptions`, or a function or
constant `comb/testing` exports (ADR-0001), and where it reads no names from one of those sources.
`scripts/check-comment-width.sh` fails, naming the file and the line, on a comment line of a `.rs`
or `.ts` file git lists that is wider than 100 columns, the width Prettier holds the code to, unless
it cannot break, as a URL on a line of its own; it fails too where git lists no file of either
language. No ADR decides it; the check holds it as its own rule and this overview describes it.
`scripts/check-bundle.sh` builds the library and fails when its gzipped JavaScript and the engine
file reach the 300 kB of Q-3, when no engine file is measured, when the JavaScript inlines the
engine (ADR-0019), and when the bundle carries either seam of the bridge's test mode, each by a mark
of its own the bridge's source names once, `DETACHING_MARK` in the message of `detaching` and
`TRAP_EXPORT`, the name of the trap's export (ADR-0010, ADR-0021); it fails too when it does not
recognise each in the library built in test mode, and the trap in the engine of
`packages/comb/wasm/test-mode/`, and when that engine's generated glue differs from the production
engine's, which the example hands it over with. The benchmark and the browser test of the built
example fail where `testMode()` says the build runs the bridge in test mode.
`scripts/check-dependencies.sh` fails on a lockfile of another package manager beside `bun.lock`
(ADR-0008), on tsify's default or `json` features or `serde_json` in the bridge crate (ADR-0010), in
whatever form the entry takes, and on a listed state library other than zustand in the library's
dependency lists (ADR-0011).
`scripts/check-devcontainer.sh`, the template's, which `scripts/check-all.sh` and the **Checks**
workflow run beside `scripts/check-code.sh`, fails on a host Docker socket mounted, a Feature not
referenced by its major tag alone, or a lock that does not name the Features (ADR-0004), and on a
container that no longer mounts the host's `~/.config/gh` writable, no longer creates that source
in `initializeCommand`, or no longer runs `gh auth setup-git --force` on start
(ADR-draft-gh-login-outlives-a-rebuild).
`scripts/check-container.sh` fails where the Dev Container does not build from its Dockerfile,
where the Dockerfile names an image without a digest, or where a Feature installs Node.js
(ADR-0014), on a Feature that brings a container engine or a Compose file (ADR-0015), and where
the container does not reach the host by `--add-host=host.docker.internal:host-gateway` or does
not forward port 4173, which the benchmark on the host needs (ADR-0028); the
workflow `.github/workflows/devcontainer.yml` builds the container and asserts the pinned Bun,
Cargo with the WebAssembly target, and no Node.js inside it (ADR-0014). The type checker does the
rest for the render layer: `GraphView` has no action to call. ESLint forbids the DOM markup sinks
(Q-5) and `eval`, implied eval, and `new Function` (Q-6) in Comb's library sources, outside its
tests.
