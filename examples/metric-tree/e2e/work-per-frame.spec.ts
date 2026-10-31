// The work a frame does on the GPU and in the pools (ADR-0027).
import { expect, test, type Page } from "@playwright/test";
import { canvasOrigin, canvasSize, open, sceneNumbers, screenCentre, setViewport } from "./shared";

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
    async ({ start: from, frames: count, step: stride }) => {
      for (let i = 1; i <= count; i++) {
        window.comb.setViewport({ ...from, x: from.x - i * stride });
        await window.comb.whenRendered();
      }
    },
    { start, frames, step },
  );
}

test("a pan within the queried rectangle creates, resizes, and uploads nothing, at every level", async ({
  page,
}) => {
  // Verifies: ADR-0027
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
  // Verifies: ADR-0027
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
  // Verifies: ADR-0027
  await open(page);
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width / 2, y: height / 2, scale: 0.2 });
  expect(await page.evaluate(() => window.inspect().level)).toBe("far");
  const from = await screenCentre(page, "0:0.0");
  const frames = 60;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Pressing selects the node, and a move past the slop of 4 pixels begins its drag (ADR-0013),
  // each of which renders once more before the frames counted.
  await page.evaluate(() => window.comb.whenRendered());
  const slop = 5;
  await page.mouse.move(from.x, from.y + slop);
  await page.evaluate(() => window.comb.whenRendered());
  const { queries, edgeTriangles, edgeMesh } = await page.evaluate(() => window.inspect());
  const warm = await work(page);
  // The node moves down and away from its edges' other ends: the mesh grows with them.
  const largest = { vertices: 0, indices: 0 };
  for (let i = 1; i <= frames; i++) {
    await page.mouse.move(from.x, from.y + slop + 2 * i);
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

/** How many element views of node views, by kind, the canvas has drawn so far. */
type ElementViews = { text: number; sprite: number; graphics: number };

declare global {
  interface Window {
    /** How many element views the node views drawn have shown since the page opened, each counted
     *  once however often it is drawn again: texts, icons' sprites, and the `Graphics` of boxes,
     *  pills, bars, and arrows; `countElementViews` installs it. */
    elementViews?: () => ElementViews;
  }
}

/** Installs `elementViews` before the page loads. It finds the canvas by the hook PixiJS calls
 *  for its devtools as an application starts, and on each call walks its node views, the display
 *  objects that carry a node id, counting every child of theirs it has not seen before. Called once
 *  a frame, it sees every element view a frame draws, whether it was made or taken from a pool. */
async function countElementViews(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Shown = { children?: Shown[]; nodeId?: unknown };
    const apps: { stage: Shown }[] = [];
    const hooks = globalThis as unknown as { __PIXI_APP_INIT__: (app: { stage: Shown }) => void };
    hooks.__PIXI_APP_INIT__ = (app) => apps.push(app);
    const seen = new WeakSet<Shown>();
    const counts: ElementViews = { text: 0, sprite: 0, graphics: 0 };
    const walk = (shown: Shown) => {
      if (typeof shown.nodeId !== "string") {
        for (const child of shown.children ?? []) walk(child);
        return;
      }
      for (const child of shown.children ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        if ("context" in child) counts.graphics += 1;
        else if ("text" in child) counts.text += 1;
        else counts.sprite += 1;
      }
    };
    window.elementViews = () => {
      if (apps.length !== 1) throw new Error(`${apps.length} PixiJS applications, not one`);
      walk(apps[0]!.stage);
      return { ...counts };
    };
  });
}

test("a pan across queries at the near level over the full content creates no element view outside the pools' growth", async ({
  page,
}) => {
  // Verifies: ADR-0027, G-10
  test.setTimeout(180_000);
  await countElementViews(page);
  await open(page, "?copies=3334");
  const { near, cullingMargin } = await sceneNumbers(page);
  const { width, height } = await canvasSize(page);
  // At the least scale of the near level, which binds the most views, in the middle of the grid.
  const middle = await page.evaluate(() => {
    const { nodes } = window.inspect();
    const xs = nodes.map((node) => node.x);
    const ys = nodes.map((node) => node.y);
    const half = (of: number[]) => (Math.min(...of) + Math.max(...of)) / 2;
    return { x: half(xs), y: half(ys) };
  });
  const start = {
    x: width / 2 - middle.x * near,
    y: height / 2 - middle.y * near,
    scale: near,
  };
  // Half the margin a frame for 40 frames, as in the pan across queries above, counting a frame's
  // element views once it is drawn.
  const frames = 40;
  const step = cullingMargin / 2;
  const sweep = async () => {
    for (let i = 1; i <= frames; i++) {
      await setViewport(page, { ...start, x: start.x - i * step });
      await page.evaluate(() => window.elementViews!());
    }
    await setViewport(page, start);
  };
  await setViewport(page, start);
  // The first sweep grows the pools, of node views and of their element views alike; the second
  // binds the same nodes, each of the content of its type, from the pools grown.
  await sweep();
  const grown = await page.evaluate(() => window.elementViews!());
  const { queries } = await page.evaluate(() => window.inspect());
  const warm = await work(page);
  await sweep();
  const panned = await page.evaluate(() => window.inspect());
  expect(panned.level).toBe("near");
  expect(panned.queries).toBeGreaterThanOrEqual(queries + frames / 4);
  // The premise: the sweep drew every kind of element view.
  expect(grown.text).toBeGreaterThan(0);
  expect(grown.sprite).toBeGreaterThan(0);
  expect(grown.graphics).toBeGreaterThan(0);
  expect(done(warm, await work(page)).viewsCreated).toBe(0);
  expect(await page.evaluate(() => window.elementViews!())).toEqual(grown);
});

