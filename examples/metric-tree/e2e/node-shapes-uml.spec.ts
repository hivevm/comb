// The node shapes of UML that hold content, their outlines, and separators (G-18,
// REN-node-shapes-cover-uml, REN-node-content-and-hits): the pentagon, the notched rectangle, the
// note, and the frame lay their content out in their inner rectangle, the frame's in its tab; an
// outline is drawn solid, not at all, or in the dashes the engine lays along it; and a separator
// row is a line across the inner rectangle. The Canvas 2D fallback draws them as WebGL2 does.
import { expect, test, type Page } from "@playwright/test";
import type { GraphData, NodeContent, NodeShape, Outline, PlacedNodeData } from "comb";
import { clickWorld, loaded, open, selections, titled, told } from "./shared";

/** The four node shapes of the ticket, a node of each 220 wide of one title, side by side. */
const SHAPES: readonly NodeShape[] = ["pentagon", "notched-rectangle", "note", "frame"];

const shapedNode = (shape: NodeShape, i: number): PlacedNodeData => ({
  id: shape,
  x: i * 300,
  y: 0,
  width: 220,
  shape,
  content: titled(shape),
});

/** A rectangle 300 × 100 below a node `n` drawn above it, both at (0, 0). */
const below = (n: PlacedNodeData): GraphData => ({
  nodes: [{ id: "under", x: 0, y: 0, width: 300, height: 100, content: titled("under") }, n],
  edges: [],
});

/** A node `id` of the node shape `shape`, 220 wide and 64 high, at (0, 0), of `outline`. */
const outlined = (shape: NodeShape, outline?: Outline): PlacedNodeData => ({
  id: "o",
  x: 0,
  y: 0,
  width: 220,
  shape,
  content: titled("o"),
  ...(outline === undefined ? {} : { outline }),
});

/** What the canvas draws of each node view, once drawn. */
async function drawnViews(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().nodes.filter((node) => node.outline !== undefined);
  });
}

/** The dashes of `segments`: each run of segments that meet end to end, as its start, its end,
 *  and its length along them. */
function dashesOf(segments: number[][]) {
  const dashes: { from: number[]; to: number[]; length: number }[] = [];
  for (const [x0, y0, x1, y1] of segments) {
    const length = Math.hypot(x1! - x0!, y1! - y0!);
    const last = dashes.at(-1);
    if (last && Math.hypot(last.to[0]! - x0!, last.to[1]! - y0!) < 1e-3) {
      last.to = [x1!, y1!];
      last.length += length;
    } else dashes.push({ from: [x0!, y0!], to: [x1!, y1!], length });
  }
  return dashes;
}

/** How far `(x, y)` lies off the outline of a rounded rectangle `width` × `height` of corners of
 *  10, by its own equation, apart from the engine's. */
function offRounded(width: number, height: number, x: number, y: number) {
  const [a, b, r] = [width / 2, height / 2, 10];
  const [dx, dy] = [Math.abs(x - a), Math.abs(y - b)];
  const [ex, ey] = [dx - (a - r), dy - (b - r)];
  if (ex > 0 && ey > 0) return Math.abs(Math.hypot(ex, ey) - r);
  return Math.min(Math.abs(dx - a), Math.abs(dy - b)) + Math.max(dx - a, 0) + Math.max(dy - b, 0);
}

