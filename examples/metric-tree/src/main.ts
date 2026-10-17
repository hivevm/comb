// The example host application: Comb on the canvas, the attribute form in the HTML sidebar.
import { createComb, type GraphData, type Selection } from "comb";
import { metricTree } from "./graph";

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

function load(): void {
  graph = metricTree(Number(copies.value));
  comb.load(graph);
  comb.fitView();
  count.textContent = `${graph.nodes.length} nodes, ${graph.edges.length} edges`;
}

function show(next: Selection): void {
  selected = next?.kind === "node" ? next.id : null;
  const node = graph.nodes.find((candidate) => candidate.id === selected);
  selection.hidden = !node;
  empty.hidden = !!node;
  if (node) title.value = node.title;
}

comb.onSelectionChange(show);
copies.addEventListener("change", load);
title.addEventListener("input", () => {
  const node = graph.nodes.find((candidate) => candidate.id === selected);
  if (!node) return;
  node.title = title.value;
  comb.updateNode(node.id, { title: title.value });
});
load();
