// Browser tests of the UML example's use case diagram (G-20): the developer, the user, and the host
// application as actors outside the subject Comb, which holds the use cases of G-1 to G-17
// (API-edits-report-nested-changes); a use case's extension points below a separator
// (REN-node-shapes-cover-uml); associations with a multiplicity at each end, include and extend
// dashed with an open arrowhead and their keyword, an extend's condition a comment anchored on it
// (API-edges-dock-nodes-or-edges), and generalizations ending in a hollow triangle; the palette,
// the example's veto of an actor moved into the subject, the table of refusals, and the sidebar.
import { expect, test, type Page } from "@playwright/test";
import type { GraphChange, NodeData } from "comb";
import { clickWorld, drawnNode, open, pagePoint, setViewport } from "./shared";

/** Each element of the diagram, by the identifier of its node: its node shape, the subject it lies
 *  in, and the content it shows, a separator as "separator", written here from the ticket's
 *  description and its settled building blocks rather than read from the example. */
type Element = { shape: string; in?: string; content: readonly (readonly string[])[] };

const actor = (name: string): Element => ({ shape: "actor", content: [[name]] });
const useCase = (name: string, ...points: string[]): Element => ({
  shape: "ellipse",
  in: "comb",
  content: [
    [name],
    ...(points.length === 0
      ? []
      : [["separator"], ["extension points"], ...points.map((p) => [p])]),
  ],
});

const ELEMENTS: Record<string, Element> = {
  user: actor("User"),
  developer: actor("Developer"),
  host: actor("Host application"),
  comb: { shape: "rectangle", content: [["Comb"]] },
  "add-node": useCase("Add a node"),
  "drag-node": useCase("Drag a node"),
  connect: useCase("Connect two nodes"),
  delete: useCase("Delete the selection"),
  select: useCase("Select a node or an edge", "Delete pressed"),
  "drag-label": useCase("Drag an edge label"),
  "draw-in-view": useCase("Draw what is in view"),
  "pan-zoom": useCase("Pan and zoom"),
  "run-metric-tree": useCase("Run the metric tree example"),
  "describe-content": useCase("Describe a node's content"),
  "style-edge": useCase("Style an edge"),
  "run-uml": useCase("Run the UML example"),
  "shape-node": useCase("Shape a node"),
  "drop-in-container": useCase("Drop a node in a container"),
  resize: useCase("Resize a node"),
  divide: useCase("Divide a node into regions"),
  "attach-border-node": useCase("Attach a border node"),
  "delete-condition": {
    shape: "note",
    in: "comb",
    content: [["Condition: {Delete pressed}"], ["extension point: Delete pressed"]],
  },
};

/** The relationships of the diagram, each its source, its target, and its kind: an actor's
 *  associations, the includes, the extend, and the generalizations. */
const RELATIONSHIPS: [string, string, string][] = [
  ...["drag-node", "connect", "select", "drag-label", "pan-zoom", "resize"].map(
    (target) => ["user", target, "association"] as [string, string, string],
  ),
  ["developer", "run-metric-tree", "association"],
  ["developer", "run-uml", "association"],
  ...["add-node", "style-edge", "shape-node", "divide", "attach-border-node"].map(
    (target) => ["host", target, "association"] as [string, string, string],
  ),
  ["add-node", "describe-content", "include"],
  ["pan-zoom", "draw-in-view", "include"],
  ["delete", "select", "extend"],
  ["drop-in-container", "drag-node", "use-case-generalization"],
  ["developer", "user", "use-case-generalization"],
];

/** Chooses the use case diagram in the sidebar and waits until its load has drawn. */
async function chooseUseCase(page: Page): Promise<void> {
  await page.locator("#diagram").selectOption("use-case");
  await page.evaluate(() => window.uml.loadReport);
}

/** Shows the whole of the diagram, so that each node is drawn and its place read. */
async function overview(page: Page): Promise<void> {
  await setViewport(page, { x: 20, y: 20, scale: 0.45 });
}

/** Node or region `id` as the canvas draws it, the whole diagram in view. */
async function boxOf(page: Page, id: string) {
  await overview(page);
  return (await drawnNode(page, id))!;
}

/** The example's copy of the graph and the kind of each edge. */
async function state(page: Page) {
  return page.evaluate(() => ({
    graph: window.uml.exampleGraph(),
    kinds: window.uml.edgeKinds(),
  }));
}

