// Input into commands on the store (ADR-0026): drag a node, pan the empty canvas, zoom by wheel.
// The engine answers which node lies under the pointer from its spatial index, at every level of
// detail, also where the scene draws nodes as particles (ADR-0027). Once the engine is lost, input
// changes nothing, and no trap escapes a handler (ADR-0021).
import type { Application, FederatedPointerEvent } from "pixi.js";
import { EngineLostError, refuseIfLost, type Bridge } from "../bridge";
import type { GraphStore } from "../store";
import { panBy, toWorld, zoomAt } from "./viewport";

const WHEEL_STEP = 1.0015;

type Drag =
  { kind: "node"; slot: number; x: number; y: number } | { kind: "pan"; x: number; y: number };

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
    return { kind: "node", slot, x, y };
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
    bridge.translate(new Uint32Array([drag.slot]), dx / viewport.scale, dy / viewport.scale);
    store.getState().positionsMoved();
  } else {
    store.getState().setViewport(panBy(viewport, dx, dy));
  }
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
  app.stage.on(
    "pointerdown",
    untilLost((event: FederatedPointerEvent) => {
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
  app.stage.on("pointerup", (event) => ((drag = null), hover(event)));
  app.stage.on("pointerupoutside", () => (drag = null));

  const onWheel = untilLost((event: WheelEvent) => {
    event.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    const factor = WHEEL_STEP ** -event.deltaY;
    const { viewport, setViewport } = store.getState();
    setViewport(zoomAt(viewport, event.clientX - rect.left, event.clientY - rect.top, factor));
  });
  app.canvas.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    app.stage.removeAllListeners();
    app.canvas.removeEventListener("wheel", onWheel);
  };
}
