// Regions (G-16): a node divided across or down into regions, each a container of its own below the
// node's content, named in a band at its start and parted from the next by a line; a drag of the
// line changes the two regions beside it and is told once in `regionsMoved`, never past what a
// region holds; a press on an empty region drags the divided node; `updateNode` divides it anew and
// a region left out goes with its content; Comb tells each region's size as the engine holds it,
// so that a load of the host's copy draws the same; and a region is no node to an edge or a call
// that names a node (ARCH-regions-are-container-slots, API-edits-report-nested-changes).
import { expect, test, type Page } from "@playwright/test";
import type { GraphData, PlacedNodeData } from "comb";
import { clickWorld, dragWorld, loaded, node, open, pagePoint, selections, told } from "./shared";

/** An activity at (0, 0), 300 wide, divided across into three named partitions of 100, 150, and
 *  100, the middle one divided down into one of 80, dashed below, and a named one of 60; `a`,
 *  60 × 60, at (10, 40) in the third partition, and `b` at (10, 40) in the first, with an edge
 *  from `b` to `a`. The partitions add up to 350, which the activity grows to. */
const ACTIVITY: GraphData = {
  nodes: [
    {
      ...node("act", 0, 0),
      width: 300,
      resizable: true,
      divide: "across",
      regions: [
        { id: "p1", name: "One partition with a long name", size: 100, line: "solid" },
        {
          id: "p2",
          name: "Two",
          size: 150,
          line: "solid",
          divide: "down",
          regions: [
            { id: "p2a", size: 80, line: [6, 4] },
            { id: "p2b", name: "Low", size: 60, line: "solid" },
          ],
        },
        { id: "p3", name: "Three", size: 100, line: "solid" },
      ],
    },
    { id: "a", x: 10, y: 40, width: 60, content: [], container: "p3" },
    { id: "b", x: 10, y: 40, width: 60, content: [], container: "p1" },
  ],
  edges: [{ id: "e", source: "b", target: "a" }],
};

/** What inspection reports of each node drawn, by identifier: its box, and of a region the band
 *  of its name and the line after it. */
async function drawnBoxes(page: Page) {
  return page.evaluate(async () => {
    await window.comb.whenRendered();
    const drawn = window.inspect().nodes;
    return Object.fromEntries(
      drawn.map(({ id, x, y, width, height, layer, region }) => [
        id,
        { x, y, width, height, layer, ...(region ? { region } : {}) },
      ]),
    );
  });
}

/** The changes of kind `kind` told since the graph was loaded. */
async function toldOf(page: Page, kind: string) {
  return (await told<{ kind: string }>(page)).filter((change) => change.kind === kind);
}

/** The height of the activity's content, above its regions. */
async function topOf(page: Page) {
  const boxes = await drawnBoxes(page);
  return boxes.p1!.y - boxes.act!.y;
}

test("an activity divided into partitions, one divided again, draws their boxes tiling the part below its content, their bands, and their lines", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes, G-16
  await open(page);
  await loaded(page, ACTIVITY);
  const top = await topOf(page);
  expect(top).toBeGreaterThan(0);
  const high = 164;
  const boxes = await drawnBoxes(page);
  expect(boxes.act).toMatchObject({ x: 0, y: 0, width: 350, height: top + high });
  const region = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
    layer: "containers",
  });
  expect(boxes.p1).toMatchObject(region(0, top, 100, high));
  expect(boxes.p2).toMatchObject(region(100, top, 150, high));
  expect(boxes.p2a).toMatchObject(region(100, top + 24, 150, 80));
  expect(boxes.p2b).toMatchObject(region(100, top + 104, 150, 60));
  expect(boxes.p3).toMatchObject(region(250, top, 100, high));
  // Bands at the top of the partitions side by side, at the left of the region below another.
  // A name longer than its band is cut and followed by an ellipsis.
  const cut = boxes.p1!.region!.band!.name;
  expect(cut.endsWith("…") && "One partition with a long name".startsWith(cut.slice(0, -1))).toBe(
    true,
  );
  expect(boxes.p1!.region).toEqual({
    band: { x: 0, y: 0, width: 100, height: 24, name: cut, rotation: 0 },
    line: { x1: 100, y1: 0, x2: 100, y2: high },
  });
  expect(boxes.p2a!.region).toEqual({ line: { x1: 0, y1: 80, x2: 150, y2: 80, dash: [6, 4] } });
  expect(boxes.p2b!.region).toEqual({
    // Turned a quarter anticlockwise, read from bottom to top.
    band: { x: 0, y: 0, width: 24, height: 60, name: "Low", rotation: -Math.PI / 2 },
  });
  // The last partition draws no line after it.
  expect(boxes.p3!.region).toEqual({
    band: { x: 0, y: 0, width: 100, height: 24, name: "Three", rotation: 0 },
  });
  // What lies in a partition lies at its position relative to it.
  expect(boxes.a).toMatchObject({ x: 260, y: top + 40 });
});

