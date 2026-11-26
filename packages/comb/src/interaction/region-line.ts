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
import type { Bridge, Hit } from "../bridge";
import type { GraphState } from "../store";
import type { Context, Gesture } from "./gesture";
import { draggedOf } from "./node-drag";

/** Where a region stands: the top left corner of its box, `x, y`, and its size as the engine
 *  holds it apart from its extent. */
export type RegionPlace = readonly [x: number, y: number, size: number];

/** The places of the regions of the divided node in `slot`, by slot, as the engine keeps them
 *  now. */
export function regionPlaces(bridge: Bridge, slot: number): Map<number, RegionPlace> {
  const places = new Map<number, RegionPlace>();
  // Asked before the buffers are read, since a call into the engine may detach their views.
  const regions = bridge.regionsOf(slot);
  const held = Array.from(regions, (region) => bridge.regionSize(region)!);
  const { positions } = bridge.nodeBuffers();
  regions.forEach((region, k) => {
    places.set(region, [positions[region * 2]!, positions[region * 2 + 1]!, held[k]!]);
  });
  return places;
}

/** What changed of the regions whose places were `before`: the regions whose size, as
 *  the engine holds it apart from their extent, changed, and the nodes that lie directly in a
 *  region whose top left corner moved, whose position relative to it changed with it, since they
 *  keep their world position; each by identifier. */
export function regionChanges(
  state: GraphState,
  bridge: Bridge,
  before: ReadonlyMap<number, RegionPlace>,
): { regions: string[]; moved: string[] } {
  const slots = [...before.keys()];
  // Asked before the buffers are read, since a call into the engine may detach their views.
  const held = slots.map((slot) => bridge.regionSize(slot));
  const { positions } = bridge.nodeBuffers();
  const regions: string[] = [];
  const shifted = new Set<string>();
  slots.forEach((slot, k) => {
    const view = state.nodes[slot];
    const [x, y, size] = before.get(slot)!;
    if (!view?.region) return;
    const at = slot * 2;
    if (held[k] !== size) regions.push(view.id);
    if (positions[at] !== x || positions[at + 1] !== y) shifted.add(view.id);
  });
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
  const before = regionPlaces(bridge, node);
  // The line at the far side of the region's box, its extent, whatever size it holds.
  const { positions, sizes } = bridge.nodeBuffers();
  const from = positions[slot * 2 + axis]! + sizes[slot * 2 + axis]!;
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
