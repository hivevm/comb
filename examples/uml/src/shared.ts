// What more than one diagram of the UML example (G-12) uses, so that no diagram's file imports
// another's, nor this module any diagram's: a diagram as data, the descriptor of a diagram, the
// kinds of node, which the rules of connection import, the classifier a node of the class or the
// package diagram shows, the state a node of the state diagram shows and the transition an edge of
// it carries, the activity node a node of the activity diagram shows and the flow an edge of it
// carries, the use case diagram's node, the classifier's content, the layout by rows of the class
// and the package diagram, and the place of a node with the node of a name beside a border node,
// which the state and the activity diagram share. A classifier keeps its kind, set when it is
// created, from the diagram's data or the palette; its stereotype is text it shows and tells
// nothing of its kind.
import type {
  BorderNodeData,
  Comb,
  ContainerMove,
  EdgePatch,
  GraphChange,
  GraphData,
  NodeContent,
  NodeData,
  Outline,
  Side,
} from "comb";
import type { RelationshipKind } from "./relationships";

/** The kinds of classifier: those of the class diagram, and the package of the package diagram. */
export const CLASSIFIER_KINDS = ["class", "interface", "abstract-class", "package"] as const;
export type ClassifierKind = (typeof CLASSIFIER_KINDS)[number];

/** The kinds of node of the state diagram (G-20): its states, a state list, which stands for
 *  states, its final state and its pseudostates, the connection point references of a submachine
 *  state, the send and receive signal symbols of a transition, a comment, and the frame of the
 *  state machine. */
export const STATE_KINDS = [
  ...["state", "composite", "submachine", "state-list", "final"],
  ...["initial", "terminate", "choice", "junction", "fork", "join"],
  ...["shallow-history", "deep-history", "entry-point", "exit-point"],
  ...["entry-reference", "exit-reference", "send-signal", "receive-signal", "comment", "frame"],
] as const;
export type StateKind = (typeof STATE_KINDS)[number];

/** The kinds of node of the activity diagram (G-20): its actions, among them the call behavior,
 *  send signal, accept event, and accept time event actions and the expansion region; its object
 *  nodes, among them the pins, the data store, the central buffer, the expansion node, and the
 *  activity parameter nodes; its control nodes; the interruptible region; a connector; a comment;
 *  and the frame of the activity, divided into its partitions. */
