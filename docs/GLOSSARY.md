# Glossary — Comb

> The **vocabulary** of this project: the terms everyone, humans and agents alike, uses in code,
> comments, documentation, and ADRs. It defines words and decides nothing. Whoever resolves a term
> adds it here in the same change ([ADR-0001](adr/0001-agent-governance-model.md)).

One term per concept, only terms specific to this domain. Say what a term *is* in one or two
sentences, and list under _Avoid:_ the synonyms it displaces, where there are any. A term the
specification, an ADR, or the code uses without an entry here is a gap to close, not a convention
to invent.

- **Arrowhead** — the triangle that marks where an edge ends, its tip at the target connector.
- **Bridge** — the boundary across which TypeScript and the engine exchange data.
- **Canvas** — the WebGL2 surface on which Comb draws, and on which the user manipulates nodes,
  edges, and edge labels.
- **Connector** — a point on a node where an edge starts or ends: the middle of one of its four
  sides.
  _Avoid:_ port, handle, socket, pin.
- **Connection** — the gesture of dragging from a connector of one node to a connector of another,
  which creates an edge where it is released over a compatible one.
- **Change** — one edit of the graph as Comb reports it to the host application, typed by its
  kind and saying whether the user or the host application made it.
- **Coarsened** — said of an edge mesh in which some edges are drawn less exactly than the
  flattening asks, or not at all, because the mesh budget or memory ran short.
- **Culling** — leaving out of the draw everything that lies entirely outside the viewport grown
  by two culling margins.
  _Avoid:_ frustum culling, outside the wording of the constraint that requires it.
- **Culling margin** — the band around the viewport, in screen pixels, within which display
  objects are bound already, so that a small pan finds them drawn; between two queries of the
  engine, what is bound may reach up to twice as far.
- **Dash pattern** — the lengths of the dashes and the gaps between them along an edge, in world
  units; an edge without one is solid.
- **Edge** — a connection drawn from a connector of one node to a connector of another.
  _Avoid:_ link, wire, connection.
- **Edge mesh** — the triangles of all edges in the viewport and its culling margin, which the
  engine computes and the canvas draws in one call.
- **Edge label** — text attached to an edge, placed by a path parameter and a label offset.
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
  nodes with their titles and edge labels, middle nodes with their titles, far nodes as plain
  boxes and edges as thin lines, without text.
- **Mesh budget** — the most vertices the edge mesh of one query may hold.
- **Node** — a box on the canvas that stands for one element of the host application's graph.
  _Avoid:_ vertex, block.
- **Node content** — the host application's description of what a node shows, as a list of
  content elements that Comb draws.
  _Avoid:_ node template, node renderer.
- **Content element** — one piece of node content: a text, an icon, a progress bar, a badge, or a
  value with its trend.
- **Palette** — the host application's HTML list of node types, from which the user drags new nodes
  onto the canvas.
- **Path parameter** — a number `t` from 0.0 to 1.0 that marks a point along an edge's path, from
  its source connector to its target connector.
- **Query origin** — the world point near a query's rectangle relative to which the query hands
  over its vertex positions and label points, and at whose screen point the shell draws the world.
- **Runner kind** — the CPU model a benchmark run records of the machine it ran on; runs are
  compared only with the baseline of their own kind.
- **Rank** — the place of a node in the order nodes are drawn and hit, kept by the engine; a load
  ranks nodes by slot, and a node added takes the highest rank.
- **Selection** — the one node or edge the user has picked on the canvas, which the sidebar edits
  and a delete removes.
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
- **Veto** — a callback of the host application that Comb asks before it makes a connection or a
  deletion of the user's, and that allows it only by returning `true`.
- **Viewport** — the part of the world that the canvas currently shows, given by pan and zoom.
