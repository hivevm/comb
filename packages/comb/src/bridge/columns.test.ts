// The writers of a load's columns on their own, without the engine (ADR-0034).
import { expect, test } from "bun:test";
import { edgeColumns, nodeColumns } from "./columns";

test("a value longer than the bound on a piece fits in none, and the writer refuses it", () => {
  // Verifies: ADR-0034
  expect(() => nodeColumns(1, 16).node("x".repeat(17), 0, 0, 1)).toThrow(RangeError);
  expect(() =>
    nodeColumns(1, 16).element("text", "title", 1, undefined, "x".repeat(17), undefined, true),
  ).toThrow(RangeError);
  expect(() =>
    edgeColumns(1, 16).edge(
      "e",
      "a",
      "b",
      { text: "x".repeat(17) },
      0,
      null,
      "end",
      "right",
      "left",
    ),
  ).toThrow(RangeError);
});
