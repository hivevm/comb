// Containers (G-14): a node marked `isContainer` holds nodes by their `container` field, at
// positions relative to it. Comb draws containers in the `containers` layer below the edges, culls
// each node by its own box, and hits a node that is no container first, then an edge, then a
// container; a load whose container names a node that is no container, the node itself, or a node
// it holds is refused, and the graph stays as it was (ARCH-engine-edits-nested-graph,
// REN-virtualized-nested-scene, API-bridge-columns-carry-nesting).
import { expect, test, type Page } from "@playwright/test";
import type { GraphData, PlacedNodeData } from "comb";
import {
  canvasSize,
  clickWorld,
  dragWorld,
  drawnGraph,
  loaded,
  node,
  NODE_HEIGHT,
  NODE_WIDTH,
  open,
  pagePoint,
  sceneNumbers,
  setViewport,
  selections,
  told,
} from "./shared";

/** A container of `id` at `x, y`, 700 × 300, of one title. */
const container = (
  id: string,
  x: number,
  y: number,
  fields: Partial<PlacedNodeData> = {},
): PlacedNodeData => ({
  ...node(id, x, y),
  width: 700,
  isContainer: true,
  ...fields,
});

/** Container `c` at (100, 100) holding `a` at (10, 40) and `b` at (400, 40) within it, an edge
 *  `e` from `a` to `b`, listed before them. */
const HELD: GraphData = {
  nodes: [
    container("c", 100, 100),
    { ...node("a", 10, 40), container: "c" },
    { ...node("b", 400, 40), container: "c" },
  ],
  edges: [{ id: "e", source: "a", target: "b" }],
};

/** What inspection reports of the nodes drawn and the layers, after the frames scheduled so far. */
async function drawn(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    const { level, layers, nodes, edges } = window.inspect();
    return {
      level,
      layers,
      nodes: nodes.map(({ id, layer, x, y }) => ({ id, layer, x, y })),
      edges: edges.map(({ id }) => id),
    };
  });
}

/** The scale of each level of detail: near at 1, middle and far just below their thresholds. */
async function levels(page: Page) {
  const { near, far } = await sceneNumbers(page);
  return [
    ["near", 1],
    ["middle", (near + far) / 2],
    ["far", far / 2],
  ] as const;
}

test("a loaded container is drawn in the containers layer below the edge, and the nodes it holds at the sums of their positions and its", async ({
  page,
}) => {
  // Verifies: ARCH-engine-edits-nested-graph, REN-virtualized-nested-scene,
  // Verifies: API-bridge-columns-carry-nesting, G-14
  await open(page);
  for (const [level, scale] of await levels(page)) {
    await loaded(page, HELD, { x: 100, y: 100, scale });
    const scene = await drawn(page);
    expect(scene.level).toBe(level);
    // The containers below the edges, the edges below the nodes.
    const at = (name: string) => scene.layers.indexOf(name);
    expect(at("containers")).toBe(0);
    expect(at("containers") < at("edges") && at("edges") < at("nodes")).toBe(true);
    expect(scene.edges).toEqual(["e"]);
    expect(scene.nodes).toEqual([
      { id: "c", layer: "containers", x: 100, y: 100 },
      { id: "a", layer: "nodes", x: 110, y: 140 },
      { id: "b", layer: "nodes", x: 500, y: 140 },
    ]);
  }
});

/** Nodes `a` and `b` on the canvas with an edge `e` between them, and container `c`, listed last,
 *  over both and holding neither, as high as they are. */
const OVER: GraphData = {
  nodes: [node("a", 110, 100), node("b", 500, 100), container("c", 100, 100)],
  edges: [{ id: "e", source: "a", target: "b" }],
};

test("a press where a container added after the nodes overlaps them hits the node, the edge over it, and else the container", async ({
  page,
}) => {
  // Verifies: ARCH-engine-edits-nested-graph, REN-virtualized-nested-scene,
  // Verifies: REN-node-content-and-hits, G-14
  await open(page);
  await loaded(page, OVER);
  const middle = 100 + NODE_HEIGHT / 2;
  const between = (110 + NODE_WIDTH + 500) / 2;
  await clickWorld(page, 150, middle);
  // On the edge from a's right side to b's left side, over the container.
  await clickWorld(page, between, middle);
  // In the container, beside both nodes and the edge.
  await clickWorld(page, between, 105);
  expect(await selections(page)).toEqual([
    { kind: "node", id: "a" },
    { kind: "edge", id: "e" },
    { kind: "node", id: "c" },
  ]);
  // Bound in `containers`, below the edge and the nodes, at each level of detail.
  for (const [level, scale] of await levels(page)) {
    await loaded(page, OVER, { x: 100, y: 100, scale });
    const scene = await drawn(page);
    expect(scene.level).toBe(level);
    expect(scene.nodes.map(({ id, layer }) => [id, layer])).toEqual([
      ["c", "containers"],
      ["a", "nodes"],
      ["b", "nodes"],
    ]);
  }
});

