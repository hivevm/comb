// The resize of a node by one of its resize handles (G-15): a press on a handle of the selected
// node, where it is resizable, begins it, and each move of the pointer hands the engine the drag
// from the press and the node's box then, from which the engine works out the box anew, never
// smaller than 8 a side, than the node's content, or than the boxes of the nodes that lie directly
// in it, what it holds kept where it lies in the world (API-edits-report-nested-changes), and of a
// divided node the regions at the side it pulls changed (ARCH-regions-are-container-slots). The
// node and what it holds are dragged as a drag's are, so that the moving layer redraws them and the
// query is kept until the release (REN-moving-layer-moves-content). The release records once
// where the resize left the node, unless it changed no box.
import type { Hit } from "../bridge";
import type { GraphState } from "../store";
import type { Context, Gesture } from "./gesture";
import { draggedOf } from "./node-drag";
import { regionBoxes, regionChanges } from "./region-line";

/** The box of the node in `slot`, `x, y, width, height`, as the engine keeps it now. */
function boxOf({ bridge }: Pick<Context, "bridge">, slot: number): Float64Array {
  const { positions, sizes } = bridge.nodeBuffers();
  const at = slot * 2;
  return Float64Array.of(positions[at]!, positions[at + 1]!, sizes[at]!, sizes[at + 1]!);
}

/** The identifiers of the nodes that lie directly in the node `id`, no region among them. */
function heldBy(state: GraphState, id: string): string[] {
  return state.nodes.flatMap((node) => (node?.container === id && !node.region ? [node.id] : []));
}

/** A resize of the node whose handle `hit` names, pressed at the screen point `(pressX, pressY)`;
 *  none where `hit` names no handle of a node the graph holds. */
export function resize(
  context: Context,
  hit: Hit,
  pressX: number,
  pressY: number,
): Gesture | undefined {
  const { store, bridge } = context;
  const node = hit.kind === "handle" ? store.getState().nodes[hit.slot] : undefined;
  if (hit.kind !== "handle" || !node) return undefined;
  const { slot, handle } = hit;
  const { id } = node;
  const from = boxOf(context, slot);
  // The boxes of its regions, which a resize of a divided node changes at the side it pulls.
  const regions = regionBoxes(bridge, slot);
  let started = false;
  // A load, or a removal of the node, which a node that took its slot does not make good.
  const taken = (state: GraphState) =>
    state.change?.kind === "loaded" || state.nodes[slot]?.id !== id;
  return {
    grabs: false,
    move(x, y) {
      const { scale } = store.getState().viewport;
      // A finite drag (API-shell-mistake-refused-as-shells): every writer of `viewport.scale`
      // goes through `clampScale`.
      bridge.resizeNode(slot, handle, from, (x - pressX) / scale, (y - pressY) / scale);
      if (started) store.getState().dragMoved();
      else {
        started = true;
        store.getState().dragStarted(draggedOf(context, slot));
      }
    },
    end() {
      if (!started) return;
      store.getState().dragEnded();
      const state = store.getState();
      if (state.nodes[slot]?.id !== id) return;
      const box = boxOf(context, slot);
      if (box.every((value, i) => value === from[i])) return;
      // A side moved at the left or the top moves every node it holds relative to it, and in a
      // divided node every node in a region whose top left corner moved.
      const shifted = box[0] !== from[0] || box[1] !== from[1];
      const changed = regionChanges(state, bridge, regions);
      const moved = [...(shifted ? heldBy(state, id) : []), ...changed.moved];
      state.nodeResized(id, moved, changed.regions);
    },
    taken,
    drop() {},
  };
}
