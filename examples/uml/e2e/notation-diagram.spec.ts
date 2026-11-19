// Browser tests of the UML example's notation diagram (G-20): the elements of UML 2.5.1's activity
// diagram that the load does not hold, inside the frame of the activity "Drag a node", divided
// into partitions, Comb's into the nested partitions of the shell and the engine
// (ARCH-regions-are-container-slots): an initial node, an activity final, a flow final, and a merge
// node in Comb's node shapes (REN-node-shapes-cover-uml); a loop node and a conditional node
// divided into named regions one above the other, and a structured activity node, each a dashed
// rounded rectangle below its keyword; a value pin with its value beside it, a streaming pin with
// `{stream}` beside it, and a parameter set, a dashed border node around two pins, which follow
// their action as it moves (ARCH-border-nodes-ride-sides).
import { expect, test, type Page } from "@playwright/test";
import type { NodeData } from "comb";
import { open, pagePoint } from "./shared";

/** Each element of the notation diagram, by the identifier of its node or region: its node shape,
 *  the partition, region, or container it lies in or the node whose border it rides, and the
 *  content it shows, a call behavior action's rake as "icon", written here from the ticket's
 *  description and its settled building blocks rather than read from the example. */
type Element = {
  shape: string;
  in?: string;
  on?: string;
  content?: readonly (readonly string[])[];
};

/** A text beside a border node on `on`, without an outline: a pin's name, `{stream}`, a value. */
const beside = (on: string, text: string): Element => ({
  shape: "rectangle",
  on,
  content: [[text]],
});

/** A small rectangle without content on `on`: a pin or a value pin. */
const pin = (on: string): Element => ({ shape: "rectangle", on, content: [] });

const ELEMENTS: Record<string, Element> = {
  // The frame and its partitions, Comb's divided into nested ones.
  drag: { shape: "frame", content: [["act Drag a node"]] },
  user: { shape: "rectangle", in: "drag" },
  comb: { shape: "rectangle", in: "drag" },
  shell: { shape: "rectangle", in: "comb" },
  engine: { shape: "rectangle", in: "comb" },
  host: { shape: "rectangle", in: "drag" },
  // Control nodes.
  start: { shape: "circle", in: "user", content: [] },
  merge: { shape: "diamond", in: "shell", content: [] },
  end: { shape: "ringed-circle", in: "shell", content: [] },
  told: { shape: "crossed-circle", in: "moving", content: [] },
  veto: { shape: "diamond", in: "host", content: [] },
  // Actions.
  press: { shape: "rounded-rectangle", in: "user", content: [["Press on a node"]] },
  "put-back": { shape: "rounded-rectangle", in: "shell", content: [["Put the node back"]] },
  "can-move": { shape: "rounded-rectangle", in: "host", content: [["canMoveInto", "icon"]] },
  // The loop node, its setup, test, and body, and what they hold, a streaming pin among it.
  "follow-loop": { shape: "rounded-rectangle", in: "shell", content: [["«loop»"]] },
  setup: { shape: "rectangle", in: "follow-loop" },
  test: { shape: "rectangle", in: "follow-loop" },
  body: { shape: "rectangle", in: "follow-loop" },
  lift: { shape: "rounded-rectangle", in: "setup", content: [["Lift the node"]] },
  "test-pointer": { shape: "rounded-rectangle", in: "test", content: [["Test the pointer"]] },
  follow: { shape: "rounded-rectangle", in: "body", content: [["Follow the pointer"]] },
  "follow-point": pin("follow"),
  "follow-point-name": beside("follow", "point"),
  "follow-point-stream": beside("follow", "{stream}"),
  // The conditional node, its clauses, and what they hold, a value pin among it.
  hit: { shape: "rounded-rectangle", in: "engine", content: [["«conditional»"]] },
  "over-container": { shape: "rectangle", in: "hit" },
  otherwise: { shape: "rectangle", in: "hit" },
  "take-container": {
    shape: "rounded-rectangle",
    in: "over-container",
    content: [["Take the deepest container"]],
  },
  "take-canvas": { shape: "rounded-rectangle", in: "otherwise", content: [["Take the canvas"]] },
  "take-canvas-container": pin("take-canvas"),
  "take-canvas-container-value": beside("take-canvas", "null"),
  // The structured activity node, and what it holds, a parameter set around two pins among it.
  moving: { shape: "rounded-rectangle", in: "engine", content: [["«structured»"]] },
  move: { shape: "rounded-rectangle", in: "moving", content: [["Move the node"]] },
  position: { shape: "rectangle", on: "move", content: [] },
  "move-x": pin("move"),
  "move-x-name": beside("move", "x"),
  "move-y": pin("move"),
  "move-y-name": beside("move", "y"),
  tell: { shape: "rounded-rectangle", in: "moving", content: [["Tell nodeMoved"]] },
  // A comment.
  "veto-note": {
    shape: "note",
    in: "host",
    content: [["A refused move tells"], ["no change."]],
  },
};

