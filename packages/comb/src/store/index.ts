// The state of the graph and the viewport (ARCH-graph-in-zustand-store). Coordinates are not kept
// here: positions live in the engine's buffer, and `positionsVersion` tells readers that they
// moved, `movesVersion` that a drag moved its nodes (REN-moving-layer-moves-content); the point a
// connection is dragged to lives in interaction, and `pointerVersion` tells them that it moved.
import { createStore } from "zustand/vanilla";
import type { NodeContent, NodeShape, Outline, RegionRead } from "../bridge";

export type { ContentElement, NodeContent, NodeShape, Outline, TextRole } from "../bridge";

/** What every node the host application hands over has: `shape` the node shape it is drawn and
 *  hit in, and `content` what it shows, rows of weighted columns, from which and its node shape
 *  Comb computes its height (REN-node-content-and-hits, REN-node-shapes-cover-uml). */
interface NodeFields {
  id: string;
  width: number;
  /** Its node shape, `rectangle` where left out; a circle, a ringed circle, a bar, a crossed
   *  circle, and a cross hold no content. */
  shape?: NodeShape;
  /** How its outline is drawn: `"solid"`, which `api` fills in where left out, `"none"`, or a dash
   *  and a gap in world units laid along it clockwise from its top left; a selected node's outline
   *  is drawn solid whatever it is (REN-node-shapes-cover-uml, *Outline*). */
  outline?: Outline;
  /** The height it is given, never less than its content needs, a height below that raised to
   *  it; without content, as high as given however small; where left out, as high as its content
   *  needs, or as wide without content (REN-node-shapes-cover-uml). */
  height?: number;
  content: NodeContent;
}

/** A node that lies on the canvas or in a container: `x` and `y` are its initial position. */
export interface PlacedNodeData extends NodeFields {
  x: number;
  y: number;
  /** The identifier of the container it lies in, its `x` and `y` then relative to the container's
   *  top left corner; on the canvas where left out (API-edits-report-division-moves). */
  container?: string;
  /** `true` for a container, which may hold nodes even while empty, and is drawn below the edges
   *  and the other nodes. */
  isContainer?: boolean;
  /** `true` where the user may resize it by its resize handles once it is selected
   *  (API-edits-report-division-moves). */
  resizable?: boolean;
  /** The direction its `regions` divide it in: `across` side by side, `down` one above the other
   *  (ARCH-regions-are-container-slots). */
  divide?: Divide;
  /** The regions it is divided into, below its content, each a container of its own that nodes
   *  lie in by its identifier; a node with regions holds no node beside them. */
  regions?: RegionData[];
  attachedTo?: never;
  side?: never;
  offset?: never;
}

/** A border node (ARCH-border-nodes-ride-sides): attached to the node `attachedTo`, which is no
 *  border node, centred on its outline on `side` of its box, `offset` world units from that
 *  side's start, its left end or its top end, held within the side's length; it moves with that
 *  node and lies in its container. It is no container and not resizable. */
export interface BorderNodeData extends NodeFields {
  attachedTo: string;
  side: Side;
  offset: number;
  x?: never;
  y?: never;
  container?: never;
  isContainer?: never;
  resizable?: never;
  divide?: never;
  regions?: never;
}

/** A node as the host application hands it over: a node with a position, or a border node. */
export type NodeData = PlacedNodeData | BorderNodeData;

/** The direction a node or a region is divided in: `across` for regions side by side, `down` for
 *  regions one above the other (ARCH-regions-are-container-slots). */
export type Divide = "across" | "down";

/** A region of a node (ARCH-regions-are-container-slots): its identifier, from the space of the
 *  nodes' identifiers; its name, drawn in a band at its start, at the top of a region side by side
 *  with others, turned at the left of one above or below others; its size along the direction of
 *  its division, the last region taking any rest; the line after it, between it and the next
 *  region, solid or dashed by a dash and a gap; and its own division and regions. */
export interface RegionData {
  id: string;
  name?: string;
  size: number;
  line: "solid" | readonly [number, number];
  divide?: Divide;
  regions?: RegionData[];
}

/** What the store keeps of a region besides its identifier and container: its name, its line, the
 *  direction of the division it lies in, whether it is the last of that division, whose line is
 *  not drawn, and its own division. */
export interface RegionView {
  readonly name?: string;
  readonly line: "solid" | readonly [number, number];
  readonly axis: Divide;
  readonly last: boolean;
  readonly divide?: Divide;
}

/** A side of a node, at whose middle its connector sits (API-edges-dock-nodes-or-edges). */
export type Side = "top" | "right" | "bottom" | "left";

