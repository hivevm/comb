// What more than one browser test of the UML example uses: opening it, the conventions' styles of
// the kinds of relationship, and reading and pressing its canvas.
import type { Page } from "@playwright/test";

/** The Content Security Policy of Q-6, which the test server sends with every response. */
export const POLICY = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'";

/** Opens the example and waits until its first load has drawn. */
export async function open(page: Page): Promise<void> {
  // The example sets its hooks after a top-level await, which the load event does not wait for.
  await page.waitForFunction(() => "uml" in window);
  await page.evaluate(() => window.uml.loadReport);
}

/** How docs/CONVENTIONS.md draws each kind of relationship, in the order the legend lists them:
 *  its name, colour, whether it is dashed (`[6, 4]`), its arrowhead, and its label with the path
 *  parameter it stands at. Written here from the conventions, not read from the example, so that
 *  a style the example's table gets wrong fails. */
export const CONVENTIONS = [
  ["association", "Association", 0x6b7280, false, "none"],
  ["directed-association", "Directed association", 0x6b7280, false, "end"],
  ["generalization", "Generalization", 0x1d4ed8, false, "end"],
  ["realization", "Realization", 0x1d4ed8, true, "end"],
  ["dependency", "Dependency", 0x6b7280, true, "end", "«use»", 0.5],
  ["aggregation", "Aggregation", 0x15803d, false, "none", "«aggregation»", 0.4],
  ["composition", "Composition", 0x15803d, false, "none", "«composition»", 0.4],
] as const;
export const DRAWN = Object.fromEntries(
  CONVENTIONS.map(([kind, name, color, dashed, arrow, label, t]) => [
    kind,
    { name, color, dashed, arrow, label, t },
  ]),
) as Record<
  string,
  {
    name: string;
    color: number;
    dashed: boolean;
    arrow: "end" | "none";
    label?: string;
    t?: number;
  }
>;

/** The page point at which the canvas shows the world point `(x, y)`. */
export async function pagePoint(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x: worldX, y: worldY }) => {
      const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
      const screen = window.uml.screenPoint(worldX, worldY);
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    },
    { x, y },
  );
}

/** Node `id` as the canvas draws it: its place and its height. */
export async function drawnNode(page: Page, id: string) {
  return page.evaluate(async (wanted) => {
    await window.uml.comb.whenRendered();
    const node = window.uml.inspect().nodes.find((each) => each.id === wanted);
    return node && { x: node.x, y: node.y, width: node.width, height: node.height };
  }, id);
}

/** Clicks the world point `(x, y)`. */
export async function clickWorld(page: Page, x: number, y: number): Promise<void> {
  const at = await pagePoint(page, x, y);
  await page.mouse.click(at.x, at.y);
}

/** Clicks the middle of node `id`, which selects it. */
export async function clickNode(page: Page, id: string): Promise<void> {
  const node = (await drawnNode(page, id))!;
  await clickWorld(page, node.x + node.width / 2, node.y + node.height / 2);
}

/** Sets the viewport through Comb's interface and waits until it is drawn. */
export async function setViewport(page: Page, viewport: { x: number; y: number; scale: number }) {
  await page.evaluate(async (wanted) => {
    window.uml.comb.setViewport(wanted);
    await window.uml.comb.whenRendered();
  }, viewport);
}