/** Each container a load refuses, of node `a`, with the words the refusal says it holds. */
const REFUSED: { name: string; graph: GraphData; node: string; expected: string }[] = [
  {
    name: "a node without isContainer",
    graph: { nodes: [node("c"), { ...node("a"), container: "c" }], edges: [] },
    node: "a",
    expected: "the identifier of a node marked isContainer",
  },
  {
    name: "the node itself",
    graph: { nodes: [container("a", 0, 0, { container: "a" })], edges: [] },
    node: "a",
    expected: "a container that is neither the node nor one it holds",
  },
  {
    name: "a node it holds",
    graph: {
      nodes: [container("a", 0, 0, { container: "c" }), container("c", 0, 0, { container: "a" })],
      edges: [],
    },
    node: "a",
    expected: "a container that is neither the node nor one it holds",
  },
];

for (const { name, graph, node: refused, expected } of REFUSED) {
  test(`a load whose container names ${name} is refused, naming the node and the field`, async ({
    page,
  }) => {
    // Verifies: ARCH-engine-edits-nested-graph, API-bridge-columns-carry-nesting, Q-7
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const before = await drawnGraph(page);
    const thrown = await page.evaluate((data) => {
      try {
        window.comb.load(data);
        return null;
      } catch (error) {
        const { name: kind, problem } = error as Error & { problem: unknown };
        return { kind, problem };
      }
    }, graph);
    expect(errors).toEqual([]);
    expect(thrown).toStrictEqual({
      kind: "GraphDataError",
      problem: { kind: "invalidContainer", node: refused, field: "container", expected },
    });
    expect(await drawnGraph(page)).toEqual(before);
  });
}

test("a node reaching into the viewport is bound, and its container far outside it is not", async ({
  page,
}) => {
  // Verifies: REN-virtualized-nested-scene, ARCH-engine-edits-nested-graph, G-7
  await open(page);
  // The container at (20000, 20000); `a` in it at (-20000, -20000), in the world at the origin.
  const far: GraphData = {
    nodes: [container("c", 20_000, 20_000), { ...node("a", -20_000, -20_000), container: "c" }],
    edges: [],
  };
  for (const [level, scale] of await levels(page)) {
    await loaded(page, far, { x: 100, y: 100, scale });
    const scene = await drawn(page);
    expect(scene.level).toBe(level);
    expect(scene.nodes).toEqual([{ id: "a", layer: "nodes", x: 0, y: 0 }]);
  }
});

/** `HELD` and node `x` on the canvas below the container, with an edge from `x` to `a`. */
const HELD_AND_OUTSIDE: GraphData = {
  nodes: [...HELD.nodes, node("x", 100, 600)],
  edges: [...HELD.edges, { id: "x-a", source: "x", target: "a" }],
};

/** Whether the canvas draws each of `ids`, nodes then edges, as `isDrawn` and `inspect()` both
 *  report it, or `null` where they disagree. */
async function shown(page: Page, nodes: string[], edges: string[]) {
  return page.evaluate(
    async ({ nodes: wantedNodes, edges: wantedEdges }) => {
      await window.comb.whenRendered();
      const snapshot = window.inspect();
      const of = (what: { node: string } | { edge: string }) => {
        const listed =
          "node" in what
            ? snapshot.nodes.some(({ id }) => id === what.node)
            : snapshot.edges.some(({ id }) => id === what.edge);
        return listed === window.isDrawn(what) ? listed : null;
      };
      return [
        ...wantedNodes.map((id) => of({ node: id })),
        ...wantedEdges.map((edge) => of({ edge })),
      ];
    },
    { nodes, edges },
  );
}

