// Only the snapshot of `api/snapshot.ts` reaches the bridge (ADR-0028): each call below hands the
// bridge a value the host application could have written, which may hold a getter or a Proxy,
// and must not compile; `tsc` fails on a `@ts-expect-error` that has no error to expect.
import { expect, test } from "bun:test";
import type { Bridge } from ".";
import type { EdgeData, EdgePatch, GraphData, NodeData } from "../store";
import type { Engine } from "../../wasm/engine.js";

/** Whether `A` and `B` are the same type. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The engine's `loadGraph` takes a load's nodes and edges as columns, strings and typed arrays its
// glue copies whole, and no `GraphBatch` and no `EdgeList` (ADR-0033): its generated parameters,
// pinned. A refused field crosses as the code of its `NodeField` or `EdgeField`, a plain number.
const columns: Same<
  Parameters<Engine["loadGraph"]>,
  [
    ids: string,
    idBounds: Uint32Array,
    titles: string,
    titleBounds: Uint32Array,
    titleTexts: Uint8Array,
    x: Float64Array,
    y: Float64Array,
    width: Float64Array,
    height: Float64Array,
    refusedAt: number | null | undefined,
    refusedField: number | null | undefined,
    edgeIds: string,
    edgeIdBounds: Uint32Array,
    sources: string,
    sourceBounds: Uint32Array,
    targets: string,
    targetBounds: Uint32Array,
    hasLabel: Uint8Array,
    labels: string,
    labelBounds: Uint32Array,
    labelTexts: Uint8Array,
    labelT: Float64Array,
    labelOffset: Float64Array,
    hasBackground: Uint8Array,
    background: Float64Array,
    color: Float64Array,
    hasDash: Uint8Array,
    dash: Float64Array,
    gap: Float64Array,
    arrow: Uint8Array,
    sourceSide: Uint8Array,
    targetSide: Uint8Array,
    edgeRefusedAt?: number | null,
    edgeRefusedField?: number | null,
  ]
> = true;

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

test("the engine takes a load's nodes and edges as columns, pinned at compile time", () => {
  // Verifies: ADR-0033
  expect(columns).toBe(true);
});
