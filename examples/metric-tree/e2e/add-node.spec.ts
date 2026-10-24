// The host application adds a node through `addNode` (ADR-0022, ADR-0023): the canvas draws it
// where it was placed, above every node it overlaps, without a load, and `onChange` tells every
// change of the graph before the call that made it returns. A node a load would refuse, or one of
// an identifier the graph holds already, is refused, and nothing changes (ADR-0026, Q-7).
import { expect, test, type Page } from "@playwright/test";
import type { GraphChange, GraphData } from "comb";
import { NODE_HEIGHT, NODE_WIDTH, open, screenCentre, setViewport } from "./shared";

const node = (id: string, x = 0, y = 0) => ({
  id,
  title: id,
  x,
  y,
  width: NODE_WIDTH,
  height: NODE_HEIGHT,
});

/** The identifiers and places of the nodes the canvas draws, bottom to top, once it has drawn. */
async function drawn(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().nodes.map(({ id, x, y, title }) => ({ id, x, y, title }));
  });
}

/** Loads `graph` at a scale of 1 with the world's origin at (100, 100), the near level, and
 *  waits until it is drawn. */
async function loaded(page: Page, graph: GraphData): Promise<void> {
  await page.evaluate(async (graph) => {
    window.comb.load(graph);
    await window.comb.whenRendered();
  }, graph);
  await setViewport(page, { x: 100, y: 100, scale: 1 });
}

/** Presses and releases the pointer at the screen centre of the drawn node `id`, and returns the
 *  identifier of the node selected then. */
async function pressOn(page: Page, id: string): Promise<string | null> {
  await page.evaluate(() => {
    const w = window as unknown as { selected: string | null };
    w.selected = null;
    window.comb.onSelectionChange((selection) => (w.selected = selection?.id ?? null));
  });
  const at = await screenCentre(page, id);
  await page.mouse.click(at.x, at.y);
  return page.evaluate(() => (window as unknown as { selected: string | null }).selected);
}

test("addNode draws the node where the host placed it in the next frame, without a load", async ({
  page,
}) => {
  // Verifies: ADR-0022, ADR-0023
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await loaded(page, { nodes: [node("a"), node("b", 300)], edges: [] });
  const result = await page.evaluate(
    async (added) => {
      const before = window.inspect().queries;
      window.comb.addNode(added);
      await window.comb.whenRendered();
      const after = window.inspect();
      return {
        queried: after.queries - before,
        nodes: after.nodes.map(({ id, x, y }) => ({ id, x, y })),
      };
    },
    node("c", 120, 200),
  );
  expect(result).toEqual({
    queried: 1,
    nodes: [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 300, y: 0 },
      { id: "c", x: 120, y: 200 },
    ],
  });
  // The node added is a node like any other: a press on it selects it.
  expect(await pressOn(page, "c")).toBe("c");
  expect(errors).toEqual([]);
});

test("a node added over others is drawn and selected above them, and a load stacks by slot", async ({
  page,
}) => {
  // Verifies: ADR-0022, ADR-0027
  await open(page);
  // Three nodes at the same place: a load draws them in slot order, c on top.
  await loaded(page, { nodes: [node("a"), node("b"), node("c")], edges: [] });
  expect((await drawn(page)).map(({ id }) => id)).toEqual(["a", "b", "c"]);
  expect(await pressOn(page, "a")).toBe("c");
  // A node added over them, a little off, is drawn above all three and takes the press.
  await page.evaluate(
    async (d) => {
      window.comb.addNode(d);
      await window.comb.whenRendered();
    },
    node("d", 20, 10),
  );
  expect((await drawn(page)).map(({ id }) => id)).toEqual(["a", "b", "c", "d"]);
  expect(await pressOn(page, "a")).toBe("d");
});

test("onChange receives one nodeAdded before addNode returns, and one loaded for each load", async ({
  page,
}) => {
  // Verifies: ADR-0023
  await open(page);
  const result = await page.evaluate(
    (nodes) => {
      const { comb } = window;
      const told: (GraphChange | { selection: string | null })[] = [];
      comb.onChange((change) => told.push(change));
      // A listener removed hears nothing.
      const remove = comb.onChange(() => told.push({ selection: "removed" }));
      remove();
      comb.onSelectionChange((selection) => told.push({ selection: selection?.id ?? null }));
      comb.load({ nodes: [nodes.a], edges: [] });
      const afterLoad = told.length;
      comb.addNode(nodes.b);
      const afterAdd = told.length;
      comb.updateNode("b", { title: "B" });
      return { told, afterLoad, afterAdd };
    },
    { a: node("a"), b: node("b", 300.5, -40.25) },
  );
  expect(result).toEqual({
    told: [
      { kind: "loaded", by: "host" },
      { kind: "nodeAdded", by: "host", node: node("b", 300.5, -40.25) },
      { kind: "nodeUpdated", by: "host", id: "b", patch: { title: "B" } },
    ],
    afterLoad: 1,
    afterAdd: 2,
  });
});

