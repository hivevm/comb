// Edges far from the world's origin (ADR-0010): the engine hands over the edge mesh and the label
// points relative to the query's origin, and the scene draws the world relative to it, so that an
// edge at ±5e7 is drawn as precisely as one near the origin (Q-4).
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
