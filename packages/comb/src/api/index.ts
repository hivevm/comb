// The public interface of Comb, which hands every field of graph data to the bridge before the
// store keeps any of it, and checks none itself (ADR-0026).
// First, before any PixiJS renderer is created: PixiJS's code generation without eval, so that Comb
// draws under a Content Security Policy without `unsafe-eval` (Q-6, ADR-0020).
import "pixi.js/unsafe-eval";
import { Application } from "pixi.js";
import {
  createBridge,
  EngineLostError,
  onEngineLost,
  refuseIfLost,
  type Bridge,
  type GraphDataProblem,
  type Rect,
} from "../bridge";
import { attachInteraction } from "../interaction";
import { clampScale, fitViewport } from "../interaction/viewport";
import { Scene } from "../render/scene";
import { engineOf, type EngineSource } from "./engine";
import {
  isUnreadable,
  listsOf,
  nodeSnapshotOf,
  patchOf,
  snapshotOf,
  type Limits,
} from "./snapshot";
import { createFrames } from "./frames";
import { drawsWith, preferenceFor } from "./renderers";
import { scenes } from "./scenes";
import {
  createGraphStore,
  type EdgeData,
  type EdgeLabelData,
  type GraphData,
  type GraphState,
  type GraphStore,
  type NodeData,
  type NodeView,
  type Selection,
  type StoreChange,
  type Viewport,
} from "../store";

export { EngineLostError } from "../bridge";
export { EngineSourceError } from "./engine";
export type { EngineSource, EngineSourceProblem } from "./engine";
export type { GraphDataProblem } from "../bridge";

/** The attributes `updateEdge` changes on an edge, as `edgeUpdated` reports them merged: its
 *  colour, arrowhead, dash pattern or none, and label or none (ADR-0023). */
interface EdgeChangePatch {
  readonly color?: number;
  readonly arrow?: "end" | "none";
  readonly dash?: readonly [number, number] | null;
  readonly label?: Readonly<EdgeLabelData> | null;
}

/** One change of the graph, by its `kind` and by who made it, `"user"` or `"host"`, as
 *  `onChange` delivers it (ADR-0023). */
export type GraphChange =
  /** `load` replaced the graph. */
  | { readonly kind: "loaded"; readonly by: "host" }
  /** `addNode` added `node`, as Comb took it. */
  | { readonly kind: "nodeAdded"; readonly by: "host"; readonly node: Readonly<NodeData> }
  /** `updateNode` changed the node `id` by `patch`, as Comb merged it. */
  | {
      readonly kind: "nodeUpdated";
      readonly by: "host";
      readonly id: string;
      readonly patch: Readonly<Partial<Pick<NodeData, "title">>>;
    }
  /** A drag left the node `id` at `x`, `y`. */
  | {
      readonly kind: "nodeMoved";
      readonly by: "user";
      readonly id: string;
      readonly x: number;
      readonly y: number;
    }
  /** The nodes `nodes` were removed, and with them the edges `edges`. */
  | {
      readonly kind: "nodesRemoved";
      readonly by: "user" | "host";
      readonly nodes: readonly string[];
      readonly edges: readonly string[];
    }
  /** The edge `edge` was added, as Comb keeps it, its defaults filled. */
  | {
      readonly kind: "edgeAdded";
      readonly by: "user" | "host";
      readonly edge: Readonly<EdgeData & Required<Pick<EdgeData, "color" | "arrow">>>;
    }
  /** `updateEdge` changed the edge `id` by `patch`, as Comb merged it. */
  | {
      readonly kind: "edgeUpdated";
      readonly by: "host";
      readonly id: string;
      readonly patch: EdgeChangePatch;
    }
  /** The edges `edges` were removed. */
  | {
      readonly kind: "edgesRemoved";
      readonly by: "user" | "host";
      readonly edges: readonly string[];
    }
  /** A drag left the label of the edge `edge` at path parameter `t` and label offset `offset`. */
  | {
      readonly kind: "labelMoved";
      readonly by: "user";
      readonly edge: string;
      readonly t: number;
      readonly offset: number;
    };

export interface CombOptions {
  /** The engine's WebAssembly, the file `comb/engine.wasm`, as the host application loads it:
   *  the `Response` of its own `fetch`, or a promise of one, a compiled `WebAssembly.Module`, or
   *  the bytes, an `ArrayBuffer` or a view on one. Required; Comb requests nothing itself
   *  (ADR-0019). Instantiated once per page: a later Comb's engine is checked, not used. */
  engine: EngineSource;
  /** The canvas background. */
  background?: number;
  /** Draw with PixiJS's Canvas 2D renderer where the browser offers no WebGL2, instead of
   *  refusing: slower, Q-1 not promised, and dash patterns drawn solid (ADR-0018). Default
   *  false. */
  allowCanvasFallback?: boolean;
}

