// The UML example host application (G-12): Comb on the canvas; in the HTML sidebar the choice of
// diagram, the palette, the form of the selection, and the legend of the kinds of relationship.
// It imports Comb by its entries alone and nothing of the other example
// (ARCH-one-workspace-per-example).
import {
  createComb,
  type Comb,
  type GraphData,
  type NodeData,
  type Proposal,
  type Side,
} from "comb";
import engineUrl from "comb/engine.wasm?url";
import { inspect, screenPoint, type SceneSnapshot } from "comb/testing";
import { ACTIVITY_BORDERS, newActivityNode, nodesOf as activityNodesOf, RAKE } from "./activity";
import { ACTIVITY_DIAGRAM } from "./activity-diagram";
import { NOTATION_DIAGRAM } from "./notation-diagram";
import { CLASS_DIAGRAM } from "./class-diagram";
import { PACKAGE_DIAGRAM } from "./package-diagram";
import { BORDER_KINDS, newState, nodesOf, STATE_DIAGRAM } from "./state-diagram";
import { Diagram } from "./diagram";
import { element } from "./element";
import { fillLegend } from "./legend";
import type { RelationshipKind } from "./relationships";
import {
  ACTIVITY_KINDS,
  CLASSIFIER_KINDS,
  contentOf,
  newClassifier,
  NODE_WIDTH,
  STATE_KINDS,
  USE_CASE_KINDS,
  type ActivityNode,
  type Classifier,
  type DiagramData,
  type DiagramDescriptor,
  type NodeKind,
  type Place,
  type State,
  type UseCaseNode,
} from "./shared";
import { Sidebar } from "./sidebar";
import {
  newUseCaseNode,
  nodeOf as useCaseNodeOf,
  USE_CASE_DIAGRAM,
  USE_CASE_SHAPES,
} from "./use-case-diagram";

/** How the last load went: what the browser tests read. */
export interface UmlLoadReport {
  diagram: string;
  nodes: number;
  edges: number;
}

/** What the browser tests reach of the example, under one name, so that it declares nothing on
 *  `window` the metric tree declares too. */
export interface UmlHooks {
  comb: Comb;
  loadReport: Promise<UmlLoadReport>;
  /** The example's copy of the diagram's graph, a border node among its nodes as Comb took it. */
  exampleGraph: () => GraphData;
  /** The kind of each relationship of the diagram, by its edge's identifier. */
  edgeKinds: () => Record<string, RelationshipKind>;
  /** The kind of each node the example keeps a classifier or a state of, by its identifier. */
  nodeKinds: () => Record<string, NodeKind | undefined>;
  /** What the canvas draws, from comb/testing. */
  inspect: () => SceneSnapshot;
  /** The canvas point at which the world point `(x, y)` is drawn, from comb/testing. */
  screenPoint: (x: number, y: number) => ReturnType<typeof screenPoint>;
}

declare global {
  interface Window {
    uml: UmlHooks;
  }
}

/** The type of the data a palette item carries in a drag. */
const PALETTE_TYPE = "application/x-uml-kind";

/** How many nodes of each kind the palette dropped and edges the user connected, for their
 *  identifiers. */
const dropped = new Map<string, number>();
let connected = 0;

/** The diagrams the sidebar chooses between, in the order it offers them, the class diagram
 *  first: each described in one place, its file. */
const DIAGRAMS = [
  CLASS_DIAGRAM,
  PACKAGE_DIAGRAM,
  STATE_DIAGRAM,
  ACTIVITY_DIAGRAM,
  USE_CASE_DIAGRAM,
  NOTATION_DIAGRAM,
] as const;

/** Names the user's connection where the rules allow the kind a connection adds between its
 *  ends; refuses it otherwise, and the sidebar says why. */
function canConnect({ source, target }: Proposal): string | false {
  const kind = diagram.connectedKind(source, target);
  const why = diagram.refusal(source, target, kind);
  sidebar.refused(why ?? null);
  if (why !== undefined) return false;
  connected += 1;
  return `${source}-${kind}-${target}-${connected}`;
}

// Loops are allowed for the state diagram's transitions from a state back to itself; the rules
// refuse every other loop in the veto (API-edges-dock-side-or-outline).
const comb = await createComb(element("canvas"), {
  engine: fetch(engineUrl),
  allowLoops: true,
  canConnect,
  canDelete: ({ nodes }) => diagram.deletable(nodes),
  canMoveInto: (move) => diagram.descriptor.canMoveInto?.(move, diagram.kindOf(move.node)) ?? true,
});
const diagram = new Diagram(comb, DIAGRAMS[0]);
comb.registerIcon(RAKE, rake());

/** The rake a call behavior action shows beside its name: three tines down from a bar, and a stem
 *  up from its middle, drawn in the colour of a node's text. */
