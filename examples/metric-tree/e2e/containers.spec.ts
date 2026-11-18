// Containers (G-14): a node marked `isContainer` holds nodes by their `container` field, at
// positions relative to it. Comb draws containers in the `containers` layer below the edges, culls
// each node by its own box, and hits a node that is no container first, then an edge, then a
// container; a load whose container names a node that is no container, the node itself, or a node
// it holds is refused, and the graph stays as it was (ARCH-engine-edits-nested-graph,
// REN-virtualized-nested-scene, API-bridge-columns-carry-nesting).
import { expect, test, type Page } from "@playwright/test";
import type { GraphData, NodeData } from "comb";
import {
  clickWorld,
  drawnGraph,
  loaded,
  node,
  NODE_HEIGHT,
  NODE_WIDTH,
  open,
  sceneNumbers,
  selections,
} from "./shared";

/** A container of `id` at `x, y`, 700 × 300, of one title. */
const container = (id: string, x: number, y: number, fields: Partial<NodeData> = {}): NodeData => ({
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