/** Once the engine is lost for the page, `load`, `updateNode`, `addNode`, `fitView`, and
 *  `setViewport` of every Comb on it throw an `EngineLostError`, and so does `createComb`
 *  (ADR-0021). */
export interface Comb {
  /** Replaces the graph. Throws a `GraphDataError` on malformed graph data (Q-7), and an
   *  `EngineLostError` once the engine is lost. */
  load(graph: GraphData): void;
  /** Changes attributes of the node `id`; the canvas shows the change (G-5). Throws a
   *  `GraphDataError` where the graph holds no node `id`, or the patch holds a field other than
   *  `title` or a title that is not a string, and changes nothing then (Q-7), and an
   *  `EngineLostError` once the engine is lost. */
  updateNode(id: string, patch: Partial<Pick<NodeView, "title">>): void;
  /** Adds `node` with its top-left corner at `x`, `y`, without a load; the canvas draws it above
   *  every other node (G-1). Throws a `GraphDataError` where the graph holds a node `node.id`
   *  already (`duplicateNode`), where a load would refuse the node, or where the graph would pass
   *  the limits of a load, and changes nothing then (Q-7); and an `EngineLostError` once the
   *  engine is lost. */
  addNode(node: NodeData): void;
  /** Pans and zooms so the whole graph is in view. Throws an `EngineLostError` once the engine is
   *  lost. */
  fitView(): void;
  /** Pans and zooms to `viewport`: the screen position of the world origin and the scale, which
   *  is clamped to the zoom range. Throws a `RangeError` on a value that is not finite, and an
   *  `EngineLostError` once the engine is lost. */
  setViewport(viewport: Viewport): void;
  /** The current viewport. */
  viewport(): Viewport;
  /** Calls `listener` whenever the selection changes (G-5); returns the unsubscribe function. */
  onSelectionChange(listener: (selection: Selection) => void): () => void;
  /** Calls `listener` with every change of the graph, whoever made it, once the canvas holds it
   *  and before the call that made it returns, in the order made; where the change also clears
   *  the selection, before `onSelectionChange` reports it. Returns the unsubscribe function
   *  (ADR-0023). */
  onChange(listener: (change: GraphChange) => void): () => void;
  /** Calls `listener` once, with the `EngineLostError`, when the engine is lost for the page, and
   *  at once where it is lost already; returns the unsubscribe function. The page recovers only
   *  by being loaded anew (ADR-0021). */
  onEngineLost(listener: (error: EngineLostError) => void): () => void;
  /** Resolves once the canvas has drawn every change made before the call, at most one frame
   *  after the drawing; once the engine is lost, the canvas keeps its last frame and it resolves
   *  without drawing. */
  whenRendered(): Promise<void>;
  /** Removes the canvas and the listeners of `onEngineLost`; pending `whenRendered` calls
   *  resolve, later ones reject. */
  destroy(): void;
}

/** Comb found no WebGL2 to draw with, only `renderer`, PixiJS's fallback, which cannot draw the
 *  edge mesh, and the host application did not allow the Canvas 2D fallback, or PixiJS offered
 *  another renderer. */
export class RendererUnavailableError extends Error {
  constructor(readonly renderer: string) {
    super(`comb: WebGL2 is not available (PixiJS offers ${renderer})`);
    this.name = "RendererUnavailableError";
  }
}

/** Graph data Comb refused in `load`, `updateNode`, or `addNode`, with what was wrong and where: `problem`,
 *  whose `kind` tells which of the generated `GraphDataProblem`s it is. */
export class GraphDataError extends Error {
  constructor(readonly problem: GraphDataProblem) {
    super(`comb: malformed graph data (${problem.kind})`);
    this.name = "GraphDataError";
  }
}

/** The world rectangle the nodes cover, or null for an empty graph. */
function boundsOf(nodes: readonly NodeView[], positions: Float32Array): Rect | null {
  if (nodes.length === 0) return null;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  nodes.forEach((node, slot) => {
    const x = positions[slot * 2]!;
    const y = positions[slot * 2 + 1]!;
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x + node.width);
    bounds.maxY = Math.max(bounds.maxY, y + node.height);
  });
  return bounds;
}

/** Reads the host application's value into plain data with `read`, in JavaScript, before the
 *  bridge sees it; what reading throws (graph data that is not an object, nodes that are not a
 *  list, a getter that throws) refuses it as malformed. The message is Comb's own: a value the
 *  host application threw is not read. */