test("removeNodes of a container removes what it holds and the edges at any of it, told once and drawn at no level", async ({
  page,
}) => {
  // Verifies: ARCH-engine-edits-nested-graph, API-edits-report-nested-changes,
  // Verifies: REN-moving-layer-moves-content, G-14
  await open(page);
  for (const [level, scale] of await levels(page)) {
    await loaded(page, HELD_AND_OUTSIDE, { x: 100, y: 100, scale });
    expect(await shown(page, ["c", "a", "b", "x"], ["e", "x-a"])).toEqual(Array(6).fill(true));
    // Told to a listener of this level's alone: each load of the loop records anew.
    const changes = await page.evaluate(() => {
      const got: unknown[] = [];
      const off = window.comb.onChange((change) => got.push(change));
      window.comb.removeNodes(["c"]);
      off();
      return got;
    });
    expect(changes).toEqual([
      { kind: "nodesRemoved", by: "host", nodes: ["c", "a", "b"], edges: ["e", "x-a"] },
    ]);
    const scene = await drawn(page);
    expect([scene.level, scene.nodes.map(({ id }) => id), scene.edges]).toEqual([level, ["x"], []]);
    expect(await shown(page, ["c", "a", "b", "x"], ["e", "x-a"])).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
    ]);
  }
});

test("Delete of a selected container asks canDelete with what it holds and their edges, and deletes only on true", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, ARCH-engine-edits-nested-graph, G-4, G-14
  await open(page);
  await loaded(page, HELD_AND_OUTSIDE);
  await page.evaluate(() => {
    const w = window as unknown as { asked: unknown[]; allow: boolean };
    [w.asked, w.allow] = [[], false];
    window.canDelete = (deletion) => (w.asked.push(deletion), w.allow);
  });
  const asked = () => page.evaluate(() => (window as unknown as { asked: unknown[] }).asked);
  // In the container, beside both nodes and the edge.
  await clickWorld(page, 300, 105);
  await page.keyboard.press("Delete");
  const whole = { nodes: ["c", "a", "b"], edges: ["e", "x-a"] };
  expect(await asked()).toEqual([whole]);
  expect(await told(page)).toEqual([]);
  expect((await drawn(page)).nodes.map(({ id }) => id)).toEqual(["c", "a", "b", "x"]);
  // A node in the container is named with what it holds, none, and its edges; the container stays.
  await clickWorld(page, 150, 160);
  await page.keyboard.press("Delete");
  expect((await asked())[1]).toEqual({ nodes: ["a"], edges: ["e", "x-a"] });
  await page.evaluate(() => ((window as unknown as { allow: boolean }).allow = true));
  await clickWorld(page, 300, 105);
  await page.keyboard.press("Delete");
  expect((await asked())[2]).toEqual(whole);
  expect(await told(page)).toEqual([{ kind: "nodesRemoved", by: "user", ...whole }]);
  const scene = await drawn(page);
  expect([scene.nodes.map(({ id }) => id), scene.edges]).toEqual([["x"], []]);
});

/** What `nodeAdded` carries of each node the test below adds: each as Comb took it, its position
 *  relative to its container, its node shape and its content's weights filled. */
const ADDED = [
  { id: "n", x: 200, y: 150, width: NODE_WIDTH, container: "c" },
  { id: "d", x: 0, y: 500, width: 400, isContainer: true },
  { id: "m", x: 30, y: 40, width: NODE_WIDTH, container: "d" },
].map(({ id, ...fields }) => ({
  id,
  ...fields,
  shape: "rectangle",
  content: [[{ kind: "text", role: "title", text: id, weight: 1 }]],
}));

test("addNode with a container draws the node in it at its relative position, and nodeAdded carries it as Comb took it", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, ARCH-engine-edits-nested-graph, G-14
  await open(page);
  for (const [level, scale] of await levels(page)) {
    await loaded(page, HELD, { x: 100, y: 100, scale });
    // Told to a listener of this level's alone: each load of the loop records anew.
    const changes = await page.evaluate(() => {
      const got: unknown[] = [];
      const off = window.comb.onChange((change) => got.push(change));
      window.comb.addNode({ ...window.node("n", 200, 150), container: "c" });
      window.comb.addNode({ ...window.node("d", 0, 500), width: 400, isContainer: true });
      window.comb.addNode({ ...window.node("m", 30, 40), container: "d" });
      off();
      return got;
    });
    const scene = await drawn(page);
    expect(scene.level).toBe(level);
    const at = (id: string) => scene.nodes.find((drawnNode) => drawnNode.id === id);
    expect(at("n")).toEqual({ id: "n", layer: "nodes", x: 300, y: 250 });
    expect(at("d")).toEqual({ id: "d", layer: "containers", x: 0, y: 500 });
    expect(at("m")).toEqual({ id: "m", layer: "nodes", x: 30, y: 540 });
    expect(changes).toEqual(ADDED.map((added) => ({ kind: "nodeAdded", by: "host", node: added })));
  }
});

