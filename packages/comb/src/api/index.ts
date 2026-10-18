// The public interface of Comb and the validation of graph data (ADR-0009).
import { Application } from "pixi.js";
import { createBridge, type BridgeError, type GraphBatch } from "../bridge";
import { attachInteraction } from "../interaction";
import { clampScale, fitViewport, type Bounds } from "../interaction/viewport";
import { EDGE_COLOR } from "../render/edges";
import { Scene } from "../render/scene";
import { createFrames } from "./frames";
import { scenes } from "./scenes";
import {
  createGraphStore,
  type GraphData,
  type NodeView,
  type Selection,
  type Viewport,
} from "../store";

export interface CombOptions {
  /** The canvas background. */
  background?: number;
}

export interface Comb {
  /** Replaces the graph. Throws a `GraphDataError` on malformed graph data (Q-7). */
  load(graph: GraphData): void;
  /** Changes attributes of a node; the canvas shows the change (G-5). */
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

export type GraphDataProblem = BridgeError;

/** Comb found no WebGL2 to draw with, only `renderer`, PixiJS's fallback, which cannot draw the
 *  edge mesh. */
export class RendererUnavailableError extends Error {
  constructor(readonly renderer: string) {
    super(`comb: WebGL2 is not available (PixiJS offers ${renderer})`);
    this.name = "RendererUnavailableError";
  }
}

/** Graph data Comb refused, with what was wrong and where. */
export class GraphDataError extends Error {
  constructor(readonly problem: GraphDataProblem) {
    super(`comb: malformed graph data (${problem.kind})`);
  }
}

/** The world rectangle the nodes cover, or null for an empty graph. */
function boundsOf(nodes: readonly NodeView[], positions: Float32Array): Bounds | null {
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

/** The graph data the engine needs: identifiers, positions, sizes, ends, label placements, and
 *  edge styles with their defaults. */
function batchOf(graph: GraphData): GraphBatch {
  return {
    nodes: graph.nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    edges: graph.edges.map(({ id, source, target, label, color, dash, arrow }) => ({
      id,
      source,
      target,
      label: label && { t: label.t, offset: label.offset },
      color: color ?? EDGE_COLOR,
      dash: dash && [dash[0], dash[1]],
      arrow: arrow ?? "end",
    })),
  };
}

/** Creates a Comb canvas that fills `host`. Throws a `RendererUnavailableError` where the
 *  browser offers no WebGL2. */
export async function createComb(host: HTMLElement, options: CombOptions = {}): Promise<Comb> {
  const bridge = await createBridge();
  const app = new Application();
  await app.init({
    resizeTo: host,
    background: options.background ?? 0xf7f8fa,
    antialias: true,
    preference: "webgl",
  });
  if (app.renderer.name !== "webgl") {
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
      try {
        bridge.loadGraph(batchOf(graph));
      } catch (error) {
        throw new GraphDataError(error as BridgeError);
      }
      store.getState().load(graph);
    },
    updateNode: (id, patch) => store.getState().updateNode(id, patch),
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
