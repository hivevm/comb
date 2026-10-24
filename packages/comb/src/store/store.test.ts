import { describe, expect, test } from "bun:test";
import { createGraphStore, type GraphData } from ".";

const graph: GraphData = {
  nodes: [
    { id: "a", title: "A", x: 0, y: 0, width: 100, height: 40 },
    { id: "b", title: "B", x: 200, y: 0, width: 100, height: 40 },
  ],
  edges: [{ id: "a-b", source: "a", target: "b" }],
};

describe("graph store", () => {
  test("a load assigns slots in node order and keeps no coordinates", () => {
    const store = createGraphStore();
    store.getState().load(graph);
    const state = store.getState();
    expect([...state.slots]).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
    expect(state.nodes[0]).toEqual({ id: "a", title: "A", width: 100, height: 40 });
  });

  test("moving positions bumps the counter and leaves the graph untouched", () => {
    const store = createGraphStore();
    store.getState().load(graph);
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
    store.getState().load(graph);
    const before = store.getState().nodes;
    store.getState().updateNode("b", { title: "Renamed" });
    const after = store.getState().nodes;
    expect(after[0]).toBe(before[0]);
    expect(after[1]?.title).toBe("Renamed");
  });

  test("an added node takes its slot in the map and the lists, and the change names it", () => {
    // Verifies: ADR-0022, ADR-0023
    const store = createGraphStore();
    store.getState().load(graph);
    const { nodes, positionsVersion, idUnits } = store.getState();
    expect(idUnits).toBe("a".length + "b".length + "a-b".length + 2);
    expect(store.getState().change).toEqual({ kind: "loaded", by: "host" });
    store.getState().addNode({ id: "cc", title: "C", x: 5, y: 6, width: 10, height: 20 }, 2);
    const state = store.getState();
    expect(state.nodes).not.toBe(nodes);
    expect(state.nodes[2]).toEqual({ id: "cc", title: "C", width: 10, height: 20 });
    expect(state.slots.get("cc")).toBe(2);
    expect(state.idUnits).toBe(idUnits + 2);
    expect(state.positionsVersion).toBe(positionsVersion + 1);
    expect(state.change).toEqual({ kind: "nodeAdded", by: "host", id: "cc" });
    // Selecting changes nothing of the graph, so the change stays the one of the addition.
    store.getState().select({ kind: "node", id: "cc" });
    expect(store.getState().change).toBe(state.change);
  });
});

describe("graph store removals", () => {
  test("a removal leaves holes at the free slots, forgets the identifiers, and clears the selection", () => {
    // Verifies: ADR-0022, ADR-0023
    const store = createGraphStore();
    store.getState().load(graph);
    store.getState().select({ kind: "node", id: "a" });
    const { idUnits } = store.getState();
    store.getState().removeNodes([0], [0]);
    const state = store.getState();
    expect(state.nodes).toEqual([undefined, { id: "b", title: "B", width: 100, height: 40 }]);
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
    // Verifies: ADR-0022, ADR-0023
    const store = createGraphStore();
    store.getState().load(graph);
    store.getState().select({ kind: "node", id: "b" });
    const { nodes } = store.getState();
    store.getState().removeEdges([0]);
    const state = store.getState();
    expect(state.nodes).toBe(nodes);
    expect(state.edges).toEqual([undefined]);
    expect(state.selection).toEqual({ kind: "node", id: "b" });
    expect(state.change).toEqual({ kind: "edgesRemoved", by: "host", edges: ["a-b"] });
  });

  test("a removal of a node clears a selection of an edge it took along", () => {
    // Verifies: ADR-0022
    const store = createGraphStore();
    store.getState().load(graph);
    store.getState().select({ kind: "edge", id: "a-b" });
    store.getState().removeNodes([1], [0]);
    expect(store.getState().selection).toBeNull();
  });
});

describe("graph store edge edits", () => {
  test("an added edge takes its slot and counts its identifiers; a patch merges, null clears", () => {
    // Verifies: ADR-0022, ADR-0023
    const store = createGraphStore();
    store.getState().load(graph);
    const { idUnits } = store.getState();
    const edge = { id: "b-a", source: "b", target: "a", color: 1, arrow: "end" as const };
    store.getState().addEdge({ ...edge, dash: [4, 4], label: { text: "x", t: 0.5, offset: 0 } }, 1);
    expect(store.getState().edgeSlots.get("b-a")).toBe(1);
    expect(store.getState().idUnits).toBe(idUnits + 5);
    expect(store.getState().change).toEqual({ kind: "edgeAdded", by: "host", id: "b-a" });
    store.getState().updateEdge("b-a", { color: 2, dash: null, label: null });
    expect(store.getState().edges[1]).toEqual({ ...edge, color: 2 });
    expect(store.getState().change).toEqual({
      kind: "edgeUpdated",
      by: "host",
      id: "b-a",
      patch: { color: 2, dash: null, label: null },
    });
  });
});
