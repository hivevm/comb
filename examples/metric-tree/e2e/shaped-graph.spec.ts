// The shaped graph the benchmark measures beside the metric tree (ADR-0033): `?graph=shaped`
// loads the metric tree's copies, the same nodes and edges in the same columns and order, whose
// nodes take the node shapes in turn, centred on their rows, which are spaced for the tallest
// node, so that no two overlap; whose edges dock on the outline; and of whose nodes one in a
// hundred has a loop. Without the query the example loads the metric tree as before. Both on the
// production build the benchmark serves.
import { expect, test, type Page } from "@playwright/test";
import type { GraphData, NodeData } from "comb";
import { open } from "./shared";

/** The node shapes in the order the nodes take them, written here rather than read from the
 *  example: the content node shapes first, then the filled ones (ADR-0032). */
const SHAPES = [
  "rectangle",
  "rounded-rectangle",
  "ellipse",
  "diamond",
  "circle",
  "ringed-circle",
  "bar",
] as const;
const FILLED: readonly string[] = ["circle", "ringed-circle", "bar"];
/** The width of a circle and a ringed circle, the least height of a node (ADR-0033). */
const CIRCLE = 64;
/** The distance between the metric tree's rows, written here rather than read from the example. */
const ROW = 110;

/** The example's graph after its load of `query`, with what it reported of the load and the
 *  height Comb gives each node, by `heightOf`, asked once per content, width, and node shape. */
async function loadedGraph(page: Page, query: string) {
  await open(page, query);
  return page.evaluate(async () => {
    const graph = window.exampleGraph();
    const asked = new Map<string, number>();
    const heights = graph.nodes.map(({ content, width, shape }) => {
      const key = JSON.stringify([content, width, shape]);
      if (!asked.has(key)) asked.set(key, window.comb.heightOf(content, width, shape));
      return asked.get(key)!;
    });
    return { report: await window.loadReport, graph, heights };
  });
}

/** The edges' identifiers and ends of `graph`, each as a string to compare. */
const endsOf = (graph: Pick<GraphData, "edges">) =>
  graph.edges.map(({ id, source, target }) => JSON.stringify({ id, source, target }));

/** The pairs of `nodes`, each as high as `heights` says, whose rectangles overlap, by a sweep from
 *  top to bottom; rectangles that only touch do not. */
function overlapping(nodes: readonly NodeData[], heights: readonly number[]) {
  const order = nodes.map((_, i) => i).sort((one, other) => nodes[one]!.y - nodes[other]!.y);
  const pairs: [string, string][] = [];
  order.forEach((i, at) => {
    const one = nodes[i]!;
    for (let next = at + 1; next < order.length; next++) {
      const other = nodes[order[next]!]!;
      if (other.y >= one.y + heights[i]!) break;
      if (other.x < one.x + one.width && one.x < other.x + other.width) {
        pairs.push([one.id, other.id]);
      }
    }
  });
  return pairs;
}

/** How many of `items` are `wrong`, and the first three of them, so that a failure reports few
 *  rather than a diff of 50,000 lines, which would take minutes. */
function misfits<T>(items: readonly T[], wrong: (item: T, i: number) => boolean) {
  const found = items.filter(wrong);
  return { count: found.length, first: found.slice(0, 3) };
}
const NONE = { count: 0, first: [] };

type Loaded = Awaited<ReturnType<typeof loadedGraph>>;

/** Expects of the nodes of `shaped` that they are those of `tree` in the same order, each centred
 *  on its column and on its row, and that no two overlap. */
function expectLaidOut(tree: Loaded, shaped: Loaded) {
  const { nodes } = shaped.graph;
  expect(nodes).toHaveLength(tree.graph.nodes.length);
  expect(misfits(nodes, (node, i) => node.id !== tree.graph.nodes[i]!.id)).toEqual(NONE);
  // A circle and a ringed circle 64 wide, every other node as wide as in the metric tree, each
  // centred on its column.
  const centreX = ({ x, width }: NodeData) => x + width / 2;
  const unplaced = misfits(nodes, (node, i) => {
    const before = tree.graph.nodes[i]!;
    const circle = node.shape === "circle" || node.shape === "ringed-circle";
    return node.width !== (circle ? CIRCLE : before.width) || centreX(node) !== centreX(before);
  });
  expect({ ...unplaced, first: unplaced.first.map(({ id }) => id) }).toEqual(NONE);
  // Each node centred on the metric tree's row, the rows spaced for the tallest node of the
  // shaped graph by the gap the metric tree leaves under its own tallest node.
  const pitch = Math.max(...shaped.heights) + ROW - Math.max(...tree.heights);
  const centreY = (graph: GraphData, heights: number[], i: number) =>
    graph.nodes[i]!.y + heights[i]! / 2;
  const offRow = misfits(nodes, (_, i) => {
    const want =
      ((centreY(tree.graph, tree.heights, i) - centreY(tree.graph, tree.heights, 0)) * pitch) / ROW;
    const got = centreY(shaped.graph, shaped.heights, i) - centreY(shaped.graph, shaped.heights, 0);
    return Math.abs(got - want) > 1e-6;
  });
  expect({ ...offRow, first: offRow.first.map(({ id }) => id) }).toEqual(NONE);
  // No two nodes overlap.
  const overlaps = overlapping(nodes, shaped.heights);
  expect({ count: overlaps.length, first: overlaps.slice(0, 3) }).toEqual(NONE);
}