/** Each container `addNode` refuses, with the words the refusal says it has to be. */
const ADD_REFUSED = [
  {
    name: "no node of the graph",
    container: "z",
    expected: "the identifier of a node of the graph",
  },
  {
    name: "a node without isContainer",
    container: "a",
    expected: "the identifier of a node marked isContainer",
  },
];

for (const { name, container: refused, expected } of ADD_REFUSED) {
  test(`addNode whose container names ${name} is refused as invalidContainer, and the graph stays`, async ({
    page,
  }) => {
    // Verifies: API-edits-report-nested-changes, ARCH-engine-edits-nested-graph, Q-7
    await open(page);
    await loaded(page, HELD);
    const before = await drawnGraph(page);
    const thrown = await page.evaluate((inside) => {
      try {
        window.comb.addNode({ ...window.node("n"), container: inside });
        return null;
      } catch (error) {
        const { name: kind, problem } = error as Error & { problem: unknown };
        return { kind, problem };
      }
    }, refused);
    expect(thrown).toStrictEqual({
      kind: "GraphDataError",
      problem: { kind: "invalidContainer", node: "n", field: "container", expected },
    });
    expect(await drawnGraph(page)).toEqual(before);
    expect(await told(page)).toEqual([]);
  });
}

test("a drag of a node in a container tells nodeMoved relative to it, and of the container relative to the canvas", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, G-14
  await open(page);
  await loaded(page, HELD);
  // Node a where it lies in the container, dragged by (30, 10) and released in it, then the
  // container beside both nodes, dragged by (30, 50).
  await dragWorld(page, [220, 150], [250, 160]);
  await dragWorld(page, [300, 105], [330, 155]);
  const moved = (await told<{ x: number; y: number }>(page)).map((change) => ({
    ...change,
    x: Math.round(change.x),
    y: Math.round(change.y),
  }));
  expect(moved).toEqual([
    { kind: "nodeMoved", by: "user", id: "a", x: 40, y: 50, container: "c" },
    { kind: "nodeMoved", by: "user", id: "c", x: 130, y: 150, container: null },
  ]);
  // The container took a with it, which kept its place within it.
  const scene = await drawn(page);
  expect(scene.nodes.find(({ id }) => id === "a")).toMatchObject({ x: 170, y: 200 });
});

/** Adds, by `addNode` and `addEdge`, container `c` at `(x, y)`, of `width` and of node shape
 *  `shape`, holding `a` and `b` at `held` and `held + (gap, 0)` within it and edge `e` from `a`
 *  to `b`. */
async function addHeld(
  page: Page,
  at: { x: number; y: number; width: number; shape: "rectangle" | "circle" },
  held: { x: number; y: number },
  gap: number,
) {
  await page.evaluate(
    ({ at: { x, y, width, shape }, held: inside, gap: apart }) => {
      const content = shape === "circle" ? [] : window.node("c").content;
      window.comb.addNode({ id: "c", x, y, width, shape, content, isContainer: true });
      window.comb.addNode({ ...window.node("a", inside.x, inside.y), container: "c" });
      window.comb.addNode({ ...window.node("b", inside.x + apart, inside.y), container: "c" });
      window.comb.addEdge({ id: "e", source: "a", target: "b" });
    },
    { at, held, gap },
  );
}

/** Once the pending render is drawn: where `c`, `a`, and `b` are drawn and in which layer, how
 *  often each is, the ends of edge `e`, and how many queries the scene has made. */
async function heldFrame(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    const { nodes, edges, queries, level } = window.inspect();
    const of = (id: string) => nodes.filter((drawnNode) => drawnNode.id === id);
    const [[c], [a], [b]] = [of("c"), of("a"), of("b")];
    const counts = ["c", "a", "b"].map((id) => of(id).length);
    const e = edges.find(({ id }) => id === "e");
    return { c: c!, a: a!, b: b!, counts, e, queries, level };
  });
}

