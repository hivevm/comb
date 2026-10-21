// Panning and zooming the viewport (G-8).
import { expect, test } from "@playwright/test";
import { canvasOrigin, canvasSize, open, setViewport } from "./shared";

test("a viewport that is not finite is refused, and the scale is clamped", async ({ page }) => {
  await open(page);
  const refused = await page.evaluate(() => {
    try {
      window.comb.setViewport({ x: Number.NaN, y: 0, scale: 1 });
      return null;
    } catch (error) {
      return (error as Error).name;
    }
  });
  expect(refused).toBe("RangeError");
  await setViewport(page, { x: 10, y: 20, scale: 1e6 });
  expect(await page.evaluate(() => window.comb.viewport())).toEqual({ x: 10, y: 20, scale: 4 });
});

test("dragging the empty canvas pans the viewport by the pointer's movement", async ({ page }) => {
  // Verifies: G-8
  await open(page);
  const origin = await canvasOrigin(page);
  const { height } = await canvasSize(page);
  // Near the bottom-left corner, inside the margin fitView leaves around the tree.
  const from = { x: origin.left + 10, y: origin.top + height - 10 };
  await page.mouse.move(from.x, from.y);
  const before = await page.evaluate(() => window.comb.viewport());
  await page.mouse.down();
  await page.mouse.move(from.x + 120, from.y - 80, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => window.comb.whenRendered());
  const after = await page.evaluate(() => window.comb.viewport());
  expect(after.x - before.x).toBeCloseTo(120, 3);
  expect(after.y - before.y).toBeCloseTo(-80, 3);
  expect(after.scale).toBe(before.scale);
  // Drawn so: the canvas shows the world through the panned viewport.
  expect(await page.evaluate(() => window.inspect().viewport)).toEqual(after);
});

test("the wheel zooms in and out about the world point under the pointer", async ({ page }) => {
  // Verifies: G-8
  await open(page);
  const origin = await canvasOrigin(page);
  const { width, height } = await canvasSize(page);
  // Away from the canvas's centre, so that a zoom about the centre moves the point.
  const pointer = { x: width * 0.25, y: height * 0.3 };
  const world = await page.evaluate(({ x, y }) => {
    const { x: vx, y: vy, scale } = window.comb.viewport();
    return { x: (x - vx) / scale, y: (y - vy) / scale };
  }, pointer);
  await page.mouse.move(origin.left + pointer.x, origin.top + pointer.y);
  const under = async () =>
    page.evaluate(async ({ x, y }) => {
      await window.comb.whenRendered();
      return { at: window.screenPoint(x, y), scale: window.inspect().viewport.scale };
    }, world);
  const start = await under();

  await page.mouse.wheel(0, -200);
  const zoomedIn = await under();
  expect(zoomedIn.scale).toBeGreaterThan(start.scale);
  expect(Math.abs(zoomedIn.at.x - pointer.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(zoomedIn.at.y - pointer.y)).toBeLessThanOrEqual(1);

  await page.mouse.wheel(0, 400);
  const zoomedOut = await under();
  expect(zoomedOut.scale).toBeLessThan(zoomedIn.scale);
  expect(zoomedOut.scale).toBeLessThan(start.scale);
  expect(Math.abs(zoomedOut.at.x - pointer.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(zoomedOut.at.y - pointer.y)).toBeLessThanOrEqual(1);
});
