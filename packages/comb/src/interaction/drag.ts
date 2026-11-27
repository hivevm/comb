// The drag signal of the moving layer
// (REN-moving-layer-moves-content, ARCH-graph-in-zustand-store): a gesture that moves nodes in the
// engine, a node's drag, a border node's, a resize, and the drag of a line between regions, hands
// each move's engine call and its release's record to a drag of this module. Its first move names
// the slots it drags in the store's `dragged`, each later move increments `movesVersion`, and a
// release after a first move clears `dragged` and increments `positionsVersion` before the record.
// It also holds what takes a drag's subject from under it.
import type { GraphState } from "../store";
import type { Context } from "./gesture";

/** The signal of a drag of the nodes one node's drag moves. */
export interface Drag {
  /** Makes the engine call `move` of one pointer move, then signals the move: the first names
   *  the slots the drag moves as dragged. */
  move(move: () => void): void;
  /** Ends the drag: after a first move, signals its end, then calls `record` with what the
   *  release records; before one, does nothing. */
  end(record: () => void): void;
}

/** The slots a drag of the node in `slot` moves: the node, where it is a container everything it
 *  holds at every depth, and the border nodes of each, as the engine names them. */
function draggedOf({ bridge }: Pick<Context, "bridge">, slot: number): number[] {
  // The nodes a removal of the node would take along are those it holds, at every depth, and
  // their border nodes: the one export that names them, read once a drag, its edges unused.
  return [...bridge.removalOf(Uint32Array.of(slot)).nodes];
}

/** A drag of the node in `slot`, with what it holds and its border nodes, not yet moved. */
export function drag(context: Pick<Context, "store" | "bridge">, slot: number): Drag {
  const { store } = context;
  let started = false;
  return {
    move(move) {
      move();
      if (started) store.getState().dragMoved();
      else {
        started = true;
        store.getState().dragStarted(draggedOf(context, slot));
      }
    },
    end(record) {
      if (!started) return;
      store.getState().dragEnded();
      record();
    },
  };
}

/** A load, or a removal of the node `id` in `slot`, which a node that took its slot does not make
 *  good: what takes the subject of a gesture that drags from under it. */
export function takenOf(slot: number, id: string): (state: GraphState) => boolean {
  return (state) => state.change?.kind === "loaded" || state.nodes[slot]?.id !== id;
}
