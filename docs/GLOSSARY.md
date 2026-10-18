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
- **Connector** — a point on a node where an edge starts or ends.
  _Avoid:_ port, handle, socket, pin.
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
- **Label offset** — the distance in pixels of an edge label from its path point, along the edge's
  normal there.
- **Level of detail** — how much of the graph the canvas draws at the current zoom: near draws
  nodes with their titles and edge labels, middle nodes with their titles, far nodes as plain
  boxes and edges as thin lines, without text.
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
- **Sidebar** — the host application's HTML panel, outside the canvas, in which the attributes of
  the selection are edited.
- **Slot** — the index of a node or an edge in the engine's buffers, the same on both sides of the
  bridge; a load gives node `i` and edge `i` of the graph data slot `i`.
  _Avoid:_ handle.
- **Spatial index** — the engine's uniform grid over the bounds of nodes and edges, which answers
  which slots a rectangle meets.
- **Viewport** — the part of the world that the canvas currently shows, given by pan and zoom.
