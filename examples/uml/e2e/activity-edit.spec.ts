// Browser tests of editing the UML example's activity diagram (G-20): the palette's elements, each
// in its node shape where it was dropped, in the partition under the pointer, a pin, an expansion
// node, or a parameter node on the border nearest the drop (ARCH-border-nodes-ride-sides); a move
// between partitions the example's veto allows, and one out of the frame it refuses
// (API-edits-report-nested-changes); the connections the table of refusals refuses, saying why,
// and others that add a control or an object flow; a pin dragged around its action; and a flow's
// guard and weight the sidebar edits.
import { expect, test, type Page } from "@playwright/test";
import type { GraphChange, NodeData } from "comb";
import { clickWorld, drawnNode, open, pagePoint, setViewport } from "./shared";

/** Chooses the activity diagram in the sidebar and waits until its load has drawn. */
async function chooseActivity(page: Page): Promise<void> {
  await page.locator("#diagram").selectOption("activity");
  await page.evaluate(() => window.uml.loadReport);
}

/** The example's copy of the graph and the kind of each edge. */
async function state(page: Page) {
  return page.evaluate(() => ({
    graph: window.uml.exampleGraph(),
    kinds: window.uml.edgeKinds(),
  }));
}

/** Shows the whole of the activity diagram, so that each node is drawn and its place read. */
async function overview(page: Page): Promise<void> {
  await setViewport(page, { x: 20, y: 20, scale: 0.4 });
}

/** Node `id` of the example's copy, as `NodeData`, which a border node is. */
async function dataOf(page: Page, id: string): Promise<NodeData | undefined> {
  return page.evaluate(
    (wanted) => window.uml.exampleGraph().nodes.find((node) => node.id === wanted),
    id,
  );
}

/** Node or region `id` as the canvas draws it, the whole diagram in view. */
async function boxOf(page: Page, id: string) {
  await overview(page);
  return (await drawnNode(page, id))!;
}

/** Drops the palette's `kind` with the pointer over the world point (`x`, `y`), shown at (400, 400)
 *  of the canvas at scale 1. */
async function dropAtWorld(page: Page, kind: string, x: number, y: number): Promise<void> {
  await setViewport(page, { x: 400 - x, y: 400 - y, scale: 1 });
  await page
    .locator(`#palette [data-kind="${kind}"]:visible`)
    .dragTo(page.locator("#canvas canvas"), { targetPosition: { x: 400, y: 400 } });
}

/** What the palette offers in the activity diagram, by its name and kind, and the node shape each
 *  is drawn in, written here from the ticket's settled building blocks rather than read from the
 *  example. */
const PALETTE: [string, string, string][] = [
  ["Action", "action", "rounded-rectangle"],
  ["Call behavior action", "call-behavior-action", "rounded-rectangle"],
  ["Send signal action", "send-signal-action", "pentagon"],
  ["Accept event action", "accept-event-action", "notched-rectangle"],
  ["Accept time event action", "accept-time-event-action", "hourglass"],
  ["Object node", "object-node", "rectangle"],
  ["Input pin", "input-pin", "rectangle"],
  ["Output pin", "output-pin", "rectangle"],
  ["Data store", "data-store", "rectangle"],
  ["Central buffer", "central-buffer", "rectangle"],
  ["Decision", "decision-node", "diamond"],
  ["Fork", "fork-node", "bar"],
  ["Join", "join-node", "bar"],
  ["Interruptible region", "interruptible-region", "rounded-rectangle"],
  ["Expansion region", "expansion-region", "rounded-rectangle"],
  ["Expansion node", "expansion-node", "rectangle"],
  ["Connector", "connector", "ellipse"],
  ["Comment", "activity-comment", "note"],
  ["Activity frame", "activity-frame", "frame"],
  ["Input parameter node", "input-parameter", "rectangle"],
  ["Output parameter node", "output-parameter", "rectangle"],
];

