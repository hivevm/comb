import { describe, expect, test } from "bun:test";
import { drawsWith, preferenceFor } from "./renderers";

describe("renderers", () => {
  test("by default, Comb asks for WebGL2 and draws with nothing else", () => {
    // Verifies: ADR-0018
    expect(preferenceFor({})).toBe("webgl");
    expect(["webgl", "webgpu", "canvas"].filter((name) => drawsWith({}, name))).toEqual(["webgl"]);
  });

  test("opted in, Comb asks for WebGL2, then Canvas 2D, never WebGPU", () => {
    // Verifies: ADR-0018
    const options = { allowCanvasFallback: true };
    // PixiJS tries WebGPU between WebGL and Canvas 2D unless the preference lists the renderers.
    expect(preferenceFor(options)).toEqual(["webgl", "canvas"]);
    expect(["webgl", "webgpu", "canvas"].filter((name) => drawsWith(options, name))).toEqual([
      "webgl",
      "canvas",
    ]);
  });
});
