// The edge `addEdge` hands the bridge, read once (ARCH-one-workspace-per-example): defaults filled
// where the host left a field out, and no key for a dash, a label, or a label's background it left
// out, so that the edge as Comb keeps it, and as `edgeAdded` delivers it, holds none.
import { expect, test } from "bun:test";
import { edgeSnapshotOf } from "./snapshot";

const limits = {
  text: 1000,
  id: 256,
  idBudget: 64_000_000,
  contentBudget: 1e9,
  rows: 8,
  columns: 6,
  segments: 8,
  labels: 8,
};

test("an edge read once fills its defaults and keeps no key for a field left out", () => {
  // Verifies: ARCH-one-workspace-per-example, API-edges-dock-side-or-outline,
  // API-edges-dock-nodes-or-edges
  const { snapshot } = edgeSnapshotOf(
    { id: "e", source: "a", target: "b", labels: [{ id: "m", text: "x", t: 0.25, offset: 3 }] },
    limits,
  );
  expect(Object.keys(snapshot).sort()).toEqual(
    ["arrow", "color", "id", "labels", "source", "sourceSide", "target", "targetSide"].sort(),
  );
  const [label] = (snapshot as unknown as { labels: object[] }).labels;
  expect(label).toStrictEqual({ id: "m", text: "x", t: 0.25, offset: 3 });
  const bare = edgeSnapshotOf({ id: "e", source: "a", target: "b" }, limits).snapshot;
  expect("dash" in bare || "labels" in bare || "lightning" in bare).toBe(false);
  expect(bare).toMatchObject({ arrow: "end", sourceSide: "right", targetSide: "left" });
});

test("a label read once without a place sits at 0.5 and 0, and without a background holds none", () => {
  // Verifies: API-edges-dock-nodes-or-edges
  const labels = [{ id: "m", text: "x" }];
  const { snapshot } = edgeSnapshotOf(
    { id: "e", source: "a", target: "b", color: 0x22, labels },
    limits,
  );
  const [label] = (snapshot as unknown as { labels: object[] }).labels;
  // No background filled in: it follows the edge's colour (decided on 2026-11-19).
  expect(label).toStrictEqual({ id: "m", text: "x", t: 0.5, offset: 0 });
  // At most one label past the limit is read; `label`, which `labels` replaced, is kept as false.
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, text: "x" }));
  const read = edgeSnapshotOf(
    { id: "e", source: "a", target: "b", labels: many, label: { text: "x" } },
    limits,
  ).snapshot as unknown as { labels: object[]; label: unknown };
  expect([read.labels.length, read.label]).toEqual([limits.labels + 1, false]);
});

test("a loop read once without sides fills in the top for both, and keeps the sides it names", () => {
  // Verifies: API-edges-dock-side-or-outline
  const loop = edgeSnapshotOf({ id: "e", source: "a", target: "a" }, limits).snapshot;
  expect(loop).toMatchObject({ sourceSide: "top", targetSide: "top" });
  const named = edgeSnapshotOf(
    { id: "e", source: "a", target: "a", sourceSide: "left" },
    limits,
  ).snapshot;
  expect(named).toMatchObject({ sourceSide: "left", targetSide: "top" });
});