function rake(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.assign(canvas, { width: 32, height: 32 });
  const pen = canvas.getContext("2d")!;
  pen.strokeStyle = "#1f2937";
  pen.lineWidth = 3;
  pen.beginPath();
  for (const x of [6, 16, 26]) {
    pen.moveTo(x, 14);
    pen.lineTo(x, 28);
  }
  pen.moveTo(6, 14);
  pen.lineTo(26, 14);
  pen.moveTo(16, 4);
  pen.lineTo(16, 14);
  pen.stroke();
  return canvas;
}
const sidebar = new Sidebar(diagram);
const choice = element<HTMLSelectElement>("diagram");
const count = element("count");

/** Each diagram as it was left, while another is shown; the example stores nothing beyond the
 *  page. */
const kept = new Map<string, DiagramData>();
let shown: string | null = null;
const palette = element("palette");
const legend = element("legend");
const legendKinds = element("legend-kinds");

/** The palette's item of each kind of node a diagram's descriptor names, by the kind's name. */
function paletteItemOf(
  { id }: DiagramDescriptor,
  { kind, name }: DiagramDescriptor["nodes"][number],
) {
  const item = document.createElement("li");
  Object.assign(item, { draggable: true, textContent: name });
  Object.assign(item.dataset, { kind, diagram: id });
  return item;
}

choice.append(...DIAGRAMS.map(({ id, name }) => new Option(name, id)));
const paletteItems = DIAGRAMS.flatMap((each) =>
  each.nodes.map((node) => paletteItemOf(each, node)),
);
element("palette-kinds").append(...paletteItems);

/** Shows the size of the diagram. */
function counted(): void {
  const { nodes, edges } = diagram.graph;
  const [things, links] = diagram.descriptor.nouns;
  count.textContent = `${nodes.length} ${things}, ${edges.length} ${links}`;
}

/** Loads the diagram the sidebar has chosen, as it was left where it was shown before, and keeps
 *  the one it replaces. */
async function load(): Promise<UmlLoadReport> {
  if (shown !== null) kept.set(shown, diagram.data());
  // The choice offers the diagrams alone, so one of them is chosen.
  const descriptor = DIAGRAMS.find(({ id }) => id === choice.value)!;
  shown = descriptor.id;
  const next =
    kept.get(shown) ??
    descriptor.build((content, width, shape) => comb.heightOf(content, width, shape));
  diagram.load(next, descriptor);
  // The palette offers what the diagram shown holds, and is hidden where it offers nothing.
  for (const item of paletteItems) item.hidden = item.dataset.diagram !== shown;
  palette.hidden = paletteItems.every((item) => item.hidden);
  legend.hidden = !descriptor.legend;
  sidebar.refused(null);
  fillLegend(legendKinds, descriptor.labels);
  counted();
  comb.fitView();
  await comb.whenRendered();
  return { diagram: shown, nodes: next.graph.nodes.length, edges: next.graph.edges.length };
}

choice.addEventListener("change", () => {
  window.uml.loadReport = load();
});

/** What the palette drops of `kind` as node `id` with its centre at the world point (`x`, `y`):
 *  the nodes Comb adds, and the classifier, the state, the activity node, or the use case
 *  diagram's node the diagram keeps of the first of them; none for a kind the palette lacks, or
 *  for a point dropped on no node whose border it rides. A node of the state, the activity, or the
 *  use case diagram lands in the deepest container or region under the point, an actor on the
 *  canvas, a point on the side of the node under it nearest the point, at the point's offset along
 *  that side. */
function droppedOf(
  kind: string,
  id: string,
  x: number,
  y: number,
):
  | {
      nodes: NodeData[];
      classifier?: Classifier;
      state?: State;
      activity?: ActivityNode;
      useCase?: UseCaseNode;
    }
  | undefined {
  const classifierKind = CLASSIFIER_KINDS.find((each) => each === kind);
  const heightOf: Comb["heightOf"] = (content, width, shape) =>
    comb.heightOf(content, width, shape);
  if (classifierKind) {
    const classifier = newClassifier(id, classifierKind);
    const content = contentOf(classifier);
    const node = {
      id,
      x: x - NODE_WIDTH / 2,
      y: y - heightOf(content, NODE_WIDTH) / 2,
      width: NODE_WIDTH,
      content,
    };
    return { nodes: [node], classifier };
  }
  const activityKind = ACTIVITY_KINDS.find((each) => each === kind);
  if (activityKind) {
    const activity = newActivityNode(id, activityKind);
    const place = placeOf(ACTIVITY_BORDERS[activityKind], x, y);
    return place && { nodes: activityNodesOf(activity, place, heightOf), activity };
  }
  const useCaseKind = USE_CASE_KINDS.find((each) => each === kind);
  if (useCaseKind) {
    const useCase = newUseCaseNode(id, useCaseKind);
    const place = USE_CASE_SHAPES[useCaseKind].outside ? { x, y } : centreOf(x, y);
    return { nodes: [useCaseNodeOf(useCase, place, heightOf)], useCase };
  }
  const stateKind = STATE_KINDS.find((each) => each === kind);
  if (!stateKind) return undefined;
  const state = newState(id, stateKind);
  const place = placeOf(BORDER_KINDS[stateKind], x, y);
  return place && { nodes: nodesOf(state, place, heightOf), state };
}

