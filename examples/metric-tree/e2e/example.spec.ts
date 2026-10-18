import { expect, test, type Page } from "@playwright/test";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 64;

/** The numbers the scene draws by, from comb/testing. */
async function sceneNumbers(page: Page) {
  return page.evaluate(() => window.sceneNumbers());
}

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
      const node = window.inspect().nodes.find((candidate) => candidate.id === id)!;
      const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
      const at = window.screenPoint(node.x + w / 2, node.y + h / 2);
      return { x: rect.left + at.x, y: rect.top + at.y };
    },
    { id, w: NODE_WIDTH, h: NODE_HEIGHT },
  );
}

test("the example draws the metric tree on a canvas beside its sidebar", async ({ page }) => {
  // Verifies: ADR-0008 — the golden path, built, served, and driven by the toolchain it decides.
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
  // Shown, not only loaded: the canvas draws every node and edge, since all are in view, at the
  // far level: nodes as particles, no text, and a number of display objects that does not grow
  // with the graph, apart from the one particle container.
  const drawn = await page.evaluate(() => {
    const snapshot = window.inspect();
    return {
      level: snapshot.level,
      nodes: snapshot.nodes.length,
      particles: snapshot.particles,
      edges: snapshot.edges.length,
      texts: snapshot.texts,
    };
  });
  expect(drawn).toEqual({
    level: "far",
    nodes: report.nodes,
    particles: report.nodes,
    edges: report.edges,
    texts: 0,
  });
  // Verifies: ADR-0012
  // The world, the edges layer and its mesh, the particle container, and the empty layers of
  // node views and labels.
  expect(await page.evaluate(() => window.inspect().displayObjects)).toBe(6);
});

test("zooming through each threshold switches the level of detail", async ({ page }) => {
  // Verifies: ADR-0012
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

  // World x = 450 at the right border of the canvas: at scale 1, the query reaches the culling
  // margin beyond it, and label points the label reach beyond that. Columns 0 and 1 (x < 520) are
  // bound; columns 2 to 4 (x ≥ 600), the edges into and out of the north-star metric (x ≥ 820),
  // and their labels (x ≥ 860) are not.
  const { cullingMargin, labelReach } = await sceneNumbers(page);
  expect(450 + cullingMargin).toBeLessThan(600);
  expect(450 + cullingMargin + labelReach).toBeLessThan(860);
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width - 450, y: height / 2, scale: 1 });
  const snapshot = await page.evaluate(() => window.inspect());
  const columns = new Set(snapshot.nodes.map((node) => node.id.split(":")[1]!.split(".")[0]));
  expect([...columns].sort()).toEqual(["0", "1"]);
  expect(snapshot.edges.map((edge) => edge.id).filter((id) => /-(3|4)\./.test(id))).toEqual([]);
  expect(snapshot.edges.length).toBeGreaterThan(0);
  expect(snapshot.edgeLabels).toEqual([]);
});

/** What is drawn although it lies entirely outside the viewport grown by `margin` screen pixels:
 *  nodes by their box, edges by the box of their ends grown by the pull of their control points,
 *  which holds the whole path, and labels by their point grown by the label reach. The reach is
 *  the scene's least: a label wider than any the example draws would be flagged wrongly. */
async function drawnBeyond(page: Page, margin: number): Promise<string[]> {
  return page.evaluate((margin) => {
    const { nodes, edges, edgeLabels } = window.inspect();
    const view = window.visibleRect(margin);
    const meets = (minX: number, minY: number, maxX: number, maxY: number) =>
      minX <= view.maxX && view.minX <= maxX && minY <= view.maxY && view.minY <= maxY;
    const pull = 40 + 1;
    const reach = window.sceneNumbers().labelReach;
    return [
      ...nodes
        .filter((n) => !meets(n.x, n.y, n.x + n.width, n.y + n.height))
        .map((n) => `node ${n.id}`),
      ...edges
        .filter(({ source: s, target: t }) => {
          const [minX, maxX] = [Math.min(s.x, t.x) - pull, Math.max(s.x, t.x) + pull];
          const [minY, maxY] = [Math.min(s.y, t.y) - pull, Math.max(s.y, t.y) + pull];
          return !meets(minX, minY, maxX, maxY);
        })
        .map((e) => `edge ${e.id}`),
      ...edgeLabels
        .filter((l) => !meets(l.x - reach, l.y - reach, l.x + reach, l.y + reach))
        .map((l) => `label ${l.edge}`),
    ];
  }, margin);
}

