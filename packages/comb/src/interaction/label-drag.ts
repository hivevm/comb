// The drag of an edge's label along its edge (G-6): the engine places the label nearest the
// pointer, and the release records, once, where the drag left it (ADR-0030).
import type { Hit } from "../bridge";
import type { Context, Gesture } from "./gesture";
import { toWorld } from "../store/viewport";

/** A drag of the label `hit` names, held where the press at the screen point `(pressX, pressY)`
 *  met it, the label's edge selected; none where `hit` names no label of an edge the graph
 *  holds. */
export function labelDrag(
  { store, bridge }: Context,
  hit: Hit,
  pressX: number,
  pressY: number,
): Gesture | undefined {
  const edge = hit.kind === "label" ? store.getState().edges[hit.slot] : undefined;
  const point = hit.kind === "label" ? bridge.labelPoint(hit.slot) : undefined;
  if (hit.kind !== "label" || !edge || !point) return undefined;
  const { slot } = hit;
  const { id } = edge;
  store.getState().select({ kind: "edge", id });
  const pressed = toWorld(store.getState().viewport, pressX, pressY);
  const grab = { x: pressed.x - point.x, y: pressed.y - point.y };
  let placed: { t: number; offset: number } | null = null;
  return {
    grabs: true,
    move(x, y) {
      const at = toWorld(store.getState().viewport, x, y);
      placed = bridge.moveLabel(slot, at.x - grab.x, at.y - grab.y);
      store.getState().positionsMoved();
    },
    end() {
      const held = store.getState().edges[slot];
      if (placed && held?.id === id && held.label)
        store.getState().labelMoved(id, placed.t, placed.offset);
    },
    // A load, a removal of the edge, or a label the host cleared, which is taken as its edge
    // would be.
    taken: (state) =>
      state.change?.kind === "loaded" || state.edges[slot]?.id !== id || !state.edges[slot]?.label,
    drop() {},
  };
}
