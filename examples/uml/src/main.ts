// The UML example host application (G-12): Comb on the canvas; in the HTML sidebar the choice of
// diagram, the palette, the form of the selection, and the legend of the kinds of relationship.
// It imports Comb by its entries alone and nothing of the other example (ADR-0030).
import { createComb, type Comb, type GraphData, type Proposal } from "comb";
import engineUrl from "comb/engine.wasm?url";
import { inspect, screenPoint, type SceneSnapshot } from "comb/testing";
import {
  classDiagram,
  contentOf,
  newClassifier,
  NODE_WIDTH,
  type DiagramData,
} from "./class-diagram";
import { packageDiagram } from "./package-diagram";
import { stateDiagram } from "./state-diagram";
import { Diagram } from "./diagram";
import { fillLegend } from "./legend";
import type { RelationshipKind } from "./relationships";
import { NODE_KINDS } from "./rules";
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
  /** The example's copy of the diagram's graph. */
  exampleGraph: () => GraphData;
  /** The kind of each relationship of the diagram, by its edge's identifier. */
  edgeKinds: () => Record<string, RelationshipKind>;
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

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

/** The type of the data a palette item carries in a drag. */
const PALETTE_TYPE = "application/x-uml-kind";

/** How many nodes of each kind the palette dropped and edges the user connected, for their
 *  identifiers. */
const dropped = new Map<string, number>();
let connected = 0;

/** Names the user's connection where the rules allow the kind a connection adds between its
 *  ends; refuses it otherwise. */
function canConnect({ source, target }: Proposal): string | false {
  const kind = diagram.connected;
  if (!diagram.allows(source, target, kind)) return false;
  connected += 1;
  return `${source}-${kind}-${target}-${connected}`;
}

// Loops are allowed for the state diagram's transitions from a state back to itself; the rules
// of the class and the package diagram refuse them in the veto (ADR-0031).
const comb = await createComb(element("canvas"), {
  engine: fetch(engineUrl),
  allowLoops: true,
  canConnect,
  canDelete: () => true,
});
const diagram = new Diagram(comb);
const sidebar = new Sidebar(diagram);
const choice = element<HTMLSelectElement>("diagram");
const count = element("count");

/** The diagrams the sidebar chooses between: how each is built, what its count names, the kind
 *  a connection adds to it, and whether the legend of the kinds of relationship tells its edges
 *  apart. */
const DIAGRAMS: Record<
  string,
  {
    build: (heightOf: Comb["heightOf"]) => DiagramData;
    nouns: [string, string];
    connected: RelationshipKind;
    legend?: false;
  }
> = {
  class: {
    build: classDiagram,
    nouns: ["classes and interfaces", "relationships"],
    connected: "association",
  },
  package: { build: packageDiagram, nouns: ["packages", "dependencies"], connected: "dependency" },
  // Shown only: it has no classifiers, so the rules refuse every connection.
  state: {
    build: stateDiagram,
    nouns: ["states", "transitions"],
    connected: "association",
    legend: false,
  },
};
/** Each diagram as it was left, while another is shown; the example stores nothing beyond the
 *  page. */
const kept = new Map<string, DiagramData>();
let shown: string | null = null;
const palette = element("palette");
const legend = element("legend");
const paletteItems = palette.querySelectorAll<HTMLElement>("[data-kind]");

/** Shows the size of the diagram. */
function counted(): void {
  const { nodes, edges } = diagram.graph;
  const [things, links] = DIAGRAMS[shown ?? "class"]!.nouns;
  count.textContent = `${nodes.length} ${things}, ${edges.length} ${links}`;
}

/** Loads the diagram the sidebar has chosen, as it was left where it was shown before, and keeps
 *  the one it replaces. */
async function load(): Promise<UmlLoadReport> {
  const { graph, classifiers, kinds } = diagram;
  if (shown !== null) kept.set(shown, { graph, classifiers, kinds });
  shown = choice.value;
  const next =
    kept.get(shown) ??
    DIAGRAMS[shown]!.build((content, width, shape) => comb.heightOf(content, width, shape));
  diagram.load(next.graph, next.classifiers, next.kinds, DIAGRAMS[shown]!.connected);
  // The palette offers what the diagram shown holds, and is hidden where it offers nothing.
  for (const item of paletteItems) item.hidden = item.dataset.diagram !== shown;
  palette.hidden = [...paletteItems].every((item) => item.hidden);
  legend.hidden = DIAGRAMS[shown]!.legend === false;
  counted();
  comb.fitView();
  await comb.whenRendered();
  return { diagram: shown, nodes: next.graph.nodes.length, edges: next.graph.edges.length };
}

choice.addEventListener("change", () => {
  window.uml.loadReport = load();
});

/** Adds a classifier of the palette's `kind`, centred by the height Comb gives its content on
 *  the world point under the drop at (`clientX`, `clientY`) of the page (G-1, ADR-0026). */
function drop(kind: string, clientX: number, clientY: number): void {
  const nodeKind = NODE_KINDS.find((each) => each === kind);
  if (!nodeKind) return;
  const { x, y } = comb.worldPointAt(clientX, clientY);
  const number = (dropped.get(kind) ?? 0) + 1;
  dropped.set(kind, number);
  const classifier = newClassifier(`${kind}-${number}`, nodeKind);
  const content = contentOf(classifier);
  diagram.classifiers.set(classifier.id, classifier);
  try {
    comb.addNode({
      id: classifier.id,
      x: x - NODE_WIDTH / 2,
      y: y - comb.heightOf(content, NODE_WIDTH) / 2,
      width: NODE_WIDTH,
      content,
    });
  } catch (error) {
    // A lost engine, or a node past the limits of a load: the drop adds nothing.
    diagram.classifiers.delete(classifier.id);
    console.warn("uml: the dropped node was not added", error);
  }
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
fillLegend(element("legend-kinds"));
window.uml = {
  comb,
  loadReport: load(),
  exampleGraph: () => structuredClone(diagram.graph),
  edgeKinds: () => Object.fromEntries(diagram.kinds),
  inspect: () => inspect(comb),
  screenPoint: (x, y) => screenPoint(comb, x, y),
};
