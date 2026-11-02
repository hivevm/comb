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

test("a drag at the far level keeps its query, and uploads and reallocates none of its mesh", async ({
  page,
}) => {
  // Verifies: ADR-0027, ADR-0040
  await open(page);
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width / 2, y: height / 2, scale: 0.2 });
  expect(await page.evaluate(() => window.inspect().level)).toBe("far");
  const from = await screenCentre(page, "0:0.0");
  const frames = 60;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Pressing selects the node, and a move past the slop of 4 pixels begins its drag (ADR-0013),
  // each of which renders once more before the frames counted: the first move hides the node's
  // edges in the query's mesh and its particle, once a drag (ADR-0040).
  await page.evaluate(() => window.comb.whenRendered());
  const slop = 5;
  await page.mouse.move(from.x, from.y + slop);
  await page.evaluate(() => window.comb.whenRendered());
  const { queries, edgeMesh } = await page.evaluate(() => window.inspect());
  const warm = await work(page);
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
  await page.evaluate(() => window.comb.whenRendered());
  const released = await page.evaluate(() => window.inspect().queries);
  // No frame of the drag queried: each drew the node and its edges in the moving layer, and the
  // node is drawn once, by its particle there, beside every other node's.
  expect(dragged.queries).toBe(queries);
  expect(dragged.nodes.length).toBe(dragged.particles);
  expect(dragged.nodes.filter(({ id }) => id === "0:0.0")).toHaveLength(1);
  // The query's mesh stayed as it was, and none of it uploaded; the moving layer did.
  expect(largest).toEqual({ vertices: edgeMesh.vertices, indices: edgeMesh.indices });
  expect(did.meshBytesUploaded).toBe(0);
  expect(did.bytesUploaded).toBeGreaterThan(0);
  // The release queries once.
  expect(released).toBe(queries + 1);
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
  // Decides no ADR clause and no criterion: work a frame need not redo, pinned by a count
  // (docs/CONVENTIONS.md); the engine answers every hit test (ADR-0013), so PixiJS's test of the
  // world is one nothing reads.
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

/** The bytes uploaded a frame while the node `id`, which has one edge, is dragged down, from the
 *  view the example opens `copies` at, the whole graph fitted, and the bytes the query's edge
 *  mesh holds there. */
async function dragUploads(page: Page, copies: number, id: string) {
  await open(page, `?copies=${copies}`);
  const from = await screenCentre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.evaluate(() => window.comb.whenRendered());
  // Past the slop: the first move hides the node's edge and particle in the kept query.
  await page.mouse.move(from.x, from.y + 5);
  await page.evaluate(() => window.comb.whenRendered());
  const before = await page.evaluate(() => window.inspect());
  const warm = await work(page);
  const frames = 20;
  for (let i = 1; i <= frames; i++) {
    await page.mouse.move(from.x, from.y + 5 + i);
    await page.evaluate(() => window.comb.whenRendered());
  }
  const did = done(warm, await work(page));
  const after = await page.evaluate(() => window.inspect());
  await page.mouse.up();
  // Positions, distances, colours, and dashes of each vertex, and its indices, as 32-bit values.
  const { vertices, indices } = before.edgeMesh;
  const y = (snapshot: typeof before) => snapshot.nodes.find((node) => node.id === id)!.y;
  return {
    moved: y(after) > y(before),
    perFrame: did.bytesUploaded / frames,
    meshBytes: vertices * 6 * 4 + indices * 4,
    queried: after.queries - before.queries,
    level: before.level,
    count: before.nodes.length,
  };
}

test("a drag frame uploads what the dragged node and its edge take, not what the graph does", async ({
  page,
}) => {
  // Verifies: ADR-0040
  test.setTimeout(180_000);
  // Node 0.1 of a copy, a bet, has one edge.
  const small = await dragUploads(page, 1, "0:0.1");
  const large = await dragUploads(page, 3334, "0:0.1");
  expect([small.count, large.count, large.level]).toEqual([15, 50_010, "far"]);
  // Each drag moved its node, and no frame of it queried.
  expect([small.moved, large.moved]).toEqual([true, true]);
  expect([small.queried, large.queried]).toEqual([0, 0]);
  // At 50,010 nodes the query's mesh holds far more than a frame uploads, and a frame uploads no
  // more than at 15 nodes, where the near level strokes the edge in full.
  expect(large.meshBytes).toBeGreaterThan(1_000_000);
  expect(large.perFrame).toBeLessThan(large.meshBytes / 100);
  expect(large.perFrame).toBeLessThanOrEqual(small.perFrame * 2);
});

test("a drag zoomed from the far level to the middle draws its node once, by its view", async ({
  page,
}) => {
  // Verifies: ADR-0040
  await open(page);
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width / 2, y: height / 2, scale: 0.2 });
  const from = await screenCentre(page, "0:0.0");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.evaluate(() => window.comb.whenRendered());
  await page.mouse.move(from.x, from.y + 10);
  await page.evaluate(() => window.comb.whenRendered());
  const far = await page.evaluate(() => window.inspect());
  // Zoomed in mid-drag, about the pointer, past the far level's threshold: the render queries.
  await page.evaluate(
    async ({ x, y }) => {
      const view = window.comb.viewport();
      const scale = 0.4;
      const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
      const [px, py] = [x - rect.left, y - rect.top];
      const k = scale / view.scale;
      window.comb.setViewport({ x: px - (px - view.x) * k, y: py - (py - view.y) * k, scale });
      await window.comb.whenRendered();
    },
    { x: from.x, y: from.y + 10 },
  );
  await page.mouse.move(from.x, from.y + 14);
  await page.evaluate(() => window.comb.whenRendered());
  const middle = await page.evaluate(() => window.inspect());
  await page.mouse.up();
  expect([far.level, middle.level]).toEqual(["far", "middle"]);
  expect(far.nodes.filter(({ id }) => id === "0:0.0")).toHaveLength(1);
  // Drawn once, by its view: no particle of the far level left where the zoom found it.
  expect(middle.nodes.filter(({ id }) => id === "0:0.0")).toHaveLength(1);
  expect(middle.particles).toBe(0);
  expect(middle.nodes.every(({ texts }) => texts !== undefined)).toBe(true);
});

