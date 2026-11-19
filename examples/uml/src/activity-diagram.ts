// The activity diagram of the example (G-20): a load of Comb, from `createComb` to the first
// frame, in the notation of UML 2.5.1, inside the frame of its activity, which is divided side by
// side into the partitions of the host application, the shell, and the engine, each named in its
// band (ARCH-regions-are-container-slots). An action is a rounded rectangle of its name, a call
// behavior action the same with a rake beside it; a send signal action is a pentagon, an accept
// event action a notched rectangle, an accept time event action an hourglass above its time; an
// object node is a rectangle, a data store and a central buffer the same below «datastore» and
// «centralBuffer»; a pin is a small rectangle riding its action's border, its name a further border
// node beside it without an outline (ARCH-border-nodes-ride-sides); an activity parameter node is a
// rectangle of its name riding the frame's border. A decision is a diamond, a fork and a join bars
// given a height. An interruptible region is a dashed rounded rectangle that holds nodes, and so is
// an expansion region, its mode in the corner, an expansion node three small rectangles side by
// side on its border. A connector is an ellipse holding its letter, as wide as the letter makes it
// high, 90.51, so that it is round: the human chose that for history on 2026-11-19, and the
// connector takes the same. A control flow and an object flow are edges with an open arrowhead,
// labelled by their guard and weight; the interrupting edge and the edge of the exception handler
// are lightning bolts. A comment is a note, anchored by a dashed edge on a node or at the middle of
// an edge (API-edges-dock-nodes-or-edges). The user moves a node between partitions and regions,
// never out of the frame onto the canvas (API-edits-report-nested-changes).
import type {
  BorderNodeData,
  Comb,
  ContainerMove,
  EdgeData,
  NodeContent,
  NodeData,
  NodeShape,
  Outline,
  PlacedNodeData,
} from "comb";
import { labelOf, styleOf, type RelationshipKind } from "./relationships";
import { flowBetween } from "./rules";
import {
  ELLIPSIS,
  namedBorderNodes,
  nameContentOf,
  nameNodeId,
  ROW_LIMIT,
  sided,
  type ActivityKind,
  type ActivityNode,
  type DiagramData,
  type DiagramDescriptor,
  type Flow,
  type NodeKind,
  type Place,
} from "./shared";

/** The dash pattern of an interruptible and an expansion region's outline. */
const DASHED: Outline = [6, 4];

/** The building blocks of each kind: its node shape, its width, a height where it is given one,
 *  its outline where it is not solid, and whether it holds nodes. Settled with the human on
 *  2026-11-18, and the connector's roundness on 2026-11-19. */
export const ACTIVITY_SHAPES: Record<
  ActivityKind,
  { shape: NodeShape; width: number; height?: number; outline?: Outline; holds?: true }
> = {
  action: { shape: "rounded-rectangle", width: 240, height: 120 },
  "call-behavior-action": { shape: "rounded-rectangle", width: 240, height: 120 },
  "send-signal-action": { shape: "pentagon", width: 200 },
  "accept-event-action": { shape: "notched-rectangle", width: 200 },
  "accept-time-event-action": { shape: "hourglass", width: 120 },
  "object-node": { shape: "rectangle", width: 200 },
  "input-pin": { shape: "rectangle", width: 16 },
  "output-pin": { shape: "rectangle", width: 16 },
  "data-store": { shape: "rectangle", width: 200 },
  "central-buffer": { shape: "rectangle", width: 200 },
  "decision-node": { shape: "diamond", width: 32 },
  "fork-node": { shape: "bar", width: 8, height: 120 },
  "join-node": { shape: "bar", width: 8, height: 120 },
  "interruptible-region": {
    shape: "rounded-rectangle",
    width: 360,
    height: 240,
    outline: DASHED,
    holds: true,
  },
  "expansion-region": {
    shape: "rounded-rectangle",
    width: 360,
    height: 240,
    outline: DASHED,
    holds: true,
  },
  "expansion-node": { shape: "rectangle", width: 16 },
  connector: { shape: "ellipse", width: 64 },
  "activity-comment": { shape: "note", width: 240 },
  "activity-frame": { shape: "frame", width: 1200, height: 600 },
  "input-parameter": { shape: "rectangle", width: 200 },
  "output-parameter": { shape: "rectangle", width: 200 },
};

