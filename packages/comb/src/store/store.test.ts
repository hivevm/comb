import { describe, expect, test } from "bun:test";
import {
  createGraphStore,
  type GraphData,
  type GraphState,
  type KeptGraph,
  type NodeContent,
} from ".";

/** One row of one title, `title`. */
const titled = (title: string): NodeContent => [[{ kind: "text", role: "title", text: title }]];

const graph: GraphData = {
  nodes: [
    { id: "a", x: 0, y: 0, width: 100, content: titled("A") },
    { id: "b", x: 200, y: 0, width: 100, content: titled("B") },
  ],
  edges: [{ id: "a-b", source: "a", target: "b" }],
};

/** The code units of the identifiers of `graph`, as the snapshot of its load counts them. */
const units = "a".length + "b".length + "a-b".length + "a".length + "b".length;

describe("graph store", () => {
  test("a load assigns slots in node order and keeps no coordinates", () => {
    const store = createGraphStore();
    store.getState().load(graph as KeptGraph, units);
    const state = store.getState();
    expect([...state.slots]).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
    expect(state.nodes[0]).toEqual({ id: "a", width: 100 });
  });

  test("moving positions bumps the counter and leaves the graph untouched", () => {
    const store = createGraphStore();
    store.getState().load(graph as KeptGraph, units);
    const { nodes, edges, positionsVersion } = store.getState();
    store.getState().positionsMoved();
    store.getState().positionsMoved();
    const state = store.getState();
    expect(state.positionsVersion).toBe(positionsVersion + 2);
    expect(state.nodes).toBe(nodes);
    expect(state.edges).toBe(edges);
  });

  test("an attribute change replaces only the changed node", () => {
    const store = createGraphStore();
    store.getState().load(graph as KeptGraph, units);
    const before = store.getState().nodes;
    store.getState().updateNode("b", true);
    const after = store.getState().nodes;
    expect(after[0]).toBe(before[0]);
    // A node of new content is a new object, which a view tells by identity; the engine keeps
    // the content.
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]).toEqual({ id: "b", width: 100 });
    expect(store.getState().change).toEqual({
      kind: "nodeUpdated",
      by: "host",
      id: "b",
      content: true,
    });
  });

  test("an added node takes its slot in the map and the lists, and the change names it", () => {
    // Verifies: ARCH-engine-edits-nested-graph, API-edits-report-nested-changes
    // Verifies: ARCH-graph-in-zustand-store
    const store = createGraphStore();
    store.getState().load(graph as KeptGraph, units);
    const { nodes, positionsVersion, idUnits } = store.getState();
    expect(idUnits).toBe("a".length + "b".length + "a-b".length + 2);
    expect(store.getState().change).toEqual({ kind: "loaded", by: "host" });
    store.getState().addNode({ id: "cc", x: 5, y: 6, width: 10, content: titled("C") }, 2);
    const state = store.getState();
    expect(state.nodes).not.toBe(nodes);
    expect(state.nodes[2]).toEqual({ id: "cc", width: 10 });
    expect(state.slots.get("cc")).toBe(2);
    expect(state.idUnits).toBe(idUnits + 2);
    // Its slot is the signal; no counter moves, so that a kept query survives it
    // (ARCH-graph-in-zustand-store).
    expect(state.positionsVersion).toBe(positionsVersion);
    expect(state.change).toEqual({ kind: "nodeAdded", by: "host", id: "cc" });
    // Selecting changes nothing of the graph, so the change stays the one of the addition.
    store.getState().select({ kind: "node", id: "cc" });
    expect(store.getState().change).toBe(state.change);
  });
});