/** Node `id` of the example's copy. */
async function dataOf(page: Page, id: string): Promise<NodeData | undefined> {
  return page.evaluate(
    (wanted) => window.uml.exampleGraph().nodes.find((node) => node.id === wanted),
    id,
  );
}

/** Whether `box` lies within `outer`, to a hundredth of a world unit. */
const within = (
  box: { x: number; y: number; width: number; height: number },
  outer: { x: number; y: number; width: number; height: number },
) =>
  box.x >= outer.x - 0.01 &&
  box.y >= outer.y - 0.01 &&
  box.x + box.width <= outer.x + outer.width + 0.01 &&
  box.y + box.height <= outer.y + outer.height + 0.01;

/** Whether `a` and `b` overlap. */
const overlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A node as the canvas draws it, by `inspect`. */
type Drawn = ReturnType<typeof window.uml.inspect>["nodes"][number];

/** Every node the canvas draws at the near level, in four views that cover the diagram, each with
 *  the texts its view draws, and every edge label drawn. */
async function drawnNear(page: Page) {
  const scenes = await page.evaluate(async () => {
    const views: [number, number][] = [
      [20, 20],
      [20, -660],
      [-600, 20],
      [-600, -660],
    ];
    const seen = [];
    for (const [x, y] of views) {
      window.uml.comb.setViewport({ x, y, scale: 0.6 });
      await window.uml.comb.whenRendered();
      const { nodes, edgeLabels } = window.uml.inspect();
      seen.push({ nodes, labels: edgeLabels.map(({ edge, text }) => ({ edge, text })) });
    }
    return seen;
  });
  // A node drawn in several views counts in the one that draws the most of its texts.
  const nodes: Record<string, Drawn> = {};
  for (const node of scenes.flatMap((scene) => scene.nodes))
    if ((node.texts?.length ?? 0) >= (nodes[node.id]?.texts?.length ?? 0)) nodes[node.id] = node;
  const labels = new Map(
    scenes.flatMap((scene) => scene.labels).map((label) => [`${label.edge} ${label.text}`, label]),
  );
  return { nodes, labels: [...labels.values()] };
}

/** Expects node `id`, drawn as `node`, as `element` says: in its node shape, showing its content,
 *  each text drawn whole, and in the subject `element` names, which the copy `data` names as its
 *  container. */
function expectShown(id: string, element: Element, node: Drawn, data: NodeData | undefined) {
  expect({ id, shape: node.shape }).toEqual({ id, shape: element.shape });
  const texts = (node.content ?? []).map((row) =>
    row === "separator" ? [row] : row.map((each) => ("text" in each ? each.text : each.kind)),
  );
  expect({ id, texts }).toEqual({ id, texts: element.content });
  // Each text is drawn whole, none cut short to fit its node.
  const shown = element.content.flat().filter((text) => text !== "separator");
  expect({ id, drawn: (node.texts ?? []).map((text) => text.drawn) }).toEqual({ id, drawn: shown });
  expect({ id, container: data?.container }).toEqual({ id, container: element.in });
}

test("the use case diagram shows its actors outside the subject, and the use cases of G-1 to G-17 in it, with their extension points", async ({
  page,
}) => {
  // Verifies: G-20, REN-node-shapes-cover-uml
  await page.goto("/");
  await open(page);
  await chooseUseCase(page);
  await expect(page.locator("#count")).toHaveText("22 elements, 19 edges");
  await expect(page.locator("#legend")).toBeHidden();
  const { nodes } = await drawnNear(page);
  const data = new Map((await state(page)).graph.nodes.map((node) => [node.id, node]));
  expect(Object.keys(nodes).sort()).toEqual(Object.keys(ELEMENTS).sort());
  for (const [id, element] of Object.entries(ELEMENTS)) {
    expectShown(id, element, nodes[id]!, data.get(id));
    if (element.in)
      expect({ id, inside: within(nodes[id]!, nodes[element.in]!) }).toEqual({ id, inside: true });
  }
  // The actors stand outside the subject, and no two elements in it overlap.
  for (const id of ["user", "developer", "host"])
    expect({ id, outside: overlap(nodes[id]!, nodes.comb!) }).toEqual({ id, outside: false });
  const held = Object.keys(ELEMENTS).filter((id) => ELEMENTS[id]!.in);
  const overlapping = held.flatMap((a) =>
    held.filter((b) => a < b && overlap(nodes[a]!, nodes[b]!)).map((b) => `${a} ${b}`),
  );
  expect(overlapping).toEqual([]);
});