test("a load that clears the selection tells its change before the selection", async ({ page }) => {
  // Verifies: ADR-0023
  await open(page);
  await loaded(page, { nodes: [node("a")], edges: [] });
  expect(await pressOn(page, "a")).toBe("a");
  const told = await page.evaluate((a) => {
    const told: string[] = [];
    window.comb.onSelectionChange((selection) => told.push(`selection ${String(selection)}`));
    window.comb.onChange((change) => told.push(change.kind));
    window.comb.load({ nodes: [a], edges: [] });
    return told;
  }, node("a"));
  expect(told).toEqual(["loaded", "selection null"]);
});

/** Each node `addNode` refuses on a graph of node `a`, with the problem it reports. */
const REFUSED: { name: string; added: unknown; problem: unknown }[] = [
  {
    name: "a node of an identifier the graph holds",
    added: node("a", 300),
    problem: { kind: "duplicateNode", node: "a" },
  },
  {
    name: "a coordinate that is not finite",
    added: node("c", Number.POSITIVE_INFINITY),
    problem: { kind: "nonFiniteCoordinate", node: "c" },
  },
  {
    name: "a coordinate beyond the range of a 32-bit float",
    added: node("c", 0, 1e300),
    problem: { kind: "nonFiniteCoordinate", node: "c" },
  },
  {
    name: "a title of the wrong type",
    added: { ...node("c"), title: 5 },
    problem: { kind: "invalidTitle", node: "c" },
  },
  {
    name: "a title of 1,001 characters",
    added: { ...node("c"), title: "x".repeat(1001) },
    problem: { kind: "titleTooLong", node: "c", limit: 1000 },
  },
  {
    name: "a negative width",
    added: { ...node("c"), width: -1 },
    problem: { kind: "invalidSize", node: "c" },
  },
  {
    name: "a coordinate that is a string",
    added: { ...node("c"), x: "1" },
    problem: {
      kind: "invalidField",
      list: "nodes",
      index: 0,
      id: "c",
      field: "x",
      expected: "a finite number",
    },
  },
  {
    name: "an identifier of 257 characters",
    added: node("x".repeat(257)),
    problem: { kind: "idTooLong", list: "nodes", index: 0, field: "id", limit: 256 },
  },
  {
    name: "an identifier with a lone surrogate",
    added: node("a\uD800"),
    problem: {
      kind: "invalidField",
      list: "nodes",
      index: 0,
      field: "id",
      expected: "a well-formed string of at most 256 code units",
    },
  },
  {
    name: "a node that is no object",
    added: "a",
    problem: expect.objectContaining({ kind: "malformed" }),
  },
];

for (const { name, added, problem } of REFUSED) {
  test(`addNode refuses ${name} with a GraphDataError, and nothing changes`, async ({ page }) => {
    // Verifies: Q-7, ADR-0026, ADR-0023
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await loaded(page, { nodes: [node("a")], edges: [] });
    const before = await drawn(page);
    const result = await page.evaluate(async (added) => {
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      await frame();
      const renders = window.renderCount();
      const told: string[] = [];
      window.comb.onChange((change) => told.push(change.kind));
      let refused = null;
      try {
        window.comb.addNode(added as never);
      } catch (error) {
        const { name, problem } = error as Error & { problem: unknown };
        refused = { name, problem };
      }
      await frame();
      await frame();
      // The store's map took nothing: a valid node of the refused identifier is added after.
      const rendered = window.renderCount() - renders;
      window.comb.addNode({ id: "c", title: "c", x: 500, y: 0, width: 220, height: 64 });
      return { refused, rendered, told };
    }, added);
    expect(result).toEqual({
      refused: { name: "GraphDataError", problem },
      rendered: 0,
      told: ["nodeAdded"],
    });
    expect(await drawn(page)).toEqual([...before, { id: "c", x: 500, y: 0, title: "c" }]);
    expect(errors).toEqual([]);
  });
}

test("addNode reads each field of the node once, and a getter that throws refuses it", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0026
  await open(page);
  await loaded(page, { nodes: [node("a")], edges: [] });
  const result = await page.evaluate(() => {
    const reads: Record<string, number> = {};
    const fields = { id: "c", title: "c", x: 0, y: 0, width: 220, height: 64 };
    const counted = Object.defineProperties(
      {},
      Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          {
            enumerable: true,
            get: () => ((reads[key] = (reads[key] ?? 0) + 1), value),
          },
        ]),
      ),
    );
    window.comb.addNode(counted as never);
    const throwing = Object.defineProperty({ ...fields, id: "d" }, "x", {
      get: () => {
        throw new Error("host code");
      },
    });
    let refused = null;
    try {
      window.comb.addNode(throwing);
    } catch (error) {
      const { name, problem } = error as Error & { problem: { kind: string } };
      refused = { name, kind: problem.kind };
    }
    return { reads, refused };
  });
  expect(result).toEqual({
    reads: { id: 1, title: 1, x: 1, y: 1, width: 1, height: 1 },
    refused: { name: "GraphDataError", kind: "malformed" },
  });
  expect((await drawn(page)).map(({ id }) => id)).toEqual(["a", "c"]);
});

