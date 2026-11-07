// The label of an edge of each kind, built in one place for the diagrams' data and the sidebar's
// edits alike: on a pill of its kind's colour, where its kind places it unless it has a place
// already. The colours and places are written here from docs/CONVENTIONS.md, not read from the
// example.
// Verifies: G-12
import { expect, test } from "bun:test";
import { labelOf, styleOf } from "./relationships";

const [GREY, GREEN] = [0x6b7280, 0x15803d];

test("a new label stands where its kind places it, on a pill of its kind's colour", () => {
  expect(labelOf("association", "owns")).toEqual({
    text: "owns",
    t: 0.5,
    offset: 0,
    background: GREY,
  });
  expect(labelOf("composition", "has")).toEqual({
    text: "has",
    t: 0.4,
    offset: 0,
    background: GREEN,
  });
  expect(labelOf("transition", "edit")).toEqual({
    text: "edit",
    t: 0.5,
    offset: 14,
    background: GREY,
  });
});

test("a label keeps the place it has, and takes its kind's colour and the new text", () => {
  const current = { text: "old", t: 0.2, offset: -9, background: GREEN };
  expect(labelOf("transition", "new", current)).toEqual({
    text: "new",
    t: 0.2,
    offset: -9,
    background: GREY,
  });
});

test("a kind's style carries its label where the kind has one, and none where it has not", () => {
  expect(styleOf("dependency").label).toEqual({
    text: "«use»",
    t: 0.5,
    offset: 0,
    background: GREY,
  });
  expect(styleOf("aggregation").label).toEqual({
    text: "«aggregation»",
    t: 0.4,
    offset: 0,
    background: GREEN,
  });
  expect(styleOf("transition")).toEqual({ color: GREY, arrow: "end" });
});
