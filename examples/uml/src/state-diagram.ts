// The state diagram of the example (G-12, G-20): the life of a Comb, from `createComb` to
// `destroy`, in the notation of UML 2.5.1, inside the frame of its state machine. A state is a
// rounded rectangle of its name and, below a separator, its entry, do, and exit behaviours, its
// internal transitions, and its deferred triggers; a composite state is one divided into orthogonal
// regions by dashed lines; a submachine state names the state machine it refers to, its connection
// point references on its border; a state list names its states. The pseudostates take Comb's node
// shapes (REN-node-shapes-cover-uml), each as small as its node shape allows: a filled circle for
// an initial pseudostate and a smaller one for a junction, a cross for a terminate, a diamond for a
// choice, a bar for a fork and a join, a round ellipse of 90.51 holding `H` or `H*` for history,
// the least an ellipse with content is high, and a hollow or a crossed circle for an entry or an
// exit point, ridden on the border of its composite state (ARCH-border-nodes-ride-sides), its name
// a further border node beside it without an outline. A transition is an edge with an open
// arrowhead, labelled by its trigger, guard, and effect; one that sends or receives a signal runs
// through a pentagon or a notched rectangle naming it, as two edges, the first carrying the label.
// A comment is a note, anchored by a dashed edge on a state or, at the middle, on a transition
// (API-edges-dock-nodes-or-edges). Every transition docks on the outline, a loop on its side.
import type {
  BorderNodeData,
  Comb,
  Divide,
  EdgeData,
  EdgePatch,
  NodeContent,
  NodeData,
  NodeShape,
  Outline,
  PlacedNodeData,
  RegionData,
  Side,
} from "comb";
import { labelOf, styleOf } from "./relationships";
import {
  ELLIPSIS,
  ROW_LIMIT,
  type AddedEdge,
  type DiagramData,
  type DiagramDescriptor,
  type State,
  type StateKind,
  type Transition,
} from "./shared";

/** The node shape and the width of each kind: a state as wide as its name needs, a pseudostate as
 *  small as its node shape allows. History is laid out 64 wide and then made as wide as its letter
 *  makes it high, 90.51, so that it is round (`ROUND`); the human chose that on 2026-11-19. */
export const STATE_SHAPES: Record<StateKind, { shape: NodeShape; width: number }> = {
  state: { shape: "rounded-rectangle", width: 200 },
  composite: { shape: "rounded-rectangle", width: 360 },
  submachine: { shape: "rounded-rectangle", width: 240 },
  "state-list": { shape: "rounded-rectangle", width: 200 },
  final: { shape: "ringed-circle", width: 24 },
  initial: { shape: "circle", width: 20 },
  terminate: { shape: "cross", width: 20 },
  choice: { shape: "diamond", width: 32 },
  junction: { shape: "circle", width: 14 },
  fork: { shape: "bar", width: 120 },
  join: { shape: "bar", width: 120 },
  "shallow-history": { shape: "ellipse", width: 64 },
  "deep-history": { shape: "ellipse", width: 64 },
  "entry-point": { shape: "ellipse", width: 16 },
  "exit-point": { shape: "crossed-circle", width: 16 },
  "entry-reference": { shape: "ellipse", width: 16 },
  "exit-reference": { shape: "crossed-circle", width: 16 },
  "send-signal": { shape: "pentagon", width: 180 },
  "receive-signal": { shape: "notched-rectangle", width: 180 },
  comment: { shape: "note", width: 220 },
  frame: { shape: "frame", width: 600 },
};

/** The kinds that ride the border of another node, and the kinds of node each may ride: an entry
 *  or an exit point a composite state or the frame of the state machine, a connection point
 *  reference a submachine state. */
export const BORDER_KINDS: Partial<Record<StateKind, readonly StateKind[]>> = {
  "entry-point": ["composite", "frame"],
  "exit-point": ["composite", "frame"],
  "entry-reference": ["submachine"],
  "exit-reference": ["submachine"],
};

/** The kinds that hold other nodes: the frame of the state machine, and a composite state by its
 *  regions. */
const HOLDERS: readonly StateKind[] = ["frame", "composite"];

/** The dash pattern of the line between two orthogonal regions. */
const REGION_LINE = [6, 4] as const;

