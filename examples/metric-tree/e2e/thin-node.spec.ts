// A node thin on screen (ADR-0013): within its rectangle a connector reaches at most a quarter of
// the node's extent across its side, so a press at the centre of a bar, 8 world units high,
// drags the bar at the near and the middle level, and a press on each of its four connectors
// still begins a connection (G-3, G-5).
import { expect, test, type Page } from "@playwright/test";
import type { GraphData } from "comb";
import { dragWorld, loaded, node, open, sceneNumbers, told } from "./shared";

/** A bar 220 wide at the origin, and node `b` below it. */
const NODES: GraphData = {
  nodes: [{ id: "bar", x: 0, y: 0, width: 220, shape: "bar", content: [] }, node("b", 0, 300)],
  edges: [],
};

// The bar's centre and its connectors, it being 8 high; b's top connector.
const CENTRE: [number, number] = [110, 4];
const CONNECTORS = [
  ["top", [110, 0]],
  ["right", [220, 4]],
  ["bottom", [110, 8]],
  ["left", [0, 4]],
] as const;
const B_TOP: [number, number] = [110, 300];

/** Opens the example with the bar and b loaded at the scale where `level` begins, connections
 *  allowed and named `e7`, and checks the level drawn. */
async function atLevel(page: Page, level: "near" | "middle") {
  await open(page);
  const { near, far } = await sceneNumbers(page);
  await loaded(page, NODES, { x: 100, y: 100, scale: level === "near" ? near : far });
  await page.evaluate(() => (window.canConnect = () => "e7"));
  const drawn = await page.evaluate(async () => {
    await window.comb.whenRendered();
    return window.inspect().level;
  });
  expect(drawn).toBe(level);
}

/** Drags from the world point `from` to `to`, and returns the connection drawn midway. */
function drag(page: Page, from: readonly [number, number], to: [number, number]) {
  return dragWorld(page, [from[0], from[1]], to, () =>
    page.evaluate(async () => {
      await window.comb.whenRendered();
      return window.inspect().connection;
    }),
  );
}

for (const level of ["near", "middle"] as const) {
  test(`at the ${level} level, a bar pressed at its centre and dragged moves and starts no connection`, async ({
    page,
  }) => {
    // Verifies: ADR-0013, G-5
    await atLevel(page, level);
    const connection = await drag(page, CENTRE, [CENTRE[0] + 100, CENTRE[1] + 150]);
    expect(connection).toBeNull();
    const bar = await page.evaluate(async () => {
      await window.comb.whenRendered();
      return window.inspect().nodes.find(({ id }) => id === "bar")!;
    });
    expect(bar.x).toBeCloseTo(100, 0);
    expect(bar.y).toBeCloseTo(150, 0);
    expect(await told(page)).toEqual([
      { kind: "nodeMoved", by: "user", id: "bar", x: bar.x, y: bar.y },
    ]);
  });

  for (const [side, at] of CONNECTORS) {
    test(`at the ${level} level, a press on the bar's ${side} connector starts a connection from it`, async ({
      page,
    }) => {
      // Verifies: ADR-0013, G-3
      await atLevel(page, level);
      const connection = await drag(page, at, B_TOP);
      expect(connection).not.toBeNull();
      const changes = await told<{ kind: string; edge: { source: string; sourceSide: string } }>(
        page,
      );
      expect(changes.map(({ kind, edge }) => [kind, edge.source, edge.sourceSide])).toEqual([
        ["edgeAdded", "bar", side],
      ]);
    });
  }
}
