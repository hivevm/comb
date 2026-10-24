// A press hits what the engine says lies on top (ADR-0025): a node before an edge, an edge within
// 4 screen pixels of its path at every level of detail, which it selects (G-5), and nothing beside
// a curved edge; the example's sidebar edits the selected edge through `updateEdge` (G-9).
import { expect, test, type Page } from "@playwright/test";
import type { GraphData } from "comb";
import { NODE_HEIGHT, NODE_WIDTH, open, screenCentre, setViewport, strokeOf } from "./shared";

const node = (id: string, x = 0, y = 0) => ({
  id,
  title: id,
  x,
  y,
  width: NODE_WIDTH,
  height: NODE_HEIGHT,
});

/** Nodes `a` and `b` side by side and the edge `a-b` between them, straight along y = 32. */
const PAIR: GraphData = {
  nodes: [node("a"), node("b", 600)],
  edges: [{ id: "a-b", source: "a", target: "b", color: 0xe0453a }],
};

/** Loads `graph`, views it at `scale` with the world's origin at (100, 100), and records each
 *  selection into `window.selections`. */
async function loaded(page: Page, graph: GraphData, scale = 1): Promise<void> {
  await page.evaluate(async (graph) => {
    window.useGraph(graph);
    const w = window as unknown as { selections: unknown[] };
    w.selections = [];
    window.comb.onSelectionChange((selection) => w.selections.push(selection));
    await window.comb.whenRendered();
  }, graph);
  await setViewport(page, { x: 100, y: 100, scale });
}

/** Clicks the world point `(x, y)` and returns the selections reported since the load. */
async function clickAt(page: Page, x: number, y: number) {
  const at = await page.evaluate(
    ({ x, y }) => {
      const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
      const screen = window.screenPoint(x, y);
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    },
    { x, y },
  );
  await page.mouse.click(at.x, at.y);
  return page.evaluate(() => (window as unknown as { selections: unknown[] }).selections);
}

for (const [level, scale] of [
  ["near", 1],
  ["middle", 0.4],
  ["far", 0.1],
] as const) {
  test(`a click on an edge's path selects the edge at the ${level} level`, async ({ page }) => {
    // Verifies: G-5, ADR-0025
    await open(page);
    await loaded(page, PAIR, scale);
    expect((await page.evaluate(() => window.inspect())).level).toBe(level);
    // On the path, and 3 screen pixels beside it.
    expect(await clickAt(page, 410, 32 + 3 / scale)).toEqual([{ kind: "edge", id: "a-b" }]);
  });
}

test("a press on a node over an edge selects the node and drags it", async ({ page }) => {
  // Verifies: ADR-0025
  await open(page);
  await loaded(page, { ...PAIR, nodes: [...PAIR.nodes, node("c", 380, 10)] });
  const from = await screenCentre(page, "c");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 80, { steps: 5 });
  await page.mouse.up();
  const result = await page.evaluate(async () => {
    await window.comb.whenRendered();
    const c = window.inspect().nodes.find(({ id }) => id === "c")!;
    return { y: c.y, selections: (window as unknown as { selections: unknown[] }).selections };
  });
  expect(result).toEqual({ y: 90, selections: [{ kind: "node", id: "c" }] });
});

test("a click beside a curved edge, within its bounds, selects nothing", async ({ page }) => {
  // Verifies: ADR-0025
  await open(page);
  // From a's right middle (220, 32) down to b's left middle (600, 432): the path bends through the
  // middle of its bounds, far from their corners.
  await loaded(page, { ...PAIR, nodes: [node("a"), node("b", 600, 400)] }, 0.8);
  expect(await clickAt(page, 560, 60)).toEqual([]);
  expect(await clickAt(page, 410, 232)).toEqual([{ kind: "edge", id: "a-b" }]);
});

test("the sidebar edits a selected edge, and the canvas draws its new colour", async ({ page }) => {
  // Verifies: G-5, G-9
  await open(page);
  await loaded(page, PAIR);
  await clickAt(page, 410, 32);
  await expect(page.locator("#edge-selection")).toBeVisible();
  await expect(page.locator("#edge-color")).toHaveValue("#e0453a");
  await page.locator("#edge-color").fill("#2060e0");
  expect((await strokeOf(page, 0x2060e0)).drawn).toBeGreaterThan(300);
  expect((await strokeOf(page, 0xe0453a)).drawn).toBe(0);
  await page.locator("#edge-dash").selectOption("dashed");
  expect((await strokeOf(page, 0x2060e0)).runs).toBeGreaterThan(10);
  await page.locator("#edge-label").fill("+0.5");
  const labels = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().edgeLabels.map(({ text }) => text);
  });
  expect(labels).toEqual(["+0.5"]);
});