test("associations carry a multiplicity at each end, include and extend are dashed with an open arrowhead and their keyword, the extend's condition is anchored on it, and generalizations end in a hollow triangle", async ({
  page,
}) => {
  // Verifies: G-20, G-19, API-edges-dock-nodes-or-edges
  await page.goto("/");
  await open(page);
  await chooseUseCase(page);
  const { graph, kinds } = await state(page);
  const kindOf = Object.fromEntries(
    graph.edges.map((edge) => [edge.id, [edge.source, edge.target, kinds[edge.id]]]),
  );
  expect(kindOf).toEqual(
    Object.fromEntries([
      ...RELATIONSHIPS.map((each) => [`${each[0]}-${each[1]}`, each]),
      ["delete-condition-anchor", ["delete-condition", undefined, "anchor"]],
    ]),
  );
  const byKind = (kind: string) =>
    graph.edges
      .filter(({ id }) => kinds[id] === kind)
      .map(({ id, arrow, dash, labels }) => ({
        id,
        arrow,
        dash,
        labels: labels?.map((l) => l.text),
      }));
  for (const edge of byKind("association"))
    expect(edge).toEqual({ id: edge.id, arrow: "none", dash: undefined, labels: ["1", "0..*"] });
  expect(byKind("include").concat(byKind("extend"))).toEqual([
    { id: "add-node-describe-content", arrow: "open", dash: [6, 4], labels: ["«include»"] },
    { id: "pan-zoom-draw-in-view", arrow: "open", dash: [6, 4], labels: ["«include»"] },
    { id: "delete-select", arrow: "open", dash: [6, 4], labels: ["«extend»"] },
  ]);
  // Between use cases and between actors.
  expect(byKind("use-case-generalization")).toEqual([
    { id: "drop-in-container-drag-node", arrow: "hollow", dash: undefined, labels: undefined },
    { id: "developer-user", arrow: "hollow", dash: undefined, labels: undefined },
  ]);
  // The multiplicities stand near their ends, and the canvas draws both of each association.
  for (const edge of graph.edges.filter(({ id }) => kinds[id] === "association"))
    expect(edge.labels?.map(({ id, t }) => [id, t])).toEqual([
      ["source-multiplicity", 0.1],
      ["target-multiplicity", 0.9],
    ]);
  const { labels } = await drawnNear(page);
  expect(labels.filter(({ text }) => text === "1" || text === "0..*")).toHaveLength(26);
  // The condition of the extend is a comment anchored at the middle of the extend.
  expect(graph.edges.find(({ id }) => id === "delete-condition-anchor")).toMatchObject({
    targetEdge: "delete-select",
    targetT: 0.5,
    dash: [6, 4],
    arrow: "none",
  });
});

/** Drops the palette's `kind` with the pointer over the world point (`x`, `y`), shown at (400, 400)
 *  of the canvas at scale 1. */
async function dropAtWorld(page: Page, kind: string, x: number, y: number): Promise<void> {
  await setViewport(page, { x: 400 - x, y: 400 - y, scale: 1 });
  await page
    .locator(`#palette [data-kind="${kind}"]`)
    .dragTo(page.locator("#canvas canvas"), { targetPosition: { x: 400, y: 400 } });
}

