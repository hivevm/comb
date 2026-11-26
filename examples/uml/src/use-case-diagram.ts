// The use case diagram of the example (G-20): Comb's actors, the developer, the user, and the host
// application, outside the subject Comb, which holds the use cases of G-1 to G-17, in the notation
// of UML 2.5.1. An actor is an `actor`, its name below its drawing; a use case an ellipse of its
// name and, below a separator, its extension points; the subject a rectangular container titled
// Comb. An association joins an actor and a use case, a multiplicity at each end; an include and an
// extend are dashed with an open arrowhead and their keyword, the extend's condition a comment
// anchored at its middle (API-edges-dock-nodes-or-edges); a generalization between two actors or
// two use cases ends in a hollow triangle. A use case dropped over the subject lands in it, an
// actor on the canvas, and the example's veto refuses an actor moved into the subject
// (API-edits-report-nested-changes). The building blocks were settled with the human for ticket 13
// of uml-diagrams on 2026-11-18.
import type { Comb, ContainerMove, EdgeData, NodeContent, NodeData, NodeShape } from "comb";
import { multiplicityLabelsOf, styleOf, type RelationshipKind } from "./relationships";
import {
  ELLIPSIS,
  ROW_LIMIT,
  type DiagramData,
  type DiagramDescriptor,
  type NodeKind,
  type Place,
  type UseCaseKind,
  type UseCaseNode,
} from "./shared";

/** The building blocks of each kind: its node shape, its width, a height where it is given one,
 *  whether it holds nodes, and whether it stands outside every subject, on the canvas. */
export const USE_CASE_SHAPES: Record<
  UseCaseKind,
  { shape: NodeShape; width: number; height?: number; holds?: true; outside?: true }
> = {
  actor: { shape: "actor", width: 160, outside: true },
  "use-case": { shape: "ellipse", width: 300 },
  subject: { shape: "rectangle", width: 400, height: 300, holds: true },
  "use-case-comment": { shape: "note", width: 300 },
};

const row = (role: "title" | "caption" | "body", text: string) => [
  { kind: "text", role, text } as const,
];

/** The content of `node`: an actor's, a use case's, or the subject's name as a title, a use case's
 *  extension points, where it has any, below a separator under the caption "extension points", and
 *  a comment's lines. */
export function contentOf(node: UseCaseNode): NodeContent {
  const { name = "", points = [], body = [] } = node;
  if (node.kind === "use-case-comment")
    return (body.length <= ROW_LIMIT ? body : [...body.slice(0, ROW_LIMIT - 1), ELLIPSIS]).map(
      (text) => row("body", text),
    );
  if (node.kind !== "use-case" || points.length === 0) return [row("title", name)];
  // The name, the separator, and the caption take three of the rows Comb lays out.
  const shown =
    points.length <= ROW_LIMIT - 3 ? points : [...points.slice(0, ROW_LIMIT - 4), ELLIPSIS];
  return [
    row("title", name),
    "separator",
    row("caption", "extension points"),
    ...shown.map((point) => row("body", point)),
  ];
}

/** The node of `node` with its centre at `place`, as wide as its building block and as high as
 *  `heightOf` gives its content; the subject a resizable container of `size`, or of its building
 *  block's size. */
export function nodeOf(
  node: UseCaseNode,
  place: Extract<Place, { x: number }>,
  heightOf: Comb["heightOf"],
  size?: { width: number; height: number },
): NodeData {
  const block = USE_CASE_SHAPES[node.kind];
  const { shape, holds } = block;
  const content = contentOf(node);
  const width = size?.width ?? block.width;
  const height = size?.height ?? block.height ?? heightOf(content, width, shape);
  return {
    id: node.id,
    width,
    shape,
    content,
    ...(holds ? { height, isContainer: true, resizable: true } : {}),
    x: place.x - width / 2,
    y: place.y - height / 2,
    ...(place.container === undefined ? {} : { container: place.container }),
  };
}

