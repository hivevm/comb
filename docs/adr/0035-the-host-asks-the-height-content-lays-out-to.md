# ADR-0035: The host application asks Comb the height a node's content lays out to

- **Status:** 🟡 proposed
- **Date:** 2026-10-31
- **Deciders:** Markus Brigl
- **Applies to:** the `Comb` interface in `packages/comb/src/api/`, its export in `crates/engine-wasm/`, and every host application that places nodes by their height, `examples/metric-tree` among them

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

## Decision

We will give `Comb` a method `heightOf(content, width)` that returns the height, in world units,
the engine lays content of that width out to in the fonts Comb hands it, checked as `addNode`
checks content and refused with the same typed problems, changing nothing.

- It needs no node in the graph, so that a host application asks before it adds or loads.
- It is the height the engine gives a node of that content and width, the same number, so that
  a host application that places a node by it places it where Comb draws it.
- After `destroy`, and once the engine is lost, it refuses as every other method does
  (ADR-0021).

**Out of scope:** a node's width, which stays the host application's; the rectangles of the
elements; placing a node by its middle or another anchor; a layout of the graph by Comb.

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

## Sources / Prior art

- None consulted beyond the code cited above; the interrogation decides whether a host
  application's layout library (such as a layered graph layout) is a case to research before
  this is accepted.

## Consequences

- Positive: a host application places nodes by their height without copying the engine's
  numbers, and a change of a padding or a line height moves no node from where the host
  application meant it.
- Negative / trade-offs: one method more on the public interface, which the next change of the
  layout keeps; content checked twice where the host application asks and then adds.
- Follow-ups: whether the example's `HEIGHTS` and their browser tests give way to the method.

## Enforcement

A browser test of the example, citing `Verifies: ADR-0035`, adds a node of each type of the metric
tree and asserts that the drawn height equals `heightOf` of its content and width, and that
malformed content is refused with the problem `addNode` gives it.
