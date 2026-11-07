// The state diagram of the example (G-12): the life of a Comb, from `createComb` to `destroy`. Its
// states are rounded rectangles of their name; its initial state a filled circle, its final
// states ringed circles, and the choice of whether the engine loaded a diamond, each a node shape
// of Comb's own (ADR-0032). Its transitions are edges labelled by their event or
// their guard, each end docked on its state's outline, and a loop on ready, which stands for each
// edit Comb applies, on ready's left side (ADR-0031). The user edits it as the other diagrams: the
// palette drops each kind of state, and a connection adds a transition docked on the outline, or
// a loop on the side it leaves.
import type {
  Comb,
  EdgeData,
  EdgeLabelData,
  EdgePatch,
  NodeContent,
  NodeData,
  NodeShape,
} from "comb";
import { GREY } from "./relationships";
import type { StateKind } from "./rules";
import type { DiagramData, State } from "./shared";

const STATE_WIDTH = 200;

/** The node shape and the width of each kind of state: a state as wide as its name needs, a
 *  pseudostate as small as its node shape allows. */
export const STATE_SHAPES: Record<StateKind, { shape: NodeShape; width: number }> = {
  state: { shape: "rounded-rectangle", width: STATE_WIDTH },
  initial: { shape: "circle", width: 24 },
  final: { shape: "ringed-circle", width: 28 },
  choice: { shape: "diamond", width: 128 },
};

/** The states of a Comb, and its pseudostates: where its life starts, where it ends, and where it
 *  chooses by whether its engine loaded. */
const STATES: State[] = [
  { id: "initial", kind: "initial" },
  { id: "created", kind: "state", name: "Created" },
  { id: "loading", kind: "state", name: "Loading its engine" },
  { id: "loaded", kind: "choice" },
  { id: "refused", kind: "final" },
  { id: "ready", kind: "state", name: "Ready" },
  { id: "rendering", kind: "state", name: "Rendering a frame" },
  { id: "lost", kind: "state", name: "Engine lost" },
  { id: "destroyed", kind: "state", name: "Destroyed" },
  { id: "final", kind: "final" },
];

/** The rows of the diagram from top to bottom, each node by the left of its column; a node
 *  is centred on its column's middle, `STATE_WIDTH` wide. An edge docked on the outline runs
 *  between the two centres, so no state lies between the two ends of a transition: the lost
 *  engine stands aside, out of the way from ready to destroyed. */
const ROWS: [string, number][][] = [
  [["initial", 0]],
  [["created", 0]],
  [["loading", 0]],
  [
    ["loaded", 0],
    ["refused", 1],
  ],
  [
    ["ready", 0],
    ["rendering", 1],
  ],
  [["lost", 1]],
  [["destroyed", 0]],
  [["final", 0]],
];
const COLUMN = 320;
const ROW_GAP = 56;

/** Each transition: its source, its target, and its label, the event that fires it or the guard
 *  of a choice's branch, none for one a pseudostate takes at once. */
const TRANSITIONS: [string, string, string | null][] = [
  ["initial", "created", null],
  ["created", "loading", "createComb"],
  ["loading", "loaded", "engine settled"],
  ["loaded", "ready", "[loaded]"],
  ["loaded", "refused", "[refused]"],
  ["ready", "ready", "edit"],
  ["ready", "rendering", "change"],
  ["rendering", "ready", "rendered"],
  ["ready", "lost", "engine lost"],
  ["ready", "destroyed", "destroy"],
  ["lost", "destroyed", "destroy"],
  ["destroyed", "final", null],
];

/** How far a label stands off its transition, to the left of its direction of travel, so that the
 *  labels of the two transitions between ready and rendering, which run along one line in
 *  opposite directions, stand either side of it. */
const LABEL_OFFSET = 14;

/** The content of the node of a state: its name as its title, none of a pseudostate. */
export function contentOf({ name }: Pick<State, "name">): NodeContent {
  return name === undefined ? [] : [[{ kind: "text", role: "title", text: name }]];
}

/** The edge of a transition, grey with an arrowhead, docked on the outline at both ends, a loop
 *  on the left side of its state, where the column leaves room, its label in grey where it has
 *  one. */
function edgeOf([source, target, label]: (typeof TRANSITIONS)[number]) {
  const side = source === target ? "left" : "outline";
  const edge: EdgeData = {
    id: `${source}-${target}`,
    source,
    target,
    sourceSide: side,
    targetSide: side,
    color: GREY,
    arrow: "end",
  };
  if (label !== null) edge.label = eventLabel(label);
  return edge;
}

/** The label of a transition that reads `text`, its event or its guard, on a pill of the
 *  transition's grey, placed where `current` stands, or in the middle at `LABEL_OFFSET`. */
export function eventLabel(text: string, current?: EdgeLabelData): EdgeLabelData {
  return { t: 0.5, offset: LABEL_OFFSET, ...current, background: GREY, text };
}

/** The sides of a transition the user connected: docked on the outline at both ends, or for a
 *  loop the side it left by at both, since a loop leaves and re-enters one side (ADR-0031). */
export function dockingOf({ source, target, sourceSide }: EdgeData): EdgePatch {
  if (source === target) return { targetSide: sourceSide ?? "right" };
  return { sourceSide: "outline", targetSide: "outline" };
}

/** The state of `kind` the palette drops: a state named "NewState", a pseudostate unnamed. */
export function newState(id: string, kind: StateKind): State {
  return kind === "state" ? { id, kind, name: "NewState" } : { id, kind };
}

/** The nodes laid out in `ROWS`: each centred on its column's middle and on its row's, a row
 *  below the row above by `ROW_GAP`, each as high as `heightOf` gives its content and node
 *  shape. */
function laidOut(heightOf: Comb["heightOf"]): NodeData[] {
  const byId = new Map(STATES.map((state) => [state.id, state]));
  const nodes: NodeData[] = [];
  let top = 0;
  for (const row of ROWS) {
    const placed = row.map(([id, column]) => {
      const state = byId.get(id)!;
      const { shape, width } = STATE_SHAPES[state.kind];
      const content = contentOf(state);
      return { id, column, width, shape, content, height: heightOf(content, width, shape) };
    });
    const rowHeight = Math.max(...placed.map(({ height }) => height));
    for (const { id, column, width, shape, content, height } of placed) {
      const x = column * COLUMN + (STATE_WIDTH - width) / 2;
      nodes.push({ id, x, y: top + (rowHeight - height) / 2, width, shape, content });
    }
    top += rowHeight + ROW_GAP;
  }
  return nodes;
}

/** The state diagram as graph data, each node placed by the height `heightOf` gives it, with the
 *  state of each node and the kind of each edge, a transition, by their identifiers. */
export function stateDiagram(heightOf: Comb["heightOf"]): DiagramData {
  const edges = TRANSITIONS.map(edgeOf);
  return {
    graph: { nodes: laidOut(heightOf), edges },
    classifiers: new Map(),
    states: new Map(STATES.map((state) => [state.id, { ...state }])),
    kinds: new Map(edges.map(({ id }) => [id, "transition"])),
  };
}