test("the palette offers each element, and a use case dropped over the subject lies in it, an actor on the canvas with its name below its drawing", async ({
  page,
}) => {
  // Verifies: G-20, G-1, REN-node-shapes-cover-uml
  await page.goto("/");
  await open(page);
  await chooseUseCase(page);
  await expect(page.locator("#palette li:visible")).toHaveText([
    "Actor",
    "Use case",
    "Subject",
    "Comment",
  ]);
  // Over the subject, below the last use case of its left column, where nothing lies.
  const subject = await boxOf(page, "comb");
  const [x, y] = [subject.x + 550, subject.y + subject.height - 60];
  await dropAtWorld(page, "use-case", x, y);
  await dropAtWorld(page, "actor", x, y);
  expect((await dataOf(page, "use-case-1"))?.container).toBe("comb");
  expect((await dataOf(page, "actor-1"))?.container).toBeUndefined();
  const drawn = await page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().nodes.filter(({ id }) => id === "use-case-1" || id === "actor-1");
  });
  const [added, standing] = ["use-case-1", "actor-1"].map((id) => drawn.find((n) => n.id === id)!);
  expect(added!.shape).toBe("ellipse");
  expect(standing!.shape).toBe("actor");
  for (const node of [added!, standing!])
    expect(Math.hypot(node.x + node.width / 2 - x, node.y + node.height / 2 - y)).toBeLessThan(
      0.01,
    );
  // The actor's name stands below its drawing.
  const name = standing!.texts!.find((text) => text.drawn === "NewActor")!;
  expect(name.y).toBeGreaterThanOrEqual(standing!.drawing!.y + standing!.drawing!.height);
  expect((await page.evaluate(() => window.uml.nodeKinds()))["actor-1"]).toBe("actor");
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

/** Drags node `id` from the world point `at` in it so that that point lands on the world point
 *  (`x`, `y`), the whole diagram in view. */
