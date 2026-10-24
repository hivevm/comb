# Specification — Comb

> The **specification** of this project: the problem it solves, where it is going, and what has to
> be true for it to have succeeded, written in the vocabulary of [`GLOSSARY.md`](GLOSSARY.md). It
> is the **constitution**: every Architecture Decision Record in [`adr/`](adr/) derives from it and
> must not contradict it ([ADR-0001](adr/0001-agent-governance-model.md)).

## Problem

Developers who build browser applications around large node graphs (dataflow pipelines, visual
programs, dependency graphs) need an editor in which a user creates, connects, moves, and deletes
nodes and edges directly on a canvas, and which stays fluid with tens of thousands of nodes. Comb
is that editor, published as a general-purpose open-source framework. Its maintainers have no node
editor today and want one whose rendering pipeline, data model, and engine they own
end to end, instead of adopting an existing framework such as xyflow, Rete.js, or litegraph.js.

## Mission

Comb is an open-source node-editor framework, fast enough for graphs of tens of thousands of nodes
and fully under the control of those who build on it.

## Vision

When a web application needs to edit a large graph, its developers reach for Comb. Graphs that
today are split up, simplified, or shown as static pictures are edited directly.

## Strategy

Spend work only on what is visible: draw only what lies on screen, draw like elements together,
and move heavy geometry and graph computation out of the UI thread's scripting language into
compiled code. Keep the canvas to direct manipulation and leave every form to the host's HTML.
Measure first: from the first slice on, a benchmark at 10k and 50k nodes decides every performance
claim, and no optimisation lands without a number that justifies it.

## Goals / Success Criteria