test("a dragged container takes the nodes and the edge it holds along in each frame at each level, and queries only at the release", async ({
  page,
}) => {
  // Verifies: REN-moving-layer-moves-content, ARCH-engine-edits-nested-graph, G-2, G-14
  await open(page);
  // Far from the example's 15 nodes, so that nothing else lies under the pointer.
  await addHeld(
    page,
    { x: -5000, y: -5000, width: 700, shape: "rectangle" },
    { x: 10, y: 40 },
    390,
  );
  const { width, height } = await canvasSize(page);
  // Where the container is, which each level's drag moves on.
  let at = { x: -5000, y: -5000 };
  for (const [level, scale] of await levels(page)) {
    // The container in the middle of the canvas, pressed between its nodes above their edge.
    const centre = { x: at.x + 350, y: at.y + 32 };
    await setViewport(page, {
      x: width / 2 - centre.x * scale,
      y: height / 2 - centre.y * scale,
      scale,
    });
    const press = await pagePoint(page, at.x + 315, at.y + 16);
    await page.mouse.move(press.x, press.y);
    await page.mouse.down();
    await page.mouse.move(press.x, press.y + 6);
    const first = await heldFrame(page);
    expect(first.level).toBe(level);
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(press.x + 3 * i, press.y + 6 + 2 * i);
      const frame = await heldFrame(page);
      expect(frame.queries).toBe(first.queries);
      expect(frame.counts).toEqual([1, 1, 1]);
      // The container's particle or view stays in the containers layer, below the edges.
      expect([frame.c.layer, frame.a.layer, frame.b.layer]).toEqual([
        "containers",
        "nodes",
        "nodes",
      ]);
      expect(frame.c.x - first.c.x).toBeCloseTo((3 * i) / scale, 2);
      expect(frame.c.y - first.c.y).toBeCloseTo((2 * i) / scale, 2);
      for (const [held, dx] of [
        [frame.a, 10],
        [frame.b, 400],
      ] as const) {
        expect(held.x - frame.c.x).toBeCloseTo(dx, 2);
        expect(held.y - frame.c.y).toBeCloseTo(40, 2);
      }
      // The edge from a's right connector to b's left one.
      const e = frame.e!;
      expect(e.source.x).toBeCloseTo(frame.a.x + NODE_WIDTH, 2);
      expect(e.source.y).toBeCloseTo(frame.a.y + NODE_HEIGHT / 2, 2);
      expect(e.target.x).toBeCloseTo(frame.b.x, 2);
      expect(e.target.y).toBeCloseTo(frame.b.y + NODE_HEIGHT / 2, 2);
    }
    await page.mouse.up();
    const released = await heldFrame(page);
    expect(released.queries).toBe(first.queries + 1);
    at = { x: released.c.x, y: released.c.y };
  }
});

/** What `frame` drew out of place, by name, for container `c` of `size` holding `a` and `b` as
 *  `containerDragUploads` adds them: a held node off its place in the container, edge `e` off
 *  its nodes' connectors, a node drawn other than once, or a query since `queries`. */
function misplaced(frame: Awaited<ReturnType<typeof heldFrame>>, size: number, queries: number) {
  // Within a thousandth of the container's size: far above `f32`'s step at the container's place,
  // far below a screen pixel at the far level, where the size spans a hundred pixels or more.
  const near = (value: number, wanted: number) => Math.abs(value - wanted) < size / 1000;
  const { a, b, c, e } = frame;
  const checks = {
    a: near(a.x - c.x, size * 0.25) && near(a.y - c.y, size * 0.3),
    b: near(b.x - c.x, size * 0.55) && near(b.y - c.y, size * 0.3),
    e:
      e !== undefined &&
      near(e.source.x, a.x + NODE_WIDTH) &&
      near(e.source.y, a.y + NODE_HEIGHT / 2) &&
      near(e.target.x, b.x) &&
      near(e.target.y, b.y + NODE_HEIGHT / 2),
    once: frame.counts.every((count) => count === 1),
    kept: frame.queries === queries,
  };
  return Object.entries(checks).flatMap(([name, held]) => (held ? [] : [name]));
}

/** The bytes uploaded a frame while container `c`, holding `a` and `b` and edge `e` between them,
 *  is dragged down at the far level of the example at `copies`, at its fitted view for 50,010
 *  nodes; and the bytes the query's edge mesh holds there. The container, a circle as wide as most
 *  of the room left of the graph, is added by `addNode` there. */