test("a drag of the line before a partition changes it and its neighbour, keeps what it holds in the world, tells one regionsMoved, and stops at what it holds", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes, G-16
  await open(page);
  await loaded(page, ACTIVITY);
  const top = await topOf(page);
  const line = await pagePoint(page, 250, top + 60);
  await page.mouse.move(line.x, line.y);
  expect(
    await page.evaluate(
      () => document.querySelector<HTMLCanvasElement>("#canvas canvas")!.style.cursor,
    ),
  ).toBe("col-resize");
  await dragWorld(page, [250, top + 60], [200, top + 60]);
  const boxes = await drawnBoxes(page);
  expect(boxes.p2).toMatchObject({ x: 100, width: 100 });
  expect(boxes.p2b).toMatchObject({ x: 100, width: 100 });
  expect(boxes.p3).toMatchObject({ x: 200, width: 150 });
  expect(boxes.a).toMatchObject({ x: 260, y: top + 40 });
  expect(await toldOf(page, "regionsMoved")).toEqual([
    {
      kind: "regionsMoved",
      by: "user",
      node: "act",
      regions: [
        { id: "p2", size: 100 },
        { id: "p3", size: 150 },
      ],
      moved: [{ id: "a", x: 60, y: 40 }],
    },
  ]);
  // Dragged past `a`, the line stops at its box.
  await dragWorld(page, [200, top + 60], [330, top + 60]);
  const stopped = await drawnBoxes(page);
  expect(stopped.p3).toMatchObject({ x: 260, width: 90 });
  expect(stopped.a).toMatchObject({ x: 260, y: top + 40 });
  expect((await toldOf(page, "regionsMoved")).at(-1)).toMatchObject({
    regions: [
      { id: "p2", size: 160 },
      { id: "p3", size: 90 },
    ],
    moved: [{ id: "a", x: 0, y: 40 }],
  });
  // Between the regions one above the other, the cursor shows a move up and down.
  const lower = await pagePoint(page, 150, top + 105);
  await page.mouse.move(lower.x, lower.y);
  expect(
    await page.evaluate(
      () => document.querySelector<HTMLCanvasElement>("#canvas canvas")!.style.cursor,
    ),
  ).toBe("row-resize");
});

test("a drag of the line between regions one above the other moves it with the pointer", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-division-moves, G-16
  await open(page);
  await loaded(page, ACTIVITY);
  const top = await topOf(page);
  // The line below `p2a`, 80 high below the band of 24 of the middle partition, 20 down.
  await dragWorld(page, [175, top + 104], [175, top + 124]);
  const boxes = await drawnBoxes(page);
  expect(boxes.p2a).toMatchObject({ y: top + 24, height: 100 });
  expect(boxes.p2b).toMatchObject({ y: top + 124, height: 40 });
  expect(await toldOf(page, "regionsMoved")).toEqual([
    {
      kind: "regionsMoved",
      by: "user",
      node: "act",
      regions: [
        { id: "p2a", size: 100 },
        { id: "p2b", size: 40 },
      ],
      moved: [],
    },
  ]);
});