/** What an end of an edge docks on: the connector of one of the four sides, or the node's outline,
 *  where the line towards the edge's other end crosses it (API-edges-dock-nodes-or-edges). */
export type Dock = Side | "outline";

/** An edge label (API-edges-dock-nodes-or-edges, *Edge labels*): its identifier, unique within its
 *  edge, its text, placed by its path parameter `t` and its label offset in pixels (G-6), 0.5 and
 *  0 where it gives none, which Comb fills in as it takes the label, on a pill of `background`
 *  (`0xRRGGBB`), or of the edge's colour as it is now where it gives none. */
export interface EdgeLabelData {
  id: string;
  text: string;
  t?: number;
  offset?: number;
  background?: number;
}

/** An edge label as Comb keeps it and tells it in a change, its place filled in; a background
 *  left out stays out, so that the label follows its edge's colour. */
export type KeptLabel = Required<Omit<EdgeLabelData, "background">> &
  Pick<EdgeLabelData, "background">;

/** The arrowhead at an edge's target: a filled triangle, two open strokes, a hollow triangle
 *  around a white fill, or none (API-edges-dock-nodes-or-edges, *Arrowheads*). */
export type Arrowhead = "end" | "open" | "hollow" | "none";

/** The source of an edge (API-edges-dock-nodes-or-edges, *Ends*): a node, any node at any depth,
 *  by `source`, docked by `sourceSide`, a side or the outline, `right` where left out and `top` for
 *  a loop; or another edge by `sourceEdge`, which itself ends on nodes, at the path parameter
 *  `sourceT` of its path, from 0 to 1, with no side. */
export type EdgeSource =
  | { source: string; sourceSide?: Dock; sourceEdge?: never; sourceT?: never }
  | { sourceEdge: string; sourceT: number; source?: never; sourceSide?: never };

/** The target of an edge, as `EdgeSource` names its source: a node by `target`, docked by
 *  `targetSide`, `left` where left out and `top` for a loop; or another edge by `targetEdge` at
 *  `targetT`. */
export type EdgeTarget =
  | { target: string; targetSide?: Dock; targetEdge?: never; targetT?: never }
  | { targetEdge: string; targetT: number; target?: never; targetSide?: never };

/** An edge from its source to its target, each a node, docked at a side's connector or on the
 *  outline, or another edge, drawn in `color` (`0xRRGGBB`), dashed by `dash` (dash and gap lengths
 *  in world units; solid without), with the arrowhead `arrow` at its target, a filled triangle
 *  where it gives none (G-11), its middle a zigzag where `lightning` is `true`, and carrying at
 *  most 8 `labels` (API-edges-dock-nodes-or-edges). */
export type EdgeData = EdgeFields & EdgeSource & EdgeTarget;

/** What an edge holds besides its ends. */
export interface EdgeFields {
  id: string;
  color?: number;
  dash?: readonly [number, number];
  arrow?: Arrowhead;
  lightning?: boolean;
  labels?: readonly EdgeLabelData[];
}

export interface GraphData {
  nodes: NodeData[];
  edges: EdgeData[];
}

export type Selection = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

/** What `updateEdge` may change of an edge: its colour, dash pattern, arrowhead, lightning bolt,
 *  labels, or sides, a dash and the labels cleared with `null`. `labels` replaces the whole list,
 *  never merged by identifier: a label without a path parameter goes back to 0.5, one without an
 *  offset to 0, and one without a background follows the edge's colour
 *  (API-edges-dock-nodes-or-edges). */
export interface EdgePatch {
  color?: number;
  arrow?: Arrowhead;
  lightning?: boolean;
  sourceSide?: Dock;
  targetSide?: Dock;
  dash?: readonly [number, number] | null;
  labels?: readonly EdgeLabelData[] | null;
}

/** A node as the store keeps it: its identifier, its node shape, which `api` fills in, the
 *  identifier of its container, its mark as a container, whether the host gave it a height, and
 *  whether it is resizable, each where the node has one (API-edits-report-division-moves). Its
 *  position, its size, and its content are the engine's, which every reader takes from the
 *  engine's buffers (ARCH-graph-in-zustand-store, REN-node-content-and-hits); a new object for
 *  every change of its content, so that a view tells the change by identity. */
export type NodeView = Pick<
  NodeData,
  "id" | "shape" | "outline" | "container" | "isContainer" | "resizable" | "divide" | "attachedTo"
> & {
  /** Set where its data or a patch of `updateNode` gave it a height. */
  heightGiven?: true;
  /** Set where the slot holds a region of a node, which is no node of the host application's:
   *  no edge ends on it, and no call names it as a node (ARCH-regions-are-container-slots). */
  region?: RegionView;
};

/** What the store keeps of `node`: no key for a container, a mark, a height given, whether it is
 *  resizable, a division, a region, or a node it rides it has none of. */