function readOnce<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    const message = isUnreadable(error) ? error.message : "comb: graph data could not be read";
    throw new GraphDataError({ kind: "malformed", message });
  }
}

/** The bridge's limits the snapshot cuts strings by. */
function limitsOf(bridge: Bridge): Limits {
  return { text: bridge.textLimit(), id: bridge.idLimit(), idBudget: bridge.idBudget() };
}

/** Whether `error` is a problem the bridge produced: a plain object with a `kind`. */
function isProblem(error: unknown): error is GraphDataProblem {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.getPrototypeOf(error) === Object.prototype &&
    typeof (error as { kind?: unknown }).kind === "string"
  );
}

/** Calls the bridge with plain data; what it refuses becomes a `GraphDataError`, and any other
 *  error, such as the `EngineLostError` of a trap, no problem of the data, is thrown on as an
 *  `Error`. */
function checked<T>(check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (isProblem(error)) throw new GraphDataError(error);
    throw error instanceof Error ? error : new Error("comb: the engine failed");
  }
}

/** `updateNode` on `store`: refuses a node the graph does not hold, and a patch the bridge
 *  refuses, before the store sees either. The patch is read once, into plain data, and the store
 *  merges only the fields the bridge returns as checked, so that it and its subscribers stay as
 *  they were on a refusal (Q-7). */
function updaterOf(store: GraphStore, bridge: Bridge, limits: Limits): Comb["updateNode"] {
  return (id, patch) => {
    refuseIfLost();
    if (!store.getState().slots.has(id))
      throw new GraphDataError({ kind: "unknownNode", node: id });
    const plain = readOnce(() => patchOf(patch, limits));
    store.getState().updateNode(
      id,
      checked(() => bridge.checkNodePatch(id, plain)),
    );
  };
}

/** `addNode` on `store`: reads the node once, refuses an identifier the store's map holds already
 *  and the code units of identifiers past the budget, and has the bridge check the node as a load
 *  would and add it; the store keeps it in the slot the engine chose (ADR-0022, ADR-0026). */
function adderOf(store: GraphStore, bridge: Bridge, limits: Limits): Comb["addNode"] {
  return (node) => {
    refuseIfLost();
    const { snapshot, idUnits } = readOnce(() => nodeSnapshotOf(node, limits));
    const { id } = snapshot as { id?: unknown };
    if (typeof id === "string" && store.getState().slots.has(id))
      throw new GraphDataError({ kind: "duplicateNode", node: id });
    checked(() => bridge.checkIdBudget(store.getState().idUnits + idUnits));
    const slot = checked(() => bridge.addNode(snapshot));
    // The bridge took the node, so each field holds a value of its type.
    store.getState().addNode(snapshot as unknown as NodeData, slot);
  };
}

/** The change of the graph `change` names, as `onChange` delivers it: what it carries read from
 *  `state` and, for a position, from the engine's buffer as it is now. */
function deliveryOf(change: StoreChange, state: GraphState, bridge: Bridge): GraphChange {
  switch (change.kind) {
    case "loaded":
      return { kind: change.kind, by: change.by };
    case "nodeUpdated":
      return { kind: change.kind, by: change.by, id: change.id, patch: { ...change.patch } };
    case "nodeAdded": {
      const slot = state.slots.get(change.id)!;
      const { id, title, width, height } = state.nodes[slot]!;
      const positions = bridge.positions();
      const [x, y] = [positions[slot * 2]!, positions[slot * 2 + 1]!];
      return { kind: change.kind, by: change.by, node: { id, title, x, y, width, height } };
    }
  }
}

/** `onChange` and `onSelectionChange` of one Comb, told from one subscription to `store`, so that
 *  a change of the graph reaches its listeners before the selection it cleared reaches theirs.
 *  Deliveries wait in one queue, so that a change a listener makes reaches every listener after
 *  the one being delivered, in the order made; a listener that throws keeps no other from being
 *  told, and the first error is thrown on once the queue is empty. */
