// Input into commands on the store (ADR-0028): a press begins the gesture of what it hits, the
// drag of a node or of an edge's label, a connection, or a pan, each a module of its own that
// says how it moves, how it ends, and whether a change of the graph takes its subject; the wheel
// zooms, and hover shows what a press would do. The engine answers what lies under the pointer
// from its spatial index, at every level of detail, also where the scene draws nodes as
// particles (ADR-0025, ADR-0027). Once the engine is lost, input changes nothing, and no trap
// escapes a handler (ADR-0021).
import type { Application, FederatedPointerEvent } from "pixi.js";
import type { Bridge, Hit } from "../bridge";
import type { GraphStore } from "../store";
import { connection, type Connect } from "./connect";
import { targetAt, type Context, type Gesture } from "./gesture";
import { untilLost } from "./guard";
import { labelDrag } from "./label-drag";
import { nodeDrag } from "./node-drag";
import { pan } from "./pan";
import { levelAt, zoomAt } from "../store/viewport";

export { attachDeletion, type Delete, type Deletion } from "./delete";
export type { Connect, Proposal } from "./connect";

const WHEEL_STEP = 1.0015;

/** The cursor over what a press would hit: begin a connection, grab a node, select an edge, or
 *  nothing. */
const CURSORS: Record<Hit["kind"], string> = {
  connector: "crosshair",
  label: "grab",
  node: "grab",
  edge: "pointer",
  none: "",
};

/** Begins what a press at the screen point `(x, y)` does where `hitAt` says it hits (ADR-0025):
 *  on a connector, where the host lets the user connect, a connection; on an edge label, a drag of
 *  it, its edge selected; on a node, a drag of it, the node selected; on an edge, a pan that waits
 *  for the slop, the edge selected; on nothing, a pan, the selection cleared. */
function begin(
  context: Context,
  hitAt: (x: number, y: number) => Hit,
  x: number,
  y: number,
  connect?: Connect,
): Gesture {
  const hit = hitAt(x, y);
  return (
    (connect && connection(context, hit, x, y, connect)) ||
    labelDrag(context, hit, x, y) ||
    nodeDrag(context, hit, x, y) ||
    pan(context, hit, x, y)
  );
}

/** Zooms around the pointer by the wheel's turn. */
function zoomByWheel(app: Application, store: GraphStore, event: WheelEvent): void {
  event.preventDefault();
  const at = canvasPointAt(app.canvas, app.screen, event.clientX, event.clientY);
  const factor = WHEEL_STEP ** -event.deltaY;
  const { viewport, setViewport } = store.getState();
  setViewport(zoomAt(viewport, at.x, at.y, factor));
}

/** Zooms around the pointer by the wheel on the canvas; returns the removal of the listener. */
function attachWheel(app: Application, store: GraphStore): () => void {
  const onWheel = untilLost((event: WheelEvent) => zoomByWheel(app, store, event));
  app.canvas.addEventListener("wheel", onWheel, { passive: false });
  return () => app.canvas.removeEventListener("wheel", onWheel);
}

/** Shows what a press at the pointer would do: the cursor, and where the host lets the user
 *  connect, the connectors of the node under it. */
function hoverAt(app: Application, store: GraphStore, hit: Hit, connecting: boolean): void {
  app.canvas.style.cursor = CURSORS[hit.kind];
  // At the far level no connector is drawn, so none is shown, and hover writes nothing.
  const far = levelAt(store.getState().viewport.scale) === "far";
  const over = hit.kind === "connector" || hit.kind === "node";
  store.getState().hover(connecting && over && !far ? hit.slot : null);
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

/** Interaction attached to a canvas: what a press at a screen point hits, and the removal of its
 *  input. */
export interface Interaction {
  /** What a press at the screen point `(x, y)` of the canvas hits now, from the store's viewport,
   *  connectors only where the host lets the user connect: the one hit test the press, the hover,
   *  and the testing entry ask (ADR-0025). */
  hitAt(x: number, y: number): Hit;
  /** The world point the connection the user drags is dragged to, while the store holds one: kept
   *  here, not in the store, and its moves signalled by the store's `pointerVersion` (ADR-0029). */
  readonly pointer: { readonly x: number; readonly y: number };
  /** Removes the input from the canvas. */
  detach(): void;
}

/** Wires pointer and wheel input on the canvas. */
export function attachInteraction(
  app: Application,
  store: GraphStore,
  bridge: Bridge,
  connect?: Connect,
): Interaction {
  const context: Context = { store, bridge, pointer: { x: 0, y: 0 } };
  const connecting = connect !== undefined;
  const hitAt = (x: number, y: number) => targetAt(context, x, y, connecting);
  let gesture: Gesture | null = null;
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  // The cursor shows what a press would do, and the connectors of the node under the pointer show
  // where a connection may begin, where the host lets the user connect.
  const hover = untilLost((event: FederatedPointerEvent) =>
    hoverAt(app, store, hitAt(event.global.x, event.global.y), connecting),
  );
  // The gesture is over before its change is told, so that it stays over where a listener
  // throws, and also once the engine is lost, when nothing is told.
  const tellEnd = untilLost((ended: Gesture | null, released: boolean) => ended?.end(released));
  const release = (released = true) => {
    const ended = gesture;
    gesture = null;
    tellEnd(ended, released);
  };
  app.stage.on(
    "pointerdown",
    untilLost((event: FederatedPointerEvent) => {
      // A gesture whose release never came ends where the next press begins.
      release(false);
      gesture = begin(context, hitAt, event.global.x, event.global.y, connect);
      if (gesture.grabs) app.canvas.style.cursor = "grabbing";
    }),
  );
  app.stage.on(
    "globalpointermove",
    untilLost((event: FederatedPointerEvent) =>
      gesture ? gesture.move(event.global.x, event.global.y) : hover(event),
    ),
  );
  app.stage.on("pointerup", (event) => {
    try {
      release();
    } finally {
      hover(event);
    }
  });
  app.stage.on("pointerupoutside", () => release());
  // A change that takes a gesture's subject from under it ends the gesture without a word: it
  // moves nothing that took the subject's slot, and tells nothing of what the user never moved.
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.change === previous.change || !gesture?.taken(state)) return;
    const taken = gesture;
    gesture = null;
    taken.drop();
  });

  const detachWheel = attachWheel(app, store);
  return {
    hitAt,
    pointer: context.pointer,
    detach() {
      unsubscribe();
      app.stage.removeAllListeners();
      detachWheel();
    },
  };
}
