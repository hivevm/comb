// The user connects two nodes by dragging from a connector of one to a compatible connector of
// another (G-3, ADR-0024): the host application's `canConnect` names the edge, which is told as
// `edgeAdded` by the user; a release anywhere else, over the source, or over a node it already
// reaches makes none, and a refused name reaches the page as an error (ADR-0023).
import { expect, test, type Page } from "@playwright/test";
import type { GraphData } from "comb";
import { NODE_HEIGHT, NODE_WIDTH, open, setViewport } from "./shared";

const node = (id: string, x = 0, y = 0) => ({
  id,
  title: id,
  x,
  y,
  width: NODE_WIDTH,
  height: NODE_HEIGHT,
});

/** Node `a` above `b` and `c` beside it, and an edge from `a` to `c`. */
const NODES: GraphData = {
  nodes: [node("a"), node("b", 0, 300), node("c", 500, 0)],
  edges: [{ id: "a-c", source: "a", target: "c" }],
};

async function loaded(page: Page, graph: GraphData = NODES): Promise<void> {
  await page.evaluate(async (graph) => {
    window.useGraph(graph);
    const w = window as unknown as { told: unknown[] };
    w.told = [];
    window.comb.onChange((change) => w.told.push(change));
    await window.comb.whenRendered();
  }, graph);
  await setViewport(page, { x: 100, y: 100, scale: 1 });
}

/** The page point at which the canvas shows the world point `(x, y)`. */
async function pagePoint(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const rect = document.querySelector("#canvas canvas")!.getBoundingClientRect();
      const screen = window.screenPoint(x, y);
      return { x: rect.left + screen.x, y: rect.top + screen.y };
    },
    { x, y },
  );
}

/** Drags from the world point `from` to `to` in steps, and returns what the canvas drew midway. */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const [a, b] = [await pagePoint(page, ...from), await pagePoint(page, ...to)];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  const midway = await page.evaluate(async () => {
    await window.comb.whenRendered();
    const { connection, connectors } = window.inspect();
    return { connection, connectors };
  });
  await page.mouse.up();
  return midway;
}

/** The edges drawn once the canvas has drawn, and what was told since the load. */
async function after(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    return {
      edges: window
        .inspect()
        .edges.map(({ id }) => id)
        .sort(),
      told: (window as unknown as { told: unknown[] }).told,
    };
  });
}

// The connectors: a's bottom at (110, 64), b's top at (110, 300), c's left at (500, 32).
const A_BOTTOM: [number, number] = [110, 64];
const B_TOP: [number, number] = [110, 300];
const C_LEFT: [number, number] = [500, 32];

test("a drag from a's bottom connector to b's top one connects them by those sides", async ({
  page,
}) => {
  // Verifies: G-3, ADR-0024, ADR-0023
  await open(page);
  await loaded(page);
  await page.evaluate(() => {
    window.canConnect = (proposal) => {
      (window as unknown as { proposal: unknown }).proposal = proposal;
      return "e7";
    };
  });
  const midway = await drag(page, A_BOTTOM, B_TOP);
  expect(midway.connection).toEqual({ from: { x: 110, y: 64 }, to: { x: 110, y: 300 } });
  expect(midway.connectors.filter(({ node }) => node === "b")).toEqual(
    ["top", "right", "bottom", "left"].map((side) => ({ node: "b", side, compatible: true })),
  );
  const result = await after(page);
  expect(result.edges).toEqual(["a-c", "e7"]);
  expect(result.told).toEqual([
    {
      kind: "edgeAdded",
      by: "user",
      edge: {
        id: "e7",
        source: "a",
        target: "b",
        sourceSide: "bottom",
        targetSide: "top",
        color: 0x9aa1ad,
        arrow: "end",
      },
    },
  ]);
  const ends = await page.evaluate(() => window.inspect().edges.find(({ id }) => id === "e7"));
  expect(ends).toEqual({ id: "e7", source: { x: 110, y: 64 }, target: { x: 110, y: 300 } });
  expect(await page.evaluate(() => window.inspect().connection)).toBeNull();
});

for (const [name, to] of [
  ["the empty canvas", [300, 200]],
  ["a connector of the source itself", [220, 32]],
  ["a node the source reaches already, by another side", C_LEFT],
] as const) {
  test(`a connection released over ${name} makes no edge`, async ({ page }) => {
    // Verifies: G-3, ADR-0024
    await open(page);
    await loaded(page);
    const midway = await drag(page, A_BOTTOM, to as [number, number]);
    expect(midway.connection).not.toBeNull();
    expect(midway.connectors.some(({ compatible }) => compatible)).toBe(false);
    expect(await after(page)).toEqual({ edges: ["a-c"], told: [] });
  });
}

