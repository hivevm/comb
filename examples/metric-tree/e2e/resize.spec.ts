// Heights and resizing (G-15): a node takes the height its data gives, never less than its content
// needs, and a node without content that height however small; a selected node whose `resizable`
// is `true` shows eight resize handles in the overlay, and a drag of one resizes it, never smaller
// than its content or the boxes of the nodes it holds, the content kept where it lies in the world
// and told once in `nodeResized` (REN-node-shapes-cover-uml, REN-node-content-and-hits,
// API-edits-report-nested-changes, REN-moving-layer-moves-content).
import { expect, test, type Page } from "@playwright/test";
import type { GraphData, NodeData } from "comb";
import {
  canvasSize,
  clickWorld,
  dragWorld,
  loaded,
  node,
  NODE_HEIGHT,
  NODE_WIDTH,
  open,
  pagePoint,
  sceneNumbers,
  setViewport,
  told,
  titled,
} from "./shared";

/** Container `c` at (100, 100), 700 × 300, resizable, holding `a` at (10, 40) within it. */
const HELD: GraphData = {
  nodes: [
    { ...node("c", 100, 100), width: 700, height: 300, isContainer: true, resizable: true },
    { ...node("a", 10, 40), container: "c" },
  ],
  edges: [],
};

/** What inspection reports of the node `id` drawn: its place and size. */
async function boxOf(page: Page, id: string) {
  return page.evaluate(async (wanted) => {
    await window.comb.whenRendered();
    const found = window.inspect().nodes.find((drawn) => drawn.id === wanted);
    return found && { x: found.x, y: found.y, width: found.width, height: found.height };
  }, id);
}

/** The resize handles the overlay draws, by node and handle. */
async function handles(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().handles.map(({ node: id, handle }) => `${id}:${handle}`);
  });
}

/** What a press at the world point `(x, y)` hits. */
async function hitAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x: worldX, y: worldY }) => {
      const at = window.screenPoint(worldX, worldY);
      return window.hitKind(at.x, at.y);
    },
    { x, y },
  );
}

/** The changes of kind `nodeResized` told since the graph was loaded. */
async function resized(page: Page) {
  return (await told<{ kind: string }>(page)).filter(({ kind }) => kind === "nodeResized");
}

test("a node is as high as its content with a height below it, as high as given above it, and heightOf answers its content", async ({
  page,
}) => {
  // Verifies: REN-node-shapes-cover-uml, REN-node-content-and-hits
  // Verifies: G-15
  await open(page);
  const graph: GraphData = {
    nodes: [
      { ...node("low", 0, 0), height: 20 },
      { ...node("high", 400, 0), height: 300 },
      { id: "pin", x: 0, y: 400, width: 120, height: 10, content: [] },
      { id: "wide", x: 400, y: 400, width: 120, content: [] },
    ],
    edges: [],
  };
  await loaded(page, graph);
  expect((await boxOf(page, "low"))?.height).toBe(NODE_HEIGHT);
  expect((await boxOf(page, "high"))?.height).toBe(300);
  // Without content, as its data gives however small, or as wide.
  expect((await boxOf(page, "pin"))?.height).toBe(10);
  expect((await boxOf(page, "wide"))?.height).toBe(120);
  const asked = await page.evaluate(({ content, width }) => window.comb.heightOf(content, width), {
    content: titled("high"),
    width: NODE_WIDTH,
  });
  expect(asked).toBe(NODE_HEIGHT);
  // Of no content, the height Comb draws such a node at without a height of its own: as wide.
  expect(await page.evaluate(() => window.comb.heightOf([], 120))).toBe(120);
});

test("a container dragged at its left handle grows to the left, keeps what it holds in the world, and tells one nodeResized", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, REN-node-content-and-hits, G-15
  await open(page);
  await loaded(page, HELD);
  // Selected by a press beside the node it holds; its handles drawn.
  await clickWorld(page, 600, 300);
  expect(await handles(page)).toEqual([
    "c:topLeft",
    "c:top",
    "c:topRight",
    "c:right",
    "c:bottomRight",
    "c:bottom",
    "c:bottomLeft",
    "c:left",
  ]);
  expect(await hitAt(page, 100, 250)).toBe("handle");
  await dragWorld(page, [100, 250], [40, 250]);
  expect(await boxOf(page, "c")).toEqual({ x: 40, y: 100, width: 760, height: 300 });
  expect(await boxOf(page, "a")).toEqual({
    x: 110,
    y: 140,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  });
  expect(await resized(page)).toEqual([
    {
      kind: "nodeResized",
      by: "user",
      id: "c",
      x: 40,
      y: 100,
      width: 760,
      height: 300,
      moved: [{ id: "a", x: 70, y: 40 }],
      regions: [],
    },
  ]);
  // A move of the container takes `a` along from where it now lies within it.
  await dragWorld(page, [600, 300], [610, 300]);
  expect((await boxOf(page, "a"))?.x).toBe(120);
});

