// Browser tests of editing the UML example's activity diagram (G-20): the palette's elements, each
// in its node shape where it was dropped, in the partition under the pointer, a pin, an expansion
// node, or a parameter node on the border nearest the drop (ARCH-border-nodes-ride-sides); a move
// between partitions the example's veto allows, and one out of the frame it refuses
// (API-edits-report-division-moves); the connections the table of refusals refuses, saying why,
// and others that add a control or an object flow; a pin dragged around its action; a flow's guard
// and weight the sidebar edits; the names of the frame's partitions; and a press on a resize
// handle, on a line between two partitions, and on a flow over a partition
// (REN-node-content-and-hits).
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
  // Verifies: G-20, G-14, API-edits-report-division-moves
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

test("a connection the activity diagram's table allows adds a control or an object flow, and clears the reason a refused one left", async ({
  page,
}) => {
  // Verifies: G-20, G-3
  const allowed = CONNECTIONS.filter(([, , , , outcome]) => outcome.endsWith("-flow"));
  // A refused connection first, so that the sidebar shows a reason the allowed ones must clear.
  const first = CONNECTIONS.find(([, , , , outcome]) => !outcome.endsWith("-flow"))!;
  await connectEach(page, [first, ...allowed], async (each, _before, after) => {
    const [source, , target, , kind] = each;
    if (each === first) {
      await expect(page.locator("#connection-refusal")).toHaveText(kind);
      return;
    }
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

test("the sidebar renames the frame's partitions, which their bands show, beside the activity's name, and refuses another count of names, or one left empty", async ({
  page,
}) => {
  // Verifies: G-20, G-5, ARCH-regions-are-container-slots
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  // Inside the frame's tab: Comb selects no region on its own, but the node it divides.
  const frame = await boxOf(page, "load");
  await setViewport(page, { x: 400 - frame.x, y: 300 - frame.y, scale: 1 });
  await clickWorld(page, frame.x + 20, frame.y + 20);
  await expect(page.locator("#name")).toHaveValue("Load");
  const partitions = page.locator("#partitions");
  await expect(partitions).toHaveValue("Host application\nShell\nEngine");
  // Another count of names, or one left empty, is refused, and the sidebar says why.
  for (const text of ["Host\nShell", "Host\n\nEngine"]) {
    await partitions.fill(text);
    await expect(partitions).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#partitions-refusal")).toHaveText(
      "Not taken: name each of the 3 partitions, one per line; the diagram keeps what it had.",
    );
  }
  await partitions.fill("Host\nShell\nEngine core");
  await expect(partitions).not.toHaveAttribute("aria-invalid", "true");
  const ids = ["host", "shell", "engine"];
  await overview(page);
  const named = await page.evaluate(async (wanted) => {
    await window.uml.comb.whenRendered();
    const nodes = window.uml.inspect().nodes;
    const copy = window.uml.exampleGraph().nodes.find(({ id }) => id === "load")!.regions!;
    return {
      copy: copy.map(({ name }) => name),
      bands: wanted.map((id) => nodes.find((node) => node.id === id)?.region?.band?.name),
    };
  }, ids);
  const renamed = ["Host", "Shell", "Engine core"];
  expect(named).toEqual({ copy: renamed, bands: renamed });
});

test("a flow connected between two actions becomes an interrupting edge by the sidebar's kind, drawn as a lightning bolt, and a control flow again", async ({
  page,
}) => {
  // Verifies: G-20, G-3, G-5
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  const boxes = await boxesOf(page);
  await connectWorld(
    page,
    connectorOf(boxes.bind!, "right"),
    connectorOf(boxes["graph-error"]!, "left"),
  );
  const added = (await state(page)).graph.edges.find(
    (edge) => edge.source === "bind" && edge.target === "graph-error",
  )!;
  const ends = await page.evaluate(async (id) => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edges.find((edge) => edge.id === id)!;
  }, added.id);
  const along = (from: number, to: number) => from + (to - from) / 3;
  await clickWorld(page, along(ends.source.x, ends.target.x), along(ends.source.y, ends.target.y));
  await expect(page.locator("#edge-heading")).toHaveText("Selected flow");
  // Between two actions the table allows a control flow and an interrupting edge alone.
  const kind = page.locator("#kind");
  await expect(kind.locator("option")).toHaveText(["Control flow", "Interrupting edge"]);
  await expect(kind).toHaveValue("control-flow");
  /** The kind and the style of the connected edge in the example's copy. */
  const drawn = async () => {
    const { graph, kinds } = await state(page);
    const edge = graph.edges.find(({ id }) => id === added.id)!;
    return { kind: kinds[added.id], arrow: edge.arrow, lightning: edge.lightning === true };
  };
  await kind.selectOption("interrupting-edge");
  expect(await drawn()).toEqual({ kind: "interrupting-edge", arrow: "open", lightning: true });
  // An interrupting edge is a flow, its guard and weight still edited.
  await expect(page.locator("#guard")).toBeVisible();
  await kind.selectOption("control-flow");
  expect(await drawn()).toEqual({ kind: "control-flow", arrow: "open", lightning: false });
});

test("a connection from an action to an input pin adds an exception handler, a lightning bolt without a label", async ({
  page,
}) => {
  // Verifies: G-20, G-3
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  const boxes = await boxesOf(page);
  await connectWorld(
    page,
    connectorOf(boxes.bind!, "right"),
    connectorOf(boxes["apply-graph"]!, "left"),
  );
  await expect(page.locator("#connection-refusal")).toBeHidden();
  const { graph, kinds } = await state(page);
  const added = graph.edges.filter(
    (edge) => edge.source === "bind" && edge.target === "apply-graph",
  );
  expect(added.map((edge) => [kinds[edge.id], edge.arrow, edge.lightning, edge.labels])).toEqual([
    ["exception-handler", "open", true, undefined],
  ]);
});

/** Keeps the selection Comb last reported, for `pressState`. */
async function recordSelection(page: Page): Promise<void> {
  await page.evaluate(() =>
    window.uml.comb.onSelectionChange((selection) => Object.assign(window, { selection })),
  );
}

/** The selection last reported, the resize handles the canvas draws, and how often the scene
 *  queried. */
async function pressState(page: Page) {
  return page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    const { handles, queries } = window.uml.inspect();
    return {
      selection: (window as unknown as { selection?: unknown }).selection,
      handles: handles.map(({ node, handle }) => `${node}:${handle}`),
      queries,
    };
  });
}

