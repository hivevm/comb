// Browser tests of the UML example's activity diagram (G-20): a load of Comb in the notation of UML
// 2.5.1, inside the frame of its activity divided into the partitions of the host application,
// the shell, and the engine (ARCH-regions-are-container-slots): actions and call behavior actions,
// send signal, accept event, and accept time event actions, object nodes and pins with their names
// beside them (ARCH-border-nodes-ride-sides), a data store and a central buffer, the veto as a
// decision with guards, a fork and a join, an interruptible region with its interrupting edge, an
// exception handler, an expansion region over the rows of content with its expansion nodes,
// connectors, comments, and the frame's activity parameter nodes, each in the node shape the
// building blocks settled for it (REN-node-shapes-cover-uml); flows with open arrowheads, guards,
// and a weight; lightning on the interrupting edge and the exception handler.
import { expect, test, type Page } from "@playwright/test";
import type { NodeData } from "comb";
import { open } from "./shared";

/** Each element of the load, by the identifier of its node: its node shape, the partition, region,
 *  or container it lies in or the node whose border it rides, and the content it shows, a call
 *  behavior action's rake as "icon", written here from the ticket's description and its settled
 *  building blocks rather than read from the example. */
type Element = {
  shape: string;
  in?: string;
  on?: string;
  content?: readonly (readonly string[])[];
};

/** A pin and the node of its name beside it, both on `on`. */
const pin = (id: string, on: string, name: string): Record<string, Element> => ({
  [id]: { shape: "rectangle", on, content: [] },
  [`${id}-name`]: { shape: "rectangle", on, content: [[name]] },
});

/** An expansion node, three small rectangles without content side by side on `on`. */
const expansionNode = (id: string, on: string): Record<string, Element> =>
  Object.fromEntries(
    [id, `${id}-before`, `${id}-after`].map((each) => [
      each,
      { shape: "rectangle", on, content: [] },
    ]),
  );

const ELEMENTS: Record<string, Element> = {
  // The frame of the activity, its partitions, and its activity parameter nodes.
  load: { shape: "frame", content: [["act Load"]] },
  host: { shape: "rectangle", in: "load" },
  shell: { shape: "rectangle", in: "load" },
  engine: { shape: "rectangle", in: "load" },
  options: { shape: "rectangle", on: "load", content: [["options : CombOptions"]] },
  comb: { shape: "rectangle", on: "load", content: [["comb : Comb"]] },
  // Actions and call behavior actions, with their pins.
  build: { shape: "rounded-rectangle", in: "host", content: [["Build the graph"]] },
  ...pin("build-graph", "build", "graph"),
  create: { shape: "rounded-rectangle", in: "shell", content: [["createComb", "icon"]] },
  ...pin("create-options", "create", "options"),
  ...pin("create-comb", "create", "comb"),
  apply: { shape: "rounded-rectangle", in: "shell", content: [["load", "icon"]] },
  ...pin("apply-graph", "apply", "graph"),
  ...pin("apply-rows", "apply", "rows"),
  bind: { shape: "rounded-rectangle", in: "shell", content: [["Bind the scene"]] },
  draw: { shape: "rounded-rectangle", in: "shell", content: [["DrawFrame", "icon"]] },
  ...pin("draw-heights", "draw", "heights"),
  ...pin("draw-change", "draw", "loaded"),
  // The exception handler's body, with the pin that takes the error.
  refuse: { shape: "rounded-rectangle", in: "shell", content: [["Refuse the engine"]] },
  ...pin("refuse-error", "refuse", "error"),
  // Send signal, accept event, and accept time event actions.
  lost: { shape: "pentagon", in: "shell", content: [["EngineLostError"]] },
  "graph-error": { shape: "pentagon", in: "shell", content: [["GraphDataError"]] },
  trap: { shape: "notched-rectangle", in: "interruptible", content: [["trap"]] },
  "next-frame": { shape: "hourglass", in: "shell", content: [["next frame"]] },
  // Object nodes: an object node, a data store, and a central buffer.
  graph: { shape: "rectangle", in: "host", content: [["graph : GraphData"]] },
  copy: { shape: "rectangle", in: "host", content: [["«datastore»"], ["the host's copy"]] },
  heights: { shape: "rectangle", in: "shell", content: [["«centralBuffer»"], ["heights"]] },
  // The veto as a decision, a fork, and a join.
  veto: { shape: "diamond", in: "shell", content: [] },
  fork: { shape: "bar", in: "shell", content: [] },
  join: { shape: "bar", in: "shell", content: [] },
  // The interruptible region for the loss of the engine, and what it holds.
  interruptible: { shape: "rounded-rectangle", in: "engine", content: [] },
  instantiate: {
    shape: "rounded-rectangle",
    in: "interruptible",
    content: [["Instantiate the engine"]],
  },
  // The expansion region over the rows of content, its expansion nodes, and what it holds.
  measure: { shape: "rounded-rectangle", in: "engine", content: [["«iterative»"]] },
  ...expansionNode("rows", "measure"),
  ...expansionNode("row-heights", "measure"),
  "lay-out": { shape: "rounded-rectangle", in: "measure", content: [["Lay out the row"]] },
  ...pin("lay-out-row", "lay-out", "row"),
  ...pin("lay-out-height", "lay-out", "height"),
  // Connectors, a pair of one letter.
  "a-out": { shape: "ellipse", in: "engine", content: [["A"]] },
  "a-in": { shape: "ellipse", in: "shell", content: [["A"]] },
  // Comments.
  "refused-note": {
    shape: "note",
    in: "host",
    content: [["A refused load throws"], ["GraphDataError."]],
  },
  "trap-note": {
    shape: "note",
    in: "engine",
    content: [["A trap loses the engine"], ["of every Comb on the page."]],
  },
};

