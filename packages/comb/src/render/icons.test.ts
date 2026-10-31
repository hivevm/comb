// The icons a host application registered: a name registered again replaces its texture and
// releases the old one, and an image is fitted into an icon's square with its aspect kept.
import { describe, expect, test } from "bun:test";
import { Icons, type IconImage } from "./icons";
import { fitted } from "./nodes";

/** A stand-in for a loaded image of `width` × `height`, as a texture source reads one. */
const image = (width: number, height: number) => ({ width, height }) as unknown as IconImage;

describe("the registered icons", () => {
  test("a name registered again holds the new texture and destroys the old one at its release", () => {
    // Verifies: ADR-0013
    const icons = new Icons();
    expect(icons.get("bet")).toBeUndefined();
    const first = image(16, 16);
    icons.register("bet", first);
    const old = icons.get("bet")!;
    expect([old.width, old.height, icons.version]).toEqual([16, 16, 1]);
    icons.register("bet", image(32, 16));
    const now = icons.get("bet")!;
    expect(now).not.toBe(old);
    expect([now.width, now.height, icons.version]).toEqual([32, 16, 2]);
    // Kept until the views that drew it have taken the new one.
    expect(old.destroyed).toBe(false);
    icons.release();
    expect(old.destroyed).toBe(true);
    expect(now.destroyed).toBe(false);
    expect([icons.nameOf(now), icons.nameOf(old)]).toEqual(["bet", null]);
    // The host application's image is its own: left as it was.
    expect(first).toEqual(image(16, 16));
    icons.destroy();
    expect(now.destroyed).toBe(true);
    expect(icons.get("bet")).toBeUndefined();
  });
});

describe("an image in an icon's square", () => {
  test("is fitted with its aspect kept and centred", () => {
    // Verifies: ADR-0013
    const square = { x: 12, y: 10, width: 16, height: 16 };
    expect(fitted(square, 64, 64)).toEqual(square);
    expect(fitted(square, 32, 16)).toEqual({ x: 12, y: 14, width: 16, height: 8 });
    expect(fitted(square, 10, 40)).toEqual({ x: 18, y: 10, width: 4, height: 16 });
  });
});
