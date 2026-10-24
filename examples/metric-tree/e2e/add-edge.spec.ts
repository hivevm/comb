// The host application adds edges through `addEdge` and changes them through `updateEdge` (G-5,
// G-11, ADR-0023): the next frame draws them with their colour, dash pattern, and label,
// `onChange` tells each change once, and an edge or a patch a load would refuse, an edge the graph
// cannot hold, and a patch of an unknown edge or field change nothing (ADR-0026, Q-7).
import { expect, test, type Page } from "@playwright/test";
import type { EdgeData, GraphData } from "comb";
import { NODE_HEIGHT, NODE_WIDTH, open, setViewport, strokeOf } from "./shared";

const node = (id: string, x = 0, y = 0) => ({
  id,
  title: id,
  x,
  y,
  width: NODE_WIDTH,
  height: NODE_HEIGHT,
});

/** Nodes `a` and `b` side by side, an edge between them running straight along y = 32. */
const PAIR: GraphData = { nodes: [node("a"), node("b", 600)], edges: [] };

/** Loads `graph` at a scale of 1 with the world's origin at (100, 100), records every change
 *  `onChange` tells into `window.told`, and waits until it is drawn. */
async function loaded(page: Page, graph: GraphData = PAIR): Promise<void> {
  await page.evaluate(async (graph) => {
    window.comb.load(graph);
    const w = window as unknown as { told: unknown[] };
    w.told = [];
    window.comb.onChange((change) => w.told.push(change));
    await window.comb.whenRendered();
  }, graph);
  await setViewport(page, { x: 100, y: 100, scale: 1 });
}

async function told(page: Page): Promise<unknown[]> {
  return page.evaluate(() => (window as unknown as { told: unknown[] }).told);
}

const RED = 0xe0453a;
const BLUE = 0x2060e0;

test("addEdge draws the edge with its colour, dash, and label, and tells edgeAdded with defaults", async ({
  page,
}) => {
  // Verifies: G-11, ADR-0023
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await loaded(page);
  const edge: EdgeData = {
    id: "a-b",
    source: "a",
    target: "b",
    color: RED,
    dash: [8, 8],
    label: { text: "+0.8", t: 0.5, offset: 0 },
  };
  await page.evaluate((edge) => window.comb.addEdge(edge), edge);
  expect(await told(page)).toEqual([
    { kind: "edgeAdded", by: "host", edge: { ...edge, arrow: "end" } },
  ]);
  const drawn = await page.evaluate(async () => {
    await window.comb.whenRendered();
    const { edges, edgeLabels } = window.inspect();
    return { edges, labels: edgeLabels.map(({ edge, text }) => ({ edge, text })) };
  });
  expect(drawn).toEqual({
    edges: [{ id: "a-b", source: { x: 220, y: 32 }, target: { x: 600, y: 32 } }],
    labels: [{ edge: "a-b", text: "+0.8" }],
  });
  // Dashed: a run of red for every dash, about half the pixels.
  const stroke = await strokeOf(page, RED);
  expect(stroke.runs).toBeGreaterThan(10);
  expect(stroke.drawn).toBeLessThan(250);
  expect(errors).toEqual([]);
});

test("updateEdge recolours an edge, clears its dash, moves its label, and tells edgeUpdated once", async ({
  page,
}) => {
  // Verifies: G-5, G-11, ADR-0023
  await open(page);
  await loaded(page);
  const edge = { id: "a-b", source: "a", target: "b", color: RED, dash: [8, 8] as const };
  await page.evaluate((edge) => window.comb.addEdge(edge), edge);
  const patch = { color: BLUE, dash: null, label: { text: "moved", t: 0.25, offset: 0 } };
  await page.evaluate((patch) => window.comb.updateEdge("a-b", patch), patch);
  expect((await told(page)).slice(1)).toEqual([
    { kind: "edgeUpdated", by: "host", id: "a-b", patch },
  ]);
  const labels = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().edgeLabels.map(({ edge, text, x }) => ({ edge, text, x }));
  });
  // At t = 0.25 of the cubic from x = 220 to 600, whose control points lie half the distance in:
  // 220 · 0.75³ + 410 · 3 · 0.75² · 0.25 + 410 · 3 · 0.75 · 0.25² + 600 · 0.25³.
  expect(labels).toEqual([{ edge: "a-b", text: "moved", x: 332.8125 }]);
  const stroke = await strokeOf(page, BLUE);
  // Solid: nearly every pixel of the 341, where the dash of 8 and 8 drew about half.
  expect(stroke.drawn).toBeGreaterThan(300);
  expect((await strokeOf(page, RED)).drawn).toBe(0);
  // A label cleared with null is drawn no more.
  await page.evaluate(() => window.comb.updateEdge("a-b", { label: null }));
  const after = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().edgeLabels.length;
  });
  expect(after).toBe(0);
});

