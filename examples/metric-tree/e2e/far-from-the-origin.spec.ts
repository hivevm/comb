// Edges far from the world's origin (ADR-0010): the engine hands over the edge mesh and the label
// points relative to the query's origin, and the scene draws the world relative to it, so that an
// edge at ±5e7 is drawn as precisely as one near the origin (Q-4). A segment of an edge that
// crosses the viewport is split where it leaves the queried rectangle grown by the stroke's width
// (ADR-0012), so that its ends far beyond the viewport do not round what it shows.
import { expect, test, type Page } from "@playwright/test";
import { canvasSize, open, setViewport } from "./shared";

/** Where the far edge starts: there an `f32` holds every fourth number. */
const FAR = 5e7;
const SCALE = 4;
/** A quarter pixel, the tolerance of Q-4's 0.5 px the engine leaves to the drawing. */
const QUARTER = 0.25;

/** What is drawn of an edge from (at, 0) to (at + 300, 200) shown at `SCALE` around its middle,
 *  moved `pan` screen pixels: the screen point of every vertex the edges layer draws, as the
 *  shader computes it, the point of its label less `at`, and how many renders queried. */
async function drawnAt(page: Page, at: number, pan = 0) {
  const { width, height } = await canvasSize(page);
  await page.evaluate(async (at) => {
    const node = (id: string, x: number, y: number) => ({
      id,
      title: id,
      x,
      y,
      width: 220,
      height: 64,
    });
    window.comb.load({
      nodes: [node("a", at, 0), node("b", at + 300, 200)],
      edges: [{ id: "e", source: "a", target: "b", label: { text: "far", t: 0.5, offset: 0 } }],
    });
    await window.comb.whenRendered();
  }, at);
  // The edge runs from (at + 220, 32) to (at + 300, 232).
  const centre = { x: width / 2 - (at + 260) * SCALE, y: height / 2 - 132 * SCALE };
  await setViewport(page, { ...centre, scale: SCALE });
  const queried = await page.evaluate(() => window.inspect().queries);
  if (pan !== 0) await setViewport(page, { x: centre.x + pan, y: centre.y - pan, scale: SCALE });
  return page.evaluate(
    ({ at, queried }) => {
      const { edgeLabels, edgeMesh, queries } = window.inspect();
      return {
        vertices: [...window.edgeVertices()],
        labels: edgeLabels.map(({ x, y }) => ({ x: x - at, y })),
        detail: edgeMesh.detail,
        queriedSince: queries - queried,
      };
    },
    { at, queried },
  );
}

/** How far apart the two lists of screen coordinates lie at most, in pixels. */
function worst(a: number[], b: number[]): number {
  expect(a.length).toBe(b.length);
  return a.reduce((most, value, i) => Math.max(most, Math.abs(value - b[i]!)), 0);
}

test("an edge at 5e7 is drawn within a quarter pixel of its f64 stroke, and after a pan", async ({
  page,
}) => {
  // Verifies: Q-4, ADR-0010
  await open(page);
  // The reference: the same edge near the world's origin, where an f32 rounds by 2^-23 of 512,
  // under a ten-thousandth of a pixel: the engine's f64 stroke, shifted to the same screen place.
  const near = await drawnAt(page, 0);
  const far = await drawnAt(page, FAR);
  expect(far.detail).toBe("complete");
  expect(far.vertices.length).toBeGreaterThan(12);
  expect(worst(far.vertices, near.vertices)).toBeLessThanOrEqual(QUARTER);
  expect(far.labels).toHaveLength(1);
  const label = (s: typeof far) => s.labels.flatMap(({ x, y }) => [x * SCALE, y * SCALE]);
  expect(worst(label(far), label(near))).toBeLessThanOrEqual(QUARTER);

  // A pan within the culling margin moves the world alone, and the mesh stays where it was drawn.
  const nearPanned = await drawnAt(page, 0, 40);
  const farPanned = await drawnAt(page, FAR, 40);
  expect(farPanned.queriedSince).toBe(0);
  expect(nearPanned.queriedSince).toBe(0);
  expect(worst(farPanned.vertices, nearPanned.vertices)).toBeLessThanOrEqual(QUARTER);
  expect(worst(farPanned.vertices.slice(0, 2), far.vertices.slice(0, 2))).toBeCloseTo(40, 1);
});

