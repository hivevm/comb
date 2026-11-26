// Border nodes (G-17, ARCH-border-nodes-ride-sides): an action with a pin, a small node without
// content attached to its outline by a side and an offset, which the engine centres on the outline,
// moves with the action through drags, drops, and resizes, slides along the outline under the
// user's drag, removes with the action, and reports through `onChange` as the public interface
// says (API-edits-report-division-moves).
import { expect, test, type Page } from "@playwright/test";
import type { BorderNodeData, GraphData } from "comb";
import { clickWorld, dragWorld, loaded, node, open, pagePoint, told } from "./shared";

/** Q-4's half a pixel, at the scale of 1 these tests draw at, in world units. */
const Q4 = 0.5;

/** A pin of 24 × 24 without content on `side` of `on` at `offset`. */
const pin = (id: string, on: string, side: BorderNodeData["side"], offset: number) =>
  ({ id, width: 24, height: 24, content: [], attachedTo: on, side, offset }) as BorderNodeData;

/** The action `act` at (100, 100), 220 × 64, with `pin` on its right side 16 from its top. */
const ACTION: GraphData = {
  nodes: [node("act", 100, 100), pin("pin", "act", "right", 16)],
  edges: [],
};

/** What inspection draws of each node, by identifier, in the order drawn: its box. */
async function boxes(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    return window
      .inspect()
      .nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
  });
}

/** Where the centre of the node `id` is drawn, relative to the top left corner of `on`, and the
 *  box of `on`. */
