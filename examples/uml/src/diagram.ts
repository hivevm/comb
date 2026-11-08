// The diagram the example edits (G-12): its copy of the graph, the classifier or the state of
// each node, and the kind of each relationship, kept from every change Comb tells (ADR-0024), as
// a host application that persists keeps its own. An edge the user connected arrives without a
// kind; it becomes the kind a connection adds in the diagram shown, drawn as one, and docked as
// the diagram's descriptor says.
import type {
  Comb,
  EdgeData,
  EdgeLabelData,
  EdgePatch,
  GraphChange,
  GraphData,
  NodeContent,
} from "comb";
import { patchOf, styleOf, type RelationshipKind } from "./relationships";
import { allows } from "./rules";
import {
  contentOf,
  type AddedEdge,
  type Classifier,
  type DiagramData,
  type DiagramDescriptor,
  type NodeKind,
  type State,
} from "./shared";
import { contentOf as stateContentOf } from "./state-diagram";

/** An edit Comb refused, and what it threw: a `GraphDataError` for data past its limits, such as
 *  a text longer than one may be, or an `EngineLostError` once its engine is lost. */
export interface Refusal {
  error: unknown;
}

export class Diagram {
  graph: GraphData = { nodes: [], edges: [] };
  classifiers = new Map<string, Classifier>();
  states = new Map<string, State>();
  kinds = new Map<string, RelationshipKind>();

  /** `descriptor` describes the diagram shown: the kind a connection of the user adds and how it
   *  docks, among the rest. */
  constructor(
    private readonly comb: Comb,
    public descriptor: DiagramDescriptor,
  ) {}

  /** Takes `data`, its graph, its classifiers, its states, and its kinds, as the diagram's own,
   *  described by `descriptor`, and hands Comb the graph. */
  load({ graph, classifiers, states, kinds }: DiagramData, descriptor: DiagramDescriptor): void {
    Object.assign(this, { graph, classifiers, states, kinds, descriptor });
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
   *  once Comb took the content; Comb lays it out anew, its height following. Returns Comb's
   *  refusal where it refused the content. */
  edit(id: string, next: Classifier): Refusal | undefined {
    const refusal = this.updateContent(id, contentOf(next));
    if (!refusal) this.classifiers.set(id, next);
    return refusal;
  }

  /** Replaces the content of state `id` with what `next` shows, and its state with `next` once
   *  Comb took the content, as `edit` does a classifier. */
  editState(id: string, next: State): Refusal | undefined {
    const refusal = this.updateContent(id, stateContentOf(next));
    if (!refusal) this.states.set(id, next);
    return refusal;
  }

  /** Gives node `id` the content `content`; Comb's refusal where it refused it. */
  private updateContent(id: string, content: NodeContent): Refusal | undefined {
    try {
      this.comb.updateNode(id, { content });
    } catch (error) {
      // Content past Comb's limits, such as a text longer than one may be: the node keeps its
      // content, and its classifier or its state what it held.
      console.warn("uml: the edit was not taken", error);
      return { error };
    }
    return undefined;
  }

  /** Changes edge `id` to `kind`, drawn as the kind is, its label as `patchOf` says, and its kind
   *  once Comb took the change. Every kind is allowed between two classifiers (`rules.ts`), so
   *  the sidebar asks no rule. */
  rekind(id: string, kind: RelationshipKind): void {
    // The sidebar shows the form of an edge only where the edge has a kind.
    const from = this.kinds.get(id)!;
    try {
      this.comb.updateEdge(id, patchOf(from, kind, this.edge(id)?.label));
    } catch (error) {
      // A lost engine, or an edge Comb no longer holds: the edge keeps its kind.
      console.warn("uml: the change of kind was not taken", error);
      return;
    }
    this.kinds.set(id, kind);
  }

  /** Gives edge `id` the label `label`, or none for `null`; Comb's refusal where it refused it. */
  updateLabel(id: string, label: EdgeLabelData | null): Refusal | undefined {
    try {
      this.comb.updateEdge(id, { label });
    } catch (error) {
      // A label past Comb's limits: the edge keeps its label.
      console.warn("uml: the label was not taken", error);
      return { error };
    }
    return undefined;
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
   *  adds, docked as the descriptor says. */
  added(edge: AddedEdge): void {
    this.graph.edges.push({ ...edge });
    if (this.kinds.has(edge.id)) return;
    const { connected, docking } = this.descriptor;
    this.kinds.set(edge.id, connected);
    // The kind's style, adding what it draws and clearing nothing the edge brought.
    this.comb.updateEdge(edge.id, { ...styleOf(connected), ...docking?.(edge) });
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
