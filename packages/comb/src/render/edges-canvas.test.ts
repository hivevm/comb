import { describe, expect, test } from "bun:test";
import type { FillInstruction } from "pixi.js";
import type { Visible } from "../bridge";
import { EdgeFill, fillOf } from "./edges-canvas";

/** The engine's colour as it lies in memory, read as the Uint32 the mesh hands over. */
function rgba(r: number, g: number, b: number, a: number): number {
  return new Uint32Array(new Uint8Array([r, g, b, a]).buffer)[0]!;
}

describe("edges on Canvas 2D", () => {
  test("a vertex colour fills in the colour and alpha of its bytes R, G, B, A", () => {
    // Verifies: ADR-0018
    expect(fillOf(rgba(0x12, 0x34, 0x56, 0x80))).toEqual({ color: 0x123456, alpha: 0x80 / 255 });
  });

  test("each run of triangles of one colour is one fill of the one drawing", () => {
    // Verifies: ADR-0018
    // Three triangles over a strip of five vertices: two green, then one red.
    const green = rgba(0x22, 0xa5, 0x5b, 0xff);
    const red = rgba(0xe0, 0x45, 0x3a, 0xff);
    const mesh = {
      positions: new Float32Array([0, 0, 10, 0, 0, 10, 10, 10, 20, 0]),
      distances: new Float32Array(5),
      colors: new Uint32Array([green, green, green, red, red]),
      dashes: new Float32Array(10),
      indices: new Uint32Array([0, 1, 2, 2, 1, 3, 3, 4, 1]),
    };
    const fill = new EdgeFill();
    fill.sync({ mesh } as unknown as Visible);
    const fills = fill.drawing.context.instructions.filter(
      (i): i is FillInstruction => i.action === "fill",
    );
    expect(
      fills.map((i) => [i.data.style.color, i.data.path.shapePath.shapePrimitives.length]),
    ).toEqual([
      [0x22a55b, 2],
      [0xe0453a, 1],
    ]);
    expect(fill.triangles()).toBe(3);
  });
});