/** Where a node of the state, the activity, or the use case diagram dropped at the world point
 *  (`x`, `y`) lies: one that rides a node of `owners` on the nearest side of the node of those
 *  under it, none where there is none; any other in the deepest container or region under it, by
 *  its centre there. */
function placeOf(owners: readonly NodeKind[] | undefined, x: number, y: number): Place | undefined {
  if (owners) {
    const owner = diagram.deepestAt(x, y, (each) => {
      const kind = diagram.kindOf(each);
      return kind !== undefined && owners.includes(kind);
    });
    if (owner === undefined) return undefined;
    const box = diagram.box(owner)!;
    const sides: [Side, number, number][] = [
      ["top", y - box.y, x - box.x],
      ["bottom", box.y + box.height - y, x - box.x],
      ["left", x - box.x, y - box.y],
      ["right", box.x + box.width - x, y - box.y],
    ];
    const [side, , offset] = sides.reduce((nearest, each) =>
      each[1] < nearest[1] ? each : nearest,
    );
    const length = side === "top" || side === "bottom" ? box.width : box.height;
    return { attachedTo: owner, side, offset, length };
  }
  return centreOf(x, y);
}

/** Where a node dropped at the world point (`x`, `y`) lies that rides no border: in the deepest
 *  container or region under it, by its centre there, or on the canvas. */
function centreOf(x: number, y: number): Extract<Place, { x: number }> {
  const holder = diagram.deepestAt(x, y, (each) => {
    const node = diagram.node(each);
    return node === undefined || (node.isContainer === true && node.regions === undefined);
  });
  if (holder === undefined) return { x, y };
  const box = diagram.box(holder)!;
  return { x: x - box.x, y: y - box.y, container: holder };
}

/** Adds the nodes the palette drops of `kind`, a classifier or a state, centred by the height
 *  Comb gives its content and node shape on the world point under the drop at (`clientX`,
 *  `clientY`) of the page, or a point on the border nearest it (G-1, API-host-asks-content-height).
 *  The classifier or the state is the diagram's once Comb took its nodes, and never where Comb
 *  refuses them. */
function drop(kind: string, clientX: number, clientY: number): void {
  const number = (dropped.get(kind) ?? 0) + 1;
  const id = `${kind}-${number}`;
  const { x, y } = comb.worldPointAt(clientX, clientY);
  const added = droppedOf(kind, id, x, y);
  if (!added) return;
  dropped.set(kind, number);
  try {
    for (const node of added.nodes) comb.addNode(node);
  } catch (error) {
    // A lost engine, or a node past the limits of a load: the drop adds nothing, and what of it
    // Comb took goes again.
    console.warn("uml: the dropped node was not added", error);
    const taken = added.nodes.filter((node) => diagram.node(node.id)).map((node) => node.id);
    if (taken.length > 0) comb.removeNodes(taken);
    return;
  }
  if (added.classifier) diagram.classifiers.set(id, added.classifier);
  if (added.state) diagram.states.set(id, added.state);
  if (added.activity) diagram.activities.set(id, added.activity);
  if (added.useCase) diagram.useCases.set(id, added.useCase);
}

for (const item of paletteItems) {
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer?.setData(PALETTE_TYPE, item.dataset.kind ?? "");
  });
}
const canvas = element("canvas");
canvas.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes(PALETTE_TYPE)) event.preventDefault();
});
canvas.addEventListener("drop", (event) => {
  event.preventDefault();
  drop(event.dataTransfer?.getData(PALETTE_TYPE) ?? "", event.clientX, event.clientY);
});
comb.onChange((change) => {
  diagram.mirror(change);
  counted();
});
comb.onSelectionChange((selection) => sidebar.show(selection));
window.uml = {
  comb,
  loadReport: load(),
  exampleGraph: () => structuredClone(diagram.graph),
  edgeKinds: () => Object.fromEntries(diagram.kinds),
  nodeKinds: () =>
    Object.fromEntries(
      [
        ...diagram.classifiers.keys(),
        ...diagram.states.keys(),
        ...diagram.activities.keys(),
        ...diagram.useCases.keys(),
      ].map((id) => [id, diagram.kindOf(id)]),
    ),
  inspect: () => inspect(comb),
  screenPoint: (x, y) => screenPoint(comb, x, y),
};
