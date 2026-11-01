// The host application removes nodes and edges through `removeNodes` and `removeEdges` (G-4,
// ADR-0022, ADR-0030): the canvas draws them no more, a node takes its edges along, `onChange`
// tells one change, a freed slot is the next addition's, and an identifier the graph does not hold
// refuses the call, which then removes nothing (ADR-0028, Q-7).
import { expect, test, type Page } from "@playwright/test";
import type { GraphData } from "comb";
import { drawnGraph, loaded, node, open, screenCentre, told } from "./shared";

/** The viewport the tests look through: a scale of 0.5 with the world's origin at (100, 100). */
const HALF = { x: 100, y: 100, scale: 0.5 };

/** Node `a` in the middle, `b`, `c`, and `d` around it, an edge from `a` to each, and one from `b`
 *  to `c`. */
const STAR: GraphData = {
  nodes: [node("a", 300, 200), node("b", 0, 0), node("c", 600, 0), node("d", 300, 400)],
  edges: [
    { id: "a-b", source: "a", target: "b" },
    { id: "a-c", source: "a", target: "c" },
    { id: "d-a", source: "d", target: "a" },
    { id: "b-c", source: "b", target: "c" },
  ],
};

/** The nodes and edges the canvas draws once it has drawn, and what `onChange` told. */
async function drawn(page: Page) {
  const { nodes, edges } = await drawnGraph(page);
  return { nodes: nodes.map(({ id }) => id), edges: edges.sort(), told: await told(page) };
}

test("removeNodes removes a node and its three edges, and tells one nodesRemoved", async ({
  page,
}) => {
  // Verifies: G-4, ADR-0022, ADR-0030
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await loaded(page, STAR, HALF);
  await page.evaluate(() => window.comb.removeNodes(["a"]));
  expect(await drawn(page)).toEqual({
    nodes: ["b", "c", "d"],
    edges: ["b-c"],
    told: [{ kind: "nodesRemoved", by: "host", nodes: ["a"], edges: ["a-b", "a-c", "d-a"] }],
  });
  expect(errors).toEqual([]);
});

test("removeEdges removes edges and keeps their nodes, and tells one edgesRemoved", async ({
  page,
}) => {
  // Verifies: G-4, ADR-0022, ADR-0030
  await open(page);
  await loaded(page, STAR, HALF);
  await page.evaluate(() => window.comb.removeEdges(["b-c", "a-c", "b-c"]));
  expect(await drawn(page)).toEqual({
    nodes: ["a", "b", "c", "d"],
    edges: ["a-b", "d-a"],
    told: [{ kind: "edgesRemoved", by: "host", edges: ["b-c", "a-c"] }],
  });
});

test("isDrawn answers as inspect does, at the near, middle, and far level, before and after a removal", async ({
  page,
}) => {
  // Verifies: ADR-0022
  await open(page);
  await loaded(page, STAR, HALF);
  const asked = (scale: number) =>
    page.evaluate(async (viewScale) => {
      window.comb.setViewport({ x: 100, y: 100, scale: viewScale });
      await window.comb.whenRendered();
      const probe = (what: { node: string } | { edge: string }) => window.isDrawn(what);
      const { nodes, edges } = window.inspect();
      return {
        level: window.inspect().level,
        agrees:
          ["a", "b", "z"].every(
            (named) => probe({ node: named }) === nodes.some(({ id }) => id === named),
          ) &&
          ["a-b", "b-c", "z-z"].every(
            (edge) => probe({ edge }) === edges.some(({ id }) => id === edge),
          ),
        a: probe({ node: "a" }),
        ab: probe({ edge: "a-b" }),
      };
    }, scale);
  expect(await asked(1)).toEqual({ level: "near", agrees: true, a: true, ab: true });
  expect(await asked(0.5)).toEqual({ level: "middle", agrees: true, a: true, ab: true });
  expect(await asked(0.1)).toEqual({ level: "far", agrees: true, a: true, ab: true });
  await page.evaluate(() => window.comb.removeNodes(["a"]));
  expect(await asked(1)).toEqual({ level: "near", agrees: true, a: false, ab: false });
  expect(await asked(0.5)).toEqual({ level: "middle", agrees: true, a: false, ab: false });
  expect(await asked(0.1)).toEqual({ level: "far", agrees: true, a: false, ab: false });
});

