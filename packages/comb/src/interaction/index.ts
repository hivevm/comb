// Input into commands on the store (ADR-0026): drag a node, pan the empty canvas, zoom by wheel.
// The engine answers which node lies under the pointer from its spatial index, at every level of
// detail, also where the scene draws nodes as particles (ADR-0027). Once the engine is lost, input
// changes nothing, and no trap escapes a handler (ADR-0021).
import type { Application, FederatedPointerEvent } from "pixi.js";
import { EngineLostError, refuseIfLost, type Bridge } from "../bridge";
import type { GraphStore } from "../store";
import { panBy, toWorld, zoomAt } from "./viewport";

const WHEEL_STEP = 1.0015;

/** A drag in progress: of a node, which records whether it moved it, or of the viewport. */
type Drag =
  | { kind: "node"; slot: number; id: string; x: number; y: number; moved: boolean }
  | { kind: "pan"; x: number; y: number };

/** The slot of the node under a screen point, from the engine's spatial index. */
function nodeAt(store: GraphStore, bridge: Bridge, x: number, y: number): number | undefined {
  const world = toWorld(store.getState().viewport, x, y);
  return bridge.hit(world.x, world.y);
}

function startDrag(store: GraphStore, bridge: Bridge, event: FederatedPointerEvent): Drag {
  const { x, y } = event.global;
  const { nodes } = store.getState();
  const slot = nodeAt(store, bridge, x, y);
  const node = slot === undefined ? undefined : nodes[slot];
  if (slot !== undefined && node) {
    store.getState().select({ kind: "node", id: node.id });
    return { kind: "node", slot, id: node.id, x, y, moved: false };
  }
  store.getState().select(null);
  return { kind: "pan", x, y };
}

function continueDrag(store: GraphStore, bridge: Bridge, drag: Drag, event: FederatedPointerEvent) {
  const dx = event.global.x - drag.x;
  const dy = event.global.y - drag.y;
  drag.x = event.global.x;
  drag.y = event.global.y;
  const { viewport } = store.getState();
  if (drag.kind === "node") {
    if (dx === 0 && dy === 0) return;
    bridge.translate(new Uint32Array([drag.slot]), dx / viewport.scale, dy / viewport.scale);
    drag.moved = true;
    store.getState().positionsMoved();
  } else {
    store.getState().setViewport(panBy(viewport, dx, dy));
  }
}

/** Ends `drag` where the pointer was released: a drag that moved its node records, once, where
 *  it left it (ADR-0023), on the canvas or outside it. */
function endDrag(store: GraphStore, drag: Drag | null): void {
  if (drag?.kind !== "node" || !drag.moved) return;
  if (store.getState().nodes[drag.slot]?.id === drag.id) store.getState().nodeMoved(drag.id);
}

/** `handler`, doing nothing once the engine is lost. */
function untilLost<A extends unknown[]>(handler: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    try {
      refuseIfLost();
      handler(...args);
    } catch (error) {
      if (!(error instanceof EngineLostError)) throw error;
    }
  };
}

/** The screen point of `canvas`, drawn at the size of `screen`, under the point (`clientX`,
 *  `clientY`) of the page: its place in the page taken away, and a canvas the page scales with
 *  CSS scaled back, as PixiJS maps a pointer. */
export function canvasPointAt(
  canvas: HTMLCanvasElement,
  screen: { width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width > 0 ? screen.width / rect.width : 1;
  const sy = rect.height > 0 ? screen.height / rect.height : 1;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

/** Wires pointer and wheel input on the canvas; returns the function that removes it. */
export function attachInteraction(app: Application, store: GraphStore, bridge: Bridge): () => void {
  let drag: Drag | null = null;
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  // The cursor shows what a press would do: grab a node, or, over the empty canvas, nothing.
  const hover = untilLost((event: FederatedPointerEvent) => {
    const over = nodeAt(store, bridge, event.global.x, event.global.y) !== undefined;
    app.canvas.style.cursor = over ? "grab" : "";
  });
  // The drag is over before its change is told, so that it stays over where a listener throws,
  // and also once the engine is lost, when nothing is told.
  const tellEnd = untilLost((ended: Drag | null) => endDrag(store, ended));
  const release = () => {
    const ended = drag;
    drag = null;
    tellEnd(ended);
  };
  app.stage.on(
    "pointerdown",
    untilLost((event: FederatedPointerEvent) => {
      // A drag whose release never came ends where the next press begins.
      release();
      drag = startDrag(store, bridge, event);
      if (drag.kind === "node") app.canvas.style.cursor = "grabbing";
    }),
  );
  app.stage.on(
    "globalpointermove",
    untilLost((event: FederatedPointerEvent) =>
      drag ? continueDrag(store, bridge, drag, event) : hover(event),
    ),
  );
  app.stage.on("pointerup", (event) => {
    try {
      release();
    } finally {
      hover(event);
    }
  });
  app.stage.on("pointerupoutside", release);
  // A load, or a removal of the dragged node, takes the node from under a drag: the drag ends,
  // moves no node that took its slot, and tells nothing of a node the user never moved.
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.change === previous.change || drag?.kind !== "node") return;
    if (state.change?.kind === "loaded" || state.nodes[drag.slot]?.id !== drag.id) drag = null;
  });

  const onWheel = untilLost((event: WheelEvent) => {
    event.preventDefault();
    const at = canvasPointAt(app.canvas, app.screen, event.clientX, event.clientY);
    const factor = WHEEL_STEP ** -event.deltaY;
    const { viewport, setViewport } = store.getState();
    setViewport(zoomAt(viewport, at.x, at.y, factor));
  });
  app.canvas.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    unsubscribe();
    app.stage.removeAllListeners();
    app.canvas.removeEventListener("wheel", onWheel);
  };
}