export function nodeViewOf(node: NodeView): NodeView {
  const { id, shape, container, isContainer, heightGiven, resizable, divide, region } = node;
  const view: NodeView = { id, shape };
  if (node.outline !== undefined) view.outline = node.outline;
  if (node.attachedTo !== undefined) view.attachedTo = node.attachedTo;
  if (container !== undefined) view.container = container;
  if (isContainer !== undefined) view.isContainer = isContainer;
  if (heightGiven) view.heightGiven = heightGiven;
  if (resizable !== undefined) view.resizable = resizable;
  if (divide !== undefined) view.divide = divide;
  if (region !== undefined) view.region = region;
  return view;
}

/** The views of the regions `regions` of the node `container`, divided by `axis`, read into one
 *  list, each after the region it lies in, in the order the engine gives them slots. A region
 *  keeps its division where it holds regions of its own. */
export function regionViewsOf(
  container: string,
  axis: Divide,
  regions: readonly RegionRead[],
): NodeView[] {
  const last = new Map<number | undefined, number>();
  const holds = new Set<number>();
  regions.forEach(({ of }, i) => {
    last.set(of, i);
    if (of !== undefined) holds.add(of);
  });
  return regions.map(({ id, name, line, divide, of }, i) => {
    const parent = of === undefined ? undefined : regions[of]!;
    const region: RegionView = {
      line,
      axis: parent ? parent.divide! : axis,
      last: last.get(of) === i,
      ...(name === undefined ? {} : { name }),
      ...(divide === undefined || !holds.has(i) ? {} : { divide }),
    };
    const view: NodeView = {
      id,
      shape: "rectangle",
      container: parent ? parent.id : container,
      isContainer: true,
    };
    view.region = region;
    return view;
  });
}

/** A graph as the store takes it once the bridge took it: of each node what the store keeps. */
export interface KeptGraph {
  nodes: readonly NodeView[];
  edges: KeptEdge[];
}

/** An edge as Comb keeps it once the bridge took it, the places of its labels filled in
 *  (API-edges-dock-nodes-or-edges). */
export type KeptEdge = Omit<EdgeFields, "labels"> & {
  readonly labels?: readonly KeptLabel[];
} & EdgeSource &
  EdgeTarget;

/** What `updateNode` may change of a node: its content, which it replaces whole
 *  (REN-node-content-and-hits), its height, a height below its content's raised to it, and whether
 *  the user may resize it (API-edits-report-division-moves). */
export interface NodePatch {
  content?: NodeContent;
  height?: number;
  resizable?: boolean;
  /** Divides the node anew, with `regions`: in the direction the node has where left out. */
  divide?: Divide;
  /** Its regions anew, each taking the size given, the last any rest; a region left out goes
   *  with everything it holds, and one kept by its identifier keeps what it holds
   *  (ARCH-regions-are-container-slots, *Removing a region*). */
  regions?: RegionData[];
  /** A border node's side and offset anew, the offset held within that side's length; a node
   *  that is no border node has neither (ARCH-border-nodes-ride-sides). */
  side?: Side;
  offset?: number;
  /** How its outline is drawn anew (REN-node-shapes-cover-uml, *Outline*). */
  outline?: Outline;
}

/** The regions of a node `addNode` adds, read into one list, and the slots the engine took them
 *  into, in their order. */
export interface TakenRegions {
  readonly read: readonly RegionRead[];
  readonly slots: readonly number[];
}

/** A node divided anew by a patch of `updateNode`: its direction, its regions, the slots the
 *  engine took them into, depth first, and the slots of the regions it had. */
export interface Divided {
  readonly divide: Divide | undefined;
  readonly regions: readonly RegionRead[];
  readonly slots: readonly number[];
  readonly old: readonly number[];
}

/** A patch of `updateNode` the engine took of the node `id`, and how it divided the node anew
 *  where it did: what the store's `updateNode` records. */
export interface NodeUpdate {
  readonly id: string;
  readonly patch: Readonly<NodePatch>;
  readonly divided?: Divided;
}

/** Who made a change: the user on the canvas, or the host application through `Comb`. */
export type By = "user" | "host";

/** The change the last action that changed the graph made, by kind and the identifier it touched,
 *  never a coordinate (ARCH-graph-in-zustand-store, API-edits-report-division-moves): `api`
 *  delivers it to the host application, reading what it carries from the store and the engine's
 *  buffers. A new object for every change, so
 *  that one is told from the next by identity. */
