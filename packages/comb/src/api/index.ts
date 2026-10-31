// The public interface of Comb, which hands every field of graph data to the bridge before the
// store keeps any of it, and checks none itself (ADR-0028).
// First, before any PixiJS renderer is created: PixiJS's code generation without eval, so that Comb
// draws under a Content Security Policy without `unsafe-eval` (Q-6, ADR-0020).
import "pixi.js/unsafe-eval";
import { Application } from "pixi.js";
import {
  createBridge,
  EngineLostError,
  onEngineLost,
  positionAt,
  refuseIfLost,
  type Bridge,
  type Rect,
} from "../bridge";
import {
  attachDeletion,
  attachInteraction,
  canvasPointAt,
  type ContentClick,
  type Deletion,
  type Proposal,
} from "../interaction";
import { clampScale, fitViewport, toWorld } from "../store/viewport";
import { Scene } from "../render/scene";
import { fontMetricsOf } from "../render/nodes";
import { contentClicksOf, listenersOf, type GraphChange } from "./changes";
import { engineOf, type EngineSource } from "./engine";
import { iconOf } from "./icons";
import { editorsOf } from "./editors";
import type { Limits } from "./snapshot";
import { createFrames } from "./frames";
import { drawsWith, preferenceFor } from "./renderers";
import { scenes } from "./scenes";
import {
  createGraphStore,
  type EdgeData,
  type EdgePatch,
  type GraphData,
  type GraphStore,
  type NodeData,
  type NodePatch,
  type NodeView,
  type Selection,
  type Viewport,
} from "../store";

export { EngineLostError } from "../bridge";
export { GraphDataError } from "./editors";
export { EngineSourceError } from "./engine";
export { IconError } from "./icons";
export type { IconProblem } from "./icons";
export type { GraphChange } from "./changes";
export type { EngineSource, EngineSourceProblem } from "./engine";
export type { GraphDataProblem } from "../bridge";
export type { ContentClick, Deletion, Proposal } from "../interaction";

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
  /** The veto of a deletion of the user's: called with the identifiers of every node and edge
   *  that would go, the edges at a node among them, before anything is removed, when the user
   *  presses Delete or Backspace on the focused canvas. Comb deletes only where it returns
   *  `true`; an error it throws refuses the deletion and is thrown on from the key's event.
   *  Never called for the host application's own calls. Without it, a deletion is allowed. One
   *  during whose call Comb tells a change to `onChange` deletes nothing, whatever it returns
   *  (ADR-0030). */
  canDelete?: (deletion: Deletion) => boolean;
  /** The veto of a connection of the user's (G-3): called when the user releases a connection
   *  over a compatible connector of another node, with the identifiers of both nodes and the sides
   *  of both connectors. It returns the identifier of the new edge, which is checked as `addEdge`
   *  checks one, or `false` to refuse; any other value refuses as `false` does. An error it
   *  throws, or one of the identifier it returns, refuses the connection and is thrown on from the
   *  input event. Never called for the host application's own calls. Without it, no connection
   *  begins: Comb has no name to give the edge. One during whose call Comb tells a change to
   *  `onChange` connects nothing, whatever it returns, and its identifier is neither checked nor
   *  thrown (ADR-0030). */
  canConnect?: (proposal: Proposal) => string | false;
}

/** Once the engine is lost for the page, `load`, `updateNode`, `addNode`, `addEdge`, `updateEdge`,
 *  `removeNodes`, `removeEdges`, `fitView`, and `setViewport` of every Comb on it throw an
 *  `EngineLostError`, and so does `createComb` (ADR-0021). */
