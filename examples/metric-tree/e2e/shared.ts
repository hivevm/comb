// What more than one browser test uses: opening the example, and reading and moving its canvas.
import type { Page } from "@playwright/test";

/** The Content Security Policy of Q-6, which the test server sends with every response. */
export const POLICY = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'";

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 64;

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
