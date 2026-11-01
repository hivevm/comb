// What lies outside the viewport is not drawn (G-7, ADR-0027).
import { expect, test, type Page } from "@playwright/test";
import { canvasSize, open, sceneNumbers, screenCentre, setViewport } from "./shared";

test("what lies entirely outside the viewport is not bound to a display object", async ({
  page,
}) => {
  // Verifies: G-7, ADR-0027
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
  return page.evaluate((grown) => {
    const { nodes, edges, edgeLabels } = window.inspect();
    const view = window.visibleRect(grown);
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
  // Verifies: G-7, ADR-0027
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
    const { width: canvasWidth } = await canvasSize(page);
    expect(((canvasWidth * (1 - 1 / zoom)) / 2 + cullingMargin) * zoom).toBeGreaterThan(
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
  // Verifies: ADR-0027
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
  // Verifies: ADR-0027
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
