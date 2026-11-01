# ADR-0035: The host application asks Comb the height a node's content lays out to

- **Status:** 🟡 proposed
- **Date:** 2026-10-31
- **Deciders:** Markus Brigl
- **Applies to:** the `Comb` interface in `packages/comb/src/api/`, its export in `crates/engine-wasm/`, the height the engine computes in `crates/engine/src/content.rs`, and every host application that places nodes by their height, `examples/metric-tree` among them

## Context

ADR-0013 takes a node's height from the host application: the engine computes it from the
node's content, its width, and the fonts. The host application still places each node, by the
top-left corner `NodeData` gives (`x`, `y`), and a host application that centres a node on a
point, or runs a layout algorithm of its own, needs each node's size before it places it.

The example does both: it lays the metric tree out in rows, each node with its middle on its row,
and puts a node dropped from the palette centred on the drop (G-1, G-9). It knows no height from
Comb, so `examples/metric-tree/src/graph.ts` (lines 11–12 and 64–74) copies the engine's least
height of 64 and padding of 10 (`crates/engine/src/content.rs`), the shell's line heights of 18,
16, and 14 (`packages/comb/src/render/nodes.ts`), and a badge's row of 22, and sums them per
type of node (`HEIGHTS`); `examples/metric-tree/src/main.ts:450` places a drop by it. The
example's browser tests hold `HEIGHTS` to the drawn heights, so the copy is checked there; any
other host application has no such test, and a change of a padding or a line height misplaces its
nodes without a word: copied, the numbers are a public interface nobody declared. No goal of the
specification names a node's height.

The layout libraries a host application would hand its graph to take every node's size before
they lay out: dagre requires a `width` and a `height` of each node and returns its middle; ELK
takes a size of each node and states that its algorithms estimate no text; d3-dag takes a size of
each node by its `nodeSize`. Where nodes are DOM elements, a host application renders them first
and measures them, as the React Flow example of d3-dag's documentation reads `node.measured`;
Comb draws no DOM to measure. dagre and ELK take an edge label's size as well, to keep room for
it.

Content's height does not depend on its texts or its width today: texts are truncated to their
column, never wrapped (ADR-0013), so `height` in `crates/engine/src/content.rs` sums each row's
height from the kinds of its elements and the fonts alone. A graph of 50,000 nodes (Q-1) asked
node by node would cross the bridge 50,000 times before its first load, the cost per crossing that
ADR-0034 moved a load's fields out of.

## Decision

We will give `Comb` a method `heightOf(content, width)` that returns the height, in world units,
the engine lays content of that width out to in the fonts Comb hands it, checked as `addNode`
checks content and refused with the same typed problems, changing nothing.

- It needs no node in the graph, so that a host application asks before it adds or loads.
- It is the height the engine gives a node of that content and width, the same number, so that
  a host application that places a node by it places it where Comb draws it.
- After `destroy`, and once the engine is lost, it refuses as every other method does
  (ADR-0021).
- Content whose rows hold elements of the same kinds, row by row and in the same order, has the
  same height in the same fonts, whatever its texts and its width, so that a host application asks
  once per shape of content and not once per node. A change that makes a height depend on texts or
  width, such as wrapping a text, supersedes this clause.
- It takes the width though no height depends on it yet, so that such a change keeps the method.

**Out of scope:** a node's width, which stays the host application's; the rectangles of the
elements; placing a node by its middle or another anchor; a layout of the graph by Comb; the size
of an edge label, which Comb places along its edge (G-6); a method that takes many contents at once.

## Alternatives considered

- **Keep the copy** — what the example does: no interface, and a test per host application that
  holds its copy to the drawn heights. Every host application repeats the engine's numbers.
- **The height of a node in the graph, `Comb.nodeSize(id)`** — asks after the node is added, so a
  host application adds, reads, and moves it, and Comb has no method that moves a node for the
  host application; and a layout algorithm needs every size before the first load.
- **An anchor in `NodeData`** — the host application gives the node's middle, or another point,
  and Comb places the corner. It serves centring but not a layout algorithm, and widens
  `NodeData` and the columns of a load (ADR-0034).
- **The height in the change `nodeAdded`** — the host application hears it after the node is
  drawn, too late to place it.
- **`heightsOf(contents, width)`, many contents in one crossing** — serves a layout of 50,000
  nodes asked node by node, but a host application that asks once per shape asks a handful of
  times, and a second method would duplicate the first one's checks and problems.
- **`heightOf(content)`, without the width** — exact today, but wrapping a text would change the
  method's signature, not only its result.

## Sources / Prior art

- dagre, node `width` and `height` as required input, `x` and `y` of the node's middle as output,
  and an edge label's `width` and `height` — <https://github.com/dagrejs/dagre/wiki>.
- ELK's JSON graph format: nodes, ports, and labels carry a size, and "layout algorithms
  generally don't perform any size estimation of the text" —
  <https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/jsonformat.html>;
  coordinates are relative to the parent —
  <https://eclipse.dev/elk/documentation/tooldevelopers/graphdatastructure/coordinatesystem.html>.
- elkjs, a layout returned as a `Promise`, optionally in a web worker —
  <https://github.com/kieler/elkjs>.
- d3-dag, `nodeSize` of its Sugiyama layout and a dagre-compatible interface that requires a
  positive `width` and `height` of every node, with a React Flow example that measures rendered
  nodes and converts the middle to a corner — <https://github.com/erikbrinkman/d3-dag>.
- React Flow's layouting guide: "Dagre needs to know the dimensions of each node in order to lay
  them out" — <https://reactflow.dev/learn/layouting/layouting>.
- All checked 2026-11-01. Whether ELK's `x` and `y` are a node's top-left corner was not
  confirmed from its documentation.

## Consequences

- Positive: a host application places nodes by their height without copying the engine's
  numbers, and a change of a padding or a line height moves no node from where the host
  application meant it.
- Positive: a host application hands a layout library every node's size before the first load,
  asking once per shape of content.
- Negative / trade-offs: one method more on the public interface, which the next change of the
  layout keeps; content checked twice where the host application asks and then adds.
- Negative / trade-offs: the promise that a shape of content has one height binds the layout; a
  text that wraps needs a new ADR.
- Follow-ups: whether the example's `HEIGHTS` and their browser tests give way to the method.

## Enforcement

A browser test of the example, citing `Verifies: ADR-0035`, adds a node of each type of the metric
tree and asserts that the drawn height equals `heightOf` of its content and width, that content
of the same shape with other texts and at another width has the same height, and that malformed
content is refused with the problem `addNode` gives it.
