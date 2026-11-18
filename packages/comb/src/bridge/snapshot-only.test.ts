// Only the snapshot of `api/snapshot.ts` reaches the bridge (ARCH-one-workspace-per-example): each
// call below hands the bridge a value the host application could have written, which may hold a
// getter or a Proxy, and must not compile; `tsc` fails on a `@ts-expect-error` that has no error to
// expect.
import { expect, test } from "bun:test";
import type { Bridge } from ".";
import type { EdgeData, EdgePatch, GraphData, NodeData, NodePatch } from "../store";
import type { Engine } from "../../wasm/engine.js";

/** Whether `A` and `B` are the same type. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// The engine's `loadGraph` takes a load's nodes and edges as columns, strings in pieces and typed
// arrays its glue copies whole, or plain arrays of numbers, which the glue of wasm-bindgen 0.2.130
// takes as well, and no `GraphBatch` and no `EdgeList` (API-bridge-takes-serde-and-columns): its
// generated parameters, pinned, the column of node shapes, the columns of nesting
// (API-bridge-columns-carry-nesting), the height a node's data gives with its byte of presence,
// whether it is resizable, the division of each node and the columns of the regions, the columns of
// border nodes (ARCH-border-nodes-ride-sides), the outlines (REN-node-shapes-cover-uml), and the
// content columns of `text`, `action`, `badge`, `progress`, and `metric` and the separators of rows
// among them and no title
// column. A refused field crosses as the code of its `NodeField` or `EdgeField`, a plain number,
// and a shape of content with its row and column.
const columns: Same<
  Parameters<Engine["loadGraph"]>,
  [
    ids: string[],
    idBounds: Uint32Array | number[],
    x: Float64Array | number[],
    y: Float64Array | number[],
    width: Float64Array | number[],
    hasHeight: Uint8Array | number[],
    height: Float64Array | number[],
    shape: Uint8Array | number[],
    outline: Uint8Array | number[],
    outlineDash: Float64Array | number[],
    outlineGap: Float64Array | number[],
    hasContainer: Uint8Array | number[],
    container: Uint32Array | number[],
    isContainer: Uint8Array | number[],
    resizable: Uint8Array | number[],
    divide: Uint8Array | number[],
    regionIds: string[],
    regionIdBounds: Uint32Array | number[],
    regionOf: Uint32Array | number[],
    regionSize: Float64Array | number[],
    regionDivide: Uint8Array | number[],
    regionHasDash: Uint8Array | number[],
    regionDash: Float64Array | number[],
    regionGap: Float64Array | number[],
    regionNamed: Uint8Array | number[],
    regionNames: string[],
    regionNameBounds: Uint32Array | number[],
    hasAttached: Uint8Array | number[],
    attached: Uint32Array | number[],
    side: Uint8Array | number[],
    offset: Float64Array | number[],
    beside: Uint8Array | number[],
    attachedMissing: string | null | undefined,
    rowBounds: Uint32Array | number[],
    elementBounds: Uint32Array | number[],
    separators: Uint8Array | number[],
    kinds: Uint8Array | number[],
    weights: Float64Array | number[],
    roles: Uint8Array | number[],
    directions: Uint8Array | number[],
    colors: Float64Array | number[],
    segmentBounds: Uint32Array | number[],
    fractions: Float64Array | number[],
    segmentColors: Float64Array | number[],
    texts: string[],
    textBounds: Uint32Array | number[],
    textValid: Uint8Array | number[],
    names: string[],
    nameBounds: Uint32Array | number[],
    nameValid: Uint8Array | number[],
    refusedAt: number | null | undefined,
    refusedField: number | null | undefined,
    refusedRow: number | null | undefined,
    refusedColumn: number | null | undefined,
    edgeIds: string[],
    edgeIdBounds: Uint32Array | number[],
    sources: string[],
    sourceBounds: Uint32Array | number[],
    targets: string[],
    targetBounds: Uint32Array | number[],
    hasLabel: Uint8Array | number[],
    labels: string[],
    labelBounds: Uint32Array | number[],
    labelTexts: Uint8Array | number[],
    labelT: Float64Array | number[],
    labelOffset: Float64Array | number[],
    hasBackground: Uint8Array | number[],
    background: Float64Array | number[],
    color: Float64Array | number[],
    hasDash: Uint8Array | number[],
    dash: Float64Array | number[],
    gap: Float64Array | number[],
    arrow: Uint8Array | number[],
    sourceSide: Uint8Array | number[],
    targetSide: Uint8Array | number[],
    edgeRefusedAt?: number | null,
    edgeRefusedField?: number | null,
  ]
> = true;

function handsOver(
  bridge: Bridge,
  graph: GraphData,
  patch: NodePatch,
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
  bridge.updateNode(0, "a", patch);
  // @ts-expect-error an object literal is no plain patch either
  bridge.updateNode(0, "a", { content: [] });
  // @ts-expect-error the host application's node is no snapshot of one
  bridge.addNode(node);
  // @ts-expect-error the host application's edge is no snapshot of one
  bridge.addEdge(edge, 0, 1, false);
  // @ts-expect-error the host application's patch of an edge is no plain patch
  bridge.updateEdge(0, "e", edgePatch);
  // @ts-expect-error an object literal is no plain patch of an edge either
  bridge.updateEdge(0, "e", { color: 0 });
}

test("the bridge refuses graph data and patches that are no snapshot at compile time", () => {
  // Verifies: ARCH-one-workspace-per-example
  expect(typeof handsOver).toBe("function");
});

test("the engine takes a load's nodes and edges as columns, pinned at compile time", () => {
  // Verifies: API-bridge-takes-serde-and-columns
  // The type of a title column among them would make `columns` false, which no `true` is
  // assignable to.
  expect(columns).toBe(true);
});