function listenersOf(store: GraphStore, bridge: Bridge) {
  const changes = new Set<(change: GraphChange) => void>();
  const selections = new Set<(selection: Selection) => void>();
  const add =
    <A>(set: Set<(value: A) => void>) =>
    (listener: (value: A) => void) => {
      // A registration of its own, so that one listener registered twice is told twice.
      const registration = (value: A) => listener(value);
      set.add(registration);
      return () => void set.delete(registration);
    };
  const queue: (() => void)[] = [];
  let delivering = false;
  const tell = <A>(set: Set<(value: A) => void>, value: A) =>
    queue.push(...[...set].map((listener) => () => listener(value)));
  store.subscribe((state, previous) => {
    if (state.change !== previous.change && state.change && changes.size > 0)
      tell(changes, deliveryOf(state.change, state, bridge));
    if (state.selection !== previous.selection) tell(selections, state.selection);
    if (delivering) return;
    delivering = true;
    const failed: unknown[] = [];
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          next();
        } catch (error) {
          failed.push(error);
        }
      }
    } finally {
      delivering = false;
    }
    if (failed.length > 0) throw failed[0];
  });
  return { onChange: add(changes), onSelectionChange: add(selections) };
}

/** `load` on `store`: reads the graph data once, has the bridge check it, and hands the store only
 *  what the engine took (Q-7). */
function loaderOf(store: GraphStore, bridge: Bridge, limits: Limits): Comb["load"] {
  return (graph) => {
    refuseIfLost();
    const lists = readOnce(() => listsOf(graph));
    checked(() => bridge.checkGraphSize(lists.nodeCount, lists.edgeCount));
    const { snapshot, idUnits } = readOnce(() => snapshotOf(lists, limits));
    checked(() => bridge.checkIdBudget(idUnits));
    checked(() => bridge.loadGraph(snapshot));
    store.getState().load(snapshot);
  };
}

/** `onEngineLost` of one Comb, and the removal of its listeners, which its `destroy` calls. */
function engineLostOf(): { onEngineLost: Comb["onEngineLost"]; removeAll(): void } {
  const removers = new Set<() => void>();
  return {
    onEngineLost(listener) {
      const remove = onEngineLost(listener);
      removers.add(remove);
      return () => {
        remove();
        removers.delete(remove);
      };
    },
    removeAll() {
      removers.forEach((remove) => remove());
      removers.clear();
    },
  };
}

/** Creates a Comb canvas that fills `host`, with the engine `options.engine`. Throws an
 *  `EngineSourceError` before it touches `host` where the engine is missing, a string, `URL`, or
 *  `Request`, or none of a `Response`, a `WebAssembly.Module`, and the bytes, and a
 *  `RendererUnavailableError` where the browser offers no WebGL2, unless `allowCanvasFallback`
 *  lets it draw on Canvas 2D, and an `EngineLostError` once the engine is lost for the page. The
 *  engine is instantiated once per page: a later `createComb` checks its engine but reuses the
 *  first instance. */
export async function createComb(host: HTMLElement, options: CombOptions): Promise<Comb> {
  // A caller without types may leave the options out; that is a missing engine too.
  options ??= {} as CombOptions;
  const bridge = await createBridge(await engineOf(options.engine));
  const limits = limitsOf(bridge);
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: options.background ?? 0xf7f8fa,
    antialias: true,
    preference: preferenceFor(options),
  });
  if (!drawsWith(options, app.renderer.name)) {
    const renderer = app.renderer.name;
    app.destroy(true);
    throw new RendererUnavailableError(renderer);
  }
  host.appendChild(app.canvas);

  const store = createGraphStore();
  const scene = new Scene(app);
  const frames = createFrames(() => scene.render(store.getState(), bridge));
  const unsubscribe = store.subscribe(frames.schedule);
  // A larger canvas shows more of the world, so what is culled changes with its size.
  app.renderer.on("resize", frames.schedule);
  const detach = attachInteraction(app, store, bridge);
  const lost = engineLostOf();
  const listeners = listenersOf(store, bridge);

  const comb: Comb = {
    load: loaderOf(store, bridge, limits),
    updateNode: updaterOf(store, bridge, limits),
    addNode: adderOf(store, bridge, limits),
    fitView() {
      const bounds = boundsOf(store.getState().nodes, bridge.positions());
      if (bounds)
        store.getState().setViewport(fitViewport(bounds, app.screen.width, app.screen.height));
    },
    setViewport({ x, y, scale }) {
      refuseIfLost();
      if (![x, y, scale].every(Number.isFinite)) throw new RangeError("comb: viewport not finite");
      store.getState().setViewport({ x, y, scale: clampScale(scale) });
    },
    viewport: () => ({ ...store.getState().viewport }),
    onSelectionChange: listeners.onSelectionChange,
    onChange: listeners.onChange,
    onEngineLost: lost.onEngineLost,
    whenRendered: frames.whenRendered,
    destroy() {
      lost.removeAll();
      frames.stop();
      unsubscribe();
      app.renderer.off("resize", frames.schedule);
      detach();
      app.destroy(true, { children: true });
    },
  };
  scenes.set(comb, scene);
  return comb;
}