/** Each edge of the notation diagram, by its identifier: its source, its target, and its kind,
 *  written here from the ticket's description rather than read from the example. */
const EDGES: Record<string, [string, string, string]> = {
  "start-press": ["start", "press", "control-flow"],
  "press-follow-loop": ["press", "follow-loop", "control-flow"],
  "lift-test-pointer": ["lift", "test-pointer", "control-flow"],
  "test-pointer-follow": ["test-pointer", "follow", "control-flow"],
  "follow-loop-hit": ["follow-loop", "hit", "control-flow"],
  "hit-can-move": ["hit", "can-move", "control-flow"],
  "can-move-veto": ["can-move", "veto", "control-flow"],
  "veto-moving": ["veto", "moving", "control-flow"],
  "veto-put-back": ["veto", "put-back", "control-flow"],
  "move-tell": ["move", "tell", "control-flow"],
  "tell-told": ["tell", "told", "control-flow"],
  "moving-merge": ["moving", "merge", "control-flow"],
  "put-back-merge": ["put-back", "merge", "control-flow"],
  "merge-end": ["merge", "end", "control-flow"],
  "veto-note-anchor": ["veto-note", "veto", "anchor"],
};

/** The regions of the diagram, each with the name its band shows. */
const BANDS: Record<string, string> = {
  user: "User",
  comb: "Comb",
  shell: "Shell",
  engine: "Engine",
  host: "Host application",
  setup: "setup",
  test: "test",
  body: "body",
  "over-container": "over a container",
  otherwise: "else",
};

/** A node as the canvas draws it, by `inspect`. */
type Drawn = ReturnType<typeof window.uml.inspect>["nodes"][number];

/** Chooses the notation diagram in the sidebar and waits until its load has drawn. */
async function chooseNotation(page: Page): Promise<void> {
  await page.locator("#diagram").selectOption("notation");
  await page.evaluate(() => window.uml.loadReport);
}

/** Every node the canvas draws at the near level, the frame in two views, its top and its bottom
 *  half, and every edge label drawn. */
async function drawnNear(page: Page) {
  return page.evaluate(async () => {
    const nodes = new Map<string, Drawn>();
    const labels = new Map<string, string>();
    for (const y of [20, -640]) {
      window.uml.comb.setViewport({ x: 20, y, scale: 0.6 });
      await window.uml.comb.whenRendered();
      const scene = window.uml.inspect();
      for (const node of scene.nodes)
        if (!nodes.has(node.id) || node.content) nodes.set(node.id, node);
      for (const { edge, text } of scene.edgeLabels) labels.set(edge, text);
    }
    return { nodes: Object.fromEntries(nodes), labels: Object.fromEntries(labels) };
  });
}

/** A box in world units. */
type Box = { x: number; y: number; width: number; height: number };

/** Whether `box` lies within `outer`, to a hundredth of a world unit. */
const within = (box: Box, outer: Box) =>
  box.x >= outer.x - 0.01 &&
  box.y >= outer.y - 0.01 &&
  box.x + box.width <= outer.x + outer.width + 0.01 &&
  box.y + box.height <= outer.y + outer.height + 0.01;

/** Whether `a` and `b` overlap. */
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Expects node `id` drawn as `element` says: in its node shape, showing its content, within the
 *  partition, region, or container it lies in, which the example's copy `data` names, or centred
 *  on a side of the node it rides, which the copy names. */
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
    // A region is no node of the graph data, but a node lies in it by its identifier.
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