const title = (text: string) => [{ kind: "text", role: "title", text } as const];
const body = (text: string) => [{ kind: "text", role: "body", text } as const];

/** `rows` as at most `limit` rows, the last of them "…" where they are more. */
const capped = (rows: string[], limit: number) =>
  rows.length <= limit ? rows : [...rows.slice(0, limit - 1), ELLIPSIS];

/** The lines below a state's separator: its entry, do, and exit behaviours, its internal
 *  transitions, and its deferred triggers, in the order UML 2.5.1 lists them. */
function compartmentOf(state: State): string[] {
  const { entry, doActivity, exit, internal = [], deferred = [] } = state;
  return [
    ...(entry ? [`entry / ${entry}`] : []),
    ...(doActivity ? [`do / ${doActivity}`] : []),
    ...(exit ? [`exit / ${exit}`] : []),
    ...internal,
    ...deferred.map((trigger) => `${trigger} / defer`),
  ];
}

/** A state's name and, below a separator, its compartment, where it has one. */
function stateContentOf(state: State): NodeContent {
  const lines = compartmentOf(state);
  const name = title(state.name ?? "");
  return lines.length === 0
    ? [name]
    : [name, "separator", ...capped(lines, ROW_LIMIT - 2).map(body)];
}

/** The content of each kind of node that shows one: a state's name and, below a separator, its
 *  compartment; a submachine state's name and its state machine's; a state list's states, a
 *  signal's name, and the frame's heading as a title; history's letter; a comment's lines. */
const CONTENT: Partial<Record<StateKind, (state: State) => NodeContent>> = {
  state: stateContentOf,
  composite: stateContentOf,
  submachine: ({ name = "", machine = "" }) => [title(`${name} : ${machine}`)],
  "state-list": ({ name = "" }) => [title(name)],
  "send-signal": ({ name = "" }) => [title(name)],
  "receive-signal": ({ name = "" }) => [title(name)],
  frame: ({ name = "" }) => [title(`stm ${name}`)],
  "shallow-history": () => [title("H")],
  "deep-history": () => [title("H*")],
  comment: ({ body: lines = [] }) => capped(lines, ROW_LIMIT).map(body),
};

/** The content of a state's node, as `CONTENT` gives it; a pseudostate and a point, whose name
 *  stands beside it, show none. */
export const contentOf = (state: State): NodeContent => CONTENT[state.kind]?.(state) ?? [];

/** The identifier of the node that shows the name of the point `id`. */
export const nameNodeId = (id: string) => `${id}-name`;

/** Whether `kind` rides a border and shows its name in a node beside it. */
const isPoint = (kind: StateKind) => BORDER_KINDS[kind] !== undefined;

/** The node that shows the name of `state`, a point, and its content, none for any other kind. */
export function nameOf(state: State): { id: string; content: NodeContent } | undefined {
  if (!isPoint(state.kind)) return undefined;
  return { id: nameNodeId(state.id), content: state.name ? [body(state.name)] : [] };
}

/** The width of the node of the name `name`, as wide as its text is drawn in the body's font. */
export const nameWidth = (name: string) => Math.max(48, 24 + 8 * name.length);

/** Where a node of the state diagram lies: at a centre in a container or on the canvas, or on a
 *  side of the node it rides, at an offset along it and with the length of that side, unbounded
 *  where left out. */
export type Place =
  | { x: number; y: number; container?: string }
  | { attachedTo: string; side: Side; offset: number; length?: number };

/** The regions a composite state is divided into: two, one above the other, `sizes` high, parted by
 *  a dashed line. */
function regionsOf(id: string, sizes: readonly number[]): RegionData[] {
  return sizes.map((size, i) => ({ id: `${id}-region-${i + 1}`, size, line: REGION_LINE }));
}

/** The size of a composite state or the frame: its width, its height, at least what its content
 *  and its regions one above the other need, and the size of each of its regions along their
 *  division, `down` or `across`. */
export interface Size {
  width: number;
  height: number;
  regions?: readonly number[];
  divide?: Divide;
}

/** The kinds drawn round, as wide as their content makes them high: history, whose ellipse holds
 *  its letter. */
