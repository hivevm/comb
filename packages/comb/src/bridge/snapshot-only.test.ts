// Only the snapshot of `api/snapshot.ts` reaches the bridge (ADR-0026): each call below hands the
// bridge a value the host application could have written, which may hold a getter or a Proxy,
// and must not compile; `tsc` fails on a `@ts-expect-error` that has no error to expect.
import { expect, test } from "bun:test";
import type { Bridge } from ".";
import type { GraphData } from "../store";

function handsOver(bridge: Bridge, graph: GraphData, patch: { title?: string }): void {
  // @ts-expect-error the host application's graph data is no snapshot, and its optional edge
  // colour and arrowhead would refuse it without the mark too, so the next line decides the mark
  bridge.loadGraph(graph);
  // @ts-expect-error graph data of the bridge's own shape is no snapshot either
  bridge.loadGraph({ nodes: [], edges: [] });
  // @ts-expect-error the host application's patch is no plain patch
  bridge.checkNodePatch("a", patch);
  // @ts-expect-error an object literal is no plain patch either
  bridge.checkNodePatch("a", { title: "a" });
}

test("the bridge refuses graph data and patches that are no snapshot at compile time", () => {
  // Verifies: ADR-0026
  expect(typeof handsOver).toBe("function");
});
