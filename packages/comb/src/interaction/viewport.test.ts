import { describe, expect, test } from "bun:test";
import { fitViewport, panBy, toScreen, toWorld as worldOf, worldRect, zoomAt } from "./viewport";

// An oracle of its own, independent of the transform the module exports.
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
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 0, 0, 0.0001).scale).toBe(0.005);
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

  test("the transform maps world to screen and back, with literal values", () => {
    const viewport = { x: 100, y: 50, scale: 2 };
    expect(toScreen(viewport, 10, -5)).toEqual({ x: 120, y: 40 });
    expect(worldOf(viewport, 120, 40)).toEqual({ x: 10, y: -5 });
    expect(worldOf(viewport, 0, 0)).toEqual({ x: -50, y: -25 });
  });

  test("the world rectangle of a screen, grown by a margin, has literal values", () => {
    const viewport = { x: 100, y: 50, scale: 2 };
    expect(worldRect(viewport, 800, 600)).toEqual({ minX: -50, minY: -25, maxX: 350, maxY: 275 });
    expect(worldRect(viewport, 800, 600, 10)).toEqual({
      minX: -55,
      minY: -30,
      maxX: 355,
      maxY: 280,
    });
  });
});