/** The kinds that ride a border, the node each is dropped on, and the side nearest the drop: a pin
 *  on the right side of the action Bind the scene, an expansion node on the top of the expansion
 *  region, a parameter node on the bottom of the frame. */
const BORDER: Record<string, { on: string; side: "right" | "top" | "bottom" }> = {
  "input-pin": { on: "bind", side: "right" },
  "output-pin": { on: "bind", side: "right" },
  "expansion-node": { on: "measure", side: "top" },
  "input-parameter": { on: "load", side: "bottom" },
  "output-parameter": { on: "load", side: "bottom" },
};

/** The world point 2 inside `side` of `box`, a third of the way along it. */
function nearSide(
  box: { x: number; y: number; width: number; height: number },
  side: "right" | "top" | "bottom",
): [number, number] {
  if (side === "right") return [box.x + box.width - 2, box.y + box.height / 3];
  const y = side === "top" ? box.y + 2 : box.y + box.height - 2;
  return [box.x + box.width / 3, y];
}

test("the palette offers each element of the activity diagram", async ({ page }) => {
  // Verifies: G-20
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  await expect(page.locator("#palette li:visible")).toHaveText(PALETTE.map(([name]) => name));
});

for (const [name, kind, shape] of PALETTE)
  test(`the palette adds ${name.toLowerCase()} where it was dropped, in the partition under the pointer or on the border nearest it`, async ({
    page,
  }) => {
    // Verifies: G-20, G-1, ARCH-border-nodes-ride-sides
    await page.goto("/");
    await open(page);
    await chooseActivity(page);
    const border = BORDER[kind];
    const id = `${kind}-1`;
    if (border) {
      const owner = await boxOf(page, border.on);
      const [x, y] = nearSide(owner, border.side);
      await dropAtWorld(page, kind, x, y);
      const node = (await drawnNode(page, id))!;
      const data = (await dataOf(page, id))!;
      expect(data).toMatchObject({ attachedTo: border.on, side: border.side });
      const along = border.side === "right" ? y - owner.y : x - owner.x;
      expect(data.offset).toBeCloseTo(along, 3);
      const drawnShape = await page.evaluate(
        (wanted) => window.uml.inspect().nodes.find((each) => each.id === wanted)?.shape,
        id,
      );
      expect(drawnShape).toBe(shape);
      const centre = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
      if (border.side === "right") expect(centre.x).toBeCloseTo(owner.x + owner.width, 3);
      else
        expect(centre.y).toBeCloseTo(border.side === "top" ? owner.y : owner.y + owner.height, 3);
      // A pin's name beside it; an expansion node's two outer rectangles side by side with it.
      const companions = kind.endsWith("-pin")
        ? [`${id}-name`]
        : kind === "expansion-node"
          ? [`${id}-before`, `${id}-after`]
          : [];
      for (const each of companions)
        expect({ each, attachedTo: (await dataOf(page, each))?.attachedTo }).toEqual({
          each,
          attachedTo: border.on,
        });
      return;
    }
    // Into the host application's partition, below the data store, where nothing lies.
    const host = await boxOf(page, "host");
    const [x, y] = [host.x + host.width / 2, host.y + host.height - 60];
    await dropAtWorld(page, kind, x, y);
    const node = (await page.evaluate(async (wanted) => {
      await window.uml.comb.whenRendered();
      return window.uml.inspect().nodes.find((each) => each.id === wanted);
    }, id))!;
    expect(node.shape).toBe(shape);
    expect(Math.hypot(node.x + node.width / 2 - x, node.y + node.height / 2 - y)).toBeLessThan(
      0.01,
    );
    expect((await dataOf(page, id))?.container).toBe("host");
    expect((await page.evaluate(() => window.uml.nodeKinds()))[id]).toBe(kind);
  });

