// The state diagram of the example (G-12): the life of a Comb, from `createComb` to `destroy`. Its
// states are rounded rectangles of their name; its initial state a filled circle, its final
// states ringed circles, and the choice of whether the engine loaded a diamond, each a node shape
// of Comb's own (ADR-0032). Its transitions are edges labelled by their event or
// their guard, each end docked on its state's outline, and a loop on ready, which stands for each
// edit Comb applies, on ready's left side (ADR-0031). It is shown only; the user edits none of it
// yet.
import type { Comb, EdgeData, NodeContent, NodeData, NodeShape } from "comb";
import type { DiagramData } from "./class-diagram";
import { GREY } from "./relationships";

/** A state or a pseudostate: its name, none for a pseudostate, its node shape, and its width. */
interface StateNode {
  id: string;
  name?: string;
  shape: NodeShape;
  width: number;
}

const STATE_WIDTH = 200;

/** The states of a Comb, and its pseudostates: where its life starts, where it ends, and where it
 *  chooses by whether its engine loaded. */
const STATE_NODES: StateNode[] = [
  { id: "initial", shape: "circle", width: 24 },
  { id: "created", name: "Created", shape: "rounded-rectangle", width: STATE_WIDTH },
  { id: "loading", name: "Loading its engine", shape: "rounded-rectangle", width: STATE_WIDTH },
  { id: "loaded", shape: "diamond", width: 128 },
  { id: "refused", shape: "ringed-circle", width: 28 },
  { id: "ready", name: "Ready", shape: "rounded-rectangle", width: STATE_WIDTH },
  { id: "rendering", name: "Rendering a frame", shape: "rounded-rectangle", width: STATE_WIDTH },
  { id: "lost", name: "Engine lost", shape: "rounded-rectangle", width: STATE_WIDTH },
  { id: "destroyed", name: "Destroyed", shape: "rounded-rectangle", width: STATE_WIDTH },
  { id: "final", shape: "ringed-circle", width: 28 },
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

/** The content of the node of `node`: a state's name as its title, none of a pseudostate. */
function contentOf({ name }: StateNode): NodeContent {
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
  if (label !== null) edge.label = { text: label, t: 0.5, offset: LABEL_OFFSET, background: GREY };
  return edge;
}

/** The nodes laid out in `ROWS`: each centred on its column's middle and on its row's, a row
 *  below the row above by `ROW_GAP`, each as high as `heightOf` gives its content and node
 *  shape. */
function laidOut(heightOf: Comb["heightOf"]): NodeData[] {
  const byId = new Map(STATE_NODES.map((node) => [node.id, node]));
  const nodes: NodeData[] = [];
  let top = 0;
  for (const row of ROWS) {
    const placed = row.map(([id, column]) => {
      const node = byId.get(id)!;
      const { shape, width } = node;
      const content = contentOf(node);
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

/** The state diagram as graph data, each node placed by the height `heightOf` gives it. It has no
 *  classifiers and no kinds of relationship, which the sidebar edits, since it is only shown. */
export function stateDiagram(heightOf: Comb["heightOf"]): DiagramData {
  return {
    graph: { nodes: laidOut(heightOf), edges: TRANSITIONS.map(edgeOf) },
    classifiers: new Map(),
    kinds: new Map(),
  };
}
