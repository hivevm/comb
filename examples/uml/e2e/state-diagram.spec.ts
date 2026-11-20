// Browser tests of the UML example's state diagram (G-12, G-20): the life of a Comb in the notation
// of UML 2.5.1, inside the frame of its state machine: states with their compartments below a
// separator, composite states divided into orthogonal regions, a submachine state with connection
// point references on its border, a state list, the pseudostates and final states in Comb's node
// shapes (REN-node-shapes-cover-uml), history holding H and H*, entry and exit points riding a
// border with their names beside them (ARCH-border-nodes-ride-sides), transitions with an open
// arrowhead labelled by trigger, guard, and effect, a send and a receive signal symbol on a
// transition, and comments anchored on a state and on a transition (API-edges-dock-nodes-or-edges);
// every transition docked on the outline (API-edges-dock-nodes-or-edges), and a loop on Ready.
import { expect, test, type Page } from "@playwright/test";
import type { NodeData } from "comb";
import { open } from "./shared";

/** Each notation element of G-20's state diagram the example shows, by the identifier of its node:
 *  its node shape, the container or the region it lies in or the node whose border it rides, and
 *  the content it shows, written here from G-20 and UML 2.5.1 rather than read from the example. A
 *  state's compartment stands below a separator; a pseudostate shows nothing. */
type Element = {
  shape: string;
  in?: string;
  on?: string;
  content?: readonly (readonly string[] | "separator")[];
};
const ELEMENTS: Record<string, Element> = {
  // The frame of the state machine, its heading in its tab.
  machine: { shape: "frame", content: [["stm Comb"]] },
  // States, their entry, do, and exit behaviours, internal transitions, and deferred triggers.
  created: {
    shape: "rounded-rectangle",
    in: "machine",
    content: [["Created"], "separator", ["entry / read the options"]],
  },
  loading: {
    shape: "rounded-rectangle",
    in: "machine",
    content: [
      ["Loading its engine"],
      "separator",
      ["do / instantiate the engine"],
      ["edit / defer"],
    ],
  },
  dragging: {
    shape: "rounded-rectangle",
    in: "live-region-2",
    content: [["Dragging"], "separator", ["do / follow the pointer"], ["exit / tell the move"]],
  },
  ready: {
    shape: "rounded-rectangle",
    in: "live-region-1",
    content: [["Ready"], "separator", ["select / show it"]],
  },
  idle: { shape: "rounded-rectangle", in: "live-region-2", content: [["Idle"]] },
  suspended: { shape: "rounded-rectangle", in: "machine", content: [["Suspended"]] },
  lost: {
    shape: "rounded-rectangle",
    in: "machine",
    content: [["Engine lost"], "separator", ["entry / tell onEngineLost"]],
  },
  // Composite states, divided into orthogonal regions.
  live: {
    shape: "rounded-rectangle",
    in: "machine",
    content: [["Live"], "separator", ["entry / fit the view"], ["resize / redraw"]],
  },
  "live-region-1": { shape: "rectangle", in: "live" },
  "live-region-2": { shape: "rectangle", in: "live" },
  destroying: { shape: "rounded-rectangle", in: "machine", content: [["Destroying"]] },
  "destroying-region-1": { shape: "rectangle", in: "destroying" },
  "destroying-region-2": { shape: "rectangle", in: "destroying" },
  textures: { shape: "rounded-rectangle", in: "destroying-region-1" },
  engine: { shape: "rounded-rectangle", in: "destroying-region-2" },
  // A submachine state, and its connection point references.
  rendering: {
    shape: "rounded-rectangle",
    in: "live-region-1",
    content: [["Rendering : DrawFrame"]],
  },
  begin: { shape: "ellipse", on: "rendering", content: [] },
  "begin-name": { shape: "rectangle", on: "rendering", content: [["begin"]] },
  end: { shape: "crossed-circle", on: "rendering", content: [] },
  "end-name": { shape: "rectangle", on: "rendering", content: [["end"]] },
  // A state list.
  early: { shape: "rounded-rectangle", in: "machine", content: [["Created, Loading"]] },
  // Pseudostates and final states.
  initial: { shape: "circle", in: "machine", content: [] },
  "graph-initial": { shape: "circle", in: "live-region-1", content: [] },
  "input-initial": { shape: "circle", in: "live-region-2", content: [] },
  terminate: { shape: "cross", in: "machine", content: [] },
  loaded: { shape: "diamond", in: "machine", content: [] },
  junction: { shape: "circle", in: "machine", content: [] },
  fork: { shape: "bar", in: "machine", content: [] },
  join: { shape: "bar", in: "machine", content: [] },
  refused: { shape: "ringed-circle", in: "machine", content: [] },
  destroyed: { shape: "ringed-circle", in: "machine", content: [] },
  // Shallow and deep history.
  shallow: { shape: "ellipse", in: "live-region-2", content: [["H"]] },
  deep: { shape: "ellipse", in: "live-region-1", content: [["H*"]] },
  // Entry and exit points, each with its name beside it.
  resume: { shape: "ellipse", on: "live", content: [] },
  "resume-name": { shape: "rectangle", on: "live", content: [["resume"]] },
  "lost-exit": { shape: "crossed-circle", on: "live", content: [] },
  "lost-exit-name": { shape: "rectangle", on: "live", content: [["lost"]] },
  // The receive and the send signal symbols of a transition.
  load: { shape: "notched-rectangle", in: "machine", content: [["load"]] },
  refusal: { shape: "pentagon", in: "machine", content: [["EngineSourceError"]] },
  // Comments.
  waits: {
    shape: "note",
    in: "machine",
    content: [["An edit before the"], ["engine loads waits."]],
  },
  replaces: {
    shape: "note",
    in: "machine",
    content: [["A load replaces"], ["the graph whole."]],
  },
};

