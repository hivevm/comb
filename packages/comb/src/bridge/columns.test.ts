// The writers of a load's columns on their own, without the engine
// (API-bridge-columns-carry-nesting).
import { expect, test } from "bun:test";
import { edgeColumns, nodeColumns } from "./columns";

test("a value longer than the bound on a piece fits in none, and the writer refuses it", () => {
  // Verifies: API-bridge-columns-carry-nesting
  expect(() => nodeColumns(1, 16).node("x".repeat(17), 0, 0, 1, "rectangle", null, null)).toThrow(
    RangeError,
  );
  expect(() =>
    nodeColumns(1, 16).element("text", "title", 1, undefined, "x".repeat(17), undefined, true),
  ).toThrow(RangeError);
  expect(() =>
    edgeColumns(1, 16).edge(
      "e",
      { node: "a", edge: undefined, t: undefined, side: "right" },
      { node: "b", edge: undefined, t: undefined, side: "left" },
      undefined,
      [{ id: "m", text: "x".repeat(17) }],
      0,
      null,
      "end",
      undefined,
    ),
  ).toThrow(RangeError);
});
