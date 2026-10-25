// The user connects two nodes by dragging from a connector of one to a compatible connector of
// another (G-3, ADR-0024): the host application's `canConnect` names the edge, which is told as
// `edgeAdded` by the user; a release anywhere else, over the source, or over a node it already
// reaches makes none, and a refused name reaches the page as an error (ADR-0023).
import { expect, test, type Page } from "@playwright/test";
import type { GraphData } from "comb";
import { dragWorld, loaded, node, open, pagePoint, setViewport, told } from "./shared";

/** Node `a` above `b` and `c` beside it, and an edge from `a` to `c`. */
const NODES: GraphData = {
  nodes: [node("a"), node("b", 0, 300), node("c", 500, 0)],
  edges: [{ id: "a-c", source: "a", target: "c" }],
};

/** Drags from the world point `from` to `to`, and returns what the canvas drew midway. */
function drag(page: Page, from: [number, number], to: [number, number]) {
  return dragWorld(page, from, to, () =>
    page.evaluate(async () => {
      await window.comb.whenRendered();
      const { connection, connectors } = window.inspect();
      return { connection, connectors };
    }),
  );
}

/** The edges drawn once the canvas has drawn, and what was told since the load. */
async function after(page: Page) {
  const edges = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window
      .inspect()
      .edges.map(({ id }) => id)
      .sort();
  });
  return { edges, told: await told(page) };
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
  await loaded(page, NODES);
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

// a's connectors: top (110, 0), right (220, 32), bottom (110, 64), left (0, 32).
for (const [side, at] of [
  ["top", [110, 0]],
  ["right", [220, 32]],
  ["bottom", A_BOTTOM],
  ["left", [0, 32]],
] as const) {
  test(`a's ${side} connector and a connection from it are drawn where the engine begins its edge`, async ({
    page,
  }) => {
    // Verifies: ADR-0024
    await open(page);
    await loaded(page, NODES);
    await page.evaluate(() => (window.canConnect = () => "e7"));
    // Hovered, a shows its four connectors.
    const over = await pagePoint(page, ...(at as [number, number]));
    await page.mouse.move(over.x, over.y);
    const circle = await page.evaluate(async (side) => {
      await window.comb.whenRendered();
      const point = window.inspect().connectorPoints.find((p) => p.node === "a" && p.side === side);
      return point && { x: point.x, y: point.y };
    }, side);
    const midway = await drag(page, at as [number, number], B_TOP);
    const { edges, told } = await page.evaluate(async () => {
      await window.comb.whenRendered();
      const w = window as unknown as { told: { edge: { sourceSide: string } }[] };
      return { edges: window.inspect().edges, told: w.told };
    });
    // The press hit the connector of this side, which the engine records as the edge's.
    expect(told.map(({ edge }) => edge.sourceSide)).toEqual([side]);
    // The connector the shell draws, and draws the connection from, is where the engine begins
    // the edge.
    const ends = edges.find(({ id }) => id === "e7");
    expect(circle).toEqual(ends?.source);
    expect(midway.connection?.from).toEqual(ends?.source);
  });
}

for (const [name, to] of [
  ["the empty canvas", [300, 200]],
  ["a connector of the source itself", [220, 32]],
  ["a node the source reaches already, by another side", C_LEFT],
] as const) {
  test(`a connection released over ${name} makes no edge`, async ({ page }) => {
    // Verifies: G-3, ADR-0024
    await open(page);
    await loaded(page, NODES);
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
    await loaded(page, NODES);
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
    await loaded(page, NODES);
    await page.evaluate((id) => (window.canConnect = () => id), id);
    await drag(page, A_BOTTOM, B_TOP);
    expect(await after(page)).toEqual({ edges: ["a-c"], told: [] });
    expect(errors).toEqual([`comb: malformed graph data (${kind})`]);
  });
}

test("without canConnect a press on a connector begins no connection and shows none", async ({
  page,
}) => {
  // Verifies: ADR-0023, ADR-0025
  await open(page, "?connect=none");
  await loaded(page, NODES);
  const midway = await drag(page, A_BOTTOM, B_TOP);
  expect(midway).toEqual({ connection: null, connectors: [] });
  // The press lies on a's edge, so it drags a, as a press on a node does.
  const kinds = (await after(page)).told.map((change) => (change as { kind: string }).kind);
  expect(kinds).toEqual(["nodeMoved"]);
});

test("hitKind finds a connector just outside a node only where the Comb lets the user connect", async ({
  page,
}) => {
  // Verifies: ADR-0025
  const kinds = [];
  for (const query of ["", "?connect=none"]) {
    await open(page, query);
    await loaded(page, NODES);
    kinds.push(
      await page.evaluate(() => {
        // Three world units below a's bottom connector, outside a and within 8 pixels of it.
        const { x, y } = window.screenPoint(110, 67);
        return window.hitKind(x, y);
      }),
    );
  }
  expect(kinds).toEqual(["connector", "none"]);
});

test("at the far level no connector is drawn and a press where one would be connects nothing", async ({
  page,
}) => {
  // Verifies: ADR-0024, ADR-0025
  await open(page);
  await loaded(page, NODES);
  await setViewport(page, { x: 100, y: 100, scale: 0.25 });
  const midway = await drag(page, A_BOTTOM, B_TOP);
  expect(midway).toEqual({ connection: null, connectors: [] });
  expect((await after(page)).edges).toEqual(["a-c"]);
});

test("an edge the other way does not count: c connects to a, which reaches c", async ({ page }) => {
  // Verifies: ADR-0024
  await open(page);
  await loaded(page, NODES);
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
  await loaded(page, NODES);
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

test("a connection dragged across the empty canvas neither queries the engine nor redraws the connectors per move", async ({
  page,
}) => {
  // Verifies: ADR-0011
  await open(page);
  await loaded(page, NODES);
  await page.evaluate(() => (window.canConnect = () => "e7"));
  const press = await pagePoint(page, ...A_BOTTOM);
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  // The first move leaves a's connector for the empty canvas, below a and above b.
  const first = await pagePoint(page, 120, 120);
  await page.mouse.move(first.x, first.y);
  const before = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect();
  });
  const moves = 20;
  const seen = [];
  for (let i = 1; i <= moves; i++) {
    const at = await pagePoint(page, 120 + i * 5, 120 + i * 2);
    await page.mouse.move(at.x, at.y);
    seen.push(
      await page.evaluate(async () => {
        await window.comb.whenRendered();
        const { connection, queries, connectorRedraws, renders } = window.inspect();
        return { to: connection?.to, queries, connectorRedraws, renders };
      }),
    );
  }
  await page.mouse.up();
  // Every move rendered the line to the pointer, and none queried or redrew the connectors.
  expect(seen.map(({ to }) => to)).toEqual(
    Array.from({ length: moves }, (_, i) => ({ x: 125 + i * 5, y: 122 + i * 2 })),
  );
  expect(seen.at(-1)!.renders).toBe(before.renders + moves);
  expect(seen.map(({ queries }) => queries)).toEqual(Array(moves).fill(before.queries));
  expect(seen.map(({ connectorRedraws }) => connectorRedraws)).toEqual(
    Array(moves).fill(before.connectorRedraws),
  );
});
