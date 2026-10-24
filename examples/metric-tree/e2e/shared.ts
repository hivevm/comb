// What more than one browser test uses: opening the example, loading a graph into it and recording
// what Comb tells, and reading and moving its canvas.
import type { Page } from "@playwright/test";
import type { GraphData, NodeData } from "comb";
import { NODE_HEIGHT, NODE_WIDTH } from "../src/graph";

export { NODE_HEIGHT, NODE_WIDTH };

/** The Content Security Policy of Q-6, which the test server sends with every response. */
export const POLICY = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'";

/** The numbers the scene draws by, from comb/testing. */
export async function sceneNumbers(page: Page) {
  return page.evaluate(() => window.sceneNumbers());
}

/** Opens the example and waits until its first load has drawn. */
export async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`/${query}`);
  // The example sets loadReport after a top-level await, which the load event does not wait for.
  await page.waitForFunction(() => "loadReport" in window);
  await page.evaluate(() => window.loadReport);
}

/** The screen point at the centre of a drawn node. */
export async function screenCentre(page: Page, id: string) {
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

/** The size of the canvas on the page. */
export async function canvasSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    const { width, height } = document.querySelector("#canvas canvas")!.getBoundingClientRect();
    return { width, height };
  });
}

/** The canvas's left and top on the page. */
export async function canvasOrigin(page: Page): Promise<{ left: number; top: number }> {
  return page.evaluate(() => {
    const { left, top } = document.querySelector("#canvas canvas")!.getBoundingClientRect();
    return { left, top };
  });
}

/** Sets the viewport through Comb's interface and waits until it is drawn. */
export async function setViewport(page: Page, viewport: { x: number; y: number; scale: number }) {
  await page.evaluate(async (viewport) => {
    window.comb.setViewport(viewport);
    await window.comb.whenRendered();
  }, viewport);
}

/** Along the edge from `a` to `b`, screen y = 132 from x = 340 to 680, which pixels the canvas
 *  draws in `color` (`0xRRGGBB`), within a tolerance, read off a screenshot with the nodes and
 *  labels hidden: as many as it draws and how many runs they fall into. */
export async function strokeOf(page: Page, color: number) {
  await page.evaluate(async () => {
    window.showLayers({ nodes: false, edgeLabels: false });
    await window.comb.whenRendered();
  });
  const png = await page.locator("#canvas canvas").screenshot();
  const stroke = await page.evaluate(
    async ({ png, color }) => {
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const ratio = image.width / document.querySelector("#canvas canvas")!.clientWidth;
      const copy = document.createElement("canvas");
      [copy.width, copy.height] = [image.width, image.height];
      const context = copy.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const want = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
      const hits: boolean[] = [];
      for (let x = 340; x <= 680; x++) {
        const { data } = context.getImageData(Math.round(x * ratio), Math.round(132 * ratio), 1, 1);
        hits.push(want.every((value, channel) => Math.abs(data[channel]! - value) < 48));
      }
      const runs = hits.filter((hit, i) => hit && !hits[i - 1]).length;
      return { drawn: hits.filter(Boolean).length, runs };
    },
    { png: png.toString("base64"), color },
  );
  await page.evaluate(async () => {
    window.showLayers({ nodes: true, edgeLabels: true });
    await window.comb.whenRendered();
  });
  return stroke;
}

/** A node of the example's size at `x, y`, titled by its identifier. */
export const node = (id: string, x = 0, y = 0): NodeData => ({
  id,
  title: id,
  x,
  y,
  width: NODE_WIDTH,
  height: NODE_HEIGHT,
});

/** Starts recording every change `onChange` tells into `window.told` and every selection
 *  `onSelectionChange` reports into `window.selections`. */
export async function recordChanges(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { told: unknown[]; selections: unknown[] };
    [w.told, w.selections] = [[], []];
    window.comb.onChange((change) => w.told.push(change));
    window.comb.onSelectionChange((selection) => w.selections.push(selection));
  });
}

/** Loads `graph` as the example's own through `useGraph`, so that its sidebar's copy and Comb hold
 *  the same graph; records from then on what `recordChanges` records; and sets `viewport` once it
 *  is drawn. */
export async function loaded(
  page: Page,
  graph: GraphData,
  viewport: { x: number; y: number; scale: number } = { x: 100, y: 100, scale: 1 },
): Promise<void> {
  await page.evaluate((graph) => window.useGraph(graph), graph);
  await recordChanges(page);
  await page.evaluate(() => window.comb.whenRendered());
  await setViewport(page, viewport);
}

/** The changes `onChange` told since `recordChanges`. */
export async function told<T = unknown>(page: Page): Promise<T[]> {
  return page.evaluate(() => (window as unknown as { told: unknown[] }).told) as Promise<T[]>;
}

/** The selections `onSelectionChange` reported since `recordChanges`. */
export async function selections(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { selections: unknown[] }).selections);
}

/** The page point at which the canvas shows the world point `(x, y)`. */
export async function pagePoint(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
      const screen = window.screenPoint(x, y);
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    },
    { x, y },
  );
}

/** Clicks the world point `(x, y)`. */
export async function clickWorld(page: Page, x: number, y: number): Promise<void> {
  const at = await pagePoint(page, x, y);
  await page.mouse.click(at.x, at.y);
}

/** Drags from the world point `from` to `to` in eight steps; `midway`, where given, runs before
 *  the release, and what it returns is returned. */
export async function dragWorld(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void>;
export async function dragWorld<T>(
  page: Page,
  from: [number, number],
  to: [number, number],
  midway: () => Promise<T>,
): Promise<T>;
export async function dragWorld<T>(
  page: Page,
  from: [number, number],
  to: [number, number],
  midway?: () => Promise<T>,
): Promise<T | undefined> {
  const [a, b] = [await pagePoint(page, ...from), await pagePoint(page, ...to)];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  const seen = await midway?.();
  await page.mouse.up();
  return seen;
}
