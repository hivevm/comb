// The user's deletion of the selection (ADR-0023): allowed without a veto, refused where the veto
// changes the graph itself, and the edges the store forgets those the engine removed.
import { describe, expect, test } from "bun:test";
import type { Bridge } from "../bridge";
import { createGraphStore } from "../store";
import { deleteSelection } from "./delete";

/** A store of nodes `a` and `b` and the edge `a-b`, with `a` selected, and a bridge that names
 *  and removes edge 0 at node 0 and records the calls. */
function selected() {
  const store = createGraphStore();
  store.getState().load({
    nodes: [
      { id: "a", title: "A", x: 0, y: 0, width: 100, height: 40 },
      { id: "b", title: "B", x: 300, y: 0, width: 100, height: 40 },
    ],
    edges: [{ id: "a-b", source: "a", target: "b" }],
  });
  store.getState().select({ kind: "node", id: "a" });
  const calls: string[] = [];
  const bridge = {
    edgesAt: () => Uint32Array.of(0),
    removeNodes: () => (calls.push("removeNodes"), Uint32Array.of(0)),
    removeEdges: () => calls.push("removeEdges"),
  } as unknown as Bridge;
  return { store, bridge, calls };
}

describe("deleting the selection", () => {
  test("without a veto, a deletion is allowed", () => {
    // Verifies: ADR-0023
    const { store, bridge, calls } = selected();
    deleteSelection(store, bridge);
    expect(calls).toEqual(["removeNodes"]);
    expect(store.getState().change).toEqual({
      kind: "nodesRemoved",
      by: "user",
      nodes: ["a"],
      edges: ["a-b"],
    });
  });

  test("a veto that changes the graph itself refuses the deletion", () => {
    // Verifies: ADR-0023
    const { store, bridge, calls } = selected();
    deleteSelection(store, bridge, () => {
      store.getState().updateNode("b", { title: "B2" });
      return true;
    });
    expect(calls).toEqual([]);
    expect(store.getState().slots.has("a")).toBe(true);
  });
});
