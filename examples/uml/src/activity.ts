// The notation of UML 2.5.1 in which the example draws an activity (G-20), which its activity
// diagram of a load and its notation diagram share, so that neither diagram's file imports the
// other's. An action is a rounded rectangle of its name, a call behavior action the same with a
// rake beside it; a send signal action is a pentagon, an accept event action a notched rectangle,
// an accept time event action an hourglass above its time; an object node is a rectangle, a data
// store and a central buffer the same below «datastore» and «centralBuffer»; a pin is a small
// rectangle riding its action's border, its name a further border node beside it without an
// outline (ARCH-border-nodes-ride-sides), and so are a value pin's value and `{stream}` beside a
// streaming pin; a parameter set is a dashed border node around its pins; an activity parameter
// node is a rectangle of its name riding the frame's border. An initial node is a filled circle,
// an activity final a ringed circle, a flow final a crossed circle, a decision and a merge
// diamonds, a fork and a join bars given a height. An interruptible region is a dashed rounded
// rectangle that holds nodes, and so are an expansion region, its mode in the corner, and a
// structured activity node below «structured»; an expansion node is three small rectangles side by
// side on its region's border; a conditional node and a loop node are dashed rounded rectangles
// below «conditional» and «loop», divided one above the other into their named clauses, or their
// setup, test, and body (ARCH-regions-are-container-slots). A connector is an ellipse holding its
// letter, as wide as the letter makes it high, 90.51, so that it is round: the human chose that
// for history on 2026-11-19, and the connector takes the same. A control flow and an object flow
// are edges with an open arrowhead, labelled by their guard and weight; the interrupting edge and
// the edge of the exception handler are lightning bolts. A comment is a note, anchored by a dashed
// edge on a node or at the middle of an edge (API-edges-dock-nodes-or-edges). The frame of the
// activity is divided side by side into its partitions, and a partition may be divided again. The
// user moves a node between partitions and regions, never out of the frame onto the canvas
// (API-edits-report-nested-changes).
import type {
  BorderNodeData,
  Comb,
  ContainerMove,
  Divide,
  EdgeData,
  NodeContent,
  NodeData,
  NodeShape,
  Outline,
  PlacedNodeData,
  RegionData,
} from "comb";
import { labelOf, styleOf, type RelationshipKind } from "./relationships";
import { allows, flowBetween } from "./rules";
import {
  ELLIPSIS,
  namedBorderNodes,
  nameContentOf,
  nameNodeId,
  nameWidth,
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

/** The dash pattern of the outline of an interruptible and an expansion region, a structured,
 *  a conditional, and a loop node, and a parameter set. */
const DASHED: Outline = [6, 4];

/** The building blocks of each kind: its node shape, its width, a height where it is given one,
 *  its outline where it is not solid, whether it holds nodes, the direction its regions divide it
 *  in where it has regions, and the names of the regions one the palette drops takes. Settled with
 *  the human on 2026-11-18 for tickets 12 and 14 of uml-diagrams, and the connector's roundness
 *  and the regions of a dropped conditional and loop node on 2026-11-19 for tickets 14 and 15. */
export const ACTIVITY_SHAPES: Record<
  ActivityKind,
  {
    shape: NodeShape;
    width: number;
    height?: number;
    outline?: Outline;
    holds?: true;
    divide?: Divide;
    regions?: readonly string[];
  }
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
  "merge-node": { shape: "diamond", width: 32 },
  "initial-node": { shape: "circle", width: 20 },
  "activity-final": { shape: "ringed-circle", width: 24 },
  "flow-final": { shape: "crossed-circle", width: 24 },
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
  "structured-node": {
    shape: "rounded-rectangle",
    width: 360,
    height: 240,
    outline: DASHED,
    holds: true,
  },
  "conditional-node": {
    shape: "rounded-rectangle",
    width: 360,
    height: 240,
    outline: DASHED,
    divide: "down",
    regions: ["Clause 1", "Clause 2"],
  },
  "loop-node": {
    shape: "rounded-rectangle",
    width: 360,
    height: 240,
    outline: DASHED,
    divide: "down",
    regions: ["setup", "test", "body"],
  },
  "value-pin": { shape: "rectangle", width: 16 },
  "parameter-set": { shape: "rectangle", width: 28, outline: DASHED },
  connector: { shape: "ellipse", width: 64 },
  "activity-comment": { shape: "note", width: 240 },
  "activity-frame": {
    shape: "frame",
    width: 1200,
    height: 600,
    divide: "across",
    regions: ["Partition 1", "Partition 2"],
  },
  "input-parameter": { shape: "rectangle", width: 200 },
  "output-parameter": { shape: "rectangle", width: 200 },
};

