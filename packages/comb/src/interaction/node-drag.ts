// The drag of a node (G-2): it waits until the pointer has moved beyond the slop from the press,
// then moves the node in the engine by the pointer's moves, a container with everything it holds,
// each a move a kept query survives, from the first naming the slots it moves as dragged
// (REN-moving-layer-moves-content, ARCH-engine-edits-nested-graph), and records
// once, where it moved it, where the release left it (API-edits-reported-as-typed-changes). A press
// released on the canvas within the slop is a click: where the release point lies on an element of
// the content of the node pressed, it tells the host application which (REN-node-content-in-rows).
import type { Hit } from "../bridge";
import { SLOP, type Context, type Gesture } from "./gesture";

/** The slots a drag of the node in `slot` moves: the node, and where it is a container,
 *  everything it holds at every depth, as the engine names it (REN-moving-layer-moves-content). */
function draggedOf({ store, bridge }: Pick<Context, "store" | "bridge">, slot: number): number[] {
  if (store.getState().nodes[slot]?.isContainer !== true) return [slot];
  // The nodes a removal of the container would take along are those it holds, at every depth: the
  // one export that names them, read once a drag, its edges unused.
  return [...bridge.removalOf(Uint32Array.of(slot)).nodes];
}

/** A drag of the node `hit` names, pressed at the screen point `(pressX, pressY)`, the node
 *  selected; none where `hit` names no node the graph holds. */
export function nodeDrag(
  { store, bridge, click, hitAt }: Context,
  hit: Hit,
  pressX: number,
  pressY: number,
): Gesture | undefined {
  const node = hit.kind === "node" ? store.getState().nodes[hit.slot] : undefined;
  if (hit.kind !== "node" || !node) return undefined;
  const { slot } = hit;
  const { id } = node;
  store.getState().select({ kind: "node", id });
  let [lastX, lastY, waiting, moved] = [pressX, pressY, true, false];
  // A click on the element under the release, asked anew since the host may have changed the
  // node's content when it heard of the selection; none off the node pressed or off its elements.
  const clickAt = (x: number, y: number) => {
    const under = hitAt(x, y);
    if (under.kind !== "node" || under.slot !== slot || !under.element) return;
    if (store.getState().nodes[slot]?.id === id) click({ node: id, ...under.element });
  };
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
      // A finite delta (API-shell-mistake-refused-as-shells): every writer of `viewport.scale` goes
      // through `clampScale`.
      bridge.translate(new Uint32Array([slot]), dx / scale, dy / scale);
      if (moved) store.getState().dragMoved();
      else store.getState().dragStarted(draggedOf({ store, bridge }, slot));
      moved = true;
    },
    end(released, at) {
      if (moved) store.getState().dragEnded();
      if (moved && store.getState().nodes[slot]?.id === id) store.getState().nodeMoved(id);
      if (released && waiting && at) clickAt(at.x, at.y);
    },
    // A load, or a removal of the node, which a node that took its slot does not make good.
    taken: (state) => state.change?.kind === "loaded" || state.nodes[slot]?.id !== id,
    drop() {},
  };
}