/** Opens the example at `copies`, at the far level: the fitted view of a large graph, a scale
 *  below far's threshold of a small one. */
async function openAtFar(page: Page, copies: number) {
  await open(page, `?copies=${copies}`);
  if (copies >= 1000) return;
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width / 2, y: height / 2, scale: 0.2 });
}

/** An edit a frame at the far level of `copies`: a node added, an edge from a drawn node to it, an
 *  edge the kept query drew removed, and the added node removed; what each frame queried and
 *  uploaded, and whether the canvas showed each edit. */
async function editFrames(page: Page, copies: number) {
  await openAtFar(page, copies);
  return page.evaluate(async () => {
    const { comb } = window;
    await comb.whenRendered();
    const level = window.inspect().level;
    const graph = window.exampleGraph();
    const kept = graph.edges.find((edge) => window.isDrawn({ edge: edge.id }))!;
    const source = kept.source;
    const before = { work: window.work(), queries: window.inspect().queries };
    const shown: boolean[] = [];
    // Shown as `isDrawn` and `inspect()` both report it.
    const inspected = (what: { node: string } | { edge: string }) => {
      const snapshot = window.inspect();
      const listed =
        "node" in what
          ? snapshot.nodes.some(({ id }) => id === what.node)
          : snapshot.edges.some(({ id }) => id === what.edge);
      return listed === window.isDrawn(what) ? listed : null;
    };
    const step = async (edit: () => void, check: () => boolean | null) => {
      edit();
      await comb.whenRendered();
      shown.push(check() === true);
    };
    const node = {
      id: "edit-node",
      x: 0,
      y: 0,
      width: 160,
      content: [[{ kind: "text" as const, role: "title" as const, text: "e" }]],
    };
    const not = (value: boolean | null) => (value === null ? null : !value);
    await step(
      () => comb.addNode(node),
      () => inspected({ node: "edit-node" }),
    );
    await step(
      () => comb.addEdge({ id: "edit-edge", source, target: "edit-node" }),
      () => inspected({ edge: "edit-edge" }),
    );
    await step(
      () => comb.removeEdges([kept.id]),
      () => not(inspected({ edge: kept.id })),
    );
    await step(
      () => comb.removeNodes(["edit-node"]),
      () => not(inspected({ node: "edit-node" })),
    );
    const after = { work: window.work(), queries: window.inspect().queries };
    return {
      level,
      shown,
      queried: after.queries - before.queries,
      perFrame: (after.work.bytesUploaded - before.work.bytesUploaded) / 4,
    };
  });
}

test("an edit a frame at the far level keeps the query and uploads what it changed, not what the graph holds", async ({
  page,
}) => {
  // Verifies: ADR-0040
  test.setTimeout(180_000);
  const small = await editFrames(page, 1);
  const large = await editFrames(page, 3334);
  expect([small.level, large.level]).toEqual(["far", "far"]);
  // Each edit shown in its frame: added drawn, removed not, the kept query's edge among them.
  expect([small.shown, large.shown]).toEqual([
    [true, true, true, true],
    [true, true, true, true],
  ]);
  expect([small.queried, large.queried]).toEqual([0, 0]);
  expect(large.perFrame).toBeLessThanOrEqual(Math.max(small.perFrame * 2, 64 * 1024));
});

test("edits past the bound, or a removal of a node a drag moves, query anew", async ({ page }) => {
  // Verifies: ADR-0040
  await open(page);
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width / 2, y: height / 2, scale: 0.2 });
  expect(await page.evaluate(() => window.inspect().level)).toBe("far");
  const queried = await page.evaluate(async () => {
    const { comb } = window;
    await comb.whenRendered();
    const before = window.inspect().queries;
    const nodes = Array.from({ length: 257 }, (_, i) => ({
      id: `bound-${i}`,
      x: i * 10,
      y: 2000,
      width: 8,
      content: [[{ kind: "text" as const, role: "title" as const, text: "b" }]],
    }));
    for (const node of nodes) comb.addNode(node);
    await comb.whenRendered();
    return window.inspect().queries - before;
  });
  expect(queried).toBe(1);
  // A drag, then the host removes the dragged node mid-drag.
  const from = await screenCentre(page, "0:0.0");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.evaluate(() => window.comb.whenRendered());
  await page.mouse.move(from.x, from.y + 10);
  await page.evaluate(() => window.comb.whenRendered());
  const removal = await page.evaluate(async () => {
    const before = window.inspect().queries;
    window.comb.removeNodes(["0:0.0"]);
    await window.comb.whenRendered();
    const after = window.inspect();
    return { queried: after.queries - before, drawn: after.nodes.some(({ id }) => id === "0:0.0") };
  });
  await page.mouse.up();
  expect(removal).toEqual({ queried: 1, drawn: false });
});
