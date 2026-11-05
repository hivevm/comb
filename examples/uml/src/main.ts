// The UML example host application (G-12): Comb on the canvas, the choice of diagram and the
// legend of the kinds of relationship in the HTML sidebar. It imports Comb by its entries alone
// and nothing of the other example (ADR-draft-one-workspace-per-example).
import { createComb, type Comb, type GraphData } from "comb";
import engineUrl from "comb/engine.wasm?url";
import { inspect, type SceneSnapshot } from "comb/testing";
import { classDiagram } from "./class-diagram";
import { KINDS, RELATIONSHIPS, type RelationshipKind } from "./relationships";

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

const SVG = "http://www.w3.org/2000/svg";

/** A short line drawn as `kind` is, for the legend: its colour, its dash pattern, and its
 *  arrowhead, each set as an attribute, so that the policy of Q-6 lets it through. */
function swatchOf(kind: RelationshipKind): SVGSVGElement {
  const { color, dash, arrow } = RELATIONSHIPS[kind];
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 48 12");
  svg.setAttribute("width", "48");
  svg.setAttribute("height", "12");
  const line = document.createElementNS(SVG, "line");
  const attributes: Record<string, string> = {
    x1: "1",
    y1: "6",
    x2: arrow === "end" ? "40" : "47",
    y2: "6",
    stroke: hex,
    "stroke-width": "2",
  };
  for (const [name, value] of Object.entries(attributes)) line.setAttribute(name, value);
  if (dash) line.setAttribute("stroke-dasharray", dash.join(" "));
  svg.append(line);
  if (arrow === "end") {
    const head = document.createElementNS(SVG, "polygon");
    head.setAttribute("points", "38,1 47,6 38,11");
    head.setAttribute("fill", hex);
    svg.append(head);
  }
  return svg;
}

/** Fills the legend with one entry per kind: its swatch, its name, and its label where it has
 *  one. */
function fillLegend(): void {
  const list = element("legend-kinds");
  for (const kind of KINDS) {
    const { name, label } = RELATIONSHIPS[kind];
    const item = document.createElement("li");
    item.dataset.kind = kind;
    const text = document.createElement("span");
    text.textContent = label ? `${name} ${label.text}` : name;
    item.append(swatchOf(kind), text);
    list.append(item);
  }
}

const comb = await createComb(element("canvas"), { engine: fetch(engineUrl) });
const diagram = element<HTMLSelectElement>("diagram");
const count = element("count");

let graph: GraphData = { nodes: [], edges: [] };
let kinds = new Map<string, RelationshipKind>();

/** Loads the diagram the sidebar has chosen, the class diagram the one so far. */
async function load(): Promise<UmlLoadReport> {
  ({ graph, kinds } = classDiagram((content, width) => comb.heightOf(content, width)));
  count.textContent = `${graph.nodes.length} classes and interfaces, ${graph.edges.length} relationships`;
  comb.load(graph);
  comb.fitView();
  await comb.whenRendered();
  return { diagram: diagram.value, nodes: graph.nodes.length, edges: graph.edges.length };
}

fillLegend();
window.uml = {
  comb,
  loadReport: load(),
  exampleGraph: () => structuredClone(graph),
  edgeKinds: () => Object.fromEntries(kinds),
  inspect: () => inspect(comb),
};