test(
  "?graph=shaped loads the metric tree's 50,010 nodes in the node shapes in turn, docked on the outline, a loop on one in a hundred",
  { tag: "@built" },
  async ({ page }) => {
    // Verifies: ADR-0033
    test.setTimeout(180_000);
    const tree = await loadedGraph(page, "?copies=3334");
    expect(tree.report).toMatchObject({ graph: "metric-tree", nodes: 50_010, edges: 50_010 });
    // Today's graph: no node names a node shape, no edge a dock, and no edge is a loop.
    expect(misfits(tree.graph.nodes, (node) => node.shape !== undefined)).toEqual(NONE);
    expect(
      misfits(
        tree.graph.edges,
        (edge) => !!edge.sourceSide || !!edge.targetSide || edge.source === edge.target,
      ),
    ).toEqual(NONE);

    const shaped = await loadedGraph(page, "?copies=3334&graph=shaped");
    const { nodes, edges } = shaped.graph;
    expect(shaped.report).toMatchObject({ graph: "shaped", nodes: 50_010, edges: 50_010 + 501 });
    // The metric tree's edges between the same nodes, and its nodes laid out anew.
    const loops = edges.filter((edge) => edge.source === edge.target);
    const ends = endsOf(tree.graph);
    const shapedEnds = endsOf({ edges: edges.filter((edge) => edge.source !== edge.target) });
    expect(shapedEnds).toHaveLength(ends.length);
    expect(misfits(shapedEnds, (end, i) => end !== ends[i])).toEqual(NONE);
    expectLaidOut(tree, shaped);
    // The node shapes in turn, a filled one without content, a content one with the tree's.
    const contentOf = new Map(tree.graph.nodes.map((node) => [node.id, node.content]));
    const unshaped = misfits(nodes, (node, i) => {
      const shape = SHAPES[i % SHAPES.length]!;
      const content = FILLED.includes(shape) ? [] : contentOf.get(node.id);
      return node.shape !== shape || JSON.stringify(node.content) !== JSON.stringify(content);
    });
    expect({ ...unshaped, first: unshaped.first.map(({ id, shape }) => ({ id, shape })) }).toEqual(
      NONE,
    );
    expect(nodes.filter((node) => FILLED.includes(node.shape!))).toHaveLength(21_432);
    // Every end on the outline, the loops' too.
    const undocked = misfits(
      edges,
      (e) => e.sourceSide !== "outline" || e.targetSide !== "outline",
    );
    expect({ ...undocked, first: undocked.first.map(({ id }) => id) }).toEqual(NONE);
    // A loop on every hundredth node, from the first: 501 of 50,010.
    expect(loops.map((loop) => loop.source)).toEqual(
      nodes.filter((_, i) => i % 100 === 0).map((node) => node.id),
    );

    // Comb holds what the example handed it: the nodes of the first copy drawn in their node
    // shapes at the near level, where it begins, the whole copy in view, and the loop of its
    // first node drawn.
    const drawn = await page.evaluate(async () => {
      window.comb.setViewport({ x: 40, y: 220, scale: window.sceneNumbers().near });
      await window.comb.whenRendered();
      const scene = window.inspect();
      return {
        level: scene.level,
        shapes: Object.fromEntries(scene.nodes.map(({ id, shape }) => [id, shape])),
        edges: scene.edges.map(({ id }) => id),
      };
    });
    expect(drawn.level).toBe("near");
    const first = nodes.slice(0, 15);
    expect(first.map(({ id }) => [id, drawn.shapes[id]])).toEqual(
      first.map(({ id }, i) => [id, SHAPES[i % SHAPES.length]]),
    );
    expect(drawn.edges).toContain(loops[0]!.id);
    // The example allows loops for the shaped graph, so that `addEdge` accepts one too.
    const added = await page.evaluate(() => {
      window.comb.addEdge({ id: "added-loop", source: "0:0.1", target: "0:0.1" });
      return window.exampleGraph().edges.some(({ id }) => id === "added-loop");
    });
    expect(added).toBe(true);
  },
);