/** The kinds that ride the border of another node, and the kinds of node each may ride: a pin an
 *  action or a call behavior action, an expansion node an expansion region, an activity parameter
 *  node the frame. */
export const ACTIVITY_BORDERS: Partial<Record<ActivityKind, readonly ActivityKind[]>> = {
  "input-pin": ["action", "call-behavior-action"],
  "output-pin": ["action", "call-behavior-action"],
  "expansion-node": ["expansion-region"],
  "input-parameter": ["activity-frame"],
  "output-parameter": ["activity-frame"],
};

/** The name of the icon of a call behavior action, the rake the example registers. */
export const RAKE = "rake";

const title = (text: string) => [{ kind: "text", role: "title", text } as const];
const caption = (text: string) => [{ kind: "text", role: "caption", text } as const];

/** The content of each kind of node that shows one: a name as a title, a call behavior action's
 *  beside the rake, a data store's and a central buffer's below their keyword, an expansion
 *  region's mode as its keyword, a connector's letter, a comment's lines, and the frame's heading;
 *  a pin, whose name stands beside it, a control node, an expansion node, and an interruptible
 *  region show none. */
const CONTENT: Partial<Record<ActivityKind, (node: ActivityNode) => NodeContent>> = {
  action: ({ name = "" }) => [title(name)],
  "call-behavior-action": ({ name = "" }) => [
    [
      { kind: "text", role: "title", text: name, weight: 9 },
      { kind: "icon", name: RAKE },
    ],
  ],
  "send-signal-action": ({ name = "" }) => [title(name)],
  "accept-event-action": ({ name = "" }) => [title(name)],
  "accept-time-event-action": ({ name = "" }) => [title(name)],
  "object-node": ({ name = "" }) => [title(name)],
  "data-store": ({ name = "" }) => [caption("«datastore»"), title(name)],
  "central-buffer": ({ name = "" }) => [caption("«centralBuffer»"), title(name)],
  "expansion-region": ({ mode = "iterative" }) => [caption(`«${mode}»`)],
  connector: ({ name = "" }) => [title(name)],
  "activity-comment": ({ body = [] }) =>
    (body.length <= ROW_LIMIT ? body : [...body.slice(0, ROW_LIMIT - 1), ELLIPSIS]).map((text) => [
      { kind: "text", role: "body", text } as const,
    ]),
  "activity-frame": ({ name = "" }) => [title(`act ${name}`)],
  "input-parameter": ({ name = "" }) => [title(name)],
  "output-parameter": ({ name = "" }) => [title(name)],
};

/** The content of an activity node's node, as `CONTENT` gives it. */
export const contentOf = (node: ActivityNode): NodeContent => CONTENT[node.kind]?.(node) ?? [];

/** The kinds whose name stands in a node beside them: the pins. */
const NAMED_BESIDE: readonly ActivityKind[] = ["input-pin", "output-pin"];

/** The node that shows the name of `node`, a pin, and its content, none for any other kind. */
export function nameOf(node: ActivityNode): { id: string; content: NodeContent } | undefined {
  if (!NAMED_BESIDE.includes(node.kind)) return undefined;
  return { id: nameNodeId(node.id), content: nameContentOf(node.name) };
}

/** The identifiers of the two outer rectangles of the expansion node `id`, which is the middle one,
 *  before and after it along its side. */
export const outerBoxesOf = (id: string) => [`${id}-before`, `${id}-after`];

