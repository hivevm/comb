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