test("an element dropped beside the frame lies on the canvas, and a pin dropped on no action is not added", async ({
  page,
}) => {
  // Verifies: G-20, G-1
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  const frame = await boxOf(page, "load");
  await dropAtWorld(page, "action", frame.x + frame.width + 300, frame.y + 200);
  const added = (await dataOf(page, "action-1"))!;
  expect(added.container).toBeUndefined();
  const before = await state(page);
  await dropAtWorld(page, "input-pin", frame.x + frame.width + 300, frame.y + 600);
  expect(await state(page)).toEqual(before);
});

/** Records every change Comb tells, from now on, for `changes` to read. */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const told: GraphChange[] = [];
    Object.assign(window, { told });
    window.uml.comb.onChange((change) => told.push(structuredClone(change)));
  });
}

/** The changes Comb told since `record`. */
async function changes(page: Page): Promise<GraphChange[]> {
  return page.evaluate(() => (window as unknown as { told: GraphChange[] }).told);
}

/** Drags node `id` by its middle so that its middle lands on the world point (`x`, `y`), the whole
 *  diagram in view. */
async function dragNodeTo(page: Page, id: string, x: number, y: number): Promise<void> {
  const node = await boxOf(page, id);
  const from = await pagePoint(page, node.x + node.width / 2, node.y + node.height / 2);
  const to = await pagePoint(page, x, y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test("an action dragged into another partition moves there, and one dragged out of the frame stands where it stood", async ({
  page,
}) => {
  // Verifies: G-20, G-14, API-edits-report-nested-changes
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  await record(page);
  // Into the shell's partition, right of the fork, where nothing lies.
  const shell = await boxOf(page, "shell");
  await dragNodeTo(page, "build", shell.x + 480, shell.y + 960);
  const moved = (await changes(page)).filter(
    (change) => change.kind === "nodeMoved" && change.id === "build",
  );
  expect(moved).toHaveLength(1);
  expect(moved[0]).toMatchObject({ container: "shell" });
  expect((await dataOf(page, "build"))?.container).toBe("shell");
  // Its pin rides it still.
  expect((await dataOf(page, "build-graph"))?.attachedTo).toBe("build");
  // Out of the frame onto the canvas: refused, nothing told, the action where it stood.
  const before = { drawn: await boxOf(page, "build"), data: await state(page) };
  const told = (await changes(page)).length;
  const frame = await boxOf(page, "load");
  await dragNodeTo(page, "build", frame.x + frame.width + 300, frame.y + 300);
  expect((await changes(page)).length).toBe(told);
  expect(await boxOf(page, "build")).toEqual(before.drawn);
  expect(await state(page)).toEqual(before.data);
});

/** Drags a connection from the world point `from`, a connector, to the world point `to`, another,
 *  with both in view at scale 0.6, the near level. */
async function connectWorld(page: Page, from: [number, number], to: [number, number]) {
  const scale = 0.6;
  const [mx, my] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  await setViewport(page, { x: 640 - mx * scale, y: 360 - my * scale, scale });
  const [start, end] = [await pagePoint(page, ...from), await pagePoint(page, ...to)];
  // Few pointer moves: each one waits for a frame, which a loaded machine draws slowly.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 3 });
  await page.mouse.up();
}

type Box = { x: number; y: number; width: number; height: number };

/** The connector at the middle of `side` of `box`, a node's box, in world units. */
function connectorOf(box: Box, side: "left" | "right"): [number, number] {
  return [side === "left" ? box.x : box.x + box.width, box.y + box.height / 2];
}

/** Every node's box as the canvas draws it, the whole diagram in view, read at once. */
async function boxesOf(page: Page): Promise<Record<string, Box>> {
  await overview(page);
  return page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    return Object.fromEntries(
      window.uml
        .inspect()
        .nodes.map(({ id, x, y, width, height }) => [id, { x, y, width, height }]),
    );
  });
}

/** Pairs the user connects, each its source and its target, the sides of their connectors, and
 *  why the sidebar says the table of refusals refuses it, written here from docs/CONVENTIONS.md;
 *  or the kind it adds where the table allows it. */