async function dragFrom(page: Page, at: [number, number], x: number, y: number): Promise<void> {
  await overview(page);
  const from = await pagePoint(page, ...at);
  const to = await pagePoint(page, x, y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test("an actor dragged into the subject is refused and stands where it stood", async ({ page }) => {
  // Verifies: G-20, G-14, API-edits-report-nested-changes
  await page.goto("/");
  await open(page);
  await chooseUseCase(page);
  await record(page);
  const before = { drawn: await boxOf(page, "host"), data: await state(page) };
  const subject = await boxOf(page, "comb");
  // Pressed on the actor clear of the connectors at the middles of its sides, which would start a
  // connection, and released in the subject where nothing lies.
  const host = before.drawn;
  await dragFrom(
    page,
    [host.x + host.width / 4, host.y + (host.height * 3) / 4],
    subject.x + 550,
    subject.y + subject.height - 60,
  );
  expect(await changes(page)).toEqual([]);
  expect(await boxOf(page, "host")).toEqual(before.drawn);
  expect(await state(page)).toEqual(before.data);
});

/** Drags a connection from the world point `from`, a connector, to the world point `to`, another,
 *  with both in view at scale 0.6, the near level, or less where they lie too far apart for it. */
async function connectWorld(page: Page, from: [number, number], to: [number, number]) {
  const scale = Math.min(0.6, 700 / Math.hypot(to[0] - from[0], to[1] - from[1]));
  const [mx, my] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  await setViewport(page, { x: 640 - mx * scale, y: 360 - my * scale, scale });
  const [start, end] = [await pagePoint(page, ...from), await pagePoint(page, ...to)];
  // Few pointer moves: each one waits for a frame, which a loaded machine draws slowly.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 3 });
  await page.mouse.up();
}

type Side = "left" | "right" | "top" | "bottom";
type Box = { x: number; y: number; width: number; height: number };

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

/** The connector at the middle of `side` of `box`, in world units. */
function connectorOf(box: Box, side: Side): [number, number] {
  if (side === "left" || side === "right")
    return [side === "left" ? box.x : box.x + box.width, box.y + box.height / 2];
  return [box.x + box.width / 2, side === "top" ? box.y : box.y + box.height];
}

/** A pair the user connects: its source and its target, the sides of their connectors, and what
 *  follows, why the sidebar says the table refuses it or the kind it adds. */
type Connection = [string, Side, string, Side, string];

/** Pairs the table of refusals refuses, each with why the sidebar says so, written here from
 *  docs/CONVENTIONS.md. */
const REFUSALS: Connection[] = [
  [
    "resize",
    "right",
    "comb",
    "right",
    "The subject is the system its use cases belong to; the example draws no relationship to or from it.",
  ],
  [
    "connect",
    "right",
    "delete-condition",
    "left",
    "A comment is attached by its anchor; no relationship of the use case diagram starts or ends on it.",
  ],
  [
    "connect",
    "left",
    "connect",
    "right",
    "UML 2.5.1 lets no use case include itself (cannot_include_self).",
  ],
  [
    "host",
    "left",
    "host",
    "right",
    "UML 2.5.1 lets no classifier specialize itself (no_cycles_in_generalization).",
  ],
];

/** Pairs the table allows, each with the kind a connection adds between them. */
const ALLOWED: Connection[] = [
  ["user", "right", "drop-in-container", "left", "association"],
  ["host", "top", "user", "top", "use-case-generalization"],
  ["drag-label", "right", "draw-in-view", "left", "include"],
  ["delete-condition", "right", "style-edge", "left", "anchor"],
];

/** Opens the use case diagram and drags each connection of `connections`, handing `check` the copy
 *  before and after it; no connection moves a node, so the boxes are read once. */
async function connectEach(
  page: Page,
  connections: Connection[],
  check: (each: Connection, before: State, after: State) => Promise<void>,
): Promise<void> {
  await page.goto("/");
  await open(page);
  await chooseUseCase(page);
  const boxes = await boxesOf(page);
  for (const each of connections) {
    const [source, from, target, to] = each;
    const before = await state(page);
    await connectWorld(page, connectorOf(boxes[source]!, from), connectorOf(boxes[target]!, to));
    await check(each, before, await state(page));
  }
}

/** The example's copy of the graph and the kind of each edge, as `state` reads them. */
type State = Awaited<ReturnType<typeof state>>;

test("a connection the use case diagram's table of refusals holds is refused and the sidebar says why", async ({
  page,
}) => {
  // Verifies: G-20, G-3
  await connectEach(page, REFUSALS, async ([source, , target, , why], before, after) => {
    expect({ source, target, after }).toEqual({ source, target, after: before });
    await expect(page.locator("#connection-refusal")).toHaveText(why);
  });
});

test("a connection the table allows adds an association, a generalization, an include, or an anchor", async ({
  page,
}) => {
  // Verifies: G-20, G-3
  await connectEach(page, ALLOWED, async ([source, , target, , kind], _, after) => {
    const added = after.graph.edges.filter(
      (edge) => "source" in edge && edge.source === source && edge.target === target,
    );
    expect({ source, target, added: added.length }).toEqual({ source, target, added: 1 });
    expect({ source, kind: after.kinds[added[0]!.id] }).toEqual({ source, kind });
    expect(added[0]).toMatchObject({ sourceSide: "outline", targetSide: "outline" });
    await expect(page.locator("#connection-refusal")).toBeHidden();
  });
});

/** Clicks edge `id`, read with the whole diagram in view, three tenths of the way along its path,
 *  clear of its labels, and expects the sidebar's heading of a relationship. */
async function selectEdge(page: Page, id: string): Promise<void> {
  await overview(page);
  const ends = await page.evaluate(async (wanted) => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().edges.find((edge) => edge.id === wanted)!;
  }, id);
  const [mx, my] = [(ends.source.x + ends.target.x) / 2, (ends.source.y + ends.target.y) / 2];
  await setViewport(page, { x: 640 - mx, y: 360 - my, scale: 1 });
  const along = (from: number, to: number) => from + (to - from) * 0.3;
  await clickWorld(page, along(ends.source.x, ends.target.x), along(ends.source.y, ends.target.y));
  await expect(page.locator("#edge-heading")).toHaveText("Selected relationship");
}

test("the sidebar edits an association's multiplicities, changes a relationship between two use cases among include, extend, and generalization, and edits a use case's extension points", async ({
  page,
}) => {
  // Verifies: G-20, G-5
  await page.goto("/");
  await open(page);
  await chooseUseCase(page);
  await overview(page);
  await selectEdge(page, "host-style-edge");
  await expect(page.locator("#kind")).toBeHidden();
  await expect(page.locator("#source-multiplicity")).toHaveValue("1");
  await expect(page.locator("#target-multiplicity")).toHaveValue("0..*");
  await page.locator("#target-multiplicity").fill("1..*");
  await page.locator("#source-multiplicity").fill("");
  const labelsOf = async (edge: string) =>
    (await state(page)).graph.edges.find(({ id }) => id === edge)?.labels;
  expect(await labelsOf("host-style-edge")).toEqual([
    { id: "target-multiplicity", text: "1..*", t: 0.9, offset: 0 },
  ]);
  // An include between two use cases becomes an extend, and then a generalization.
  await selectEdge(page, "pan-zoom-draw-in-view");
  await expect(page.locator("#label")).toBeHidden();
  const offered = await page
    .locator("#kind option")
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(offered).toEqual(["include", "extend", "use-case-generalization"]);
  await page.locator("#kind").selectOption("extend");
  let edge = (await state(page)).graph.edges.find(({ id }) => id === "pan-zoom-draw-in-view")!;
  expect(edge).toMatchObject({ arrow: "open", dash: [6, 4], labels: [{ text: "«extend»" }] });
  await page.locator("#kind").selectOption("use-case-generalization");
  edge = (await state(page)).graph.edges.find(({ id }) => id === "pan-zoom-draw-in-view")!;
  expect(edge).toMatchObject({ arrow: "hollow" });
  expect([edge.dash, edge.labels]).toEqual([undefined, undefined]);
  // Between two actors, a generalization alone.
  await overview(page);
  await selectEdge(page, "developer-user");
  expect(
    await page
      .locator("#kind option")
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
  ).toEqual(["use-case-generalization"]);
  // A use case's extension points, one per line.
  const select = await boxOf(page, "select");
  await setViewport(page, { x: 640 - select.x - select.width / 2, y: 360 - select.y, scale: 1 });
  await clickWorld(page, select.x + select.width / 2, select.y + 30);
  await expect(page.locator("#name")).toHaveValue("Select a node or an edge");
  await expect(page.locator("#points")).toHaveValue("Delete pressed");
  await page.locator("#points").fill("Delete pressed\nEscape pressed");
  const content = await page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    return window.uml.inspect().nodes.find(({ id }) => id === "select")?.content;
  });
  expect(content?.slice(3)).toEqual([
    [expect.objectContaining({ text: "Delete pressed" })],
    [expect.objectContaining({ text: "Escape pressed" })],
  ]);
});

