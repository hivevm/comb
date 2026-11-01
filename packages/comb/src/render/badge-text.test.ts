import { describe, expect, test } from "bun:test";
import { badgeTextColor } from "./nodes";

/** The near-black of the node's texts, which a badge's text takes on a light pill. */
const NEAR_BLACK = 0x1f2430;

describe("a badge's text colour", () => {
  test("is white or near-black, whichever contrasts more with the pill, white on a tie", () => {
    // Verifies: ADR-0013
    // By WCAG's relative luminance, against white and against 0x1F2430: the greys switch between
    // 0x808080, whose contrast with white is 3.95 and with the near-black 3.93, and 0x818181,
    // 3.90 and 3.98.
    expect(badgeTextColor(0x808080)).toBe(0xffffff);
    expect(badgeTextColor(0x818181)).toBe(NEAR_BLACK);
    expect(badgeTextColor(0x000000)).toBe(0xffffff);
    expect(badgeTextColor(0xffffff)).toBe(NEAR_BLACK);
    // Of the colours of a status: blue and grey take white, green and amber the near-black.
    expect(badgeTextColor(0x2563eb)).toBe(0xffffff);
    expect(badgeTextColor(0x6b7280)).toBe(0xffffff);
    expect(badgeTextColor(0x22c55e)).toBe(NEAR_BLACK);
    expect(badgeTextColor(0xf59e0b)).toBe(NEAR_BLACK);
    // On a pill of the near-black itself, white.
    expect(badgeTextColor(NEAR_BLACK)).toBe(0xffffff);
  });
});