test("at every level, nothing entirely outside the viewport and its margin is drawn", async ({
  page,
}) => {
  // Verifies: G-7, ADR-0012
  test.setTimeout(60_000);
  await open(page, "?copies=100");
  const { width, height } = await canvasSize(page);
  const { cullingMargin, rescale } = await sceneNumbers(page);
  // Centred on world (7000, 3000), well inside the grid of copies.
  const centred = (scale: number) => ({
    x: width / 2 - 7000 * scale,
    y: height / 2 - 3000 * scale,
    scale,
  });
  for (const [scale, level] of [
    [1, "near"],
    [0.45, "middle"],
    [0.2, "far"],
  ] as const) {
    await setViewport(page, { ...centred(scale), x: centred(scale).x + 5000 });
    await setViewport(page, centred(scale));
    const { level: drawnAt, nodes } = await page.evaluate(() => window.inspect());
    expect(drawnAt).toBe(level);
    expect(nodes.length).toBeGreaterThan(0);
    expect(await drawnBeyond(page, cullingMargin)).toEqual([]);
    // Moved without a query, zoomed in by a tenth and panned: what is bound reaches at most
    // twice the margin beyond the viewport. A tenth stays within the rescale the scene allows.
    expect(rescale).toBeGreaterThan(1.1);
    const queries = await page.evaluate(() => window.inspect().queries);
    const zoomed = centred(scale * 1.1);
    await setViewport(page, zoomed);
    await setViewport(page, { ...zoomed, x: zoomed.x + 30, y: zoomed.y - 20 });
    expect(await page.evaluate(() => window.inspect().queries)).toBe(queries);
    expect(await drawnBeyond(page, 2 * cullingMargin)).toEqual([]);
    // Zoomed in by almost the rescale the scene allows from a fresh query: the last query would
    // reach more than twice the margin beyond the viewport, so the scene queries again.
    await setViewport(page, { ...centred(scale), x: centred(scale).x + 5000 });
    await setViewport(page, centred(scale));
    const fresh = await page.evaluate(() => window.inspect().queries);
    // The step only shows the bound where the zoom leaves the last query's reach: the viewport
    // shrinks by (1 - 1 / zoom) of its width, which with the margin must exceed twice the margin.
    const zoom = rescale - 0.01;
    const { width } = await canvasSize(page);
    expect(((width * (1 - 1 / zoom)) / 2 + cullingMargin) * zoom).toBeGreaterThan(
      2 * cullingMargin,
    );
    await setViewport(page, centred(scale * zoom));
    expect(await page.evaluate(() => window.inspect().queries)).toBe(fresh + 1);
    expect(await drawnBeyond(page, 2 * cullingMargin)).toEqual([]);
  }
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

test("a pan within the culling margin moves the world without a query", async ({ page }) => {
  await open(page);
  const queries = () => page.evaluate(() => window.inspect().queries);
  const start = await page.evaluate(() => window.comb.viewport());
  const { cullingMargin } = await sceneNumbers(page);
  const before = await queries();
  await setViewport(page, { ...start, x: start.x + cullingMargin / 2 });
  expect(await queries()).toBe(before);
  await setViewport(page, { ...start, scale: start.scale * 1.1 });
  expect(await queries()).toBe(before);
  await setViewport(page, { ...start, x: start.x + 4 * cullingMargin });
  expect(await queries()).toBe(before + 1);
  // A selection and a move change what is drawn: the renders query, wherever the viewport is.
  const centre = await screenCentre(page, "0:0.0");
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x, centre.y + 5);
  await page.mouse.up();
  await page.evaluate(() => window.comb.whenRendered());
  expect(await queries()).toBeGreaterThanOrEqual(before + 2);
});

test("the same area binds as many display objects at 1 and at 1,000 copies", async ({ page }) => {
  // Verifies: ADR-0012
  test.setTimeout(120_000);
  // Inside the first copy: the next copy to the right starts at x = 1500 and the one below at
  // y = 550, both beyond the canvas and its culling margin at scale 1.
  const bound = async (query: string) => {
    await open(page, query);
    const { width, height } = await canvasSize(page);
    const { cullingMargin } = await sceneNumbers(page);
    expect(width + cullingMargin).toBeLessThan(1500);
    expect(height / 2 + cullingMargin).toBeLessThan(550);
    await setViewport(page, { x: 0, y: height / 2, scale: 1 });
    return page.evaluate(() => window.inspect().displayObjects);
  };
  const one = await bound("?copies=1");
  expect(await bound("?copies=1000")).toBe(one);
});

test("at the middle level, the same area binds as many display objects at 100 and 1,000 copies", async ({
  page,
}) => {
  // Verifies: ADR-0012
  test.setTimeout(120_000);
  // Every copy fills the same cell of 1500 × 770 world units, whatever the number of copies; an
  // area well inside both grids shows the same nodes and edges in both.
  const bound = async (query: string) => {
    await open(page, query);
    const { width, height } = await canvasSize(page);
    const scale = 0.45;
    await setViewport(page, { x: width / 2 - 6000 * scale, y: height / 2 - 4000 * scale, scale });
    return page.evaluate(() => {
      const { level, displayObjects, nodes } = window.inspect();
      return { level, displayObjects, nodes: nodes.length };
    });
  };
  const hundred = await bound("?copies=100");
  expect(hundred.level).toBe("middle");
  expect(hundred.nodes).toBeGreaterThan(0);
  expect(await bound("?copies=1000")).toEqual(hundred);
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