test("a container's right handle dragged inwards past the node it holds stops at that node's box", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, G-15
  await open(page);
  await loaded(page, HELD);
  await clickWorld(page, 600, 300);
  await dragWorld(page, [800, 250], [150, 250]);
  // `a` reaches from 110 to 110 + its width in the world.
  expect(await boxOf(page, "c")).toEqual({
    x: 100,
    y: 100,
    width: 10 + NODE_WIDTH,
    height: 300,
  });
  expect(await resized(page)).toEqual([
    {
      kind: "nodeResized",
      by: "user",
      id: "c",
      x: 100,
      y: 100,
      width: 10 + NODE_WIDTH,
      height: 300,
      moved: [],
      regions: [],
    },
  ]);
});

test("a resize released where pressed, or held at its least size, tells no nodeResized", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes
  await open(page);
  await loaded(page, HELD);
  await clickWorld(page, 600, 300);
  // Out and back to where it was pressed.
  const [a, b] = [await pagePoint(page, 800, 250), await pagePoint(page, 900, 250)];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.move(a.x, a.y, { steps: 4 });
  await page.mouse.up();
  // Its bottom pushed up against `a`, which it then cannot pass.
  await dragWorld(page, [450, 400], [450, 100]);
  const least = await boxOf(page, "c");
  expect(least?.height).toBe(40 + NODE_HEIGHT);
  await dragWorld(page, [450, 100 + 40 + NODE_HEIGHT], [450, 120]);
  expect((await resized(page)).map(({ kind }) => kind)).toEqual(["nodeResized"]);
});

test("a selected node that is not resizable draws no handle, and a press there hits what lies below", async ({
  page,
}) => {
  // Verifies: REN-node-content-and-hits, API-edits-report-nested-changes
  await open(page);
  const graph: GraphData = { nodes: [node("b", 100, 100)], edges: [] };
  await loaded(page, graph);
  await clickWorld(page, 150, 120);
  const highlighted = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().highlighted;
  });
  expect(highlighted).toBe("b");
  expect(await handles(page)).toEqual([]);
  // Just outside its top left corner, where a handle would stand: the canvas.
  expect(await hitAt(page, 97, 97)).toBe("none");
  // The same node made resizable shows its handles there.
  await page.evaluate(() => window.comb.updateNode("b", { resizable: true }));
  expect(await handles(page)).toHaveLength(8);
  expect(await hitAt(page, 97, 97)).toBe("handle");
});

test("updateNode with a height below the content's and resizable leaves the node as high as its content and shows its handles", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, REN-node-shapes-cover-uml, G-15
  await open(page);
  await loaded(page, { nodes: [node("b", 100, 100)], edges: [] });
  await page.evaluate(() => window.comb.updateNode("b", { height: 10, resizable: true }));
  expect((await boxOf(page, "b"))?.height).toBe(NODE_HEIGHT);
  await clickWorld(page, 150, 120);
  expect(await handles(page)).toHaveLength(8);
  const updated = (await told<{ kind: string }>(page)).filter(({ kind }) => kind === "nodeUpdated");
  expect(updated).toEqual([
    {
      kind: "nodeUpdated",
      by: "host",
      id: "b",
      patch: { height: NODE_HEIGHT, resizable: true },
    },
  ]);
  // A greater height is kept, and nodeAdded tells a height and resizable as Comb took them.
  await page.evaluate(() => {
    window.comb.updateNode("b", { height: 200 });
    window.comb.addNode({ ...window.node("n", 400, 100), height: 5, resizable: true });
  });
  expect((await boxOf(page, "b"))?.height).toBe(200);
  const added = (await told<{ kind: string; node?: NodeData }>(page)).find(
    ({ kind }) => kind === "nodeAdded",
  );
  expect(added?.node).toMatchObject({ id: "n", height: NODE_HEIGHT, resizable: true });
});

/** What a resize of the right side of a resizable container with three nodes, added by `addNode`
 *  beside the example's graph of `copies` copies, does at the middle level, frame by frame: the
 *  container's width drawn and the bytes uploaded in each frame, the queries before the frames,
 *  during them, and after the release. */
