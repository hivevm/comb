// The one module that imports the WebAssembly package (ADR-0028). Structured data crosses as
// generated types through serde-wasm-bindgen; node positions and the results of a viewport query
// are read through views on the engine's buffers, created anew on every read because growing
// memory detaches older views (ADR-0010).
import init, {
  checkGraphSize,
  checkIdBudget,
  checkNodePatch,
  DetailLevel,
  idBudget,
  idLimit,
  textLimit,
  Engine,
  initSync,
  MeshDetail,
  type InitOutput,
  type CheckedPatch,
  type EdgeInput,
  type EdgePatch,
  type GraphBatch,
  type Hit,
  type GraphDataProblem,
  type NodeInput,
  type NodePatch,
  type NumberError,
  type SlotError,
} from "../../wasm/engine.js";

export type {
  CheckedPatch,
  GraphBatch,
  GraphDataProblem,
  Hit,
  NodeInput,
  NodePatch,
  NumberError,
  SlotError,
};

/** The refusal of `translate`'s delta, under the name it had before `NumberError` held it. */
export type TranslateError = NumberError;

/** The mark of plain data `api/snapshot.ts` read once from the host application's value
 *  (ADR-0028). It is exported nowhere, so that handing the bridge a value of the host
 *  application, which may hold a getter or a Proxy, takes a cast a reviewer sees. */
declare const read: unique symbol;

/** The snapshot of a load: what `snapshotOf` returns, and the graph data the bridge takes. */
export type GraphSnapshot = GraphBatch & { readonly [read]: "graph" };

/** The node of `addNode` read once: what `nodeSnapshotOf` returns, and the node the bridge takes. */
export type NodeSnapshot = NodeInput & { readonly [read]: "node" };

/** The plain patch of `updateNode`: what `patchOf` returns, and the patch the bridge takes. */
export type PlainPatch = NodePatch & { readonly [read]: "patch" };

/** The edge of `addEdge` read once: what `edgeSnapshotOf` returns, and the edge the bridge takes. */
export type EdgeSnapshot = EdgeInput & { readonly [read]: "edge" };

/** The plain patch of `updateEdge`: what `edgePatchOf` returns, and the patch the bridge takes. */
export type PlainEdgePatch = EdgePatch & { readonly [read]: "edgePatch" };

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

/** The detail of a query's edge mesh (ADR-0027): complete, or coarsened where an edge was drawn
 *  as its chord, or left out, for the mesh budget or for memory. */
export type Detail = "complete" | "coarsened";

const DETAILS: Record<MeshDetail, Detail> = {
  [MeshDetail.Complete]: "complete",
  [MeshDetail.Coarsened]: "coarsened",
};

/** What a viewport query found: node slots in ascending order, the edge slot and point of each
 *  found edge label, the mesh of the found edges and its detail, and the positions buffer, all
 *  read after the same call. The label points and the mesh's positions are relative to `origin`,
 *  a world point near the query's rectangle, so that `f32` rounds them by their distance from it
 *  (ADR-0010); the positions buffer is not. */
export interface Visible {
  positions: Float32Array;
  nodes: Uint32Array;
  labels: Uint32Array;
  labelPoints: Float32Array;
  mesh: EdgeMesh;
  detail: Detail;
  origin: { x: number; y: number };
}