Acceptance criteria a test can decide, where it helps in the form *When <trigger>, the system
shall <response>*. Each starts with a bold `G-n`, which a test cites with `Verifies: G-n`. Until
that test exists the criterion is pending work, and the traceability check lists it
([ADR-0002](adr/0002-decisions-verified-by-tests.md)). Identifiers are never reused.
Only a normalization renumbers them ([`AGENTS.md` §3](../AGENTS.md#3-adr-rules), rule 5).

1. **G-1** — When the host application adds a node, or the user drops a node from the host's
   palette onto the canvas, the system shall show the node at the given position, or at the
   world point under the drop.
2. **G-2** — When the user drags a node, the system shall move it with the pointer, and every
   edge attached to it shall follow in the same frame.
3. **G-3** — When the user drags from a connector of one node and releases over a compatible
   connector of another node, the system shall create an edge between them; released anywhere
   else, it shall create none.
4. **G-4** — When the user deletes a selected node or edge, the system shall remove it, together
   with every edge attached to a removed node.
5. **G-5** — When the user selects a node or edge, the system shall report the selection to the
   host application; when the host application changes an attribute of a node or edge, the
   canvas shall show the change.
6. **G-6** — When a node attached to an edge moves, the system shall keep each label of that edge
   at its path parameter `t` (0.0 to 1.0) plus its offset in pixels along the edge's normal at
   `t`; when the user drags a label, the system shall set `t` and the offset so that the label
   stays where it was dropped.
7. **G-7** — When the viewport changes, the system shall not draw any node, edge, or label that
   lies entirely outside the viewport grown by two culling margins.
8. **G-8** — When the user drags the empty canvas or scrolls, the system shall pan the viewport,
   or zoom it so that the world point under the pointer stays under the pointer.
9. **G-9** — When the developer starts the launch configuration *Example: metric tree* in VS Code,
   the system shall build the engine, serve an example host application, and open it in the
   browser. The example shows a metric tree that flows from left to right: bets with a hypothesis
   and a status badge, epics with a progress bar and a status badge, input metrics with values
   over three periods and coloured trends, one north-star metric, and KPIs. Dotted edges with
   arrowheads connect them, grey from bets and epics, and green or red between metrics by the
   sign of their correlation, whose value an edge label shows on a pill of the same colour. Its
   sidebar edits the selected node or edge, and a control multiplies the tree up to 50,000 nodes.
10. **G-10** — When the host application describes the content of a node as elements (text, icon,
    progress bar, badge, value with trend), the system shall draw those elements inside the node;
    node types differ only in that description, and a click on an element is reported to the host
    application.
11. **G-11** — When the host application gives an edge a colour, a dash pattern, or an arrowhead,
    or gives an edge label a background colour, the system shall draw the edge or the label that
    way.

## Quality Goals

The few properties that drive decisions, in priority order. Every ADR weighs its *Consequences*
against them. Each has a measure concrete enough to settle a disagreement and starts with a bold
`Q-n`, cited like a goal. Security goals, what the system must never do, belong here, derived
from the threats below.

The reference machine is a mid-range laptop with four cores and an integrated GPU of the class of
Intel Iris Xe or AMD Radeon 680M, running the current stable Chrome.

- **Q-1** — Interaction performance: the reason Comb exists. With 50,000 nodes and 50,000 edges
  loaded, dragging a node, panning, and zooming hold a p95 frame time of at most 16.7 ms (60 fps)
  on the reference machine, measured by the benchmark of the Strategy.
- **Q-2** — Load time: a large graph is useless if it takes long to open. Loading a graph of 50,000
  nodes and 50,000 edges until its first frame is drawn takes at most 1 s on the reference
  machine.
- **Q-3** — Embeddability: Comb is a framework for others' applications. It depends on no UI
  framework such as React or Vue, its public interface is fully typed in TypeScript, and its
  bundle of JavaScript and WebAssembly, gzipped and without PixiJS, stays under 300 kB.
- **Q-4** — Geometric accuracy: edge paths and label positions deviate by at most 0.5 px from a
  reference computation at every zoom level, for everything the viewport shows. An edge path holds
  this where every point of the path lies within 2^21 px of the viewport, and its dash pattern where
  it lies at most 2^21 px along the path from the source connector, in pixels at the current zoom.
  Past these bounds the accuracy is that of single precision: the deviation grows beyond 0.5 px by
  at most 2^-22 of the distance in pixels from the viewport of the path's farthest point, and for a
  dash by at most 2^-22 of its distance in pixels along the path. Where the mesh budget or memory
  runs short, the edge mesh may be coarsened instead, and its edge paths then deviate further: every
  edge in the viewport is still drawn while memory lasts, and the system reports the edge mesh as
  coarsened through inspection.
- **Q-5** — No injection: the system never interprets graph data as HTML, script, or URL. Labels
  are drawn as text only, and no value of the graph data creates a DOM node.
- **Q-6** — No dynamic code and no network: the system never uses `eval`, `new Function`, or a
  network request of its own, and it works under a Content Security Policy that allows
  `wasm-unsafe-eval` but not `unsafe-eval`.
- **Q-7** — Robust input: malformed graph data (a value of the wrong type, non-finite
  coordinates, an edge referring to a missing node, a duplicate identifier), and a change through
  the public interface that names a node the graph does not hold, never crash or hang the host
  page and never cause a WebAssembly panic; the system rejects each with a typed error that names
  what it refused, and keeps the graph it had. Accepted graph data within the limits of a load,
  and every change to it the system accepts, never crash or hang the host page and never cause a
  WebAssembly panic or trap, at any viewport.

## Non-Goals

What this project explicitly does not try to do.

- No input forms on the canvas: text fields, checkboxes, and every other attribute editor are the
  host application's HTML, outside the canvas.
- No execution of the graph and no persistence: what a graph means, how it runs, and where it is
  stored belong to the host application.
- No bindings for UI frameworks such as React, Vue, or Svelte in Comb itself; others may build them
  on its public interface.
- No real-time collaboration between several users editing one graph.
- No screen-reader access to the canvas content.

## Constraints

What the solution has to live with regardless of the better choice: platforms, standards,
systems to interoperate with, limits of time, budget, and team. A constraint not written here is
rediscovered as a rejected alternative in an ADR.

- The canvas is rendered in TypeScript with PixiJS on WebGL2. Its scene graph supports frustum
  culling and draws node backgrounds and edges in batches.
- Heavy geometry and graph computation runs in Rust, compiled to WebAssembly with wasm-pack.
- Structured data crosses the bridge between TypeScript and WebAssembly through
  serde-wasm-bindgen, never as JSON strings. Bulk coordinate streams (node positions while
  dragging, edge path points for drawing, culling results) cross the bridge as typed-array views
  on WebAssembly memory.
- Application state lives in a lightweight TypeScript store, such as Zustand or signals.
- Comb runs in evergreen browsers that support WebGL2 and WebAssembly.
- Development happens in a Docker-based Dev Container in VS Code, with Bun as the package
  manager, script runner, and test runner, Rust stable, and wasm-pack. Node.js runs only what
  does not yet run on Bun.
- Every runtime dependency carries a license compatible with MIT.
- One maintainer works with coding agents, without a fixed deadline.

## Threats & Forbidden Actions

The assets, the actors who threaten them, and the trust boundaries between the parts. Then what
the system must never do, regardless of what a task asks. A prohibition not written here does not
exist for an agent. One a test can decide is restated as a `Q-n`, so that it is verified.

- **Assets:** the host page that embeds Comb, with its DOM, cookies, and session; the graph data
  the host application hands over; the source and build pipeline from which Comb is built.
  Comb is not published to a package registry yet.
- **Actors and trust boundaries:** graph data comes from the host application, and often from its
  users or a server, so Comb treats it as untrusted. The bridge from TypeScript to WebAssembly is
  a second boundary, where the Rust side validates what it receives. Dependencies and the build
  pipeline form the supply-chain boundary.
- The system shall never interpret graph data as HTML, script, or URL (Q-5).
- The system shall never execute dynamically created code or make a network request of its own
  (Q-6).
- The system shall never let graph data, malformed or accepted, crash or hang the host page
  (Q-7).
- The system shall never store data in the browser, in local storage, IndexedDB, or cookies.

## Assumptions

What is believed true today and would invalidate the decisions above if it turned out false:
expected scale, the shape of the data, who operates the result, which dependency stays
maintained.

- Existing browser node editors do not stay fluid at tens of thousands of nodes. No measurement
  backs this yet; a benchmark against at least one of them would confirm or refute it.
- Developers outside the maintainers want such a framework. No user research backs this yet.
- Graphs that matter stay around 50,000 nodes and 50,000 edges; Comb is not designed for
  millions.
- Every edge connects one connector of a node to one connector of another node; there are no
  hyperedges and no edges without both ends.
- The reference machine represents the hardware of the people who use applications built on Comb.
- PixiJS, wasm-bindgen, and serde-wasm-bindgen stay maintained and keep their WebGL2 and
  WebAssembly support.
