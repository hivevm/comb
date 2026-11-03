// The edits since a query the scene keeps at the far level (ADR-0027): the slots in which the
// store's nodes and edges differ from the arrays the query drew, compared slot by slot, so that
// several edits within a frame count as the slots they changed.
import type { GraphView } from "../store";

/** The slots edits added and removed since a kept query, each in ascending order. */
export interface Edits {
  addedNodes: number[];
  removedNodes: number[];
  addedEdges: number[];
  removedEdges: number[];
}

/** No edit. */
export const NO_EDITS: Edits = {
  addedNodes: [],
  removedNodes: [],
  addedEdges: [],
  removedEdges: [],
};

/** The most slots edits may change before the scene queries anew: what the moving layer draws each
 *  frame, and what a comparison collects, stay that small. */
export const EDIT_BOUND = 256;

type Arrays = Pick<GraphView, "nodes" | "edges">;

/** The slots of `now` that differ from `kept`, as added or removed into `added` and `removed`;
 *  false where one is filled in both by another object, or where more than `room` differ. */
function compare<T>(
  kept: readonly (T | undefined)[],
  now: readonly (T | undefined)[],
  added: number[],
  removed: number[],
  room: number,
): boolean {
  const length = Math.max(kept.length, now.length);
  for (let slot = 0; slot < length; slot++) {
    const [before, after] = [kept[slot], now[slot]];
    if (before === after) continue;
    if (before && after) return false;
    (after ? added : removed).push(slot);
    if (added.length + removed.length > room) return false;
  }
  return true;
}

/** The edits that turn `kept` into `now`, or none where the scene must query anew: a slot filled in
 *  both by another object, a change of content, style, or label or a slot reused, or more than
 *  `bound` slots changed between the nodes and the edges. */
export function editsSince(kept: Arrays, now: Arrays, bound = EDIT_BOUND): Edits | null {
  const edits: Edits = { addedNodes: [], removedNodes: [], addedEdges: [], removedEdges: [] };
  if (!compare(kept.nodes, now.nodes, edits.addedNodes, edits.removedNodes, bound)) return null;
  const room = bound - edits.addedNodes.length - edits.removedNodes.length;
  if (!compare(kept.edges, now.edges, edits.addedEdges, edits.removedEdges, room)) return null;
  return edits;
}

/** Whether `edits` added or removed anything. */
export const edited = (edits: Edits) =>
  edits.addedNodes.length +
    edits.removedNodes.length +
    edits.addedEdges.length +
    edits.removedEdges.length >
  0;