test("a drag of the line after a region its own regions grew past its size moves it with the pointer", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-division-moves, G-16
  // `r0` of 30, divided across into two of 50, is laid out 100 wide; `r1` takes the rest.
  const grown: GraphData = {
    nodes: [
      {
        ...node("act", 0, 0),
        width: 300,
        height: 200,
        divide: "across",
        regions: [
          {
            id: "r0",
            size: 30,
            line: "solid",
            divide: "across",
            regions: [
              { id: "a", size: 50, line: "solid" },
              { id: "b", size: 50, line: "solid" },
            ],
          },
          { id: "r1", size: 50, line: "solid" },
        ],
      },
    ],
    edges: [],
  };
  await open(page);
  await loaded(page, grown);
  const loadedBoxes = await drawnBoxes(page);
  const top = loadedBoxes.r0!.y;
  expect(loadedBoxes.r0).toMatchObject({ x: 0, width: 100 });
  await dragWorld(page, [100, top + 60], [120, top + 60]);
  const boxes = await drawnBoxes(page);
  expect(boxes.r0).toMatchObject({ x: 0, width: 120 });
  expect(boxes.r1).toMatchObject({ x: 120, width: 180 });
  expect((await toldOf(page, "regionsMoved")).at(-1)).toMatchObject({
    regions: [
      { id: "r0", size: 120 },
      { id: "b", size: 70 },
      { id: "r1", size: 180 },
    ],
  });
});

test("a press on a partition where no node lies drags the activity with its partitions and what they hold", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, G-16
  await open(page);
  await loaded(page, ACTIVITY);
  const top = await topOf(page);
  const before = await drawnBoxes(page);
  await dragWorld(page, [150, top + 60], [200, top + 90]);
  const after = await drawnBoxes(page);
  for (const id of ["act", "p1", "p2", "p2a", "p2b", "p3", "a", "b"])
    expect([after[id]!.x, after[id]!.y], id).toEqual([before[id]!.x + 50, before[id]!.y + 30]);
  expect((await selections(page)).at(-1)).toEqual({ kind: "node", id: "act" });
  expect(await toldOf(page, "nodeMoved")).toEqual([
    { kind: "nodeMoved", by: "user", id: "act", x: 50, y: 30, container: null },
  ]);
});

test("a resize of the activity at its right side widens the last partition and tells it in nodeResized", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes, G-15
  await open(page);
  await loaded(page, ACTIVITY);
  const top = await topOf(page);
  await clickWorld(page, 150, top + 60);
  await dragWorld(page, [350, (top + 164) / 2], [400, (top + 164) / 2]);
  const boxes = await drawnBoxes(page);
  expect(boxes.p3).toMatchObject({ x: 250, width: 150 });
  expect(boxes.p1).toMatchObject({ x: 0, width: 100 });
  expect(await toldOf(page, "nodeResized")).toEqual([
    {
      kind: "nodeResized",
      by: "user",
      id: "act",
      x: 0,
      y: 0,
      width: 400,
      height: top + 164,
      moved: [],
      regions: [{ id: "p3", size: 150 }],
    },
  ]);
});

test("a node dropped from one partition into another lies in it, told once with the partition", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes, G-14
  await open(page);
  await loaded(page, ACTIVITY);
  const top = await topOf(page);
  await dragWorld(page, [280, top + 70], [30, top + 130]);
  expect(await toldOf(page, "nodeMoved")).toEqual([
    { kind: "nodeMoved", by: "user", id: "a", x: 10, y: 100, container: "p1" },
  ]);
});

test("updateNode with partitions that leave two out removes their content and tells it, and the others take the patch's sizes, the last the rest, told by the size it holds", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes, G-16
  await open(page);
  await loaded(page, ACTIVITY);
  const top = await topOf(page);
  await page.evaluate(() =>
    window.comb.updateNode("act", {
      regions: [
        { id: "p3", name: "Three", size: 120, line: "solid" },
        { id: "p4", size: 50, line: [4, 4] },
      ],
    }),
  );
  expect(await told(page)).toEqual([
    { kind: "nodesRemoved", by: "host", nodes: ["b"], edges: ["e"] },
    {
      kind: "nodeUpdated",
      by: "host",
      id: "act",
      patch: {
        divide: "across",
        regions: [
          { id: "p3", name: "Three", size: 120, line: "solid" },
          // The size it holds, not the rest it is drawn at, so that a load of the host's copy
          // lays it out alike.
          { id: "p4", size: 50, line: [4, 4] },
        ],
      },
    },
  ]);
  const boxes = await drawnBoxes(page);
  expect(Object.keys(boxes).sort()).toEqual(["a", "act", "p3", "p4"]);
  expect(boxes.p3).toMatchObject({ x: 0, y: top, width: 120 });
  // Laid out from the activity's data width, 300, as a load of the merged data is.
  expect(boxes.p4).toMatchObject({ x: 120, y: top, width: 180 });
  // The partition kept by its identifier keeps what it holds, at its position relative to it.
  expect(boxes.a).toMatchObject({ x: 10, y: top + 40 });
});

