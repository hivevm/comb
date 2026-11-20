// The drag of an edge's label along its edge (G-6): the engine places the one label pressed, of the
// edge's list, nearest the pointer, and the release records, once, where the drag left it
// (API-edits-reported-as-typed-changes, API-edges-dock-nodes-or-edges).
import type { Hit } from "../bridge";
import type { GraphView } from "../store";
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
  const point = hit.kind === "label" ? bridge.labelPoint(hit.slot, hit.label) : undefined;
  if (hit.kind !== "label" || !edge?.labels?.[hit.label] || !point) return undefined;
  const { slot, label: index } = hit;
  const { id } = edge;
  const label = edge.labels[index]!.id;
  /** Whether the edge in `slot` is still the one pressed, its label at `index` still the one. */
  const held = (state: Pick<GraphView, "edges">) =>
    state.edges[slot]?.id === id && state.edges[slot]?.labels?.[index]?.id === label;
  store.getState().select({ kind: "edge", id });
  const pressed = toWorld(store.getState().viewport, pressX, pressY);
  const grab = { x: pressed.x - point.x, y: pressed.y - point.y };
  let placed: { t: number; offset: number } | null = null;
  return {
    grabs: true,
    move(x, y) {
      const at = toWorld(store.getState().viewport, x, y);
      // A point beyond any finite world point, which the engine would refuse, moves nothing.
      if (!Number.isFinite(at.x - grab.x) || !Number.isFinite(at.y - grab.y)) return;
      placed = bridge.moveLabel(slot, index, at.x - grab.x, at.y - grab.y);
      store.getState().positionsMoved();
    },
    end() {
      if (placed && held(store.getState()))
        store.getState().labelMoved(id, index, placed.t, placed.offset);
    },
    // A load, a removal of the edge, or labels the host replaced without the one pressed at its
    // place, which is taken as its edge would be.
    taken: (state) => state.change?.kind === "loaded" || !held(state),
    drop() {},
  };
}