test("a pentagon, a notched rectangle, a note, and a frame lay their content out in their inner rectangle, as high as heightOf gives", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml, API-host-asks-content-height
  await open(page);
  const graph: GraphData = { nodes: SHAPES.map(shapedNode), edges: [] };
  await loaded(page, graph, { x: 20, y: 20, scale: 1 });
  const views = await drawnViews(page);
  expect(views.map(({ id }) => id)).toEqual(SHAPES);
  const asked = await page.evaluate(
    (nodes) => nodes.map((n) => window.comb.heightOf(n.content, n.width, n.shape)),
    graph.nodes,
  );
  views.forEach(({ id, width, height, inner, texts }, i) => {
    expect({ id, height }).toEqual({ id, height: asked[i] });
    // The point and the notch half the height deep, at most a quarter of the width.
    const d = Math.min(height / 2, width / 4);
    const title = texts![0]!;
    const expected = {
      pentagon: { x: 0, y: 0, width: width - d, height },
      "notched-rectangle": { x: d, y: 0, width: width - d, height },
      note: { x: 0, y: 0, width, height },
      // The tab at the top left, as wide as its title and the padding of 12 either side, and as
      // high as its line of 18 and the padding of 10 above and below.
      frame: { x: 0, y: 0, width: title.width + 24, height: 38 },
    }[id as "pentagon"];
    expect({ id, inner }).toEqual({ id, inner: expected });
    // The title at the padding inside it, its column as wide as the inner rectangle less it.
    expect({ id, x: title.x, y: title.y, w: title.width }).toEqual({
      id,
      x: Math.floor(expected.x) + 12,
      y: 10,
      w: expected.width - 24,
    });
  });
  // The frame's tab is narrower than the frame, whose title is drawn uncut.
  const frame = views.find(({ id }) => id === "frame")!;
  expect(frame.inner!.width).toBeLessThan(frame.width);
  expect(frame.texts![0]!.drawn).toBe("frame");
});

test("a press inside a pentagon's bounding rectangle beyond its point, or in a notch, hits what lies below", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml
  await open(page);
  await loaded(page, below(outlined("pentagon")), { x: 50, y: 50, scale: 2 });
  // The pentagon is 64 high, its point 32 deep from x = 188 to its tip at (220, 32).
  const last = async () => ((await selections(page)).at(-1) as { id: string } | null)?.id;
  await clickWorld(page, 215, 4);
  expect(await last()).toBe("under");
  await clickWorld(page, 215, 32);
  expect(await last()).toBe("o");
  await loaded(page, below(outlined("notched-rectangle")), { x: 50, y: 50, scale: 2 });
  await clickWorld(page, 5, 32);
  expect(await last()).toBe("under");
  await clickWorld(page, 5, 3);
  expect(await last()).toBe("o");
});

test("a rounded rectangle dashed six and four lays its dashes on its outline in the pattern, and without an outline draws its fill alone", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml, Q-4
  await open(page);
  await loaded(page, { nodes: [outlined("rounded-rectangle", [6, 4])], edges: [] });
  const [dashed] = await drawnViews(page);
  expect(dashed!.outlined).toEqual([6, 4]);
  const { width, height } = dashed!;
  // Each end of a segment on the outline within Q-4's half pixel at the scale of 1.
  for (const [x0, y0, x1, y1] of dashed!.dashes!) {
    expect(offRounded(width, height, x0!, y0!)).toBeLessThanOrEqual(0.5);
    expect(offRounded(width, height, x1!, y1!)).toBeLessThanOrEqual(0.5);
  }
  // Dashes of 6 but the last, from the top left arc clockwise, one for every 10 of the outline.
  const dashes = dashesOf(dashed!.dashes!);
  for (const dash of dashes.slice(0, -1)) expect(dash.length).toBeCloseTo(6, 1);
  const perimeter = 2 * (width + height) - 80 + 2 * Math.PI * 10;
  expect(dashes.length).toBe(Math.ceil(perimeter / 10));
  const corner = 10 * (1 - Math.SQRT1_2);
  expect(dashes[0]!.from[0]).toBeCloseTo(corner, 1);
  expect(dashes[0]!.from[1]).toBeCloseTo(corner, 1);
  // Its fill, and the dashes stroked, and no solid stroke of its outline.
  const strokes = dashed!.outline!.filter(({ action }) => action === "stroke");
  expect(strokes.map(({ kind }) => kind)).not.toContain("roundedRectangle");
  expect(strokes.length).toBeGreaterThan(0);
  // Without an outline, its fill alone, no dash, and still hit within its outline.
  await loaded(page, { nodes: [outlined("rounded-rectangle", "none")], edges: [] });
  const [bare] = await drawnViews(page);
  expect(bare!.outline!.map(({ kind, action }) => ({ kind, action }))).toEqual([
    { kind: "roundedRectangle", action: "fill" },
  ]);
  expect(bare!.dashes).toEqual([]);
  await clickWorld(page, 110, 32);
  expect((await selections(page)).at(-1)).toEqual({ kind: "node", id: "o" });
  // Selected, its outline is drawn solid in the selection's colour.
  const [selected] = await drawnViews(page);
  const stroke = selected!.outline!.find(({ action }) => action === "stroke");
  expect(stroke).toMatchObject({ kind: "roundedRectangle", color: 0x3b82f6 });
});

