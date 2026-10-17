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
  // WebGL2, not PixiJS's Canvas 2D fallback, which draws no edge mesh.
  expect(await page.evaluate(() => window.inspect().renderer)).toBe("webgl");
  expect(errors).toEqual([]);
});

test("without WebGL, Comb refuses instead of drawing without edges", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
  // A browser without WebGL: every WebGL context is refused, as where no GPU process starts.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, id: string, options?: unknown) {
        return id.startsWith("webgl") ? null : Reflect.apply(getContext, this, [id, options]);
      },
    });
  });
  await page.goto("/");
  await expect
    .poll(() => errors)
    .toContainEqual(expect.stringContaining("RendererUnavailableError"));
  await expect(page.locator("#canvas canvas")).toHaveCount(0);
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

/** The size of the canvas on the page. */
async function canvasSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const { width, height } = document.querySelector("#canvas canvas")!.getBoundingClientRect();
    return { width, height };
  });
}

/** Sets the viewport through Comb's interface and waits until it is drawn. */
async function setViewport(page: Page, viewport: { x: number; y: number; scale: number }) {
  await page.evaluate(async (viewport) => {
    window.comb.setViewport(viewport);
    await window.comb.whenRendered();
  }, viewport);
}

test("the edges show their colours, dashes, and arrowheads", async ({ page }) => {
  // Verifies: G-11, ADR-0012
  await open(page);
  expect((await page.evaluate(() => window.inspect())).edgeTriangles).toBeGreaterThan(0);
  // The reference image, approved by eye, holds the edges alone, without the text of nodes and
  // labels, whose fonts differ between machines: grey dashed edges from bets to epics to input
  // metrics, green and red edges into and out of the north-star metric, every edge ending in an
  // arrowhead at its target.
  await page.evaluate(async () => {
    window.showLayers({ nodes: false, edgeLabels: false });
    await window.comb.whenRendered();
  });
  // Three pixels of tolerance: a single missing arrowhead differs by eight.
  await expect(page.locator("#canvas canvas")).toHaveScreenshot("metric-tree-edges.png", {
    maxDiffPixels: 3,
  });
});

test("what lies entirely outside the viewport is not bound to a display object", async ({
  page,
}) => {
  // Verifies: G-7, ADR-0012
  await open(page);
  expect((await page.evaluate(() => window.inspect())).edgeLabels).toHaveLength(7);

  // World x = 450 at the right border of the canvas: with the margin of 128 px at scale 1, the
  // query reaches x = 578, and label points 120 beyond it. Columns 0 and 1 (x < 520) are bound;
  // columns 2 to 4 (x ≥ 600), the edges into and out of the north-star metric (x ≥ 820), and
  // their labels (x ≥ 860) are not.
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width - 450, y: height / 2, scale: 1 });
  const snapshot = await page.evaluate(() => window.inspect());
  const columns = new Set(snapshot.nodes.map((node) => node.id.split(":")[1]!.split(".")[0]));
  expect([...columns].sort()).toEqual(["0", "1"]);
  expect(snapshot.edges.map((edge) => edge.id).filter((id) => /-(3|4)\./.test(id))).toEqual([]);
  expect(snapshot.edges.length).toBeGreaterThan(0);
  expect(snapshot.edgeLabels).toEqual([]);
});

test("node views draw in slot order after their nodes left the viewport and came back", async ({
  page,
}) => {
  await open(page);
  const order = async () => page.evaluate(() => window.inspect().nodes.map((node) => node.id));
  const loaded = await order();
  // World x = 700 at the left border: with the margin, columns 0 and 1 (x ≤ 520) are culled.
  const { height } = await canvasSize(page);
  await setViewport(page, { x: -700, y: height / 2, scale: 1 });
  expect((await order()).some((id) => id.startsWith("0:0."))).toBe(false);
  await page.evaluate(async () => {
    window.comb.fitView();
    await window.comb.whenRendered();
  });
  expect(await order()).toEqual(loaded);
});

test("the same area binds as many display objects at 1 and at 1,000 copies", async ({ page }) => {
  // Verifies: ADR-0012
  test.setTimeout(120_000);
  // Inside the first copy: the next copy to the right starts at x = 1500 and the one below at
  // y = 550, both beyond the canvas and its margin of 128 px at scale 1.
  const bound = async (query: string) => {
    await open(page, query);
    const { width, height } = await canvasSize(page);
    expect(width + 128).toBeLessThan(1500);
    expect(height / 2 + 128).toBeLessThan(550);
    await setViewport(page, { x: 0, y: height / 2, scale: 1 });
    return page.evaluate(() => window.inspect().displayObjects);
  };
  const one = await bound("?copies=1");
  expect(await bound("?copies=1000")).toBe(one);
});

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
