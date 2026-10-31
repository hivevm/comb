// The pan of the viewport by a drag: from the empty canvas at once, and from an edge only once
// the pointer has moved beyond the slop, so that a press on an edge selects it (ADR-0013).
import type { Hit } from "../bridge";
import { SLOP, type Context, type Gesture } from "./gesture";
import { panBy } from "../store/viewport";

/** A pan pressed at the screen point `(pressX, pressY)` where `hit` names an edge, which it
 *  selects and waits for the slop, or nothing else, which clears the selection. */
export function pan({ store }: Context, hit: Hit, pressX: number, pressY: number): Gesture {
  const edge = hit.kind === "edge" ? store.getState().edges[hit.slot] : undefined;
  store.getState().select(edge ? { kind: "edge", id: edge.id } : null);
  let [lastX, lastY, waiting] = [pressX, pressY, !!edge];
  return {
    grabs: false,
    move(x, y) {
      const [dx, dy] = [x - lastX, y - lastY];
      if (waiting) {
        if (Math.hypot(dx, dy) <= SLOP) return;
        waiting = false;
      }
      [lastX, lastY] = [x, y];
      store.getState().setViewport(panBy(store.getState().viewport, dx, dy));
    },
    end() {},
    // A pan has no subject in the graph.
    taken: () => false,
    drop() {},
  };
}