test("content whose second row is a separator draws a line across the inner rectangle between the first and the third row", async ({
  page,
}) => {
  // Verifies: REN-node-content-and-hits
  await open(page);
  const content: NodeContent = [
    [{ kind: "text", role: "title", text: "Idle" }],
    "separator",
    [{ kind: "text", role: "body", text: "entry / wait" }],
  ];
  const state: PlacedNodeData = { id: "s", x: 0, y: 0, width: 220, content };
  await loaded(page, { nodes: [state], edges: [] });
  const [drawn] = await drawnViews(page);
  const [first, third] = drawn!.texts!;
  expect(drawn!.rules).toEqual([
    { x: 0, y: first!.y + first!.height + 10, width: 220, height: 1, color: 0xd0d4dc },
  ]);
  const rule = drawn!.rules![0]!;
  expect(rule.y + rule.height + 10).toBe(third!.y);
  // Comb keeps the row as the string it was given, each element's weight filled in.
  expect(drawn!.content).toEqual([
    [{ kind: "text", role: "title", text: "Idle", weight: 1 }],
    "separator",
    [{ kind: "text", role: "body", text: "entry / wait", weight: 1 }],
  ]);
  // Drawn at the middle level too.
  await page.evaluate(async () => {
    window.comb.setViewport({ x: 0, y: 0, scale: 0.4 });
    await window.comb.whenRendered();
  });
  const [middle] = await drawnViews(page);
  expect(middle!.rules!.length).toBe(1);
});

test("updateNode with an outline of six and four draws the node's outline in those dashes", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml, API-edits-report-nested-changes
  await open(page);
  await loaded(page, { nodes: [outlined("note")], edges: [] });
  const [solid] = await drawnViews(page);
  expect(solid!.outlined).toBe("solid");
  expect(solid!.dashes).toEqual([]);
  await page.evaluate(async () => {
    window.comb.updateNode("o", { outline: [6, 4] });
    await window.comb.whenRendered();
  });
  const [dashed] = await drawnViews(page);
  expect(dashed!.outlined).toEqual([6, 4]);
  expect(dashed!.dashes!.length).toBeGreaterThan(40);
  expect(await told(page)).toEqual([
    { kind: "nodeUpdated", by: "host", id: "o", patch: { outline: [6, 4] } },
  ]);
  // One the bridge refuses changes nothing.
  const refused = await page.evaluate(() => {
    try {
      window.comb.updateNode("o", { outline: [0, 4] });
      return null;
    } catch (error) {
      return (error as { problem?: unknown }).problem;
    }
  });
  expect(refused).toMatchObject({ kind: "invalidField", field: "outline", id: "o" });
  const [kept] = await drawnViews(page);
  expect(kept!.outlined).toEqual([6, 4]);
});