test("a node added after a removal takes the freed slot and is drawn and hit above the others", async ({
  page,
}) => {
  // Verifies: ADR-0022, ADR-0027
  await open(page);
  // Three nodes at one place: a load stacks them by slot, c on top.
  await loaded(page, { nodes: [node("a"), node("b"), node("c")], edges: [] }, HALF);
  await page.evaluate(
    async (e) => {
      window.comb.removeNodes(["a"]);
      window.comb.addNode(e);
      await window.comb.whenRendered();
    },
    node("e", 10, 10),
  );
  expect((await drawn(page)).nodes).toEqual(["b", "c", "e"]);
  await page.evaluate(() => {
    const w = window as unknown as { selected: string | null };
    w.selected = null;
    window.comb.onSelectionChange((selection) => (w.selected = selection?.id ?? null));
  });
  const at = await screenCentre(page, "b");
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => (window as unknown as { selected: string }).selected)).toBe("e");
  // The freed identifier is free again too.
  await page.evaluate((a) => window.comb.addNode(a), node("a", 600, 0));
  expect((await drawn(page)).nodes).toEqual(["b", "c", "e", "a"]);
});

/** Each removal refused on STAR, with the problem it reports. */
const REFUSED: { name: string; call: [string, unknown]; problem: unknown }[] = [
  {
    name: "an unknown node among known ones",
    call: ["removeNodes", ["b", "z", "a"]],
    problem: { kind: "unknownNode", node: "z" },
  },
  {
    name: "an unknown edge among known ones",
    call: ["removeEdges", ["a-b", "z"]],
    problem: { kind: "unknownEdge", edge: "z" },
  },
  {
    name: "an edge named as a node",
    call: ["removeNodes", ["a-b"]],
    problem: { kind: "unknownNode", node: "a-b" },
  },
  {
    name: "identifiers that are no list",
    call: ["removeNodes", "a"],
    problem: expect.objectContaining({ kind: "malformed" }),
  },
  {
    name: "an identifier that is no string",
    call: ["removeEdges", ["a-b", 5]],
    problem: expect.objectContaining({ kind: "malformed" }),
  },
];

for (const { name, call, problem } of REFUSED) {
  test(`a removal of ${name} throws a GraphDataError and removes nothing`, async ({ page }) => {
    // Verifies: Q-7, ADR-0028
    await open(page);
    await loaded(page, STAR, HALF);
    const before = await drawn(page);
    const refused = await page.evaluate(([method, ids]) => {
      try {
        (window.comb as unknown as Record<string, (ids: unknown) => void>)[method]!(ids);
        return null;
      } catch (error) {
        const { name: thrown, problem: found } = error as Error & { problem: unknown };
        return { name: thrown, problem: found };
      }
    }, call);
    expect(refused).toEqual({ name: "GraphDataError", problem });
    expect(await drawn(page)).toEqual(before);
  });
}

test("removing the selected node reports null to onSelectionChange, after its change", async ({
  page,
}) => {
  // Verifies: ADR-0030
  await open(page);
  await loaded(page, STAR, HALF);
  const at = await screenCentre(page, "a");
  await page.mouse.click(at.x, at.y);
  const heard = await page.evaluate(() => {
    const events: string[] = [];
    window.comb.onChange((change) => events.push(change.kind));
    window.comb.onSelectionChange((selection) => events.push(`selection ${String(selection)}`));
    window.comb.removeNodes(["a"]);
    return events;
  });
  expect(heard).toEqual(["nodesRemoved", "selection null"]);
});

