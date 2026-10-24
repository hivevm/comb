// The edge `addEdge` hands the bridge, read once (ADR-0026): defaults filled where the host left
// a field out, and no key for a dash, a label, or a label's background it left out, so that the
// edge as Comb keeps it, and as `edgeAdded` delivers it, holds none.
import { expect, test } from "bun:test";
import { edgeSnapshotOf } from "./snapshot";

const limits = { text: 1000, id: 256, idBudget: 64_000_000 };

test("an edge read once fills its defaults and keeps no key for a field left out", () => {
  // Verifies: ADR-0026, ADR-0024
  const { snapshot } = edgeSnapshotOf(
    { id: "e", source: "a", target: "b", label: { text: "x", t: 0.5, offset: 0 } },
    limits,
  );
  expect(Object.keys(snapshot).sort()).toEqual(
    ["arrow", "color", "id", "label", "source", "sourceSide", "target", "targetSide"].sort(),
  );
  expect(Object.keys((snapshot as { label: object }).label).sort()).toEqual([
    "offset",
    "t",
    "text",
  ]);
  const bare = edgeSnapshotOf({ id: "e", source: "a", target: "b" }, limits).snapshot;
  expect("dash" in bare || "label" in bare).toBe(false);
  expect(bare).toMatchObject({ arrow: "end", sourceSide: "right", targetSide: "left" });
});
