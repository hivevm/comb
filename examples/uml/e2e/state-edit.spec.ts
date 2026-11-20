// Browser tests of editing the UML example's state diagram (G-12, G-20): the palette's notation
// elements, each in its node shape where it was dropped, a point on the border nearest the drop;
// the sidebar's name, behaviours, state machine, and lines of a node, and trigger, guard, and
// effect of a transition; a connection that adds a transition docked on the outline
// (API-edges-dock-nodes-or-edges) where the table of refusals allows it and says why where it
// refuses it, a drag back onto a state that adds a loop, Delete, and the edits each of the three
// diagrams keeps; and of all three, that a drop is the example's only once Comb took its node.
import { expect, test, type Page } from "@playwright/test";
import type { NodeData } from "comb";
import { clickNode, clickWorld, drawnNode, open, pagePoint, setViewport } from "./shared";

/** Chooses `diagram` in the sidebar and waits until its load has drawn. */
async function choose(page: Page, diagram: "class" | "package" | "state"): Promise<void> {
  await page.locator("#diagram").selectOption(diagram);
  await page.evaluate(() => window.uml.loadReport);
}

/** The example's copy of the graph and the kind of each edge. */
async function state(page: Page) {
  return page.evaluate(() => ({
    graph: window.uml.exampleGraph(),
    kinds: window.uml.edgeKinds(),
  }));
}

/** Node `id` as the canvas draws it, with its node shape and its title. */
async function drawn(page: Page, id: string) {
  return page.evaluate(async (wanted) => {
    await window.uml.comb.whenRendered();
    const node = window.uml.inspect().nodes.find((each) => each.id === wanted);
    return node && { ...node, texts: undefined };
  }, id);
}

/** Shows the whole of the state diagram at the middle level, so that each node is drawn by a
 *  view and its place read. */
async function overview(page: Page): Promise<void> {
  await setViewport(page, { x: 20, y: 10, scale: 0.4 });
}

/** Shows node `id` near, its top-left corner at (100, 100) on the canvas, at `scale`. */
async function showNear(page: Page, id: string, scale = 1): Promise<void> {
  await overview(page);
  const node = (await drawnNode(page, id))!;
  await setViewport(page, { x: 100 - node.x * scale, y: 100 - node.y * scale, scale });
}