async function resizeFrames(page: Page, copies: number) {
  await open(page, `?copies=${copies}`);
  await page.evaluate(() => {
    const comb = window.comb;
    comb.addNode({
      ...window.node("box", -2000, -2000),
      width: 700,
      height: 300,
      isContainer: true,
      resizable: true,
    });
    for (const [i, x] of [20, 240, 460].entries())
      comb.addNode({ ...window.node(`in${i}`, x, 40), container: "box" });
  });
  const { near, far } = await sceneNumbers(page);
  const scale = (near + far) / 2;
  const { width, height } = await canvasSize(page);
  await setViewport(page, { x: width / 2 + 1650 * scale, y: height / 2 + 1850 * scale, scale });
  expect(await page.evaluate(() => window.inspect().level)).toBe("middle");
  await clickWorld(page, -1650, -1750);
  const right = await pagePoint(page, -1300, -1850);
  await page.mouse.move(right.x, right.y);
  await page.mouse.down();
  // The first move signals the drag and hides what it moves in the query, once a resize.
  await page.mouse.move(right.x + 1, right.y);
  await page.evaluate(() => window.comb.whenRendered());
  const before = await page.evaluate(() => window.inspect().queries);
  const frames: { width: number; bytes: number }[] = [];
  for (let i = 1; i <= 30; i++) {
    const uploaded = await page.evaluate(() => window.work().bytesUploaded);
    await page.mouse.move(right.x + 1 + 2 * i, right.y);
    frames.push(
      await page.evaluate(async (from) => {
        await window.comb.whenRendered();
        const box = window.inspect().nodes.find((drawn) => drawn.id === "box")!;
        return { width: box.width, bytes: window.work().bytesUploaded - from };
      }, uploaded),
    );
  }
  const during = await page.evaluate(() => window.inspect().queries);
  await page.mouse.up();
  await page.evaluate(() => window.comb.whenRendered());
  const after = await page.evaluate(() => window.inspect().queries);
  return { frames, before, during, after };
}

test("a resize at the middle level of 50,010 nodes queries in no frame before its release, and uploads per frame what it does at 15", async ({
  page,
}) => {
  // Verifies: REN-moving-layer-moves-content
  test.setTimeout(180_000);
  const small = await resizeFrames(page, 1);
  const large = await resizeFrames(page, 3334);
  for (const run of [small, large]) {
    // The box grew in every frame, drawn through the moving layer, and nothing was queried.
    run.frames.forEach(({ width }, i) => {
      const last = i === 0 ? 700 : run.frames[i - 1]!.width;
      expect(width).toBeGreaterThan(last);
    });
    expect(run.during).toBe(run.before);
    expect(run.after).toBe(run.before + 1);
  }
  // What a frame uploads does not grow with the graph: no frame at 50,010 nodes uploads more than
  // the most a frame uploads at 15.
  const most = Math.max(...small.frames.map(({ bytes }) => bytes));
  expect(Math.max(...large.frames.map(({ bytes }) => bytes))).toBeLessThanOrEqual(most);
});

test("a handle is a square of 8 screen pixels at every scale, none at the far level, and its cursor shows its direction", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, REN-node-content-and-hits
  await open(page);
  await loaded(page, HELD);
  await clickWorld(page, 600, 300);
  const { near, far } = await sceneNumbers(page);
  const squares = () =>
    page.evaluate(async () => {
      await window.comb.whenRendered();
      return window.inspect().handleSquares.map(({ width, height }) => [width, height]);
    });
  for (const scale of [1, (near + far) / 2]) {
    await setViewport(page, { x: 100, y: 100, scale });
    expect(await squares()).toEqual(Array(8).fill([8, 8]));
  }
  await setViewport(page, { x: 100, y: 100, scale: far / 2 });
  expect(await handles(page)).toEqual([]);
  expect(await hitAt(page, 100, 250)).not.toBe("handle");
  // Over each handle the cursor shows the direction it resizes in.
  await setViewport(page, { x: 100, y: 100, scale: 1 });
  const cursors: string[] = [];
  for (const [x, y] of [
    [100, 250],
    [450, 100],
    [800, 100],
    [800, 400],
  ] as const) {
    const at = await pagePoint(page, x, y);
    await page.mouse.move(at.x, at.y);
    cursors.push(
      await page.evaluate(
        () => (document.querySelector("#canvas canvas") as HTMLCanvasElement).style.cursor,
      ),
    );
  }
  expect(cursors).toEqual(["ew-resize", "ns-resize", "nesw-resize", "nwse-resize"]);
});
