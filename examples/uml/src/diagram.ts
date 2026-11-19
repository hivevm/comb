// The diagram the example edits (G-12, G-20): its copy of the graph, the classifier or the state
// of each node, the kind of each relationship, and the trigger, guard, and effect of each
// transition, kept from every change Comb tells (API-edits-reported-as-typed-changes), as a host
// application that persists keeps its own. An edge the user connected arrives without a kind; it
// becomes the kind a connection adds in the diagram shown, drawn as one, and docked as the
// diagram's descriptor says. The diagram also answers where a node lies in the world, from its
// copy, so that a drop lands in the container under it or on the border of the node under it.
import type {
  BorderNodeData,
  Comb,
  EdgeData,
  EdgeLabelData,
  EdgePatch,
  GraphChange,
  GraphData,
  NodeContent,
  NodeData,
  RegionData,
} from "comb";
import { labelIn, labelOf, patchOf, styleOf, type RelationshipKind } from "./relationships";
import { refusal as ruleRefusal, transitionParts, type TransitionPart } from "./rules";
import {
  contentOf,
  type AddedEdge,
  type Classifier,
  type DiagramData,
  type DiagramDescriptor,
  type NodeKind,
  type State,
  type Transition,
} from "./shared";
import {
  labelTextOf,
  nameOf,
  nameNodeId,
  nameOffsetOf,
  nameWidth,
  contentOf as stateContentOf,
} from "./state-diagram";

/** An edit Comb refused, and what it threw: a `GraphDataError` for data past its limits, such as
 *  a text longer than one may be, or an `EngineLostError` once its engine is lost. */
export interface Refusal {
  error: unknown;
}

/** A box in the world: its top left corner and its size. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Why a connection between two nodes is refused where one of them has no kind, as the node of a
 *  point's name. */
const NO_KIND = "Only the example's elements connect; the name of a point takes no transition.";

export class Diagram {
  graph: GraphData = { nodes: [], edges: [] };
  classifiers = new Map<string, Classifier>();
  states = new Map<string, State>();
  kinds = new Map<string, RelationshipKind>();
  transitions = new Map<string, Transition>();

  /** `descriptor` describes the diagram shown: the kind a connection of the user adds and how it
   *  docks, among the rest. */
  constructor(
    private readonly comb: Comb,
    public descriptor: DiagramDescriptor,
  ) {}

  /** Takes `data`, its graph, its classifiers, its states, its kinds, and its transitions, as the
   *  diagram's own, described by `descriptor`, and hands Comb the graph. */
  load(
    { graph, classifiers, states, kinds, transitions }: DiagramData,
    descriptor: DiagramDescriptor,
  ): void {
    Object.assign(this, { graph, classifiers, states, kinds, transitions, descriptor });
    this.comb.load(graph);
  }

