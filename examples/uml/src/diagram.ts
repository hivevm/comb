// The diagram the example edits (G-12): its copy of the graph, the classifier of each node, and
// the kind of each relationship, kept from every change Comb tells (ADR-0024), as a host
// application that persists keeps its own. An edge the user connected arrives without a kind;
// it becomes an association, drawn as one.
import type { Comb, EdgeData, EdgeLabelData, EdgePatch, GraphChange, GraphData } from "comb";
import { contentOf, kindOf, type Classifier } from "./class-diagram";
import { patchOf, styleOf, type RelationshipKind } from "./relationships";
import { allows } from "./rules";

/** The kind a connection of the user adds. */
export const CONNECTED: RelationshipKind = "association";

export class Diagram {
  graph: GraphData = { nodes: [], edges: [] };
  classifiers = new Map<string, Classifier>();
  kinds = new Map<string, RelationshipKind>();

  constructor(private readonly comb: Comb) {}

  /** Takes `graph`, its classifiers, and its kinds as the diagram's own, and hands Comb the
   *  graph. */
  load(
    graph: GraphData,
    classifiers: Map<string, Classifier>,
    kinds: Map<string, RelationshipKind>,
  ): void {
    Object.assign(this, { graph, classifiers, kinds });
    this.comb.load(graph);
  }

  node(id: string) {
    return this.graph.nodes.find((each) => each.id === id);
  }

  edge(id: string) {
    return this.graph.edges.find((each) => each.id === id);
  }

  /** Whether the rules allow a relationship of `kind` from `source` to `target`. */
  allows(source: string, target: string, kind: RelationshipKind): boolean {
    const [from, to] = [this.classifiers.get(source), this.classifiers.get(target)];
    if (!from || !to) return false;
    return allows({ source: kindOf(from), target: kindOf(to), kind });
  }

  /** Replaces the content of node `id` with what `next` shows, and its classifier with `next`
   *  once Comb took the content; Comb lays it out anew, its height following. */
  edit(id: string, next: Classifier): void {
    try {
      this.comb.updateNode(id, { content: contentOf(next) });
    } catch (error) {
      // Content past Comb's limits, such as a text longer than one may be: the node keeps its
      // content and the classifier its members.
      console.warn("uml: the edit was not taken", error);
      return;
    }
    this.classifiers.set(id, next);
  }

  /** Changes edge `id` to `kind`, drawn as the kind is. Every kind is allowed between two
   *  classifiers (`rules.ts`), so the sidebar asks no rule. */
  rekind(id: string, kind: RelationshipKind): void {
    this.kinds.set(id, kind);
    this.comb.updateEdge(id, patchOf(kind));
  }

  /** Gives edge `id` the label `label`, or none for `null`. */
  updateLabel(id: string, label: EdgeLabelData | null): void {
    try {
      this.comb.updateEdge(id, { label });
    } catch (error) {
      // A label past Comb's limits: the edge keeps its label.
      console.warn("uml: the label was not taken", error);
    }
  }

  /** Takes `change` into the diagram. */
  mirror(change: GraphChange): void {
    (MIRROR[change.kind] as (diagram: Diagram, change: GraphChange) => void)(this, change);
  }

  /** Drops the nodes, their classifiers, and the edges a removal names. */
  removed(nodes: readonly string[], edges: readonly string[]): void {
    const [goneNodes, goneEdges] = [new Set(nodes), new Set(edges)];
    this.graph.nodes = this.graph.nodes.filter(({ id }) => !goneNodes.has(id));
    this.graph.edges = this.graph.edges.filter(({ id }) => !goneEdges.has(id));
    for (const id of nodes) this.classifiers.delete(id);
    for (const id of edges) this.kinds.delete(id);
  }

  /** Adds `edge`; one without a kind, as the user connects it, becomes an association. */
  added(edge: EdgeData): void {
    this.graph.edges.push({ ...edge });
    if (this.kinds.has(edge.id)) return;
    this.kinds.set(edge.id, CONNECTED);
    // The association's style, adding what it draws and clearing nothing the edge brought.
    this.comb.updateEdge(edge.id, styleOf(CONNECTED));
  }
}

/** `edge` with `patch` merged, as Comb merges it: `null` clears a dash or a label. */
function patched(edge: EdgeData, patch: EdgePatch): void {
  const { dash, label, ...rest } = patch;
  Object.assign(edge, rest);
  if (dash !== undefined) edge.dash = dash ?? undefined;
  if (label !== undefined) edge.label = label ?? undefined;
}

/** How the diagram takes each kind of change; the type checker fails it where a kind is left
 *  out. */
const MIRROR: {
  [K in GraphChange["kind"]]: (diagram: Diagram, change: Extract<GraphChange, { kind: K }>) => void;
} = {
  // `load` sets the diagram before it hands the graph to Comb.
  loaded: () => {},
  nodeAdded: (diagram, { node }) => void diagram.graph.nodes.push({ ...node }),
  nodeUpdated: (diagram, { id, patch }) => void Object.assign(diagram.node(id) ?? {}, patch),
  nodeMoved: (diagram, { id, x, y }) => void Object.assign(diagram.node(id) ?? {}, { x, y }),
  nodesRemoved: (diagram, { nodes, edges }) => diagram.removed(nodes, edges),
  edgeAdded: (diagram, { edge }) => diagram.added(edge),
  edgeUpdated: (diagram, { id, patch }) => {
    const edge = diagram.edge(id);
    if (edge) patched(edge, patch);
  },
  edgesRemoved: (diagram, { edges }) => diagram.removed([], edges),
  labelMoved: (diagram, { edge: id, t, offset }) => {
    const edge = diagram.edge(id);
    if (edge?.label) edge.label = { ...edge.label, t, offset };
  },
};
