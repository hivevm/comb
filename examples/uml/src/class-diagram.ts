// The class diagram of the example (G-12): Comb's public interface, its classes and interfaces as
// nodes and their relationships as edges told by kind. Each node's content is a caption for its
// stereotype where it has one, a title for its name, and one body text per attribute and per
// operation, its visibility part of the text, since Comb has no compartments of its own. Comb lays
// out at most eight rows of a node, so a classifier with more members than fit shows the first and
// then "…", UML's own mark of members left out; its data keeps every member. The nodes lie in
// rows laid out by hand, each as high as `heightOf` gives its content (ADR-0026). Three nodes are
// not of the public interface: the render layer's edges layer and the two classes that realize it
// (ADR-0018), the one realization in Comb.
import type { Comb, EdgeData, GraphData, NodeContent, NodeData, Side } from "comb";
import { styleOf, type RelationshipKind } from "./relationships";
import type { ClassifierKind } from "./rules";
import type { State } from "./state-diagram";

/** A class or an interface of the diagram, as its node shows it. */
export interface Classifier {
  id: string;
  stereotype?: string;
  name: string;
  attributes: string[];
  operations: string[];
}

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

export const NODE_WIDTH = 260;
/** The distance between the left sides of two columns, and the gap between two rows. */
const COLUMN = 360;
const ROW_GAP = 80;

/** The most rows of a node's content Comb lays out; a load of more is refused (`tooManyRows`). */
export const ROW_LIMIT = 8;
/** The row that stands for the members a node leaves out. */
export const ELLIPSIS = "…";

const INTERFACE = "«interface»";

const comb: Classifier = {
  id: "Comb",
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
  name,
  attributes: attribute ? [attribute] : [],
  operations: [],
});

/** Every class and interface of the diagram. */
export const CLASSIFIERS: Classifier[] = [
  {
    id: "CombOptions",
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
    stereotype: "«type»",
    name: "Selection",
    attributes: ['+kind: "node" | "edge"', "+id: string"],
    operations: [],
  },
  {
    id: "Viewport",
    stereotype: INTERFACE,
    name: "Viewport",
    attributes: ["+x: number", "+y: number", "+scale: number"],
    operations: [],
  },
  {
    id: "GraphChange",
    stereotype: "«type»",
    name: "GraphChange",
    attributes: ['+kind: "loaded" | "nodeAdded" | "nodeUpdated" | "nodeMoved" | …'],
    operations: [],
  },
  {
    id: "GraphData",
    stereotype: INTERFACE,
    name: "GraphData",
    attributes: ["+nodes: NodeData[]", "+edges: EdgeData[]"],
    operations: [],
  },
  {
    id: "NodeData",
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
    stereotype: "«type»",
    name: "NodeContent",
    attributes: ["= ContentElement[][]"],
    operations: [],
  },
  {
    id: "EdgeLabelData",
    stereotype: INTERFACE,
    name: "EdgeLabelData",
    attributes: ["+text: string", "+t: number", "+offset: number", "+background?: number"],
    operations: [],
  },
  {
    id: "Error",
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
    name: "EdgesContainer",
    attributes: ["+geometry: Geometry", "+mesh: Mesh", "-buffers: MeshBuffers"],
    operations: [],
  },
  {
    id: "EdgeFill",
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

/** The member texts `classifier`'s node shows, one row each: every attribute and then every
 *  operation where they fit beside its stereotype and name, otherwise as many as fit before a row
 *  of "…". */
export function shownMembers({ stereotype, attributes, operations }: Classifier): string[] {
  const members = [...attributes, ...operations];
  const rows = ROW_LIMIT - (stereotype ? 2 : 1);
  return members.length <= rows ? members : [...members.slice(0, rows - 1), ELLIPSIS];
}

/** The content of `classifier`'s node: its stereotype as a caption where it has one, its name as
 *  the title, and each member it shows as a body text, one row each. */
export function contentOf(classifier: Classifier): NodeContent {
  const { stereotype, name } = classifier;
  return [
    ...(stereotype ? [[{ kind: "text", role: "caption", text: stereotype } as const]] : []),
    [{ kind: "text", role: "title", text: name }],
    ...shownMembers(classifier).map((text) => [{ kind: "text", role: "body", text } as const]),
  ];
}

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

/** The nodes of `classifiers` laid out in `rows` from top to bottom, each by its column from the
 *  left: a node's top lies on its row's, and a row starts below the highest node of the row
 *  above, by the height `heightOf` gives its content. */
export function laidOut(
  rows: readonly (readonly [string, number])[][],
  classifiers: ReadonlyMap<string, Classifier>,
  heightOf: Comb["heightOf"],
): Map<string, NodeData> {
  const byId = new Map<string, NodeData>();
  let top = 0;
  for (const row of rows) {
    let bottom = top;
    for (const [id, column] of row) {
      const content = contentOf(classifiers.get(id)!);
      const height = heightOf(content, NODE_WIDTH);
      byId.set(id, { id, x: column * COLUMN, y: top, width: NODE_WIDTH, content });
      bottom = Math.max(bottom, top + height);
    }
    top = bottom + ROW_GAP;
  }
  return byId;
}

/** A diagram as graph data, with the classifier or the state of each node and the kind of each
 *  edge by their identifiers. */
export interface DiagramData {
  graph: GraphData;
  classifiers: Map<string, Classifier>;
  states: Map<string, State>;
  kinds: Map<string, RelationshipKind>;
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

/** The stereotype of each kind of node, none for a plain class. */
const STEREOTYPES: Record<ClassifierKind, string | undefined> = {
  class: undefined,
  interface: INTERFACE,
  "abstract-class": "«abstract»",
  package: "«package»",
};

/** The kind of node `classifier` is, told by its stereotype: «interface» an interface,
 *  «abstract» an abstract class, «package» a package, any other or none a class. */
export function kindOf({ stereotype }: Pick<Classifier, "stereotype">): ClassifierKind {
  if (stereotype === INTERFACE) return "interface";
  if (stereotype === STEREOTYPES.package) return "package";
  return stereotype === STEREOTYPES["abstract-class"] ? "abstract-class" : "class";
}

/** The name a node of each kind dropped from the palette starts with. */
const DROPPED: Record<ClassifierKind, string> = {
  class: "NewClass",
  interface: "NewInterface",
  "abstract-class": "NewAbstractClass",
  package: "NewPackage",
};

/** A classifier of `kind`, as the palette drops it: its stereotype, a default name, no members. */
export function newClassifier(id: string, kind: ClassifierKind): Classifier {
  const stereotype = STEREOTYPES[kind];
  return {
    id,
    ...(stereotype ? { stereotype } : {}),
    name: DROPPED[kind],
    attributes: [],
    operations: [],
  };
}