async function containerDragUploads(page: Page, copies: number) {
  await open(page, `?copies=${copies}`);
  if (copies < 1000) {
    const { width, height } = await canvasSize(page);
    await setViewport(page, { x: width / 2, y: height / 2, scale: 0.2 });
  }
  const room = await page.evaluate(() => {
    const visible = window.visibleRect();
    const left = Math.min(...window.exampleGraph().nodes.map(({ x }) => x!));
    const gap = left - visible.minX;
    const size = Math.min(0.85 * gap, 0.8 * (visible.maxY - visible.minY));
    const middle = (visible.minY + visible.maxY) / 2;
    return { x: visible.minX + 0.05 * gap, y: middle - size / 2, size };
  });
  const { x, y, size } = room;
  await addHeld(
    page,
    { x, y, width: size, shape: "circle" },
    { x: size * 0.25, y: size * 0.3 },
    size * 0.3,
  );
  const press = await pagePoint(page, x + size / 2, y + size * 0.75);
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.evaluate(() => window.comb.whenRendered());
  // Past the slop: the first move hides what the container holds in the kept query.
  await page.mouse.move(press.x, press.y + 5);
  const before = await heldFrame(page);
  const { edgeMesh } = await page.evaluate(() => window.inspect());
  const warm = await page.evaluate(() => window.work());
  const frames = 20;
  const missed: string[] = [];
  let after = before;
  for (let i = 1; i <= frames; i++) {
    await page.mouse.move(press.x, press.y + 5 + i);
    // Inspection uploads nothing, so reading each frame leaves the bytes counted as they are.
    after = await heldFrame(page);
    missed.push(...misplaced(after, size, before.queries).map((name) => `${i}: ${name}`));
  }
  const done = await page.evaluate(() => window.work());
  await page.mouse.up();
  const { vertices, indices } = edgeMesh;
  return {
    level: before.level,
    missed,
    moved: after.c.y > before.c.y,
    queried: after.queries - before.queries,
    perFrame: (done.bytesUploaded - warm.bytesUploaded) / frames,
    meshBytes: vertices * 6 * 4 + indices * 4,
  };
}

test("a container drag frame at the far level uploads what the container holds, not what the graph does", async ({
  page,
}) => {
  // Verifies: REN-moving-layer-moves-content, ARCH-engine-edits-nested-graph
  test.setTimeout(180_000);
  const small = await containerDragUploads(page, 1);
  const large = await containerDragUploads(page, 3334);
  expect([small.level, large.level]).toEqual(["far", "far"]);
  // Each drag moved the container; in each frame both nodes and their edge followed it, each
  // drawn once, and no frame queried.
  expect([small.moved, large.moved]).toEqual([true, true]);
  expect([small.missed, large.missed]).toEqual([[], []]);
  expect([small.queried, large.queried]).toEqual([0, 0]);
  // At 50,010 nodes the query's mesh holds far more than a frame uploads, and a frame uploads no
  // more than at 15 nodes.
  expect(large.meshBytes).toBeGreaterThan(1_000_000);
  expect(large.perFrame).toBeLessThan(large.meshBytes / 100);
  expect(large.perFrame).toBeLessThanOrEqual(small.perFrame * 2);
});

/** Container `c` at (100, 100), 700 × 64, and node `a` at (100, 400) on the canvas, 220 × 64. */
const BESIDE: GraphData = { nodes: [container("c", 100, 100), node("a", 100, 400)], edges: [] };

/** Records each move `canMoveInto` is asked about in `asked` and answers what `answer` names:
 *  `true`, `false`, a throw, or a removal of container `c` and `true`. */
async function vetoMoves(page: Page, answer: "true" | "false" | "throw" | "remove") {
  await page.evaluate((how) => {
    const w = window as unknown as { asked: unknown[] };
    w.asked = [];
    window.canMoveInto = (move) => {
      w.asked.push(move);
      if (how === "throw") throw new Error("host veto");
      if (how === "remove") window.comb.removeNodes(["c"]);
      return how !== "false";
    };
  }, answer);
}

/** The moves `canMoveInto` was asked about since `vetoMoves`. */
const askedMoves = (page: Page) =>
  page.evaluate(() => (window as unknown as { asked: unknown[] }).asked);

/** Each change `told` holds, its position rounded to the world unit. */
async function toldRounded(page: Page) {
  return (await told<{ x?: number; y?: number }>(page)).map((change) =>
    change.x === undefined || change.y === undefined
      ? change
      : { ...change, x: Math.round(change.x), y: Math.round(change.y) },
  );
}

test("a node dropped into a container on canMoveInto true is told once with the container, drawn above it, and held by it", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, ARCH-engine-edits-nested-graph, G-14
  await open(page);
  await loaded(page, BESIDE);
  await vetoMoves(page, "true");
  // a's centre, released in the container: a lies at (290, 98), 2 above the container's top.
  await dragWorld(page, [210, 432], [400, 130]);
  expect(await askedMoves(page)).toEqual([{ node: "a", container: "c" }]);
  expect(await toldRounded(page)).toEqual([
    { kind: "nodeMoved", by: "user", id: "a", x: 190, y: -2, container: "c" },
  ]);
  let scene = await drawn(page);
  expect(scene.nodes.map(({ id, layer }) => [id, layer])).toEqual([
    ["c", "containers"],
    ["a", "nodes"],
  ]);
  expect(await page.evaluate(() => window.exampleGraph().nodes[1])).toMatchObject({
    id: "a",
    container: "c",
  });
  // The container dragged by (0, 100) beside a takes a along, which it now holds.
  await dragWorld(page, [700, 105], [700, 205]);
  scene = await drawn(page);
  expect(scene.nodes.find(({ id }) => id === "a")).toMatchObject({ x: 290, y: 198 });
});

