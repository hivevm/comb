// The pool of a layer's views keeps the layer's children in the order a render binds them, bottom
// to top, whatever order the views were bound in before (ADR-0027).
import { describe, expect, test } from "bun:test";
import { Container } from "pixi.js";
import { Bindings, type Pooled } from "./bindings";

class View extends Container implements Pooled {
  seen = 0;
  slot = -1;
}

/** Binds `slots` in their order in one render, and returns the slots of the layer's children. */
function render(bindings: Bindings<View>, layer: Container, slots: number[]): number[] {
  bindings.begin();
  for (const slot of slots) bindings.bind(slot);
  bindings.end();
  return layer.children.map((child) => (child as View).slot);
}

describe("bindings", () => {
  test("the layer's children follow the order of each render, kept and new views alike", () => {
    // Verifies: ADR-0027
    const layer = new Container();
    const bindings = new Bindings(layer, () => new View());
    // Each render's order, as a query returns nodes by rank: new views after kept ones, before
    // them, between them, and kept views in another order than before.
    const renders = [
      [3, 1, 2],
      [3, 1, 2, 7],
      [5, 3, 1, 2, 7],
      [3, 6, 1, 2],
      [2, 3, 6, 1],
      [2, 3, 6, 1],
      [9],
    ];
    for (const slots of renders) expect(render(bindings, layer, slots)).toEqual(slots);
    // Seven slots were bound, by six views: 6 came in the render that released 5 and 7, whose
    // views return to the pool only at its end, and 9 took a released one.
    expect(bindings.created).toBe(6);
  });
});
