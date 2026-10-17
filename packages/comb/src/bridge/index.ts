// The one module that imports the WebAssembly package (ADR-0009). Structured data crosses as
// generated types through serde-wasm-bindgen; node positions are read through a view on the
// engine's buffer, created anew on every read because growing memory detaches older views
// (ADR-0010).
import init, {
  Engine,
  edgeControlPoints,
  initSync,
  labelPosition,
  type BridgeError,
  type NodeBatch,
  type Vec2,
} from "../../wasm/engine.js";

export type { BridgeError, NodeBatch, Vec2 };

export interface Bridge {
  /** Replaces every node; slot `i` is the batch's node `i`. Throws a `BridgeError`. */
  loadNodes(batch: NodeBatch): number;
  /** Moves the nodes in `slots`. Throws a `BridgeError`. */
  translate(slots: Uint32Array, dx: number, dy: number): void;
  /** A fresh view on the positions buffer, `x, y` per slot. Do not keep it across calls. */
  positions(): Float32Array;
  /** The four control points of an edge's path, as `x, y` pairs. */
  controlPoints(source: Vec2, target: Vec2): Float32Array;
  /** Where an edge label sits (G-6). */
  labelPosition(source: Vec2, target: Vec2, t: number, offset: number): Vec2;
}

function wrap(memory: WebAssembly.Memory): Bridge {
  const engine = new Engine();
  return {
    loadNodes: (batch) => engine.loadNodes(batch),
    translate: (slots, dx, dy) => engine.translate(slots, dx, dy),
    positions: () => new Float32Array(memory.buffer, engine.positionsPtr(), engine.positionsLen()),
    controlPoints: (source, target) => edgeControlPoints(source, target),
    labelPosition: (source, target, t, offset) => labelPosition(source, target, t, offset),
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
