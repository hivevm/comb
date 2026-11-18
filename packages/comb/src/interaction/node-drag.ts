// The drag of a node (G-2): it waits until the pointer has moved beyond the slop from the press,
// then moves the node in the engine by the pointer's moves, a container with everything it holds,
// each a move a kept query survives, from the first naming the slots it moves as dragged
// (REN-moving-layer-moves-content, ARCH-engine-edits-nested-graph). Released over a container
// other than its own, or outside every container while it lies in one, it hands the drop to the
// host application's veto, which moves the node there or has the whole drag taken back; else it
// records once, where it moved it, where the release left it (API-edits-report-nested-changes).
// A press released on the canvas within the slop is a click: where the release point lies on an
// element of the content of the node pressed, it tells the host application which
// (REN-node-content-in-rows).
import { positionAt, type Hit } from "../bridge";
import type { GraphState } from "../store";
import { toWorld } from "../store/viewport";
import { SLOP, type Context, type Gesture } from "./gesture";

/** The node a drag moves: its slot, its identifier, the container it lay in at the press, or
 *  `null` on the canvas, and its position relative to that container then. */
interface Dragged {
  readonly slot: number;
  readonly id: string;
  readonly own: string | null;
  readonly x: number;
  readonly y: number;
}

/** The slots a drag of the node in `slot` moves: the node, and where it is a container,
 *  everything it holds at every depth, as the engine names it (REN-moving-layer-moves-content). */
function draggedOf({ store, bridge }: Pick<Context, "store" | "bridge">, slot: number): number[] {
  if (store.getState().nodes[slot]?.isContainer !== true) return [slot];
  // The nodes a removal of the container would take along are those it holds, at every depth: the
  // one export that names them, read once a drag, its edges unused.
  return [...bridge.removalOf(Uint32Array.of(slot)).nodes];
}

/** The world position of the top left corner of the container `container`, or the origin for the
 *  canvas, `null`. */
function originOf({ store, bridge }: Pick<Context, "store" | "bridge">, container: string | null) {
  if (container === null) return { x: 0, y: 0 };
  return positionAt(bridge.positions(), store.getState().slots.get(container)!);
}

/** The node in `slot`, `id`, before the drag moves it: where it lies relative to its container. */
function pressedOf(context: Context, slot: number, id: string): Dragged {
  const own = context.store.getState().nodes[slot]!.container ?? null;
  const at = positionAt(context.bridge.positions(), slot);
  const origin = originOf(context, own);
  return { slot, id, own, x: at.x - origin.x, y: at.y - origin.y };
}

/** The container a drop of `dragged` at the screen point `at` lands in, by identifier, or `null`
 *  for the canvas: the topmost container under the point that is neither the node nor one it
 *  holds, as the engine finds it. A drag that ends with no point on the canvas, or at a point
 *  beyond any finite world point, has no target and stays in its own container. */
function targetOf(
  { store, bridge }: Context,
  dragged: Dragged,
  at: { x: number; y: number } | undefined,
): string | null {
  if (!at) return dragged.own;
  const world = toWorld(store.getState().viewport, at.x, at.y);
  // A finite point (API-shell-mistake-refused-as-shells), as `targetAt` guards it.
  if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return dragged.own;
  const found = bridge.containerAt(world.x, world.y, dragged.slot);
  return found === undefined ? null : store.getState().nodes[found]!.id;
}

/** Takes the drag of `dragged` back: the node, and what it holds, placed where it lay at the
 *  press, relative to its container, which the drag did not move. */
function takeBack(context: Context, dragged: Dragged): void {
  const origin = originOf(context, dragged.own);
  context.bridge.place(dragged.slot, origin.x + dragged.x, origin.y + dragged.y);
  context.store.getState().positionsMoved();
}

/** Ends the drag of `dragged` released at the screen point `at`, none outside the canvas: within
 *  its own container a move recorded as one, else the drop handed to `moveInto`, and the drag
 *  taken back where it moved nothing, unless a change told during the veto's call took the node
 *  (`taken`). An error of the veto is thrown on once the drag is taken back. */
function dropped(
  context: Context,
  dragged: Dragged,
  at: { x: number; y: number } | undefined,
  taken: (state: GraphState) => boolean,
): void {
  const { store, moveInto } = context;
  const container = targetOf(context, dragged, at);
  if (container === dragged.own) {
    store.getState().nodeMoved(dragged.id, dragged.own);
    return;
  }
  let [moved, gone] = [false, false];
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.change !== previous.change && taken(state)) gone = true;
  });
  try {
    moved = moveInto({ node: dragged.id, container });
  } finally {
    unsubscribe();
    if (!moved && !gone) takeBack(context, dragged);
  }
}

/** A drag of the node `hit` names, pressed at the screen point `(pressX, pressY)`, the node
 *  selected; none where `hit` names no node the graph holds. */
export function nodeDrag(
  context: Context,
  hit: Hit,
  pressX: number,
  pressY: number,
): Gesture | undefined {
  const { store, bridge, click, hitAt } = context;
  const node = hit.kind === "node" ? store.getState().nodes[hit.slot] : undefined;
  if (hit.kind !== "node" || !node) return undefined;
  const { slot } = hit;
  const { id } = node;
  store.getState().select({ kind: "node", id });
  let [lastX, lastY, waiting] = [pressX, pressY, true];
  let dragged: Dragged | undefined;
  // A click on the element under the release, asked anew since the host may have changed the
  // node's content when it heard of the selection; none off the node pressed or off its elements.
  const clickAt = (x: number, y: number) => {
    const under = hitAt(x, y);
    if (under.kind !== "node" || under.slot !== slot || !under.element) return;
    if (store.getState().nodes[slot]?.id === id) click({ node: id, ...under.element });
  };
  // A load, or a removal of the node, which a node that took its slot does not make good.
  const taken = (state: GraphState) =>
    state.change?.kind === "loaded" || state.nodes[slot]?.id !== id;
  return {
    grabs: true,
    move(x, y) {
      if (waiting) {
        if (Math.hypot(x - pressX, y - pressY) <= SLOP) return;
        waiting = false;
      }
      const [dx, dy] = [x - lastX, y - lastY];
      [lastX, lastY] = [x, y];
      if (dx === 0 && dy === 0) return;
      const { scale } = store.getState().viewport;
      const first = !dragged;
      dragged ??= pressedOf(context, slot, id);
      // A finite delta (API-shell-mistake-refused-as-shells): every writer of `viewport.scale` goes
      // through `clampScale`.
      bridge.translate(new Uint32Array([slot]), dx / scale, dy / scale);
      if (first) store.getState().dragStarted(draggedOf({ store, bridge }, slot));
      else store.getState().dragMoved();
    },
    end(released, at) {
      if (dragged) store.getState().dragEnded();
      const held = store.getState().nodes[slot]?.id === id;
      if (dragged && held) dropped(context, dragged, released ? at : undefined, taken);
      if (released && waiting && at) clickAt(at.x, at.y);
    },
    taken,
    drop() {},
  };
}
