// The example host application: Comb on the canvas, the attribute form in the HTML sidebar.
import { createComb, type Comb, type GraphData, type Selection } from "comb";
import {
  inspect,
  renderCount,
  sceneNumbers,
  screenPoint,
  showLayers,
  testMode,
  viewport,
  visibleRect,
  work,
  type SceneSnapshot,
} from "comb/testing";
import { metricTree } from "./graph";

/** How the last load went: what the benchmark and the browser tests read. */
export interface LoadReport {
  copies: number;
  nodes: number;
  edges: number;
  /** Milliseconds from handing the graph to Comb until its first frame was drawn. */
  firstFrameMs: number;
}

declare global {
  interface Window {
    comb: Comb;
    loadReport: Promise<LoadReport>;
    /** What the canvas draws, from comb/testing, for the browser tests and the benchmark. */
    inspect: () => SceneSnapshot;
    renderCount: () => number;
    viewport: () => SceneSnapshot["viewport"];
    showLayers: (layers: Parameters<typeof showLayers>[1]) => void;
    sceneNumbers: typeof sceneNumbers;
    testMode: typeof testMode;
    screenPoint: (x: number, y: number) => ReturnType<typeof screenPoint>;
    visibleRect: (margin?: number) => ReturnType<typeof visibleRect>;
    work: () => ReturnType<typeof work>;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const comb = await createComb(element("canvas"));
const copies = element<HTMLSelectElement>("copies");
const count = element("count");
const selection = element("selection");
const empty = element("empty");
const title = element<HTMLInputElement>("title");

let graph: GraphData = metricTree(1);
let selected: string | null = null;

/** Selects the copies the query string asks for, adding the option where it is missing. */
function copiesFromQuery(): void {
  const asked = Number(new URLSearchParams(location.search).get("copies"));
  if (!Number.isInteger(asked) || asked < 1) return;
  if (![...copies.options].some((option) => option.value === String(asked))) {
    copies.add(new Option(String(asked), String(asked)));
  }
  copies.value = String(asked);
}

async function load(): Promise<LoadReport> {
  graph = metricTree(Number(copies.value));
  count.textContent = `${graph.nodes.length} nodes, ${graph.edges.length} edges`;
  const start = performance.now();
  comb.load(graph);
  comb.fitView();
  await comb.whenRendered();
  const firstFrameMs = performance.now() - start;
  return {
    copies: Number(copies.value),
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    firstFrameMs,
  };
}

function show(next: Selection): void {
  selected = next?.kind === "node" ? next.id : null;
  const node = graph.nodes.find((candidate) => candidate.id === selected);
  selection.hidden = !node;
  empty.hidden = !!node;
  if (node) title.value = node.title;
}

comb.onSelectionChange(show);
copies.addEventListener("change", () => {
  window.loadReport = load();
});
title.addEventListener("input", () => {
  const node = graph.nodes.find((candidate) => candidate.id === selected);
  if (!node) return;
  node.title = title.value;
  comb.updateNode(node.id, { title: title.value });
});
copiesFromQuery();
window.comb = comb;
window.inspect = () => inspect(comb);
window.renderCount = () => renderCount(comb);
window.viewport = () => viewport(comb);
window.showLayers = (layers) => showLayers(comb, layers);
window.sceneNumbers = sceneNumbers;
window.testMode = testMode;
window.screenPoint = (x, y) => screenPoint(comb, x, y);
window.visibleRect = (margin) => visibleRect(comb, margin);
window.work = () => work(comb);
window.loadReport = load();