/** Where the long edge's connectors lie: from about (-FAR_END, -0.3 FAR_END) to the opposite
 *  point. Where the edge turns from one bend into the other, just past its middle, it is so
 *  nearly straight that a quarter pixel's tolerance at `SCALE` leaves it one segment some 4e7
 *  long, whose ends lie about 2e7 from a viewport there and round by more than a pixel. Edges
 *  leave and enter their nodes level, so no edge the graph data describes is straight and
 *  slanted; this one is as near to it as a viewport needs. */
const FAR_END = 8e11;

/** The point at `t` of the cubic Bézier curve through `p`, in f64. */
function bezier(p: [number, number][], t: number): [number, number] {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [0, 1].map((axis) => p.reduce((sum, q, i) => sum + w[i]! * q[axis]!, 0)) as [
    number,
    number,
  ];
}

/** How far the screen point `p` lies from the segment `a`–`b`. */
function toSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length2 = dx * dx + dy * dy;
  const t =
    length2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Loads the long edge, without an arrowhead, and returns its path, in f64. */
async function loadLongEdge(page: Page): Promise<[number, number][]> {
  // Node positions are f32: these are, and so are the connectors the engine computes from them.
  const [ax, ay] = [Math.fround(-FAR_END - 220), Math.fround(-0.3 * FAR_END - 32)];
  const [bx, by] = [Math.fround(FAR_END), Math.fround(0.3 * FAR_END - 32)];
  await page.evaluate(
    async ({ ax, ay, bx, by }) => {
      const node = (id: string, x: number, y: number) => ({
        id,
        title: id,
        x,
        y,
        width: 220,
        height: 64,
      });
      window.comb.load({
        nodes: [node("a", ax, ay), node("b", bx, by)],
        edges: [{ id: "e", source: "a", target: "b", arrow: "none" }],
      });
      await window.comb.whenRendered();
    },
    { ax, ay, bx, by },
  );
  // The edge's path: from the right middle of a to the left middle of b, its control points
  // pulled level by half the horizontal distance.
  const source: [number, number] = [ax + 220, ay + 32];
  const target: [number, number] = [bx, by + 32];
  const pull = (target[0] - source[0]) / 2;
  return [source, [source[0] + pull, source[1]], [target[0] - pull, target[1]], target];
}

test("a segment whose ends lie far outside the viewport is drawn within a quarter pixel", async ({
  page,
}) => {
  // Verifies: Q-4, ADR-0012
  await open(page);
  const { width, height } = await canvasSize(page);
  const path = await loadLongEdge(page);
  // The viewport on that segment, just past the edge's middle.
  const middle = 0.5 + 2 ** -16;
  const [cx, cy] = bezier(path, middle);
  const viewport = { x: width / 2 - cx * SCALE, y: height / 2 - cy * SCALE, scale: SCALE };
  await setViewport(page, viewport);
  const drawn = await page.evaluate(() => ({
    vertices: [...window.edgeVertices()],
    detail: window.inspect().edgeMesh.detail,
  }));
  expect(drawn.detail).toBe("complete");
  // The two sides of the stroke the shell draws: the first and the second vertex of each point.
  const v = drawn.vertices;
  const sides: [number, number][][] = [[], []];
  for (let i = 0; i + 3 < v.length; i += 4) {
    sides[0]!.push([v[i]!, v[i + 1]!]);
    sides[1]!.push([v[i + 2]!, v[i + 3]!]);
  }
  // The points of the edge inside the viewport, on screen, under a pixel apart along it.
  const inside: [number, number][] = [];
  const span = (Math.max(width, height) / SCALE / FAR_END) * 1.5;
  for (let i = -6000; i <= 6000; i++) {
    const [x, y] = bezier(path, middle + (span * i) / 6000);
    const screen: [number, number] = [viewport.x + x * SCALE, viewport.y + y * SCALE];
    if (screen[0] >= 0 && screen[0] <= width && screen[1] >= 0 && screen[1] <= height) {
      inside.push(screen);
    }
  }
  expect(inside.length).toBeGreaterThan(2000);
  // Each lies half the stroke's width, 1 world unit, from either side.
  const off = inside.flatMap((p) =>
    sides.map((side) => {
      const least = side
        .slice(1)
        .reduce((most, b, i) => Math.min(most, toSegment(p, side[i]!, b)), Infinity);
      return Math.abs(least - SCALE);
    }),
  );
  expect(Math.max(...off)).toBeLessThanOrEqual(QUARTER);
});