/** The nodes that go with `node` and with no other: a pin's name, an expansion node's outer
 *  rectangles. */
export function companionsOf(node: ActivityNode): string[] {
  if (NAMED_BESIDE.includes(node.kind)) return [nameNodeId(node.id)];
  return node.kind === "expansion-node" ? outerBoxesOf(node.id) : [];
}

/** The size of a node that holds others, or of the frame: its width, its height, and the frame's
 *  partitions, each its name and its width, the last taking the rest. */
export interface Size {
  width: number;
  height: number;
  partitions?: readonly { id: string; name: string; size: number }[];
}

/** The nodes of `node` placed at `place`: its own node, as high as `heightOf` gives it or its
 *  building block's height where that is more; a connector as wide as that, so that it is round;
 *  an interruptible or an expansion region a container, and the frame divided across into its
 *  partitions, both resizable and of `size`; a pin with the node of its name beside it, an
 *  expansion node with its outer rectangles. A node at a centre in `place` is centred on it. */
export function nodesOf(
  node: ActivityNode,
  place: Place,
  heightOf: Comb["heightOf"],
  size?: Size,
): NodeData[] {
  const block = ACTIVITY_SHAPES[node.kind];
  const own = ownOf(node, heightOf, size);
  const { width, content } = own;
  if ("attachedTo" in place) return borderNodesOf(node, own, place, heightOf);
  const given = size?.height ?? block.height;
  const height = heightGiven(given, content, () => heightOf(content, width, block.shape));
  const placed: PlacedNodeData = {
    ...own,
    ...(given === undefined ? {} : { height }),
    ...(block.holds ? { isContainer: true, resizable: true } : {}),
    ...(node.kind === "activity-frame" ? partitioned(node.id, size) : {}),
    x: place.x - width / 2,
    y: place.y - height / 2,
    ...(place.container === undefined ? {} : { container: place.container }),
  };
  return [placed];
}

/** What every node of `node` has: its identifier, its content, its building block's node shape
 *  and outline, and its width, of `size` where given, a connector's as its letter makes it high, so
 *  that it is round. */
function ownOf(node: ActivityNode, heightOf: Comb["heightOf"], size: Size | undefined) {
  const block = ACTIVITY_SHAPES[node.kind];
  const content = contentOf(node);
  const round = node.kind === "connector";
  const width = round ? heightOf(content, block.width, block.shape) : (size?.width ?? block.width);
  return {
    id: node.id,
    width,
    shape: block.shape,
    content,
    ...(block.outline ? { outline: block.outline } : {}),
  };
}

/** The height of a node given `given`, or none, showing `content`, which needs `needed`: as
 *  given without content, at least as its content needs with content, and as that without a
 *  height given. */
function heightGiven(
  given: number | undefined,
  content: NodeContent,
  needed: () => number,
): number {
  if (given === undefined) return needed();
  return content.length === 0 ? given : Math.max(given, needed());
}

/** What the frame adds to its node: its division across into the partitions of `size`, or two of
 *  half its width for a frame the palette drops, each named in its band and parted by a solid
 *  line; resizable. */
function partitioned(id: string, size: Size | undefined): Partial<PlacedNodeData> {
  const half = (size?.width ?? ACTIVITY_SHAPES["activity-frame"].width) / 2;
  const partitions = size?.partitions ?? [
    { id: `${id}-partition-1`, name: "Partition 1", size: half },
    { id: `${id}-partition-2`, name: "Partition 2", size: half },
  ];
  return {
    resizable: true,
    divide: "across",
    regions: partitions.map(({ id: region, name, size: extent }) => ({
      id: region,
      name,
      size: extent,
      line: "solid",
    })),
  };
}

/** The border nodes of `node` on the side `place` names: a pin and the node of its name beside
 *  it; an expansion node, the middle of three rectangles side by side, each as wide as it; an
 *  activity parameter node alone. */