export interface Comb {
  /** Replaces the graph. Throws a `GraphDataError` on malformed graph data (Q-7), and an
   *  `EngineLostError` once the engine is lost. */
  load(graph: GraphData): void;
  /** Replaces the content of the node `id` whole; the canvas shows it, the node as high as its
   *  new rows (G-5, ADR-0013). Throws a `GraphDataError` where the graph holds no node `id`, or the
   *  patch holds a field other than `content` or content a load would refuse, and changes nothing
   *  then (Q-7), and an `EngineLostError` once the engine is lost. */
  updateNode(id: string, patch: NodePatch): void;
  /** Adds `node` with its top-left corner at `x`, `y`, without a load; the canvas draws it above
   *  every other node (G-1). Throws a `GraphDataError` where the graph holds a node `node.id`
   *  already (`duplicateNode`), where a load would refuse the node, or where the graph would pass
   *  the limits of a load, and changes nothing then (Q-7); and an `EngineLostError` once the
   *  engine is lost. */
  addNode(node: NodeData): void;
  /** Adds `edge` between two nodes the graph holds, without a load, drawn with its colour, dash
   *  pattern, arrowhead, and label (G-11). Throws a `GraphDataError` where the graph holds an edge
   *  `edge.id` already (`duplicateEdge`) or no node at one of its ends (`missingNode`), where the
   *  edge runs from a node to itself (`selfEdge`), where a load would refuse it, or where the
   *  graph would pass the limits of a load, and changes nothing then (Q-7); and an
   *  `EngineLostError` once the engine is lost. */
  addEdge(edge: EdgeData): void;
  /** Changes the colour, dash pattern, arrowhead, or label of the edge `id`, a dash or a label
   *  cleared with `null`; the canvas shows the change (G-5). Throws a `GraphDataError` where the
   *  graph holds no edge `id` (`unknownEdge`), the patch holds another field
   *  (`unknownEdgePatchField`), or a load would refuse a field of it, and changes nothing then
   *  (Q-7); and an `EngineLostError` once the engine is lost. */
  updateEdge(id: string, patch: EdgePatch): void;
  /** Removes the nodes `ids` and every edge at them, without a load (G-4). Throws a
   *  `GraphDataError` where the graph holds no node of one of them (`unknownNode`), or `ids` is no
   *  list of strings, and removes nothing then (Q-7); and an `EngineLostError` once the engine is
   *  lost. */
  removeNodes(ids: readonly string[]): void;
  /** Removes the edges `ids`, as `removeNodes` removes nodes, with `unknownEdge` for an edge the
   *  graph does not hold. */
  removeEdges(ids: readonly string[]): void;
  /** Pans and zooms so the whole graph is in view. Throws an `EngineLostError` once the engine is
   *  lost. */
  fitView(): void;
  /** Pans and zooms to `viewport`: the screen position of the world origin and the scale, which
   *  is clamped to the zoom range. Throws a `RangeError` on a value that is not finite, and an
   *  `EngineLostError` once the engine is lost. */
  setViewport(viewport: Viewport): void;
  /** The current viewport. */
  viewport(): Viewport;
  /** The world point under the point (`clientX`, `clientY`) of the page, in the client
   *  coordinates of a pointer or drop event, for a node dropped from the host's palette (G-1).
   *  Throws a `RangeError` on a coordinate that is not finite; needs no engine, so it keeps
   *  answering once the engine is lost (ADR-0030). */
  worldPointAt(clientX: number, clientY: number): { x: number; y: number };
  /** Calls `listener` whenever the selection changes (G-5); returns the unsubscribe function. */
  onSelectionChange(listener: (selection: Selection) => void): () => void;
  /** Calls `listener` with every change of the graph, whoever made it, once the canvas holds it
   *  and before the call that made it returns, in the order made; where the change also clears
   *  the selection, before `onSelectionChange` reports it. Returns the unsubscribe function
   *  (ADR-0030). */
  onChange(listener: (change: GraphChange) => void): () => void;
  /** Calls `listener` when the user clicks an element of a node's content: presses on it and
   *  releases within 4 screen pixels of the press, which selects the node, after
   *  `onSelectionChange` reports that. It hears the node's identifier, the element's row and
   *  column, its kind, and for an action its identifier. An element is clicked only where it is
   *  drawn: at the near level every element, at the middle level the texts of role title, at the
   *  far level none; a press that moves further drags the node and clicks nothing. Returns the
   *  unsubscribe function (ADR-0013). */
  onContentClick(listener: (click: ContentClick) => void): () => void;
  /** Registers `image`, an image the host application has loaded, an `ImageBitmap`, an
   *  `HTMLImageElement` that has loaded, or a canvas, as the icon `name`: every icon element that
   *  names it is drawn as it at the near level, fitted into its square with its aspect kept, from
   *  the next frame on and without a load. An icon element whose name none registers draws
   *  nothing, and is no error. Registering a name again draws the new image wherever the old one
   *  was drawn, and releases the old one's texture; Comb never changes `image` itself. Throws an
   *  `IconError` where `name` is no string, holds a lone surrogate, or is longer than a text of
   *  content, or where `image` is a string, `URL`, or `Request`, which Comb never fetches (Q-6),
   *  is none of the three, or has not loaded; and registers nothing then. Needs no engine, so it
   *  keeps working once the engine is lost (ADR-0013). */
  registerIcon(name: string, image: ImageBitmap | HTMLImageElement | HTMLCanvasElement): void;
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

/** The world rectangle the nodes cover, each as high as `sizes` holds, or null for a graph
 *  without nodes; a free slot covers nothing. */
function boundsOf(
  nodes: readonly (NodeView | undefined)[],
  { positions, sizes }: { positions: Float32Array; sizes: Float32Array },
): Rect | null {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let any = false;
  nodes.forEach((node, slot) => {
    if (!node) return;
    any = true;
    const { x, y } = positionAt(positions, slot);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x + node.width);
    bounds.maxY = Math.max(bounds.maxY, y + sizes[slot * 2 + 1]!);
  });
  return any ? bounds : null;
}

