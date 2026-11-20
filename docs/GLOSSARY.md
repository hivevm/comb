# Glossary — Comb

> The **vocabulary** of this project: the terms everyone, humans and agents alike, uses in code,
> comments, documentation, and ADRs. It defines words and decides nothing. Whoever resolves a term
> adds it here in the same change ([NUC-documents-are-fixed §5](adr/NUC-documents-are-fixed.md)).

One term per concept, only terms specific to this domain. Say what a term *is* in one or two
sentences, and list under _Avoid:_ the synonyms it displaces, where there are any. A term the
specification, an ADR, or the code uses without an entry here is a gap to close, not a convention
to invent.

List each synonym under _Avoid:_ as one to three words, without prose around them. A synonym
inside a longer term of this glossary, such as "shape" in **Node shape**, is no synonym there.

- **Arrowhead** — the mark where an edge ends, its tip at the target's end: a filled triangle, two
  open strokes, or a triangle's outline around a white fill.
- **Border node** — a node attached to the outline of another node, which moves with it and
  stays on its outline, such as a pin or an entry point in UML.
- **Bridge** — the boundary across which TypeScript and the engine exchange data.
- **Canvas** — the WebGL2 surface on which Comb draws, and on which the user manipulates nodes,
  edges, and edge labels.
- **Classifier** — a class, an interface, or an abstract class of a UML class diagram, as the UML
  example shows it in one node: its stereotype, its name, and its members; it keeps its node kind
  apart from its stereotype.
- **Column** — the values of one field of every node or edge of a load, in slot order, crossing
  the bridge as one typed array, or as pieces, strings of at most 2^28 UTF-16 code units that each
  end where a value ends, with the boundaries of its values in UTF-16 code units across all
  pieces.
- **Connector** — a point on a node where an edge starts or ends: the middle of one of its four
  sides. A pin of UML is a border node, not a connector.
  _Avoid:_ port, handle, socket.
- **Connection** — the gesture of dragging from a connector of one node to a connector of another,
  or of the same node where the host application allows loops, which creates an edge where it is
  released over a compatible one.
- **Change** — one edit of the graph as Comb reports it to the host application, typed by its
  kind and saying whether the user or the host application made it.
- **Coarsened** — said of an edge mesh in which some edges are drawn less exactly than the
  flattening asks, or not at all, because the mesh budget or memory ran short.
- **Container** — a node, or a region of one, that other nodes are placed in; they are drawn above
  it and move with it.
- **Culling** — leaving out of the draw everything that lies entirely outside the viewport grown
  by two culling margins. Frustum culling is said only in the wording of the constraint that
  requires it.
  _Avoid:_ frustum culling.
- **Culling margin** — the band around the viewport, in screen pixels, within which display
  objects are bound already, so that a small pan finds them drawn; between two queries of the
  engine, what is bound may reach up to twice as far.
- **Dash pattern** — the lengths of the dashes and the gaps between them along an edge, in world
  units; an edge without one is solid.
- **Diagram element** — a node or an edge, the two things a diagram is made of, as OMG's Diagram
  Interchange names them together (`DiagramElement`); an edge label belongs to its edge. Not a
  content element, which is a piece of a node's content; "element" alone names a content element.
  _Avoid:_ figure, shape.
- **Dock** — what an end of an edge on a node docks on: the connector of one of the node's four
  sides, or its outline. An edge records one for each end on a node.
- **Edge** — a line drawn between two ends, each a node, docked at the connector of a side or on
  the node's outline, or a point of another edge at a path parameter. A connection is the gesture
  that makes one, not the edge.
  _Avoid:_ link, wire.
- **Edge mesh** — the triangles of all edges in the viewport and its culling margin, which the
  engine computes and the canvas draws in one call.
- **Edge label** — text attached to an edge, placed by a path parameter and a label offset. An edge
  carries a list of them, each named by an identifier unique within its edge.
- **Engine** — the Rust code compiled to WebAssembly that computes geometry and runs graph
  algorithms.
  _Avoid:_ core, backend.
- **Graph data** — the nodes, edges, edge labels, and their attributes as the host application
  hands them to Comb.
- **Host application** — the web application that embeds Comb and owns the meaning, persistence,
  and forms of the graph.
  _Avoid:_ client, consumer.
- **Inspection** — what tests and the benchmark read of the drawn scene through the testing entry
  `comb/testing`, which is no part of the stable public interface.
- **Label offset** — the distance in pixels of an edge label from its path point, along the edge's
  normal there.
- **Level of detail** — how much of the graph the canvas draws at the current zoom: near draws
  nodes with their whole content and edge labels, middle nodes with their titles, far nodes as
  plain boxes and edges as thin lines, without text.
- **Lightning bolt** — the zigzag across an edge's path that an edge may draw in its path's
  middle.
- **Loop** — an edge from a node back to itself.
  _Avoid:_ self-edge in prose, self-loop, reflexive edge.
- **Mesh budget** — the most vertices the edge mesh of one query may hold.
- **Moving layer** — what a drag, or an edit at the far level, draws above the edges and the
  particles while the scene keeps its query: the edges at the dragged nodes and the added edges,
  and at the far level the dragged and the added nodes' particles.
- **Node** — an item on the canvas, drawn in its node shape, that stands for one element of the
  host application's graph. A vertex is a point of the edge mesh, never a node.
  _Avoid:_ graph vertex, block.