const ROUND: readonly StateKind[] = ["shallow-history", "deep-history"];

/** The node of point `state` on the side of the node it rides, `place`, as wide as `width`, and the
 *  node of its name beside it on the same side, 4 past its end where the side leaves room for the
 *  name there, else 4 before its start, without an outline. */
function pointNodesOf(
  state: State,
  own: Omit<BorderNodeData, "attachedTo" | "side" | "offset">,
  place: Extract<Place, { attachedTo: string }>,
  heightOf: Comb["heightOf"],
): BorderNodeData[] {
  const name = nameOf(state)!;
  const named = nameWidth(state.name ?? "");
  const at = { attachedTo: place.attachedTo, side: place.side, offset: place.offset };
  const label: BorderNodeData = {
    id: name.id,
    width: named,
    content: name.content,
    outline: "none" satisfies Outline,
    attachedTo: place.attachedTo,
    side: place.side,
    offset: nameOffsetOf({ ...place, width: own.width }, named, heightOf(name.content, named)),
  };
  return [{ ...own, ...at }, label];
}

/** The offset of the node of a point's name, `width` × `height`, beside the point `point` on its
 *  side, whose length it has where bounded: 4 past the point's end where the side leaves room for
 *  the name there, else 4 before its start. */
export function nameOffsetOf(
  point: { side: Side; offset: number; width: number; length?: number },
  width: number,
  height: number,
): number {
  const across = point.side === "top" || point.side === "bottom";
  const half = across ? width / 2 : height / 2;
  const reach = point.width / 2 + 4 + half;
  const room = point.offset + reach + half <= (point.length ?? Infinity);
  return room ? point.offset + reach : point.offset - reach;
}

/** What a composite state or the frame adds to its node: its height, at least `size.height` and
 *  what its content and its regions one above the other need, a composite state's division and
 *  regions, of `size.regions` or two of 80 one above the other, and the frame's mark as a
 *  container; both resizable. */
function holderOf(state: State, size: Size, contentHeight: number): Partial<PlacedNodeData> {
  if (state.kind === "frame")
    return { height: Math.max(size.height, contentHeight), resizable: true, isContainer: true };
  const regions = regionsOf(state.id, size.regions ?? [80, 80]);
  const divide = size.divide ?? "down";
  const stacked = divide === "down" ? regions.reduce((sum, region) => sum + region.size, 0) : 0;
  const height = Math.max(size.height, contentHeight + stacked);
  return { height, resizable: true, divide, regions };
}

/** The nodes of `state` placed at `place`: its own node, as high as `heightOf` gives it, history
 *  as wide as that, a composite state divided into its regions, the frame a container, and a point
 *  the node of its name beside it. The size of a composite state or a frame is `size`, where
 *  given, else a frame the palette drops is 400 high. A node at a centre in `place` is centred on
 *  it. */
export function nodesOf(
  state: State,
  place: Place,
  heightOf: Comb["heightOf"],
  size: Size = { width: STATE_SHAPES[state.kind].width, height: state.kind === "frame" ? 400 : 0 },
): NodeData[] {
  const { shape } = STATE_SHAPES[state.kind];
  const content = contentOf(state);
  const width = ROUND.includes(state.kind) ? heightOf(content, size.width, shape) : size.width;
  const own = { id: state.id, width, shape, content };
  if ("attachedTo" in place) return pointNodesOf(state, own, place, heightOf);
  const holder = HOLDERS.includes(state.kind)
    ? holderOf(state, size, heightOf(content, width, shape))
    : {};
  const height = holder.height ?? heightOf(content, width, shape);
  const placed: PlacedNodeData = {
    ...own,
    ...holder,
    x: place.x - width / 2,
    y: place.y - height / 2,
    ...(place.container === undefined ? {} : { container: place.container }),
  };
  return [placed];
}

/** The state of `kind` the palette drops: a state, a composite or a submachine state, a state
 *  list, a point, a signal, a comment, or a frame with a name of its kind; a pseudostate
 *  unnamed. */
