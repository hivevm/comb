import { expect, test } from "bun:test";
import type { NodePatch } from "../store";
import { NODE_PATCH_READS } from "./changes";

/** Each key of `NodePatch`, which the type checker holds complete: a key it lacks or one
 *  `NodePatch` does not have fails to compile. */
const keys: { readonly [K in keyof Required<NodePatch>]: K } = {
  content: "content",
  height: "height",
  resizable: "resizable",
  outline: "outline",
  divide: "divide",
  regions: "regions",
  side: "side",
  offset: "offset",
};

test("the delivery of nodeUpdated names for each field of a patch where it reads it, once", () => {
  // Verifies: API-edits-report-division-moves
  expect(Object.keys(NODE_PATCH_READS).sort()).toEqual(Object.keys(keys).sort());
});
