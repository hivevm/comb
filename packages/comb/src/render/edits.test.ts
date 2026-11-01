// The edits the scene reads from the store's arrays against those a kept query drew (ADR-0040).
import { expect, test } from "bun:test";
import { EDIT_BOUND, edited, editsSince, NO_EDITS } from "./edits";

const node = (id: string) => ({ id, width: 100 });
const edge = (id: string) => ({ id, source: "a", target: "b" });

test("a slot empty then and filled now is added, filled then and empty now is removed", () => {
  // Verifies: ADR-0040
  const [a, b, c] = [node("a"), node("b"), node("c")];
  const [e, f] = [edge("e"), edge("f")];
  const kept = { nodes: [a, b], edges: [e, undefined] };
  const now = { nodes: [a, undefined, c], edges: [undefined, f] };
  expect(editsSince(kept, now)).toEqual({
    addedNodes: [2],
    removedNodes: [1],
    addedEdges: [1],
    removedEdges: [0],
  });
  expect(editsSince(kept, kept)).toEqual(NO_EDITS);
  expect(edited(NO_EDITS)).toBe(false);
  expect(edited(editsSince(kept, now)!)).toBe(true);
});

test("a slot filled in both by another object, or more slots than the bound, is no edit", () => {
  // Verifies: ADR-0040
  const a = node("a");
  // A change of content, or a slot the engine reused, replaces the object.
  expect(editsSince({ nodes: [a], edges: [] }, { nodes: [{ ...a }], edges: [] })).toBeNull();
  const many = Array.from({ length: EDIT_BOUND + 1 }, (_, i) => node(`n${i}`));
  expect(editsSince({ nodes: [], edges: [] }, { nodes: many, edges: [] })).toBeNull();
  expect(editsSince({ nodes: [], edges: [] }, { nodes: many.slice(1), edges: [] })).not.toBeNull();
  // The bound counts nodes and edges together.
  const half = many.slice(0, 200);
  const edges = Array.from({ length: 100 }, (_, i) => edge(`e${i}`));
  expect(editsSince({ nodes: [], edges: [] }, { nodes: half, edges })).toBeNull();
});
