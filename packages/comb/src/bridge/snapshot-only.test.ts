// Only the snapshot of `api/snapshot.ts` reaches the bridge (ADR-0028): each call below hands the
// bridge a value the host application could have written, which may hold a getter or a Proxy,
// and must not compile; `tsc` fails on a `@ts-expect-error` that has no error to expect.
import { expect, test } from "bun:test";
import type { Bridge } from ".";
import type { EdgeData, EdgePatch, GraphData, NodeData } from "../store";

function handsOver(
  bridge: Bridge,
  graph: GraphData,
  patch: { title?: string },
  node: NodeData,
  edge: EdgeData,
  edgePatch: EdgePatch,
): void {
  // @ts-expect-error the host application's graph data is no snapshot, and its optional edge
  // colour and arrowhead would refuse it without the mark too, so the next line decides the mark
  bridge.loadGraph(graph);
  // @ts-expect-error graph data of the bridge's own shape is no snapshot either
  bridge.loadGraph({ nodes: [], edges: [] });
  // @ts-expect-error the host application's patch is no plain patch
  bridge.checkNodePatch("a", patch);
  // @ts-expect-error an object literal is no plain patch either
  bridge.checkNodePatch("a", { title: "a" });
  // @ts-expect-error the host application's node is no snapshot of one
  bridge.addNode(node);
  // @ts-expect-error the host application's edge is no snapshot of one
  bridge.addEdge(edge, 0, 1);
  // @ts-expect-error the host application's patch of an edge is no plain patch
  bridge.updateEdge(0, "e", edgePatch);
  // @ts-expect-error an object literal is no plain patch of an edge either
  bridge.updateEdge(0, "e", { color: 0 });
}

test("the bridge refuses graph data and patches that are no snapshot at compile time", () => {
  // Verifies: ADR-0028
  expect(typeof handsOver).toBe("function");
});
