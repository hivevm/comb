// The one module that imports the WebAssembly package (ADR-0009). Structured data crosses as
// generated types through serde-wasm-bindgen; node positions and the results of a viewport query
// are read through views on the engine's buffers, created anew on every read because growing
// memory detaches older views (ADR-0010).
import init, { Engine, initSync, type BridgeError, type GraphBatch } from "../../wasm/engine.js";

export type { BridgeError, GraphBatch };

/** A rectangle in world coordinates. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The triangles of the found edges: per vertex its position `x, y`, its distance along its
 *  path, its colour as RGBA bytes, and its dash pattern `dash, gap` (0, 0 for solid); three
 *  vertex indices per triangle. */
export interface EdgeMesh {
  positions: Float32Array;
  distances: Float32Array;
  colors: Uint32Array;
  dashes: Float32Array;
  indices: Uint32Array;
}

/** What a viewport query found: node and edge slots in ascending order, the four control points
 *  of each found edge as `x, y` pairs, the edge slot and point of each found edge label, the
 *  mesh of the found edges, and the positions buffer, all read after the same call. */
export interface Visible {
  positions: Float32Array;
  nodes: Uint32Array;
  edges: Uint32Array;
  edgePoints: Float32Array;
  labels: Uint32Array;
  labelPoints: Float32Array;
  mesh: EdgeMesh;
}

export interface Bridge {
  /** Replaces the graph; node slot `i` is the batch's node `i`, edge slot `i` its edge `i`.
   *  Throws a `BridgeError`. */
  loadGraph(batch: GraphBatch): number;
  /** Moves the nodes in `slots`, their edges with them. Throws a `BridgeError`. */
  translate(slots: Uint32Array, dx: number, dy: number): void;
  /** A fresh view on the positions buffer, `x, y` per slot. Do not keep it across calls. */
  positions(): Float32Array;
  /** The nodes and edges that meet `rect`, the edge labels whose point lies within
   *  `labelReach` of it, and the mesh of the edges, flattened within `tolerance` world units, as
   *  fresh views. Do not keep them across calls. */
  query(rect: Rect, labelReach: number, tolerance: number): Visible;
}

function wrap(memory: WebAssembly.Memory): Bridge {
  const engine = new Engine();
  const u32 = (ptr: number, len: number) => new Uint32Array(memory.buffer, ptr, len);
  const f32 = (ptr: number, len: number) => new Float32Array(memory.buffer, ptr, len);
  return {
    loadGraph: (batch) => engine.loadGraph(batch),
    translate: (slots, dx, dy) => engine.translate(slots, dx, dy),
    positions: () => f32(engine.positionsPtr(), engine.positionsLen()),
    query(rect, labelReach, tolerance) {
      engine.query(rect.minX, rect.minY, rect.maxX, rect.maxY, labelReach, tolerance);
      return {
        positions: f32(engine.positionsPtr(), engine.positionsLen()),
        nodes: u32(engine.visibleNodesPtr(), engine.visibleNodesLen()),
        edges: u32(engine.visibleEdgesPtr(), engine.visibleEdgesLen()),
        edgePoints: f32(engine.edgePointsPtr(), engine.edgePointsLen()),
        labels: u32(engine.visibleLabelsPtr(), engine.visibleLabelsLen()),
        labelPoints: f32(engine.labelPointsPtr(), engine.labelPointsLen()),
        mesh: {
          positions: f32(engine.meshPositionsPtr(), engine.meshPositionsLen()),
          distances: f32(engine.meshDistancesPtr(), engine.meshDistancesLen()),
          colors: u32(engine.meshColorsPtr(), engine.meshColorsLen()),
          dashes: f32(engine.meshDashesPtr(), engine.meshDashesLen()),
          indices: u32(engine.meshIndicesPtr(), engine.meshIndicesLen()),
        },
      };
    },
  };
}

/** Loads the engine in a browser, from the module next to this package's build. */
export async function createBridge(): Promise<Bridge> {
  const { memory } = await init();
  return wrap(memory);
}

/** Loads the engine from its bytes, for tests outside a browser. */
export function createBridgeSync(module: BufferSource): Bridge {
  const { memory } = initSync({ module });
  return wrap(memory);
}