/** The node of `kind` the palette drops, named after its kind, a comment of one line. */
export function newUseCaseNode(id: string, kind: UseCaseKind): UseCaseNode {
  const named: Record<UseCaseKind, Partial<UseCaseNode>> = {
    actor: { name: "NewActor" },
    "use-case": { name: "New use case" },
    subject: { name: "NewSubject" },
    "use-case-comment": { body: ["A comment"] },
  };
  return { id, kind, ...named[kind] };
}

/** The kind a connection adds between nodes of kinds `source` and `target`: from a comment its
 *  anchor, between two actors a generalization, between two use cases an include, which the
 *  sidebar changes to an extend or a generalization, and else an association, which the table of
 *  refusals refuses but between an actor and a use case. */
function connectedOf(source: NodeKind, target: NodeKind): RelationshipKind {
  if (source === "use-case-comment") return "anchor";
  if (source === "actor" && target === "actor") return "use-case-generalization";
  return source === "use-case" && target === "use-case" ? "include" : "association";
}

/** The example's veto of the user's move of a node of `kind` into a container: an actor stands
 *  outside the subject, so a move of one into it is refused; every other move is allowed. */
function canMoveInto({ container }: ContainerMove, kind: NodeKind | undefined): boolean {
  const outside = USE_CASE_SHAPES[kind as UseCaseKind]?.outside === true;
  return container === null || !outside;
}

/** The centre `x`, `y` in the subject, relative to its top left corner. */
const inComb = (x: number, y: number) => ({ x, y, container: "comb" });

/** The centres of the subject's three columns and of its eight rows, relative to its top left
 *  corner; the third row is lower, so that Select a node or an edge, with its extension points,
 *  clears the rows beside it. */
const COLUMNS = [200, 550, 900] as const;
const ROWS = [150, 310, 500, 690, 850, 1010, 1170, 1330] as const;

/** A use case named `name` with the extension points `points`, in column `column` and row `row`
 *  of the subject. */
const useCase = (
  id: string,
  name: string,
  [column, line]: readonly [number, number],
  points?: string[],
) => ({
  node: { id, kind: "use-case" as const, name, ...(points ? { points } : {}) },
  place: inComb(COLUMNS[column]!, ROWS[line]!),
});

/** The diagram's nodes, each with its centre: the subject, 1100 by 1440, at (400, 0) on the
 *  canvas; the user and the developer left of it, the host application right of it; in the
 *  subject, the user's use cases in its left column, the host application's in its right one, the
 *  developer's below the user's, and the included, extending, and specializing use cases between,
 *  each beside the use case it serves; and the extend's condition above the extending one. */
const SEEDS: {
  node: UseCaseNode;
  place: Extract<Place, { x: number }>;
  size?: { width: number; height: number };
}[] = [
  {
    node: { id: "comb", kind: "subject", name: "Comb" },
    place: { x: 950, y: 720 },
    size: { width: 1100, height: 1440 },
  },
  { node: { id: "user", kind: "actor", name: "User" }, place: { x: 100, y: 580 } },
  { node: { id: "developer", kind: "actor", name: "Developer" }, place: { x: 100, y: 1250 } },
  { node: { id: "host", kind: "actor", name: "Host application" }, place: { x: 1800, y: 580 } },
  useCase("drag-node", "Drag a node", [0, 0]),
  useCase("connect", "Connect two nodes", [0, 1]),
  useCase("select", "Select a node or an edge", [0, 2], ["Delete pressed"]),
  useCase("drag-label", "Drag an edge label", [0, 3]),
  useCase("pan-zoom", "Pan and zoom", [0, 4]),
  useCase("resize", "Resize a node", [0, 5]),
  useCase("run-metric-tree", "Run the metric tree example", [0, 6]),
  useCase("run-uml", "Run the UML example", [0, 7]),
  useCase("drop-in-container", "Drop a node in a container", [1, 0]),
  useCase("delete", "Delete the selection", [1, 2]),
  useCase("draw-in-view", "Draw what is in view", [1, 4]),
  useCase("add-node", "Add a node", [2, 0]),
  useCase("describe-content", "Describe a node's content", [2, 1]),
  useCase("style-edge", "Style an edge", [2, 2]),
  useCase("shape-node", "Shape a node", [2, 3]),
  useCase("divide", "Divide a node into regions", [2, 4]),
  useCase("attach-border-node", "Attach a border node", [2, 5]),
  {
    node: {
      id: "delete-condition",
      kind: "use-case-comment",
      body: ["Condition: {Delete pressed}", "extension point: Delete pressed"],
    },
    place: inComb(COLUMNS[1], ROWS[1]),
  },
];

