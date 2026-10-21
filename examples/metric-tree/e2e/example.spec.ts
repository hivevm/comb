import { expect, test, type Page, type Request } from "@playwright/test";

/** The Content Security Policy of Q-6, which the test server sends with every response. */
const POLICY = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'";

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
  // Verifies: Q-6 — every browser test runs under the policy the test server sends.
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toBe(POLICY);
  await open(page);
  await expect(page.locator("#canvas canvas")).toBeVisible();
  await expect(page.locator("#count")).toHaveText("15 nodes, 15 edges");
  // WebGL2, not PixiJS's Canvas 2D fallback, which draws no edge mesh.
  expect(await page.evaluate(() => window.inspect().renderer)).toBe("webgl");
  // The bridge in test mode, so that a view kept across an engine call fails the suite.
  expect(await page.evaluate(() => window.testMode())).toBe(true);
  expect(errors).toEqual([]);
});

test("the canvas draws from the engine in every form the host application hands over", async ({
  page,
}) => {
  // Verifies: ADR-0019
  const forms = ["", "?engine=response", "?engine=module", "?engine=bytes", "?engine=view"];
  for (const form of forms) {
    const errors: string[] = [];
    const engines: string[] = [];
    const onError = (error: Error) => errors.push(error.message);
    // Vite serves the `?url` import as a script of its own; the engine is what is fetched.
    const onRequest = (request: Request) => {
      const path = new URL(request.url()).pathname;
      if (path.endsWith(".wasm") && request.resourceType() === "fetch") engines.push(path);
    };
    page.on("pageerror", onError);
    page.on("request", onRequest);
    await open(page, form);
    const drawn = await page.evaluate(() => window.inspect());
    page.off("pageerror", onError);
    page.off("request", onRequest);
    expect(errors, form).toEqual([]);
    // The example requests the file Vite emits, once, and Comb requests nothing of its own.
    expect(engines, form).toHaveLength(1);
    expect(drawn.renderer, form).toBe("webgl");
    expect(drawn.nodes, form).toHaveLength(15);
    expect(drawn.edgeTriangles, form).toBeGreaterThan(0);
  }
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

test("without WebGL, a host application that opts in gets Canvas 2D with its edges", async ({
  page,
}) => {
  // Verifies: ADR-0018
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${error.name}: ${error.message}`));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, id: string, options?: unknown) {
        return id.startsWith("webgl") ? null : Reflect.apply(getContext, this, [id, options]);
      },
    });
  });
  await open(page, "?fallback=canvas");
  const drawn = await page.evaluate(() => {
    const snapshot = window.inspect();
    return {
      renderer: snapshot.renderer,
      nodes: snapshot.nodes.length,
      edgeTriangles: snapshot.edgeTriangles,
    };
  });
  // One tree: 15 nodes, all in view after fitView.
  expect(drawn.renderer).toBe("canvas");
  expect(drawn.nodes).toBe(15);
  expect(drawn.edgeTriangles).toBeGreaterThan(0);
  // Drawn, not only counted: with the nodes and the edge labels hidden, the canvas holds pixels
  // in the green of the tree's positively correlated edges, which only the edges layer paints;
  // within 16 per channel, since antialiasing blends the pixels at a triangle's border, and the
  // background, grey, and red lie far outside that.
  const green = await page.evaluate(async () => {
    window.showLayers({ nodes: false, edgeLabels: false });
    await window.comb.whenRendered();
    await new Promise(requestAnimationFrame);
    const source = document.querySelector<HTMLCanvasElement>("#canvas canvas")!;
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    const context = copy.getContext("2d")!;
    context.drawImage(source, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const off = [0x22, 0xa5, 0x5b].map((value, channel) => Math.abs(data[i + channel]! - value));
      if (Math.max(...off) <= 16) count += 1;
    }
    return count;
  });
  expect(green).toBeGreaterThan(0);
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
  // Each step waits for its render, so that none folds into the next.
  // The counts are exact because no display object uses eventMode "dynamic", whose ticker
  // pointermove would add moves.
  const rendered = () => page.evaluate(() => window.comb.whenRendered());
  const centre = await screenCentre(page, "0:0.0");
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await rendered();
  expect(await queries()).toBe(before + 2);
  await page.mouse.move(centre.x, centre.y + 5);
  await rendered();
  expect(await queries()).toBe(before + 3);
  // Releasing the node changes nothing drawn.
  await page.mouse.up();
  await rendered();
  expect(await queries()).toBe(before + 3);
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

/** What the canvas has done so far, from comb/testing. */
async function work(page: Page) {
  return page.evaluate(() => window.work());
}

type Work = Awaited<ReturnType<typeof work>>;

/** What the canvas did between two readings of `work`. */
function done(before: Work, after: Work): Work {
  const keys = Object.keys(before) as (keyof Work)[];
  return Object.fromEntries(keys.map((key) => [key, after[key] - before[key]])) as unknown as Work;
}

const NOTHING: Work = {
  buffersCreated: 0,
  bufferAllocations: 0,
  bufferResizes: 0,
  bytesUploaded: 0,
  meshBytesUploaded: 0,
  textureUploads: 0,
  viewsCreated: 0,
};

/** Centred on world (7000, 3000), well inside the grid of 100 copies, at `scale`. */
async function centred(page: Page, scale: number) {
  const { width, height } = await canvasSize(page);
  return { x: width / 2 - 7000 * scale, y: height / 2 - 3000 * scale, scale };
}

/** Pans by `step` screen pixels to the right a frame, for `frames` frames, from `start`. */
async function pan(
  page: Page,
  start: { x: number; y: number; scale: number },
  frames: number,
  step = 1,
) {
  await page.evaluate(
    async ({ start, frames, step }) => {
      for (let i = 1; i <= frames; i++) {
        window.comb.setViewport({ ...start, x: start.x - i * step });
        await window.comb.whenRendered();
      }
    },
    { start, frames, step },
  );
}

test("a pan within the queried rectangle creates, resizes, and uploads nothing, at every level", async ({
  page,
}) => {
  // Verifies: ADR-0012
  test.setTimeout(60_000);
  await open(page, "?copies=100");
  const { cullingMargin } = await sceneNumbers(page);
  const frames = 60;
  // One screen pixel a frame stays within the margin the last query reached beyond the viewport.
  expect(frames).toBeLessThan(cullingMargin);
  for (const [scale, level] of [
    [1, "near"],
    [0.45, "middle"],
    [0.2, "far"],
  ] as const) {
    const start = await centred(page, scale);
    const before = await work(page);
    await setViewport(page, { ...start, x: start.x + 5000 });
    await setViewport(page, start);
    expect(await page.evaluate(() => window.inspect().level)).toBe(level);
    // The query that warmed the scene up uploaded its mesh: the counters see the uploads.
    expect((await work(page)).meshBytesUploaded).toBeGreaterThan(before.meshBytesUploaded);
    const { queries, renders } = await page.evaluate(() => window.inspect());
    const warm = await work(page);
    await pan(page, start, frames);
    const panned = await page.evaluate(() => window.inspect());
    expect(panned.renders).toBe(renders + frames);
    expect(panned.queries).toBe(queries);
    expect({ level, ...done(warm, await work(page)) }).toEqual({ level, ...NOTHING });
  }
});

test("a pan across queries at the near level takes every view from the warm pools", async ({
  page,
}) => {
  // Verifies: ADR-0012
  test.setTimeout(60_000);
  await open(page, "?copies=100");
  const { cullingMargin } = await sceneNumbers(page);
  const start = await centred(page, 1);
  await setViewport(page, start);
  // Half the margin a frame for 40 frames: the viewport leaves what it last queried every few
  // frames, and views of nodes and labels return to the pools and are bound again.
  const frames = 40;
  const step = cullingMargin / 2;
  await pan(page, start, frames, step);
  await setViewport(page, start);
  const { queries } = await page.evaluate(() => window.inspect());
  const warm = await work(page);
  await pan(page, start, frames, step);
  const panned = await page.evaluate(() => window.inspect());
  expect(panned.level).toBe("near");
  expect(panned.queries).toBeGreaterThanOrEqual(queries + frames / 4);
  expect(panned.edgeLabels.length).toBeGreaterThan(0);
  expect(done(warm, await work(page)).viewsCreated).toBe(0);
});

test("a drag at the far level updates the GPU buffers in place, never reallocating them", async ({
  page,
}) => {
  // Verifies: ADR-0012
  await open(page);
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width / 2, y: height / 2, scale: 0.2 });
  expect(await page.evaluate(() => window.inspect().level)).toBe("far");
  const from = await screenCentre(page, "0:0.0");
  const frames = 60;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Pressing selects the node, which renders once more before the drag.
  await page.evaluate(() => window.comb.whenRendered());
  const { queries, edgeTriangles, edgeMesh } = await page.evaluate(() => window.inspect());
  const warm = await work(page);
  // The node moves down and away from its edges' other ends: the mesh grows with them.
  const largest = { vertices: 0, indices: 0 };
  for (let i = 1; i <= frames; i++) {
    await page.mouse.move(from.x, from.y + 2 * i);
    const { vertices, indices } = await page.evaluate(async () => {
      await window.comb.whenRendered();
      return window.inspect().edgeMesh;
    });
    largest.vertices = Math.max(largest.vertices, vertices);
    largest.indices = Math.max(largest.indices, indices);
  }
  const did = done(warm, await work(page));
  const dragged = await page.evaluate(() => window.inspect());
  await page.mouse.up();
  // Every frame moved the node, so every frame queried, synced the particles, and uploaded them.
  expect(dragged.queries).toBe(queries + frames);
  expect(dragged.particles).toBe(dragged.nodes.length);
  expect(dragged.edgeTriangles).toBeGreaterThan(edgeTriangles);
  // The premise: the mesh never outgrew the room it had before the drag, which a larger scene
  // would, rightly growing its buffers.
  expect(largest.vertices).toBeLessThanOrEqual(edgeMesh.capacity.vertices);
  expect(largest.indices).toBeLessThanOrEqual(edgeMesh.capacity.indices);
  // The mesh uploaded, and so did the particles, beyond the mesh's bytes.
  expect(did.meshBytesUploaded).toBeGreaterThan(0);
  expect(did.bytesUploaded - did.meshBytesUploaded).toBeGreaterThan(0);
  expect(did).toEqual({
    ...NOTHING,
    bytesUploaded: did.bytesUploaded,
    meshBytesUploaded: did.meshBytesUploaded,
  });
});

/** The canvas's left and top on the page. */
async function canvasOrigin(page: Page): Promise<{ left: number; top: number }> {
  return page.evaluate(() => {
    const { left, top } = document.querySelector("#canvas canvas")!.getBoundingClientRect();
    return { left, top };
  });
}

/** For each screen point, relative to the canvas, whether the canvas shows anything but its
 *  background within `radius` CSS pixels of it, read off a screenshot of what the browser last
 *  presented: a WebGL canvas keeps no drawing buffer to read back after its frame. */
async function inkNear(page: Page, points: { x: number; y: number }[], radius = 2) {
  const png = await page.locator("#canvas canvas").screenshot();
  return page.evaluate(
    async ({ png, points, radius }) => {
      // Decoded in the page, not fetched as a `data:` URL, which the policy's connect-src refuses.
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const ratio = image.width / document.querySelector("#canvas canvas")!.clientWidth;
      const copy = document.createElement("canvas");
      copy.width = image.width;
      copy.height = image.height;
      const context = copy.getContext("2d")!;
      context.drawImage(image, 0, 0);
      // Comb's default background, which createComb clears the canvas to.
      const background = [0xf7, 0xf8, 0xfa];
      return points.map(({ x, y }) => {
        const r = Math.ceil(radius * ratio);
        const left = Math.round(x * ratio) - r;
        const top = Math.round(y * ratio) - r;
        const { data } = context.getImageData(left, top, 2 * r + 1, 2 * r + 1);
        for (let i = 0; i < data.length; i += 4) {
          const off = background.map((value, channel) => Math.abs(data[i + channel]! - value));
          if (Math.max(...off) > 24) return true;
        }
        return false;
      });
    },
    { png: png.toString("base64"), points, radius },
  );
}

/** Once the pending render is drawn: node `id` and the screen points, relative to the canvas, of
 *  its centre, its connectors, and the ends of every edge attached to it, with the render count. */
async function drawnFrame(page: Page, id: string) {
  return page.evaluate(
    async ({ id }) => {
      await window.comb.whenRendered();
      const { nodes, edges } = window.inspect();
      const node = nodes.find((candidate) => candidate.id === id)!;
      const toScreen = (p: { x: number; y: number }) => window.screenPoint(p.x, p.y);
      const attached = edges.filter((edge) => {
        const [copy, ends] = edge.id.split(":");
        return ends!.split("-").some((end) => `${copy}:${end}` === id);
      });
      return {
        renders: window.renderCount(),
        centre: toScreen({ x: node.x + node.width / 2, y: node.y + node.height / 2 }),
        // The connectors: edges leave a node at its right side and enter it at its left.
        out: toScreen({ x: node.x + node.width, y: node.y + node.height / 2 }),
        in: toScreen({ x: node.x, y: node.y + node.height / 2 }),
        edges: attached.map((edge) => ({
          id: edge.id,
          outgoing: edge.id.split("-")[0] === id,
          source: toScreen(edge.source),
          target: toScreen(edge.target),
        })),
      };
    },
    { id },
  );
}

test("a node dragged across frames stays under the pointer, its edges' ends at its connectors in the same frame", async ({
  page,
}) => {
  // Verifies: G-2
  await open(page);
  const northStar = "0:3.0";
  const origin = await canvasOrigin(page);
  const from = await screenCentre(page, northStar);
  // The edges layer alone, so that every pixel that is not background belongs to an edge.
  await page.evaluate(() => window.showLayers({ nodes: false, edgeLabels: false }));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Pressing selects the node, which renders once before the drag.
  await page.evaluate(() => window.comb.whenRendered());

  const moves = 10;
  // Straight down, 20 pixels a move.
  const step = 200 / moves;
  for (let i = 1; i <= moves; i++) {
    const pointer = { x: from.x, y: from.y + i * step };
    const renders = await page.evaluate(() => window.renderCount());
    await page.mouse.move(pointer.x, pointer.y);
    // The frame that drew this move, read before any other: one render per move (ADR-0011).
    const frame = await drawnFrame(page, northStar);
    expect(frame.renders).toBe(renders + 1);
    const local = { x: pointer.x - origin.left, y: pointer.y - origin.top };
    expect(Math.abs(frame.centre.x - local.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(frame.centre.y - local.y)).toBeLessThanOrEqual(1);
    // Edges into and out of the north-star metric.
    expect(frame.edges.some((edge) => edge.outgoing)).toBe(true);
    expect(frame.edges.some((edge) => !edge.outgoing)).toBe(true);
    for (const edge of frame.edges) {
      const end = edge.outgoing ? edge.source : edge.target;
      const connector = edge.outgoing ? frame.out : frame.in;
      expect(Math.abs(end.x - connector.x), edge.id).toBeLessThanOrEqual(1);
      expect(Math.abs(end.y - connector.y), edge.id).toBeLessThanOrEqual(1);
    }
    // Drawn, not only computed: the canvas shows an edge two pixels out from each connector, and
    // the background where the connectors were a frame before, where edges drawn a frame late
    // would still end.
    const drawn = await inkNear(page, [
      { x: frame.out.x + 2, y: frame.out.y },
      { x: frame.in.x - 2, y: frame.in.y },
      { x: frame.out.x + 2, y: frame.out.y - step },
      { x: frame.in.x - 2, y: frame.in.y - step },
    ]);
    expect(drawn, `move ${i}`).toEqual([true, true, false, false]);
    // The screenshot showed the render asserted above, not a later one.
    expect(await page.evaluate(() => window.renderCount())).toBe(renders + 1);
  }
  await page.mouse.up();
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