/** Drags a connection from the world point `from`, a connector, to the world point `to`. */
async function connect(page: Page, from: [number, number], to: [number, number]) {
  const [start, end] = [await pagePoint(page, ...from), await pagePoint(page, ...to)];
  await page.mouse.move(start.x - 20, start.y);
  await page.mouse.move(start.x, start.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

/** Drops the palette's `kind` on the canvas at (400, 500), the view at the origin at scale 1. */
async function dropAt(page: Page, kind: string): Promise<void> {
  await setViewport(page, { x: 0, y: 0, scale: 1 });
  await page
    .locator(`#palette [data-kind="${kind}"]`)
    .dragTo(page.locator("#canvas canvas"), { targetPosition: { x: 400, y: 500 } });
}

/** Drops the palette's `kind` with the pointer over the world point (`x`, `y`), shown at (400, 400)
 *  of the canvas at scale 1. */
async function dropAtWorld(page: Page, kind: string, x: number, y: number): Promise<void> {
  await setViewport(page, { x: 400 - x, y: 400 - y, scale: 1 });
  await page
    .locator(`#palette [data-kind="${kind}"]`)
    .dragTo(page.locator("#canvas canvas"), { targetPosition: { x: 400, y: 400 } });
}

/** Node `id` of the example's copy, as `NodeData`, which a border node is. */
async function dataOf(page: Page, id: string): Promise<NodeData | undefined> {
  return page.evaluate(
    (wanted) => window.uml.exampleGraph().nodes.find((node) => node.id === wanted),
    id,
  );
}

/** What the palette offers in the state diagram, by its name and kind, and the node shape each is
 *  drawn in and, for a pseudostate, its size, as small as its node shape allows, written here from
 *  G-20, UML 2.5.1, and docs/CONVENTIONS.md rather than read from the example. A history's ellipse
 *  holds its letter and is round, as high as its content makes it. */
const PALETTE: [string, string, string, { width: number; height: number }?][] = [
  ["State", "state", "rounded-rectangle"],
  ["Composite state", "composite", "rounded-rectangle"],
  ["Submachine state", "submachine", "rounded-rectangle"],
  ["State list", "state-list", "rounded-rectangle"],
  ["Initial state", "initial", "circle", { width: 20, height: 20 }],
  ["Final state", "final", "ringed-circle", { width: 24, height: 24 }],
  ["Terminate", "terminate", "cross", { width: 20, height: 20 }],
  ["Choice", "choice", "diamond", { width: 32, height: 32 }],
  ["Junction", "junction", "circle", { width: 14, height: 14 }],
  ["Fork", "fork", "bar", { width: 120, height: 8 }],
  ["Join", "join", "bar", { width: 120, height: 8 }],
  ["Shallow history", "shallow-history", "ellipse"],
  ["Deep history", "deep-history", "ellipse"],
  ["Entry point", "entry-point", "ellipse", { width: 16, height: 16 }],
  ["Exit point", "exit-point", "crossed-circle", { width: 16, height: 16 }],
  ["Entry connection point reference", "entry-reference", "ellipse", { width: 16, height: 16 }],
  [
    "Exit connection point reference",
    "exit-reference",
    "crossed-circle",
    { width: 16, height: 16 },
  ],
  ["Send signal", "send-signal", "pentagon"],
  ["Receive signal", "receive-signal", "notched-rectangle"],
  ["Comment", "comment", "note"],
  ["State machine frame", "frame", "frame"],
];

/** The title each kind the palette drops shows, a name of its kind, or a history's letter; a
 *  pseudostate, a point, whose name stands beside it, and a comment, of body text, show none. */
const TITLES: Record<string, string> = {
  state: "NewState",
  composite: "NewComposite",
  submachine: "NewSubmachine : Machine",
  "state-list": "A, B",
  "shallow-history": "H",
  "deep-history": "H*",
  "send-signal": "Signal",
  "receive-signal": "Signal",
  frame: "stm NewMachine",
};

/** The kinds that ride a border, and the node each is dropped on, at the world point nearest a
 *  side of it: an entry and an exit point on Live's right side, a connection point reference on
 *  the bottom of the submachine state Rendering. */
const BORDER: Record<string, { on: string; at: [number, number]; side: string }> = {
  "entry-point": { on: "live", at: [1150, 700], side: "right" },
  "exit-point": { on: "live", at: [1150, 700], side: "right" },
  "entry-reference": { on: "rendering", at: [900, 798], side: "bottom" },
  "exit-reference": { on: "rendering", at: [900, 798], side: "bottom" },
};

test("a choice dropped from the palette is a diamond centred under the pointer", async ({
  page,
}) => {
  // Verifies: G-12, G-1
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await expect(page.locator("#palette li:visible")).toHaveText(PALETTE.map(([name]) => name));
  await dropAt(page, "choice");
  const added = (await state(page)).graph.nodes.at(-1)!;
  expect(added.id).toBe("choice-1");
  const node = (await drawn(page, added.id))!;
  expect(node.shape).toBe("diamond");
  const centre = await pagePoint(page, node.x + node.width / 2, node.y + node.height / 2);
  const box = (await page.locator("#canvas canvas").boundingBox())!;
  expect(centre.x - box.x).toBeCloseTo(400, 0);
  expect(centre.y - box.y).toBeCloseTo(500, 0);
});

/** Expects point `id`, centred at `centre`, dropped at the world point `at`, to ride `border.on` on
 *  `border.side` at the drop's offset along it, centred on that side, with its name beside it, a
 *  border node of the same node without an outline. */
async function expectOnBorder(
  page: Page,
  id: string,
  centre: { x: number; y: number },
  border: (typeof BORDER)[string],
  [x, y]: [number, number],
): Promise<void> {
  const owner = (await drawnNode(page, border.on))!;
  const data = (await dataOf(page, id))!;
  expect(data).toMatchObject({ id, attachedTo: border.on, side: border.side });
  const right = border.side === "right";
  expect(data.offset).toBeCloseTo(right ? y - owner.y : x - owner.x, 3);
  expect(right ? centre.x : centre.y).toBeCloseTo(
    right ? owner.x + owner.width : owner.y + owner.height,
    3,
  );
  expect(right ? centre.y : centre.x).toBeCloseTo(right ? y : x, 3);
  const name = (await drawn(page, `${id}-name`))!;
  expect({ id, outlined: name.outlined }).toEqual({ id, outlined: "none" });
  expect((await dataOf(page, `${id}-name`))?.attachedTo).toBe(border.on);
}

for (const [name, kind, shape, size] of PALETTE)
  test(`the palette adds a ${name.toLowerCase()} where it was dropped${size ? ", as small as its node shape allows" : ""}`, async ({
    page,
  }) => {
    // Verifies: G-20, G-12, G-1, ARCH-border-nodes-ride-sides
    await page.goto("/");
    await open(page);
    await choose(page, "state");
    const border = BORDER[kind];
    // Into the frame of the state machine, right of Destroying and below Suspended, where nothing
    // lies; a point on the border of the node it rides.
    const [x, y] = border?.at ?? [1350, 1300];
    await dropAtWorld(page, kind, x, y);
    const id = `${kind}-1`;
    const node = (await drawn(page, id))!;
    expect(node.shape).toBe(shape);
    expect(node.title).toBe(TITLES[kind]);
    if (size) expect({ width: node.width, height: node.height }).toEqual(size);
    // History is round, as high as its letter makes it.
    if (kind.endsWith("history")) expect(node.height).toBe(node.width);
    const centre = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    if (border) await expectOnBorder(page, id, centre, border, [x, y]);
    else {
      expect(Math.hypot(centre.x - x, centre.y - y)).toBeLessThan(0.01);
      expect((await dataOf(page, id))?.container).toBe("machine");
    }
  });

test("a state dropped into a region lies in it, and a point dropped where no node holds it is not added", async ({
  page,
}) => {
  // Verifies: G-20, G-1
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await dropAtWorld(page, "state", 450, 870);
  expect(await dataOf(page, "state-1")).toMatchObject({
    container: "live-region-1",
  });
  const before = await state(page);
  await dropAtWorld(page, "entry-point", 1800, 100);
  expect(await state(page)).toEqual(before);
});

test("the sidebar edits a state's name and behaviours, and offers nothing for a pseudostate", async ({
  page,
}) => {
  // Verifies: G-20, G-12, G-5
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await showNear(page, "ready");
  await clickNode(page, "ready");
  await expect(page.locator("#name")).toHaveValue("Ready");
  await expect(page.locator("#internal")).toHaveValue("select / show it");
  for (const field of ["#stereotype", "#attributes", "#operations", "#machine", "#lines"])
    await expect(page.locator(field)).toBeHidden();
  await page.locator("#name").fill("Waiting");
  await page.locator("#entry").fill("show the canvas");
  await page.locator("#do-activity").fill("listen");
  await page.locator("#exit").fill("hide the hints");
  await page.locator("#deferred").fill("load");
  const rows = (await drawn(page, "ready"))!.content!.map((row) =>
    row === "separator" ? row : row.map((each) => ("text" in each ? each.text : "")).join(""),
  );
  expect(rows).toEqual([
    "Waiting",
    "separator",
    "entry / show the canvas",
    "do / listen",
    "exit / hide the hints",
    "select / show it",
    "load / defer",
  ]);
  // Emptied, the compartment goes, and its separator with it.
  for (const field of ["#entry", "#do-activity", "#exit", "#internal", "#deferred"])
    await page.locator(field).fill("");
  expect((await drawn(page, "ready"))!.content).toMatchObject([
    [{ kind: "text", role: "title", text: "Waiting" }],
  ]);
  expect((await drawn(page, "ready"))!.content).toHaveLength(1);
  await showNear(page, "loaded");
  await clickNode(page, "loaded");
  await expect(page.locator("#node-form")).toBeHidden();
  await expect(page.locator("#edge-form")).toBeHidden();
});

test("the sidebar edits a submachine state's state machine, a comment's lines, and the name of a point or a signal", async ({
  page,
}) => {
  // Verifies: G-20, G-5
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  /** The texts of node `id`, one per row. */
  const textsOf = async (id: string) =>
    (await drawn(page, id))!.content!.map((row) =>
      row === "separator" ? row : row.map((each) => ("text" in each ? each.text : "")).join(""),
    );
  await showNear(page, "rendering");
  await clickNode(page, "rendering");
  await expect(page.locator("#machine")).toHaveValue("DrawFrame");
  await expect(page.locator("#entry")).toBeHidden();
  await page.locator("#machine").fill("Paint");
  expect(await textsOf("rendering")).toEqual(["Rendering : Paint"]);
  await showNear(page, "waits");
  await clickNode(page, "waits");
  await expect(page.locator("#name")).toBeHidden();
  await expect(page.locator("#lines")).toHaveValue("An edit before the\nengine loads waits.");
  await page.locator("#lines").fill("Edits wait\nfor the engine.");
  expect(await textsOf("waits")).toEqual(["Edits wait", "for the engine."]);
  await showNear(page, "load");
  await clickNode(page, "load");
  await page.locator("#name").fill("start");
  expect(await textsOf("load")).toEqual(["start"]);
  // A point's name stands in the node beside it.
  await showNear(page, "resume");
  await clickNode(page, "resume");
  await expect(page.locator("#name")).toHaveValue("resume");
  await page.locator("#name").fill("wake");
  expect(await textsOf("resume-name")).toEqual(["wake"]);
  expect(await textsOf("resume")).toEqual([]);
  // A longer name widens its node, which draws the whole of it, on the side it stood.
  await page.locator("#name").fill("wake up the canvas now");
  await showNear(page, "resume");
  const texts = await page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    const node = window.uml.inspect().nodes.find(({ id }) => id === "resume-name");
    return node?.texts?.map(({ drawn: text }) => text);
  });
  expect(texts).toEqual(["wake up the canvas now"]);
  expect(await dataOf(page, "resume-name")).toMatchObject({ attachedTo: "live", side: "right" });
});

