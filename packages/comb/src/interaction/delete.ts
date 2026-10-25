// The user deletes the selection (G-4, ADR-0023): with the canvas focused, Delete or Backspace
// hands what would go, a selected node with every edge at it or a selected edge alone, to the
// deletion `api` gives, which asks the host application's `canDelete` and records the removal as
// the user's (ADR-0030).
import { refuseIfLost, type Bridge } from "../bridge";
import type { GraphStore } from "../store";
import { untilLost } from "./guard";

/** What a deletion of the user's would remove, as the host application's veto is asked. */
export interface Deletion {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}

/** Deletes, by the user, what `deletion` names, where the host application's veto allows it: the
 *  nodes with every edge at them, or the edges alone, as `removeNodes` and `removeEdges` remove
 *  them; `api` gives it. */
export type Delete = (deletion: Deletion) => void;

/** The keys that delete the selection. */
const DELETE_KEYS = new Set(["Delete", "Backspace"]);

/** What deleting the selection removes: a node with every edge at it, named by the engine
 *  before anything is removed (ADR-0022), or an edge alone; none for no selection or one the
 *  graph no longer holds. */
function doomed(store: GraphStore, bridge: Bridge): Deletion | undefined {
  const { selection, slots, edgeSlots, edges } = store.getState();
  if (selection?.kind === "node") {
    const slot = slots.get(selection.id);
    if (slot === undefined) return undefined;
    const at = [...bridge.edgesAt(Uint32Array.of(slot))];
    return { nodes: [selection.id], edges: at.map((edge) => edges[edge]!.id) };
  }
  if (selection?.kind === "edge" && edgeSlots.has(selection.id))
    return { nodes: [], edges: [selection.id] };
  return undefined;
}

/** Hands what deleting the selection would remove to `remove`, which asks the veto; an error it
 *  throws is thrown on once nothing has changed (ADR-0023). */
export function deleteSelection(store: GraphStore, bridge: Bridge, remove: Delete): void {
  refuseIfLost();
  const found = doomed(store, bridge);
  if (found) remove(found);
}

/** Makes `canvas` focusable, focused by a press, and deletes the selection on Delete or
 *  Backspace while it is focused; returns the function that removes the listeners. */
export function attachDeletion(
  canvas: HTMLCanvasElement,
  store: GraphStore,
  bridge: Bridge,
  remove: Delete,
): () => void {
  canvas.tabIndex = 0;
  const focus = () => canvas.focus({ preventScroll: true });
  // Once the engine is lost, a key changes nothing.
  const deleting = untilLost(() => deleteSelection(store, bridge, remove));
  const onKey = (event: KeyboardEvent) => {
    if (!DELETE_KEYS.has(event.key)) return;
    event.preventDefault();
    // A key held down, or with a modifier, deletes nothing: once is the user's deletion.
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    deleting();
  };
  canvas.addEventListener("pointerdown", focus);
  canvas.addEventListener("keydown", onKey);
  return () => {
    canvas.removeEventListener("pointerdown", focus);
    canvas.removeEventListener("keydown", onKey);
  };
}
