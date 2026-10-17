import { expect, test, type Page } from "@playwright/test";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 64;

/** Opens the example and waits until its first load has drawn. */
async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`/${query}`);
  // The example sets loadReport after a top-level await, which the load event does not wait for.
  await page.waitForFunction(() => "loadReport" in window);
  await page.evaluate(() => window.loadReport);
}

/** A node's position in world coordinates, as the canvas draws it. */
async function drawnNode(page: Page, id: string) {
  return page.evaluate((id) => window.inspect().nodes.find((node) => node.id === id), id);
}

/** The screen point at the centre of a drawn node. */
async function screenCentre(page: Page, id: string) {
  return page.evaluate(
    ({ id, w, h }) => {
      const snapshot = window.inspect();
      const node = snapshot.nodes.find((candidate) => candidate.id === id)!;
      const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
      const { x, y, scale } = snapshot.viewport;
      return {
        x: rect.left + x + (node.x + w / 2) * scale,
        y: rect.top + y + (node.y + h / 2) * scale,
      };
    },
    { id, w: NODE_WIDTH, h: NODE_HEIGHT },
  );
}

test("the example draws the metric tree on a canvas beside its sidebar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await expect(page.locator("#canvas canvas")).toBeVisible();
  await expect(page.locator("#count")).toHaveText("15 nodes, 15 edges");
  expect(errors).toEqual([]);
});

test("the copies query parameter sets the size without the control", async ({ page }) => {
  await open(page, "?copies=10");
  await expect(page.locator("#copies")).toHaveValue("10");
  await expect(page.locator("#count")).toHaveText("150 nodes, 150 edges");
  expect((await page.evaluate(() => window.loadReport)).nodes).toBe(150);
});

test("picking the largest copies option shows at least 50,000 nodes and edges", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page);
  const largest = await page
    .locator("#copies option")
    .evaluateAll((options) => (options.at(-1) as HTMLOptionElement).value);
  await page.locator("#copies").selectOption(largest);
  const report = await page.evaluate(() => window.loadReport);
  expect(report.nodes).toBeGreaterThanOrEqual(50_000);
  expect(report.edges).toBeGreaterThanOrEqual(50_000);
  await expect(page.locator("#count")).toHaveText(`${report.nodes} nodes, ${report.edges} edges`);
  // Shown, not only loaded: the canvas draws every node and edge, since all are in view.
  const drawn = await page.evaluate(() => {
    const snapshot = window.inspect();
    return { nodes: snapshot.nodes.length, edges: snapshot.edges.length };
  });
  expect(drawn).toEqual({ nodes: report.nodes, edges: report.edges });
});

test("dragging a node moves it with its edges and edge labels, and a click shows it in the sidebar", async ({
  page,
}) => {
  await open(page);
  const northStar = "0:3.0";
  const before = (await drawnNode(page, northStar))!;
  const from = await screenCentre(page, northStar);
  const scale = await page.evaluate(() => window.inspect().viewport.scale);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 100, { steps: 10 });
  await page.mouse.up();
  await page.evaluate(() => window.comb.whenRendered());

  const after = (await drawnNode(page, northStar))!;
  expect(after.x).toBeCloseTo(before.x, 3);
  expect(after.y - before.y).toBeCloseTo(100 / scale, 1);

  // The edge from "Avg. shares per session" ends at the moved node's left anchor, and its label,
  // at t = 0.5 with offset 0, sits at the midpoint between its two anchors.
  const snapshot = await page.evaluate(() => window.inspect());
  const source = snapshot.nodes.find((node) => node.id === "0:2.3")!;
  const edge = snapshot.edges.find((candidate) => candidate.id === "0:2.3-3.0")!;
  expect(edge.target.x).toBeCloseTo(after.x, 3);
  expect(edge.target.y).toBeCloseTo(after.y + NODE_HEIGHT / 2, 3);
  const label = snapshot.edgeLabels.find((candidate) => candidate.edge === "0:2.3-3.0")!;
  expect(label.x).toBeCloseTo((source.x + NODE_WIDTH + after.x) / 2, 1);
  expect(label.y).toBeCloseTo((source.y + after.y + NODE_HEIGHT) / 2, 1);

  const moved = await screenCentre(page, northStar);
  await page.mouse.click(moved.x, moved.y);
  await expect(page.locator("#selection")).toBeVisible();
  await expect(page.locator("#title")).toHaveValue("Time spent listening to music by subscribers");
});
