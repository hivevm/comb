import { describe, expect, test } from "bun:test";
import { pieceOutline } from "./nodes";

/** The points of `outline` as pairs `[x, y]`. */
const pairs = (outline: number[]): [number, number][] =>
  Array.from({ length: outline.length / 2 }, (_, i) => [outline[2 * i]!, outline[2 * i + 1]!]);

describe("the outline of a piece of a progress bar", () => {
  test("rounds only the bar's outer ends, by its radius, and leaves the pieces between square", () => {
    // Verifies: ADR-0013
    // A bar from 12 to 208, 8 high from 32, its ends rounded by 4: a segment from 12 to 70.8, a
    // segment from 70.8 to 110, and the track from 110 to 208.
    const piece = (x: number, width: number) => ({ x, y: 32, width, height: 8, color: 0 });
    const outline = (x: number, width: number) => pairs(pieceOutline(piece(x, width), 12, 208, 4));
    const [first, middle, track] = [outline(12, 58.8), outline(70.8, 39.2), outline(110, 98)];
    // A piece between the ends is its rectangle.
    expect(middle).toEqual([
      [70.8, 32],
      [110, 32],
      [110, 40],
      [70.8, 40],
    ]);
    // The first piece's left side is the bar's rounded end: its corner at the middle of the
    // bar's height, its right side square.
    expect(first[0]).toEqual([12, 36]);
    expect(first.at(-1)).toEqual([12, 36]);
    expect(first).toContainEqual([70.8, 32]);
    expect(first).toContainEqual([70.8, 40]);
    // The track's right side likewise; within the radius of an end every point lies on the
    // circle of radius 4 about (12 + 4, 36) or (208 - 4, 36).
    expect(track).toContainEqual([208, 36]);
    for (const [x, y] of [...first, ...track]) {
      const centre = x < 16 ? 16 : x > 204 ? 204 : x;
      const reach = Math.hypot(x - centre, y - 36);
      if (centre !== x) expect(Math.abs(reach - 4)).toBeLessThan(1e-9);
      else expect([32, 36, 40]).toContain(y);
    }
  });
});
