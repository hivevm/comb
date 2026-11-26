// The user drags an edge label, and it stays where it was dropped (G-6, REN-node-content-and-hits):
// a press inside its pill at the near level grabs it, the engine places it at the path parameter
// nearest the pointer and its distance along the normal there, and the release tells one
// `labelMoved`.
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
  edges: [
    { id: "a-b", source: "a", target: "b", labels: [{ id: "m", text: "+0.8", t: 0.5, offset: 0 }] },
  ],
};

async function labels(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().edgeLabels.map(({ edge, x, y }) => ({ edge, x, y }));
  });
}

/** An association from `a` at (0, 0) to `b` at (600, 200): a multiplicity near each end, 12 to the
 *  left of the path, and its name in the middle, which names no place
 *  (API-edges-dock-nodes-or-edges). */
const ASSOCIATION: GraphData = {
  nodes: [node("a"), node("b", 600, 200)],
  edges: [
    {
      id: "owns",
      source: "a",
      target: "b",
      arrow: "none",
      labels: [
        { id: "source", text: "1", t: 0.1, offset: 12 },
        { id: "name", text: "owns" },
        { id: "target", text: "0..*", t: 0.9, offset: 12 },
      ],
    },
  ],
};

/** The cubic from (220, 32) to (600, 232 + `dy`), control points (410, 32) and (410, 232 + `dy`),
 *  as `b` at (600, 200 + `dy`) docks it: its point at `t`, `offset` along its normal, which points
 *  left of the direction of travel, worked out apart from the engine. */
function placed(t: number, offset: number, dy = 0) {
  const p = [
    [220, 32],
    [410, 32],
    [410, 232 + dy],
    [600, 232 + dy],
  ] as const;
  const u = 1 - t;
  const at = (i: 0 | 1) =>
    u ** 3 * p[0][i] + 3 * u * u * t * p[1][i] + 3 * u * t * t * p[2][i] + t ** 3 * p[3][i];
  const d = (i: 0 | 1) =>
    3 * u * u * (p[1][i] - p[0][i]) +
    6 * u * t * (p[2][i] - p[1][i]) +
    3 * t * t * (p[3][i] - p[2][i]);
  const length = Math.hypot(d(0), d(1));
  return { x: at(0) + (d(1) / length) * offset, y: at(1) - (d(0) / length) * offset };
}

test("an association's three labels are drawn at their path parameters and follow as a node moves", async ({
  page,
}) => {
  // Verifies: G-6, G-19, API-edges-dock-nodes-or-edges
  await open(page);
  await loaded(page, ASSOCIATION);
  const drawn = async () =>
    page.evaluate(async () => {
      await window.comb.whenRendered();
      return window
        .inspect()
        .edgeLabels.map(({ edge, label, x, y, text }) => ({ edge, label, x, y, text }));
    });
  const expected = (dy: number) => [
    { edge: "owns", label: "source", ...placed(0.1, 12, dy), text: "1" },
    { edge: "owns", label: "name", ...placed(0.5, 0, dy), text: "owns" },
    { edge: "owns", label: "target", ...placed(0.9, 12, dy), text: "0..*" },
  ];
  const close = (got: Awaited<ReturnType<typeof drawn>>, want: ReturnType<typeof expected>) => {
    expect(got.map(({ edge, label, text }) => ({ edge, label, text }))).toEqual(
      want.map(({ edge, label, text }) => ({ edge, label, text })),
    );
    // Within the half pixel of Q-4 at a scale of 1.
    for (const [i, { x, y }] of want.entries()) {
      expect(Math.abs(got[i]!.x - x)).toBeLessThan(0.5);
      expect(Math.abs(got[i]!.y - y)).toBeLessThan(0.5);
    }
  };
  close(await drawn(), expected(0));
  // `b` moves down 100: every label keeps its path parameter and offset (G-6).
  const from = await screenCentre(page, "b");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 100, { steps: 5 });
  await page.mouse.up();
  close(await drawn(), expected(100));
});

test("dragging the label at the source end moves it alone and tells labelMoved naming it", async ({
  page,
}) => {
  // Verifies: G-6, API-edges-dock-nodes-or-edges, API-edits-report-division-moves
  await open(page);
  await loaded(page, ASSOCIATION);
  const before = await labels(page);
  const source = placed(0.1, 12);
  // Grabbed at its point, dropped 60 higher.
  await dragWorld(page, [source.x, source.y], [source.x, source.y - 60]);
  const after = await labels(page);
  expect(after[0]!.x).toBeCloseTo(source.x, 1);
  expect(after[0]!.y).toBeCloseTo(source.y - 60, 1);
  expect(after.slice(1)).toEqual(before.slice(1));
  const changes = await told<{ kind: string; edge: string; label: string }>(page);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    kind: "labelMoved",
    by: "user",
    edge: "owns",
    label: "source",
  });
  // The example's copy of the graph moved that label alone.
  const held = await page.evaluate(() =>
    window.exampleGraph().edges[0]!.labels!.map(({ id, t, offset }) => ({ id, t, offset })),
  );
  // As the host gave them, the name without a place.
  expect(held.slice(1)).toEqual([{ id: "name" }, { id: "target", t: 0.9, offset: 12 }]);
  expect(held[0]!.id).toBe("source");
  expect(held[0]!.offset).not.toBe(12);
});

test("a label dragged off its edge is drawn where it was dropped, and tells one labelMoved", async ({
  page,
}) => {
  // Verifies: G-6, API-edits-report-division-moves, REN-node-content-and-hits
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
    label: string;
    t: number;
    offset: number;
  };
  expect(moved).toMatchObject({ kind: "labelMoved", by: "user", edge: "a-b", label: "m" });
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
  // Verifies: REN-node-content-and-hits
  await open(page);
  const graph: GraphData = {
    nodes: [node("a"), node("b", 600), node("c", 0, 200), node("d", 600, 200)],
    edges: [
      {
        id: "short",
        source: "a",
        target: "b",
        labels: [{ id: "m", text: "1", t: 0.5, offset: 0 }],
      },
      {
        id: "long",
        source: "c",
        target: "d",
        labels: [{ id: "m", text: "a label of many characters", t: 0.5, offset: 0 }],
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
  // Verifies: REN-node-content-and-hits
  await open(page);
  await loaded(page, PAIR, { x: 100, y: 100, scale: 0.4 });
  expect((await page.evaluate(() => window.inspect())).level).toBe("middle");
  await dragWorld(page, [410, 32], [410, -200]);
  expect((await told<{ kind: string }>(page)).map(({ kind }) => kind)).not.toContain("labelMoved");
});

test("a label the host clears mid-drag ends the drag: no error, and no labelMoved", async ({
  page,
}) => {
  // Verifies: API-edits-report-division-moves, Q-7
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await loaded(page, PAIR);
  const [a, b] = [await pagePoint(page, 416, 32), await pagePoint(page, 416, -60)];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y - 20, { steps: 3 });
  await page.evaluate(() => window.comb.updateEdge("a-b", { labels: null }));
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  expect((await told<{ kind: string }>(page)).map(({ kind }) => kind)).toEqual(["edgeUpdated"]);
  expect(await labels(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("a label drag past every finite world point moves nothing and throws nothing", async ({
  page,
}) => {
  // Verifies: REN-node-content-and-hits, API-edits-report-division-moves
  // Verifies: API-shell-mistake-refused-as-shells
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
