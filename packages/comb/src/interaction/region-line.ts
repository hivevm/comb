// The drag of the line between two regions (ARCH-regions-are-container-slots, *Lines*): a press on
// a line begins it, and each move of the pointer hands the engine where the line is to stand, the
// line's place at the press moved by the drag along the direction of its division, which the
// engine keeps from passing what the regions beside it hold. The divided node and what it holds
// are dragged as a drag's are, so that the moving layer redraws them and the query is kept until
// the release (REN-moving-layer-moves-content). The release records once which regions the drag
// changed in size, as the engine holds it, and which nodes in them it moved relative to their
// region, unless it changed none. Comb still tells a region's changed size after a drag whose
// line or box ends where it began. Each region the drag changed then holds the extent it ended at
// (API-edits-report-division-moves).
import type { Hit } from "../bridge";
import type { GraphState } from "../store";
import { drag, takenOf } from "./drag";
import type { Context, Gesture } from "./gesture";
import { regionChanges, regionPlaces } from "./regions";

/** The divided node a region in `slot` lies in at its outermost, by slot. */
function dividedOf(state: GraphState, slot: number): number {
  let at = slot;
  while (state.nodes[at]?.region) at = state.slots.get(state.nodes[at]!.container!)!;
  return at;
}

/** A drag of the line `hit` names, pressed at the screen point `(pressX, pressY)`; none where
 *  `hit` names no line of a region the graph holds. */
export function lineDrag(
  context: Context,
  hit: Hit,
  pressX: number,
  pressY: number,
): Gesture | undefined {
  const { store, bridge } = context;
  const view = hit.kind === "line" ? store.getState().nodes[hit.slot] : undefined;
  if (hit.kind !== "line" || !view?.region) return undefined;
  const { slot } = hit;
  const { id } = view;
  const axis = hit.divide === "across" ? 0 : 1;
  const node = dividedOf(store.getState(), slot);
  const nodeId = store.getState().nodes[node]!.id;
  const before = regionPlaces(bridge, node);
  // The line at the far side of the region's box, its extent, whatever size it holds.
  const { positions, sizes } = bridge.nodeBuffers();
  const from = positions[slot * 2 + axis]! + sizes[slot * 2 + axis]!;
  const dragging = drag(context, node);
  return {
    grabs: false,
    move(x, y) {
      const { scale } = store.getState().viewport;
      // A finite drag: every writer of `viewport.scale` goes through `clampScale`.
      const by = (axis === 0 ? x - pressX : y - pressY) / scale;
      dragging.move(() => bridge.moveLine(slot, from + by));
    },
    end() {
      dragging.end(() => {
        const state = store.getState();
        if (state.nodes[slot]?.id !== id) return;
        const { regions, moved } = regionChanges(state, bridge, before);
        if (regions.length > 0) state.regionsMoved(nodeId, regions, moved);
      });
    },
    // A load, or a removal of the region, which a region that took its slot does not make good.
    taken: takenOf(slot, id),
    drop() {},
  };
}
