// The class diagram of the example (G-12): Comb's public interface, its classes and interfaces as
// nodes and their relationships as edges told by kind. Each node's content is a caption for its
// stereotype where it has one, a title for its name, and one body text per attribute and per
// operation, its visibility part of the text, since Comb has no compartments of its own. Comb lays
// out at most eight rows of a node, so a classifier with more members than fit shows the first and
// then "…", UML's own mark of members left out; its data keeps every member. The nodes lie in
// rows laid out by hand, each as high as `heightOf` gives its content (ADR-0026). Three nodes are
// not of the public interface: the render layer's edges layer and the two classes that realize it
// (ADR-0018), the one realization in Comb. Each classifier names its kind, class or interface;
// a «type» is a class.
import type { Comb, EdgeData, Side } from "comb";
import { styleOf, type RelationshipKind } from "./relationships";
import { laidOut, type Classifier, type DiagramData } from "./shared";

/** A relationship of the diagram, from `source` to `target`; the whole is the source of an
 *  aggregation or a composition, the specific the source of a generalization or a realization. */
export interface Relationship {
  source: string;
  target: string;
  kind: RelationshipKind;
  /** The sides of its source and its target the edge leaves and enters by; the right of its
   *  source and the left of its target, as Comb's default, where it names none. */
  sides?: readonly [Side, Side];
}

const INTERFACE = "«interface»";

const comb: Classifier = {
  id: "Comb",
  kind: "interface",
  stereotype: INTERFACE,
  name: "Comb",
  attributes: [],
  // The operations a host application calls first come first, since the node shows five.
  operations: [
    "+load(graph: GraphData)",
    "+heightOf(content, width): number",
    "+addNode(node: NodeData)",
    "+addEdge(edge: EdgeData)",
    "+onChange(listener)",
    "+updateNode(id: string, patch: NodePatch)",
    "+removeNodes(ids: string[])",
    "+updateEdge(id: string, patch: EdgePatch)",
    "+removeEdges(ids: string[])",
    "+fitView()",
    "+setViewport(viewport: Viewport)",
    "+viewport(): Viewport",
    "+worldPointAt(clientX: number, clientY: number)",
    "+onSelectionChange(listener)",
    "+onContentClick(listener)",
    "+registerIcon(name: string, image)",
    "+onEngineLost(listener)",
    "+whenRendered(): Promise<void>",
    "+destroy()",
  ],
};

const errorOf = (name: string, attribute?: string): Classifier => ({
  id: name,
  kind: "class",
  name,
  attributes: attribute ? [attribute] : [],
  operations: [],
});

/** Every class and interface of the diagram. */
export const CLASSIFIERS: Classifier[] = [
  {
    id: "CombOptions",
    kind: "interface",
    stereotype: INTERFACE,
    name: "CombOptions",
    attributes: [
      "+engine: EngineSource",
      "+background?: number",
      "+allowCanvasFallback?: boolean",
      "+canDelete?: (deletion) => boolean",
      "+canConnect?: (proposal) => string | false",
    ],
    operations: [],
  },
  comb,
  {
    id: "Selection",
    kind: "class",
    stereotype: "«type»",
    name: "Selection",
    attributes: ['+kind: "node" | "edge"', "+id: string"],
    operations: [],
  },
  {
    id: "Viewport",
    kind: "interface",
    stereotype: INTERFACE,
    name: "Viewport",
    attributes: ["+x: number", "+y: number", "+scale: number"],
    operations: [],
  },
  {
    id: "GraphChange",
    kind: "class",
    stereotype: "«type»",
    name: "GraphChange",
    attributes: ['+kind: "loaded" | "nodeAdded" | "nodeUpdated" | "nodeMoved" | …'],
    operations: [],
  },
  {
    id: "GraphData",
    kind: "interface",
    stereotype: INTERFACE,
    name: "GraphData",
    attributes: ["+nodes: NodeData[]", "+edges: EdgeData[]"],
    operations: [],
  },
  {
    id: "NodeData",
    kind: "interface",
    stereotype: INTERFACE,
    name: "NodeData",
    attributes: [
      "+id: string",
      "+x: number",
      "+y: number",
      "+width: number",
      "+content: NodeContent",
    ],
    operations: [],
  },
  {
    id: "EdgeData",
    kind: "interface",
    stereotype: INTERFACE,
    name: "EdgeData",
    attributes: [
      "+id: string",
      "+source: string",
      "+target: string",
      "+sourceSide?: Side",
      "+targetSide?: Side",
      "+color?: number",
      "+dash?: [number, number]",
      '+arrow?: "end" | "none"',
      "+label?: EdgeLabelData",
    ],
    operations: [],
  },
  {
    id: "NodeContent",
    kind: "class",
    stereotype: "«type»",
    name: "NodeContent",
    attributes: ["= ContentElement[][]"],
    operations: [],
  },
  {
    id: "EdgeLabelData",
    kind: "interface",
    stereotype: INTERFACE,
    name: "EdgeLabelData",
    attributes: ["+text: string", "+t: number", "+offset: number", "+background?: number"],
    operations: [],
  },
  {
    id: "Error",
    kind: "class",
    name: "Error",
    attributes: ["+name: string", "+message: string", "+cause?: unknown"],
    operations: [],
  },
  errorOf("GraphDataError", "+problem: GraphDataProblem"),
  errorOf("EngineSourceError", "+reason: EngineSourceProblem"),
  errorOf("IconError", "+reason: IconProblem"),
  errorOf("RendererUnavailableError", "+renderer: string"),
  errorOf("EngineLostError"),
  {
    id: "EdgeLayer",
    kind: "interface",
    stereotype: INTERFACE,
    name: "EdgeLayer",
    attributes: [],
    operations: [
      "+sync(drawn: DrawnMesh)",
      "+hide(hidden: Set<number>)",
      "+names(slot: number): boolean",
      "+size(): MeshSize",
      "+triangles(): number",
    ],
  },
  {
    id: "EdgesContainer",
    kind: "class",
    name: "EdgesContainer",
    attributes: ["+geometry: Geometry", "+mesh: Mesh", "-buffers: MeshBuffers"],
    operations: [],
  },
  {
    id: "EdgeFill",
    kind: "class",
    name: "EdgeFill",
    attributes: ["+drawing: Graphics", "-drawn: MeshSize"],
    operations: [],
  },
];