for (const name of ["false", "undefined", "a number", "a throw"] as const) {
  test(`canConnect returning ${name} makes no edge`, async ({ page }) => {
    // Verifies: ADR-0023
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await loaded(page);
    await page.evaluate((name) => {
      const results: Record<string, () => unknown> = {
        false: () => false,
        undefined: () => undefined,
        "a number": () => 7,
        "a throw": () => {
          throw new Error("host veto");
        },
      };
      window.canConnect = () => results[name]!();
    }, name);
    await drag(page, A_BOTTOM, B_TOP);
    expect(await after(page)).toEqual({ edges: ["a-c"], told: [] });
    expect(errors).toEqual(name === "a throw" ? ["host veto"] : []);
  });
}

for (const [name, id, kind] of [
  ["an identifier the graph holds", "a-c", "duplicateEdge"],
  ["an identifier past the length limit", "x".repeat(257), "idTooLong"],
] as const) {
  test(`canConnect returning ${name} makes no edge, and its GraphDataError reaches the page`, async ({
    page,
  }) => {
    // Verifies: ADR-0023, Q-7
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await loaded(page);
    await page.evaluate((id) => (window.canConnect = () => id), id);
    await drag(page, A_BOTTOM, B_TOP);
    expect(await after(page)).toEqual({ edges: ["a-c"], told: [] });
    expect(errors).toEqual([`comb: malformed graph data (${kind})`]);
  });
}

test("without canConnect a press on a connector begins no connection and shows none", async ({
  page,
}) => {
  // Verifies: ADR-0023
  await open(page, "?connect=none");
  await loaded(page);
  const midway = await drag(page, A_BOTTOM, B_TOP);
  expect(midway).toEqual({ connection: null, connectors: [] });
  // The press lies on a's edge, so it drags a, as a press on a node does.
  const kinds = (await after(page)).told.map((change) => (change as { kind: string }).kind);
  expect(kinds).toEqual(["nodeMoved"]);
});

test("hitKind finds a connector just outside a node only where it is asked for connectors", async ({
  page,
}) => {
  // Verifies: ADR-0025
  await open(page);
  await loaded(page);
  const kinds = await page.evaluate(() => {
    // Three world units below a's bottom connector, outside a and within 8 pixels of it.
    const { x, y } = window.screenPoint(110, 67);
    return [window.hitKind(x, y, true), window.hitKind(x, y, false), window.hitKind(x, y)];
  });
  expect(kinds).toEqual(["connector", "none", "none"]);
});

test("at the far level no connector is drawn and a press where one would be connects nothing", async ({
  page,
}) => {
  // Verifies: ADR-0024, ADR-0025
  await open(page);
  await loaded(page);
  await setViewport(page, { x: 100, y: 100, scale: 0.25 });
  const midway = await drag(page, A_BOTTOM, B_TOP);
  expect(midway).toEqual({ connection: null, connectors: [] });
  expect((await after(page)).edges).toEqual(["a-c"]);
});

test("an edge the other way does not count: c connects to a, which reaches c", async ({ page }) => {
  // Verifies: ADR-0024
  await open(page);
  await loaded(page);
  await page.evaluate(() => (window.canConnect = () => "c-a"));
  // From c's bottom connector at (610, 64) to a's bottom one at (110, 64).
  const midway = await drag(page, [610, 64], A_BOTTOM);
  expect(midway.connectors.filter(({ node }) => node === "a").every((c) => c.compatible)).toBe(
    true,
  );
  expect((await after(page)).edges).toEqual(["a-c", "c-a"]);
});

test("a veto that throws ends the gesture first: no connection is drawn after it", async ({
  page,
}) => {
  // Verifies: ADR-0023
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await loaded(page);
  await page.evaluate(() => {
    window.canConnect = () => {
      throw new Error("host veto");
    };
  });
  await drag(page, A_BOTTOM, B_TOP);
  const elsewhere = await pagePoint(page, 300, 200);
  await page.mouse.move(elsewhere.x, elsewhere.y, { steps: 3 });
  const state = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return { connection: window.inspect().connection, edges: window.inspect().edges.length };
  });
  expect(state).toEqual({ connection: null, edges: 1 });
  expect(errors).toEqual(["host veto"]);
});