export function newState(id: string, kind: StateKind): State {
  const named: Partial<Record<StateKind, Partial<State>>> = {
    state: { name: "NewState" },
    composite: { name: "NewComposite" },
    submachine: { name: "NewSubmachine", machine: "Machine" },
    "state-list": { name: "A, B" },
    "entry-point": { name: "entry" },
    "exit-point": { name: "exit" },
    "entry-reference": { name: "entry" },
    "exit-reference": { name: "exit" },
    "send-signal": { name: "Signal" },
    "receive-signal": { name: "Signal" },
    comment: { body: ["A comment"] },
    frame: { name: "NewMachine" },
  };
  return { id, kind, ...named[kind] };
}

/** The label a transition shows: its trigger, its guard in brackets, and its effect after a slash,
 *  each where it has one; none where it has none of them. */
export function labelTextOf({ trigger, guard, effect }: Transition): string | null {
  const text = [trigger, guard && `[${guard}]`, effect && `/ ${effect}`].filter(Boolean).join(" ");
  return text === "" ? null : text;
}

/** The sides of a transition the user connected: docked on the outline at both ends, or for a
 *  loop the side it left by at both, since a loop leaves and re-enters one side
 *  (API-edges-dock-side-or-outline). */
export function dockingOf(edge: AddedEdge): EdgePatch {
  if ("source" in edge && "target" in edge && edge.source === edge.target)
    return { targetSide: edge.sourceSide };
  return { sourceSide: "outline", targetSide: "outline" };
}

/** A node of the diagram as written below: its state, and its centre in its container, or its
 *  side and offset on the node it rides; a composite state or the frame with its size. */
type Seed = { state: State; place: Place; size?: Size };

/** The frame of the state machine, 1580 by 1720, and what lies in it, each centre relative to the
 *  frame's top left corner or to its region's. */
const at = (x: number, y: number, container = "machine") => ({ x, y, container });

const SEEDS: Seed[] = [
  {
    state: { id: "machine", kind: "frame", name: "Comb" },
    place: { x: 790, y: 860 },
    size: { width: 1580, height: 1720 },
  },
  { state: { id: "initial", kind: "initial" }, place: at(170, 110) },
  {
    state: { id: "created", kind: "state", name: "Created", entry: "read the options" },
    place: at(170, 210),
  },
  { state: { id: "load", kind: "receive-signal", name: "load" }, place: at(170, 340) },
  {
    state: {
      id: "loading",
      kind: "state",
      name: "Loading its engine",
      doActivity: "instantiate the engine",
      deferred: ["edit"],
    },
    place: at(170, 470),
  },
  { state: { id: "loaded", kind: "choice" }, place: at(170, 600) },
  {
    state: { id: "refusal", kind: "send-signal", name: "EngineSourceError" },
    place: at(170, 720),
  },
  { state: { id: "refused", kind: "final" }, place: at(170, 830) },
  {
    state: { id: "early", kind: "state-list", name: "Created, Loading" },
    place: at(170, 1620),
  },
  {
    state: {
      id: "live",
      kind: "composite",
      name: "Live",
      entry: "fit the view",
      internal: ["resize / redraw"],
    },
    place: at(750, 825),
    size: { width: 820, height: 0, regions: [300, 200], divide: "down" },
  },
  { state: { id: "graph-initial", kind: "initial" }, place: at(60, 50, "live-region-1") },
  {
    state: { id: "ready", kind: "state", name: "Ready", internal: ["select / show it"] },
    place: at(300, 150, "live-region-1"),
  },
  {
    state: { id: "rendering", kind: "submachine", name: "Rendering", machine: "DrawFrame" },
    place: at(620, 150, "live-region-1"),
  },
  { state: { id: "deep", kind: "deep-history" }, place: at(760, 240, "live-region-1") },
  { state: { id: "input-initial", kind: "initial" }, place: at(180, 30, "live-region-2") },
  { state: { id: "idle", kind: "state", name: "Idle" }, place: at(300, 110, "live-region-2") },
  {
    state: {
      id: "dragging",
      kind: "state",
      name: "Dragging",
      doActivity: "follow the pointer",
      exit: "tell the move",
    },
    place: at(600, 110, "live-region-2"),
  },
  { state: { id: "shallow", kind: "shallow-history" }, place: at(760, 100, "live-region-2") },
  {
    state: { id: "resume", kind: "entry-point", name: "resume" },
    place: { attachedTo: "live", side: "right", offset: 520 },
  },
  {
    state: { id: "lost-exit", kind: "exit-point", name: "lost" },
    place: { attachedTo: "live", side: "top", offset: 700 },
  },
  {
    state: { id: "begin", kind: "entry-reference", name: "begin" },
    place: { attachedTo: "rendering", side: "bottom", offset: 30 },
  },
  {
    state: { id: "end", kind: "exit-reference", name: "end" },
    place: { attachedTo: "rendering", side: "bottom", offset: 150 },
  },
  { state: { id: "junction", kind: "junction" }, place: at(1240, 420) },
  {
    state: { id: "lost", kind: "state", name: "Engine lost", entry: "tell onEngineLost" },
    place: at(1420, 420),
  },
  { state: { id: "terminate", kind: "terminate" }, place: at(1420, 560) },
  {
    state: { id: "replaces", kind: "comment", body: ["A load replaces", "the graph whole."] },
    place: at(1420, 700),
  },
  { state: { id: "suspended", kind: "state", name: "Suspended" }, place: at(1420, 920) },
  {
    state: { id: "waits", kind: "comment", body: ["An edit before the", "engine loads waits."] },
    place: at(470, 280),
  },
  { state: { id: "fork", kind: "fork" }, place: at(750, 1190) },
  {
    state: { id: "destroying", kind: "composite", name: "Destroying" },
    place: at(750, 1360),
    size: { width: 820, height: 220, regions: [410, 410], divide: "across" },
  },
  {
    state: { id: "textures", kind: "state", name: "Freeing the textures" },
    place: at(205, 70, "destroying-region-1"),
  },
  {
    state: { id: "engine", kind: "state", name: "Dropping the engine" },
    place: at(205, 70, "destroying-region-2"),
  },
  { state: { id: "join", kind: "join" }, place: at(750, 1540) },
  { state: { id: "destroyed", kind: "final" }, place: at(750, 1620) },
];