for (const answer of ["false", "throw", "remove"] as const) {
  test(`a node dropped into a container with canMoveInto ${answer === "remove" ? "removing the container and returning true" : answer === "throw" ? "throwing" : "returning false"} stands where it stood, and no change of the user's is told`, async ({
    page,
  }) => {
    // Verifies: API-edits-report-nested-changes
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await loaded(page, BESIDE);
    await vetoMoves(page, answer);
    await dragWorld(page, [210, 432], [400, 130]);
    expect(await askedMoves(page)).toEqual([{ node: "a", container: "c" }]);
    expect(await told(page)).toEqual(
      answer === "remove" ? [{ kind: "nodesRemoved", by: "host", nodes: ["c"], edges: [] }] : [],
    );
    // Exactly where it stood, though the drag moved it there and back in f32 steps.
    expect((await drawnGraph(page)).nodes.find(({ id }) => id === "a")).toMatchObject({
      x: 100,
      y: 400,
    });
    // The gesture ended before the error was thrown: a move after it drags nothing.
    const elsewhere = await pagePoint(page, 500, 300);
    await page.mouse.move(elsewhere.x, elsewhere.y, { steps: 3 });
    expect((await drawnGraph(page)).nodes.find(({ id }) => id === "a")).toMatchObject({
      x: 100,
      y: 400,
    });
    expect(errors).toEqual(answer === "throw" ? ["host veto"] : []);
  });
}

test("a node reaching past its container, grabbed there and dropped outside every container, asks canMoveInto with null and lies on the canvas", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, G-14
  await open(page);
  await loaded(page, HELD);
  await vetoMoves(page, "true");
  // a lies at (110, 140) in c, which ends at 164: grabbed below it, at (220, 190), dropped at
  // (220, 440), outside every container.
  await dragWorld(page, [220, 190], [220, 440]);
  expect(await askedMoves(page)).toEqual([{ node: "a", container: null }]);
  expect(await toldRounded(page)).toEqual([
    { kind: "nodeMoved", by: "user", id: "a", x: 110, y: 390, container: null },
  ]);
  // On the canvas, a stays where it is when the container is dragged.
  await dragWorld(page, [300, 105], [300, 125]);
  const scene = await drawn(page);
  expect(scene.nodes.find(({ id }) => id === "a")).toMatchObject({ x: 110, y: 390 });
});

/** Container `c` at (100, 100), 700 × 64, holding container `d` at (10, 0) within it, 300 × 64. */
const NESTED: GraphData = {
  nodes: [container("c", 100, 100), { ...container("d", 10, 0), width: 300, container: "c" }],
  edges: [],
};

test("a container released with the pointer over a container it holds asks nothing, and moved within its own container", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, G-14
  await open(page);
  await loaded(page, NESTED);
  await vetoMoves(page, "true");
  // c grabbed beside d and dragged by (50, 0); the host then pans the view by 500 world units,
  // so that the release lies at (250, 130), over d, which c holds and took along.
  await dragWorld(page, [700, 130], [750, 130], () =>
    page.evaluate(() => {
      const view = window.comb.viewport();
      window.comb.setViewport({ ...view, x: view.x + 500 });
    }),
  );
  expect(await askedMoves(page)).toEqual([]);
  expect(await toldRounded(page)).toEqual([
    { kind: "nodeMoved", by: "user", id: "c", x: 150, y: 100, container: null },
  ]);
});

test("a node dropped within its own container asks nothing, and nodeMoved carries the same container", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, G-14
  await open(page);
  await loaded(page, HELD);
  await vetoMoves(page, "true");
  await dragWorld(page, [220, 150], [520, 150]);
  expect(await askedMoves(page)).toEqual([]);
  expect(await toldRounded(page)).toEqual([
    { kind: "nodeMoved", by: "user", id: "a", x: 310, y: 40, container: "c" },
  ]);
});

/** Node `a` at (100, 400) on the canvas, listed first, so of the lowest rank; container `c` at
 *  (100, 100), 700 × 64, holding `b` at (300, 0) within it. */
