// Input into commands on the store (ADR-0009): drag a node, pan the empty canvas, zoom by wheel.
import type { Application, Container, FederatedPointerEvent } from "pixi.js";
import type { Bridge } from "../bridge";
import { NodeGraphic } from "../render/scene";
import type { GraphStore } from "../store";
import { panBy, zoomAt } from "./viewport";

const WHEEL_STEP = 1.0015;

type Drag =
  { kind: "node"; slot: number; x: number; y: number } | { kind: "pan"; x: number; y: number };

function nodeUnder(target: Container | null): NodeGraphic | null {
  for (let at = target; at; at = at.parent) if (at instanceof NodeGraphic) return at;
  return null;
}

function startDrag(store: GraphStore, event: FederatedPointerEvent): Drag {
  const { x, y } = event.global;
  const node = nodeUnder(event.target as Container | null);
  const slot = node ? store.getState().slots.get(node.nodeId) : undefined;
  if (node && slot !== undefined) {
    store.getState().select({ kind: "node", id: node.nodeId });
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

/** Wires pointer and wheel input on the canvas; returns the function that removes it. */
export function attachInteraction(app: Application, store: GraphStore, bridge: Bridge): () => void {
  let drag: Drag | null = null;
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  app.stage.on("pointerdown", (event) => (drag = startDrag(store, event)));
  app.stage.on("globalpointermove", (event) => drag && continueDrag(store, bridge, drag, event));
  app.stage.on("pointerup", () => (drag = null));
  app.stage.on("pointerupoutside", () => (drag = null));

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    const factor = WHEEL_STEP ** -event.deltaY;
    const { viewport, setViewport } = store.getState();
    setViewport(zoomAt(viewport, event.clientX - rect.left, event.clientY - rect.top, factor));
  };
  app.canvas.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    app.stage.removeAllListeners();
    app.canvas.removeEventListener("wheel", onWheel);
  };
}
