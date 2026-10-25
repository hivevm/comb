// The drag of a node (G-2): it moves the node in the engine by the pointer's moves, and records
// once, where it moved it, where the release left it (ADR-0030).
import type { Hit } from "../bridge";
import type { Context, Gesture } from "./gesture";

/** A drag of the node `hit` names, pressed at the screen point `(x, y)`, the node selected; none
 *  where `hit` names no node the graph holds. */
export function nodeDrag(
  { store, bridge }: Context,
  hit: Hit,
  x: number,
  y: number,
): Gesture | undefined {
  const node = hit.kind === "node" ? store.getState().nodes[hit.slot] : undefined;
  if (hit.kind !== "node" || !node) return undefined;
  const { slot } = hit;
  const { id } = node;
  store.getState().select({ kind: "node", id });
  let [lastX, lastY, moved] = [x, y, false];
  return {
    grabs: true,
    move(x, y) {
      const [dx, dy] = [x - lastX, y - lastY];
      [lastX, lastY] = [x, y];
      if (dx === 0 && dy === 0) return;
      const { scale } = store.getState().viewport;
      bridge.translate(new Uint32Array([slot]), dx / scale, dy / scale);
      moved = true;
      store.getState().positionsMoved();
    },
    end() {
      if (moved && store.getState().nodes[slot]?.id === id) store.getState().nodeMoved(id);
    },
    // A load, or a removal of the node, which a node that took its slot does not make good.
    taken: (state) => state.change?.kind === "loaded" || state.nodes[slot]?.id !== id,
    drop() {},
  };
}
