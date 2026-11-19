// The open and the hollow arrowhead and the lightning bolt (G-19, API-edges-dock-nodes-or-edges):
// what the canvas draws of each, read off a screenshot with the nodes and labels hidden, on WebGL2
// and on the Canvas 2D fallback, and the triangles the edges layer draws at each level of detail.
import { expect, test, type Page } from "@playwright/test";
import type { Arrowhead, EdgeData, GraphData } from "comb";
import { loaded, node, open } from "./shared";

const [RED, BLUE, BACKGROUND, WHITE] = [0xdc2626, 0x1d4ed8, 0xf7f8fa, 0xffffff];

/** Edge `e` from `a` at (0, 0) to `b` at (600, 0), straight along y = 32 from (220, 32) to its
 *  target's end at (600, 32), in red, with `fields`. */
const straight = (fields: Partial<EdgeData>): GraphData => ({
  nodes: [node("a"), node("b", 600)],
  edges: [{ id: "e", source: "a", target: "b", color: RED, ...fields }],
});

/** On the Canvas 2D fallback, where the host application opts in and WebGL2 is missing. */
async function openOnCanvas(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, id: string, options?: unknown) {
        return id.startsWith("webgl") ? null : Reflect.apply(getContext, this, [id, options]);
      },
    });
  });
  await open(page, "?fallback=canvas");
}

/** The colour the canvas draws at each world point of `points`, `0xRRGGBB`, read off a screenshot
 *  with the nodes and edge labels hidden. */