/** Chooses the activity diagram in the sidebar and waits until its load has drawn, the whole of it
 *  in view at the near level. */
async function chooseActivity(page: Page): Promise<void> {
  await page.locator("#diagram").selectOption("activity");
  await page.evaluate(async () => {
    await window.uml.loadReport;
    window.uml.comb.setViewport({ x: 20, y: 20, scale: 0.4 });
    await window.uml.comb.whenRendered();
  });
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

/** A node as the canvas draws it, by `inspect`. */
type Drawn = ReturnType<typeof window.uml.inspect>["nodes"][number];

/** Expects node `id` drawn as `element` says: in its node shape, showing its content, within the
 *  partition or the container it lies in, which the example's copy `data` names as its container,
 *  or centred on a side of the node it rides, which the copy names. */
function expectShown(
  id: string,
  element: Element,
  nodes: Record<string, Drawn>,
  data: Map<string, NodeData>,
): void {
  const node = nodes[id]!;
  expect({ id, shape: node.shape }).toEqual({ id, shape: element.shape });
  if (element.content) {
    const texts = (node.content ?? []).map((row) =>
      row === "separator" ? [row] : row.map((each) => ("text" in each ? each.text : each.kind)),
    );
    expect({ id, texts }).toEqual({ id, texts: element.content });
  }
  if (element.in) {
    expect({ id, inside: within(node, nodes[element.in]!) }).toEqual({ id, inside: true });
    // A partition is a region, no node of the graph data, but a node lies in it by its identifier.
    if (data.has(id))
      expect({ id, container: data.get(id)?.container }).toEqual({ id, container: element.in });
  }
  if (element.on) {
    const owner = nodes[element.on]!;
    const [cx, cy] = [node.x + node.width / 2, node.y + node.height / 2];
    const off = Math.min(
      Math.abs(cx - owner.x),
      Math.abs(cx - owner.x - owner.width),
      Math.abs(cy - owner.y),
      Math.abs(cy - owner.y - owner.height),
    );
    expect({ id, onSide: off < 0.01 }).toEqual({ id, onSide: true });
    expect({ id, attachedTo: data.get(id)?.attachedTo }).toEqual({ id, attachedTo: element.on });
  }
}

test("the activity diagram shows each element of the load in its node shape, its partition, its region, or its border", async ({
  page,
}) => {
  // Verifies: G-20, REN-node-shapes-cover-uml, ARCH-border-nodes-ride-sides,
  // Verifies: ARCH-regions-are-container-slots
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  await expect(page.locator("#count")).toHaveText("53 elements, 26 edges");
  await expect(page.locator("#legend")).toBeHidden();
  const drawn = await page.evaluate(async () => {
    // The near level draws every element, the frame in two views, its top and its bottom half.
    const nodes = new Map<string, Drawn>();
    const labels = new Map<string, string>();
    for (const y of [20, -620]) {
      window.uml.comb.setViewport({ x: 20, y, scale: 0.6 });
      await window.uml.comb.whenRendered();
      const scene = window.uml.inspect();
      for (const node of scene.nodes)
        if (!nodes.has(node.id) || node.content) nodes.set(node.id, node);
      for (const { edge, text } of scene.edgeLabels) labels.set(edge, text);
    }
    return { nodes: Object.fromEntries(nodes), labels: Object.fromEntries(labels) };
  });
  const { nodes } = await page.evaluate(() => window.uml.exampleGraph());
  const data = new Map(nodes.map((node) => [node.id, node]));
  expect(Object.keys(drawn.nodes).sort()).toEqual(Object.keys(ELEMENTS).sort());
  for (const [id, element] of Object.entries(ELEMENTS)) expectShown(id, element, drawn.nodes, data);
  // The partitions lie side by side across the frame, each named in its band.
  const bands = ["host", "shell", "engine"].map((id) => drawn.nodes[id]!.region?.band?.name);
  expect(bands).toEqual(["Host application", "Shell", "Engine"]);
  // The interruptible and the expansion region are dashed; the name of a pin has no outline.
  for (const id of ["interruptible", "measure"])
    expect({ id, dashed: Array.isArray(drawn.nodes[id]!.outlined) }).toEqual({ id, dashed: true });
  for (const id of Object.keys(ELEMENTS).filter((each) => each.endsWith("-name")))
    expect({ id, outlined: drawn.nodes[id]!.outlined }).toEqual({ id, outlined: "none" });
  // A pin and an expansion node's rectangles are small squares, those of one expansion node side
  // by side; a fork and a join are bars given a height, upright; a connector is round.
  for (const id of Object.keys(ELEMENTS).filter(
    (each) =>
      ELEMENTS[each]!.on && !each.endsWith("-name") && ELEMENTS[each]!.content?.length === 0,
  ))
    expect({ id, size: [drawn.nodes[id]!.width, drawn.nodes[id]!.height] }).toEqual({
      id,
      size: [16, 16],
    });
  const [before, middle, after] = ["rows-before", "rows", "rows-after"].map(
    (id) => drawn.nodes[id]!,
  );
  expect([middle!.x - before!.x, after!.x - middle!.x]).toEqual([16, 16]);
  for (const id of ["fork", "join"])
    expect({ id, upright: drawn.nodes[id]!.height > drawn.nodes[id]!.width }).toEqual({
      id,
      upright: true,
    });
  for (const id of ["a-in", "a-out"])
    expect({ id, round: drawn.nodes[id]!.height }).toEqual({ id, round: drawn.nodes[id]!.width });
  // The veto's guards and the central buffer's weight.
  expect(drawn.labels).toEqual({
    "veto-graph-error": "[refused]",
    "veto-fork": "[accepted]",
    "heights-draw-heights": "{weight=*}",
  });
});

test("flows have an open arrowhead, the interrupting edge and the exception handler are lightning bolts, and a comment is anchored on the veto and on the interrupting edge", async ({
  page,
}) => {
  // Verifies: G-20, API-edges-dock-nodes-or-edges
  await page.goto("/");
  await open(page);
  await chooseActivity(page);
  const { edges } = await page.evaluate(() => window.uml.exampleGraph());
  const kinds = await page.evaluate(() => window.uml.edgeKinds());
  const byKind = (kind: string) => edges.filter(({ id }) => kinds[id] === kind);
  for (const edge of [...byKind("control-flow"), ...byKind("object-flow")])
    expect({ id: edge.id, arrow: edge.arrow, lightning: edge.lightning }).toEqual({
      id: edge.id,
      arrow: "open",
      lightning: undefined,
    });
  expect(byKind("control-flow").length).toBeGreaterThan(0);
  expect(byKind("object-flow").length).toBeGreaterThan(0);
  // An object flow runs from or to an object node, as the pins and the parameter nodes are.
  expect(byKind("object-flow").map(({ id }) => id)).toContain("options-create-options");
  expect(byKind("interrupting-edge")).toMatchObject([
    { source: "trap", target: "lost", arrow: "open", lightning: true },
  ]);
  expect(byKind("exception-handler")).toMatchObject([
    { source: "instantiate", target: "refuse-error", lightning: true },
  ]);
  expect(byKind("anchor")).toMatchObject([
    { source: "refused-note", target: "veto", dash: [6, 4], arrow: "none" },
    { source: "trap-note", targetEdge: "trap-lost", targetT: 0.5, dash: [6, 4], arrow: "none" },
  ]);
  // The interrupting edge leaves the interruptible region, its source in it and its target not.
  const containers = new Map(
    (await page.evaluate(() => window.uml.exampleGraph())).nodes.map((node) => [
      node.id,
      node.container,
    ]),
  );
  expect([containers.get("trap"), containers.get("lost")]).toEqual(["interruptible", "shell"]);
});