/** Each call refused on PAIR with the edge `a-b` added, with the problem it reports. */
const REFUSED: { name: string; call: [string, unknown[]]; problem: unknown }[] = [
  {
    name: "an edge to a node the graph does not hold",
    call: ["addEdge", [{ id: "x", source: "a", target: "z" }]],
    problem: { kind: "missingNode", edge: "x", node: "z" },
  },
  {
    name: "an edge of an identifier the graph holds",
    call: ["addEdge", [{ id: "a-b", source: "b", target: "a" }]],
    problem: { kind: "duplicateEdge", edge: "a-b" },
  },
  {
    name: "an edge from a node to itself",
    call: ["addEdge", [{ id: "x", source: "a", target: "a" }]],
    problem: { kind: "selfEdge", edge: "x" },
  },
  {
    name: "an edge of a colour past 0xFFFFFF",
    call: ["addEdge", [{ id: "x", source: "b", target: "a", color: 0x1000000 }]],
    problem: { kind: "invalidColor", edge: "x" },
  },
  {
    name: "an edge whose source is no string",
    call: ["addEdge", [{ id: "x", source: 5, target: "a" }]],
    problem: {
      kind: "invalidField",
      list: "edges",
      index: 0,
      id: "x",
      field: "source",
      expected: "a well-formed string of at most 256 code units",
    },
  },
  {
    name: "a patch of an unknown edge",
    call: ["updateEdge", ["z", { color: BLUE }]],
    problem: { kind: "unknownEdge", edge: "z" },
  },
  {
    name: "a patch with an unknown field",
    call: ["updateEdge", ["a-b", { color: BLUE, width: 3 }]],
    problem: { kind: "unknownEdgePatchField", edge: "a-b", field: "width" },
  },
  {
    name: "a patch of a colour past 0xFFFFFF",
    call: ["updateEdge", ["a-b", { color: 0x1000000 }]],
    problem: { kind: "invalidColor", edge: "a-b" },
  },
  {
    name: "a patch of a dash that is not positive",
    call: ["updateEdge", ["a-b", { color: BLUE, dash: [0, 4] }]],
    problem: { kind: "invalidDash", edge: "a-b" },
  },
  {
    name: "a patch of a label text of the wrong type",
    call: ["updateEdge", ["a-b", { label: { text: 5, t: 0.5, offset: 0 } }]],
    problem: { kind: "invalidLabelText", edge: "a-b" },
  },
  {
    name: "a patch that is no plain object",
    call: ["updateEdge", ["a-b", [["color", BLUE]]]],
    problem: expect.objectContaining({ kind: "malformed" }),
  },
];

for (const { name, call, problem } of REFUSED) {
  test(`${call[0]} refuses ${name} with a GraphDataError, and nothing changes`, async ({
    page,
  }) => {
    // Verifies: Q-7, ADR-0026, ADR-0024
    await open(page);
    await loaded(page);
    const edge = { id: "a-b", source: "a", target: "b", color: RED, dash: [8, 8] as const };
    await page.evaluate((edge) => window.comb.addEdge(edge), edge);
    const before = await strokeOf(page, RED);
    const refused = await page.evaluate(([method, args]) => {
      try {
        (window.comb as unknown as Record<string, (...args: unknown[]) => void>)[method]!(...args);
        return null;
      } catch (error) {
        const { name, problem } = error as Error & { problem: unknown };
        return { name, problem };
      }
    }, call);
    expect(refused).toEqual({ name: "GraphDataError", problem });
    expect(await told(page)).toHaveLength(1);
    expect(await strokeOf(page, RED)).toEqual(before);
    const ids = await page.evaluate(() => window.inspect().edges.map(({ id }) => id));
    expect(ids).toEqual(["a-b"]);
  });
}

