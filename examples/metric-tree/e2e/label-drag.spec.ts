// The user drags an edge label, and it stays where it was dropped (G-6, ADR-0025): a press inside
// its pill at the near level grabs it, the engine places it at the path parameter nearest the
// pointer and its distance along the normal there, and the release tells one `labelMoved`.
import { expect, test, type Page } from "@playwright/test";
import type { GraphData } from "comb";
import {
  dragWorld,
  loaded,
  node,
  open,
  pagePoint,
  screenCentre,
  setViewport,
  told,
} from "./shared";

/** Nodes `a` and `b` side by side and the edge `a-b` between them, straight along y = 32, its
 *  label in the middle at (410, 32). */
const PAIR: GraphData = {
  nodes: [node("a"), node("b", 600)],
  edges: [{ id: "a-b", source: "a", target: "b", label: { text: "+0.8", t: 0.5, offset: 0 } }],
};

async function labels(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().edgeLabels.map(({ edge, x, y }) => ({ edge, x, y }));
  });
}

test("a label dragged off its edge is drawn where it was dropped, and tells one labelMoved", async ({
  page,
}) => {
  // Verifies: G-6, ADR-0030, ADR-0025
  await open(page);
  await loaded(page, PAIR);
  // Grabbed 6 to the right of its point, dropped with the point at (410, -60).
  await dragWorld(page, [416, 32], [416, -60]);
  const [label] = await labels(page);
  expect(label!.x).toBeCloseTo(410, 2);
  expect(label!.y).toBeCloseTo(-60, 2);
  const changes = await told(page);
  expect(changes).toHaveLength(1);
  const moved = changes[0] as unknown as {
    kind: string;
    by: string;
    edge: string;
    t: number;
    offset: number;
  };
  expect(moved).toMatchObject({ kind: "labelMoved", by: "user", edge: "a-b" });
  // At the middle of the straight edge, 92 above it: the normal of a rightward edge points up.
  expect(moved.t).toBeCloseTo(0.5, 6);
  expect(moved.offset).toBeCloseTo(92, 6);
  // When a node of the edge moves after, the label keeps its t and offset (G-6).
  const from = await screenCentre(page, "b");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 200, { steps: 5 });
  await page.mouse.up();
  // From (220, 32) to (600, 232), control points at (410, 32) and (410, 232): at t = 0.5 the path
  // passes (410, 132) with tangent (285, 300) / 413.79, and 92 along its normal lies the label.
  const [after] = await labels(page);
  const [tx, ty] = [285 / Math.hypot(285, 300), 300 / Math.hypot(285, 300)];
  expect(after!.x).toBeCloseTo(410 + ty * 92, 1);
  expect(after!.y).toBeCloseTo(132 - tx * 92, 1);
  expect((await told<{ kind: string }>(page)).map(({ kind }) => kind)).toEqual([
    "labelMoved",
    "nodeMoved",
  ]);
});

test("a press just beside a short label, beyond its pill, grabs neither it nor a long one", async ({
  page,
}) => {
  // Verifies: ADR-0025
  await open(page);
  const graph: GraphData = {
    nodes: [node("a"), node("b", 600), node("c", 0, 200), node("d", 600, 200)],
    edges: [
      { id: "short", source: "a", target: "b", label: { text: "1", t: 0.5, offset: 0 } },
      {
        id: "long",
        source: "c",
        target: "d",
        label: { text: "a label of many characters", t: 0.5, offset: 0 },
      },
    ],
  };
  await loaded(page, graph);
  const before = await labels(page);
  // The short pill reaches about 11 to each side of (410, 32) and 11 above and below it: press 20
  // beside it, within its height, where the long label's wider pill would reach.
  await dragWorld(page, [430, 26], [430, -80]);
  expect(await labels(page)).toEqual(before);
  expect((await told<{ kind: string }>(page)).map(({ kind }) => kind)).not.toContain("labelMoved");
});

test("at the middle level a press where a label's point lies drags no label", async ({ page }) => {
  // Verifies: ADR-0025
  await open(page);
  await loaded(page, PAIR, { x: 100, y: 100, scale: 0.4 });
  expect((await page.evaluate(() => window.inspect())).level).toBe("middle");
  await dragWorld(page, [410, 32], [410, -200]);
  expect((await told<{ kind: string }>(page)).map(({ kind }) => kind)).not.toContain("labelMoved");
});

test("a label the host clears mid-drag ends the drag: no error, and no labelMoved", async ({
  page,
}) => {
  // Verifies: ADR-0030, Q-7
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await loaded(page, PAIR);
  const [a, b] = [await pagePoint(page, 416, 32), await pagePoint(page, 416, -60)];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y - 20, { steps: 3 });
  await page.evaluate(() => window.comb.updateEdge("a-b", { label: null }));
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  expect((await told<{ kind: string }>(page)).map(({ kind }) => kind)).toEqual(["edgeUpdated"]);
  expect(await labels(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a label drag past every finite world point moves nothing and throws nothing", async ({
  page,
}) => {
  // Verifies: ADR-0025, ADR-0030
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await loaded(page, PAIR);
  // Grabbed 6 to the right of its point and moved with the point to (410, -60), as above.
  const [a, b] = [await pagePoint(page, 416, 32), await pagePoint(page, 416, -60)];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  // The host sets a viewport, finite in each number, under which every screen point lies beyond
  // any finite world point; the button stays held, and the pointer moves on.
  await page.evaluate(() => window.comb.setViewport({ x: 1e306, y: 0, scale: 0.005 }));
  await page.mouse.move(b.x + 30, b.y + 30, { steps: 3 });
  await page.mouse.up();
  expect(errors).toEqual([]);
  const changes = await told<{ kind: string; edge: string; t: number; offset: number }>(page);
  expect(changes.map(({ kind }) => kind)).toEqual(["labelMoved"]);
  expect(changes[0]!.edge).toBe("a-b");
  expect(changes[0]!.t).toBeCloseTo(0.5, 6);
  expect(changes[0]!.offset).toBeCloseTo(92, 6);
  // Back in view, the label lies where the last finite move put it.
  await setViewport(page, { x: 100, y: 100, scale: 1 });
  const [label] = await labels(page);
  expect(label!.x).toBeCloseTo(410, 2);
  expect(label!.y).toBeCloseTo(-60, 2);
});

test("a label dragged and then retitled in the sidebar stays where it was dropped", async ({
  page,
}) => {
  // Verifies: G-6, G-9
  await open(page);
  await loaded(page, PAIR);
  await dragWorld(page, [416, 32], [416, -60]);
  await expect(page.locator("#edge-selection")).toBeVisible();
  await page.locator("#edge-label").fill("+0.9");
  const [label] = await labels(page);
  expect(label!.x).toBeCloseTo(410, 2);
  expect(label!.y).toBeCloseTo(-60, 2);
});
