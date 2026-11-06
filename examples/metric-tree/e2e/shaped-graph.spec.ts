// The shaped graph the benchmark measures beside the metric tree (ADR-0033): `?graph=shaped`
// loads the metric tree's copies, the same nodes and edges in the same places, whose nodes take
// the node shapes in turn, whose edges dock on the outline, and of whose nodes one in a hundred
// has a loop. Without the query the example loads the metric tree as before. Both on the
// production build the benchmark serves.
import { expect, test, type Page } from "@playwright/test";
import type { GraphData } from "comb";
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

/** The example's graph after its load of `query`, with what it reported of the load. */
async function loadedGraph(page: Page, query: string) {
  await open(page, query);
  return page.evaluate(async () => ({
    report: await window.loadReport,
    graph: window.exampleGraph(),
  }));
}

/** The nodes' identifiers and places, and the edges' identifiers and ends, of `graph`, each as a
 *  string to compare. */
const placesOf = (graph: GraphData) => [
  ...graph.nodes.map(({ id, x, y, width }) => JSON.stringify({ id, x, y, width })),
  ...graph.edges.map(({ id, source, target }) => JSON.stringify({ id, source, target })),
];

/** How many of `items` are `wrong`, and the first three of them, so that a failure reports few
 *  rather than a diff of 50,000 lines, which would take minutes. */
function misfits<T>(items: readonly T[], wrong: (item: T, i: number) => boolean) {
  const found = items.filter(wrong);
  return { count: found.length, first: found.slice(0, 3) };
}
const NONE = { count: 0, first: [] };

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
    // The same nodes in the same places, and the metric tree's edges between the same nodes.
    const loops = edges.filter((edge) => edge.source === edge.target);
    const between = edges.filter((edge) => edge.source !== edge.target);
    const places = placesOf(tree.graph);
    const shapedPlaces = placesOf({ nodes, edges: between });
    expect(shapedPlaces).toHaveLength(places.length);
    expect(misfits(shapedPlaces, (place, i) => place !== places[i])).toEqual(NONE);
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