test("the notation diagram shows each element the load does not hold, in its node shape, its partition, its region, or its border", async ({
  page,
}) => {
  // Verifies: G-20, REN-node-shapes-cover-uml, ARCH-border-nodes-ride-sides,
  // Verifies: ARCH-regions-are-container-slots
  await page.goto("/");
  await open(page);
  await chooseNotation(page);
  await expect(page.locator("#count")).toHaveText("30 elements, 15 edges");
  await expect(page.locator("#palette")).toBeHidden();
  const drawn = await drawnNear(page);
  const { nodes, edges } = await page.evaluate(() => window.uml.exampleGraph());
  const kinds = await page.evaluate(() => window.uml.edgeKinds());
  const data = new Map(nodes.map((node) => [node.id, node]));
  expect(Object.keys(drawn.nodes).sort()).toEqual(Object.keys(ELEMENTS).sort());
  for (const [id, element] of Object.entries(ELEMENTS)) expectShown(id, element, drawn.nodes, data);
  // Each region is named in its band; Comb's partition holds the shell's and the engine's.
  const bands = Object.keys(BANDS).map((id) => [id, drawn.nodes[id]!.region?.band?.name]);
  expect(Object.fromEntries(bands)).toEqual(BANDS);
  // The loop, the conditional, and the structured node are dashed, and so is the parameter set;
  // a text beside a border node has no outline.
  for (const id of ["follow-loop", "hit", "moving", "position"])
    expect({ id, dashed: Array.isArray(drawn.nodes[id]!.outlined) }).toEqual({ id, dashed: true });
  const texts = Object.keys(ELEMENTS).filter(
    (id) => ELEMENTS[id]!.content?.length === 1 && ELEMENTS[id]!.on,
  );
  expect(texts.length).toBe(5);
  for (const id of texts)
    expect({ id, outlined: drawn.nodes[id]!.outlined }).toEqual({ id, outlined: "none" });
  // The parameter set lies around its two pins, and is drawn below them.
  const set = drawn.nodes.position!;
  for (const id of ["move-x", "move-y"])
    expect({ id, inSet: within(drawn.nodes[id]!, set) }).toEqual({ id, inSet: true });
  const order = Object.keys(drawn.nodes);
  expect(order.indexOf("position")).toBeLessThan(order.indexOf("move-x"));
  // `{stream}` and the pin's name stand on either side of the streaming pin.
  const [stream, point, name] = ["follow-point-stream", "follow-point", "follow-point-name"].map(
    (id) => drawn.nodes[id]!,
  );
  expect(stream!.y + stream!.height).toBeLessThanOrEqual(point!.y);
  expect(name!.y).toBeGreaterThanOrEqual(point!.y + point!.height);
  // No two elements that lie in the same partition, region, or container overlap.
  const held = Object.keys(ELEMENTS).filter((id) => ELEMENTS[id]!.in);
  const overlapping = held.flatMap((a) =>
    held
      .filter((b) => a < b && ELEMENTS[a]!.in === ELEMENTS[b]!.in)
      .filter((b) => overlap(drawn.nodes[a]!, drawn.nodes[b]!))
      .map((b) => `${a} ${b}`),
  );
  expect(overlapping).toEqual([]);
  // The veto's guards.
  expect(drawn.labels).toEqual({ "veto-moving": "[allowed]", "veto-put-back": "[refused]" });
  // Each edge joins its ends as its kind: a control flow solid with an open arrowhead, the anchor
  // dashed without one.
  const drawnAs = Object.fromEntries(
    edges.map((edge) => [
      edge.id,
      [edge.source, edge.target, kinds[edge.id], edge.arrow, edge.dash ?? null],
    ]),
  );
  expect(drawnAs).toEqual(
    Object.fromEntries(
      Object.entries(EDGES).map(([id, [source, target, kind]]) => [
        id,
        kind === "anchor"
          ? [source, target, kind, "none", [6, 4]]
          : [source, target, kind, "open", null],
      ]),
    ),
  );
});

test("a parameter set and its pins follow their action as it moves", async ({ page }) => {
  // Verifies: G-20, ARCH-border-nodes-ride-sides
  await page.goto("/");
  await open(page);
  await chooseNotation(page);
  const RIDING = ["position", "move-x", "move-y"];
  /** The boxes of the action and what rides it, as the canvas draws them at scale 1. */
  const boxes = () =>
    page.evaluate(
      async (ids) => {
        await window.uml.comb.whenRendered();
        const nodes = window.uml.inspect().nodes;
        return ids.map((id) => {
          const { x, y, width, height } = nodes.find((node) => node.id === id)!;
          return { x, y, width, height };
        });
      },
      ["move", ...RIDING],
    );
  await page.evaluate(async () => {
    const { x, y } = window.uml.inspect().nodes.find((node) => node.id === "move")!;
    window.uml.comb.setViewport({ x: 400 - x, y: 300 - y, scale: 1 });
    await window.uml.comb.whenRendered();
  });
  const before = await boxes();
  const action = before[0]!;
  // Right by 40 within the structured node, where nothing lies.
  const from = await pagePoint(page, action.x + action.width / 2, action.y + action.height / 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y);
  await page.mouse.move(from.x + 40, from.y);
  await page.mouse.up();
  const after = await boxes();
  const shift = (i: number) => [after[i]!.x - before[i]!.x, after[i]!.y - before[i]!.y];
  expect(shift(0)).toEqual([40, 0]);
  for (const [i, id] of RIDING.entries())
    expect({ id, shift: shift(i + 1) }).toEqual({ id, shift: [40, 0] });
  // The example's copy keeps the set and the pins on the action, at their sides and offsets.
  const kept = await page.evaluate(
    (ids) => window.uml.exampleGraph().nodes.filter((node) => ids.includes(node.id)),
    RIDING,
  );
  expect(kept.map(({ id, attachedTo, side, offset }) => [id, attachedTo, side, offset])).toEqual([
    ["position", "move", "left", 90],
    ["move-x", "move", "left", 40],
    ["move-y", "move", "left", 140],
  ]);
});