export const ACTIVITY_KINDS = [
  ...["action", "call-behavior-action", "send-signal-action", "accept-event-action"],
  ...["accept-time-event-action", "object-node", "input-pin", "output-pin", "data-store"],
  ...["central-buffer", "decision-node", "fork-node", "join-node", "interruptible-region"],
  ...["expansion-region", "expansion-node", "connector", "activity-comment", "activity-frame"],
  ...["input-parameter", "output-parameter"],
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** The kinds of node of the use case diagram (G-20): an actor, a use case, the subject that holds
 *  use cases, and a comment. */
export const USE_CASE_KINDS = ["actor", "use-case", "subject", "use-case-comment"] as const;
export type UseCaseKind = (typeof USE_CASE_KINDS)[number];

/** The kinds of node: the kinds of classifier, of state, of activity node, and of the use case
 *  diagram's node. */
export const NODE_KINDS = [
  ...CLASSIFIER_KINDS,
  ...STATE_KINDS,
  ...ACTIVITY_KINDS,
  ...USE_CASE_KINDS,
] as const;
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

/** A node of the state diagram, as its node shows it: its kind; the name of a state, a point, a
 *  signal, or the state machine, the states of a state list; a state's entry, do, and exit
 *  behaviours, its internal transitions, and its deferred triggers; the state machine a
 *  submachine state refers to; and the lines of a comment. */
export interface State {
  id: string;
  kind: StateKind;
  name?: string;
  entry?: string;
  doActivity?: string;
  exit?: string;
  internal?: string[];
  deferred?: string[];
  machine?: string;
  body?: string[];
}

/** The modes of an expansion region, each the keyword its node shows. */
export const EXPANSION_MODES = ["iterative", "parallel", "stream"] as const;
export type ExpansionMode = (typeof EXPANSION_MODES)[number];

/** A node of the activity diagram, as its node shows it: its kind; the name of an action, an
 *  object node, a pin, a parameter, a connector, or the activity; an expansion region's mode; and
 *  the lines of a comment. */
export interface ActivityNode {
  id: string;
  kind: ActivityKind;
  name?: string;
  mode?: ExpansionMode;
  body?: string[];
}

/** A node of the use case diagram, as its node shows it: its kind; the name of an actor, a use
 *  case, or the subject; a use case's extension points; and the lines of a comment. */
export interface UseCaseNode {
  id: string;
  kind: UseCaseKind;
  name?: string;
  points?: string[];
  body?: string[];
}

/** What a flow shows in its label: its guard and its weight. */
export interface Flow {
  guard?: string;
  weight?: string;
}

/** What a transition shows in its label: its trigger, its guard, and its effect. */
export interface Transition {
  trigger?: string;
  guard?: string;
  effect?: string;
}

/** A diagram as graph data, with the classifier, the state, the activity node, or the use case
 *  diagram's node of each node,
 *  the kind of each edge, the trigger, guard, and effect of each transition, and the guard and
 *  weight of each flow, by their identifiers. */
export interface DiagramData {
  graph: GraphData;
  classifiers: Map<string, Classifier>;
  states: Map<string, State>;
  activities: Map<string, ActivityNode>;
  useCases: Map<string, UseCaseNode>;
  kinds: Map<string, RelationshipKind>;
  transitions: Map<string, Transition>;
  flows: Map<string, Flow>;
}

/** An edge as Comb tells its addition, its colour, arrowhead, and sides filled in. */
export type AddedEdge = Extract<GraphChange, { kind: "edgeAdded" }>["edge"];

/** What the sidebar edits of a selected node: a classifier's name, stereotype, and members; a
 *  name alone; a state's name and its behaviours, internal transitions, and deferred triggers; a
 *  submachine state's name and the state machine it refers to; the lines of a comment; an
 *  expansion region's mode; a use case's name and extension points; or nothing. */
export type NodeForm =
  | "classifier"
  | "name"
  | "behaviours"
  | "name-and-machine"
  | "lines"
  | "mode"
  | "name-and-points"
  | "none";

/** What the sidebar edits of a selected edge: a relationship's kind and label, its kind alone, a
 *  dependency's «import» or «use», a transition's trigger, guard, and effect, a flow's guard and
 *  weight, an association's multiplicities, or nothing. */
export type EdgeForm =
  | "relationship"
  | "kind"
  | "import-or-use"
  | "trigger-guard-effect"
  | "guard-and-weight"
  | "multiplicities"
  | "none";

/** What makes a diagram of the example what it is, in one place: its identifier and its name in
 *  the choice of diagram, how it is built, what its count names, the kinds of node the palette
 *  drops, each with its name there and the form the sidebar edits it in, the kind a connection
 *  adds and how it docks, the form the sidebar edits an edge in, what the sidebar's headings call
 *  a selected node and edge, whether the legend of the kinds of relationship tells its edges
 *  apart, and the labels the legend names for a kind whose edges carry others than its own. The
 *  host application, the diagram, and the sidebar read it instead of branching on a
 *  kind. */
export interface DiagramDescriptor {
  id: string;
  name: string;
  build: (heightOf: Comb["heightOf"]) => DiagramData;
  nouns: readonly [string, string];
  nodes: readonly { kind: NodeKind; name: string; form: NodeForm }[];
  connected: RelationshipKind;
  /** The kind a connection adds between nodes of kinds that add another than `connected`, none
   *  where it adds `connected`. */
  connectedOf?: (source: NodeKind, target: NodeKind) => RelationshipKind | undefined;
  /** The sides of an edge the user connected, none where it keeps those it was connected by. */
  docking?: (edge: AddedEdge) => EdgePatch;
  edgeForm: EdgeForm;
  /** The form of an edge of a kind the diagram edits otherwise than by `edgeForm`. */
  edgeForms?: Partial<Record<RelationshipKind, EdgeForm>>;
  /** The kind of an edge whose comments anchored on it are its condition, which goes with it when
   *  the edge becomes another kind; none where no kind has one. */
  conditioned?: RelationshipKind;
  /** The kinds the sidebar's kind select changes an edge between, each offered where the rules
   *  allow it between the edge's ends; those the legend lists where left out. */
  kinds?: readonly RelationshipKind[];
  selected: { node: string; edge: string };
  legend: boolean;
  labels?: Partial<Record<RelationshipKind, readonly string[]>>;
  /** The veto of the user's move of a node, of the kind `kind`, into a container or onto the
   *  canvas, none where every move is allowed (API-edits-report-nested-changes). */
  canMoveInto?: (move: ContainerMove, kind: NodeKind | undefined) => boolean;
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

/** Where a node of the state or the activity diagram lies: at a centre in a container or on the
 *  canvas, or on a side of the node it rides, at an offset along it and with the length of that
 *  side, unbounded where left out. */
export type Place =
  | { x: number; y: number; container?: string }
  | { attachedTo: string; side: Side; offset: number; length?: number };

/** The identifier of the node that shows the name of the border node `id`, a point or a pin. */
export const nameNodeId = (id: string) => `${id}-name`;

/** The width of the node of the name `name`, as wide as its text is drawn in the body's font. */
export const nameWidth = (name: string) => Math.max(48, 24 + 8 * name.length);

/** The content of the node of the name `name`, a row of body text, none for no name. */
export const nameContentOf = (name: string | undefined): NodeContent =>
  name ? [[{ kind: "text", role: "body", text: name }]] : [];

/** The node `own` on the side of the node it rides, `place`, and the node of its name `name`
 *  beside it on the same side, as `nameOffsetOf` places it, without an outline. */
export function namedBorderNodes(
  own: Omit<BorderNodeData, "attachedTo" | "side" | "offset">,
  place: Extract<Place, { attachedTo: string }>,
  name: string | undefined,
  heightOf: Comb["heightOf"],
): BorderNodeData[] {
  const content = nameContentOf(name);
  const named = nameWidth(name ?? "");
  const at = { attachedTo: place.attachedTo, side: place.side, offset: place.offset };
  const label: BorderNodeData = {
    id: nameNodeId(own.id),
    width: named,
    content,
    outline: "none" satisfies Outline,
    ...at,
    offset: nameOffsetOf({ ...place, width: own.width }, named, heightOf(content, named)),
  };
  return [{ ...own, ...at }, label];
}

/** The offset of the node of a name, `width` × `height`, beside the border node `point` on its
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

/** `place`, for a border node with the length of its side of the node it rides among `nodes`. */
export function sided(place: Place, nodes: readonly NodeData[], heightOf: Comb["heightOf"]): Place {
  if (!("attachedTo" in place)) return place;
  const owner = nodes.find(({ id }) => id === place.attachedTo)!;
  const across = place.side === "top" || place.side === "bottom";
  const height = owner.height ?? heightOf(owner.content, owner.width, owner.shape);
  return { ...place, length: across ? owner.width : height };
}