export type StoreChange =
  | { readonly kind: "loaded"; readonly by: "host" }
  | { readonly kind: "nodeAdded"; readonly by: "host"; readonly id: string }
  | { readonly kind: "nodeMoved"; readonly by: By; readonly id: string }
  | {
      readonly kind: "nodeResized";
      readonly by: "user";
      readonly id: string;
      /** The nodes that lie directly in it whose position relative to it the resize changed, and
       *  for a divided node those in its regions whose position relative to their region did. */
      readonly moved: readonly string[];
      /** Its regions whose size the resize changed (ARCH-regions-are-container-slots). */
      readonly regions: readonly string[];
    }
  | {
      readonly kind: "regionsMoved";
      readonly by: "user";
      /** The divided node whose line was dragged. */
      readonly node: string;
      /** Its regions whose size the drag changed, and the nodes in them whose position relative
       *  to their region it changed (ARCH-regions-are-container-slots, *Lines*). */
      readonly regions: readonly string[];
      readonly moved: readonly string[];
    }
  | {
      readonly kind: "nodesRemoved";
      readonly by: By;
      readonly nodes: readonly string[];
      readonly edges: readonly string[];
    }
  | { readonly kind: "edgesRemoved"; readonly by: By; readonly edges: readonly string[] }
  | { readonly kind: "edgeAdded"; readonly by: By; readonly id: string }
  | {
      readonly kind: "labelMoved";
      readonly by: "user";
      readonly edge: string;
      readonly label: string;
    }
  | {
      readonly kind: "edgeUpdated";
      readonly by: "host";
      readonly id: string;
      readonly patch: Readonly<EdgePatch>;
    }
  | {
      readonly kind: "nodeUpdated";
      readonly by: "host";
      readonly id: string;
      /** The fields of `NodePatch` the patch set, which `api` reads from the store and the
       *  engine as it delivers the change. */
      readonly fields: readonly (keyof NodePatch)[];
    };

/** A connection the user drags from the connector `side` of the node in slot `source`
 *  (API-edges-dock-nodes-or-edges):
 *  over the node in slot `over`, whose connectors are `compatible` where the source does not reach
 *  it yet, the source's own only where loops are allowed and but for `side`, and over its
 *  connector `target` where a release connects. The world point it is dragged
 *  to is no part of it: interaction keeps that point and signals its moves by `pointerVersion`
 *  (ARCH-graph-in-zustand-store). */
export interface Connection {
  readonly source: number;
  readonly side: Side;
  readonly over: number | null;
  readonly compatible: boolean;
  readonly target: { readonly slot: number; readonly side: Side } | null;
}

/** The state without its actions, read-only to its leaves: what the render layer sees, so the
 *  type checker refuses a write (ARCH-one-workspace-per-example). */
export interface GraphView {
  /** The node in each slot, none at a free slot (ARCH-engine-edits-nested-graph). */
  readonly nodes: readonly (Readonly<NodeView> | undefined)[];
  readonly slots: ReadonlyMap<string, number>;
  /** The slot of each edge the graph holds, by its identifier. */
  readonly edgeSlots: ReadonlyMap<string, number>;
  /** The UTF-16 code units of every identifier the graph holds, a node's, an edge's, and each
   *  edge's source and target, which the limits of a load bound after every edit
   *  (API-edits-report-division-moves). */
  readonly idUnits: number;
  /** The change the last action that changed the graph made, or none before the first. */
  readonly change: StoreChange | null;
  /** The edge in each slot, none at a free slot (ARCH-engine-edits-nested-graph). */
  readonly edges: readonly (Readonly<KeptEdge> | undefined)[];
  readonly selection: Readonly<Selection>;
  /** The node whose connectors the pointer shows, or none (API-edges-dock-nodes-or-edges). */
  readonly hovered: number | null;
  /** The connection the user drags, or none. A load or a removal of its source leaves it, for its
   *  gesture to end before anything reads the store after the change. */
  readonly connection: Connection | null;
  readonly viewport: Readonly<Viewport>;
  /** Counts the changes of the engine's positions that a query the scene keeps does not survive:
   *  a load, the release of a drag, a move of a label drag (ARCH-graph-in-zustand-store,
   *  REN-moving-layer-moves-content). */
  readonly positionsVersion: number;
  /** The node slots a drag moves, from its first move to its release, or none; a load, or a
   *  removal of one of them, leaves none (REN-moving-layer-moves-content). */
  readonly dragged: readonly number[] | null;
  /** Counts the moves of the nodes in `dragged`, which a query the scene keeps survives. */
  readonly movesVersion: number;
  /** Counts the moves of the point a connection is dragged to, which interaction keeps. */
  readonly pointerVersion: number;
}

