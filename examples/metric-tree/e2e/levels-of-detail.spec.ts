// The three levels of detail, chosen by zoom (ADR-0027).
import { expect, test } from "@playwright/test";
import { canvasSize, open, sceneNumbers, screenCentre, setViewport } from "./shared";

test("zooming through each threshold switches the level of detail", async ({ page }) => {
  // Verifies: ADR-0027
  await open(page);
  const { width, height } = await canvasSize(page);
  const { near: nearFrom, far: middleFrom } = await sceneNumbers(page);
  const below = (scale: number) => scale - 0.001;
  // Centred on the north-star metric, at (900 + 110, 32) in world units.
  const at = async (scale: number) => {
    await setViewport(page, { x: width / 2 - 1010 * scale, y: height / 2 - 32 * scale, scale });
    return page.evaluate(() => {
      const { level, texts, particles, nodes, edgeLabels } = window.inspect();
      return { level, texts, particles, nodes: nodes.length, labels: edgeLabels.length };
    });
  };
  const near = await at(nearFrom);
  expect(near.level).toBe("near");
  expect(near.labels).toBeGreaterThan(0);
  expect(near.texts).toBe(near.nodes + near.labels);
  const middle = await at(below(nearFrom));
  expect(middle).toMatchObject({ level: "middle", labels: 0, particles: 0 });
  expect(middle.texts).toBe(middle.nodes);
  expect((await at(middleFrom)).level).toBe("middle");
  const far = await at(below(middleFrom));
  expect(far).toMatchObject({ level: "far", texts: 0, labels: 0 });
  expect(far.particles).toBe(far.nodes);
  expect(far.nodes).toBeGreaterThan(0);
});

test("at the far level, a click selects the node under it and the canvas shows it", async ({
  page,
}) => {
  await open(page);
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width / 2, y: height / 2, scale: 0.2 });
  expect(await page.evaluate(() => window.inspect().level)).toBe("far");
  const centre = await screenCentre(page, "0:0.0");
  // Hovering over the node offers to grab it.
  await page.mouse.move(centre.x, centre.y);
  expect(
    await page.evaluate(
      () => document.querySelector<HTMLCanvasElement>("#canvas canvas")!.style.cursor,
    ),
  ).toBe("grab");
  await page.mouse.click(centre.x, centre.y);
  await page.evaluate(() => window.comb.whenRendered());
  await expect(page.locator("#title")).toHaveValue("Launch push notifications");
  expect(await page.evaluate(() => window.inspect().highlighted)).toBe("0:0.0");
});