test("an edge whose end names a region, and removeNodes and updateNode naming one, are refused and the graph stays as it was", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes, Q-7
  await open(page);
  await loaded(page, ACTIVITY);
  const before = await drawnBoxes(page);
  const refused = await page.evaluate(() => {
    const calls: [string, () => void][] = [
      ["addEdge", () => window.comb.addEdge({ id: "f", source: "a", target: "p1" })],
      ["removeNodes", () => window.comb.removeNodes(["p1"])],
      ["updateNode", () => window.comb.updateNode("p2", { resizable: true })],
      [
        "addNode",
        () =>
          window.comb.addNode({ id: "c", x: 0, y: 0, width: 50, content: [], container: "act" }),
      ],
    ];
    return calls.map(([name, call]) => {
      try {
        call();
        return [name, null];
      } catch (error) {
        return [name, (error as Error & { problem: unknown }).problem];
      }
    });
  });
  expect(refused).toEqual([
    ["addEdge", { kind: "missingNode", edge: "f", node: "p1" }],
    ["removeNodes", { kind: "unknownNode", node: "p1" }],
    ["updateNode", { kind: "unknownNode", node: "p2" }],
    [
      "addNode",
      {
        kind: "invalidContainer",
        node: "c",
        field: "container",
        expected: "the identifier of a container or a region, not of a node divided into regions",
      },
    ],
  ]);
  expect(await told(page)).toEqual([]);
  expect(await drawnBoxes(page)).toEqual(before);
});

test("a node is refused in a divided partition by a load, by addNode, and by a drop on its band", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes
  await open(page);
  await loaded(page, ACTIVITY);
  const top = await topOf(page);
  const refused = await page.evaluate(() => {
    const problem = (call: () => void) => {
      try {
        call();
        return null;
      } catch (error) {
        return (error as Error & { problem: { kind: string; expected?: string } }).problem;
      }
    };
    return [
      problem(() =>
        window.comb.addNode({ id: "c", x: 0, y: 0, width: 50, content: [], container: "p2" }),
      ),
      problem(() =>
        window.comb.load({
          nodes: [
            {
              id: "d",
              x: 0,
              y: 0,
              width: 100,
              content: [],
              divide: "across",
              regions: [
                {
                  id: "q",
                  size: 50,
                  line: "solid",
                  divide: "down",
                  regions: [{ id: "q1", size: 50, line: "solid" }],
                },
              ],
            },
            { id: "e", x: 0, y: 0, width: 10, content: [], container: "q" },
          ],
          edges: [],
        }),
      ),
    ];
  });
  const expected = "the identifier of a container or a region, not of a node divided into regions";
  expect(refused).toEqual([
    { kind: "invalidContainer", node: "c", field: "container", expected },
    { kind: "invalidContainer", node: "e", field: "container", expected },
  ]);
  // Dropped on the band of the partition divided again, `a` lands in the activity's lowest
  // container that takes it: none, the canvas.
  await dragWorld(page, [280, top + 70], [150, top + 10]);
  expect(await toldOf(page, "nodeMoved")).toEqual([
    expect.objectContaining({ id: "a", container: null }),
  ]);
});