/** The level of detail a query serves (ADR-0027): near with edge labels, middle without, far
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
   *  Throws a `GraphDataProblem`. */
  loadGraph(batch: GraphSnapshot): number;
  /** Checks `node` as a load checks a node and adds it, drawn and hit above every other node, and
   *  returns the slot the engine chose for it (ADR-0022). Throws a `GraphDataProblem`, the graph
   *  as it was. */
  addNode(node: NodeSnapshot): number;
  /** Checks `edge` as a load checks an edge, refuses one from a node to itself, and adds it
   *  between the node slots `source` and `target`, which `api` resolved; returns the slot the
   *  engine chose for it (ADR-0022). Throws a `GraphDataProblem`, and a `SlotError` where a slot
   *  of an end holds no node, the graph as it was. */
  addEdge(edge: EdgeSnapshot, source: number, target: number): number;
  /** Checks the patch of the edge `id` in `slot` as a load checks those fields and gives the edge
   *  its new style and label placement. Throws a `GraphDataProblem`, and a `SlotError` where
   *  `slot` holds no edge, the graph as it was. */
  updateEdge(slot: number, id: string, patch: PlainEdgePatch): void;
  /** The most UTF-16 code units of a title or a label text the bridge accepts. */
  textLimit(): number;
  /** The most UTF-16 code units of an identifier the bridge accepts. */
  idLimit(): number;
  /** The most UTF-16 code units of all identifiers of one load the bridge accepts. */
  idBudget(): number;
  /** Checks how many UTF-16 code units the identifiers of one load hold. Throws a
   *  `GraphDataProblem`. */
  checkIdBudget(units: number): void;
  /** Checks how many nodes and edges a graph holds, before any is copied. Throws a
   *  `GraphDataProblem`. */
  checkGraphSize(nodes: number, edges: number): void;
  /** Checks the patch `updateNode` hands over for the node `node`, reading it once, and returns
   *  the fields it changes; the engine keeps nothing of it. Throws a `GraphDataProblem`. */
  checkNodePatch(node: string, patch: PlainPatch): CheckedPatch;
  /** Removes the nodes in `slots` and every edge at them, and returns the slots of those edges in
   *  ascending order (ADR-0022). Throws a `SlotError`, a mistake of the shell's, never one of
   *  graph data, the graph as it was. */
  removeNodes(slots: Uint32Array): Uint32Array;
  /** Records the half width and half height of the pill of the label of the edge in `slot`, in
   *  world units, as the labels layer draws it; a label not measured is not hit (ADR-0025).
   *  Throws a `SlotError`. */
  setLabelSize(slot: number, halfWidth: number, halfHeight: number): void;
  /** The world point of the label of the edge in `slot`, or none where it holds no edge with a
   *  label. */
  labelPoint(slot: number): { x: number; y: number } | undefined;
  /** Places the label of the edge in `slot` at the world point `(x, y)`: at the path parameter
   *  nearest it and its distance along the normal there, which it returns (G-6). Throws a
   *  `SlotError`, and a `NumberError` `nonFinitePoint` for a point that is not finite, before
   *  anything moves (ADR-0031). */
  moveLabel(slot: number, x: number, y: number): { t: number; offset: number };
  /** The slots of the edges at the nodes in `slots`, in ascending order, as a removal of them
   *  would take along, named before anything is removed (ADR-0022). Throws a `SlotError`. */
  edgesAt(slots: Uint32Array): Uint32Array;
  /** Removes the edges in `slots`. Throws a `SlotError`, the graph as it was. */
  removeEdges(slots: Uint32Array): void;
  /** Moves the nodes in `slots`, their edges with them. Throws a `SlotError` for a slot that
   *  holds no node and a `NumberError` `nonFiniteDelta` for a delta that is not finite, mistakes
   *  of the shell's, never of graph data (ADR-0031). */
  translate(slots: Uint32Array, dx: number, dy: number): void;
  /** A fresh view on the positions buffer, `x, y` per slot. Do not keep it across calls. */
  positions(): Float32Array;
  /** The nodes and edges that meet `rect` and the mesh of the edges for `level`, where a screen
   *  pixel is `pixel` world units, within the engine's mesh budget, and the mesh's detail; at the
   *  near level also the edge labels whose point lies within `labelReach` of it. Fresh views; do
   *  not keep them across calls. Throws a `NumberError` `invalidPixel` for a pixel that is not a
   *  finite number above zero (ADR-0031). */
  query(rect: Rect, level: Level, pixel: number, labelReach: number): Visible;
  /** The edges the last query found, with their ends as they lie now, which after a move and
   *  before the next query are already moved: for inspection, not for drawing. Fresh views; do
   *  not keep them across calls. */
  drawnEdges(): DrawnEdges;
  /** What a press at the world point `(x, y)` hits where a screen pixel is `pixel` world units,
   *  at `level`: where `connectors` asks for them, at the near and middle level, a connector
   *  within 8 screen pixels, of the node drawn on top; else the node drawn on top there, else the
   *  edge drawn on top within 4 screen pixels of its path as the stroke flattens it, else nothing
   *  (ADR-0025). Throws a `NumberError`, `invalidPixel` for a pixel that is not a finite number
   *  above zero and `nonFinitePoint` for a point that is not finite (ADR-0031). */
  hit(x: number, y: number, pixel: number, level: Level, connectors: boolean): Hit;
}

/** Whether the bridge runs in test mode: under `bun test`, and in Vite's `test` mode, which the
 *  browser tests serve the example in. Code that imports this source, not the built bundle, under
 *  a tool in mode `test` turns it on; a built bundle settles the mode when it is built, and a
 *  production build replaces it by `production`, so the bundle carries none of it. */
export const TEST_MODE = import.meta.env.MODE === "test" || import.meta.env.NODE_ENV === "test";