type Connection = [string, "left" | "right", string, "left" | "right", string];
const CONNECTIONS: Connection[] = [
  [
    "bind",
    "right",
    "refused-note",
    "right",
    "A comment is attached by its anchor; no flow starts or ends on it.",
  ],
  [
    "graph",
    "right",
    "bind",
    "right",
    "UML 2.5.1 lets no object flow touch an action or an expansion region; objects pass through their pins or expansion nodes (no_executable_nodes).",
  ],
  [
    "bind",
    "right",
    "create-comb",
    "right",
    "UML 2.5.1 lets no flow enter an output pin of an action (incoming_edges_structured_only).",
  ],
  [
    "apply-graph",
    "left",
    "graph",
    "right",
    "UML 2.5.1 lets no flow leave an input pin of an action (outgoing_edges_structured_only).",
  ],
  ["bind", "right", "graph-error", "left", "control-flow"],
  ["graph", "right", "copy", "right", "object-flow"],
];

/** The example's copy of the graph and the kind of each edge, as `state` reads them. */
type State = Awaited<ReturnType<typeof state>>;

/** Opens the activity diagram and drags each connection of `connections`, handing `check` the copy
 *  before and after it; no connection moves a node, so the boxes are read once. */
async function connectEach(
  page: Page,
  connections: Connection[],
  check: (each: Connection, before: State, after: State) => Promise<void>,
): Promise<void> {
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  const boxes = await boxesOf(page);
  for (const each of connections) {
    const [source, from, target, to] = each;
    const before = await state(page);
    await connectWorld(page, connectorOf(boxes[source]!, from), connectorOf(boxes[target]!, to));
    await check(each, before, await state(page));
  }
}

test("a connection the activity diagram's table of refusals holds is refused and the sidebar says why", async ({
  page,
}) => {
  // Verifies: G-20, G-3
  const refused = CONNECTIONS.filter(([, , , , outcome]) => !outcome.endsWith("-flow"));
  await connectEach(page, refused, async ([source, , target, , why], before, after) => {
    expect({ source, target, after }).toEqual({ source, target, after: before });
    await expect(page.locator("#connection-refusal")).toHaveText(why);
  });
});

test("a connection the activity diagram's table allows adds a control or an object flow", async ({
  page,
}) => {
  // Verifies: G-20, G-3
  const allowed = CONNECTIONS.filter(([, , , , outcome]) => outcome.endsWith("-flow"));
  await connectEach(page, allowed, async ([source, , target, , kind], _before, after) => {
    const added = after.graph.edges.filter(
      (edge) => "source" in edge && edge.source === source && edge.target === target,
    );
    expect({ source, target, added: added.length }).toEqual({ source, target, added: 1 });
    expect({ source, kind: after.kinds[added[0]!.id] }).toEqual({ source, kind });
    expect(added[0]).toMatchObject({
      arrow: "open",
      sourceSide: "outline",
      targetSide: "outline",
    });
    await expect(page.locator("#connection-refusal")).toBeHidden();
  });
});

test("a pin dragged around the corner of its action rides its new side, and the example's copy holds its side and offset", async ({
  page,
}) => {
  // Verifies: G-20, G-14, ARCH-border-nodes-ride-sides
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  const action = await boxOf(page, "build");
  const pin = await boxOf(page, "build-graph");
  await setViewport(page, { x: 400 - action.x, y: 300 - action.y, scale: 1 });
  const from = await pagePoint(page, pin.x + pin.width / 2, pin.y + pin.height / 2);
  const to = await pagePoint(page, action.x + action.width - 60, action.y + action.height + 10);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  const drawn = (await drawnNode(page, "build-graph"))!;
  const data = (await dataOf(page, "build-graph"))!;
  expect(data.side).toBe("bottom");
  expect(drawn.y + drawn.height / 2).toBeCloseTo(action.y + action.height, 3);
  expect(data.offset).toBeCloseTo(drawn.x + drawn.width / 2 - action.x, 3);
});