test("a point on a top side renamed to a longer name keeps its name beside it, clear of the point", async ({
  page,
}) => {
  // Verifies: G-20, ARCH-border-nodes-ride-sides
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await showNear(page, "lost-exit");
  await clickNode(page, "lost-exit");
  await expect(page.locator("#name")).toHaveValue("lost");
  await page.locator("#name").fill("lost the WebGL engine");
  await overview(page);
  const [point, name] = [
    (await drawnNode(page, "lost-exit"))!,
    (await drawnNode(page, "lost-exit-name"))!,
  ];
  expect(await dataOf(page, "lost-exit-name")).toMatchObject({ attachedTo: "live", side: "top" });
  // Beside the point along the side, before it where no room is left after it, never over it.
  const clear = name.x + name.width <= point.x || name.x >= point.x + point.width;
  expect(clear).toBe(true);
});

test("a point dropped near the end of a side has its name on the side of it with room", async ({
  page,
}) => {
  // Verifies: G-20, ARCH-border-nodes-ride-sides
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await overview(page);
  const live = (await drawnNode(page, "live"))!;
  // Near the bottom end of Live's right side, where no name fits below the point.
  await dropAtWorld(page, "entry-point", live.x + live.width - 10, live.y + live.height - 12);
  const [point, name] = [
    (await dataOf(page, "entry-point-1"))!,
    (await dataOf(page, "entry-point-1-name"))!,
  ];
  expect(name.offset!).toBeLessThan(point.offset!);
  const [a, b] = [
    (await drawnNode(page, "entry-point-1"))!,
    (await drawnNode(page, "entry-point-1-name"))!,
  ];
  const apart = a.y + a.height <= b.y || b.y + b.height <= a.y;
  expect(apart).toBe(true);
});