/** The labels of the transitions, each its trigger, its guard in brackets, and its effect after a
 *  slash. */
const LABELS = [
  "load [engine given]",
  "settled",
  "[loaded]",
  "[refused]",
  "trap",
  "edit / apply the change",
  "change",
  "context lost",
  "reload",
  "pointerdown [on a node]",
  "pointerup",
  "pagehide",
  "pageshow",
  "destroy",
  "destroy / drop the options",
];

/** Chooses the state diagram in the sidebar and waits until its load has drawn, the whole of it
 *  in view at the near level. */
async function chooseStates(page: Page): Promise<void> {
  await page.locator("#diagram").selectOption("state");
  await page.evaluate(async () => {
    await window.uml.loadReport;
    window.uml.comb.setViewport({ x: 20, y: 10, scale: 0.4 });
    await window.uml.comb.whenRendered();
  });
}

/** The example's copy of the graph. */
async function exampleGraph(page: Page) {
  return page.evaluate(() => window.uml.exampleGraph());
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
 *  node or the region it lies in, which the example's copy `data` names as its container, or
 *  centred on a side of the node it rides, which is a rounded rectangle, on its straight part. */
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
      row === "separator" ? row : row.map((each) => ("text" in each ? each.text : each.kind)),
    );
    expect({ id, texts }).toEqual({ id, texts: element.content });
  }
  if (element.in) {
    expect({ id, inside: within(node, nodes[element.in]!) }).toEqual({ id, inside: true });
    // A region is no node of the graph data, but a node lies in it by its identifier.
    const container = data.get(id)?.container;
    if (!id.includes("-region-")) expect({ id, container }).toEqual({ id, container: element.in });
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

test("the state diagram shows each notation element of G-20 in its node shape, its container, its region, or its border", async ({
  page,
}) => {
  // Verifies: G-20, G-12, REN-node-shapes-cover-uml, ARCH-border-nodes-ride-sides
  await page.goto("/");
  await open(page);
  await chooseStates(page);
  await expect(page.locator("#count")).toHaveText("38 elements, 32 edges");
  // The legend of the kinds of relationship names none of its transitions.
  await expect(page.locator("#legend")).toBeHidden();
  const drawn = await page.evaluate(async () => {
    const { nodes } = window.uml.inspect();
    // The labels are drawn at the near level, where the diagram fills two views, its top and its
    // bottom half.
    const labels = new Map<string, string>();
    for (const y of [10, -560]) {
      window.uml.comb.setViewport({ x: 20, y, scale: 0.6 });
      await window.uml.comb.whenRendered();
      for (const { edge, text } of window.uml.inspect().edgeLabels) labels.set(edge, text);
    }
    return {
      nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
      labels: [...labels.values()].sort(),
    };
  });
  const { nodes } = await exampleGraph(page);
  const data = new Map(nodes.map((node) => [node.id, node]));
  // Every node the diagram draws is one of the elements, or the region of one.
  expect(Object.keys(drawn.nodes).sort()).toEqual(Object.keys(ELEMENTS).sort());
  for (const [id, element] of Object.entries(ELEMENTS)) expectShown(id, element, drawn.nodes, data);
  // The name of a point has no outline, so that its text alone shows.
  for (const id of ["begin-name", "end-name", "resume-name", "lost-exit-name"])
    expect({ id, outlined: drawn.nodes[id]!.outlined }).toEqual({ id, outlined: "none" });
  // The regions of a composite state are drawn as regions, parted by a dashed line.
  for (const id of ["live-region-1", "destroying-region-1"])
    expect({ id, dash: drawn.nodes[id]!.region?.line?.dash }).toEqual({ id, dash: [6, 4] });
  // A pseudostate is as small as its node shape allows; history is round, as high as wide.
  for (const id of ["initial", "refused", "terminate", "junction", "resume", "lost-exit", "end"])
    expect({ id, round: drawn.nodes[id]!.height === drawn.nodes[id]!.width }).toEqual({
      id,
      round: true,
    });
  for (const id of ["initial", "loaded", "junction", "resume", "begin"])
    expect({ id, small: drawn.nodes[id]!.width <= 32 }).toEqual({ id, small: true });
  for (const id of ["fork", "join"])
    expect({ id, height: drawn.nodes[id]!.height }).toEqual({ id, height: 8 });
  for (const id of ["shallow", "deep"])
    expect({ id, round: drawn.nodes[id]!.height }).toEqual({ id, round: drawn.nodes[id]!.width });
  expect(drawn.labels).toEqual([...LABELS].sort());
});

test("transitions have an open arrowhead, and a comment's anchor is dashed without one, on a state or at the middle of a transition", async ({
  page,
}) => {
  // Verifies: G-20, API-edges-dock-nodes-or-edges
  await page.goto("/");
  await open(page);
  await chooseStates(page);
  const { edges } = await exampleGraph(page);
  const kinds = await page.evaluate(() => window.uml.edgeKinds());
  for (const edge of edges) {
    const drawnAs = { id: edge.id, arrow: edge.arrow, dash: edge.dash };
    expect(drawnAs).toEqual(
      kinds[edge.id] === "transition"
        ? { id: edge.id, arrow: "open", dash: undefined }
        : { id: edge.id, arrow: "none", dash: [6, 4] },
    );
  }
  expect(edges.filter(({ id }) => kinds[id] === "anchor")).toMatchObject([
    { source: "replaces", target: "live" },
    { source: "waits", targetEdge: "created-load", targetT: 0.5 },
  ]);
  // The transition from Created that receives load runs straight, so its middle is the middle of
  // its ends, where the anchor ends.
  const drawn = await page.evaluate(() => {
    const { edges: all } = window.uml.inspect();
    return {
      anchor: all.find(({ id }) => id === "waits-anchor")!,
      transition: all.find(({ id }) => id === "created-load")!,
    };
  });
  const middle = {
    x: (drawn.transition.source.x + drawn.transition.target.x) / 2,
    y: (drawn.transition.source.y + drawn.transition.target.y) / 2,
  };
  expect(drawn.anchor.target.x).toBeCloseTo(middle.x, 3);
  expect(drawn.anchor.target.y).toBeCloseTo(middle.y, 3);
  // A transition through a signal symbol is two edges, its trigger and guard on the first.
  const labelsOf = (id: string) =>
    edges.find((edge) => edge.id === id)?.labels?.map(({ text }) => text);
  expect(labelsOf("created-load")).toEqual(["load [engine given]"]);
  expect(labelsOf("load-loading")).toBeUndefined();
  expect(labelsOf("loaded-refusal")).toEqual(["[refused]"]);
  expect(labelsOf("refusal-refused")).toBeUndefined();
});

test("the class and the package diagram are kept while the state diagram is shown", async ({
  page,
}) => {
  // Verifies: G-12
  await page.goto("/");
  await open(page);
  const before = await page.evaluate(() => window.uml.exampleGraph());
  await chooseStates(page);
  await page.locator("#diagram").selectOption("class");
  await page.evaluate(() => window.uml.loadReport);
  expect(await page.evaluate(() => window.uml.exampleGraph())).toEqual(before);
  // A diagram without node shapes draws its nodes as rectangles.
  const shapes = await page.evaluate(async () => {
    window.uml.comb.setViewport({ x: 0, y: 0, scale: 1 });
    await window.uml.comb.whenRendered();
    return [...new Set(window.uml.inspect().nodes.map(({ shape }) => shape))];
  });
  expect(shapes).toEqual(["rectangle"]);
});

/** How far `point` lies from the outline of a node of `shape` at `node`, in world units, written
 *  here from REN-node-shapes-cover-uml's node shapes rather than read from the engine: along
 *  the line from the node's centre for an ellipse, a circle, and a diamond, from the border for a
 *  rectangle, and
 *  from the arc of a rounded rectangle's corner, rounded by 10. */
function offOutline(
  shape: string,
  node: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): number {
  const [a, b] = [node.width / 2, node.height / 2];
  const [dx, dy] = [Math.abs(point.x - node.x - a), Math.abs(point.y - node.y - b)];
  const along = Math.hypot(dx, dy);
  const radial = (k: number) => Math.abs(along - along / k);
  switch (shape) {
    case "ellipse":
    case "circle":
    case "ringed-circle":
    case "crossed-circle":
      return radial(Math.hypot(dx / a, dy / b));
    case "diamond":
      return radial(dx / a + dy / b);
    case "rounded-rectangle": {
      const r = Math.min(10, a, b);
      const [ex, ey] = [dx - (a - r), dy - (b - r)];
      if (ex > 0 && ey > 0) return Math.abs(Math.hypot(ex, ey) - r);
      return Math.min(Math.abs(dx - a), Math.abs(dy - b));
    }
    default:
      return Math.min(Math.abs(dx - a), Math.abs(dy - b));
  }
}

/** Each end of every edge between two nodes as the canvas draws it, with its node and the node at
 *  the other end, and half a pixel at the zoom it is drawn at (Q-4) in world units. The loop on
 *  Ready docks on a side, and the anchor of a comment on a transition ends on that transition, so
 *  neither is among them. */
async function nodeEnds(page: Page) {
  const { nodes, edges, viewport } = await page.evaluate(() => {
    const scene = window.uml.inspect();
    return {
      edges: scene.edges,
      viewport: scene.viewport,
      nodes: scene.nodes.map(({ id, x, y, width, height, shape }) => ({
        id,
        x,
        y,
        width,
        height,
        shape,
      })),
    };
  });
  const graph = await exampleGraph(page);
  expect(edges).toHaveLength(32);
  const nodeEnded = graph.edges.flatMap((edge) =>
    "source" in edge && "target" in edge && edge.source !== edge.target
      ? [{ id: edge.id, from: edge.source!, to: edge.target! }]
      : [],
  );
  expect(nodeEnded).toHaveLength(30);
  const docked = new Map(edges.map((edge) => [edge.id, edge]));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ends = nodeEnded.flatMap(({ id, from, to }) => {
    const { source, target } = docked.get(id)!;
    const [a, b] = [byId.get(from)!, byId.get(to)!];
    return [
      { id, end: source, node: a, other: b },
      { id, end: target, node: b, other: a },
    ];
  });
  return { ends, tolerance: 0.5 / viewport.scale };
}

test("every transition of the state diagram docks on the outline of its states, on the line between their centres", async ({
  page,
}) => {
  // Verifies: G-12, G-13, API-edges-dock-nodes-or-edges, Q-4
  await page.goto("/");
  await open(page);
  await chooseStates(page);
  const { ends, tolerance } = await nodeEnds(page);
  const centre = ({ x, y, width, height }: (typeof ends)[number]["node"]) => ({
    x: x + width / 2,
    y: y + height / 2,
  });
  for (const { id, end, node, other } of ends) {
    const [c, o] = [centre(node), centre(other)];
    const towards = Math.hypot(o.x - c.x, o.y - c.y);
    const off = Math.abs((end.x - c.x) * (o.y - c.y) - (end.y - c.y) * (o.x - c.x)) / towards;
    expect({ id, at: node.id, offLine: off <= tolerance }).toEqual({
      id,
      at: node.id,
      offLine: true,
    });
    expect((end.x - c.x) * (o.x - c.x) + (end.y - c.y) * (o.y - c.y)).toBeGreaterThan(0);
    expect({
      id,
      at: node.id,
      offOutline: offOutline(node.shape!, node, end) <= tolerance,
    }).toEqual({
      id,
      at: node.id,
      offOutline: true,
    });
  }
  // The ends at one node towards different nodes never meet: the junction has three ends, towards
  // three nodes.
  const atJunction = ends.filter(({ node }) => node.id === "junction");
  expect(atJunction).toHaveLength(3);
  for (const at of new Set(ends.map(({ node }) => node.id))) {
    const here = ends.filter(({ node }) => node.id === at);
    for (const [i, a] of here.entries())
      for (const b of here.slice(i + 1))
        if (a.other.id !== b.other.id)
          expect(Math.hypot(a.end.x - b.end.x, a.end.y - b.end.y)).toBeGreaterThan(1);
  }
});

test("a loop on ready, labelled edit / apply the change, leaves and re-enters its left side, its label at the loop's outermost point", async ({
  page,
}) => {
  // Verifies: G-12, G-13, API-edges-dock-nodes-or-edges
  await page.goto("/");
  await open(page);
  await chooseStates(page);
  // Near Ready, where its loop's label is drawn.
  await page.evaluate(async () => {
    window.uml.comb.setViewport({ x: -240, y: -430, scale: 1 });
    await window.uml.comb.whenRendered();
  });
  const { ready, loop, label } = await page.evaluate(() => {
    const scene = window.uml.inspect();
    return {
      ready: scene.nodes.find(({ id }) => id === "ready")!,
      loop: scene.edges.find(({ id }) => id === "ready-ready"),
      label: scene.edgeLabels.find(({ edge }) => edge === "ready-ready"),
    };
  });
  // Clockwise on the left: up from a quarter of the side's length below its middle to a quarter
  // above, pulled out as far as the side is long, and at least 40.
  const middle = ready.y + ready.height / 2;
  expect(loop).toEqual({
    id: "ready-ready",
    source: { x: ready.x, y: middle + ready.height / 4 },
    target: { x: ready.x, y: middle - ready.height / 4 },
  });
  // At the path parameter 0.5, three quarters of the pull out, and 14 further, left of travel.
  const pull = Math.max(ready.height, 40);
  expect(label?.text).toBe("edit / apply the change");
  expect(label?.x).toBeCloseTo(ready.x - 0.75 * pull - 14, 3);
  expect(label?.y).toBeCloseTo(middle, 3);
});