const BELOW: GraphData = {
  nodes: [node("a", 100, 400), container("c", 100, 100), { ...node("b", 300, 0), container: "c" }],
  edges: [],
};

test("a node moved into a container takes the next rank: it is drawn and hit above a node there it overlaps", async ({
  page,
}) => {
  // Verifies: ARCH-engine-edits-nested-graph, API-edits-report-nested-changes
  await open(page);
  await loaded(page, BELOW);
  // a's centre, released in c: a lies at (390, 98), over b at (400, 100).
  await dragWorld(page, [210, 432], [500, 130]);
  expect(await toldRounded(page)).toEqual([
    { kind: "nodeMoved", by: "user", id: "a", x: 290, y: -2, container: "c" },
  ]);
  const scene = await drawn(page);
  expect(scene.nodes.map(({ id }) => id)).toEqual(["c", "b", "a"]);
  // Beside a, b; where both lie, a.
  await clickWorld(page, 615, 150);
  await clickWorld(page, 450, 130);
  expect(await selections(page)).toEqual([
    { kind: "node", id: "a" },
    { kind: "node", id: "b" },
    { kind: "node", id: "a" },
  ]);
});

/** Container `d` at (100, 600), 700 × 64, listed first, holding `n` at (400, 0) within it, and
 *  container `c` at (100, 100), 700 × 64, on the canvas. */
const TWO_CONTAINERS: GraphData = {
  nodes: [
    container("d", 100, 600),
    { ...node("n", 400, 0), container: "d" },
    container("c", 100, 100),
  ],
  edges: [],
};

test("at the far level, a container moved into another is drawn after it, and what it holds follows it", async ({
  page,
}) => {
  // Verifies: ARCH-engine-edits-nested-graph, REN-virtualized-nested-scene, G-14
  await open(page);
  const [, , [level, scale]] = await levels(page);
  await loaded(page, TWO_CONTAINERS, { x: 100, y: 100, scale });
  let scene = await drawn(page);
  expect(scene.level).toBe(level);
  expect(scene.nodes.map(({ id, layer }) => [id, layer])).toEqual([
    ["d", "containers"],
    ["c", "containers"],
    ["n", "nodes"],
  ]);
  // d grabbed beside n and released in c.
  await dragWorld(page, [200, 630], [300, 130]);
  expect(
    (await told<{ id: string; container: string | null }>(page)).map(
      ({ id, container: inside }) => [id, inside],
    ),
  ).toEqual([["d", "c"]]);
  scene = await drawn(page);
  expect(scene.level).toBe(level);
  expect(scene.nodes.map(({ id, layer }) => [id, layer])).toEqual([
    ["c", "containers"],
    ["d", "containers"],
    ["n", "nodes"],
  ]);
  const [d, n] = ["d", "n"].map((id) => scene.nodes.find((drawnNode) => drawnNode.id === id)!);
  expect([n!.x - d!.x, n!.y - d!.y]).toEqual([400, 0]);
  expect(d!.y).toBeLessThan(300);
});

/** Containers `c` and `t`, 400 × 64, at (1,048,300, 0) and (1,048,300, 200), where `f32` steps by
 *  1/16, and `a` held by `c` at (300, 0) within it, past 2^20, where `f32` steps by 1/8. */
const FAR_RIGHT: GraphData = {
  nodes: [
    container("c", 1_048_300, 0, { width: 400 }),
    { ...node("a", 300, 0), container: "c" },
    container("t", 1_048_300, 200, { width: 400 }),
  ],
  edges: [],
};

test("a container dropped into another and refused stands where it stood, and what it holds exactly where it lay in it", async ({
  page,
}) => {
  // Verifies: API-edits-report-nested-changes, ARCH-engine-edits-nested-graph
  await open(page);
  await loaded(page, FAR_RIGHT, { x: -1_048_300 * 1.5 + 50, y: 50, scale: 1.5 });
  await vetoMoves(page, "false");
  const at = async () => (await drawnGraph(page)).nodes.map(({ id, x, y }) => ({ id, x, y }));
  const before = await at();
  // c grabbed beside a and dragged in steps no f32 adds alike at both its and a's place.
  await dragWorld(page, [1_048_400, 10], [1_048_407.7, 231.3]);
  expect(await askedMoves(page)).toEqual([{ node: "c", container: "t" }]);
  expect(await told(page)).toEqual([]);
  // Exactly where each was, so that a's position relative to c is as a nodeMoved told it before.
  expect(await at()).toEqual(before);
});