test("a connection of two states adds a transition docked on the outline, whose trigger the sidebar names", async ({
  page,
}) => {
  // Verifies: G-12, G-3
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await showNear(page, "created", 0.8);
  const [from, to] = [(await drawnNode(page, "created"))!, (await drawnNode(page, "rendering"))!];
  // From created's right connector onto rendering's left one, which lies below and to the right.
  await connect(
    page,
    [from.x + from.width, from.y + from.height / 2],
    [to.x, to.y + to.height / 2],
  );
  const { graph, kinds } = await state(page);
  const added = graph.edges.find(
    ({ source, target }) => source === "created" && target === "rendering",
  )!;
  expect(kinds[added.id]).toBe("transition");
  expect(added).toMatchObject({
    sourceSide: "outline",
    targetSide: "outline",
    color: 0x6b7280,
    arrow: "open",
  });
  expect(added.labels).toBeUndefined();
  // Drawn from where the line between the two centres leaves created's bottom, not from its
  // right connector.
  const ends = await page.evaluate(async (id) => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edges.find((edge) => edge.id === id)!;
  }, added.id);
  const [c, o] = [
    { x: from.x + from.width / 2, y: from.y + from.height / 2 },
    { x: to.x + to.width / 2, y: to.y + to.height / 2 },
  ];
  const bottom = from.y + from.height;
  expect(ends.source.y).toBeCloseTo(bottom, 1);
  expect(ends.source.x).toBeCloseTo(c.x + ((bottom - c.y) * (o.x - c.x)) / (o.y - c.y), 1);
  // Selected on its path, the sidebar offers its trigger, guard, and effect, and no kind.
  await clickWorld(page, (ends.source.x + ends.target.x) / 2, (ends.source.y + ends.target.y) / 2);
  await expect(page.locator("#trigger")).toHaveValue("");
  await expect(page.locator("#kind")).toBeHidden();
  await expect(page.locator("#label")).toBeHidden();
  await page.locator("#trigger").fill("redraw");
  const label = await page.evaluate(async (id) => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edgeLabels.find(({ edge }) => edge === id);
  }, added.id);
  expect(label?.text).toBe("redraw");
  const edge = (await state(page)).graph.edges.find(({ id }) => id === added.id)!;
  expect(edge.labels).toMatchObject([{ id: "kind", text: "redraw", background: 0x6b7280 }]);
});