test("on the Canvas 2D fallback a dashed outline is drawn dashed: the fill in a gap and the outline's colour on a dash", async ({
  page,
}) => {
  // Verifies: REN-webgl2-or-canvas-fallback, REN-node-shapes-cover-uml
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, id: string, options?: unknown) {
        return id.startsWith("webgl") ? null : Reflect.apply(getContext, this, [id, options]);
      },
    });
  });
  await open(page, "?fallback=canvas");
  await loaded(
    page,
    { nodes: [outlined("rounded-rectangle", [6, 4])], edges: [] },
    {
      x: 40,
      y: 40,
      scale: 4,
    },
  );
  const [dashed] = await drawnViews(page);
  expect(await page.evaluate(() => window.inspect().renderer)).toBe("canvas");
  // A dash along the straight top, and the gap after it, each sampled at its middle a quarter of
  // a world unit inside the outline, within half the stroke's width of 1.
  const top = dashed!.dashes!.filter(([, y0, x1, y1]) => y0 === 0 && y1 === 0 && x1! < 200);
  const dash = top[2]!;
  const next = top[3]!;
  const samples = [
    { x: (dash[0]! + dash[2]!) / 2, y: 0.25 },
    { x: (dash[2]! + next[0]!) / 2, y: 0.25 },
  ];
  const colors = await page.evaluate(async (points) => {
    await window.comb.whenRendered();
    await new Promise(requestAnimationFrame);
    const source = document.querySelector<HTMLCanvasElement>("#canvas canvas")!;
    const copy = document.createElement("canvas");
    [copy.width, copy.height] = [source.width, source.height];
    const context = copy.getContext("2d")!;
    context.drawImage(source, 0, 0);
    const ratio = source.width / source.clientWidth;
    return points.map(({ x, y }) => {
      const at = window.screenPoint(x, y);
      const { data } = context.getImageData(
        Math.floor(at.x * ratio),
        Math.floor(at.y * ratio),
        1,
        1,
      );
      return [data[0]!, data[1]!, data[2]!];
    });
  }, samples);
  const near = (color: number[], want: number) =>
    color.every((value, i) => Math.abs(value - ((want >> (16 - 8 * i)) & 0xff)) <= 12);
  // The border's grey on the dash, the white fill in the gap.
  expect({ dash: colors[0], on: near(colors[0]!, 0xd0d4dc) }).toEqual({
    dash: colors[0],
    on: true,
  });
  expect({ gap: colors[1], on: near(colors[1]!, 0xffffff) }).toEqual({ gap: colors[1], on: true });
});

test("a large dashed node panned across a query draws the dashes of the part it then shows", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml
  // A frame 4000 × 900 dashed six and four: the engine lays its dashes within each query's
  // rectangle, so a pan past the culling margin, which queries again, shows those of the new part.
  await open(page);
  const frame: PlacedNodeData = {
    id: "big",
    x: 0,
    y: 0,
    width: 4000,
    height: 900,
    shape: "frame",
    outline: [6, 4],
    content: titled("big"),
  };
  await loaded(page, { nodes: [frame], edges: [] }, { x: -200, y: 100, scale: 1 });
  // The dashes along the top side that lie within the visible rectangle, as inspection reports.
  const shown = () =>
    page.evaluate(async () => {
      await window.comb.whenRendered();
      const { minX, maxX } = window.visibleRect();
      const big = window.inspect().nodes.find(({ id }) => id === "big")!;
      const top = big.dashes!.filter(([, y0, , y1]) => y0 === 0 && y1 === 0);
      return {
        queries: window.inspect().queries,
        inView: top.filter(([x0, , x1]) => x1! > minX && x0! < maxX).length,
        width: maxX - minX,
      };
    });
  const before = await shown();
  expect(before.inView).toBeGreaterThan(before.width / 10 - 2);
  // Far to the right, past the margin, along the top side.
  await page.evaluate(async () => {
    window.comb.setViewport({ x: -2500, y: 100, scale: 1 });
    await window.comb.whenRendered();
  });
  const after = await shown();
  expect(after.queries).toBeGreaterThan(before.queries);
  expect(after.inView).toBeGreaterThan(after.width / 10 - 2);
});

test("an outline left out is filled in as solid in what Comb tells and keeps", async ({ page }) => {
  // Verifies: REN-node-shapes-cover-uml
  await open(page);
  await loaded(page, { nodes: [outlined("note")], edges: [] });
  await page.evaluate(async () => {
    window.comb.addNode({ id: "n", x: 400, y: 0, width: 120, content: [] });
    await window.comb.whenRendered();
  });
  const added = (await told<{ kind: string; node: { outline?: unknown } }>(page)).at(-1)!;
  expect(added.kind).toBe("nodeAdded");
  expect(added.node.outline).toBe("solid");
  // The example's copy, which follows what Comb tells, holds it too.
  const copy = await page.evaluate(() => window.exampleGraph().nodes.find(({ id }) => id === "n"));
  expect(copy!.outline).toBe("solid");
});