/** The bridge's limits the snapshot cuts strings and content by. */
function limitsOf(bridge: Bridge): Limits {
  return {
    text: bridge.textLimit(),
    id: bridge.idLimit(),
    idBudget: bridge.idBudget(),
    contentBudget: bridge.contentBudget(),
    rows: bridge.rowLimit(),
    columns: bridge.columnLimit(),
    segments: bridge.segmentLimit(),
  };
}

/** `worldPointAt` on `store` and the canvas of `app`: the world point under a point of the page,
 *  from the canvas's place in it and the viewport, without the engine. */
function worldPointerOf(store: GraphStore, app: Application): Comb["worldPointAt"] {
  // The canvas and the screen kept, so that the point is answered after `destroy` too.
  const { canvas, screen } = app;
  return (clientX, clientY) => {
    if (![clientX, clientY].every(Number.isFinite)) throw new RangeError("comb: point not finite");
    const at = canvasPointAt(canvas, screen, clientX, clientY);
    return toWorld(store.getState().viewport, at.x, at.y);
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

/** The PixiJS application of a canvas that fills `host`, in `options.background`; throws a
 *  `RendererUnavailableError` where it draws with a renderer `options` do not allow. */
async function applicationOf(host: HTMLElement, options: CombOptions): Promise<Application> {
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
  return app;
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
  // Read at once, as the engine is created: once the canvas is in the host element, nothing may
  // refuse, and a trap of another Comb's on the page would refuse these calls.
  const limits = limitsOf(bridge);
  // The metrics of the fonts the texts are drawn with, once, before the first layout (ADR-0013).
  for (const role of ["title", "body", "caption"] as const)
    bridge.setFont(role, fontMetricsOf(role));
  const app = await applicationOf(host, options);
  host.appendChild(app.canvas);

  const store = createGraphStore();
  const scene = new Scene(app);
  const { host: edits, user } = editorsOf(store, bridge, limits, options);
  // Interaction subscribes before the listeners, and the frames read the store only on the next
  // frame, so that a gesture a change takes, a connection among them, is over before anything
  // reads the store after that change.
  const clicks = contentClicksOf();
  const interaction = attachInteraction(app, store, bridge, user.connect, clicks.tell);
  const frames = createFrames(() => scene.render(store.getState(), bridge, interaction.pointer));
  const unsubscribe = store.subscribe(frames.schedule);
  // A larger canvas shows more of the world, so what is culled changes with its size.
  app.renderer.on("resize", frames.schedule);
  const detachDeletion = attachDeletion(app.canvas, store, bridge, user.delete);
  const lost = engineLostOf();
  const listeners = listenersOf(store, bridge);

  const comb: Comb = {
    ...edits,
    fitView() {
      const bounds = boundsOf(store.getState().nodes, bridge.nodeBuffers());
      if (bounds)
        store.getState().setViewport(fitViewport(bounds, app.screen.width, app.screen.height));
    },
    setViewport({ x, y, scale }) {
      refuseIfLost();
      if (![x, y, scale].every(Number.isFinite)) throw new RangeError("comb: viewport not finite");
      store.getState().setViewport({ x, y, scale: clampScale(scale) });
    },
    viewport: () => ({ ...store.getState().viewport }),
    worldPointAt: worldPointerOf(store, app),
    onSelectionChange: listeners.onSelectionChange,
    onChange: listeners.onChange,
    onContentClick: clicks.onContentClick,
    registerIcon(name, image) {
      scene.registerIcon(name, iconOf(name, image, limits.text));
      frames.schedule();
    },
    onEngineLost: lost.onEngineLost,
    whenRendered: frames.whenRendered,
    destroy() {
      lost.removeAll();
      frames.stop();
      unsubscribe();
      app.renderer.off("resize", frames.schedule);
      interaction.detach();
      detachDeletion();
      app.destroy(true, { children: true });
      scene.icons.destroy();
    },
  };
  scenes.set(comb, { scene, hitAt: interaction.hitAt });
  return comb;
}
