import { expect, test, type Page } from "@playwright/test";
import type { GraphData } from "comb";

/** Opens the example and waits until its first load has drawn. */
async function open(page: Page): Promise<void> {
  await page.goto("/");
  // The example sets loadReport after a top-level await, which the load event does not wait for.
  await page.waitForFunction(() => "loadReport" in window);
  await page.evaluate(() => window.loadReport);
}

/** The identifiers and places of the nodes the canvas draws, and of its edges. */
async function drawn(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    const { nodes, edges } = window.inspect();
    return {
      nodes: nodes.map(({ id, x, y, title }) => ({ id, x, y, title })),
      edges: edges.map(({ id }) => id),
    };
  });
}

const node = (id: string, x = 0, y = 0) => ({ id, title: id, x, y, width: 220, height: 64 });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

/** Each kind of malformed graph data Q-7 names, with the problem `load` reports for it. */
const MALFORMED: { name: string; graph: GraphData; problem: unknown }[] = [
  {
    name: "a non-finite coordinate",
    graph: { nodes: [node("a"), node("b", Number.POSITIVE_INFINITY)], edges: [] },
    problem: { kind: "nonFiniteCoordinate", node: "b" },
  },
  {
    name: "a coordinate beyond the range of a 32-bit float",
    graph: { nodes: [node("a"), node("b", 300, 1e300)], edges: [] },
    problem: { kind: "nonFiniteCoordinate", node: "b" },
  },
  {
    name: "an edge to a missing node",
    graph: { nodes: [node("a"), node("b", 300)], edges: [edge("e", "a", "z")] },
    problem: { kind: "missingNode", edge: "e", node: "z" },
  },
  {
    name: "two nodes of one identifier",
    graph: { nodes: [node("a"), node("a", 300)], edges: [] },
    problem: { kind: "duplicateNode", node: "a" },
  },
  {
    name: "two edges of one identifier",
    graph: {
      nodes: [node("a"), node("b", 300)],
      edges: [edge("e", "a", "b"), edge("e", "b", "a")],
    },
    problem: { kind: "duplicateEdge", edge: "e" },
  },
];

for (const { name, graph, problem } of MALFORMED) {
  test(`load refuses ${name} with a GraphDataError, and the previous graph stays drawn`, async ({
    page,
  }) => {
    // Verifies: Q-7
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const before = await drawn(page);
    expect(before.nodes.length).toBeGreaterThan(0);
    const refused = await page.evaluate((graph) => {
      try {
        window.comb.load(graph);
        return null;
      } catch (error) {
        const { name, problem } = error as Error & { problem: unknown };
        return { name, problem };
      }
    }, graph);
    expect(refused).toEqual({ name: "GraphDataError", problem });
    expect(await drawn(page)).toEqual(before);
    expect(errors).toEqual([]);
  });
}

test("updateNode with an identifier the graph does not hold throws a GraphDataError naming it, and changes nothing", async ({
  page,
}) => {
  // Verifies: Q-7
  await open(page);
  const before = await drawn(page);
  const result = await page.evaluate(async () => {
    await window.comb.whenRendered();
    // Two frames with nothing to draw, so that a render the call would schedule is counted.
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await frame();
    const renders = window.renderCount();
    let refused = null;
    try {
      window.comb.updateNode("no-such-node", { title: "Renamed" });
    } catch (error) {
      const { name, problem } = error as Error & { problem: unknown };
      refused = { name, problem };
    }
    await frame();
    await frame();
    return { refused, rendered: window.renderCount() - renders };
  });
  expect(result).toEqual({
    refused: { name: "GraphDataError", problem: { kind: "unknownNode", node: "no-such-node" } },
    rendered: 0,
  });
  expect(await drawn(page)).toEqual(before);
});