describe("graph store removals", () => {
  test("a removal leaves holes at the free slots, forgets the identifiers, and clears the selection", () => {
    // Verifies: ARCH-engine-edits-nested-graph, API-edits-report-nested-changes
    const store = createGraphStore();
    store.getState().load(graph as KeptGraph, units);
    store.getState().select({ kind: "node", id: "a" });
    const { idUnits } = store.getState();
    store.getState().removeNodes([0], [0], "host");
    const state = store.getState();
    expect(state.nodes).toEqual([undefined, { id: "b", width: 100 }]);
    expect(state.edges).toEqual([undefined]);
    expect([...state.slots]).toEqual([["b", 1]]);
    expect([...state.edgeSlots]).toEqual([]);
    expect(state.idUnits).toBe(idUnits - "a".length - "a-b".length - "a".length - "b".length);
    expect(state.selection).toBeNull();
    expect(state.change).toEqual({
      kind: "nodesRemoved",
      by: "host",
      nodes: ["a"],
      edges: ["a-b"],
    });
  });

  test("a removal of edges keeps the nodes and a selection of a node", () => {
    // Verifies: ARCH-engine-edits-nested-graph, API-edits-report-nested-changes
    const store = createGraphStore();
    store.getState().load(graph as KeptGraph, units);
    store.getState().select({ kind: "node", id: "b" });
    const { nodes } = store.getState();
    store.getState().removeEdges([0], "host");
    const state = store.getState();
    expect(state.nodes).toBe(nodes);
    expect(state.edges).toEqual([undefined]);
    expect(state.selection).toEqual({ kind: "node", id: "b" });
    expect(state.change).toEqual({ kind: "edgesRemoved", by: "host", edges: ["a-b"] });
  });

  test("a removal of a node clears a selection of an edge it took along", () => {
    // Verifies: ARCH-engine-edits-nested-graph
    const store = createGraphStore();
    store.getState().load(graph as KeptGraph, units);
    store.getState().select({ kind: "edge", id: "a-b" });
    store.getState().removeNodes([1], [0], "host");
    expect(store.getState().selection).toBeNull();
  });
});

describe("graph store edge edits", () => {
  test("an added edge takes its slot and counts its identifiers; a patch merges, null clears", () => {
    // Verifies: ARCH-engine-edits-nested-graph, API-edits-report-nested-changes,
    // API-edges-dock-nodes-or-edges
    const store = createGraphStore();
    store.getState().load(graph as KeptGraph, units);
    const { idUnits } = store.getState();
    const edge = { id: "b-a", source: "b", target: "a", color: 1, arrow: "end" as const };
    const label = (id: string) => ({ id, text: "x", t: 0.5, offset: 0, background: 1 });
    store.getState().addEdge({ ...edge, dash: [4, 4], labels: [label("m")] }, 1, "host");
    expect(store.getState().edgeSlots.get("b-a")).toBe(1);
    // Its identifier, its ends', and its label's.
    expect(store.getState().idUnits).toBe(idUnits + 5 + 1);
    expect(store.getState().change).toEqual({ kind: "edgeAdded", by: "host", id: "b-a" });
    // A patch's labels replace the list whole, their identifiers counted in place of the old.
    store.getState().updateEdge("b-a", { labels: [label("no"), label("p")] });
    expect(store.getState().idUnits).toBe(idUnits + 5 + 3);
    expect(store.getState().edges[1]!.labels).toEqual([label("no"), label("p")]);
    store.getState().updateEdge("b-a", { color: 2, dash: null, labels: null });
    expect(store.getState().edges[1]).toEqual({ ...edge, color: 2 });
    expect(store.getState().idUnits).toBe(idUnits + 5);
    expect(store.getState().change).toEqual({
      kind: "edgeUpdated",
      by: "host",
      id: "b-a",
      patch: { color: 2, dash: null, labels: null },
    });
  });
});

describe("graph store counts", () => {
  test("a load keeps the code units its snapshot counted, and counts none itself", () => {
    // Verifies: API-edits-report-nested-changes
    const store = createGraphStore();
    store.getState().load(graph as KeptGraph, 99);
    expect(store.getState().idUnits).toBe(99);
  });
});

/** Each call leaves out who made the change, which the type checker refuses: `tsc` fails on a
 *  `@ts-expect-error` that has no error to expect. Never called. */
function withoutBy(state: GraphState): void {
  // @ts-expect-error a removal of nodes names who made it
  state.removeNodes([0], [0]);
  // @ts-expect-error a removal of edges names who made it
  state.removeEdges([0]);
  // @ts-expect-error an added edge names who added it
  state.addEdge(graph.edges[0]!, 1);
}

test("a store action whose change may be the user's or the host's takes who made it", () => {
  // Verifies: API-edits-report-nested-changes
  expect(typeof withoutBy).toBe("function");
});
