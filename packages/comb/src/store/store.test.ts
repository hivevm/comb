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
});
