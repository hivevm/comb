// The state of the graph and the viewport (ADR-0011). Coordinates are not kept here: they live in
// the engine's buffer, and `positionsVersion` tells readers that they moved.
import { createStore } from "zustand/vanilla";

/** A node as the host application hands it over; `x` and `y` are its initial position. */
export interface NodeData {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

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

/** A node as the store keeps it: everything but its position. */
export type NodeView = Omit<NodeData, "x" | "y">;

/** The change the last action that changed the graph made, by kind and the identifier it touched,
 *  never a coordinate (ADR-0011, ADR-0023): `api` delivers it to the host application, reading
 *  what it carries from the store and the engine's buffers. A new object for every change, so
 *  that one is told from the next by identity. */
export type StoreChange =
  | { readonly kind: "loaded"; readonly by: "host" }
  | { readonly kind: "nodeAdded"; readonly by: "host"; readonly id: string }
  | { readonly kind: "nodeMoved"; readonly by: "user"; readonly id: string }
  | {
      readonly kind: "nodeUpdated";
      readonly by: "host";
      readonly id: string;
      readonly patch: Readonly<Partial<Pick<NodeView, "title">>>;
    };

/** The state without its actions, read-only to its leaves: what the render layer sees, so the
 *  type checker refuses a write (ADR-0026). */
export interface GraphView {
  readonly nodes: readonly Readonly<NodeView>[];
  readonly slots: ReadonlyMap<string, number>;
  /** The UTF-16 code units of every identifier the graph holds, a node's, an edge's, and each
   *  edge's source and target, which the limits of a load bound after every edit (ADR-0023). */
  readonly idUnits: number;
  /** The change the last action that changed the graph made, or none before the first. */
  readonly change: StoreChange | null;
  readonly edges: readonly Readonly<
    Omit<EdgeData, "label"> & { readonly label?: Readonly<EdgeLabelData> }
  >[];
  readonly selection: Readonly<Selection>;
  readonly viewport: Readonly<Viewport>;
  readonly positionsVersion: number;
}

export interface GraphState extends GraphView {
  load(graph: GraphData): void;
  /** Keeps `node`, which the engine took into `slot`, without its position. */
  addNode(node: NodeData, slot: number): void;
  updateNode(id: string, patch: Partial<Pick<NodeView, "title">>): void;
  select(selection: Selection): void;
  setViewport(viewport: Viewport): void;
  positionsMoved(): void;
  /** Records that a drag, now released, left the node `id` where the engine keeps it. */
  nodeMoved(id: string): void;
}

export type GraphStore = ReturnType<typeof createGraphStore>;

/** The UTF-16 code units of every identifier of `graph`. */
function idUnitsOf(graph: GraphData): number {
  let units = 0;
  for (const node of graph.nodes) units += node.id.length;
  for (const edge of graph.edges) units += edge.id.length + edge.source.length + edge.target.length;
  return units;
}

export function createGraphStore() {
  return createStore<GraphState>()((set) => ({
    nodes: [],
    slots: new Map(),
    edges: [],
    idUnits: 0,
    change: null,
    selection: null,
    viewport: { x: 0, y: 0, scale: 1 },
    positionsVersion: 0,
    load: (graph) =>
      set((state) => ({
        nodes: graph.nodes.map(({ id, title, width, height }) => ({ id, title, width, height })),
        slots: new Map(graph.nodes.map((node, slot) => [node.id, slot])),
        edges: graph.edges,
        idUnits: idUnitsOf(graph),
        change: { kind: "loaded", by: "host" },
        selection: null,
        positionsVersion: state.positionsVersion + 1,
      })),
    addNode: ({ id, title, width, height }, slot) =>
      set((state) => {
        const nodes = state.nodes.slice();
        nodes[slot] = { id, title, width, height };
        return {
          nodes,
          slots: new Map(state.slots).set(id, slot),
          idUnits: state.idUnits + id.length,
          change: { kind: "nodeAdded", by: "host", id },
          // The engine's positions buffer holds the new slot.
          positionsVersion: state.positionsVersion + 1,
        };
      }),
    updateNode: (id, patch) =>
      set((state) => ({
        nodes: state.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
        change: { kind: "nodeUpdated", by: "host", id, patch },
      })),
    select: (selection) => set({ selection }),
    setViewport: (viewport) => set({ viewport }),
    positionsMoved: () => set((state) => ({ positionsVersion: state.positionsVersion + 1 })),
    nodeMoved: (id) => set({ change: { kind: "nodeMoved", by: "user", id } }),
  }));
}
