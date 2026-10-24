// The pan of the viewport by a drag: from the empty canvas at once, and from an edge only once
// the pointer has moved beyond the slop, so that a press on an edge selects it (ADR-0025).
import type { Hit } from "../bridge";
import type { Context, Gesture } from "./gesture";
import { panBy } from "./viewport";

/** How far, in screen pixels, the pointer moves after a press on an edge before it pans. */
const PAN_SLOP = 4;

/** A pan pressed at the screen point `(x, y)` where `hit` names an edge, which it selects and
 *  waits for the slop, or nothing else, which clears the selection. */
export function pan({ store }: Context, hit: Hit, x: number, y: number): Gesture {
  const edge = hit.kind === "edge" ? store.getState().edges[hit.slot] : undefined;
  store.getState().select(edge ? { kind: "edge", id: edge.id } : null);
  let [lastX, lastY, waiting] = [x, y, !!edge];
  return {
    grabs: false,
    move(x, y) {
      const [dx, dy] = [x - lastX, y - lastY];
      if (waiting) {
        if (Math.hypot(dx, dy) <= PAN_SLOP) return;
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