/** Each relationship: its source, its target, and its kind, an actor's association by default. */
const RELATIONSHIPS: [string, string, RelationshipKind?][] = [
  ...["drag-node", "connect", "select", "drag-label", "pan-zoom", "resize"].map(
    (target) => ["user", target] as [string, string],
  ),
  ["developer", "run-metric-tree"],
  ["developer", "run-uml"],
  ...["add-node", "style-edge", "shape-node", "divide", "attach-border-node"].map(
    (target) => ["host", target] as [string, string],
  ),
  ["add-node", "describe-content", "include"],
  ["pan-zoom", "draw-in-view", "include"],
  ["delete", "select", "extend"],
  ["drop-in-container", "drag-node", "use-case-generalization"],
  ["developer", "user", "use-case-generalization"],
];

/** The edge of a relationship, docked on the outline at both ends, drawn as its kind, an
 *  association with the multiplicity 1 at its actor and 0..* at its use case. */
function edgeOf([source, target, kind = "association"]: (typeof RELATIONSHIPS)[number]) {
  const style = styleOf(kind);
  const edge: EdgeData = {
    id: `${source}-${target}`,
    source,
    target,
    sourceSide: "outline",
    targetSide: "outline",
    ...style,
    ...(kind === "association"
      ? { labels: multiplicityLabelsOf({ source: "1", target: "0..*" }) }
      : {}),
  };
  return { edge, kind };
}

/** The anchor of the extend's condition, at the middle of the extend. */
const CONDITION: EdgeData = {
  id: "delete-condition-anchor",
  source: "delete-condition",
  sourceSide: "outline",
  targetEdge: "delete-select",
  targetT: 0.5,
  ...styleOf("anchor"),
};

/** The use case diagram as graph data, each node placed by the height `heightOf` gives it, with
 *  the node of each node and the kind of each edge, by their identifiers. */
function useCaseDiagram(heightOf: Comb["heightOf"]): DiagramData {
  const edges = RELATIONSHIPS.map(edgeOf);
  return {
    graph: {
      nodes: SEEDS.map(({ node, place, size }) => nodeOf(node, place, heightOf, size)),
      edges: [...edges.map(({ edge }) => edge), CONDITION],
    },
    classifiers: new Map(),
    states: new Map(),
    activities: new Map(),
    useCases: new Map(SEEDS.map(({ node }) => [node.id, structuredClone(node)])),
    kinds: new Map([
      ...edges.map(({ edge, kind }) => [edge.id, kind] as const),
      [CONDITION.id, "anchor"] as const,
    ]),
    transitions: new Map(),
    flows: new Map(),
  };
}

/** The use case diagram as the host application chooses it: the palette drops every kind, each
 *  edited as its notation shows it; a connection adds the kind `connectedOf` gives, docked on the
 *  outline at both ends; the sidebar edits an association's multiplicities and changes a
 *  relationship between two use cases among include, extend, and generalization; the legend is
 *  hidden; and the user moves no actor into a subject. */
export const USE_CASE_DIAGRAM: DiagramDescriptor = {
  id: "use-case",
  name: "Use case diagram",
  build: useCaseDiagram,
  nouns: ["elements", "edges"],
  nodes: [
    { kind: "actor", name: "Actor", form: "name" },
    { kind: "use-case", name: "Use case", form: "name-and-points" },
    { kind: "subject", name: "Subject", form: "name" },
    { kind: "use-case-comment", name: "Comment", form: "lines" },
  ],
  connected: "association",
  connectedOf,
  docking: () => ({ sourceSide: "outline", targetSide: "outline" }),
  edgeForm: "kind",
  edgeForms: { association: "multiplicities", anchor: "none" },
  kinds: ["include", "extend", "use-case-generalization"],
  conditioned: "extend",
  selected: { node: "element", edge: "relationship" },
  legend: false,
  canMoveInto,
};