test("a selected transition leaves the hidden kind select on a kind it offers", async ({
  page,
}) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await showNear(page, "loading");
  const ends = await page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edges.find((edge) => edge.id === "loading-loaded")!;
  });
  // On its path a fifth of the way, clear of its label in the middle.
  const along = (from: number, to: number) => from + (to - from) / 5;
  await clickWorld(page, along(ends.source.x, ends.target.x), along(ends.source.y, ends.target.y));
  await expect(page.locator("#trigger")).toHaveValue("settled");
  const select = await page.locator("#kind").evaluate((kind: HTMLSelectElement) => ({
    value: kind.value,
    offered: [...kind.options].map(({ value }) => value),
  }));
  expect(select.offered).toContain(select.value);
});

test("a connection dragged from a state back onto it adds a loop on the side it left", async ({
  page,
}) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await showNear(page, "loading");
  const node = (await drawnNode(page, "loading"))!;
  await connect(
    page,
    [node.x + node.width, node.y + node.height / 2],
    [node.x + node.width / 2, node.y + node.height],
  );
  const { graph, kinds } = await state(page);
  const loop = graph.edges.find(
    ({ source, target }) => source === "loading" && target === "loading",
  )!;
  expect(loop).toMatchObject({ sourceSide: "right", targetSide: "right" });
  expect(kinds[loop.id]).toBe("transition");
  const ends = await page.evaluate(async (id) => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edges.find((edge) => edge.id === id)!;
  }, loop.id);
  // It leaves and re-enters the right side, a quarter of its length either side of its middle.
  expect(ends.source.x).toBeCloseTo(node.x + node.width, 3);
  expect(ends.target.x).toBeCloseTo(node.x + node.width, 3);
  expect(Math.abs(ends.source.y - ends.target.y)).toBeCloseTo(node.height / 2, 3);
});

test("no loop is added on a choice, which is no state", async ({ page }) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await showNear(page, "loaded");
  const before = await state(page);
  const node = (await drawnNode(page, "loaded"))!;
  await connect(
    page,
    [node.x + node.width, node.y + node.height / 2],
    [node.x + node.width / 2, node.y + node.height],
  );
  expect(await state(page)).toEqual(before);
});

test("Delete removes the selected state with its transitions", async ({ page }) => {
  // Verifies: G-12, G-4
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await showNear(page, "lost");
  await clickNode(page, "lost");
  await expect(page.locator("#name")).toHaveValue("Engine lost");
  await page.keyboard.press("Delete");
  const { graph } = await state(page);
  expect(graph.nodes.map(({ id }) => id)).not.toContain("lost");
  expect(
    graph.edges.filter(({ source, target }) => source === "lost" || target === "lost"),
  ).toEqual([]);
  await expect(page.locator("#count")).toHaveText("37 elements, 30 edges");
});