export interface GraphState extends GraphView {
  /** Replaces the graph by `graph`, whose identifiers hold `idUnits` UTF-16 code units, as the
   *  snapshot counted them while it read them. */
  load(graph: KeptGraph, idUnits: number): void;
  /** Keeps `node`, which the engine took into `slot`, without its position, and its regions,
   *  `read` into one list, which the engine took into `slots` in their order
   *  (ARCH-regions-are-container-slots). */
  addNode(node: NodeData, slot: number, regions?: TakenRegions): void;
  /** Records that the engine took `patch` of the node `id`, keeping what the patch set of what
   *  the store keeps, and divided it anew where `divided` says how: its regions, which the engine
   *  took into `slots`, depth first, in place of those in `old`. */
  updateNode(update: NodeUpdate): void;
  /** Records that a resize, now released, changed the size of the node `id`, which the engine
   *  keeps, the positions relative to it of the nodes `moved`, and the sizes of its regions
   *  `regions` (API-edits-report-division-moves). */
  nodeResized(id: string, moved: readonly string[], regions?: readonly string[]): void;
  /** Records that the drag of a line of the divided node `node`, now released, changed the sizes
   *  of its regions `regions` and the positions relative to their region of the nodes `moved`
   *  (ARCH-regions-are-container-slots). */
  regionsMoved(node: string, regions: readonly string[], moved: readonly string[]): void;
  select(selection: Selection): void;
  setViewport(viewport: Viewport): void;
  positionsMoved(): void;
  /** Records that a drag moves the nodes in `slots`, which the engine has moved once. */
  dragStarted(slots: readonly number[]): void;
  /** Records that the drag moved its nodes again. */
  dragMoved(): void;
  /** Records that the drag ended, which a query the scene keeps does not survive. */
  dragEnded(): void;
  /** Records that the point a connection is dragged to moved, where interaction keeps it. */
  pointerMoved(): void;
  /** Records that a drag, now released, left the node `id` where the engine keeps it, in the
   *  container `container`, or on the canvas for `null` (API-edits-report-division-moves); by the
   *  host where an `updateNode` moved it into a region (ARCH-regions-are-container-slots). */
  nodeMoved(id: string, container: string | null, by?: By): void;
  /** Forgets the nodes in `nodeSlots` and the edges in `edgeSlots`, which the engine removed,
   *  leaving their slots free, and clears a selection of one of them. */
  removeNodes(nodeSlots: readonly number[], edgeSlots: readonly number[], by: By): void;
  /** Forgets the edges in `edgeSlots`, which the engine removed, leaving their slots free. */
  removeEdges(edgeSlots: readonly number[], by: By): void;
  /** Keeps `edge`, which the engine took into `slot`, as `by` made it. */
  addEdge(edge: KeptEdge, slot: number, by: By): void;
  /** Records that a drag, now released, left the label at `index` of the edge `id` at path
   *  parameter `t` and label offset `offset`, where the engine placed it. */
  labelMoved(id: string, index: number, t: number, offset: number): void;
  /** Shows the connectors of the node in `slot`, or none. */
  hover(slot: number | null): void;
  /** Records the connection the user drags, or that it ended. */
  connect(connection: Connection | null): void;
  /** Merges `patch` into the edge `id`, which the engine changed. */
  updateEdge(id: string, patch: EdgePatch): void;
}

export type GraphStore = ReturnType<typeof createGraphStore>;

type Edges = GraphView["edges"];

/** The UTF-16 code units of the identifier of `node`. */
function nodeUnits(node: Pick<NodeView, "id">): number {
  return node.id.length;
}

/** The UTF-16 code units of the identifiers of `edge`: its own, its source's, its target's, each
 *  a node's or an edge's (API-edges-dock-nodes-or-edges), and its labels'. */
function edgeUnits(edge: EdgeView): number {
  const ends = (edge.source ?? edge.sourceEdge).length + (edge.target ?? edge.targetEdge).length;
  return edge.id.length + ends + labelUnits(edge.labels);
}

/** The UTF-16 code units of the identifiers of `labels` (API-edges-dock-nodes-or-edges). */
export function labelUnits(labels: readonly { readonly id: string }[] | null | undefined): number {
  let units = 0;
  for (const label of labels ?? []) units += label.id.length;
  return units;
}

/** `edges` without those in `slots`, the identifiers of those edges, the map without them, and
 *  the code units of identifiers they held. */
function withoutEdges(
  edges: Edges,
  edgeSlots: ReadonlyMap<string, number>,
  slots: readonly number[],
) {
  const kept = edges.slice();
  const map = new Map(edgeSlots);
  const ids: string[] = [];
  let units = 0;
  for (const slot of slots) {
    const edge = kept[slot];
    if (!edge) continue;
    kept[slot] = undefined;
    map.delete(edge.id);
    ids.push(edge.id);
    units += edgeUnits(edge);
  }
  return { edges: kept, edgeSlots: map, ids, units };
}

