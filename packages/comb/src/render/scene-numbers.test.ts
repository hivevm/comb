import { describe, expect, test } from "bun:test";
import { sceneNumbers } from "../testing";

describe("scene numbers", () => {
  test("the numbers the browser tests read are the ones ADR-0012 decides", () => {
    // Verifies: ADR-0027
    // Taken from the ADR's text, not from the code: the browser tests follow the code, so this is
    // the one place that holds the code to the decision. The label reach is the scene's own: half
    // the width of a label of up to 224 pixels, which the ADR leaves to it.
    expect(sceneNumbers()).toEqual({
      near: 0.6,
      far: 0.3,
      cullingMargin: 128,
      labelReach: 120,
      rescale: 1.25,
    });
  });
});