/** Drags a connection from the world point `from`, a connector, to the world point `to`, another,
 *  with both in view at scale 0.6, the near level. */
async function connectWorld(page: Page, from: [number, number], to: [number, number]) {
  const scale = 0.6;
  const [mx, my] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  await setViewport(page, { x: 640 - mx * scale, y: 360 - my * scale, scale });
  await connect(page, from, to);
}

/** The connector at the middle of `side` of node `id`, in world units. */
async function connectorOf(
  page: Page,
  id: string,
  side: "left" | "right",
): Promise<[number, number]> {
  await overview(page);
  const node = (await drawnNode(page, id))!;
  return [side === "left" ? node.x : node.x + node.width, node.y + node.height / 2];
}

/** Pairs of the table of refusals the user connects, each its source and its target, the sides of
 *  their connectors, and why the sidebar says it is refused, written here from
 *  docs/CONVENTIONS.md; and a pair it allows. */
const CONNECTIONS: [string, "left" | "right", string, "left" | "right", string | null][] = [
  [
    "created",
    "right",
    "waits",
    "left",
    "A comment is attached by its anchor; no transition starts or ends on it.",
  ],
  [
    "refused",
    "right",
    "refusal",
    "right",
    "UML 2.5.1 lets no transition leave a final state (no_outgoing_transitions).",
  ],
  [
    "fork",
    "right",
    "join",
    "right",
    "UML 2.5.1 lets a fork's transitions enter states only (fork_segment_state).",
  ],
  [
    "loaded",
    "right",
    "load",
    "right",
    "UML 2.5.1 gives a transition out of a pseudostate no trigger, and a receive signal is one (outgoing_pseudostates).",
  ],
  [
    "terminate",
    "right",
    "lost",
    "right",
    "A terminate pseudostate ends the state machine; no transition leaves it.",
  ],
  ["suspended", "left", "lost", "right", null],
];

test("a connection the table of refusals holds is refused and the sidebar says why; another pair connects", async ({
  page,
}) => {
  // Verifies: G-20, G-3
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  for (const [source, from, target, to, why] of CONNECTIONS) {
    const before = await state(page);
    await connectWorld(
      page,
      await connectorOf(page, source, from),
      await connectorOf(page, target, to),
    );
    const after = await state(page);
    if (why === null) {
      const added = after.graph.edges.filter(
        (edge) => "source" in edge && edge.source === source && edge.target === target,
      );
      expect({ source, target, added: added.length }).toEqual({ source, target, added: 1 });
      expect(after.kinds[added[0]!.id]).toBe("transition");
      await expect(page.locator("#connection-refusal")).toBeHidden();
    } else {
      expect({ source, target, after }).toEqual({ source, target, after: before });
      await expect(page.locator("#connection-refusal")).toHaveText(why);
      await expect(page.locator("#connection-refusal")).toBeVisible();
    }
  }
});

/** Selects edge `id` with a click on its path a fifth of the way, clear of its label in the
 *  middle, node `near` shown near at scale 0.8. */
async function selectEdge(page: Page, id: string, near: string): Promise<void> {
  await showNear(page, near, 0.8);
  const ends = await page.evaluate(async (wanted) => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edges.find((edge) => edge.id === wanted)!;
  }, id);
  const along = (from: number, to: number) => from + (to - from) / 5;
  await clickWorld(page, along(ends.source.x, ends.target.x), along(ends.source.y, ends.target.y));
}