function borderNodesOf(
  node: ActivityNode,
  own: Omit<BorderNodeData, "attachedTo" | "side" | "offset">,
  place: Extract<Place, { attachedTo: string }>,
  heightOf: Comb["heightOf"],
): BorderNodeData[] {
  const at = { attachedTo: place.attachedTo, side: place.side, offset: place.offset };
  if (NAMED_BESIDE.includes(node.kind)) return namedBorderNodes(own, place, node.name, heightOf);
  if (node.kind !== "expansion-node") return [{ ...own, ...at }];
  const [before, after] = outerBoxesOf(node.id);
  return [
    { ...own, ...at },
    { ...own, ...at, id: before!, offset: place.offset - own.width },
    { ...own, ...at, id: after!, offset: place.offset + own.width },
  ];
}

/** The activity node of `kind` the palette drops, with a name of its kind, an expansion region
 *  iterative, a comment of one line, a control node, an expansion node, and an interruptible
 *  region unnamed. */
export function newActivityNode(id: string, kind: ActivityKind): ActivityNode {
  const named: Partial<Record<ActivityKind, Partial<ActivityNode>>> = {
    action: { name: "NewAction" },
    "call-behavior-action": { name: "NewBehavior" },
    "send-signal-action": { name: "Signal" },
    "accept-event-action": { name: "Event" },
    "accept-time-event-action": { name: "after 1 s" },
    "object-node": { name: "object" },
    "input-pin": { name: "in" },
    "output-pin": { name: "out" },
    "data-store": { name: "store" },
    "central-buffer": { name: "buffer" },
    "expansion-region": { mode: "iterative" },
    connector: { name: "A" },
    "activity-comment": { body: ["A comment"] },
    "activity-frame": { name: "NewActivity" },
    "input-parameter": { name: "in" },
    "output-parameter": { name: "out" },
  };
  return { id, kind, ...named[kind] };
}

/** The label a flow shows: its guard in brackets and its weight in braces, each where it has one;
 *  none where it has neither. */
export function flowLabelOf({ guard, weight }: Flow): string | null {
  const text = [guard && `[${guard}]`, weight && `{weight=${weight}}`].filter(Boolean).join(" ");
  return text === "" ? null : text;
}

/** The kind a connection adds between nodes of kinds `source` and `target`: from a comment its
 *  anchor, else the flow `flowBetween` gives. */
export function connectedOf(source: NodeKind, target: NodeKind): RelationshipKind {
  return source === "activity-comment" ? "anchor" : flowBetween(source, target);
}

/** The example's veto of the user's move of a node into a container: a move into a partition or a
 *  region is allowed, one onto the canvas, out of the activity's frame, refused. */
export const canMoveInto = ({ container }: ContainerMove): boolean => container !== null;

/** A node of the diagram as written below: its activity node, and its centre in its container,
 *  or its side and offset on the node it rides; a node that holds others or the frame with its
 *  size. */
type Seed = { node: ActivityNode; place: Place; size?: Size };

/** A centre `x`, `y` in the partition or the region `container`. */
const at = (container: string, x: number, y: number) => ({ x, y, container });

/** The frame of the load, 1760 by 1520, its partitions 520, 600, and 640 wide, and what lies in
 *  them, each centre relative to its partition's or its region's top left corner. */