  /** The diagram's own data, as `load` takes it. */
  data(): DiagramData {
    const { graph, classifiers, states, kinds, transitions } = this;
    return { graph, classifiers, states, kinds, transitions };
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

  /** The kind a connection of the user's from node `source` adds: the descriptor's for the kind of
   *  that node, or else the diagram's. */
  connectedKind(source: string): RelationshipKind {
    const { connected, connectedFrom } = this.descriptor;
    const kind = this.kindOf(source);
    return (kind && connectedFrom?.[kind]) ?? connected;
  }

  /** Why the rules refuse a relationship of `kind` from `source` to `target`, a loop where the two
   *  are one; none where they allow it. */
  refusal(source: string, target: string, kind: RelationshipKind): string | undefined {
    const [from, to] = [this.kindOf(source), this.kindOf(target)];
    if (!from || !to) return NO_KIND;
    return ruleRefusal({ source: from, target: to, kind, loop: source === target });
  }

  /** The world box of node or region `id` as the copy places it: a node by its position in its
   *  container, as high as its data or its last resize says or else as `heightOf` gives its
   *  content; a region by the sizes of the regions before it, below its node's content. None for
   *  a border node, an unknown identifier, or a region of a node the copy no longer holds. */
  box(id: string): Box | undefined {
    const node = this.node(id);
    if (node) {
      if (node.attachedTo !== undefined) return undefined;
      const origin = node.container === undefined ? { x: 0, y: 0 } : this.box(node.container);
      if (!origin) return undefined;
      const height = node.height ?? this.comb.heightOf(node.content, node.width, node.shape);
      return { x: origin.x + node.x, y: origin.y + node.y, width: node.width, height };
    }
    const divided = this.dividing(id);
    const box = divided && this.box(divided.id);
    if (!divided || !box) return undefined;
    const top = this.comb.heightOf(divided.content, divided.width, divided.shape);
    // The example divides every node it divides by `divide`, and no region again.
    return regionBox(
      { x: box.x, y: box.y + top, width: box.width, height: box.height - top },
      divided.divide!,
      divided.regions!,
      id,
    );
  }

  /** The node region `id` divides, none where no node has such a region. */
  private dividing(id: string) {
    return this.graph.nodes.find((node) => node.regions?.some((region) => region.id === id));
  }

  /** The deepest node or region the world point (`x`, `y`) lies in, of those `holds` accepts by
   *  identifier, none where it lies in none. */
  deepestAt(x: number, y: number, holds: (id: string) => boolean): string | undefined {
    const inside = (box: Box | undefined) =>
      box !== undefined &&
      x >= box.x &&
      x <= box.x + box.width &&
      y >= box.y &&
      y <= box.y + box.height;
    const candidates = this.graph.nodes.flatMap((node) => [
      node.id,
      ...(node.regions ?? []).map((region) => region.id),
    ]);
    let deepest: { id: string; depth: number } | undefined;
    for (const id of candidates) {
      if (!holds(id) || !inside(this.box(id))) continue;
      const depth = this.depthOf(id);
      if (!deepest || depth > deepest.depth) deepest = { id, depth };
    }
    return deepest?.id;
  }

  /** How many nodes and regions node or region `id` lies in. */
  private depthOf(id: string): number {
    const node = this.node(id);
    if (node) return node.container === undefined ? 0 : 1 + this.depthOf(node.container);
    const divided = this.dividing(id);
    return divided ? 1 + this.depthOf(divided.id) : 0;
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
   *  Comb took the content, as `edit` does a classifier; a point's name is the content of the node
   *  beside it. */
  editState(id: string, next: State): Refusal | undefined {
    const name = nameOf(next);
    const refusal = name
      ? this.rename(id, name, nameWidth(next.name ?? ""))
      : this.updateContent(id, stateContentOf(next));
    if (!refusal) this.states.set(id, next);
    return refusal;
  }

  /** Gives the node of the name of point `point`, `name`, its content, as wide as `width`: Comb
   *  changes no node's width, so a name of another width replaces its node by one beside the point
   *  again, as `nameOffsetOf` places it, and the old node comes back where Comb refuses the new
   *  one. Comb's refusal where it refused it. */
  private rename(
    point: string,
    name: { id: string; content: NodeContent },
    width: number,
  ): Refusal | undefined {
    const [current, at] = [this.node(name.id), this.node(point)];
    if (
      current?.attachedTo === undefined ||
      at?.attachedTo === undefined ||
      current.width === width
    )
      return this.updateContent(name.id, name.content);
    const kept = structuredClone(current);
    const offset = this.nameOffsetBeside(at, width, name.content);
    try {
      this.comb.removeNodes([name.id]);
      this.comb.addNode({ ...kept, width, content: name.content, offset });
    } catch (error) {
      // A name past Comb's limits: the old node where it stood, if Comb removed it.
      console.warn("uml: the name was not taken", error);
      if (!this.node(name.id)) this.comb.addNode(kept);
      return { error };
    }
    return undefined;
  }

  /** The parts transition `id` may have by the kinds of its ends (`transitionParts`), every part
   *  where an end is no node of a kind. */
  partsOf(id: string): TransitionPart[] {
    const edge = this.edge(id);
    const [from, to] = [edge?.source, edge?.target].map((end) => end && this.kindOf(end));
    return from && to ? transitionParts(from, to) : ["trigger", "guard", "effect"];
  }

  /** Gives transition `id` the trigger, guard, and effect of `next`, its label showing them, and
   *  keeps `next` once Comb took the label; Comb's refusal where it refused it. */
  editTransition(id: string, next: Transition): Refusal | undefined {
    const text = labelTextOf(next);
    const current = labelIn(this.edge(id));
    const kind = this.kinds.get(id)!;
    const refusal = this.updateLabel(id, text === null ? null : labelOf(kind, text, current));
    if (!refusal) this.transitions.set(id, next);
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
      this.comb.updateEdge(id, patchOf(from, kind, labelIn(this.edge(id))));
    } catch (error) {
      // A lost engine, or an edge Comb no longer holds: the edge keeps its kind.
      console.warn("uml: the change of kind was not taken", error);
      return;
    }
    this.kinds.set(id, kind);
  }

  /** Gives edge `id` the label `label`, a list of one, or none for `null`; Comb's refusal where it
   *  refused it. */
  updateLabel(id: string, label: EdgeLabelData | null): Refusal | undefined {
    try {
      this.comb.updateEdge(id, { labels: label && [label] });
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

  /** Drops the nodes, their classifiers or states, and the edges a removal names; and asks Comb,
   *  once the change is told, to remove the name of each point removed that is left. */
  removed(nodes: readonly string[], edges: readonly string[]): void {
    const [goneNodes, goneEdges] = [new Set(nodes), new Set(edges)];
    const names = nodes
      .map((id) => this.states.get(id))
      .flatMap((state) => (state && nameOf(state) ? [nameNodeId(state.id)] : []))
      .filter((name) => !goneNodes.has(name) && this.node(name));
    this.graph.nodes = this.graph.nodes.filter(({ id }) => !goneNodes.has(id));
    this.graph.edges = this.graph.edges.filter(({ id }) => !goneEdges.has(id));
    for (const id of nodes) {
      this.classifiers.delete(id);
      this.states.delete(id);
    }
    for (const id of edges) {
      this.kinds.delete(id);
      this.transitions.delete(id);
    }
    if (names.length > 0)
      // After the change that removed the point is told: Comb takes no edit from inside a listener.
      queueMicrotask(() => {
        try {
          this.comb.removeNodes(names);
        } catch (error) {
          // A lost engine: the name stays with the canvas that keeps its last frame.
          console.warn("uml: the name of a removed point was not removed", error);
        }
      });
  }

  /** The offset of a name's node `width` wide showing `content` beside the point `point`, on the
   *  side of the node it rides as long as the copy's box of that node says (`nameOffsetOf`). */
  private nameOffsetBeside(point: BorderNodeData, width: number, content: NodeContent): number {
    const owner = this.box(point.attachedTo);
    const across = point.side === "top" || point.side === "bottom";
    const length = owner && (across ? owner.width : owner.height);
    return nameOffsetOf({ ...point, length }, width, this.comb.heightOf(content, width));
  }

  /** Whether the user may delete `nodes`: the name of a point goes only with its point. */
  deletable(nodes: readonly string[]): boolean {
    const gone = new Set(nodes);
    return nodes.every((id) => {
      const point = [...this.states.values()].find((state) => nameOf(state)?.id === id);
      return point === undefined || gone.has(point.id);
    });
  }

  /** Adds `edge`; one without a kind, as the user connects it, becomes the kind a connection from
   *  its source adds, docked as the descriptor says, a transition with no parts yet. */
  added(edge: AddedEdge): void {
    this.graph.edges.push({ ...edge });
    if (this.kinds.has(edge.id)) return;
    const { docking } = this.descriptor;
    // The user connects nodes alone (API-edges-dock-nodes-or-edges), so the source is a node.
    const connected = this.connectedKind(edge.source!);
    this.kinds.set(edge.id, connected);
    if (connected === this.descriptor.connected) this.transitions.set(edge.id, {});
    // The kind's style, adding what it draws and clearing nothing the edge brought.
    this.comb.updateEdge(edge.id, { ...styleOf(connected), ...docking?.(edge) });
  }
}

/** `edge` with `patch` merged, as Comb merges it: `null` clears a dash or the labels, which a
 *  patch replaces whole. */
function patched(edge: EdgeData, patch: EdgePatch): void {
  const { dash, labels, ...rest } = patch;
  Object.assign(edge, rest);
  if (dash !== undefined) edge.dash = dash ?? undefined;
  if (labels !== undefined) edge.labels = labels ?? undefined;
}

/** Gives `regions`, at every depth, the sizes `sizes` names by identifier, as Comb told them. */
function sized(
  regions: RegionData[] | undefined,
  sizes: readonly { readonly id: string; readonly size: number }[],
): void {
  // A walk that does not recurse, so that a tree of any depth takes its sizes.
  const pending = [...(regions ?? [])];
  for (let region = pending.pop(); region; region = pending.pop()) {
    region.size = sizes.find(({ id }) => id === region!.id)?.size ?? region.size;
    for (const inner of region.regions ?? []) pending.push(inner);
  }
}

/** The box of region `id` among `regions`, divided by `divide` in `box`: each region as long as
 *  its size along the division, the last taking the rest (ARCH-regions-are-container-slots). */
function regionBox(box: Box, divide: string, regions: readonly RegionData[], id: string): Box {
  let start = 0;
  const across = divide === "across";
  const extent = across ? box.width : box.height;
  for (const [i, region] of regions.entries()) {
    const size = i === regions.length - 1 ? Math.max(region.size, extent - start) : region.size;
    const own = across
      ? { x: box.x + start, y: box.y, width: size, height: box.height }
      : { x: box.x, y: box.y + start, width: box.width, height: size };
    if (region.id === id) return own;
    start += size;
  }
  return box;
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
  nodeMoved: (diagram, change) => {
    // A border node keeps its side and offset, any other node its position and its container.
    const node: Partial<NodeData> = diagram.node(change.id) ?? {};
    if ("side" in change) {
      Object.assign(node, { side: change.side, offset: change.offset });
      return;
    }
    Object.assign(node, { x: change.x, y: change.y });
    if (change.container === null) delete node.container;
    else Object.assign(node, { container: change.container });
  },
  nodeResized: (diagram, { id, x, y, width, height, moved, regions }) => {
    Object.assign(diagram.node(id) ?? {}, { x, y, width, height });
    for (const at of moved) Object.assign(diagram.node(at.id) ?? {}, { x: at.x, y: at.y });
    sized(diagram.node(id)?.regions, regions);
  },
  regionsMoved: (diagram, { node, regions, moved }) => {
    sized(diagram.node(node)?.regions, regions);
    for (const at of moved) Object.assign(diagram.node(at.id) ?? {}, { x: at.x, y: at.y });
  },
  nodesRemoved: (diagram, { nodes, edges }) => diagram.removed(nodes, edges),
  edgeAdded: (diagram, { edge }) => diagram.added(edge),
  edgeUpdated: (diagram, { id, patch }) => {
    const edge = diagram.edge(id);
    if (edge) patched(edge, patch);
  },
  edgesRemoved: (diagram, { edges }) => diagram.removed([], edges),
  labelMoved: (diagram, { edge: id, label: moved, t, offset }) => {
    const edge = diagram.edge(id);
    if (edge?.labels)
      edge.labels = edge.labels.map((label) =>
        label.id === moved ? { ...label, t, offset } : label,
      );
  },
};