declare global {
  interface Window {
    /** How many times PixiJS has asked the edge mesh and the particles whether they hold a point
     *  since the counting began; `countWorldHitTests` installs it, and its first call begins. */
    worldHitTests?: () => { mesh: number; particles: number };
  }
}

/** Installs `worldHitTests` before the page loads. It finds the canvas by the hook PixiJS calls
 *  for its devtools as an application starts, and on its first call wraps `containsPoint` of the
 *  edge mesh, the display object of the world with a geometry and a shader, and of the particles,
 *  the one with particle children, each counting its calls. */
async function countWorldHitTests(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Shown = { children?: Shown[]; containsPoint?: (point: unknown) => boolean };
    const apps: { stage: Shown }[] = [];
    const hooks = globalThis as unknown as { __PIXI_APP_INIT__: (app: { stage: Shown }) => void };
    hooks.__PIXI_APP_INIT__ = (app) => apps.push(app);
    let counts: { mesh: number; particles: number } | null = null;
    const find = (shown: Shown, is: (shown: Shown) => boolean): Shown | undefined =>
      is(shown) ? shown : (shown.children ?? []).map((child) => find(child, is)).find(Boolean);
    const watch = (shown: Shown | undefined, key: "mesh" | "particles") => {
      if (!shown?.containsPoint) throw new Error(`no ${key} that hit-tests a point`);
      const contains = shown.containsPoint.bind(shown);
      shown.containsPoint = (point) => {
        counts![key] += 1;
        return contains(point);
      };
    };
    window.worldHitTests = () => {
      if (apps.length !== 1) throw new Error(`${apps.length} PixiJS applications, not one`);
      if (!counts) {
        counts = { mesh: 0, particles: 0 };
        const { stage } = apps[0]!;
        watch(
          find(stage, (shown) => "geometry" in shown && "shader" in shown),
          "mesh",
        );
        watch(
          find(stage, (shown) => "particleChildren" in shown),
          "particles",
        );
      }
      return { ...counts };
    };
  });
}

test("a pointer moving across the edges and dragging a node hit-tests no layer of the world in PixiJS", async ({
  page,
}) => {
  // Verifies: ADR-0013
  // The engine answers every hit test (ADR-0013, *Hit test*); interaction listens on the stage
  // alone, so a hit test PixiJS runs on a layer of the world is one whose answer nothing reads.
  await countWorldHitTests(page);
  await open(page, "?copies=100");
  const { width, height } = await canvasSize(page);
  const { left, top } = await canvasOrigin(page);
  // At the far level, inside the grid of 100 copies, where the edges cover the canvas and the
  // nodes are particles.
  await setViewport(page, await centred(page, 0.2));
  const drawn = await page.evaluate(() => window.inspect());
  expect(drawn.renderer).toBe("webgl");
  expect(drawn.level).toBe("far");
  expect(drawn.edgeTriangles).toBeGreaterThan(0);
  expect(drawn.particles).toBeGreaterThan(0);
  // The node nearest the centre of the view.
  const distance = (at: { x: number; y: number }) => Math.hypot(at.x - 7000, at.y - 3000);
  const node = drawn.nodes.reduce((near, candidate) =>
    distance(candidate) < distance(near) ? candidate : near,
  );
  const from = await screenCentre(page, node.id);
  expect(await page.evaluate(() => window.worldHitTests!())).toEqual({ mesh: 0, particles: 0 });
  // Across the canvas, from corner to corner.
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    await page.mouse.move(left + (width * i) / steps, top + (height * i) / steps);
  }
  // And a drag of a node, past the slop.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(from.x, from.y + 2 * i);
  await page.mouse.up();
  await page.evaluate(() => window.comb.whenRendered());
  // The premise: the drag moved the node, so the moves reached interaction.
  const moved = await page.evaluate(
    (id) => window.inspect().nodes.find((candidate) => candidate.id === id)!.y,
    node.id,
  );
  expect(moved).toBeGreaterThan(node.y);
  expect(await page.evaluate(() => window.worldHitTests!())).toEqual({ mesh: 0, particles: 0 });
});