test("a selected flow's guard and weight, edited in the sidebar, show in its label", async ({
  page,
}) => {
  // Verifies: G-20, G-5
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  const fork = await boxOf(page, "fork");
  await setViewport(page, { x: 400 - fork.x * 0.8, y: 300 - fork.y * 0.8, scale: 0.8 });
  const ends = await page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edges.find((edge) => edge.id === "fork-measure")!;
  });
  const along = (from: number, to: number) => from + (to - from) / 5;
  await clickWorld(page, along(ends.source.x, ends.target.x), along(ends.source.y, ends.target.y));
  await expect(page.locator("#edge-heading")).toHaveText("Selected flow");
  await expect(page.locator("#trigger")).toBeHidden();
  await expect(page.locator("#effect")).toBeHidden();
  /** The label the canvas draws on the flow. */
  const label = () =>
    page.evaluate(async () => {
      await window.uml.comb.whenRendered();
      return window.uml.inspect().edgeLabels.find(({ edge }) => edge === "fork-measure")?.text;
    });
  await page.locator("#guard").fill("rows left");
  expect(await label()).toBe("[rows left]");
  await page.locator("#weight").fill("2");
  expect(await label()).toBe("[rows left] {weight=2}");
  for (const field of ["#guard", "#weight"]) await page.locator(field).fill("");
  expect(await label()).toBeUndefined();
});

test("the sidebar renames a pin beside it and sets an expansion region's mode, and offers nothing for a decision", async ({
  page,
}) => {
  // Verifies: G-20, G-5
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  /** Clicks node `id` `inset` inside its top left corner, clear of what it holds and of the
   *  connectors at the middles of its sides, and expects it selected. */
  const select = async (id: string, inset: number) => {
    const node = await boxOf(page, id);
    await setViewport(page, { x: 400 - node.x, y: 300 - node.y, scale: 1 });
    await clickWorld(page, node.x + inset, node.y + inset);
    const highlighted = await page.evaluate(async () => {
      await window.uml.comb.whenRendered();
      return window.uml.inspect().highlighted;
    });
    expect(highlighted).toBe(id);
  };
  await select("apply-rows", 3);
  await expect(page.locator("#name")).toHaveValue("rows");
  await page.locator("#name").fill("row list");
  const name = await page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().nodes.find(({ id }) => id === "apply-rows-name")?.content;
  });
  expect(name).toEqual([[expect.objectContaining({ text: "row list" })]]);
  await select("measure", 20);
  await expect(page.locator("#mode")).toHaveValue("iterative");
  await page.locator("#mode").selectOption("parallel");
  expect(
    await page.evaluate(async () => {
      await window.uml.comb.whenRendered();
      return window.uml.inspect().nodes.find(({ id }) => id === "measure")?.content;
    }),
  ).toEqual([[expect.objectContaining({ text: "«parallel»" })]]);
  await select("veto", 16);
  await expect(page.locator("#node-form")).toBeHidden();
  await expect(page.locator("#empty")).toBeVisible();
});

test("Delete removes an expansion node with its outer rectangles, and keeps an outer rectangle selected alone", async ({
  page,
}) => {
  // Verifies: G-20, G-4
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  const ids = async () => (await state(page)).graph.nodes.map(({ id }) => id);
  for (const id of ["rows-before", "rows"]) {
    const node = await boxOf(page, id);
    await setViewport(page, { x: 400 - node.x * 2, y: 300 - node.y * 2, scale: 2 });
    // Near its corner: a press at the middle of so small a node starts a connection from its
    // connectors.
    await clickWorld(page, node.x + 3, node.y + 3);
    await page.keyboard.press("Delete");
  }
  await expect.poll(ids).not.toContain("rows-before");
  expect(await ids()).not.toContain("rows");
  expect(await ids()).not.toContain("rows-after");
});