async function colorsAt(page: Page, points: readonly (readonly [number, number])[]) {
  await page.evaluate(async () => {
    window.showLayers({ nodes: false, edgeLabels: false });
    await window.comb.whenRendered();
  });
  const png = await page.locator("#canvas canvas").screenshot();
  return page.evaluate(
    async ({ shot, at }) => {
      const bytes = Uint8Array.from(atob(shot), (char) => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const ratio = image.width / document.querySelector("#canvas canvas")!.clientWidth;
      const copy = document.createElement("canvas");
      [copy.width, copy.height] = [image.width, image.height];
      const context = copy.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return at.map(([x, y]) => {
        const screen = window.screenPoint(x!, y!);
        const { data } = context.getImageData(
          Math.floor(screen.x * ratio),
          Math.floor(screen.y * ratio),
          1,
          1,
        );
        return (data[0]! << 16) | (data[1]! << 8) | data[2]!;
      });
    },
    { shot: png.toString("base64"), at: points.map(([x, y]) => [x, y]) },
  );
}

/** Whether `color` lies within a tolerance of `want`, both `0xRRGGBB`. */
const near = (color: number, want: number) =>
  [16, 8, 0].every((shift) => Math.abs(((color >> shift) & 0xff) - ((want >> shift) & 0xff)) < 40);

/** Scale 4, the edge's end at (600, 32) in the middle of the canvas. */
const AT_THE_TIP = { x: 400 - 595 * 4, y: 300 - 32 * 4, scale: 4 };

/** The arrowhead runs 10 back from the tip at (600, 32) to its base at (590, 32), 5 either side:
 *  inside it, between the stroke and a side, at (591, 34.2) and (591, 29.8), more than half the
 *  stroke's width of 2 from both; at its middle (595, 32); and 2 past the tip, at (602, 32). */
const INSIDE = [
  [591, 34.2],
  [591, 29.8],
] as const;
const MIDDLE = [595, 32] as const;
const TIP = [599.5, 32] as const;
const PAST = [602, 32] as const;

for (const renderer of ["webgl", "canvas"] as const) {
  test(`on ${renderer}, an open arrowhead is two strokes meeting at the target, the stroke running to the tip`, async ({
    page,
  }) => {
    // Verifies: API-edges-dock-nodes-or-edges, G-19, REN-webgl2-or-canvas-fallback
    if (renderer === "canvas") await openOnCanvas(page);
    else await open(page);
    await loaded(page, straight({ arrow: "open" }), AT_THE_TIP);
    expect(await page.evaluate(() => window.inspect().renderer)).toBe(renderer);
    const [inside, other, middle, tip, past] = await colorsAt(page, [...INSIDE, MIDDLE, TIP, PAST]);
    // Open between the stroke and either side, the stroke drawn through its middle to the tip,
    // nothing past it.
    expect([inside, other].map((color) => near(color!, BACKGROUND))).toEqual([true, true]);
    expect([middle, tip].map((color) => near(color!, RED))).toEqual([true, true]);
    expect(near(past!, BACKGROUND)).toBe(true);
  });

  test(`on ${renderer}, a hollow arrowhead is its outline in the edge's colour around a white fill, its tip at the target`, async ({
    page,
  }) => {
    // Verifies: API-edges-dock-nodes-or-edges, G-19, REN-webgl2-or-canvas-fallback
    if (renderer === "canvas") await openOnCanvas(page);
    else await open(page);
    await loaded(page, straight({ arrow: "hollow", color: BLUE }), AT_THE_TIP);
    // White inside, where the stroke stops at the base, blue on the outline at the tip, and
    // nothing past it; a filled arrowhead draws its colour in the middle.
    const base = [589, 32] as const;
    const [middle, inside, tip, past, stroke] = await colorsAt(page, [
      MIDDLE,
      INSIDE[0],
      TIP,
      PAST,
      base,
    ]);
    expect([middle, inside].map((color) => near(color!, WHITE))).toEqual([true, true]);
    expect([tip, stroke].map((color) => near(color!, BLUE))).toEqual([true, true]);
    expect(near(past!, BACKGROUND)).toBe(true);
    await page.evaluate(() => window.comb.updateEdge("e", { arrow: "end" }));
    const [filled] = await colorsAt(page, [MIDDLE]);
    expect(near(filled!, BLUE)).toBe(true);
  });

  test(`on ${renderer}, a lightning bolt draws its two turns between the path parameters 0.45 and 0.55`, async ({
    page,
  }) => {
    // Verifies: API-edges-dock-nodes-or-edges, G-19, REN-webgl2-or-canvas-fallback
    if (renderer === "canvas") await openOnCanvas(page);
    else await open(page);
    // Scale 4 around the middle of the edge, (410, 32). Its path is the cubic from (220, 32) to
    // (600, 32) with both control points at (410, 32), worked out apart from the engine; the
    // turns lie 6 to its left and to its right at a third and two thirds of the way from 0.45 to
    // 0.55.
    await loaded(page, straight({ arrow: "none", lightning: true }), {
      x: 400 - 410 * 4,
      y: 300 - 32 * 4,
      scale: 4,
    });
    const x = (t: number) => 220 * (1 - t) ** 3 + 3 * 410 * (1 - t) * t + 600 * t ** 3;
    const [first, second] = [0.45 + 0.1 / 3, 0.55 - 0.1 / 3];
    const [one, other, between, before, after, beside] = await colorsAt(page, [
      [x(first), 26],
      [x(second), 38],
      [x(first), 32],
      [x(0.4), 32],
      [x(0.6), 32],
      [x(0.4), 26],
    ]);
    // The turns drawn, the path between them not, the path before 0.45 and after 0.55 drawn as
    // before, and nothing off it there.
    expect([one, other, before, after].map((color) => near(color!, RED))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([between, beside].map((color) => near(color!, BACKGROUND))).toEqual([true, true]);
  });
}

test("each arrowhead adds its triangles at the near and the middle level, and none at the far level", async ({
  page,
}) => {
  // Verifies: API-edges-dock-nodes-or-edges, REN-virtualized-nested-scene
  await open(page);
  /** The level and the triangles the edges layer draws of the edge with each arrowhead, at
   *  `scale`. */
  const drawn = async (scale: number) => {
    const counts: Partial<Record<Arrowhead, number>> = {};
    let level = "";
    for (const arrow of ["none", "end", "open", "hollow"] as const) {
      await loaded(page, straight({ arrow }), { x: 100, y: 100, scale });
      const seen = await page.evaluate(async () => {
        await window.comb.whenRendered();
        const { edgeTriangles, level: at } = window.inspect();
        return { edgeTriangles, at };
      });
      counts[arrow] = seen.edgeTriangles;
      level = seen.at;
    }
    return { level, counts: counts as Record<Arrowhead, number> };
  };
  // Two open strokes are two quads, four triangles, beside a stroke that runs on to the tip as
  // without an arrowhead; a hollow one is its white fill and an outline of four segments, eight
  // triangles more than the filled one's, whose stroke stops at the same base.
  for (const [scale, level] of [
    [1, "near"],
    [0.4, "middle"],
  ] as const) {
    const { level: at, counts } = await drawn(scale);
    expect(at).toBe(level);
    expect(counts.open - counts.none).toBe(4);
    expect(counts.hollow - counts.end).toBe(8);
  }
  // The far level draws plain lines, without arrowheads.
  const far = await drawn(0.1);
  expect(far.level).toBe("far");
  expect(new Set(Object.values(far.counts)).size).toBe(1);
});