/** The mark of each seam of test mode in a bundle that carries it: of `detaching`, a word of its
 *  error's message; of the trap, the name of the engine's export that arms it, which `wrap` looks
 *  up. scripts/check-bundle.sh reads both here, fails a shipped bundle that carries either, and
 *  fails unless it finds both in the library built in test mode and the trap's in the engine. */
const DETACHING_MARK = "comb-test-mode:detaching";
const TRAP_EXPORT = "comb_test_mode_trap";

/** Each call of `bridge` passed through `around`. */
function each(
  bridge: Bridge,
  around: <A extends unknown[], R>(call: (...args: A) => R) => (...args: A) => R,
): Bridge {
  const calls = Object.entries(bridge).map(([name, call]) => [name, around(call)]);
  return Object.fromEntries(calls) as Bridge;
}

/** `bridge` with the engine's memory grown by a page before each of its calls, so that a view
 *  kept across a call is detached and reads empty in tests, not only when memory happens to grow
 *  (ADR-0010). The message of its error carries `DETACHING_MARK`. */
function detaching(bridge: Bridge, memory: WebAssembly.Memory): Bridge {
  return each(bridge, (call) => (...args) => {
    try {
      memory.grow(1);
    } catch (cause) {
      throw new Error(`${DETACHING_MARK}: the engine's memory cannot grow further`, { cause });
    }
    return call(...args);
  });
}

/** The engine trapped, in a call of this Comb or of another on the page, and is lost for the
 *  page (ADR-0021): Comb refuses every later call that needs it, and only loading the page anew
 *  brings it back. `cause` is the trap. */
export class EngineLostError extends Error {
  constructor(options?: ErrorOptions) {
    super("comb: the engine trapped and is lost for the page; load the page anew", options);
    this.name = "EngineLostError";
  }
}

/** The trap that lost the engine, once it is lost. The engine is instantiated once per page, so
 *  one trap loses it for every Comb on the page. */
let trapped: { cause: unknown } | undefined;
const lostListeners = new Set<(error: EngineLostError) => void>();

/** Whether `error`, thrown from a call of the engine, is a trap: WebAssembly's own, or the glue's
 *  refusal of an object a trapped call left borrowed, which only a trap no guard saw leaves. Errors the bridge returns as values are
 *  plain objects, never traps (ADR-0010). */
function isTrap(error: unknown): boolean {
  return (
    error instanceof WebAssembly.RuntimeError ||
    (error instanceof Error && error.message.startsWith("recursive use of an object detected"))
  );
}

/** Throws an `EngineLostError` once the engine is lost. */
export function refuseIfLost(): void {
  if (trapped) throw new EngineLostError(trapped);
}

/** Marks the engine lost by the trap `cause`, tells the listeners once, and returns the error. */
function lose(cause: unknown): EngineLostError {
  if (!trapped) {
    trapped = { cause };
    // The glue frees a collected `Engine` through the instance, which is no longer safe to call.
    kept.push(...engines.flatMap((engine) => engine.deref() ?? []));
    const error = new EngineLostError(trapped);
    const listeners = [...lostListeners];
    lostListeners.clear();
    listeners.forEach((listener) => tell(listener, error));
  }
  return new EngineLostError(trapped);
}

/** Calls `listener` with `error`; what it throws is reported on its own, so that every listener
 *  is told and the call that trapped still throws the `EngineLostError`. */
function tell(listener: (error: EngineLostError) => void, error: EngineLostError): void {
  try {
    listener(error);
  } catch (thrown) {
    queueMicrotask(() => {
      throw thrown;
    });
  }
}

/** Every `Engine` the bridges created, held weakly until the engine is lost, and from then on
 *  strongly, so that none is freed through the trapped instance. */
const engines: WeakRef<Engine>[] = [];
const kept: Engine[] = [];

/** A new `Engine`, refused once the engine is lost, and marking it lost on a trap. */
function newEngine(): Engine {
  refuseIfLost();
  try {
    const engine = new Engine();
    engines.push(new WeakRef(engine));
    return engine;
  } catch (error) {
    throw isTrap(error) ? lose(error) : error;
  }
}

/** Calls `listener` once, with the `EngineLostError`, when the engine is lost, or at once where it
 *  is lost already; returns the function that removes it. */
export function onEngineLost(listener: (error: EngineLostError) => void): () => void {
  if (trapped) {
    tell(listener, new EngineLostError(trapped));
    return () => {};
  }
  // A registration of its own, so that one listener registered twice is told twice.
  const registration = (error: EngineLostError) => listener(error);
  lostListeners.add(registration);
  return () => lostListeners.delete(registration);
}