test("a use case at an end of the extend moved, the condition stays anchored at the middle of the extend", async ({
  page,
}) => {
  // Verifies: G-20, G-19, API-edges-dock-nodes-or-edges
  await page.goto("/");
  await open(page);
  await chooseUseCase(page);
  const ends = () =>
    page.evaluate(async () => {
      await window.uml.comb.whenRendered();
      const { edges } = window.uml.inspect();
      return {
        anchor: edges.find(({ id }) => id === "delete-condition-anchor")!,
        extend: edges.find(({ id }) => id === "delete-select")!,
      };
    });
  const before = await ends();
  const node = await boxOf(page, "delete");
  const [cx, cy] = [node.x + node.width / 2, node.y + node.height / 2];
  await dragFrom(page, [cx, cy], cx + 60, cy + 70);
  await overview(page);
  const after = await ends();
  expect(after.extend.source).not.toEqual(before.extend.source);
  // The extend runs straight, so its middle is the middle of its ends, where the anchor ends.
  expect(after.anchor.target.x).toBeCloseTo((after.extend.source.x + after.extend.target.x) / 2, 3);
  expect(after.anchor.target.y).toBeCloseTo((after.extend.source.y + after.extend.target.y) / 2, 3);
  expect((await dataOf(page, "delete"))?.container).toBe("comb");
});

test("an extend changed to another kind loses its condition, the comment and its anchor removed as Comb tells", async ({
  page,
}) => {
  // Verifies: G-20, G-4, API-edits-report-nested-changes
  await page.goto("/");
  await open(page);
  await chooseUseCase(page);
  await record(page);
  await selectEdge(page, "delete-select");
  await page.locator("#kind").selectOption("include");
  const { graph, kinds } = await state(page);
  expect(kinds["delete-select"]).toBe("include");
  expect(graph.nodes.map(({ id }) => id)).not.toContain("delete-condition");
  expect(graph.edges.map(({ id }) => id)).not.toContain("delete-condition-anchor");
  const drawn = await page.evaluate(async () => {
    await window.uml.comb.whenRendered();
    const scene = window.uml.inspect();
    return [...scene.nodes, ...scene.edges].map(({ id }) => id);
  });
  expect(drawn).not.toContain("delete-condition");
  expect(drawn).not.toContain("delete-condition-anchor");
  expect(await changes(page)).toContainEqual(
    expect.objectContaining({
      kind: "nodesRemoved",
      nodes: ["delete-condition"],
      edges: ["delete-condition-anchor"],
    }),
  );
  // An include has no condition to lose: changed back to an extend, it gains none.
  await page.locator("#kind").selectOption("extend");
  expect((await state(page)).graph.nodes.map(({ id }) => id)).not.toContain("delete-condition");
});
