// The public interface of Comb, which hands every field of graph data to the bridge before the
// store keeps any of it, and checks none itself (ADR-0009).
// First, before any PixiJS renderer is created: PixiJS's code generation without eval, so that Comb
// draws under a Content Security Policy without `unsafe-eval` (Q-6, ADR-0020).
import "pixi.js/unsafe-eval";
import { Application } from "pixi.js";
import { createBridge, type Bridge, type GraphDataProblem, type Rect } from "../bridge";
import { attachInteraction } from "../interaction";
import { clampScale, fitViewport } from "../interaction/viewport";
import { Scene } from "../render/scene";
import { engineOf, type EngineSource } from "./engine";
import { isUnreadable, listsOf, patchOf, snapshotOf, type Limits } from "./snapshot";
import { createFrames } from "./frames";
import { drawsWith, preferenceFor } from "./renderers";
import { scenes } from "./scenes";
import {
  createGraphStore,
  type GraphData,
  type GraphStore,
  type NodeView,
  type Selection,
  type Viewport,
} from "../store";

export { EngineSourceError } from "./engine";
export type { EngineSource, EngineSourceProblem } from "./engine";
export type { GraphDataProblem } from "../bridge";

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

export interface Comb {
  /** Replaces the graph. Throws a `GraphDataError` on malformed graph data (Q-7). */
  load(graph: GraphData): void;
  /** Changes attributes of the node `id`; the canvas shows the change (G-5). Throws a
   *  `GraphDataError` where the graph holds no node `id`, or the patch holds a field other than
   *  `title` or a title that is not a string, and changes nothing then (Q-7). */
  updateNode(id: string, patch: Partial<Pick<NodeView, "title">>): void;
  /** Pans and zooms so the whole graph is in view. */
  fitView(): void;
  /** Pans and zooms to `viewport`: the screen position of the world origin and the scale, which
   *  is clamped to the zoom range. Throws a `RangeError` on a value that is not finite. */
  setViewport(viewport: Viewport): void;
  /** The current viewport. */
  viewport(): Viewport;
  /** Calls `listener` whenever the selection changes (G-5); returns the unsubscribe function. */
  onSelectionChange(listener: (selection: Selection) => void): () => void;
  /** Resolves once the canvas has drawn every change made before the call, at most one frame
   *  after the drawing. */
  whenRendered(): Promise<void>;
  /** Removes the canvas; pending `whenRendered` calls resolve, later ones reject. */
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

/** Graph data Comb refused in `load` or `updateNode`, with what was wrong and where: `problem`,
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
 *  error, such as a panic of the engine, no problem of the data, is thrown on as an `Error`. */
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
    if (!store.getState().slots.has(id))
      throw new GraphDataError({ kind: "unknownNode", node: id });
    const plain = readOnce(() => patchOf(patch, limits));
    store.getState().updateNode(
      id,
      checked(() => bridge.checkNodePatch(id, plain)),
    );
  };
}

/** Creates a Comb canvas that fills `host`, with the engine `options.engine`. Throws an
 *  `EngineSourceError` before it touches `host` where the engine is missing, a string, `URL`, or
 *  `Request`, or none of a `Response`, a `WebAssembly.Module`, and the bytes, and a
 *  `RendererUnavailableError` where the browser offers no WebGL2, unless `allowCanvasFallback`
 *  lets it draw on Canvas 2D. The engine is instantiated once per page: a later `createComb`
 *  checks its engine but reuses the first instance. */
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

  const comb: Comb = {
    load(graph) {
      const lists = readOnce(() => listsOf(graph));
      checked(() => bridge.checkGraphSize(lists.nodeCount, lists.edgeCount));
      const { snapshot, idUnits } = readOnce(() => snapshotOf(lists, limits));
      checked(() => bridge.checkIdBudget(idUnits));
      checked(() => bridge.loadGraph(snapshot));
      store.getState().load(snapshot);
    },
    updateNode: updaterOf(store, bridge, limits),
    fitView() {
      const bounds = boundsOf(store.getState().nodes, bridge.positions());
      if (bounds)
        store.getState().setViewport(fitViewport(bounds, app.screen.width, app.screen.height));
    },
    setViewport({ x, y, scale }) {
      if (![x, y, scale].every(Number.isFinite)) throw new RangeError("comb: viewport not finite");
      store.getState().setViewport({ x, y, scale: clampScale(scale) });
    },
    viewport: () => ({ ...store.getState().viewport }),
    onSelectionChange: (listener) =>
      store.subscribe((state, previous) => {
        if (state.selection !== previous.selection) listener(state.selection);
      }),
    whenRendered: frames.whenRendered,
    destroy() {
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