async function centreOn(page: Page, id: string, on: string) {
  const drawn = await boxes(page);
  const [box, of] = [id, on].map((wanted) => drawn.find((each) => each.id === wanted)!);
  return {
    x: box!.x + box!.width / 2 - of!.x,
    y: box!.y + box!.height / 2 - of!.y,
    width: of!.width,
    height: of!.height,
    at: { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  };
}

/** The side of a rectangle `width` × `height` that the point `(x, y)` of it lies on within Q-4,
 *  ties in the order top, right, bottom, left; none off the outline. */
function sideOf({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const within = x >= -Q4 && x <= width + Q4 && y >= -Q4 && y <= height + Q4;
  if (!within) return undefined;
  if (Math.abs(y) <= Q4) return "top";
  if (Math.abs(x - width) <= Q4) return "right";
  if (Math.abs(y - height) <= Q4) return "bottom";
  if (Math.abs(x) <= Q4) return "left";
  return undefined;
}

test("a pin loads centred on its action's right side and is drawn directly after the action", async ({
  page,
}) => {
  // Verifies: ARCH-border-nodes-ride-sides, ARCH-engine-edits-nested-graph, G-17
  await open(page);
  // `late`, added after the action, covers the pin; `early`, before it, too.
  const graph: GraphData = {
    nodes: [node("early", 300, 60), node("act", 100, 100), node("late", 300, 60), ACTION.nodes[1]!],
    edges: [],
  };
  await loaded(page, graph);
  const placed = await centreOn(page, "pin", "act");
  expect(sideOf(placed)).toBe("right");
  expect(Math.abs(placed.y - 16)).toBeLessThanOrEqual(Q4);
  // Above the action and every node of a lower rank, directly after the action; the node added
  // after the action follows the action's border nodes, as the one order of nodes says.
  expect((await boxes(page)).map(({ id }) => id)).toEqual(["early", "act", "pin", "late"]);
});

test("a pin dragged around its action's corner stays on the outline and is told once", async ({
  page,
}) => {
  // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-division-moves, G-17
  await open(page);
  await loaded(page, ACTION);
  await page.evaluate(() => {
    const w = window as unknown as { asked: number };
    w.asked = 0;
    window.canMoveInto = () => {
      w.asked++;
      return true;
    };
  });
  const start = (await centreOn(page, "pin", "act")).at;
  // Past the bottom right corner, then along under the action.
  const [a, b, c] = [
    await pagePoint(page, start.x, start.y),
    await pagePoint(page, 360, 200),
    await pagePoint(page, 250, 190),
  ];
  const sides: (string | undefined)[] = [];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (const to of [b, c]) {
    for (let step = 1; step <= 6; step++) {
      const from = to === b ? a : b;
      await page.mouse.move(
        from.x + ((to.x - from.x) * step) / 6,
        from.y + ((to.y - from.y) * step) / 6,
      );
      sides.push(sideOf(await centreOn(page, "pin", "act")));
    }
  }
  await page.mouse.up();
  // On the outline in every frame, from the right side round the corner onto the bottom.
  expect(sides.every((side) => side !== undefined)).toBe(true);
  expect(sides.at(-1)).toBe("bottom");
  const placed = await centreOn(page, "pin", "act");
  expect(sideOf(placed)).toBe("bottom");
  expect(Math.abs(placed.x - 150)).toBeLessThanOrEqual(Q4);
  const changes = await told<{ kind: string; side?: string; offset?: number }>(page);
  expect(changes).toHaveLength(1);
  expect(changes[0]).toEqual({
    kind: "nodeMoved",
    by: "user",
    id: "pin",
    side: "bottom",
    offset: 150,
  });
  // A drag of a border node asks no veto of a move into a container.
  expect(await page.evaluate(() => (window as unknown as { asked: number }).asked)).toBe(0);
});

test("a pin dragged straight out of its side stays where it was and is not told", async ({
  page,
}) => {
  // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-division-moves
  await open(page);
  await loaded(page, ACTION);
  const start = (await centreOn(page, "pin", "act")).at;
  await dragWorld(page, [start.x, start.y], [start.x + 80, start.y]);
  const placed = await centreOn(page, "pin", "act");
  expect([sideOf(placed), Math.abs(placed.y - 16) <= Q4]).toEqual(["right", true]);
  expect(await told(page)).toEqual([]);
});

test("the pin and the edge docked on it follow the dragged action in each frame", async ({
  page,
}) => {
  // Verifies: ARCH-border-nodes-ride-sides, REN-moving-layer-moves-content, G-17
  await open(page);
  const graph: GraphData = {
    nodes: [...ACTION.nodes, node("other", 600, 300)],
    edges: [{ id: "e", source: "other", target: "pin", sourceSide: "left", targetSide: "right" }],
  };
  await loaded(page, graph);
  const [a, b] = [await pagePoint(page, 150, 150), await pagePoint(page, 250, 260)];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(a.x + ((b.x - a.x) * step) / 6, a.y + ((b.y - a.y) * step) / 6);
    const placed = await centreOn(page, "pin", "act");
    expect([sideOf(placed), Math.abs(placed.y - 16) <= Q4]).toEqual(["right", true]);
    const edge = await page.evaluate(() => window.inspect().edges.find(({ id }) => id === "e")!);
    // Its target docks at the pin's right side, where the pin is drawn this frame.
    expect(Math.abs(edge.target.x - (placed.at.x + 12))).toBeLessThanOrEqual(Q4);
    expect(Math.abs(edge.target.y - placed.at.y)).toBeLessThanOrEqual(Q4);
  }
  await page.mouse.up();
  const changes = await told<{ kind: string; id: string }>(page);
  expect(changes.map(({ kind, id }) => `${kind} ${id}`)).toEqual(["nodeMoved act"]);
});

test("a pin rides its action into a container, keeps its place through a resize, and is told with neither", async ({
  page,
}) => {
  // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-division-moves
  await open(page);
  const graph: GraphData = {
    nodes: [
      { ...node("c", 100, 300), width: 600, height: 300, isContainer: true },
      { ...node("act", 100, 100), content: [], height: 64, resizable: true },
      ACTION.nodes[1]!,
    ],
    edges: [],
  };
  await loaded(page, graph, { x: 50, y: 0, scale: 1 });
  await dragWorld(page, [150, 150], [250, 450]);
  const changes = await told<{ kind: string; id: string; container?: string }>(page);
  expect(changes.map(({ kind, id, container }) => `${kind} ${id} ${container}`)).toEqual([
    "nodeMoved act c",
  ]);
  const placed = await centreOn(page, "pin", "act");
  expect([sideOf(placed), Math.abs(placed.y - 16) <= Q4]).toEqual(["right", true]);
  // A resize from the top that leaves the right side 10 high holds the pin at its end, and one
  // back gives it its offset again.
  const box = (await boxes(page)).find(({ id }) => id === "act")!;
  await clickWorld(page, box.x + 40, box.y + 40);
  const middle = box.x + box.width / 2;
  await dragWorld(page, [middle, box.y], [middle, box.y + 54]);
  const held = await centreOn(page, "pin", "act");
  expect([held.height, sideOf(held), Math.abs(held.y - held.height) <= Q4]).toEqual([
    10,
    "right",
    true,
  ]);
  await dragWorld(page, [middle, box.y + 54], [middle, box.y]);
  const back = await centreOn(page, "pin", "act");
  expect([sideOf(back), Math.abs(back.y - 16) <= Q4]).toEqual(["right", true]);
});

test("removing the action removes its pin and the edge at the pin", async ({ page }) => {
  // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-division-moves
  await open(page);
  const graph: GraphData = {
    nodes: [...ACTION.nodes, node("other", 600, 300)],
    edges: [{ id: "e", source: "other", target: "pin" }],
  };
  await loaded(page, graph);
  await page.evaluate(() => window.comb.removeNodes(["act"]));
  expect(await told(page)).toEqual([
    { kind: "nodesRemoved", by: "host", nodes: ["act", "pin"], edges: ["e"] },
  ]);
  expect((await boxes(page)).map(({ id }) => id)).toEqual(["other"]);
  expect(await page.evaluate(() => window.inspect().edges.length)).toBe(0);
});

test("Delete on the selected action names its pin and the edge at it to canDelete", async ({
  page,
}) => {
  // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-division-moves
  await open(page);
  const graph: GraphData = {
    nodes: [...ACTION.nodes, node("other", 600, 300)],
    edges: [{ id: "e", source: "other", target: "pin" }],
  };
  await loaded(page, graph);
  await page.evaluate(() => {
    const w = window as unknown as { deletions: unknown[] };
    w.deletions = [];
    window.canDelete = (deletion) => {
      w.deletions.push(deletion);
      return true;
    };
  });
  await clickWorld(page, 150, 130);
  await page.keyboard.press("Delete");
  expect(
    await page.evaluate(() => (window as unknown as { deletions: unknown[] }).deletions),
  ).toEqual([{ nodes: ["act", "pin"], edges: ["e"] }]);
  expect((await boxes(page)).map(({ id }) => id)).toEqual(["other"]);
});

test("a pin is selected and deleted alone with the edge at it", async ({ page }) => {
  // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-division-moves
  await open(page);
  const graph: GraphData = {
    nodes: [...ACTION.nodes, node("other", 600, 300)],
    edges: [{ id: "e", source: "other", target: "pin" }],
  };
  await loaded(page, graph);
  const start = (await centreOn(page, "pin", "act")).at;
  await clickWorld(page, start.x, start.y);
  await page.keyboard.press("Delete");
  expect(await told(page)).toEqual([
    { kind: "nodesRemoved", by: "user", nodes: ["pin"], edges: ["e"] },
  ]);
  expect((await boxes(page)).map(({ id }) => id)).toEqual(["act", "other"]);
});

test("updateNode that sets a pin's side alone tells the offset Comb held within that side", async ({
  page,
}) => {
  // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-division-moves
  await open(page);
  await loaded(page, { nodes: [node("act", 100, 100), pin("pin", "act", "top", 200)], edges: [] });
  await page.evaluate(() => window.comb.updateNode("pin", { side: "right" }));
  expect(await told(page)).toEqual([
    { kind: "nodeUpdated", by: "host", id: "pin", patch: { side: "right", offset: 64 } },
  ]);
  const placed = await centreOn(page, "pin", "act");
  expect([sideOf(placed), Math.abs(placed.y - 64) <= Q4]).toEqual(["right", true]);
});

test("updateNode puts a pin on another side, at that side's end past its length", async ({
  page,
}) => {
  // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-division-moves
  await open(page);
  await loaded(page, ACTION);
  await page.evaluate(() => window.comb.updateNode("pin", { side: "top", offset: 1e6 }));
  const placed = await centreOn(page, "pin", "act");
  expect([sideOf(placed), Math.abs(placed.x - placed.width) <= Q4]).toEqual(["top", true]);
  expect(await told(page)).toEqual([
    { kind: "nodeUpdated", by: "host", id: "pin", patch: { side: "top", offset: 220 } },
  ]);
  // `addNode` holds an offset the same way, and tells the node as it took it.
  await page.evaluate(() =>
    window.comb.addNode({
      id: "added",
      width: 24,
      height: 24,
      content: [],
      attachedTo: "act",
      side: "left",
      offset: -5,
    }),
  );
  const added = (await told<{ kind: string; node?: unknown }>(page)).at(-1);
  expect(added).toEqual({
    kind: "nodeAdded",
    by: "host",
    node: {
      id: "added",
      width: 24,
      height: 24,
      shape: "rectangle",
      outline: "solid",
      content: [],
      attachedTo: "act",
      side: "left",
      offset: 0,
    },
  });
});

test("a side or an offset of a node that is no border node is refused by its field in load, addNode, and updateNode", async ({
  page,
}) => {
  // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-division-moves, Q-7
  await open(page);
  await loaded(page, ACTION);
  const problems = await page.evaluate(() => {
    const problemOf = (call: () => void) => {
      try {
        call();
        return null;
      } catch (error) {
        return (error as { problem?: unknown }).problem;
      }
    };
    const placed = (fields: object) => ({ ...window.node("n", 0, 300), ...fields }) as never;
    const loads = (fields: object) => () =>
      window.comb.load({ nodes: [window.node("a"), placed(fields)], edges: [] });
    return [
      problemOf(loads({ side: "top" })),
      problemOf(loads({ offset: 4 })),
      problemOf(() => window.comb.addNode(placed({ side: "top" }))),
      problemOf(() => window.comb.addNode(placed({ offset: 4 }))),
      problemOf(() => window.comb.updateNode("act", { side: "top" })),
      problemOf(() => window.comb.updateNode("act", { offset: 4 })),
    ];
  });
  const refused = (id: string, field: string) => ({ kind: "invalidAttachment", node: id, field });
  expect(problems).toEqual([
    refused("n", "side"),
    refused("n", "offset"),
    refused("n", "side"),
    refused("n", "offset"),
    refused("act", "side"),
    refused("act", "offset"),
  ]);
  // The graph stays as it was.
  expect((await boxes(page)).map(({ id }) => id)).toEqual(["act", "pin"]);
});

test("a pin on a pin, a resizable pin, and a pin beside x are refused by their field; one on no node as missingNode", async ({
  page,
}) => {
  // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-division-moves, Q-7
  await open(page);
  await loaded(page, ACTION);
  const cases: [string, object][] = [
    ["attachedTo", { attachedTo: "pin" }],
    ["resizable", { resizable: true }],
    ["x", { x: 4 }],
  ];
  for (const [field, change] of cases) {
    const problem = await page.evaluate(
      ({ graph, fields }) => {
        const nodes = [...graph.nodes, { ...graph.nodes[1]!, id: "p", ...fields }];
        try {
          window.comb.load({ nodes, edges: [] } as GraphData);
          return null;
        } catch (error) {
          return (error as { problem?: unknown }).problem;
        }
      },
      { graph: ACTION, fields: change },
    );
    expect(problem, field).toEqual({ kind: "invalidAttachment", node: "p", field });
  }
  const missing = await page.evaluate((graph) => {
    const nodes = [...graph.nodes, { ...graph.nodes[1]!, id: "p", attachedTo: "z" }];
    try {
      window.comb.load({ nodes, edges: [] } as GraphData);
      return null;
    } catch (error) {
      return (error as { problem?: unknown }).problem;
    }
  }, ACTION);
  expect(missing).toEqual({ kind: "missingNode", borderNode: "p", node: "z" });
  // The graph stays as it was.
  expect((await boxes(page)).map(({ id }) => id)).toEqual(["act", "pin"]);
});