/** Each transition: its source, its target, and its trigger, guard, and effect, none for one a
 *  pseudostate takes at once. One through a signal symbol is two, its label on the first. */
const TRANSITIONS: [string, string, Transition?][] = [
  ["initial", "created"],
  ["created", "load", { trigger: "load", guard: "engine given" }],
  ["load", "loading"],
  ["loading", "loaded", { trigger: "settled" }],
  ["loaded", "live", { guard: "loaded" }],
  ["loaded", "refusal", { guard: "refused" }],
  ["refusal", "refused"],
  ["loading", "junction", { trigger: "trap" }],
  ["graph-initial", "ready"],
  ["ready", "ready", { trigger: "edit", effect: "apply the change" }],
  ["ready", "begin", { trigger: "change" }],
  ["end", "ready"],
  ["rendering", "lost-exit", { trigger: "context lost" }],
  ["lost-exit", "junction"],
  ["junction", "lost"],
  ["lost", "terminate", { trigger: "reload" }],
  ["input-initial", "idle"],
  ["idle", "dragging", { trigger: "pointerdown", guard: "on a node" }],
  ["dragging", "idle", { trigger: "pointerup" }],
  ["live", "suspended", { trigger: "pagehide" }],
  ["suspended", "resume", { trigger: "pageshow" }],
  ["resume", "deep"],
  ["resume", "shallow"],
  ["live", "fork", { trigger: "destroy" }],
  ["fork", "textures"],
  ["fork", "engine"],
  ["textures", "join"],
  ["engine", "join"],
  ["join", "destroyed"],
  ["early", "destroyed", { trigger: "destroy", effect: "drop the options" }],
];

/** The edge of a transition, docked on the outline at both ends, a loop on the left side of its
 *  state, labelled where it has a trigger, a guard, or an effect. */
function edgeOf([source, target, transition = {}]: (typeof TRANSITIONS)[number]): EdgeData {
  const side = source === target ? "left" : "outline";
  const text = labelTextOf(transition);
  return {
    id: `${source}-${target}`,
    source,
    target,
    sourceSide: side,
    targetSide: side,
    ...styleOf("transition"),
    ...(text === null ? {} : { labels: [labelOf("transition", text)] }),
  };
}

/** The anchors of the comments: one on the composite state Live, one at the middle of the
 *  transition from Created that receives `load`. */
