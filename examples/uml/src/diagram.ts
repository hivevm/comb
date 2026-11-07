// The diagram the example edits (G-12): its copy of the graph, the classifier or the state of
// each node, and the kind of each relationship, kept from every change Comb tells (ADR-0024), as
// a host application that persists keeps its own. An edge the user connected arrives without a
// kind; it becomes the kind a connection adds in the diagram shown, drawn as one, and a transition
// docked as the state diagram docks one.
import type { Comb, EdgeData, EdgeLabelData, EdgePatch, GraphChange, GraphData } from "comb";
import { patchOf, styleOf, type RelationshipKind } from "./relationships";
import { allows, type NodeKind } from "./rules";
import { contentOf, type Classifier, type DiagramData, type State } from "./shared";
import { contentOf as stateContentOf, dockingOf } from "./state-diagram";

export class Diagram {
  graph: GraphData = { nodes: [], edges: [] };
  classifiers = new Map<string, Classifier>();
  states = new Map<string, State>();
  kinds = new Map<string, RelationshipKind>();
  /** The kind a connection of the user adds: an association of classifiers, a dependency
   *  «use» of packages, a transition of states. */
  connected: RelationshipKind = "association";

  constructor(private readonly comb: Comb) {}

  /** Takes `data`, its graph, its classifiers, its states, and its kinds, as the diagram's own, a
   *  connection adding `connected`, and hands Comb the graph. */
  load({ graph, classifiers, states, kinds }: DiagramData, connected: RelationshipKind): void {
    Object.assign(this, { graph, classifiers, states, kinds, connected });
    this.comb.load(graph);
  }

  /** The diagram's own data, as `load` takes it. */
  data(): DiagramData {
    const { graph, classifiers, states, kinds } = this;
    return { graph, classifiers, states, kinds };
  }

  node(id: string) {
    return this.graph.nodes.find((each) => each.id === id);
  }

  edge(id: string) {
    return this.graph.edges.find((each) => each.id === id);
  }

  /** The kind of node `id`: its classifier's or its state's, none for a node of neither. */
  kindOf(id: string): NodeKind | undefined {
    return this.classifiers.get(id)?.kind ?? this.states.get(id)?.kind;
  }

  /** Whether the rules allow a relationship of `kind` from `source` to `target`, a loop where the
   *  two are one. */
  allows(source: string, target: string, kind: RelationshipKind): boolean {
    const [from, to] = [this.kindOf(source), this.kindOf(target)];
    if (!from || !to) return false;
    return allows({ source: from, target: to, kind, loop: source === target });
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

  /** Replaces the content of state `id` with what `next` shows, and its state with `next` once
   *  Comb took the content, as `edit` does a classifier. */
  editState(id: string, next: State): void {
    try {
      this.comb.updateNode(id, { content: stateContentOf(next) });
    } catch (error) {
      console.warn("uml: the edit was not taken", error);
      return;
    }
    this.states.set(id, next);
  }

  /** Changes edge `id` to `kind`, drawn as the kind is, and its kind once Comb took the change.
   *  Every kind is allowed between two classifiers (`rules.ts`), so the sidebar asks no rule. */
  rekind(id: string, kind: RelationshipKind): void {
    try {
      this.comb.updateEdge(id, patchOf(kind));
    } catch (error) {
      // A lost engine, or an edge Comb no longer holds: the edge keeps its kind.
      console.warn("uml: the change of kind was not taken", error);
      return;
    }
    this.kinds.set(id, kind);
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

  /** Drops the nodes, their classifiers or states, and the edges a removal names. */
  removed(nodes: readonly string[], edges: readonly string[]): void {
    const [goneNodes, goneEdges] = [new Set(nodes), new Set(edges)];
    this.graph.nodes = this.graph.nodes.filter(({ id }) => !goneNodes.has(id));
    this.graph.edges = this.graph.edges.filter(({ id }) => !goneEdges.has(id));
    for (const id of nodes) {
      this.classifiers.delete(id);
      this.states.delete(id);
    }
    for (const id of edges) this.kinds.delete(id);
  }

  /** Adds `edge`; one without a kind, as the user connects it, becomes the kind a connection
   *  adds, and a transition is docked as `dockingOf` says. */
  added(edge: EdgeData): void {
    this.graph.edges.push({ ...edge });
    if (this.kinds.has(edge.id)) return;
    const kind = this.connected;
    this.kinds.set(edge.id, kind);
    // The kind's style, adding what it draws and clearing nothing the edge brought.
    const docking = kind === "transition" ? dockingOf(edge) : {};
    this.comb.updateEdge(edge.id, { ...styleOf(kind), ...docking });
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