test("updateNode into no regions, or a division without regions, leaves the activity undivided and no container", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes
  for (const patch of [{ regions: [] }, { divide: "down" as const }]) {
    await open(page);
    await loaded(page, ACTIVITY);
    await page.evaluate((p) => window.comb.updateNode("act", p), patch);
    const updated = (await toldOf(page, "nodeUpdated")) as unknown as { patch: unknown }[];
    expect(updated.map(({ patch: given }) => given)).toEqual([{ regions: [] }]);
    const boxes = await drawnBoxes(page);
    expect(boxes.act).toMatchObject({ width: 300, layer: "nodes" });
    expect(Object.keys(boxes).sort()).toEqual(["act"]);
    // No container any more, as a load of it would make it.
    const problem = await page.evaluate(() => {
      try {
        window.comb.addNode({ id: "c", x: 0, y: 0, width: 50, content: [], container: "act" });
        return null;
      } catch (error) {
        return (error as Error & { problem: { expected?: string } }).problem.expected;
      }
    });
    expect(problem).toBe("the identifier of a node marked isContainer");
  }
});

test("updateNode lays the partitions out from the activity's data width, as a load of the merged data does", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots
  await open(page);
  await loaded(page, ACTIVITY);
  const regions = [
    { id: "p1", size: 100, line: "solid" as const },
    { id: "p3", size: 50, line: "solid" as const },
  ];
  await page.evaluate((r) => window.comb.updateNode("act", { regions: r }), regions);
  const updated = await drawnBoxes(page);
  await loaded(page, {
    nodes: [{ ...(ACTIVITY.nodes[0] as PlacedNodeData), regions }, ACTIVITY.nodes[1]!],
    edges: [],
  });
  const reloaded = await drawnBoxes(page);
  for (const id of ["act", "p1", "p3"]) expect(updated[id], id).toEqual(reloaded[id]);
  expect(updated.act).toMatchObject({ width: 300 });
});

/** An activity 300 × 200, divided across into a partition of 100, divided down into one of 30,
 *  and one of 50: each of the regions of 30 and 50 takes the rest of what it divides. */
const RESTING: GraphData = {
  nodes: [
    {
      ...node("act", 0, 0),
      width: 300,
      height: 200,
      resizable: true,
      divide: "across",
      regions: [
        {
          id: "p1",
          size: 100,
          line: "solid",
          divide: "down",
          regions: [{ id: "p1a", size: 30, line: "solid" }],
        },
        { id: "p2", size: 50, line: "solid" },
      ],
    },
  ],
  edges: [],
};

/** The boxes drawn now, and those a load of the example's copy, kept from `onChange`, draws. */
async function drawnAndReloaded(page: Page) {
  const drawn = await drawnBoxes(page);
  await page.evaluate(() => window.useGraph(window.exampleGraph()));
  return [drawn, await drawnBoxes(page)];
}

test("what Comb tells of the regions after a patch of content, a drag of a line, and a resize loads again to the same picture", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-division-moves, G-16
  await open(page);
  await loaded(page, RESTING);
  // Content of five rows lowers the partitions; the region of 30 is laid out from its size, so the
  // activity stays 200 high.
  await page.evaluate(() =>
    window.comb.updateNode("act", {
      content: [
        [{ kind: "text", role: "title", text: "act" }],
        ...["one", "two", "three", "four"].map((text) => [
          { kind: "text" as const, role: "body" as const, text },
        ]),
      ],
    }),
  );
  const [patched, again] = await drawnAndReloaded(page);
  expect(patched).toEqual(again);
  expect(patched!.act).toMatchObject({ height: 200 });
  const top = await topOf(page);
  expect(top).toBeGreaterThan(64);
  // The line between the partitions, from 100 to 150: each takes the extent it is drawn at.
  await dragWorld(page, [100, top + 60], [150, top + 60]);
  expect(await toldOf(page, "regionsMoved")).toMatchObject([
    {
      regions: [
        { id: "p1", size: 150 },
        { id: "p2", size: 150 },
      ],
    },
  ]);
  const [dragged, draggedAgain] = await drawnAndReloaded(page);
  expect(dragged).toEqual(draggedAgain);
  // A resize at the right side, 50 wider: the last partition takes it.
  const height = (await drawnBoxes(page)).act!.height;
  await clickWorld(page, 200, top + 60);
  await dragWorld(page, [300, height / 2], [350, height / 2]);
  expect(await toldOf(page, "nodeResized")).toMatchObject([
    { width: 350, regions: [{ id: "p2", size: 200 }] },
  ]);
  const [resized, resizedAgain] = await drawnAndReloaded(page);
  expect(resized).toEqual(resizedAgain);
  expect(resized!.p2).toMatchObject({ x: 150, width: 200 });
});