test("addEdge refuses an edge past the limit of a load as tooMany", async ({ page }) => {
  // Verifies: Q-7, ADR-0026
  test.setTimeout(120_000);
  await open(page);
  const result = await page.evaluate(() => {
    const nodes = [
      { id: "a", title: "", x: 1e6, y: 1e6, width: 5, height: 5 },
      { id: "b", title: "", x: 1e6 + 10, y: 1e6, width: 5, height: 5 },
    ];
    const edges = Array.from({ length: 1_000_000 }, (_, i) => ({
      id: `e${i}`,
      source: "a",
      target: "b",
    }));
    window.comb.load({ nodes, edges });
    try {
      window.comb.addEdge({ id: "x", source: "b", target: "a" });
      return null;
    } catch (error) {
      return (error as Error & { problem: unknown }).problem;
    }
  });
  expect(result).toEqual({ kind: "tooMany", list: "edges", limit: 1_000_000 });
});

test("a patch of one field keeps the label and the dash, and moves a label the edge has", async ({
  page,
}) => {
  // Verifies: G-5, ADR-0023
  await open(page);
  await loaded(page);
  const edge = {
    id: "a-b",
    source: "a",
    target: "b",
    color: RED,
    dash: [8, 8] as const,
    label: { text: "kept", t: 0.5, offset: 0 },
  };
  await page.evaluate((edge) => window.comb.addEdge(edge), edge);
  await page.evaluate(() => window.comb.updateEdge("a-b", { arrow: "none" }));
  const labels = async () =>
    page.evaluate(async () => {
      await window.comb.whenRendered();
      return window.inspect().edgeLabels.map(({ text, x }) => ({ text, x }));
    });
  expect(await labels()).toEqual([{ text: "kept", x: 410 }]);
  expect((await strokeOf(page, RED)).runs).toBeGreaterThan(10);
  await page.evaluate(() =>
    window.comb.updateEdge("a-b", { label: { text: "kept", t: 0.25, offset: 0 } }),
  );
  expect(await labels()).toEqual([{ text: "kept", x: 332.8125 }]);
  // A patch that sets nothing tells nothing.
  await page.evaluate(() => window.comb.updateEdge("a-b", {}));
  expect((await told(page)).map((change) => (change as { kind: string }).kind)).toEqual([
    "edgeAdded",
    "edgeUpdated",
    "edgeUpdated",
  ]);
});

test("a getter of a patch that removes the edge refuses the patch, and no other edge changes", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0026
  await open(page);
  await loaded(page);
  await page.evaluate(
    (red) => window.comb.addEdge({ id: "e1", source: "a", target: "b", color: red }),
    RED,
  );
  const result = await page.evaluate((blue) => {
    const { comb } = window;
    const patch = {
      get color() {
        comb.removeEdges(["e1"]);
        // It takes the slot e1 freed.
        comb.addEdge({ id: "e2", source: "b", target: "a" });
        return blue;
      },
    };
    try {
      comb.updateEdge("e1", patch);
      return null;
    } catch (error) {
      return (error as Error & { problem: unknown }).problem;
    }
  }, BLUE);
  expect(result).toEqual({ kind: "unknownEdge", edge: "e1" });
  expect((await told(page)).map((change) => (change as { kind: string }).kind)).toEqual([
    "edgeAdded",
    "edgesRemoved",
    "edgeAdded",
  ]);
  expect((await strokeOf(page, BLUE)).drawn).toBe(0);
});

test("a listener that writes into a delivered change reaches nothing Comb keeps", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0026
  await open(page);
  await loaded(page);
  await page.evaluate(() => {
    window.comb.onChange((change) => {
      if (change.kind === "edgeUpdated" && change.patch.label)
        (change.patch.label as { text: string }).text = "written by a listener";
      if (change.kind === "edgeAdded" && change.edge.label)
        (change.edge.label as { text: string }).text = "written by a listener";
    });
    window.comb.addEdge({
      id: "a-b",
      source: "a",
      target: "b",
      label: { text: "one", t: 0.5, offset: 0 },
    });
  });
  const first = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().edgeLabels.map(({ text }) => text);
  });
  await page.evaluate(() =>
    window.comb.updateEdge("a-b", { label: { text: "two", t: 0.5, offset: 0 } }),
  );
  const second = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().edgeLabels.map(({ text }) => text);
  });
  expect([first, second]).toEqual([["one"], ["two"]]);
});
