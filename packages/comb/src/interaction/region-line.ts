// The drag of the line between two regions (ARCH-regions-are-container-slots, *Lines*): a press on
// a line begins it, and each move of the pointer hands the engine where the line is to stand, the
// line's place at the press moved by the drag along the direction of its division, which the
// engine keeps from passing what the regions beside it hold. The divided node and what it holds
// are dragged as a drag's are, so that the moving layer redraws them and the query is kept until
// the release (REN-moving-layer-moves-content). The release records once which regions the drag
// changed in size and which nodes in them it moved relative to their region, unless it changed
// none (API-edits-report-nested-changes).
import type { Bridge, Hit } from "../bridge";
import type { GraphState } from "../store";
import type { Context, Gesture } from "./gesture";
import { draggedOf } from "./node-drag";

/** The boxes of the regions of the divided node in `slot`, `x, y, width, height` each, by slot,
 *  as the engine keeps them now. */
export function regionBoxes(bridge: Bridge, slot: number): Map<number, number[]> {
  // Asked before the buffers are read, since a call into the engine may detach their views.
  const regions = bridge.regionsOf(slot);
  const { positions, sizes } = bridge.nodeBuffers();
  const boxes = new Map<number, number[]>();
  for (const region of regions) {
    const at = region * 2;
    boxes.set(region, [positions[at]!, positions[at + 1]!, sizes[at]!, sizes[at + 1]!]);
  }
  return boxes;
}

/** What changed of the regions whose boxes were `before`: the regions whose size along the
 *  direction of their division changed, and the nodes that lie directly in a region whose top
 *  left corner moved, whose position relative to it changed with it, since they keep their world
 *  position; each by identifier. */
export function regionChanges(
  state: GraphState,
  bridge: Bridge,
  before: ReadonlyMap<number, number[]>,
): { regions: string[]; moved: string[] } {
  const { positions, sizes } = bridge.nodeBuffers();
  const regions: string[] = [];
  const shifted = new Set<string>();
  for (const [slot, box] of before) {
    const view = state.nodes[slot];
    if (!view?.region) continue;
    const at = slot * 2;
    const axis = view.region.axis === "across" ? 0 : 1;
    if (sizes[at + axis] !== box[2 + axis]) regions.push(view.id);
    if (positions[at] !== box[0] || positions[at + 1] !== box[1]) shifted.add(view.id);
  }
  const moved =
    shifted.size === 0
      ? []
      : state.nodes.flatMap((node) =>
          node && !node.region && shifted.has(node.container ?? "") ? [node.id] : [],
        );
  return { regions, moved };
}

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
  const before = regionBoxes(bridge, node);
  const box = before.get(slot)!;
  const from = box[axis]! + box[2 + axis]!;
  let started = false;
  return {
    grabs: false,
    move(x, y) {
      const { scale } = store.getState().viewport;
      // A finite drag: every writer of `viewport.scale` goes through `clampScale`.
      const by = (axis === 0 ? x - pressX : y - pressY) / scale;
      bridge.moveLine(slot, from + by);
      if (started) store.getState().dragMoved();
      else {
        started = true;
        store.getState().dragStarted(draggedOf(context, node));
      }
    },
    end() {
      if (!started) return;
      store.getState().dragEnded();
      const state = store.getState();
      if (state.nodes[slot]?.id !== id) return;
      const { regions, moved } = regionChanges(state, bridge, before);
      if (regions.length > 0) state.regionsMoved(nodeId, regions, moved);
    },
    // A load, or a removal or an update of the region, which a region that took its slot does
    // not make good.
    taken: (state) => state.change?.kind === "loaded" || state.nodes[slot]?.id !== id,
    drop() {},
  };
}