/** Presses at the world point `from`, drags to `out`, back to `from`, and releases there. */
async function dragOutAndBack(page: Page, from: [number, number], out: [number, number]) {
  const [a, b] = [await pagePoint(page, ...from), await pagePoint(page, ...out)];
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.move(a.x, a.y, { steps: 8 });
  await page.mouse.up();
}

test("a resize of a divided node out and back to the box it began at tells the last region's size, the extent it took the rest at", async ({
  page,
}) => {
  // Verifies: API-edits-report-division-moves, ARCH-regions-are-container-slots, G-15
  await open(page);
  await loaded(page, RESTING);
  const top = await topOf(page);
  const before = await drawnBoxes(page);
  await clickWorld(page, 200, top + 60);
  await dragOutAndBack(page, [300, 100], [350, 100]);
  // The box ends where it began, but the partition of 50 now holds the extent of 200 it shows.
  expect(await drawnBoxes(page)).toEqual(before);
  expect(await toldOf(page, "nodeResized")).toEqual([
    {
      kind: "nodeResized",
      by: "user",
      id: "act",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      moved: [],
      regions: [{ id: "p2", size: 200 }],
    },
  ]);
});

test("a drag of a line out and back to where it began tells the last region's size, the extent it took the rest at", async ({
  page,
}) => {
  // Verifies: API-edits-report-division-moves, ARCH-regions-are-container-slots, G-16
  await open(page);
  await loaded(page, RESTING);
  const top = await topOf(page);
  const before = await drawnBoxes(page);
  await dragOutAndBack(page, [100, top + 60], [150, top + 60]);
  // The line ends where it began, but the partition of 50 now holds the extent of 200 it shows.
  expect(await drawnBoxes(page)).toEqual(before);
  expect(await toldOf(page, "regionsMoved")).toEqual([
    {
      kind: "regionsMoved",
      by: "user",
      node: "act",
      regions: [{ id: "p2", size: 200 }],
      moved: [],
    },
  ]);
});

test("a deletion of the activity asks canDelete about no region and tells none removed", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes
  await open(page);
  await loaded(page, ACTIVITY);
  const top = await topOf(page);
  await page.evaluate(() => {
    const w = window as unknown as { asked: unknown[] };
    w.asked = [];
    window.canDelete = (deletion) => {
      w.asked.push(deletion);
      return true;
    };
  });
  await clickWorld(page, 150, top + 60);
  await page.keyboard.press("Delete");
  const asked = await page.evaluate(() => (window as unknown as { asked: unknown[] }).asked);
  expect(asked).toEqual([{ nodes: ["act", "b", "a"], edges: ["e"] }]);
  expect(await toldOf(page, "nodesRemoved")).toEqual([
    { kind: "nodesRemoved", by: "user", nodes: ["act", "b", "a"], edges: ["e"] },
  ]);
});

test("a drag of a line between partitions divided again the same way tells the inner regions at the line too", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes
  await open(page);
  await loaded(page, {
    nodes: [
      {
        id: "act",
        x: 0,
        y: 0,
        width: 300,
        content: [],
        height: 100,
        divide: "across",
        regions: [
          {
            id: "l",
            size: 150,
            line: "solid",
            divide: "across",
            regions: [
              { id: "l1", size: 50, line: "solid" },
              { id: "l2", size: 100, line: "solid" },
            ],
          },
          { id: "r", size: 150, line: "solid" },
        ],
      },
    ],
    edges: [],
  });
  await dragWorld(page, [150, 50], [200, 50]);
  expect(await toldOf(page, "regionsMoved")).toEqual([
    {
      kind: "regionsMoved",
      by: "user",
      node: "act",
      regions: [
        { id: "l", size: 200 },
        { id: "l2", size: 150 },
        { id: "r", size: 100 },
      ],
      moved: [],
    },
  ]);
});

