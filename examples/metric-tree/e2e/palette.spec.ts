// A node dropped from the host's palette (G-1): `worldPointAt` names the world point under a
// point of the page, and the example adds a node of the palette's kind there (ADR-0030).
import { expect, test, type Page } from "@playwright/test";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  open,
  recordChanges,
  screenCentre,
  setViewport,
  told,
} from "./shared";

/** Moves the canvas away from the page's corner, by a margin on its left and top, and scales it
 *  with CSS by `scale`, and waits until Comb has drawn at its new size. */
async function offsetCanvas(page: Page, scale = 1): Promise<void> {
  await page.evaluate(async (cssScale) => {
    const canvas = document.getElementById("canvas")!;
    canvas.style.marginLeft = "37px";
    canvas.style.marginTop = "23px";
    canvas.style.transformOrigin = "0 0";
    canvas.style.transform = `scale(${cssScale})`;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await window.comb.whenRendered();
  }, scale);
}

for (const scale of [1, 0.5]) {
  test(`worldPointAt returns the world point that screenPoint takes back to the point of the page, at a CSS scale of ${scale}`, async ({
    page,
  }) => {
    // Verifies: G-1, ADR-0030
    await open(page);
    await offsetCanvas(page, scale);
    await setViewport(page, { x: -153.25, y: 87.5, scale: 0.37 });
    const misses = await page.evaluate((cssScale) => {
      const canvas = document.querySelector("#canvas canvas")!.getBoundingClientRect();
      const points = [
        [0, 0],
        [12.5, 300.25],
        [640, 17],
      ] as const;
      return points.filter(([sx, sy]) => {
        const world = window.comb.worldPointAt(
          canvas.left + sx * cssScale,
          canvas.top + sy * cssScale,
        );
        const back = window.screenPoint(world.x, world.y);
        return Math.abs(back.x - sx) > 0.01 || Math.abs(back.y - sy) > 0.01;
      });
    }, scale);
    expect(misses).toEqual([]);
  });
}

test("worldPointAt refuses a coordinate that is not finite", async ({ page }) => {
  // Verifies: ADR-0030
  await open(page);
  const refused = await page.evaluate(() =>
    [
      [Number.NaN, 0],
      [0, Number.POSITIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, 0],
    ].map(([x, y]) => {
      try {
        window.comb.worldPointAt(x!, y!);
        return "answered";
      } catch (error) {
        return (error as Error).name;
      }
    }),
  );
  expect(refused).toEqual(["RangeError", "RangeError", "RangeError"]);
});

test("a kind dragged from the palette and dropped on the canvas becomes a node under the drop", async ({
  page,
}) => {
  // Verifies: G-1
  await open(page);
  await offsetCanvas(page);
  await setViewport(page, { x: 40, y: 30, scale: 0.8 });
  await recordChanges(page);
  const canvas = page.locator("#canvas canvas");
  const box = (await canvas.boundingBox())!;
  // Far below the tree, where no node lies.
  const at = { x: 500, y: box.height - 60 };
  await page.locator('#palette [data-kind="epic"]').dragTo(canvas, { targetPosition: at });
  const dropped = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().nodes.find(({ id }) => id === "epic-1");
  });
  const result = { node: dropped, told: await told(page) };
  // The drop lies at the node's centre: world (500 - 40, height - 60 - 30) / 0.8.
  const centre = { x: (at.x - 40) / 0.8, y: (at.y - 30) / 0.8 };
  expect(result.node).toMatchObject({ id: "epic-1", title: "New epic" });
  expect(result.node!.x).toBeCloseTo(centre.x - NODE_WIDTH / 2, 2);
  expect(result.node!.y).toBeCloseTo(centre.y - NODE_HEIGHT / 2, 2);
  expect(result.told).toHaveLength(1);
  expect(result.told[0]).toMatchObject({ kind: "nodeAdded", by: "host", node: { id: "epic-1" } });
  // The example's listener took the node into its graph: its sidebar edits it once selected.
  await expect(page.locator("#count")).toHaveText("16 nodes, 15 edges");
  const press = await screenCentre(page, "epic-1");
  await page.mouse.click(press.x, press.y);
  await expect(page.locator("#selection")).toBeVisible();
  await expect(page.locator("#title")).toHaveValue("New epic");
});
