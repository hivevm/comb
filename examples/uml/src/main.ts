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
import { CLASS_DIAGRAM } from "./class-diagram";
import { PACKAGE_DIAGRAM } from "./package-diagram";
import { BORDER_KINDS, newState, nodesOf, STATE_DIAGRAM, type Place } from "./state-diagram";
import { Diagram } from "./diagram";
import { element } from "./element";
import { fillLegend } from "./legend";
import type { RelationshipKind } from "./relationships";
import {
  CLASSIFIER_KINDS,
  contentOf,
  newClassifier,
  NODE_WIDTH,
  STATE_KINDS,
  type Classifier,
  type DiagramData,
  type DiagramDescriptor,
  type NodeKind,
  type State,
  type StateKind,
} from "./shared";
import { Sidebar } from "./sidebar";

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
const DIAGRAMS = [CLASS_DIAGRAM, PACKAGE_DIAGRAM, STATE_DIAGRAM] as const;

/** Names the user's connection where the rules allow the kind a connection adds between its
 *  ends; refuses it otherwise, and the sidebar says why. */
function canConnect({ source, target }: Proposal): string | false {
  const kind = diagram.connectedKind(source);
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
});
const diagram = new Diagram(comb, DIAGRAMS[0]);
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
 *  the nodes Comb adds, and the classifier or the state the diagram keeps of the first of them;
 *  none for a kind the palette lacks, or for a point dropped on no node whose border it rides. A
 *  node of the state diagram lands in the deepest container or region under the point, a point on
 *  the side of the node under it nearest the point, at the point's offset along that side. */
function droppedOf(
  kind: string,
  id: string,
  x: number,
  y: number,
): { nodes: NodeData[]; classifier?: Classifier; state?: State } | undefined {
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
  const stateKind = STATE_KINDS.find((each) => each === kind);
  if (!stateKind) return undefined;
  const state = newState(id, stateKind);
  const place = placeOf(stateKind, x, y);
  return place && { nodes: nodesOf(state, place, heightOf), state };
}

/** Where a node of the state diagram of `kind` dropped at the world point (`x`, `y`) lies: a
 *  point on the nearest side of the node under it that it may ride, none where there is none;
 *  any other in the deepest container or region under it, by its centre there. */
function placeOf(kind: StateKind, x: number, y: number): Place | undefined {
  const owners = BORDER_KINDS[kind];
  if (owners) {
    const owner = diagram.deepestAt(x, y, (each) =>
      owners.includes(diagram.kindOf(each) as StateKind),
    );
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
      [...diagram.classifiers.keys(), ...diagram.states.keys()].map((id) => [
        id,
        diagram.kindOf(id),
      ]),
    ),
  inspect: () => inspect(comb),
  screenPoint: (x, y) => screenPoint(comb, x, y),
};