const SEEDS: Seed[] = [
  {
    node: { id: "load", kind: "activity-frame", name: "Load" },
    place: { x: 880, y: 760 },
    size: {
      width: 1760,
      height: 1520,
      partitions: [
        { id: "host", name: "Host application", size: 520 },
        { id: "shell", name: "Shell", size: 600 },
        { id: "engine", name: "Engine", size: 640 },
      ],
    },
  },
  {
    node: { id: "options", kind: "input-parameter", name: "options : CombOptions" },
    place: { attachedTo: "load", side: "left", offset: 174 },
  },
  {
    node: { id: "comb", kind: "output-parameter", name: "comb : Comb" },
    place: { attachedTo: "load", side: "top", offset: 1000 },
  },
  // The host application.
  {
    node: { id: "build", kind: "action", name: "Build the graph" },
    place: at("host", 260, 420),
  },
  {
    node: { id: "build-graph", kind: "output-pin", name: "graph" },
    place: { attachedTo: "build", side: "right", offset: 30 },
  },
  {
    node: { id: "graph", kind: "object-node", name: "graph : GraphData" },
    place: at("host", 260, 620),
  },
  {
    node: {
      id: "refused-note",
      kind: "activity-comment",
      body: ["A refused load throws", "GraphDataError."],
    },
    place: at("host", 260, 830),
  },
  {
    node: { id: "copy", kind: "data-store", name: "the host's copy" },
    place: at("host", 260, 1250),
  },
  // The shell.
  {
    node: { id: "create", kind: "call-behavior-action", name: "createComb" },
    place: at("shell", 300, 140),
  },
  {
    node: { id: "create-options", kind: "input-pin", name: "options" },
    place: { attachedTo: "create", side: "left", offset: 30 },
  },
  {
    node: { id: "create-comb", kind: "output-pin", name: "comb" },
    place: { attachedTo: "create", side: "right", offset: 30 },
  },
  {
    node: { id: "refuse", kind: "action", name: "Refuse the engine" },
    place: at("shell", 120, 330),
    size: { width: 200, height: 120 },
  },
  {
    node: { id: "refuse-error", kind: "input-pin", name: "error" },
    place: { attachedTo: "refuse", side: "right", offset: 30 },
  },
  {
    node: { id: "lost", kind: "send-signal-action", name: "EngineLostError" },
    place: at("shell", 470, 330),
  },
  {
    node: { id: "apply", kind: "call-behavior-action", name: "load" },
    place: at("shell", 300, 560),
  },
  {
    node: { id: "apply-graph", kind: "input-pin", name: "graph" },
    place: { attachedTo: "apply", side: "left", offset: 30 },
  },
  {
    node: { id: "apply-rows", kind: "output-pin", name: "rows" },
    place: { attachedTo: "apply", side: "right", offset: 30 },
  },
  { node: { id: "veto", kind: "decision-node" }, place: at("shell", 300, 720) },
  {
    node: { id: "graph-error", kind: "send-signal-action", name: "GraphDataError" },
    place: at("shell", 480, 820),
  },
  { node: { id: "fork", kind: "fork-node" }, place: at("shell", 300, 880) },
  {
    node: { id: "bind", kind: "action", name: "Bind the scene" },
    place: at("shell", 130, 1010),
    size: { width: 200, height: 64 },
  },
  { node: { id: "join", kind: "join-node" }, place: at("shell", 300, 1110) },
  {
    node: { id: "next-frame", kind: "accept-time-event-action", name: "next frame" },
    place: at("shell", 300, 1250),
  },
  {
    node: { id: "draw", kind: "call-behavior-action", name: "DrawFrame" },
    place: at("shell", 300, 1380),
  },
  {
    node: { id: "draw-heights", kind: "input-pin", name: "heights" },
    place: { attachedTo: "draw", side: "right", offset: 30 },
  },
  {
    node: { id: "draw-change", kind: "output-pin", name: "loaded" },
    place: { attachedTo: "draw", side: "left", offset: 30 },
  },
  {
    node: { id: "heights", kind: "central-buffer", name: "heights" },
    place: at("shell", 490, 1260),
  },
  { node: { id: "a-in", kind: "connector", name: "A" }, place: at("shell", 510, 1110) },
  // The engine.
  {
    node: { id: "interruptible", kind: "interruptible-region" },
    place: at("engine", 320, 300),
    size: { width: 560, height: 300 },
  },
  {
    node: { id: "instantiate", kind: "action", name: "Instantiate the engine" },
    place: at("interruptible", 170, 90),
    size: { width: 240, height: 64 },
  },
  {
    node: { id: "trap", kind: "accept-event-action", name: "trap" },
    place: at("interruptible", 170, 220),
  },
  {
    node: {
      id: "trap-note",
      kind: "activity-comment",
      body: ["A trap loses the engine", "of every Comb on the page."],
    },
    place: at("engine", 320, 560),
  },
  {
    node: { id: "measure", kind: "expansion-region", mode: "iterative" },
    place: at("engine", 320, 900),
    size: { width: 400, height: 300 },
  },
  {
    node: { id: "rows", kind: "expansion-node" },
    place: { attachedTo: "measure", side: "top", offset: 200 },
  },
  {
    node: { id: "row-heights", kind: "expansion-node" },
    place: { attachedTo: "measure", side: "bottom", offset: 200 },
  },
  {
    node: { id: "lay-out", kind: "action", name: "Lay out the row" },
    place: at("measure", 200, 150),
  },
  {
    node: { id: "lay-out-row", kind: "input-pin", name: "row" },
    place: { attachedTo: "lay-out", side: "left", offset: 30 },
  },
  {
    node: { id: "lay-out-height", kind: "output-pin", name: "height" },
    place: { attachedTo: "lay-out", side: "right", offset: 30 },
  },
  { node: { id: "a-out", kind: "connector", name: "A" }, place: at("engine", 320, 1250) },
];