test("a chain of regions ten thousand deep loads and draws without a walk that recurses", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots
  await open(page);
  const outcome = await page.evaluate(async () => {
    type Region = {
      id: string;
      size: number;
      line: "solid";
      divide?: "across";
      regions?: Region[];
    };
    const root: Region = { id: "r0", size: 10, line: "solid" };
    let at = root;
    for (let k = 1; k < 10_000; k++) {
      const next: Region = { id: `r${k}`, size: 10, line: "solid" };
      at.divide = "across";
      at.regions = [next];
      at = next;
    }
    try {
      window.comb.load({
        nodes: [
          { id: "act", x: 0, y: 0, width: 100, content: [], divide: "across", regions: [root] },
        ],
        edges: [],
      });
      await window.comb.whenRendered();
      return window.inspect().nodes.length > 0 ? "drawn" : "empty";
    } catch (error) {
      return String(error);
    }
  });
  expect(outcome).toBe("drawn");
});

test("updateNode that divides a kept partition moves what it held into its first region at its world position, told as the host's nodeMoved", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes
  // The human's decision of 2026-11-18: nothing goes, `a` lies in `p3a` where it lay.
  await open(page);
  await loaded(page, ACTIVITY);
  const before = await drawnBoxes(page);
  await page.evaluate(() =>
    window.comb.updateNode("act", {
      regions: [
        { id: "p1", size: 100, line: "solid" },
        {
          id: "p3",
          size: 100,
          line: "solid",
          divide: "down",
          regions: [
            { id: "p3a", size: 120, line: "solid" },
            { id: "p3b", size: 50, line: "solid" },
          ],
        },
      ],
    }),
  );
  const kinds = (await told<{ kind: string }>(page)).map(({ kind }) => kind);
  expect(kinds).toEqual(["nodeUpdated", "nodeMoved"]);
  const p3a = (await drawnBoxes(page)).p3a!;
  const after = await drawnBoxes(page);
  expect([after.a!.x, after.a!.y]).toEqual([before.a!.x, before.a!.y]);
  expect((await toldOf(page, "nodeMoved"))[0]).toEqual({
    kind: "nodeMoved",
    by: "host",
    id: "a",
    x: before.a!.x - p3a.x,
    y: before.a!.y - p3a.y,
    container: "p3a",
  });
  expect(Object.keys(after)).toContain("b");
});

test("updateNode that divides a container moves each node it held into the region at its position where it lay, else the first, told as the host's nodeMoved", async ({
  page,
}) => {
  // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes,
  // API-edits-report-division-moves
  // The maintainer's decisions of 2026-11-25: a divided node holds its regions alone, so what `c`
  // held directly goes, where it lay, into the region at its position, as a drop there would:
  // `x` into `r1a`, the region of `r1`, and `y` into `r2`; `z`, beside every region, into the
  // first, `r1a`.
  await open(page);
  await loaded(page, {
    nodes: [
      { ...node("c", 0, 0), width: 300, height: 200, isContainer: true },
      { id: "x", x: 10, y: 150, width: 20, content: [], container: "c" },
      { id: "y", x: 200, y: 150, width: 20, content: [], container: "c" },
      { id: "z", x: 500, y: 150, width: 20, content: [], container: "c" },
    ],
    edges: [],
  });
  const before = await drawnBoxes(page);
  await page.evaluate(() =>
    window.comb.updateNode("c", {
      divide: "across",
      regions: [
        {
          id: "r1",
          size: 150,
          line: "solid",
          divide: "down",
          regions: [{ id: "r1a", size: 80, line: "solid" }],
        },
        { id: "r2", size: 150, line: "solid" },
      ],
    }),
  );
  const kinds = (await told<{ kind: string }>(page)).map(({ kind }) => kind);
  expect(kinds).toEqual(["nodeUpdated", "nodeMoved", "nodeMoved", "nodeMoved"]);
  const after = await drawnBoxes(page);
  const moved = await toldOf(page, "nodeMoved");
  for (const [id, into] of [
    ["x", "r1a"],
    ["y", "r2"],
    ["z", "r1a"],
  ] as const) {
    expect([after[id]!.x, after[id]!.y]).toEqual([before[id]!.x, before[id]!.y]);
    expect(moved.find((change) => (change as { id?: string }).id === id)).toEqual({
      kind: "nodeMoved",
      by: "host",
      id,
      x: before[id]!.x - after[into]!.x,
      y: before[id]!.y - after[into]!.y,
      container: into,
    });
  }
});