test("a connection from a comment to a state adds a dashed anchor without an arrowhead, which has nothing to edit", async ({
  page,
}) => {
  // Verifies: G-20, G-3
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await connectWorld(
    page,
    await connectorOf(page, "waits", "left"),
    await connectorOf(page, "created", "right"),
  );
  const { graph, kinds } = await state(page);
  const added = graph.edges.filter(
    (edge) => "source" in edge && edge.source === "waits" && edge.target === "created",
  );
  expect(added).toHaveLength(1);
  const anchor = added[0]!;
  expect(kinds[anchor.id]).toBe("anchor");
  expect(anchor).toMatchObject({
    sourceSide: "outline",
    targetSide: "outline",
    color: 0x6b7280,
    dash: [6, 4],
    arrow: "none",
  });
  expect(anchor.labels).toBeUndefined();
  await expect(page.locator("#connection-refusal")).toBeHidden();
  // Selected, it offers nothing to edit.
  const ends = await page.evaluate(async (id) => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edges.find((edge) => edge.id === id)!;
  }, anchor.id);
  await clickWorld(page, (ends.source.x + ends.target.x) / 2, (ends.source.y + ends.target.y) / 2);
  await expect(page.locator("#edge-form")).toBeHidden();
  await expect(page.locator("#empty")).toBeVisible();
});

test("a selected transition's trigger, guard, and effect, edited in the sidebar, show in its label", async ({
  page,
}) => {
  // Verifies: G-20, G-5
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await selectEdge(page, "loading-junction", "loading");
  await expect(page.locator("#edge-heading")).toHaveText("Selected transition");
  await expect(page.locator("#trigger")).toHaveValue("trap");
  await expect(page.locator("#guard")).toHaveValue("");
  await expect(page.locator("#effect")).toHaveValue("");
  /** The label the canvas draws on the transition. */
  const label = () =>
    page.evaluate(async () => {
      await window.uml.comb.whenRendered();
      return window.uml.inspect().edgeLabels.find(({ edge }) => edge === "loading-junction")?.text;
    });
  await page.locator("#effect").fill("lose the engine");
  expect(await label()).toBe("trap / lose the engine");
  await page.locator("#guard").fill("trapped");
  expect(await label()).toBe("trap [trapped] / lose the engine");
  await page.locator("#trigger").fill("");
  expect(await label()).toBe("[trapped] / lose the engine");
  // Each part emptied, the transition carries no label.
  for (const field of ["#guard", "#effect"]) await page.locator(field).fill("");
  expect(await label()).toBeUndefined();
  const edge = (await state(page)).graph.edges.find(({ id }) => id === "loading-junction")!;
  expect(edge.labels).toBeUndefined();
});

test("the sidebar offers no trigger out of a pseudostate, and neither trigger nor guard out of an initial pseudostate or on a fork's or a join's segment", async ({
  page,
}) => {
  // Verifies: G-20
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  // Out of a choice: a guard and an effect (UML 2.5.1, outgoing_pseudostates).
  await selectEdge(page, "loaded-live", "loading");
  await expect(page.locator("#guard")).toHaveValue("loaded");
  await expect(page.locator("#trigger")).toBeHidden();
  await expect(page.locator("#guard")).toBeVisible();
  await expect(page.locator("#effect")).toBeVisible();
  // An initial pseudostate's transition, a fork's segment, and a join's: an effect alone
  // (outgoing_from_initial, fork_segment_guards, join_segment_guards).
  for (const [id, near] of [
    ["graph-initial-ready", "graph-initial"],
    ["fork-textures", "fork"],
    ["textures-join", "textures"],
  ] as const) {
    await selectEdge(page, id, near);
    await expect(page.locator("#edge-heading")).toHaveText("Selected transition");
    await expect(page.locator("#trigger")).toBeHidden();
    await expect(page.locator("#guard")).toBeHidden();
    await expect(page.locator("#effect")).toBeVisible();
  }
  // Out of a state, every part.
  await selectEdge(page, "loading-junction", "loading");
  for (const field of ["#trigger", "#guard", "#effect"])
    await expect(page.locator(field)).toBeVisible();
});

test("Delete removes a selected point with its name, and keeps a name selected alone", async ({
  page,
}) => {
  // Verifies: G-20, G-4
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await showNear(page, "lost-exit-name");
  await clickNode(page, "lost-exit-name");
  await page.keyboard.press("Delete");
  expect((await state(page)).graph.nodes.map(({ id }) => id)).toContain("lost-exit-name");
  await showNear(page, "lost-exit");
  await clickNode(page, "lost-exit");
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => (await state(page)).graph.nodes.map(({ id }) => id))
    .not.toContain("lost-exit-name");
  expect((await state(page)).graph.nodes.map(({ id }) => id)).not.toContain("lost-exit");
});