/** Presses the world point `from`, moves the pointer to `to` in four steps, and releases it: the
 *  width and the height of node `id` drawn after each step, and how often the scene queried before
 *  the press, before the release, and after it. */
async function dragCounted(page: Page, id: string, from: [number, number], to: [number, number]) {
  const [start, end] = [await pagePoint(page, ...from), await pagePoint(page, ...to)];
  const before = (await pressState(page)).queries;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const sizes: number[][] = [];
  for (let i = 1; i <= 4; i++) {
    const [x, y] = [start.x + ((end.x - start.x) * i) / 4, start.y + ((end.y - start.y) * i) / 4];
    await page.mouse.move(x, y);
    const box = (await drawnNode(page, id))!;
    sizes.push([box.width, box.height]);
  }
  const during = (await pressState(page)).queries;
  await page.mouse.up();
  return { sizes, before, during, after: (await pressState(page)).queries };
}

test("a press on the handle of a node above others or of the frame resizes it, one on the line between two partitions moves it, neither querying before the release, and one on a flow over a partition selects the flow", async ({
  page,
}) => {
  // Verifies: REN-node-content-and-hits, REN-moving-layer-moves-content, G-15, G-16
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  await recordSelection(page);
  // The whole diagram at the middle level, each box read once: the frame at (0, 0), 1760 × 1520,
  // its partitions of 520, 600, and 640 below its band, and in the engine's partition the expansion
  // region, whose expansion node lies on its top side where its top handle stands.
  await overview(page);
  expect(await page.evaluate(() => window.uml.inspect().level)).toBe("middle");
  const measure = (await drawnNode(page, "measure"))!;
  const rows = (await drawnNode(page, "rows"))!;
  const top: [number, number] = [measure.x + measure.width / 2, measure.y];
  expect(rows.x + rows.width / 2).toBe(top[0]);
  // Selected by a press inside it, where it holds nothing.
  await clickWorld(page, measure.x + 20, measure.y + measure.height - 20);
  const selected = await pressState(page);
  expect(selected.selection).toEqual({ kind: "node", id: "measure" });
  expect(selected.handles).toContain("measure:top");
  // Its top handle, over the expansion node and the engine's partition, resizes it.
  const resize = await dragCounted(page, "measure", top, [top[0], top[1] - 40]);
  expect(await drawnNode(page, "measure")).toEqual({
    ...measure,
    y: measure.y - 40,
    height: measure.height + 40,
  });
  // The line between the host application's partition and the shell's, pressed beside nothing,
  // moves both partitions, to the left, where the host application's nodes leave room.
  const [host, shell] = [(await drawnNode(page, "host"))!, (await drawnNode(page, "shell"))!];
  const line: [number, number] = [host.x + host.width, host.y + host.height / 2];
  const moved = await dragCounted(page, "host", line, [line[0] - 40, line[1]]);
  expect(await drawnNode(page, "host")).toEqual({ ...host, width: host.width - 40 });
  expect(await drawnNode(page, "shell")).toEqual({
    ...shell,
    x: shell.x - 40,
    width: shell.width + 40,
  });
  // The frame, selected by a press in a partition beside nothing, resized at its right handle,
  // widens the engine's partition alone.
  const [frame, engine] = [(await drawnNode(page, "load"))!, (await drawnNode(page, "engine"))!];
  await clickWorld(page, host.x + 20, host.y + host.height - 20);
  expect((await pressState(page)).selection).toEqual({ kind: "node", id: "load" });
  const right: [number, number] = [frame.x + frame.width, frame.y + frame.height / 2];
  const widened = await dragCounted(page, "engine", right, [right[0] + 40, right[1]]);
  expect(await drawnNode(page, "engine")).toEqual({ ...engine, width: engine.width + 40 });
  expect((await drawnNode(page, "shell"))?.width).toBe(shell.width + 40);
  // Each drawn anew in each frame of its drag, none queried before its release, and each once at
  // it.
  for (const counted of [resize, moved, widened]) {
    const drawnSizes = new Set(counted.sizes.map((size) => size.join()));
    expect(drawnSizes.size).toBe(4);
    expect(counted.during).toBe(counted.before);
    expect(counted.after).toBe(counted.before + 1);
  }
  // A press on the middle of the flow from the fork to the expansion region, over the shell's
  // partition, selects the flow, which lies above the partitions.
  const ends = await page.evaluate(() =>
    window.uml.inspect().edges.find(({ id }) => id === "fork-measure")!,
  );
  const middle = [(ends.source.x + ends.target.x) / 2, (ends.source.y + ends.target.y) / 2];
  expect(middle[0]).toBeGreaterThan(shell.x);
  expect(middle[0]).toBeLessThan(shell.x + shell.width);
  await clickWorld(page, middle[0]!, middle[1]!);
  expect((await pressState(page)).selection).toEqual({ kind: "edge", id: "fork-measure" });
});