/** `bridge` refusing every call once the engine is lost, and marking it lost on a trap. */
function guarded(bridge: Bridge): Bridge {
  return each(bridge, (call) => (...args) => {
    refuseIfLost();
    try {
      return call(...args);
    } catch (error) {
      throw isTrap(error) ? lose(error) : error;
    }
  });
}

/** The engine's export that arms its trap, in test mode, where the engine carries it. */
let trapExport: (() => void) | undefined;

/** Test mode only: the next call of an `Engine` on the page traps (ADR-0021). The engine the
 *  tests run is built with the feature `test-mode` of the bridge crate, which exports the trap;
 *  the production engine carries none of it. */
export function trapNextCall(): void {
  if (!TEST_MODE) throw new Error("comb: the engine traps on demand in test mode only");
  if (!trapExport) {
    throw new Error("comb: the engine carries no trap in test mode; run `bun run build:engine`");
  }
  trapExport();
}

function wrap(exports: InitOutput): Bridge {
  const { memory } = exports;
  if (TEST_MODE) {
    const trap = (exports as unknown as Record<string, unknown>)[TRAP_EXPORT];
    trapExport = typeof trap === "function" ? (trap as () => void) : undefined;
  }
  const bridge = engineBridge(memory);
  return guarded(TEST_MODE ? detaching(bridge, memory) : bridge);
}

function engineBridge(memory: WebAssembly.Memory): Bridge {
  const engine = newEngine();
  const u32 = (ptr: number, len: number) => new Uint32Array(memory.buffer, ptr, len);
  const f32 = (ptr: number, len: number) => new Float32Array(memory.buffer, ptr, len);
  return {
    loadGraph: (batch) => engine.loadGraph(batch),
    addNode: (node) => engine.addNode(node),
    addEdge: (edge, source, target) => engine.addEdge(edge, source, target),
    updateEdge: (slot, id, patch) => engine.updateEdge(slot, id, patch),
    textLimit,
    idLimit,
    idBudget,
    checkIdBudget,
    checkGraphSize,
    checkNodePatch,
    removeNodes: (slots) => engine.removeNodes(slots),
    removeEdges: (slots) => engine.removeEdges(slots),
    edgesAt: (slots) => engine.edgesAt(slots),
    setLabelSize: (slot, halfWidth, halfHeight) => engine.setLabelSize(slot, halfWidth, halfHeight),
    labelPoint(slot) {
      const [x, y] = engine.labelPoint(slot);
      return x === undefined || y === undefined ? undefined : { x, y };
    },
    moveLabel(slot, x, y) {
      const [t, offset] = engine.moveLabel(slot, x, y);
      return { t: t!, offset: offset! };
    },
    translate: (slots, dx, dy) => engine.translate(slots, dx, dy),
    positions: () => f32(engine.positionsPtr(), engine.positionsLen()),
    hit: (x, y, pixel, level, connectors) => engine.hit(x, y, pixel, LEVELS[level], connectors),
    drawnEdges() {
      engine.drawnEdges();
      return {
        slots: u32(engine.visibleEdgesPtr(), engine.visibleEdgesLen()),
        ends: f32(engine.edgeEndsPtr(), engine.edgeEndsLen()),
      };
    },
    query(rect, level, pixel, labelReach) {
      const detail = DETAILS[engine.query(rect, LEVELS[level], pixel, labelReach)];
      // Read before the views: each is a call into the engine.
      const origin = { x: engine.originX(), y: engine.originY() };
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
        detail,
        origin,
      };
    },
  };
}

/** The top-left corner of the node in `slot`, read from the engine's buffer of positions,
 *  `bridge.positions()`. The render layer reads the buffer by index itself, as it draws every
 *  node of a frame, and makes no object per node. */
export function positionAt(positions: Float32Array, slot: number): { x: number; y: number } {
  return { x: positions[slot * 2]!, y: positions[slot * 2 + 1]! };
}

/** Loads the engine from what the host application handed over: a `Response`, which is compiled
 *  while it streams, a compiled module, or the bytes (ADR-0019). Never a string, `URL`, or
 *  `Request`, which the initialiser would fetch itself; the API refuses those before it gets here,
 *  and the type here keeps them out. */
export async function createBridge(
  engine: Response | WebAssembly.Module | BufferSource,
): Promise<Bridge> {
  refuseIfLost();
  return wrap(await init({ module_or_path: engine }));
}

/** Loads the engine from its bytes, for tests outside a browser. */
export function createBridgeSync(module: BufferSource): Bridge {
  refuseIfLost();
  return wrap(initSync({ module }));
}