/** What a removal changes of the node under the pointer and of the connection: a removed node
 *  shows no connectors, and a connection over it is over nothing until it moves. Whether the
 *  removal ends a connection from it is its gesture's to decide. */
function hoveredAndConnectionWithout(
  state: GraphView,
  nodes: GraphView["nodes"],
): Partial<GraphView> {
  const gone = (slot: number | null | undefined) => slot != null && !nodes[slot];
  const { hovered, connection } = state;
  const after =
    connection && gone(connection.over)
      ? { ...connection, over: null, compatible: false, target: null }
      : connection;
  return {
    ...(gone(hovered) ? { hovered: null } : {}),
    ...(after === connection ? {} : { connection: after }),
  };
}

/** What `load` changes of `state`: the graph replaced, whose identifiers hold `idUnits` code
 *  units, and the selection and the node under the pointer cleared; a connection is ended by its
 *  gesture. */
function loadedFrom(state: GraphView, graph: KeptGraph, idUnits: number): Partial<GraphView> {
  const slots = new Map<string, number>();
  for (let slot = 0; slot < graph.nodes.length; slot++) slots.set(graph.nodes[slot]!.id, slot);
  const edgeSlots = new Map<string, number>();
  for (let slot = 0; slot < graph.edges.length; slot++) edgeSlots.set(graph.edges[slot]!.id, slot);
  return {
    nodes: graph.nodes.map(nodeViewOf),
    slots,
    edgeSlots,
    edges: graph.edges,
    idUnits,
    change: { kind: "loaded", by: "host" },
    selection: null,
    hovered: null,
    dragged: null,
    positionsVersion: state.positionsVersion + 1,
  };
}

/** What a removal leaving `nodes` changes of a drag of `state`: none dragged where it removed one
 *  of the nodes the drag moves (REN-moving-layer-moves-content). */
function draggedWithout(state: GraphView, nodes: GraphView["nodes"]): Partial<GraphView> {
  return state.dragged?.some((slot) => !nodes[slot]) ? { dragged: null } : {};
}

/** What `nodeMoved` changes of `state`: the change, by `by`, and where the node `id` lies in
 *  another container than before, a new view of it that names `container`, or none for the
 *  canvas. */
function movedFrom(
  state: GraphView,
  id: string,
  container: string | null,
  by: By,
): Partial<GraphView> {
  const change = { kind: "nodeMoved", by, id } as const;
  const slot = state.slots.get(id)!;
  const view = state.nodes[slot]!;
  if ((view.container ?? null) === container) return { change };
  const nodes = state.nodes.slice();
  nodes[slot] = nodeViewOf({ ...view, container: container ?? undefined });
  return { nodes, change };
}

/** The actions of a drag of nodes (REN-moving-layer-moves-content), by the store's `set`. */
function dragsOf(set: (change: (state: GraphState) => Partial<GraphState>) => void) {
  return {
    dragStarted: (slots: readonly number[]) =>
      set((state) => ({ dragged: slots, movesVersion: state.movesVersion + 1 })),
    dragMoved: () => set((state) => ({ movesVersion: state.movesVersion + 1 })),
    dragEnded: () =>
      set((state) => ({ dragged: null, positionsVersion: state.positionsVersion + 1 })),
  };
}

/** What `removeNodes` changes of `state`: the nodes in `nodeSlots` and the edges in `edgeSlots`
 *  forgotten, and a selection of a removed node cleared. */
function withoutNodes(
  state: GraphView,
  nodeSlots: readonly number[],
  edgeSlots: readonly number[],
  by: By,
): Partial<GraphView> {
  const removed = withoutEdges(state.edges, state.edgeSlots, edgeSlots);
  const nodes = state.nodes.slice();
  const slots = new Map(state.slots);
  const ids: string[] = [];
  let units = removed.units;
  for (const slot of nodeSlots) {
    const node = nodes[slot];
    if (!node) continue;
    nodes[slot] = undefined;
    slots.delete(node.id);
    // A region goes with what it divides, and is never named (ARCH-regions-are-container-slots).
    if (!node.region) ids.push(node.id);
    units += nodeUnits(node);
  }
  const { selection } = state;
  const cleared =
    (selection?.kind === "node" && !slots.has(selection.id)) ||
    (selection?.kind === "edge" && !removed.edgeSlots.has(selection.id));
  const hoveredAndConnection = hoveredAndConnectionWithout(state, nodes);
  return {
    ...draggedWithout(state, nodes),
    nodes,
    slots,
    edges: removed.edges,
    edgeSlots: removed.edgeSlots,
    idUnits: state.idUnits - units,
    change: { kind: "nodesRemoved", by, nodes: ids, edges: removed.ids },
    ...(cleared ? { selection: null } : {}),
    ...hoveredAndConnection,
  };
}