/** The rows of the diagram from top to bottom, each node by its column from the left; a node's
 *  top lies on its row's, and a row starts below the highest node of the row above. */
const ROWS: [string, number][][] = [
  [
    ["Comb", 0],
    ["Selection", 1],
    ["GraphData", 2.5],
  ],
  [
    ["GraphChange", 0],
    ["Viewport", 1],
    ["NodeData", 2],
    ["EdgeData", 3],
  ],
  [
    ["CombOptions", 0],
    ["NodeContent", 2],
    ["EdgeLabelData", 3],
  ],
  [
    ["Error", 2],
    ["EdgeLayer", 5.5],
  ],
  [
    ["GraphDataError", 0],
    ["EngineSourceError", 1],
    ["IconError", 2],
    ["RendererUnavailableError", 3],
    ["EngineLostError", 4],
    ["EdgesContainer", 5],
    ["EdgeFill", 6],
  ],
];

/** The sides of an edge from the top of its source to the bottom of its target, and back. */
const UP = ["top", "bottom"] as const;
const DOWN = ["bottom", "top"] as const;

/** Every relationship of the diagram, at least one of each kind. */
export const RELATIONSHIPS: Relationship[] = [
  { source: "Comb", target: "Selection", kind: "association" },
  { source: "Comb", target: "Viewport", kind: "aggregation" },
  { source: "Comb", target: "GraphData", kind: "dependency", sides: ["top", "top"] },
  { source: "Comb", target: "GraphChange", kind: "dependency", sides: DOWN },
  { source: "GraphData", target: "NodeData", kind: "composition", sides: ["left", "top"] },
  { source: "GraphData", target: "EdgeData", kind: "composition", sides: ["right", "top"] },
  { source: "NodeData", target: "NodeContent", kind: "composition", sides: DOWN },
  { source: "EdgeData", target: "EdgeLabelData", kind: "composition", sides: DOWN },
  {
    source: "EdgeData",
    target: "NodeData",
    kind: "directed-association",
    sides: ["left", "right"],
  },
  ...[
    "GraphDataError",
    "EngineSourceError",
    "IconError",
    "RendererUnavailableError",
    "EngineLostError",
  ].map((source): Relationship => ({ source, target: "Error", kind: "generalization", sides: UP })),
  { source: "EdgesContainer", target: "EdgeLayer", kind: "realization", sides: UP },
  { source: "EdgeFill", target: "EdgeLayer", kind: "realization", sides: UP },
];

/** The edge of a relationship, drawn as its kind is. */
function edgeOf({ source, target, kind, sides }: Relationship): EdgeData {
  return {
    id: `${source}-${kind}-${target}`,
    source,
    target,
    ...(sides ? { sourceSide: sides[0], targetSide: sides[1] } : {}),
    ...styleOf(kind),
  };
}

/** The class diagram as graph data, each node placed by the height `heightOf` gives its content,
 *  with the classifier of each node and the kind of each edge by their identifiers. */
export function classDiagram(heightOf: Comb["heightOf"]): DiagramData {
  const classifiers = new Map(CLASSIFIERS.map((each) => [each.id, structuredClone(each)]));
  const byId = laidOut(ROWS, classifiers, heightOf);
  const edges = RELATIONSHIPS.map(edgeOf);
  return {
    graph: { nodes: CLASSIFIERS.map(({ id }) => byId.get(id)!), edges },
    classifiers,
    states: new Map(),
    kinds: new Map(RELATIONSHIPS.map((each, i) => [edges[i]!.id, each.kind])),
  };
}
