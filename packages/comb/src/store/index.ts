// The state of the graph and the viewport (ADR-0029). Coordinates are not kept here: positions live
// in the engine's buffer, and `positionsVersion` tells readers that they moved; the point a
// connection is dragged to lives in interaction, and `pointerVersion` tells them that it moved.
import { createStore } from "zustand/vanilla";
import type { NodeContent } from "../bridge";

export type { ContentElement, NodeContent, TextRole } from "../bridge";

/** A node as the host application hands it over: `x` and `y` are its initial position, and
 *  `content` what it shows, rows of weighted columns, from which Comb computes its height
 *  (ADR-0013). */
export interface NodeData {
  id: string;
  x: number;
  y: number;
  width: number;
  content: NodeContent;
}

/** A side of a node, at whose middle its connector sits (ADR-0024). */
export type Side = "top" | "right" | "bottom" | "left";

/** An edge label: placed by its path parameter `t` and its label offset in pixels (G-6). */
export interface EdgeLabelData {
  text: string;
  t: number;
  offset: number;
  background?: number;
}

/** An edge from a connector of one node to a connector of another, drawn in `color`
 *  (`0xRRGGBB`), dashed by `dash` (dash and gap lengths in world units; solid without), and
 *  with an arrowhead at its target unless `arrow` is `"none"` (G-11). */
export interface EdgeData {
  id: string;
  source: string;
  target: string;
  /** The side of its source it leaves by, `right` where left out (ADR-0024). */
  sourceSide?: Side;
  /** The side of its target it enters by, `left` where left out. */
  targetSide?: Side;
  color?: number;
  dash?: readonly [number, number];
  arrow?: "end" | "none";
  label?: EdgeLabelData;
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

/** What `updateEdge` may change of an edge: its colour, dash pattern, arrowhead, label, or sides,
 *  a dash and a label cleared with `null`. */
export interface EdgePatch {
  color?: number;
  arrow?: "end" | "none";
  sourceSide?: Side;
  targetSide?: Side;
  dash?: readonly [number, number] | null;
  label?: EdgeLabelData | null;
}

/** A node as the store keeps it: everything but its position; its height is the engine's. */
export type NodeView = Omit<NodeData, "x" | "y">;

/** What `updateNode` may change of a node: its content, which it replaces whole (ADR-0013). */
export interface NodePatch {
  content?: NodeContent;
}

/** Who made a change: the user on the canvas, or the host application through `Comb`. */
export type By = "user" | "host";

/** The change the last action that changed the graph made, by kind and the identifier it touched,
 *  never a coordinate (ADR-0029, ADR-0030): `api` delivers it to the host application, reading
 *  what it carries from the store and the engine's buffers. A new object for every change, so
 *  that one is told from the next by identity. */
export type StoreChange =
  | { readonly kind: "loaded"; readonly by: "host" }
  | { readonly kind: "nodeAdded"; readonly by: "host"; readonly id: string }
  | { readonly kind: "nodeMoved"; readonly by: "user"; readonly id: string }
  | {
      readonly kind: "nodesRemoved";
      readonly by: By;
      readonly nodes: readonly string[];
      readonly edges: readonly string[];
    }
  | { readonly kind: "edgesRemoved"; readonly by: By; readonly edges: readonly string[] }
  | { readonly kind: "edgeAdded"; readonly by: By; readonly id: string }
  | { readonly kind: "labelMoved"; readonly by: "user"; readonly edge: string }
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
      readonly patch: Readonly<NodePatch>;
    };

/** A connection the user drags from the connector `side` of the node in slot `source` (ADR-0024):
 *  over the node in slot `over`, whose connectors are `compatible` where the source does not reach
 *  it yet, and over its connector `target` where a release connects. The world point it is dragged
 *  to is no part of it: interaction keeps that point and signals its moves by `pointerVersion`
 *  (ADR-0029). */
export interface Connection {
  readonly source: number;
  readonly side: Side;
  readonly over: number | null;
  readonly compatible: boolean;
  readonly target: { readonly slot: number; readonly side: Side } | null;
}

/** The state without its actions, read-only to its leaves: what the render layer sees, so the
 *  type checker refuses a write (ADR-0028). */
export interface GraphView {
  /** The node in each slot, none at a free slot (ADR-0022). */
  readonly nodes: readonly (Readonly<NodeView> | undefined)[];
  readonly slots: ReadonlyMap<string, number>;
  /** The slot of each edge the graph holds, by its identifier. */
  readonly edgeSlots: ReadonlyMap<string, number>;
  /** The UTF-16 code units of every identifier the graph holds, a node's, an edge's, and each
   *  edge's source and target, which the limits of a load bound after every edit (ADR-0030). */
  readonly idUnits: number;
  /** The change the last action that changed the graph made, or none before the first. */
  readonly change: StoreChange | null;
  /** The edge in each slot, none at a free slot (ADR-0022). */
  readonly edges: readonly (
    Readonly<Omit<EdgeData, "label"> & { readonly label?: Readonly<EdgeLabelData> }> | undefined
  )[];
  readonly selection: Readonly<Selection>;
  /** The node whose connectors the pointer shows, or none (ADR-0024). */
  readonly hovered: number | null;
  /** The connection the user drags, or none. A load or a removal of its source leaves it, for its
   *  gesture to end before anything reads the store after the change. */
  readonly connection: Connection | null;
  readonly viewport: Readonly<Viewport>;
  readonly positionsVersion: number;
  /** Counts the moves of the point a connection is dragged to, which interaction keeps. */
  readonly pointerVersion: number;
}