/** What `removeEdges` changes of `state`: the edges in `edgeSlots` forgotten, and a selection of
 *  a removed edge cleared. */
function withoutEdgesOf(
  state: GraphView,
  edgeSlots: readonly number[],
  by: By,
): Partial<GraphView> {
  const removed = withoutEdges(state.edges, state.edgeSlots, edgeSlots);
  const { selection } = state;
  const cleared = selection?.kind === "edge" && !removed.edgeSlots.has(selection.id);
  return {
    edges: removed.edges,
    edgeSlots: removed.edgeSlots,
    idUnits: state.idUnits - removed.units,
    change: { kind: "edgesRemoved", by, edges: removed.ids },
    ...(cleared ? { selection: null } : {}),
  };
}

type EdgeView = NonNullable<GraphView["edges"][number]>;

/** The edge `id` names in `view`, with its slot; the graph holds it. */
export function edgeNamed(
  view: Pick<GraphView, "edges" | "edgeSlots">,
  id: string,
): { slot: number; edge: EdgeView } {
  const slot = view.edgeSlots.get(id)!;
  return { slot, edge: view.edges[slot]! };
}

/** `edge` with `patch` merged: a field the patch sets replaces the edge's, the labels whole, and
 *  `null` clears a dash or the labels. */
function patched(edge: EdgeView, patch: EdgePatch): EdgeView {
  const { dash, labels, ...rest } = { ...edge, ...patch };
  // The bridge refused a side beside an end on an edge (API-edges-dock-nodes-or-edges).
  return {
    ...rest,
    ...(dash ? { dash } : {}),
    ...(labels ? { labels: labels as readonly KeptLabel[] } : {}),
  } as EdgeView;
}

/** What `updateNode` changes of `state`: the node `id` a new object where its content or what the
 *  store keeps of it changed, so that a view tells the change by identity, and the change
 *  recorded. */
function updatedFrom(state: GraphView, { id, patch, divided }: NodeUpdate): Partial<GraphView> {
  const { height, resizable, outline } = patch;
  const sized = height !== undefined || resizable !== undefined || outline !== undefined;
  const content = patch.content !== undefined;
  const view = (node: NodeView) => {
    const updated = nodeViewOf({
      ...node,
      ...(height === undefined ? {} : { heightGiven: true as const }),
      ...(resizable === undefined ? {} : { resizable }),
      ...(outline === undefined ? {} : { outline }),
    });
    if (divided) {
      delete updated.divide;
      if (divided.divide !== undefined && divided.regions.length > 0)
        updated.divide = divided.divide;
    }
    return updated;
  };
  let nodes =
    content || sized || divided
      ? state.nodes.map((node) => (node?.id === id ? view(node) : node))
      : state.nodes;
  let { slots, idUnits } = state;
  if (divided) {
    ({ nodes, slots, idUnits } = withRegions(nodes, slots, idUnits, id, divided));
  }
  return { nodes, slots, idUnits, change: updateOf(id, patch, divided !== undefined) };
}

/** The change `updateNode` records of the node `id`: the fields `patch` set, and with a side the
 *  offset, which the engine holds within the new side
 *  (ARCH-border-nodes-ride-sides), and with a division anew its direction and its regions. */
function updateOf(id: string, patch: Readonly<NodePatch>, divided: boolean): StoreChange {
  const fields = new Set(Object.keys(patch) as (keyof NodePatch)[]);
  if (fields.has("side")) fields.add("offset");
  if (divided) fields.add("regions").add("divide");
  return { kind: "nodeUpdated", by: "host", id, fields: [...fields] };
}

/** `nodes`, `slots`, and `idUnits` without the regions in `divided.old` the store still keeps and
 *  with the regions of the node `id` `divided` names, each in its slot. */
function withRegions(
  before: GraphView["nodes"],
  map: ReadonlyMap<string, number>,
  units: number,
  id: string,
  { divide, regions, slots: taken, old }: Divided,
) {
  const nodes = before.slice();
  const slots = new Map(map);
  let idUnits = units;
  for (const slot of old) {
    const region = nodes[slot];
    if (!region?.region) continue;
    nodes[slot] = undefined;
    slots.delete(region.id);
    idUnits -= nodeUnits(region);
  }
  const views = divide === undefined ? [] : regionViewsOf(id, divide, regions);
  views.forEach((view, i) => {
    nodes[taken[i]!] = view;
    slots.set(view.id, taken[i]!);
    idUnits += nodeUnits(view);
  });
  return { nodes, slots, idUnits };
}