/** Each flow: its source, its target, its kind where it is no control flow, and its guard and
 *  weight. */
const FLOWS: [string, string, RelationshipKind?, Flow?][] = [
  ["options", "create-options", "object-flow"],
  ["create-comb", "comb", "object-flow"],
  ["create", "instantiate"],
  ["instantiate", "apply"],
  ["build-graph", "graph", "object-flow"],
  ["graph", "apply-graph", "object-flow"],
  ["apply", "veto"],
  ["veto", "graph-error", "control-flow", { guard: "refused" }],
  ["veto", "fork", "control-flow", { guard: "accepted" }],
  ["fork", "bind"],
  ["fork", "measure"],
  ["apply-rows", "rows", "object-flow"],
  ["rows", "lay-out-row", "object-flow"],
  ["lay-out-height", "row-heights", "object-flow"],
  ["row-heights", "a-out", "object-flow"],
  ["a-in", "heights", "object-flow"],
  ["heights", "draw-heights", "object-flow", { weight: "*" }],
  ["bind", "join"],
  ["measure", "join"],
  ["join", "next-frame"],
  ["next-frame", "draw"],
  ["draw-change", "copy", "object-flow"],
  ["trap", "lost", "interrupting-edge"],
];

/** The edge of a flow, docked on the outline at both ends, drawn as its kind and labelled where
 *  it has a guard or a weight. */
function flowEdgeOf([source, target, kind = "control-flow", flow = {}]: (typeof FLOWS)[number]) {
  const text = flowLabelOf(flow);
  const edge: EdgeData = {
    id: `${source}-${target}`,
    source,
    target,
    sourceSide: "outline",
    targetSide: "outline",
    ...styleOf(kind),
    ...(text === null ? {} : { labels: [labelOf(kind, text)] }),
  };
  return { edge, kind, flow };
}

/** The edges that are no flow: the exception handler, from the protected action to the pin of the
 *  handler's body that takes the error, and the anchors of the comments, one on the decision of
 *  the veto, one at the middle of the interrupting edge. */