const ANCHORS: EdgeData[] = [
  {
    id: "replaces-anchor",
    source: "replaces",
    target: "live",
    sourceSide: "outline",
    targetSide: "outline",
    ...styleOf("anchor"),
  },
  {
    id: "waits-anchor",
    source: "waits",
    sourceSide: "outline",
    targetEdge: "created-load",
    targetT: 0.5,
    ...styleOf("anchor"),
  },
];

/** `place`, for a point with the length of its side of the node it rides among `nodes`. */
function sided(place: Place, nodes: readonly NodeData[], heightOf: Comb["heightOf"]): Place {
  if (!("attachedTo" in place)) return place;
  const owner = nodes.find(({ id }) => id === place.attachedTo)!;
  const across = place.side === "top" || place.side === "bottom";
  const height = owner.height ?? heightOf(owner.content, owner.width, owner.shape);
  return { ...place, length: across ? owner.width : height };
}

/** The state diagram as graph data, each node placed by the height `heightOf` gives it, with the
 *  state of each node, the kind of each edge, a transition or an anchor, and the trigger, guard,
 *  and effect of each transition, by their identifiers. */
export function stateDiagram(heightOf: Comb["heightOf"]): DiagramData {
  const transitions = TRANSITIONS.map(edgeOf);
  const edges = [...transitions, ...ANCHORS];
  const nodes: NodeData[] = [];
  for (const { state, place, size } of SEEDS)
    nodes.push(...nodesOf(state, sided(place, nodes, heightOf), heightOf, size));
  return {
    graph: { nodes, edges },
    classifiers: new Map(),
    states: new Map(SEEDS.map(({ state }) => [state.id, structuredClone(state)])),
    kinds: new Map([
      ...transitions.map(({ id }) => [id, "transition"] as const),
      ...ANCHORS.map(({ id }) => [id, "anchor"] as const),
    ]),
    transitions: new Map(
      TRANSITIONS.map(([source, target, each = {}]) => [`${source}-${target}`, { ...each }]),
    ),
  };
}

/** The state diagram as the host application chooses it: the palette drops every kind, each
 *  edited as its notation shows it, a connection adds a transition, or from a comment an anchor,
 *  docked as `dockingOf` says,
 *  whose trigger, guard, and effect the sidebar edits, an anchor has nothing to edit, and the
 *  legend of the kinds of relationship is hidden. */
export const STATE_DIAGRAM: DiagramDescriptor = {
  id: "state",
  name: "State diagram",
  build: stateDiagram,
  nouns: ["elements", "edges"],
  nodes: [
    { kind: "state", name: "State", form: "behaviours" },
    { kind: "composite", name: "Composite state", form: "behaviours" },
    { kind: "submachine", name: "Submachine state", form: "name-and-machine" },
    { kind: "state-list", name: "State list", form: "name" },
    { kind: "initial", name: "Initial state", form: "none" },
    { kind: "final", name: "Final state", form: "none" },
    { kind: "terminate", name: "Terminate", form: "none" },
    { kind: "choice", name: "Choice", form: "none" },
    { kind: "junction", name: "Junction", form: "none" },
    { kind: "fork", name: "Fork", form: "none" },
    { kind: "join", name: "Join", form: "none" },
    { kind: "shallow-history", name: "Shallow history", form: "none" },
    { kind: "deep-history", name: "Deep history", form: "none" },
    { kind: "entry-point", name: "Entry point", form: "name" },
    { kind: "exit-point", name: "Exit point", form: "name" },
    { kind: "entry-reference", name: "Entry connection point reference", form: "name" },
    { kind: "exit-reference", name: "Exit connection point reference", form: "name" },
    { kind: "send-signal", name: "Send signal", form: "name" },
    { kind: "receive-signal", name: "Receive signal", form: "name" },
    { kind: "comment", name: "Comment", form: "lines" },
    { kind: "frame", name: "State machine frame", form: "name" },
  ],
  connected: "transition",
  connectedFrom: { comment: "anchor" },
  docking: dockingOf,
  edgeForm: "trigger-guard-effect",
  edgeForms: { anchor: "none" },
  selected: { node: "element", edge: "transition" },
  legend: false,
};