export interface GraphState extends GraphView {
  /** Replaces the graph by `graph`, whose identifiers hold `idUnits` UTF-16 code units, as the
   *  snapshot counted them while it read them. */
  load(graph: GraphData, idUnits: number): void;
  /** Keeps `node`, which the engine took into `slot`, without its position. */
  addNode(node: NodeData, slot: number): void;
  updateNode(id: string, patch: NodePatch): void;
  select(selection: Selection): void;
  setViewport(viewport: Viewport): void;
  positionsMoved(): void;
  /** Records that the point a connection is dragged to moved, where interaction keeps it. */
  pointerMoved(): void;
  /** Records that a drag, now released, left the node `id` where the engine keeps it. */
  nodeMoved(id: string): void;
  /** Forgets the nodes in `nodeSlots` and the edges in `edgeSlots`, which the engine removed,
   *  leaving their slots free, and clears a selection of one of them. */
  removeNodes(nodeSlots: readonly number[], edgeSlots: readonly number[], by: By): void;
  /** Forgets the edges in `edgeSlots`, which the engine removed, leaving their slots free. */
  removeEdges(edgeSlots: readonly number[], by: By): void;
  /** Keeps `edge`, which the engine took into `slot`, as `by` made it. */
  addEdge(edge: EdgeData, slot: number, by: By): void;
  /** Records that a drag, now released, left the label of the edge `id` at path parameter `t`
   *  and label offset `offset`, where the engine placed it. */
  labelMoved(id: string, t: number, offset: number): void;
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

/** The UTF-16 code units of the identifiers of `edge`: its own, its source's, and its target's. */
function edgeUnits(edge: Pick<EdgeData, "id" | "source" | "target">): number {
  return edge.id.length + edge.source.length + edge.target.length;
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
function loadedFrom(state: GraphView, graph: GraphData, idUnits: number): Partial<GraphView> {
  const slots = new Map<string, number>();
  for (let slot = 0; slot < graph.nodes.length; slot++) slots.set(graph.nodes[slot]!.id, slot);
  const edgeSlots = new Map<string, number>();
  for (let slot = 0; slot < graph.edges.length; slot++) edgeSlots.set(graph.edges[slot]!.id, slot);
  return {
    nodes: graph.nodes.map(({ id, width, content }) => ({ id, width, content })),
    slots,
    edgeSlots,
    edges: graph.edges,
    idUnits,
    change: { kind: "loaded", by: "host" },
    selection: null,
    hovered: null,
    positionsVersion: state.positionsVersion + 1,
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
    ids.push(node.id);
    units += nodeUnits(node);
  }
  const { selection } = state;
  const cleared =
    (selection?.kind === "node" && !slots.has(selection.id)) ||
    (selection?.kind === "edge" && !removed.edgeSlots.has(selection.id));
  const hoveredAndConnection = hoveredAndConnectionWithout(state, nodes);
  return {
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

/** `edge` with `patch` merged: a field the patch sets replaces the edge's, and `null` clears a dash
 *  or a label. */
function patched(edge: EdgeView, patch: EdgePatch): EdgeView {
  const { dash, label, ...rest } = { ...edge, ...patch };
  return {
    ...rest,
    ...(dash ? { dash } : {}),
    ...(label ? { label } : {}),
  };
}

/** What `addEdge` changes of `state`: `edge` kept in `slot`, and its identifiers counted. */
function withEdge(state: GraphView, edge: EdgeData, slot: number, by: By): Partial<GraphView> {
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
    pointerVersion: 0,
    load: (graph, idUnits) => set((state) => loadedFrom(state, graph, idUnits)),
    addNode: ({ id, width, content }, slot) =>
      set((state) => {
        const nodes = state.nodes.slice();
        nodes[slot] = { id, width, content };
        return {
          nodes,
          slots: new Map(state.slots).set(id, slot),
          idUnits: state.idUnits + nodeUnits({ id }),
          change: { kind: "nodeAdded", by: "host", id },
          // The engine's positions buffer holds the new slot.
          positionsVersion: state.positionsVersion + 1,
        };
      }),
    updateNode: (id, patch) =>
      set((state) => ({
        nodes: state.nodes.map((node) => (node?.id === id ? { ...node, ...patch } : node)),
        change: { kind: "nodeUpdated", by: "host", id, patch },
      })),
    select: (selection) => set({ selection }),
    setViewport: (viewport) => set({ viewport }),
    positionsMoved: () => set((state) => ({ positionsVersion: state.positionsVersion + 1 })),
    pointerMoved: () => set((state) => ({ pointerVersion: state.pointerVersion + 1 })),
    nodeMoved: (id) => set({ change: { kind: "nodeMoved", by: "user", id } }),
    removeNodes: (nodeSlots, edgeSlots, by) =>
      set((state) => withoutNodes(state, nodeSlots, edgeSlots, by)),
    removeEdges: (edgeSlots, by) => set((state) => withoutEdgesOf(state, edgeSlots, by)),
    addEdge: (edge, slot, by) => set((state) => withEdge(state, edge, slot, by)),
    labelMoved: (id, t, offset) =>
      set((state) => {
        const { slot, edge } = edgeNamed(state, id);
        const edges = state.edges.slice();
        edges[slot] = { ...edge, label: { ...edge.label!, t, offset } };
        return { edges, change: { kind: "labelMoved", by: "user", edge: id } };
      }),
    hover: (hovered) => set((state) => (state.hovered === hovered ? state : { hovered })),
    connect: (connection) => set({ connection }),
    updateEdge: (id, patch) =>
      set((state) => {
        const { slot, edge } = edgeNamed(state, id);
        const edges = state.edges.slice();
        edges[slot] = patched(edge, patch);
        return { edges, change: { kind: "edgeUpdated", by: "host", id, patch } };
      }),
  }));
}
