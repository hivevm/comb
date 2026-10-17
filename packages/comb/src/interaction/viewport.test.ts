import { describe, expect, test } from "bun:test";
import { fitViewport, panBy, zoomAt } from "./viewport";

const toWorld = (v: { x: number; y: number; scale: number }, px: number, py: number) => ({
  x: (px - v.x) / v.scale,
  y: (py - v.y) / v.scale,
});

describe("viewport", () => {
  test("zooming keeps the world point under the pointer", () => {
    const before = { x: 30, y: -20, scale: 1.5 };
    for (const factor of [0.5, 1.1, 2]) {
      const after = zoomAt(before, 400, 250, factor);
      const a = toWorld(before, 400, 250);
      const b = toWorld(after, 400, 250);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
    }
  });

  test("the scale stays within its bounds", () => {
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 0, 0, 1000).scale).toBe(4);
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 0, 0, 0.0001).scale).toBe(0.05);
  });

  test("fitting centres the bounds and never zooms in beyond 1", () => {
    const small = fitViewport({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 800, 600);
    expect(small).toEqual({ x: 350, y: 275, scale: 1 });
    const large = fitViewport({ minX: -1000, minY: -500, maxX: 1000, maxY: 500 }, 840, 640);
    expect(large.scale).toBeCloseTo(0.38, 9);
    expect(toWorld(large, 420, 320).x).toBeCloseTo(0, 9);
    expect(toWorld(large, 420, 320).y).toBeCloseTo(0, 9);
  });

  test("panning moves the viewport by the screen delta", () => {
    expect(panBy({ x: 1, y: 2, scale: 3 }, 10, -5)).toEqual({ x: 11, y: -3, scale: 3 });
  });
});