- **Node shape** — the form, from a closed set the engine knows, in which a node is drawn and hit:
  a rectangle, a rounded rectangle, an ellipse, a circle, a ringed circle, a diamond, a bar, a
  pentagon, a notched rectangle, a note, a frame, a crossed circle, a cross, an actor, or an
  hourglass.
  It is a property of a node, not a diagram element of its own.
  _Avoid:_ shape alone, figure, symbol.
- **Node kind** — what a node of the UML example is, a class, an interface, an abstract class, a
  package, a state, an initial state, a final state, or a choice, set when the node is created and
  kept with its classifier or its state; the rules of connection ask it. The example's record of a
  classifier also carries a package of the package diagram, its members none, though UML does not
  count a package as a classifier.
- **Node content** — the host application's description of what a node shows, as a list of
  content elements that Comb draws.
  _Avoid:_ node template, node renderer.
- **Content element** — one piece of node content: a text, an icon, a progress bar, a badge, a
  value with its trend, or an action, a text whose click the host application gives a meaning.
  A progress bar is divided into *segments*, each a fraction of the bar in a colour, from its
  left; the rest of the bar is its *track*. A *metric* is a caption above a value and its
  *trend*, a text with a direction, up, down, or flat, drawn as an arrow, and a colour.
- **Outline** — the border of a node's shape, inside which the node is hit, drawn solid, dashed,
  or not at all; an edge's end that *docks on the outline* lies where the line towards the edge's
  other end crosses it, instead of at a connector.
- **Palette** — the host application's HTML list of node types, from which the user drags new nodes
  onto the canvas.
- **Path parameter** — a number `t` from 0.0 to 1.0 that marks a point along an edge's path, from
  its source end to its target end.
- **Query origin** — the world point near a query's rectangle relative to which the query hands
  over its vertex positions and label points, and at whose screen point the shell draws the world.
- **Region** — one of the parts a node is divided into, side by side or one above the other, each a
  container of its own, such as an activity partition or an orthogonal region in UML. A node so
  divided is a *divided node*; it divides `"across"`, its regions side by side, or `"down"`, one
  above the other. The *line between regions* is the line between two neighbouring regions, which
  the user drags to share their size anew. A named region draws its name in its *name band*, a
  strip along its start.
- **Resize handle** — a mark on a side or corner of a selected node that the user drags to resize
  the node.
- **Runner kind** — the CPU model a benchmark run records of the machine it ran on; runs are
  compared only with the baseline of their own kind and their graph.
- **Relationship kind** — what a relationship of a UML diagram means, one of association, directed
  association, generalization, realization, dependency, aggregation, and composition of a class or a
  package diagram, the transition and a comment's anchor of a state diagram, and the control flow,
  object flow, interrupting edge, exception handler, and anchor of an activity diagram, and the
  association, include, extend, generalization, and anchor of a use case diagram; the UML example
  tells each by the colour, dash pattern, arrowhead, and edge label of its edge.
- **Rank** — the place of a node in the order nodes are drawn and hit, kept by the engine; a load
  ranks nodes by slot, and a node added takes the highest rank.
- **Stereotype** — the guillemet-quoted word above the name of a UML element, such as «interface» or
  «package», which the UML example shows as a caption of the node's content; text the user edits,
  which never changes the node kind.
- **Selection** — the one diagram element the user has picked on the canvas, which the sidebar
  edits and a delete removes.
- **Separator** — a row of node content that holds no element and is drawn as a line across the
  node, such as the line between a UML class's attributes and its operations.
- **Shaped graph** — the graph the benchmark measures beside the metric tree, named `shaped`: the
  metric tree's nodes and edges in the same columns and order, the nodes in the node shapes in turn,
  each centred on its row and column, the rows spaced for the tallest node so that no two nodes
  overlap, every end docked on the outline, and a loop on one node in a hundred.
- **Side** — one of the four sides of a node, `top`, `right`, `bottom`, or `left`, each with one
  connector; an edge records the side it leaves and the side it enters.
- **Sidebar** — the host application's HTML panel, outside the canvas, in which the attributes of
  the selection are edited.
- **Slot** — the index of a node or an edge in the engine's buffers, the same on both sides of the
  bridge; a load gives node `i` and edge `i` of the graph data slot `i`, and an addition takes the
  free slot of its kind freed last, or a new one after the highest.
  _Avoid:_ handle.
- **Free slot** — a slot whose node or edge was removed; it holds nothing until an addition takes
  it again, and no query or hit test returns it.
- **Spatial index** — the engine's uniform grid over the bounds of nodes and edges, which answers
  which slots a rectangle meets.
- **Trap** — WebAssembly aborting a call of the engine, as when its memory runs out; after a trap
  the engine is lost for the page, and Comb refuses every later call that needs it.
- **Veto** — a callback of the host application that Comb asks before it makes a connection, a
  deletion, or a move into a container of the user's (`canConnect`, `canDelete`, `canMoveInto`); it
  allows a deletion or a move only by returning `true`, a connection only by returning the new
  edge's identifier.
- **Viewport** — the part of the world that the canvas currently shows, given by pan and zoom.
- **World limit** — how far from the world's origin the graph may lie, 2^120 world units on each
  axis: every node, its far side included, and every label offset; graph data beyond it is
  refused, and a drag stops at it.