test("fitView fits the nodes a removal kept", async ({ page }) => {
  // Verifies: ADR-0022
  await open(page);
  await loaded(page, STAR, HALF);
  const viewports = await page.evaluate(async () => {
    window.comb.removeNodes(["a", "b", "c"]);
    window.comb.fitView();
    const one = window.comb.viewport();
    window.comb.removeNodes(["d"]);
    window.comb.fitView();
    return { one, none: window.comb.viewport() };
  });
  // d alone, centred, at a scale of 1.
  expect(viewports.one.scale).toBe(1);
  expect(viewports.none).toEqual(viewports.one);
});

test("a node the host removes during a drag ends it: no error, and no move of the node in its slot", async ({
  page,
}) => {
  // Verifies: ADR-0022, ADR-0030
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await loaded(page, STAR, HALF);
  const from = await screenCentre(page, "a");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y, { steps: 3 });
  await page.evaluate(
    (e) => {
      window.comb.removeNodes(["a"]);
      window.comb.addNode(e);
    },
    node("e", 300, 200),
  );
  await page.mouse.move(from.x + 80, from.y + 40, { steps: 5 });
  await page.mouse.up();
  const result = await page.evaluate(async () => {
    await window.comb.whenRendered();
    const e = window.inspect().nodes.find(({ id }) => id === "e")!;
    const kinds = (window as unknown as { told: { kind: string }[] }).told.map(({ kind }) => kind);
    return { e: { x: e.x, y: e.y }, told: kinds };
  });
  expect(result).toEqual({ e: { x: 300, y: 200 }, told: ["nodesRemoved", "nodeAdded"] });
  expect(errors).toEqual([]);
});

test("a removal reads a hostile list's length once and refuses a list too long quickly", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0028
  await open(page);
  await loaded(page, STAR, HALF);
  const before = await drawn(page);
  const result = await page.evaluate(() => {
    const kindOf = (call: () => void) => {
      try {
        call();
        return "accepted";
      } catch (error) {
        const { name, problem } = error as Error & { problem: { kind: string } };
        return `${name} ${problem.kind}`;
      }
    };
    let lengthReads = 0;
    const endless = new Proxy(["a"], {
      get: (target, key) => (key === "length" ? 2 ** 53 : Reflect.get(target, key)),
      has: () => true,
    });
    const counted = new Proxy(["a"], {
      get: (target, key) =>
        key === "length" ? { valueOf: () => ((lengthReads += 1), 1) } : Reflect.get(target, key),
    });
    const start = performance.now();
    const kinds = {
      endless: kindOf(() => window.comb.removeNodes(endless)),
      sparse: kindOf(() => window.comb.removeEdges(new Array(1_000_001))),
      counted: kindOf(() => window.comb.removeNodes(counted)),
    };
    // The list a refusal of a list too long names, so that the two removals' size checks
    // stay apart.
    const listOf = (call: () => void) => {
      try {
        call();
        return "accepted";
      } catch (error) {
        return (error as Error & { problem: { list?: string } }).problem.list;
      }
    };
    const lists = {
      nodes: listOf(() => window.comb.removeNodes(new Array(1_000_001))),
      edges: listOf(() => window.comb.removeEdges(new Array(1_000_001))),
    };
    return { kinds, lists, lengthReads, ms: performance.now() - start };
  });
  expect(result.kinds).toEqual({
    endless: "GraphDataError tooMany",
    sparse: "GraphDataError tooMany",
    counted: "GraphDataError malformed",
  });
  expect(result.lists).toEqual({ nodes: "nodes", edges: "edges" });
  expect(result.lengthReads).toBe(0);
  expect(result.ms).toBeLessThan(2_000);
  expect(await drawn(page)).toEqual(before);
});

test("a removal names an unknown identifier cut to the limit, and an empty one tells nothing", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0028
  await open(page);
  await loaded(page, STAR, HALF);
  const before = await drawn(page);
  const result = await page.evaluate(() => {
    let cut = 0;
    try {
      window.comb.removeNodes(["x".repeat(1e7)]);
    } catch (error) {
      cut = (error as Error & { problem: { node: string } }).problem.node.length;
    }
    window.comb.removeNodes([]);
    window.comb.removeEdges([]);
    return cut;
  });
  expect(result).toBe(257);
  expect(await drawn(page)).toEqual(before);
});
