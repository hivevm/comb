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

/** An edge from a connector of one node to a connector of another. */
export interface EdgeData {
  id: string;
  source: string;
  target: string;
  color?: number;
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

/** The state without its actions, read-only to its leaves: what the render layer sees, so the
 *  type checker refuses a write (ADR-0009). */
export interface GraphView {
  readonly nodes: readonly Readonly<NodeView>[];
  readonly slots: ReadonlyMap<string, number>;
  readonly edges: readonly Readonly<
    Omit<EdgeData, "label"> & { readonly label?: Readonly<EdgeLabelData> }
  >[];
  readonly selection: Readonly<Selection>;
  readonly viewport: Readonly<Viewport>;
  readonly positionsVersion: number;
}

export interface GraphState extends GraphView {
  load(graph: GraphData): void;
  updateNode(id: string, patch: Partial<Pick<NodeView, "title">>): void;
  select(selection: Selection): void;
  setViewport(viewport: Viewport): void;
  positionsMoved(): void;
}

export type GraphStore = ReturnType<typeof createGraphStore>;

export function createGraphStore() {
  return createStore<GraphState>()((set) => ({
    nodes: [],
    slots: new Map(),
    edges: [],
    selection: null,
    viewport: { x: 0, y: 0, scale: 1 },
    positionsVersion: 0,
    load: (graph) =>
      set((state) => ({
        nodes: graph.nodes.map(({ id, title, width, height }) => ({ id, title, width, height })),
        slots: new Map(graph.nodes.map((node, slot) => [node.id, slot])),
        edges: graph.edges,
        selection: null,
        positionsVersion: state.positionsVersion + 1,
      })),
    updateNode: (id, patch) =>
      set((state) => ({
        nodes: state.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
      })),
    select: (selection) => set({ selection }),
    setViewport: (viewport) => set({ viewport }),
    positionsMoved: () => set((state) => ({ positionsVersion: state.positionsVersion + 1 })),
  }));
}