const OTHERS: [EdgeData, RelationshipKind][] = [
  [
    {
      id: "instantiate-refuse-error",
      source: "instantiate",
      target: "refuse-error",
      sourceSide: "outline",
      targetSide: "outline",
      ...styleOf("exception-handler"),
    },
    "exception-handler",
  ],
  [
    {
      id: "refused-note-anchor",
      source: "refused-note",
      target: "veto",
      sourceSide: "outline",
      targetSide: "outline",
      ...styleOf("anchor"),
    },
    "anchor",
  ],
  [
    {
      id: "trap-note-anchor",
      source: "trap-note",
      sourceSide: "outline",
      targetEdge: "trap-lost",
      targetT: 0.5,
      ...styleOf("anchor"),
    },
    "anchor",
  ],
];

/** The activity diagram as graph data, each node placed by the height `heightOf` gives it, with
 *  the activity node of each node but a pin's name and an expansion node's outer rectangles, the
 *  kind of each edge, and the guard and weight of each flow, by their identifiers. */
export function activityDiagram(heightOf: Comb["heightOf"]): DiagramData {
  const flows = FLOWS.map(flowEdgeOf);
  const nodes: NodeData[] = [];
  for (const { node, place, size } of SEEDS)
    nodes.push(...nodesOf(node, sided(place, nodes, heightOf), heightOf, size));
  return {
    graph: { nodes, edges: [...flows.map(({ edge }) => edge), ...OTHERS.map(([edge]) => edge)] },
    classifiers: new Map(),
    states: new Map(),
    activities: new Map(SEEDS.map(({ node }) => [node.id, structuredClone(node)])),
    kinds: new Map([
      ...flows.map(({ edge, kind }) => [edge.id, kind] as const),
      ...OTHERS.map(([edge, kind]) => [edge.id, kind] as const),
    ]),
    transitions: new Map(),
    flows: new Map(flows.map(({ edge, flow }) => [edge.id, { ...flow }])),
  };
}

/** The activity diagram as the host application chooses it: the palette drops every kind, each
 *  edited as its notation shows it; a connection adds a control or an object flow, or from a
 *  comment an anchor, docked on the outline at both ends; the sidebar edits a flow's guard and
 *  weight; the legend is hidden; and the user moves no node out of the frame. */
export const ACTIVITY_DIAGRAM: DiagramDescriptor = {
  id: "activity",
  name: "Activity diagram",
  build: activityDiagram,
  nouns: ["elements", "edges"],
  nodes: [
    { kind: "action", name: "Action", form: "name" },
    { kind: "call-behavior-action", name: "Call behavior action", form: "name" },
    { kind: "send-signal-action", name: "Send signal action", form: "name" },
    { kind: "accept-event-action", name: "Accept event action", form: "name" },
    { kind: "accept-time-event-action", name: "Accept time event action", form: "name" },
    { kind: "object-node", name: "Object node", form: "name" },
    { kind: "input-pin", name: "Input pin", form: "name" },
    { kind: "output-pin", name: "Output pin", form: "name" },
    { kind: "data-store", name: "Data store", form: "name" },
    { kind: "central-buffer", name: "Central buffer", form: "name" },
    { kind: "decision-node", name: "Decision", form: "none" },
    { kind: "fork-node", name: "Fork", form: "none" },
    { kind: "join-node", name: "Join", form: "none" },
    { kind: "interruptible-region", name: "Interruptible region", form: "none" },
    { kind: "expansion-region", name: "Expansion region", form: "mode" },
    { kind: "expansion-node", name: "Expansion node", form: "none" },
    { kind: "connector", name: "Connector", form: "name" },
    { kind: "activity-comment", name: "Comment", form: "lines" },
    { kind: "activity-frame", name: "Activity frame", form: "name" },
    { kind: "input-parameter", name: "Input parameter node", form: "name" },
    { kind: "output-parameter", name: "Output parameter node", form: "name" },
  ],
  connected: "control-flow",
  connectedOf,
  docking: () => ({ sourceSide: "outline", targetSide: "outline" }),
  edgeForm: "guard-and-weight",
  edgeForms: { anchor: "none", "exception-handler": "none" },
  selected: { node: "element", edge: "flow" },
  legend: false,
  canMoveInto,
};
