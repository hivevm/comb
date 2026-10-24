// The user deletes the selection (G-4, ADR-0023): with the canvas focused, Delete or Backspace
// removes a selected node with every edge at it, or a selected edge alone, once the host
// application's `canDelete` returns `true`, and the store records it as the user's.
import { EngineLostError, refuseIfLost, type Bridge } from "../bridge";
import type { GraphStore } from "../store";

/** What a deletion of the user's would remove, as the host application's veto is asked. */
export interface Deletion {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}

/** The host application's veto of a deletion: only `true` lets it happen. */
export type CanDelete = (deletion: Deletion) => unknown;

/** The keys that delete the selection. */
const DELETE_KEYS = new Set(["Delete", "Backspace"]);

/** The slots and identifiers of what deleting the selection removes: a node with every edge at
 *  it, named by the engine before anything is removed (ADR-0022), or an edge alone; none for no
 *  selection or one the graph no longer holds. */
function doomed(store: GraphStore, bridge: Bridge) {
  const { selection, slots, edgeSlots, edges } = store.getState();
  if (selection?.kind === "node") {
    const slot = slots.get(selection.id);
    if (slot === undefined) return undefined;
    const at = [...bridge.edgesAt(Uint32Array.of(slot))];
    const ids = at.map((edge) => edges[edge]!.id);
    return { nodes: [slot], edges: at, deletion: { nodes: [selection.id], edges: ids } };
  }
  if (selection?.kind === "edge") {
    const slot = edgeSlots.get(selection.id);
    if (slot === undefined) return undefined;
    return { nodes: [], edges: [slot], deletion: { nodes: [], edges: [selection.id] } };
  }
  return undefined;
}

/** Deletes the selection, where `canDelete` allows it; an error it throws refuses the deletion
 *  and is thrown on once nothing has changed (ADR-0023). A veto that changes the graph itself,
 *  through `Comb`, refuses too: what it was asked about may no longer be what would go. */
export function deleteSelection(store: GraphStore, bridge: Bridge, canDelete?: CanDelete): void {
  refuseIfLost();
  const found = doomed(store, bridge);
  if (!found) return;
  const before = store.getState().change;
  if (canDelete && canDelete(found.deletion) !== true) return;
  if (store.getState().change !== before) return;
  if (found.nodes.length > 0) {
    const edges = bridge.removeNodes(Uint32Array.from(found.nodes));
    store.getState().removeNodes(found.nodes, [...edges], "user");
  } else {
    bridge.removeEdges(Uint32Array.from(found.edges));
    store.getState().removeEdges(found.edges, "user");
  }
}

/** Makes `canvas` focusable, focused by a press, and deletes the selection on Delete or
 *  Backspace while it is focused; returns the function that removes the listeners. */
export function attachDeletion(
  canvas: HTMLCanvasElement,
  store: GraphStore,
  bridge: Bridge,
  canDelete?: CanDelete,
): () => void {
  canvas.tabIndex = 0;
  const focus = () => canvas.focus({ preventScroll: true });
  const onKey = (event: KeyboardEvent) => {
    if (!DELETE_KEYS.has(event.key)) return;
    event.preventDefault();
    // A key held down, or with a modifier, deletes nothing: once is the user's deletion.
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    try {
      deleteSelection(store, bridge, canDelete);
    } catch (error) {
      // Once the engine is lost, a key changes nothing.
      if (!(error instanceof EngineLostError)) throw error;
    }
  };
  canvas.addEventListener("pointerdown", focus);
  canvas.addEventListener("keydown", onKey);
  return () => {
    canvas.removeEventListener("pointerdown", focus);
    canvas.removeEventListener("keydown", onKey);
  };
}
