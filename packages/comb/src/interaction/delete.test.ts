// The user's deletion of the selection (ADR-0030): allowed without a veto, refused where the veto
// changes the graph itself, and the edges the store forgets those the engine removed.
import { describe, expect, test } from "bun:test";
import { editorsOf } from "../api/editors";
import type { Bridge } from "../bridge";
import { createGraphStore } from "../store";
import { deleteSelection } from "./delete";

/** A store of nodes `a` and `b` and the edge `a-b`, with `a` selected, a bridge that names and
 *  removes edge 0 at node 0 and records the calls, and the user's deletion `api` gives through
 *  it, after `canDelete` where a test gives it. */
function selected(canDelete?: (deletion: unknown) => unknown) {
  const store = createGraphStore();
  store.getState().load(
    {
      nodes: [
        { id: "a", width: 100 },
        { id: "b", width: 100 },
      ],
      edges: [{ id: "a-b", source: "a", target: "b" }],
    },
    7,
  );
  store.getState().select({ kind: "node", id: "a" });
  const calls: string[] = [];
  const bridge = {
    edgesAt: () => Uint32Array.of(0),
    checkGraphSize: () => {},
    removeNodes: () => (calls.push("removeNodes"), Uint32Array.of(0)),
    removeEdges: () => calls.push("removeEdges"),
  } as unknown as Bridge;
  const limits = {
    text: 1000,
    id: 256,
    idBudget: 64_000_000,
    contentBudget: 1e9,
    rows: 8,
    columns: 6,
  };
  const remove = editorsOf(store, bridge, limits, { canDelete }).user.delete;
  return { store, bridge, remove, calls };
}

describe("deleting the selection", () => {
  test("without a veto, a deletion is allowed", () => {
    // Verifies: ADR-0030
    const { store, bridge, remove, calls } = selected();
    deleteSelection(store, bridge, remove);
    expect(calls).toEqual(["removeNodes"]);
    expect(store.getState().change).toEqual({
      kind: "nodesRemoved",
      by: "user",
      nodes: ["a"],
      edges: ["a-b"],
    });
  });

  test("a veto that changes the graph itself refuses the deletion", () => {
    // Verifies: ADR-0030
    const { store, bridge, remove, calls } = selected(() => {
      store.getState().updateNode("b", true);
      return true;
    });
    deleteSelection(store, bridge, remove);
    expect(calls).toEqual([]);
    expect(store.getState().slots.has("a")).toBe(true);
  });

  test("a veto that changes the selection and the viewport leaves the deletion to its answer", () => {
    // Verifies: ADR-0030
    const { store, bridge, remove, calls } = selected(() => {
      store.getState().select({ kind: "node", id: "b" });
      store.getState().setViewport({ x: 10, y: 10, scale: 2 });
      return true;
    });
    deleteSelection(store, bridge, remove);
    expect(calls).toEqual(["removeNodes"]);
    expect(store.getState().slots.has("a")).toBe(false);
  });
});
