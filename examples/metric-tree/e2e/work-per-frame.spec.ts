// The work a frame does on the GPU and in the pools (ADR-0012).
import { expect, test, type Page } from "@playwright/test";
import { canvasSize, open, sceneNumbers, screenCentre, setViewport } from "./shared";

/** What the canvas has done so far, from comb/testing. */
async function work(page: Page) {
  return page.evaluate(() => window.work());
}

type Work = Awaited<ReturnType<typeof work>>;

/** What the canvas did between two readings of `work`. */
function done(before: Work, after: Work): Work {
  const keys = Object.keys(before) as (keyof Work)[];
  return Object.fromEntries(keys.map((key) => [key, after[key] - before[key]])) as unknown as Work;
}

const NOTHING: Work = {
  buffersCreated: 0,
  bufferAllocations: 0,
  bufferResizes: 0,
  bytesUploaded: 0,
  meshBytesUploaded: 0,
  textureUploads: 0,
  viewsCreated: 0,
};

/** Centred on world (7000, 3000), well inside the grid of 100 copies, at `scale`. */
async function centred(page: Page, scale: number) {
  const { width, height } = await canvasSize(page);
  return { x: width / 2 - 7000 * scale, y: height / 2 - 3000 * scale, scale };
}

/** Pans by `step` screen pixels to the right a frame, for `frames` frames, from `start`. */
async function pan(
  page: Page,
  start: { x: number; y: number; scale: number },
  frames: number,
  step = 1,
) {
  await page.evaluate(
    async ({ start, frames, step }) => {
      for (let i = 1; i <= frames; i++) {
        window.comb.setViewport({ ...start, x: start.x - i * step });
        await window.comb.whenRendered();
      }
    },
    { start, frames, step },
  );
}

test("a pan within the queried rectangle creates, resizes, and uploads nothing, at every level", async ({
  page,
}) => {
  // Verifies: ADR-0012
  test.setTimeout(60_000);
  await open(page, "?copies=100");
  const { cullingMargin } = await sceneNumbers(page);
  const frames = 60;
  // One screen pixel a frame stays within the margin the last query reached beyond the viewport.
  expect(frames).toBeLessThan(cullingMargin);
  for (const [scale, level] of [
    [1, "near"],
    [0.45, "middle"],
    [0.2, "far"],
  ] as const) {
    const start = await centred(page, scale);
    const before = await work(page);
    await setViewport(page, { ...start, x: start.x + 5000 });
    await setViewport(page, start);
    expect(await page.evaluate(() => window.inspect().level)).toBe(level);
    // The query that warmed the scene up uploaded its mesh: the counters see the uploads.
    expect((await work(page)).meshBytesUploaded).toBeGreaterThan(before.meshBytesUploaded);
    const { queries, renders } = await page.evaluate(() => window.inspect());
    const warm = await work(page);
    await pan(page, start, frames);
    const panned = await page.evaluate(() => window.inspect());
    expect(panned.renders).toBe(renders + frames);
    expect(panned.queries).toBe(queries);
    expect({ level, ...done(warm, await work(page)) }).toEqual({ level, ...NOTHING });
  }
});

test("a pan across queries at the near level takes every view from the warm pools", async ({
  page,
}) => {
  // Verifies: ADR-0012
  test.setTimeout(60_000);
  await open(page, "?copies=100");
  const { cullingMargin } = await sceneNumbers(page);
  const start = await centred(page, 1);
  await setViewport(page, start);
  // Half the margin a frame for 40 frames: the viewport leaves what it last queried every few
  // frames, and views of nodes and labels return to the pools and are bound again.
  const frames = 40;
  const step = cullingMargin / 2;
  await pan(page, start, frames, step);
  await setViewport(page, start);
  const { queries } = await page.evaluate(() => window.inspect());
  const warm = await work(page);
  await pan(page, start, frames, step);
  const panned = await page.evaluate(() => window.inspect());
  expect(panned.level).toBe("near");
  expect(panned.queries).toBeGreaterThanOrEqual(queries + frames / 4);
  expect(panned.edgeLabels.length).toBeGreaterThan(0);
  expect(done(warm, await work(page)).viewsCreated).toBe(0);
});

test("a drag at the far level updates the GPU buffers in place, never reallocating them", async ({
  page,
}) => {
  // Verifies: ADR-0012
  await open(page);
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width / 2, y: height / 2, scale: 0.2 });
  expect(await page.evaluate(() => window.inspect().level)).toBe("far");
  const from = await screenCentre(page, "0:0.0");
  const frames = 60;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Pressing selects the node, which renders once more before the drag.
  await page.evaluate(() => window.comb.whenRendered());
  const { queries, edgeTriangles, edgeMesh } = await page.evaluate(() => window.inspect());
  const warm = await work(page);
  // The node moves down and away from its edges' other ends: the mesh grows with them.
  const largest = { vertices: 0, indices: 0 };
  for (let i = 1; i <= frames; i++) {
    await page.mouse.move(from.x, from.y + 2 * i);
    const { vertices, indices } = await page.evaluate(async () => {
      await window.comb.whenRendered();
      return window.inspect().edgeMesh;
    });
    largest.vertices = Math.max(largest.vertices, vertices);
    largest.indices = Math.max(largest.indices, indices);
  }
  const did = done(warm, await work(page));
  const dragged = await page.evaluate(() => window.inspect());
  await page.mouse.up();
  // Every frame moved the node, so every frame queried, synced the particles, and uploaded them.
  expect(dragged.queries).toBe(queries + frames);
  expect(dragged.particles).toBe(dragged.nodes.length);
  expect(dragged.edgeTriangles).toBeGreaterThan(edgeTriangles);
  // The premise: the mesh never outgrew the room it had before the drag, which a larger scene
  // would, rightly growing its buffers.
  expect(largest.vertices).toBeLessThanOrEqual(edgeMesh.capacity.vertices);
  expect(largest.indices).toBeLessThanOrEqual(edgeMesh.capacity.indices);
  // The mesh uploaded, and so did the particles, beyond the mesh's bytes.
  expect(did.meshBytesUploaded).toBeGreaterThan(0);
  expect(did.bytesUploaded - did.meshBytesUploaded).toBeGreaterThan(0);
  expect(did).toEqual({
    ...NOTHING,
    bytesUploaded: did.bytesUploaded,
    meshBytesUploaded: did.meshBytesUploaded,
  });
});