/** What `addNode` changes of `state`: `node` kept in `slot`, its regions in `regions`, depth
 *  first, and their identifiers counted (ARCH-regions-are-container-slots). */
function withNode(
  state: GraphView,
  node: NodeData,
  slot: number,
  { read, slots: regions }: TakenRegions,
): Partial<GraphView> {
  const { id, divide, height, ...rest } = node;
  const nodes = state.nodes.slice();
  const divided = divide !== undefined && regions.length > 0;
  nodes[slot] = nodeViewOf({
    ...rest,
    id,
    divide: divided ? divide : undefined,
    heightGiven: height === undefined ? undefined : true,
  });
  const added = divided ? regionViewsOf(id, divide, read) : [];
  const slots = new Map(state.slots).set(id, slot);
  let units = nodeUnits({ id });
  added.forEach((view, i) => {
    nodes[regions[i]!] = view;
    slots.set(view.id, regions[i]!);
    units += nodeUnits(view);
  });
  return {
    nodes,
    slots,
    idUnits: state.idUnits + units,
    // Its slot in `nodes` is the signal of the new node, which a kept query at the far level
    // survives (REN-moving-layer-moves-content, ARCH-graph-in-zustand-store); no counter moves.
    change: { kind: "nodeAdded", by: "host", id },
  };
}

/** What `addEdge` changes of `state`: `edge` kept in `slot`, and its identifiers counted. */
function withEdge(state: GraphView, edge: KeptEdge, slot: number, by: By): Partial<GraphView> {
  const edges = state.edges.slice();
  edges[slot] = edge;
  return {
    edges,
    edgeSlots: new Map(state.edgeSlots).set(edge.id, slot),
    idUnits: state.idUnits + edgeUnits(edge),
    change: { kind: "edgeAdded", by, id: edge.id },
  };
}

export function createGraphStore() {
  return createStore<GraphState>()((set) => ({
    nodes: [],
    slots: new Map(),
    edgeSlots: new Map(),
    edges: [],
    idUnits: 0,
    change: null,
    selection: null,
    hovered: null,
    connection: null,
    viewport: { x: 0, y: 0, scale: 1 },
    positionsVersion: 0,
    dragged: null,
    movesVersion: 0,
    pointerVersion: 0,
    load: (graph, idUnits) => set((state) => loadedFrom(state, graph, idUnits)),
    addNode: (node, slot, regions = { read: [], slots: [] }) =>
      set((state) => withNode(state, node, slot, regions)),
    updateNode: (update) => set((state) => updatedFrom(state, update)),
    // The engine keeps the size the resize left (ARCH-graph-in-zustand-store).
    nodeResized: (id, moved, regions = []) =>
      set({ change: { kind: "nodeResized", by: "user", id, moved, regions } }),
    regionsMoved: (node, regions, moved) =>
      set({ change: { kind: "regionsMoved", by: "user", node, regions, moved } }),
    select: (selection) => set({ selection }),
    setViewport: (viewport) => set({ viewport }),
    positionsMoved: () => set((state) => ({ positionsVersion: state.positionsVersion + 1 })),
    ...dragsOf(set),
    pointerMoved: () => set((state) => ({ pointerVersion: state.pointerVersion + 1 })),
    nodeMoved: (id, container, by = "user") => set((state) => movedFrom(state, id, container, by)),
    removeNodes: (nodeSlots, edgeSlots, by) =>
      set((state) => withoutNodes(state, nodeSlots, edgeSlots, by)),
    removeEdges: (edgeSlots, by) => set((state) => withoutEdgesOf(state, edgeSlots, by)),
    addEdge: (edge, slot, by) => set((state) => withEdge(state, edge, slot, by)),
    labelMoved: (id, index, t, offset) =>
      set((state) => {
        const { slot, edge } = edgeNamed(state, id);
        const edges = state.edges.slice();
        const labels = edge.labels!.slice();
        labels[index] = { ...labels[index]!, t, offset };
        edges[slot] = { ...edge, labels };
        const label = labels[index]!.id;
        return { edges, change: { kind: "labelMoved", by: "user", edge: id, label } };
      }),
    hover: (hovered) => set((state) => (state.hovered === hovered ? state : { hovered })),
    connect: (connection) => set({ connection }),
    updateEdge: (id, patch) =>
      set((state) => {
        const { slot, edge } = edgeNamed(state, id);
        const edges = state.edges.slice();
        const next = patched(edge, patch);
        edges[slot] = next;
        const idUnits = state.idUnits - edgeUnits(edge) + edgeUnits(next);
        return { edges, idUnits, change: { kind: "edgeUpdated", by: "host", id, patch } };
      }),
  }));
}
