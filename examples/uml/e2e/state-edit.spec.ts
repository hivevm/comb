// Browser tests of editing the UML example's state diagram (G-12): the palette's state, initial
// state, final state, and choice, each in its node shape; the sidebar's name of a state and event
// of a transition; a connection that adds a transition docked on the outline (ADR-0031), a drag
// back onto a state that adds a loop, Delete, and the edits each of the three diagrams keeps.
import { expect, test, type Page } from "@playwright/test";
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

/** Shows node `id` near, its top-left corner at (100, 100) on the canvas, at `scale`. */
async function showNear(page: Page, id: string, scale = 1): Promise<void> {
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

/** The node shape each kind the palette drops is drawn in, written here from docs/CONVENTIONS.md
 *  rather than read from the example. */
const SHAPES = {
  state: "rounded-rectangle",
  initial: "circle",
  final: "ringed-circle",
  choice: "diamond",
};

test("a choice dropped from the palette is a diamond centred under the pointer", async ({
  page,
}) => {
  // Verifies: G-12, G-1
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await expect(page.locator("#palette li:visible")).toHaveText([
    "State",
    "Initial state",
    "Final state",
    "Choice",
  ]);
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

test("the palette drops a state, an initial state, and a final state, each in its node shape", async ({
  page,
}) => {
  // Verifies: G-12, G-1
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  for (const [kind, shape] of Object.entries(SHAPES)) {
    await dropAt(page, kind);
    const node = (await drawn(page, `${kind}-1`))!;
    expect({ kind, shape: node.shape }).toEqual({ kind, shape });
    expect({ kind, title: node.title }).toEqual({
      kind,
      title: kind === "state" ? "NewState" : undefined,
    });
  }
});

test("the sidebar renames a selected state, and offers nothing for a pseudostate", async ({
  page,
}) => {
  // Verifies: G-12, G-5
  await page.goto("/");
  await open(page);
  await choose(page, "state");
  await showNear(page, "ready");
  await clickNode(page, "ready");
  await expect(page.locator("#name")).toHaveValue("Ready");
  for (const field of ["#stereotype", "#attributes", "#operations"])
    await expect(page.locator(field)).toBeHidden();
  await page.locator("#name").fill("Idle");
  expect((await drawn(page, "ready"))!.title).toBe("Idle");
  await showNear(page, "loaded");
  await clickNode(page, "loaded");
  await expect(page.locator("#node-form")).toBeHidden();
  await expect(page.locator("#edge-form")).toBeHidden();
});

test("a connection of two states adds a transition docked on the outline, whose event the sidebar names", async ({
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
    arrow: "end",
  });
  expect(added.label).toBeUndefined();
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
  // Selected on its path, the sidebar offers its event and no kind.
  await clickWorld(page, (ends.source.x + ends.target.x) / 2, (ends.source.y + ends.target.y) / 2);
  await expect(page.locator("#event")).toHaveValue("");
  await expect(page.locator("#kind")).toBeHidden();
  await expect(page.locator("#label")).toBeHidden();
  await page.locator("#event").fill("redraw");
  const label = await page.evaluate(async (id) => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edgeLabels.find(({ edge }) => edge === id);
  }, added.id);
  expect(label?.text).toBe("redraw");
  const edge = (await state(page)).graph.edges.find(({ id }) => id === added.id)!;
  expect(edge.label).toMatchObject({ text: "redraw", background: 0x6b7280 });
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
  await expect(page.locator("#count")).toHaveText("9 states, 10 transitions");
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