/** Drags node `id` by its middle so that its middle lands on the world point (`x`, `y`), the whole
 *  diagram in view. */
async function dragNodeTo(page: Page, id: string, x: number, y: number): Promise<void> {
  await overview(page);
  const node = (await drawnNode(page, id))!;
  const from = await pagePoint(page, node.x + node.width / 2, node.y + node.height / 2);
  const to = await pagePoint(page, x, y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test("a node dragged out of the frame and into a region lies there in the example's copy, as Comb tells", async ({
  page,
}) => {
  // Verifies: G-20, G-14
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  /** Node `id` of the example's copy, and as the canvas draws it. */
  const both = async (id: string) => ({
    data: (await dataOf(page, id))!,
    drawn: (await drawnNode(page, id))!,
  });
  // Out of the frame, onto the canvas: no container, its place in the world.
  await dragNodeTo(page, "suspended", 1800, 900);
  let { data, drawn: at } = await both("suspended");
  expect(data.container).toBeUndefined();
  expect(data.x).toBeCloseTo(at.x, 3);
  expect(data.y).toBeCloseTo(at.y, 3);
  // Into the first region of Live: that region, its place relative to the region's top left.
  await dragNodeTo(page, "suspended", 470, 880);
  ({ data, drawn: at } = await both("suspended"));
  const region = (await drawnNode(page, "live-region-1"))!;
  expect(data.container).toBe("live-region-1");
  expect(data.x).toBeCloseTo(at.x - region.x, 3);
  expect(data.y).toBeCloseTo(at.y - region.y, 3);
});

test("edits on all three diagrams are kept as the user switches between them", async ({ page }) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  await dropAt(page, "class");
  const classDiagram = await state(page);
  await choose(page, "package");
  await dropAt(page, "package");
  const packageDiagram = await state(page);
  await choose(page, "state");
  await dropAt(page, "state");
  const stateDiagram = await state(page);
  expect(stateDiagram.graph.nodes.map(({ id }) => id)).toContain("state-1");
  for (const [diagram, expected] of [
    ["class", classDiagram],
    ["state", stateDiagram],
    ["package", packageDiagram],
    ["class", classDiagram],
    ["state", stateDiagram],
  ] as const) {
    await choose(page, diagram);
    expect({ diagram, ...(await state(page)) }).toEqual({ diagram, ...expected });
  }
  // The state dropped is still a state the sidebar renames.
  await clickNode(page, "state-1");
  await expect(page.locator("#name")).toHaveValue("NewState");
});

test("a drop is the example's own only once Comb took its node, and not at all where Comb refuses it", async ({
  page,
}) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  // Comb's addNode, wrapped to note whether the example's copy holds the node it is handed
  // already, and to refuse the first node it is handed.
  await page.evaluate(() => {
    const { comb } = window.uml;
    const addNode = comb.addNode.bind(comb);
    const noted = { held: [] as boolean[], refuse: true };
    Object.assign(window, { noted });
    comb.addNode = (node) => {
      noted.held.push(node.id in window.uml.nodeKinds());
      if (noted.refuse) {
        noted.refuse = false;
        throw new Error("refused");
      }
      addNode(node);
    };
  });
  for (const [diagram, kind] of [
    ["class", "class"],
    ["package", "package"],
    ["state", "choice"],
  ] as const) {
    await choose(page, diagram);
    const before = await state(page);
    await dropAt(page, kind);
    const refused = await page.evaluate(() => window.uml.nodeKinds());
    expect({ diagram, refused: `${kind}-1` in refused }).toEqual({ diagram, refused: false });
    expect(await state(page)).toEqual(before);
    await dropAt(page, kind);
    const kinds = await page.evaluate(() => window.uml.nodeKinds());
    expect({ diagram, kind: kinds[`${kind}-2`] }).toEqual({ diagram, kind });
    const held = await page.evaluate(() => {
      const { noted } = window as unknown as { noted: { held: boolean[]; refuse: boolean } };
      const seen = [...noted.held];
      Object.assign(noted, { held: [], refuse: true });
      return seen;
    });
    expect({ diagram, held }).toEqual({ diagram, held: [false, false] });
  }
});
