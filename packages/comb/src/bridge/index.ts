// The one module that imports the WebAssembly package (ADR-0009). Structured data crosses as
// generated types through serde-wasm-bindgen; node positions and the results of a viewport query
// are read through views on the engine's buffers, created anew on every read because growing
// memory detaches older views (ADR-0010).
import init, {
  DetailLevel,
  Engine,
  initSync,
  type BridgeError,
  type GraphBatch,
} from "../../wasm/engine.js";

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

/** What a viewport query found: node slots in ascending order, the edge slot and point of each
 *  found edge label, the mesh of the found edges, and the positions buffer, all read after the
 *  same call. */
export interface Visible {
  positions: Float32Array;
  nodes: Uint32Array;
  labels: Uint32Array;
  labelPoints: Float32Array;
  mesh: EdgeMesh;
}

/** The level of detail a query serves (ADR-0012): near with edge labels, middle without, far
 *  with edges as plain lines one pixel wide. */
export type Level = "near" | "middle" | "far";

const LEVELS: Record<Level, DetailLevel> = {
  near: DetailLevel.Near,
  middle: DetailLevel.Middle,
  far: DetailLevel.Far,
};

/** The edges the last query found, by slot, with the point each leaves its source and enters
 *  its target, `x, y` each. */
export interface DrawnEdges {
  slots: Uint32Array;
  ends: Float32Array;
}

export interface Bridge {
  /** Replaces the graph; node slot `i` is the batch's node `i`, edge slot `i` its edge `i`.
   *  Throws a `BridgeError`. */
  loadGraph(batch: GraphBatch): number;
  /** Moves the nodes in `slots`, their edges with them. Throws a `BridgeError`. */
  translate(slots: Uint32Array, dx: number, dy: number): void;
  /** A fresh view on the positions buffer, `x, y` per slot. Do not keep it across calls. */
  positions(): Float32Array;
  /** The nodes and edges that meet `rect` and the mesh of the edges for `level`, where a screen
   *  pixel is `pixel` world units; at the near level also the edge labels whose point lies within
   *  `labelReach` of it. Fresh views; do not keep them across calls. */
  query(rect: Rect, level: Level, pixel: number, labelReach: number): Visible;
  /** The edges the last query found, with their ends as they lie now, which after a move and
   *  before the next query are already moved: for inspection, not for drawing. Fresh views; do
   *  not keep them across calls. */
  drawnEdges(): DrawnEdges;
  /** The slot of the node drawn on top at the world point `(x, y)`, if any. */
  hit(x: number, y: number): number | undefined;
}

/** Whether the bridge runs in test mode: under `bun test`, and in Vite's `test` mode, which the
 *  browser tests serve the example in. Code that imports this source, not the built bundle, under
 *  a tool in mode `test` turns it on; a built bundle settles the mode when it is built, and a
 *  production build replaces it by `production`, so the bundle carries none of it. */
export const TEST_MODE = import.meta.env.MODE === "test" || import.meta.env.NODE_ENV === "test";

/** `bridge` with the engine's memory grown by a page before each of its calls, so that a view
 *  kept across a call is detached and reads empty in tests, not only when memory happens to grow
 *  (ADR-0010). The message of its error is how scripts/check-bundle.sh tells that a bundle
 *  carries it. */
function detaching(bridge: Bridge, memory: WebAssembly.Memory): Bridge {
  const before =
    <A extends unknown[], R>(call: (...args: A) => R) =>
    (...args: A): R => {
      try {
        memory.grow(1);
      } catch (cause) {
        throw new Error("Comb test mode: the engine's memory cannot grow further", { cause });
      }
      return call(...args);
    };
  return {
    loadGraph: before(bridge.loadGraph),
    translate: before(bridge.translate),
    positions: before(bridge.positions),
    query: before(bridge.query),
    drawnEdges: before(bridge.drawnEdges),
    hit: before(bridge.hit),
  };
}

function wrap(memory: WebAssembly.Memory): Bridge {
  const bridge = engineBridge(memory);
  return TEST_MODE ? detaching(bridge, memory) : bridge;
}

function engineBridge(memory: WebAssembly.Memory): Bridge {
  const engine = new Engine();
  const u32 = (ptr: number, len: number) => new Uint32Array(memory.buffer, ptr, len);
  const f32 = (ptr: number, len: number) => new Float32Array(memory.buffer, ptr, len);
  return {
    loadGraph: (batch) => engine.loadGraph(batch),
    translate: (slots, dx, dy) => engine.translate(slots, dx, dy),
    positions: () => f32(engine.positionsPtr(), engine.positionsLen()),
    hit: (x, y) => engine.hit(x, y),
    drawnEdges() {
      engine.drawnEdges();
      return {
        slots: u32(engine.visibleEdgesPtr(), engine.visibleEdgesLen()),
        ends: f32(engine.edgeEndsPtr(), engine.edgeEndsLen()),
      };
    },
    query(rect, level, pixel, labelReach) {
      engine.query(rect, LEVELS[level], pixel, labelReach);
      return {
        positions: f32(engine.positionsPtr(), engine.positionsLen()),
        nodes: u32(engine.visibleNodesPtr(), engine.visibleNodesLen()),
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