test("addNode refuses a node past the limit of a load, and nothing changes", async ({ page }) => {
  // Verifies: Q-7, ADR-0026
  test.setTimeout(120_000);
  await open(page);
  const result = await page.evaluate(async () => {
    // A million nodes, far from the viewport, so that no frame binds a view to them.
    const nodes = Array.from({ length: 1_000_000 }, (_, i) => ({
      id: `n${i}`,
      title: "",
      x: 1e6 + (i % 1000) * 10,
      y: 1e6 + Math.floor(i / 1000) * 10,
      width: 5,
      height: 5,
    }));
    window.comb.load({ nodes, edges: [] });
    const told: string[] = [];
    window.comb.onChange((change) => told.push(change.kind));
    let refused = null;
    try {
      window.comb.addNode({ id: "c", title: "c", x: 0, y: 0, width: 220, height: 64 });
    } catch (error) {
      const { name, problem } = error as Error & { problem: unknown };
      refused = { name, problem };
    }
    window.comb.setViewport({ x: 100, y: 100, scale: 1 });
    await window.comb.whenRendered();
    return { refused, told, drawn: window.inspect().nodes.map(({ id }) => id) };
  });
  expect(result).toEqual({
    refused: {
      name: "GraphDataError",
      problem: { kind: "tooMany", list: "nodes", limit: 1_000_000 },
    },
    told: [],
    drawn: [],
  });
});

test("addNode refuses a node whose identifier passes the budget of a load, and nothing changes", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0026
  test.setTimeout(120_000);
  await open(page);
  const result = await page.evaluate(async () => {
    // 250,000 identifiers of 256 code units hold the 64,000,000 of the budget exactly.
    const nodes = Array.from({ length: 250_000 }, (_, i) => ({
      id: String(i).padStart(256, "x"),
      title: "",
      x: 1e6 + (i % 500) * 10,
      y: 1e6 + Math.floor(i / 500) * 10,
      width: 5,
      height: 5,
    }));
    window.comb.load({ nodes, edges: [] });
    const told: string[] = [];
    window.comb.onChange((change) => told.push(change.kind));
    let refused = null;
    try {
      window.comb.addNode({ id: "c", title: "c", x: 0, y: 0, width: 220, height: 64 });
    } catch (error) {
      const { name, problem } = error as Error & { problem: unknown };
      refused = { name, problem };
    }
    window.comb.setViewport({ x: 100, y: 100, scale: 1 });
    await window.comb.whenRendered();
    return { refused, told, drawn: window.inspect().nodes.map(({ id }) => id) };
  });
  expect(result).toEqual({
    refused: {
      name: "GraphDataError",
      problem: { kind: "idBudgetExceeded", limit: 64_000_000 },
    },
    told: [],
    drawn: [],
  });
});

test("a change a listener makes reaches every listener after the change being delivered", async ({
  page,
}) => {
  // Verifies: ADR-0023
  await open(page);
  const result = await page.evaluate(
    (nodes) => {
      const { comb } = window;
      const first: string[] = [];
      const second: string[] = [];
      comb.onChange((change) => {
        first.push(change.kind);
        if (change.kind === "loaded") comb.addNode(nodes.b);
      });
      comb.onChange((change) => second.push(change.kind));
      comb.load({ nodes: [nodes.a], edges: [] });
      return { first, second };
    },
    { a: node("a"), b: node("b", 300) },
  );
  expect(result).toEqual({ first: ["loaded", "nodeAdded"], second: ["loaded", "nodeAdded"] });
});

test("a listener that throws keeps no other listener from being told, and its error is thrown on", async ({
  page,
}) => {
  // Verifies: ADR-0023
  await open(page);
  await loaded(page, { nodes: [node("a")], edges: [] });
  expect(await pressOn(page, "a")).toBe("a");
  const result = await page.evaluate((a) => {
    const { comb } = window;
    const told: string[] = [];
    comb.onChange(() => {
      throw new Error("host listener");
    });
    comb.onChange((change) => told.push(change.kind));
    comb.onSelectionChange((selection) => told.push(`selection ${String(selection)}`));
    let thrown = null;
    try {
      comb.load({ nodes: [a], edges: [] });
    } catch (error) {
      thrown = (error as Error).message;
    }
    return { told, thrown };
  }, node("a"));
  expect(result).toEqual({
    told: ["loaded", "selection null"],
    thrown: "host listener",
  });
});

test("a getter of updateNode's patch that removes the node refuses the patch as unknownNode", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0026
  await open(page);
  await loaded(page, { nodes: [node("a"), node("b", 300)], edges: [] });
  const result = await page.evaluate(() => {
    const told: string[] = [];
    window.comb.onChange((change) => told.push(change.kind));
    const patch = {
      get title() {
        window.comb.removeNodes(["a"]);
        return "A";
      },
    };
    let problem = null;
    try {
      window.comb.updateNode("a", patch);
    } catch (error) {
      problem = (error as Error & { problem: unknown }).problem;
    }
    return { problem, told };
  });
  expect(result).toEqual({
    problem: { kind: "unknownNode", node: "a" },
    told: ["nodesRemoved"],
  });
});
