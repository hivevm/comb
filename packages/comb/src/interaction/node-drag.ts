// The drag of a node (G-2): it waits until the pointer has moved beyond the slop from the press,
// then moves the node in the engine by the pointer's moves, and records once, where it moved it,
// where the release left it (ADR-0030). A press released within the slop is a click: on an
// element of the node's content it tells the host application which (ADR-0013).
import type { Hit } from "../bridge";
import { SLOP, type Context, type Gesture } from "./gesture";

/** A drag of the node `hit` names, pressed at the screen point `(pressX, pressY)`, the node
 *  selected; none where `hit` names no node the graph holds. */
export function nodeDrag(
  { store, bridge, click }: Context,
  hit: Hit,
  pressX: number,
  pressY: number,
): Gesture | undefined {
  const node = hit.kind === "node" ? store.getState().nodes[hit.slot] : undefined;
  if (hit.kind !== "node" || !node) return undefined;
  const { slot, element } = hit;
  const { id } = node;
  store.getState().select({ kind: "node", id });
  let [lastX, lastY, waiting, moved] = [pressX, pressY, true, false];
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
      // A finite delta (ADR-0031): every writer of `viewport.scale` goes through `clampScale`.
      bridge.translate(new Uint32Array([slot]), dx / scale, dy / scale);
      moved = true;
      store.getState().positionsMoved();
    },
    end(released) {
      if (moved && store.getState().nodes[slot]?.id === id) store.getState().nodeMoved(id);
      // A click: released within the slop, on an element, of the node pressed.
      if (released && waiting && element && store.getState().nodes[slot]?.id === id)
        click({ node: id, ...element });
    },
    // A load, or a removal of the node, which a node that took its slot does not make good.
    taken: (state) => state.change?.kind === "loaded" || state.nodes[slot]?.id !== id,
    drop() {},
  };
}