/** The kinds that ride the border of another node, and the kinds of node each may ride: a pin, a
 *  value pin, and a parameter set an action or a call behavior action, an expansion node an
 *  expansion region, an activity parameter node the frame. */
export const ACTIVITY_BORDERS: Partial<Record<ActivityKind, readonly ActivityKind[]>> = {
  "input-pin": ["action", "call-behavior-action"],
  "output-pin": ["action", "call-behavior-action"],
  "value-pin": ["action", "call-behavior-action"],
  "parameter-set": ["action", "call-behavior-action"],
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
 *  region's mode as its keyword, the keyword of a structured, a conditional, and a loop node, a
 *  connector's letter, a comment's lines, and the frame's heading; a pin and a value pin, beside
 *  which their name or value stands, a parameter set, a control node, an expansion node, and an
 *  interruptible region show none. */
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
  "structured-node": () => [caption("«structured»")],
  "conditional-node": () => [caption("«conditional»")],
  "loop-node": () => [caption("«loop»")],
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

/** The identifier of the node that shows `{stream}` beside the streaming pin `id`. */
export const streamNodeId = (id: string) => `${id}-stream`;

/** The identifier of the node that shows the value of the value pin `id` beside it. */
const valueNodeId = (id: string) => `${id}-value`;

/** What a streaming pin shows beside it besides its name. */
const STREAM = "{stream}";

/** The node that shows the text beside `node`, a pin's name or a value pin's value, with that
 *  text and the content showing it; none for any other kind. */
export function nameOf(
  node: ActivityNode,
): { id: string; text: string; content: NodeContent } | undefined {
  const [id, text] = NAMED_BESIDE.includes(node.kind)
    ? [nameNodeId(node.id), node.name]
    : node.kind === "value-pin"
      ? [valueNodeId(node.id), node.value]
      : [];
  return id === undefined ? undefined : { id, text: text ?? "", content: nameContentOf(text) };
}

/** The identifiers of the two outer rectangles of the expansion node `id`, which is the middle one,
 *  before and after it along its side. */
const outerBoxesOf = (id: string) => [`${id}-before`, `${id}-after`];

/** The nodes that go with `node` and with no other: a pin's name or a value pin's value, and
 *  `{stream}` beside either where it streams; an expansion node's outer rectangles. */
export function companionsOf(node: ActivityNode): string[] {
  const beside = nameOf(node);
  if (beside) return [beside.id, ...(node.stream ? [streamNodeId(node.id)] : [])];
  return node.kind === "expansion-node" ? outerBoxesOf(node.id) : [];
}

/** A region of a node: its identifier, its name, its size along the direction of its division,
 *  the last region taking the rest, and the regions it is divided into the same way, as a
 *  partition holds nested ones. */
interface Region {
  id: string;
  name: string;
  size: number;
  regions?: readonly Region[];
}

/** The size of a node that holds others or has regions, or of a parameter set: its width, its
 *  height, and its regions. */
interface Size {
  width: number;
  height: number;
  regions?: readonly Region[];
}

/** The nodes of `node` placed at `place`: its own node, as high as `heightOf` gives it or its
 *  building block's height where that is more; a connector as wide as that, so that it is round;
 *  a node that holds others a container, and the frame, a conditional, and a loop node divided
 *  into their regions, each resizable and of `size`; a pin with the node of its name beside it,
 *  and of `{stream}` where it streams, a value pin with the node of its value, an expansion node
 *  with its outer rectangles, a parameter set of `size`. A node at a centre in `place` is centred
 *  on it. */
export function nodesOf(
  node: ActivityNode,
  place: Place,
  heightOf: Comb["heightOf"],
  size?: Size,
): NodeData[] {
  const block = ACTIVITY_SHAPES[node.kind];
  const own = ownOf(node, heightOf, size);
  const { width, content } = own;
  if ("attachedTo" in place) return borderNodesOf(node, own, place, heightOf, size);
  const given = size?.height ?? block.height;
  const height = heightGiven(given, content, () => heightOf(content, width, block.shape));
  const placed: PlacedNodeData = {
    ...own,
    ...(given === undefined ? {} : { height }),
    ...(block.holds ? { isContainer: true, resizable: true } : {}),
    ...(block.divide
      ? dividedOf(node, block.divide, size, () => height - heightOf(content, width, block.shape))
      : {}),
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

/** What `node`, divided `divide`, adds to its node: its regions of `size`, each named in its band
 *  and parted by a solid line, a region divided again the same way; resizable. A node the palette
 *  drops, without regions given, takes those its building block names, each an equal share of its
 *  width across, or of the height below its content, `below`, down, its identifier the node's and
 *  the region's name; a node whose building block names none takes none. */
function dividedOf(
  { id, kind }: ActivityNode,
  divide: Divide,
  size: Size | undefined,
  below: () => number,
): Partial<PlacedNodeData> {
  const names = ACTIVITY_SHAPES[kind].regions ?? [];
  const share =
    (divide === "across" ? (size?.width ?? ACTIVITY_SHAPES[kind].width) : below()) / names.length;
  const regions =
    size?.regions ??
    names.map((name) => ({
      id: `${id}-${name.toLowerCase().replaceAll(" ", "-")}`,
      name,
      size: share,
    }));
  return regions.length > 0 ? { resizable: true, divide, regions: regionsOf(regions, divide) } : {};
}

/** `regions` as Comb takes them, each parted from the next by a solid line, and divided `divide`
 *  into its own where it has any. */
function regionsOf(regions: readonly Region[], divide: Divide): RegionData[] {
  return regions.map(({ id, name, size, regions: inner }) => ({
    id,
    name,
    size,
    line: "solid",
    ...(inner ? { divide, regions: regionsOf(inner, divide) } : {}),
  }));
}

/** The border nodes of `node` on the side `place` names: a pin and the node of its name beside
 *  it, or a value pin and the node of its value, with `{stream}` on its other side where it
 *  streams; an expansion node, the middle of three rectangles side by side, each as wide as it;
 *  a parameter set as high as `size` gives it, and an activity parameter node, alone. */
function borderNodesOf(
  node: ActivityNode,
  own: Omit<BorderNodeData, "attachedTo" | "side" | "offset">,
  place: Extract<Place, { attachedTo: string }>,
  heightOf: Comb["heightOf"],
  size: Size | undefined,
): BorderNodeData[] {
  const at = { attachedTo: place.attachedTo, side: place.side, offset: place.offset };
  const beside = nameOf(node);
  if (beside) {
    const [pin, name] = namedBorderNodes(own, place, beside.text, heightOf, beside.id);
    return node.stream ? [pin!, name!, streamNodeOf(pin!, name!, heightOf)] : [pin!, name!];
  }
  if (node.kind === "parameter-set")
    return [{ ...own, ...at, ...(size === undefined ? {} : { height: size.height }) }];
  if (node.kind !== "expansion-node") return [{ ...own, ...at }];
  const [before, after] = outerBoxesOf(node.id);
  return [
    { ...own, ...at },
    { ...own, ...at, id: before!, offset: place.offset - own.width },
    { ...own, ...at, id: after!, offset: place.offset + own.width },
  ];
}

/** The node of `{stream}` beside the pin `pin`, without an outline, 4 before it on its side where
 *  its name `name` stands after it, else 4 after it. */
export function streamNodeOf(
  pin: BorderNodeData,
  name: BorderNodeData,
  heightOf: Comb["heightOf"],
): BorderNodeData {
  const content = nameContentOf(STREAM);
  const width = nameWidth(STREAM);
  const across = pin.side === "top" || pin.side === "bottom";
  const reach = pin.width / 2 + 4 + (across ? width : heightOf(content, width)) / 2;
  return {
    id: streamNodeId(pin.id),
    width,
    content,
    outline: "none",
    attachedTo: pin.attachedTo,
    side: pin.side,
    offset: name.offset > pin.offset ? pin.offset - reach : pin.offset + reach,
  };
}

/** The activity node of `kind` the palette drops, with a name of its kind, a value pin's value 0,
 *  an expansion region iterative, a comment of one line, a control node, an expansion node, an
 *  interruptible region, a structured, a conditional, and a loop node, and a parameter set
 *  unnamed. */
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
    "value-pin": { value: "0" },
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

/** Why the example refuses a parameter set dropped on no action. */
export const NO_ACTION = "A parameter set groups pins of an action; drop it on an action's side.";

/** How long a parameter set the palette drops is along its side, and how far each of its two pins
 *  stands from its middle. */
const SET_LENGTH = 92;
const SET_PIN = 30;

/** What the palette drops of the parameter set `id` on the side `place` names: the dashed set,
 *  centred at the offset of `place` but no nearer an end of the side than half its length, and
 *  two new input pins `a` and `b` inside it, each with its name beside it, and their activity
 *  nodes; the set added before its pins, so that they are drawn above it, as the notation
 *  diagram's seed is. */
export function droppedParameterSet(
  id: string,
  place: Extract<Place, { attachedTo: string }>,
  heightOf: Comb["heightOf"],
): { nodes: NodeData[]; activities: ActivityNode[] } {
  const half = SET_LENGTH / 2;
  const offset = Math.min(Math.max(place.offset, half), (place.length ?? Infinity) - half);
  const thick = ACTIVITY_SHAPES["parameter-set"].width;
  const across = place.side === "top" || place.side === "bottom";
  const size = across ? { width: SET_LENGTH, height: thick } : { width: thick, height: SET_LENGTH };
  const set: ActivityNode = { id, kind: "parameter-set" };
  const pins = (["a", "b"] as const).map((name): ActivityNode => ({
    id: `${id}-${name}`,
    kind: "input-pin",
    name,
  }));
  const nodes = [
    ...nodesOf(set, { ...place, offset }, heightOf, size),
    ...pins.flatMap((pin, i) =>
      nodesOf(pin, { ...place, offset: offset + (i === 0 ? -SET_PIN : SET_PIN) }, heightOf),
    ),
  ];
  return { nodes, activities: [set, ...pins] };
}

/** Why the example refuses a partition the palette drops neither on the frame nor on a partition,
 *  and one dropped onto the partition `name`, which holds elements. */
export const NO_PARTITION =
  "A partition divides an empty partition or adds one to the frame; drop it there.";
export const holdsElements = (name: string) =>
  `${name} holds elements; only an empty partition is divided.`;

/** The partitions of the frame `frame` once the partition the palette drops as `id` lands on
 *  `onto`, `width` wide, as the human settled on 2026-11-19: on the frame itself, a further
 *  partition `id` after the others, named by its number, as wide as a partition of a frame the
 *  palette drops, the last before it keeping the rest of the frame it took; on an empty
 *  partition, at any depth, that partition divided across into "Partition 1" and "Partition 2",
 *  `<id>-1` and `<id>-2`, an equal share each. */
export function partitionedOf(
  frame: NodeData,
  onto: string,
  id: string,
  width: number,
): RegionData[] {
  const regions = frame.regions ?? [];
  const partition = (own: string, name: string, size: number): RegionData => ({
    id: own,
    name,
    size,
    line: "solid",
  });
  if (onto === frame.id) {
    const before = regions.slice(0, -1);
    const rest = width - before.reduce((sum, { size }) => sum + size, 0);
    const last = regions
      .slice(-1)
      .map((region) => ({ ...region, size: Math.max(region.size, rest) }));
    const block = ACTIVITY_SHAPES["activity-frame"];
    const share = block.width / block.regions!.length;
    return [...before, ...last, partition(id, `Partition ${regions.length + 1}`, share)];
  }
  const divided = (list: readonly RegionData[]): RegionData[] =>
    list.map((region) =>
      region.id === onto
        ? {
            ...region,
            divide: "across",
            regions: [1, 2].map((n) => partition(`${id}-${n}`, `Partition ${n}`, width / 2)),
          }
        : { ...region, ...(region.regions ? { regions: divided(region.regions) } : {}) },
    );
  return divided(regions);
}

/** The label a flow shows: its guard in brackets and its weight in braces, each where it has one;
 *  none where it has neither. */
export function flowLabelOf({ guard, weight }: Flow): string | null {
  const text = [guard && `[${guard}]`, weight && `{weight=${weight}}`].filter(Boolean).join(" ");
  return text === "" ? null : text;
}

/** The kind a connection adds between nodes of kinds `source` and `target`: from a comment its
 *  anchor; from an action to an input pin, where the rules allow one, an exception handler, as the
 *  human decided on 2026-11-20; else the flow `flowBetween` gives. */
function connectedOf(source: NodeKind, target: NodeKind): RelationshipKind {
  if (source === "activity-comment") return "anchor";
  if (allows({ source, target, kind: "exception-handler" })) return "exception-handler";
  return flowBetween(source, target);
}

/** The example's veto of the user's move of a node into a container: a move into a partition or a
 *  region is allowed, one onto the canvas, out of the activity's frame, refused. */
const canMoveInto = ({ container }: ContainerMove): boolean => container !== null;

/** A node of a diagram as written in its file: its activity node, and its centre in its container,
 *  or its side and offset on the node it rides; a node that holds others or has regions, the
 *  frame, and a parameter set with its size. */
export type Seed = { node: ActivityNode; place: Place; size?: Size };

/** A centre `x`, `y` in the partition or the region `container`. */
export const at = (container: string, x: number, y: number) => ({ x, y, container });

/** A flow as written in a diagram's file: its source, its target, its kind where it is no control
 *  flow, and its guard and weight. */
export type FlowSeed = [string, string, RelationshipKind?, Flow?];

/** The edge of a flow, docked on the outline at both ends, drawn as its kind and labelled where
 *  it has a guard or a weight. */
function flowEdgeOf([source, target, kind = "control-flow", flow = {}]: FlowSeed) {
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

/** An activity diagram as graph data, of the nodes of `seeds`, each placed by the height
 *  `heightOf` gives it, the edges of `flows`, and the edges `others` that are no flow, each with
 *  its kind: the activity node of each node but what goes with a border node beside it, the kind
 *  of each edge, and the guard and weight of each flow, by their identifiers. */
export function activityData(
  seeds: readonly Seed[],
  flows: readonly FlowSeed[],
  others: readonly (readonly [EdgeData, RelationshipKind])[],
  heightOf: Comb["heightOf"],
): DiagramData {
  const edges = flows.map(flowEdgeOf);
  const nodes: NodeData[] = [];
  for (const { node, place, size } of seeds)
    nodes.push(...nodesOf(node, sided(place, nodes, heightOf), heightOf, size));
  return {
    graph: { nodes, edges: [...edges.map(({ edge }) => edge), ...others.map(([edge]) => edge)] },
    classifiers: new Map(),
    states: new Map(),
    activities: new Map(seeds.map(({ node }) => [node.id, structuredClone(node)])),
    useCases: new Map(),
    kinds: new Map([
      ...edges.map(({ edge, kind }) => [edge.id, kind] as const),
      ...others.map(([edge, kind]) => [edge.id, kind] as const),
    ]),
    transitions: new Map(),
    flows: new Map(edges.map(({ edge, flow }) => [edge.id, { ...flow }])),
  };
}

/** How the example edits an activity diagram, whichever it shows: a connection adds a control or
 *  an object flow, from a comment an anchor, or from an action to an input pin an exception
 *  handler, docked on the outline at both ends; the sidebar
 *  edits a flow's guard and weight, and changes its kind among the control flow, the object flow,
 *  the interrupting edge, and the exception handler, as the human decided on 2026-11-20, each
 *  offered where the rules allow it between the flow's ends; the legend is hidden; and the user
 *  moves no node out of the frame. */
export const ACTIVITY_EDITS = {
  connected: "control-flow",
  connectedOf,
  docking: () => ({ sourceSide: "outline", targetSide: "outline" }),
  edgeForm: "guard-and-weight",
  edgeForms: { anchor: "none", "exception-handler": "none" },
  kinds: ["control-flow", "object-flow", "interrupting-edge", "exception-handler"],
  selected: { node: "element", edge: "flow" },
  legend: false,
  canMoveInto,
} satisfies Partial<DiagramDescriptor>;
