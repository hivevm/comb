// Dragging a node (G-2).
import { expect, test, type Page } from "@playwright/test";
import {
  canvasOrigin,
  NODE_HEIGHT,
  NODE_WIDTH,
  open,
  recordChanges,
  screenCentre,
  told,
} from "./shared";

/** A node's position in world coordinates, as the canvas draws it. */
async function drawnNode(page: Page, id: string) {
  return page.evaluate((id) => window.inspect().nodes.find((node) => node.id === id), id);
}

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
    // The frame that drew this move, read before any other: one render per move (ADR-0029).
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

test("a node dragged across frames and released tells one nodeMoved, where inspection draws it", async ({
  page,
}) => {
  // Verifies: ADR-0030
  await open(page);
  await recordChanges(page);
  const id = "0:3.0";
  const from = await screenCentre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(from.x + step * 9, from.y + step * 7);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  expect(await told(page)).toEqual([]);
  await page.mouse.up();
  await page.evaluate(() => window.comb.whenRendered());
  const node = (await drawnNode(page, id))!;
  expect(await told(page)).toEqual([{ kind: "nodeMoved", by: "user", id, x: node.x, y: node.y }]);
});

test("a press and release on a node without a move tells no change", async ({ page }) => {
  // Verifies: ADR-0030
  await open(page);
  await recordChanges(page);
  const from = await screenCentre(page, "0:3.0");
  await page.mouse.click(from.x, from.y);
  await page.evaluate(() => window.comb.whenRendered());
  expect(await told(page)).toEqual([]);
});

test("a drag released outside the canvas tells nodeMoved as on it", async ({ page }) => {
  // Verifies: ADR-0030
  await open(page);
  await recordChanges(page);
  const id = "0:3.0";
  const from = await screenCentre(page, id);
  const sidebar = (await page.locator("#sidebar").boundingBox())!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(sidebar.x + 40, from.y, { steps: 10 });
  await page.mouse.up();
  await page.evaluate(() => window.comb.whenRendered());
  const node = (await drawnNode(page, id))!;
  expect(await told(page)).toEqual([{ kind: "nodeMoved", by: "user", id, x: node.x, y: node.y }]);
});

test("a drag whose engine is lost before the release tells no change, and throws nothing", async ({
  page,
}) => {
  // Verifies: ADR-0030, ADR-0021
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await recordChanges(page);
  const from = await screenCentre(page, "0:3.0");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 10, { steps: 4 });
  await page.evaluate(() => window.trapNextCall());
  // The next move's translate traps, and the engine is lost.
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 4 });
  await page.mouse.up();
  const lost = await page.evaluate(() => {
    try {
      window.comb.fitView();
      return "not lost";
    } catch (error) {
      return (error as Error).name;
    }
  });
  expect(lost).toBe("EngineLostError");
  expect(await told(page)).toEqual([]);
  expect(errors).toEqual([]);
});
