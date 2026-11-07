// What more than one diagram of the UML example (G-12) uses, so that no diagram's file imports
// another's, nor this module any diagram's: a diagram as data, the descriptor of a diagram, the
// kinds of node, which the rules of connection import, the classifier a node of the class or the
// package diagram shows, the state a node of the state diagram shows, the classifier's content,
// and the layout by rows of the class and the package diagram. A classifier keeps its kind, set
// when it is created, from the diagram's data or the palette; its stereotype is text it shows and
// tells nothing of its kind.
import type { Comb, EdgePatch, GraphChange, GraphData, NodeContent, NodeData } from "comb";
import type { RelationshipKind } from "./relationships";

/** The kinds of classifier: those of the class diagram, and the package of the package diagram. */
export const CLASSIFIER_KINDS = ["class", "interface", "abstract-class", "package"] as const;
export type ClassifierKind = (typeof CLASSIFIER_KINDS)[number];

/** The kinds of state of the state diagram: a state, and the pseudostates where its machine
 *  starts, where it ends, and where it chooses. */
export const STATE_KINDS = ["state", "initial", "final", "choice"] as const;
export type StateKind = (typeof STATE_KINDS)[number];

/** The kinds of node: the kinds of classifier and the kinds of state. */
export const NODE_KINDS = [...CLASSIFIER_KINDS, ...STATE_KINDS] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** A class, an interface, an abstract class, or a package of a diagram, as its node shows it, and
 *  its kind, which no edit of its stereotype changes. */
export interface Classifier {
  id: string;
  kind: ClassifierKind;
  stereotype?: string;
  name: string;
  attributes: string[];
  operations: string[];
}

/** A state or a pseudostate, as its node shows it: its kind, and a state's name, none for a
 *  pseudostate. */
export interface State {
  id: string;
  kind: StateKind;
  name?: string;
}

/** A diagram as graph data, with the classifier or the state of each node and the kind of each
 *  edge by their identifiers. */
export interface DiagramData {
  graph: GraphData;
  classifiers: Map<string, Classifier>;
  states: Map<string, State>;
  kinds: Map<string, RelationshipKind>;
}

/** An edge as Comb tells its addition, its colour, arrowhead, and sides filled in. */
export type AddedEdge = Extract<GraphChange, { kind: "edgeAdded" }>["edge"];

/** What the sidebar edits of a selected node: a classifier's name, stereotype, and members, a
 *  name alone, or nothing. */
export type NodeForm = "classifier" | "name" | "none";

/** What the sidebar edits of a selected edge: a relationship's kind and label, a dependency's
 *  «import» or «use», or a transition's event. */
export type EdgeForm = "relationship" | "import-or-use" | "event";

/** What makes a diagram of the example what it is, in one place: its identifier and its name in
 *  the choice of diagram, how it is built, what its count names, the kinds of node the palette
 *  drops, each with its name there and the form the sidebar edits it in, the kind a connection
 *  adds and how it docks, the form the sidebar edits an edge in, what the sidebar's headings call
 *  a selected node and edge, and whether the legend of the kinds of relationship tells its edges
 *  apart. The host application, the diagram, and the sidebar read it instead of branching on a
 *  kind. */
export interface DiagramDescriptor {
  id: string;
  name: string;
  build: (heightOf: Comb["heightOf"]) => DiagramData;
  nouns: readonly [string, string];
  nodes: readonly { kind: NodeKind; name: string; form: NodeForm }[];
  connected: RelationshipKind;
  /** The sides of an edge the user connected, none where it keeps those it was connected by. */
  docking?: (edge: AddedEdge) => EdgePatch;
  edgeForm: EdgeForm;
  selected: { node: string; edge: string };
  legend: boolean;
}

export const NODE_WIDTH = 260;
/** The distance between the left sides of two columns, and the gap between two rows. */
const COLUMN = 360;
const ROW_GAP = 80;

/** The most rows of a node's content Comb lays out; a load of more is refused (`tooManyRows`). */
export const ROW_LIMIT = 8;
/** The row that stands for the members a node leaves out. */
export const ELLIPSIS = "…";

/** The stereotype a classifier of each kind starts with, none for a plain class. */
const STEREOTYPES: Record<ClassifierKind, string | undefined> = {
  class: undefined,
  interface: "«interface»",
  "abstract-class": "«abstract»",
  package: "«package»",
};

/** The name a classifier of each kind dropped from the palette starts with. */
const DROPPED: Record<ClassifierKind, string> = {
  class: "NewClass",
  interface: "NewInterface",
  "abstract-class": "NewAbstractClass",
  package: "NewPackage",
};

/** A classifier of `kind`: its kind's stereotype, `name`, or the palette's default name, and no
 *  members. */
export function newClassifier(id: string, kind: ClassifierKind, name = DROPPED[kind]): Classifier {
  const stereotype = STEREOTYPES[kind];
  return { id, kind, ...(stereotype ? { stereotype } : {}), name, attributes: [], operations: [] };
}

/** The member texts `classifier`'s node shows, one row each: every attribute and then every
 *  operation where they fit beside its stereotype and name, otherwise as many as fit before a row
 *  of "…". */
export function shownMembers({
  stereotype,
  attributes,
  operations,
}: Pick<Classifier, "stereotype" | "attributes" | "operations">): string[] {
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
