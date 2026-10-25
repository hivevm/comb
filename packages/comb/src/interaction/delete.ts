// The user deletes the selection (G-4, ADR-0023): with the canvas focused, Delete or Backspace
// removes a selected node with every edge at it, or a selected edge alone, once the host
// application's `canDelete` returns `true`, through the removal `api` gives, which records it as
// the user's.
import { refuseIfLost, type Bridge } from "../bridge";
import type { GraphStore } from "../store";
import { untilLost } from "./guard";

/** What a deletion of the user's would remove, as the host application's veto is asked. */
export interface Deletion {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}

/** The host application's veto of a deletion: only `true` lets it happen. */
export type CanDelete = (deletion: Deletion) => unknown;

/** Removes, by the user, the nodes `ids` with every edge at them, or the edges `ids`, as
 *  `removeNodes` and `removeEdges` remove them; `api` gives it. */
export type Remove = (list: "nodes" | "edges", ids: readonly string[]) => void;

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

/** Deletes the selection, where `canDelete` allows it; an error it throws refuses the deletion
 *  and is thrown on once nothing has changed (ADR-0023). A veto that changes the graph itself,
 *  through `Comb`, refuses too: what it was asked about may no longer be what would go. */
export function deleteSelection(
  store: GraphStore,
  bridge: Bridge,
  remove: Remove,
  canDelete?: CanDelete,
): void {
  refuseIfLost();
  const found = doomed(store, bridge);
  if (!found) return;
  const before = store.getState().change;
  // A copy, so that a veto that writes into what it is asked about changes nothing that goes.
  if (canDelete && canDelete({ nodes: [...found.nodes], edges: [...found.edges] }) !== true) return;
  if (store.getState().change !== before) return;
  if (found.nodes.length > 0) remove("nodes", found.nodes);
  else remove("edges", found.edges);
}

/** Makes `canvas` focusable, focused by a press, and deletes the selection on Delete or
 *  Backspace while it is focused; returns the function that removes the listeners. */
export function attachDeletion(
  canvas: HTMLCanvasElement,
  store: GraphStore,
  bridge: Bridge,
  remove: Remove,
  canDelete?: CanDelete,
): () => void {
  canvas.tabIndex = 0;
  const focus = () => canvas.focus({ preventScroll: true });
  // Once the engine is lost, a key changes nothing.
  const deleting = untilLost(() => deleteSelection(store, bridge, remove, canDelete));
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
