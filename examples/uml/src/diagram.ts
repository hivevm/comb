// The diagram the example edits (G-12, G-20): its copy of the graph, the classifier, the state, the
// activity node, or the use case diagram's node of each node, the kind of each relationship, the
// trigger, guard, and effect of each transition, and the guard and weight of each flow, kept from
// every change Comb tells (API-edits-reported-as-typed-changes), as a host application that
// persists keeps its own. An edge the user connected arrives without a kind; it becomes the kind a
// connection adds in the diagram shown, drawn as one, and docked as the diagram's descriptor says.
// The diagram also answers where a node lies in the world, from its copy, so that a drop lands in
// the container under it or on the border of the node under it.
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
  NodePatch,
  RegionData,
} from "comb";
import {
  KINDS,
  labelIn,
  labelOf,
  multiplicityLabelsOf,
  patchOf,
  styleOf,
  type Multiplicities,
  type RelationshipKind,
} from "./relationships";
import { refusal as ruleRefusal, transitionParts, type TransitionPart } from "./rules";
import {
  contentOf as activityContentOf,
  companionsOf,
  flowLabelOf,
  nameOf as activityNameOf,
  streamNodeId,
  streamNodeOf,
} from "./activity";
import {
  contentOf,
  nameNodeId,
  nameOffsetOf,
  nameWidth,
  type ActivityNode,
  type AddedEdge,
  type Classifier,
  type DiagramData,
  type DiagramDescriptor,
  type Flow,
  type NodeKind,
  type State,
  type Transition,
  type UseCaseNode,
} from "./shared";
import { labelTextOf, nameOf, contentOf as stateContentOf } from "./state-diagram";
import { contentOf as useCaseContentOf } from "./use-case-diagram";

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

/** How thick the band a region's name stands in is, as Comb draws it
 *  (ARCH-regions-are-container-slots): copied from `BAND` in `crates/engine/src/graph/regions.rs`,
 *  since Comb's interface tells a host application neither the band nor a region's box (backlog
 *  `region-box-is-not-told`; accepted by the human on 2026-11-19). */
const BAND = 24;

/** Why a connection between two nodes is refused where one of them has no kind, as the node of a
 *  point's name. */
const NO_KIND =
  "Only the example's elements connect; the name beside a point or a pin, and the outer rectangle of an expansion node, take no edge.";

export class Diagram {
  graph: GraphData = { nodes: [], edges: [] };
  classifiers = new Map<string, Classifier>();
  states = new Map<string, State>();
  activities = new Map<string, ActivityNode>();
  useCases = new Map<string, UseCaseNode>();
  kinds = new Map<string, RelationshipKind>();
  transitions = new Map<string, Transition>();
  flows = new Map<string, Flow>();

  /** `descriptor` describes the diagram shown: the kind a connection of the user adds and how it
   *  docks, among the rest. */
  constructor(
    private readonly comb: Comb,
    public descriptor: DiagramDescriptor,
  ) {}

  /** Takes `data`, its graph, its classifiers, its states, its activity nodes, its use case
   *  diagram's nodes, its kinds, its transitions, and its flows, as the diagram's own, described by
   *  `descriptor`, and hands Comb the graph. */
  load(data: DiagramData, descriptor: DiagramDescriptor): void {
    const { graph, classifiers, states, activities, useCases, kinds, transitions, flows } = data;
    Object.assign(this, {
      graph,
      classifiers,
      states,
      activities,
      useCases,
      kinds,
      transitions,
      flows,
    });
    this.descriptor = descriptor;
    this.comb.load(graph);
  }

  /** The diagram's own data, as `load` takes it. */
  data(): DiagramData {
    const { graph, classifiers, states, activities, useCases, kinds, transitions, flows } = this;
    return { graph, classifiers, states, activities, useCases, kinds, transitions, flows };
  }

  node(id: string) {
    return this.graph.nodes.find((each) => each.id === id);
  }

  edge(id: string) {
    return this.graph.edges.find((each) => each.id === id);
  }

  /** The kind of node `id`: its classifier's, its state's, its activity node's, or its use case
   *  diagram's node's, none for a node of none. */
  kindOf(id: string): NodeKind | undefined {
    return (
      this.classifiers.get(id)?.kind ??
      this.states.get(id)?.kind ??
      this.activities.get(id)?.kind ??
      this.useCases.get(id)?.kind
    );
  }

  /** The kind a connection of the user's from node `source` to node `target` adds: the
   *  descriptor's for the kinds of those nodes, or else the diagram's. */
  connectedKind(source: string, target: string): RelationshipKind {
    const { connected, connectedOf } = this.descriptor;
    const [from, to] = [this.kindOf(source), this.kindOf(target)];
    return (from && to && connectedOf?.(from, to)) || connected;
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
   *  content; a region by the sizes of the regions before it, below its node's content or its
   *  region's band (ARCH-regions-are-container-slots), a region within a region as the notation
   *  diagram's nested partitions. None for a border node, an unknown identifier, or a region of a
   *  node the copy no longer holds. */
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
    const box = divided && this.box(divided.node.id);
    if (!divided || !box) return undefined;
    const { content, width, shape } = divided.node;
    const top = this.comb.heightOf(content, width, shape);
    return pathBox({ ...box, y: box.y + top, height: box.height - top }, divided);
  }

  /** Region `id` where it is divided into regions of its own, as the notation diagram's partition
   *  Comb is; none for any other identifier. */
  dividedRegion(id: string): RegionData | undefined {
    const region = this.dividing(id)?.path.at(-1);
    return region?.regions?.length ? region : undefined;
  }

  /** The node region `id` divides at any depth, and the regions from that node's down to `id`;
   *  none where no node has such a region. */
  private dividing(id: string): { node: NodeData; path: RegionData[] } | undefined {
    const pathTo = (regions: readonly RegionData[]): RegionData[] | undefined => {
      for (const region of regions) {
        if (region.id === id) return [region];
        const below = pathTo(region.regions ?? []);
        if (below) return [region, ...below];
      }
      return undefined;
    };
    for (const node of this.graph.nodes) {
      const path = pathTo(node.regions ?? []);
      if (path) return { node, path };
    }
    return undefined;
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
    const regionsIn = (regions: readonly RegionData[]): string[] =>
      regions.flatMap((region) => [region.id, ...regionsIn(region.regions ?? [])]);
    const candidates = this.graph.nodes.flatMap((node) => [
      node.id,
      ...regionsIn(node.regions ?? []),
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
    return divided ? divided.path.length + this.depthOf(divided.node.id) : 0;
  }

  /** Replaces the content of node `id` with what `next` shows, and its classifier with `next`
   *  once Comb took the content; Comb lays it out anew, its height following. Returns Comb's
   *  refusal where it refused the content. */
  edit(id: string, next: Classifier): Refusal | undefined {
    const refusal = this.patchNode(id, { content: contentOf(next) });
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
      : this.patchNode(id, { content: stateContentOf(next) });
    if (!refusal) this.states.set(id, next);
    return refusal;
  }

  /** Replaces the content of activity node `id` with what `next` shows, and its activity node with
   *  `next` once Comb took the content, as `editState` does a state; a pin's name and a value
   *  pin's value are the content of the node beside it, and `{stream}` stands beside either where
   *  `next` streams. Once Comb took the name or the value, the activity node holds it, and streams
   *  only where the node of `{stream}` stands, whatever Comb refused of it. */
  editActivity(id: string, next: ActivityNode): Refusal | undefined {
    const name = activityNameOf(next);
    if (!name) {
      const refusal = this.patchNode(id, { content: activityContentOf(next) });
      if (!refusal) this.activities.set(id, next);
      return refusal;
    }
    const renamed = this.rename(id, name, nameWidth(name.text));
    if (renamed) return renamed;
    const refusal = this.restream(next, name.id);
    const held = { ...next };
    if (this.node(streamNodeId(id))) held.stream = true;
    else delete held.stream;
    this.activities.set(id, held);
    return refusal;
  }

  /** Gives the pin or the value pin `pin` the node of `{stream}` beside it, on the other side from
   *  the node `beside` of its name or value, where it streams, and none where it does not: Comb
   *  adds the node, or removes it, or replaces it where it stands on the wrong side. Comb's
   *  refusal where it refused it. */
  private restream(pin: ActivityNode, beside: string): Refusal | undefined {
    const id = streamNodeId(pin.id);
    const [current, own, name] = [this.node(id), this.node(pin.id), this.node(beside)];
    // A pin and the node beside it ride the action, so both are border nodes.
    const heightOf: Comb["heightOf"] = (content, width) => this.comb.heightOf(content, width);
    const wanted = pin.stream
      ? streamNodeOf(own as BorderNodeData, name as BorderNodeData, heightOf)
      : undefined;
    if (current?.offset === wanted?.offset) return undefined;
    try {
      if (current) this.comb.removeNodes([id]);
      if (wanted) this.comb.addNode(wanted);
    } catch (error) {
      // A lost engine, or a node Comb refused: what Comb took of the change stands, and the copy
      // holds it, as Comb told it; `editActivity` reads from the copy whether `{stream}` stands.
      console.warn("uml: {stream} was not changed", error);
      return { error };
    }
    return undefined;
  }

  /** Names the clauses of the conditional node `id`, its regions, one by one as `names` says, each
   *  keeping its size and what it holds; refused, and why, where `names` names another count of
   *  clauses or leaves one empty, as the human decided on 2026-11-19; Comb's refusal where it
   *  refused the names. */
  nameClauses(id: string, names: readonly string[]): Refusal | undefined {
    const clauses = this.node(id)?.regions ?? [];
    if (names.length !== clauses.length || names.includes(""))
      return { error: new Error(`name each of the ${clauses.length} clauses, one per line`) };
    return this.patchNode(id, {
      regions: clauses.map((clause, i) => ({ ...clause, name: names[i]! })),
    });
  }

  /** Replaces the content of the use case diagram's node `id` with what `next` shows, and its node
   *  with `next` once Comb took the content, as `edit` does a classifier. */
  editUseCase(id: string, next: UseCaseNode): Refusal | undefined {
    const refusal = this.patchNode(id, { content: useCaseContentOf(next) });
    if (!refusal) this.useCases.set(id, next);
    return refusal;
  }

  /** Gives association `id` the multiplicities `next`, a label at each end that has one, each
   *  where its label stands; Comb's refusal where it refused the labels. */
  editMultiplicities(id: string, next: Multiplicities): Refusal | undefined {
    const labels = multiplicityLabelsOf(next, this.edge(id)?.labels);
    try {
      this.comb.updateEdge(id, { labels: labels.length === 0 ? null : labels });
    } catch (error) {
      // A label past Comb's limits: the edge keeps its labels.
      console.warn("uml: the multiplicities were not taken", error);
      return { error };
    }
    return undefined;
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
      return this.patchNode(name.id, { content: name.content });
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
    const refusal = this.relabel(id, labelTextOf(next));
    if (!refusal) this.transitions.set(id, next);
    return refusal;
  }

  /** Gives flow `id` the guard and weight of `next`, its label showing them, and keeps `next` once
   *  Comb took the label, as `editTransition` does a transition. */
  editFlow(id: string, next: Flow): Refusal | undefined {
    const refusal = this.relabel(id, flowLabelOf(next));
    if (!refusal) this.flows.set(id, next);
    return refusal;
  }

  /** Gives edge `id` a label of its kind that reads `text`, where its label stands, or none for
   *  `null`; Comb's refusal where it refused it. */
  private relabel(id: string, text: string | null): Refusal | undefined {
    const current = labelIn(this.edge(id));
    const kind = this.kinds.get(id)!;
    return this.updateLabel(id, text === null ? null : labelOf(kind, text, current));
  }

  /** Gives node `id` what `patch` sets, its content or the names of its regions; Comb's refusal
   *  where it refused it. */
  private patchNode(id: string, patch: NodePatch): Refusal | undefined {
    try {
      this.comb.updateNode(id, patch);
    } catch (error) {
      // Content or a name past Comb's limits, such as a text longer than one may be: the node
      // keeps its content and its regions, and its classifier or its state what it held.
      console.warn("uml: the edit was not taken", error);
      return { error };
    }
    return undefined;
  }

  /** The kinds the sidebar's kind select offers edge `id`: the descriptor's, or those the legend
   *  lists, each where the rules allow it between the edge's ends. */
  offeredKinds(id: string): RelationshipKind[] {
    const edge = this.edge(id);
    const kinds = this.descriptor.kinds ?? KINDS;
    // The kind select shows on an edge between two nodes alone.
    return kinds.filter((kind) => this.refusal(edge!.source!, edge!.target!, kind) === undefined);
  }

  /** Changes edge `id` to `kind`, drawn as the kind is, its label as `patchOf` says, and its kind
   *  once Comb took the change; an edge that leaves the descriptor's conditioned kind loses its
   *  condition, the comments anchored on it, which Comb removes with their anchors. The sidebar
   *  offers only the kinds the rules allow between the edge's ends (`offeredKinds`), so this asks
   *  no rule. */
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
    const { conditioned } = this.descriptor;
    if (from === conditioned && kind !== conditioned) this.removeAnchoredOn(id);
  }

  /** Asks Comb to remove the comments anchored on edge `id`, and with them their anchors; the
   *  copy follows the change Comb tells. */
  private removeAnchoredOn(id: string): void {
    // Only an anchor ends on an edge in the example's diagrams.
    const comments = this.graph.edges.flatMap((edge) =>
      edge.targetEdge === id && edge.source !== undefined ? [edge.source] : [],
    );
    if (comments.length === 0) return;
    try {
      this.comb.removeNodes(comments);
    } catch (error) {
      // A lost engine: the condition stays with the canvas that keeps its last frame.
      console.warn("uml: the condition was not removed", error);
    }
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

  /** The nodes that go with node `id` and with no other: a point's or a pin's name, an expansion
   *  node's outer rectangles. */
  private companionsOf(id: string): string[] {
    const [state, activity] = [this.states.get(id), this.activities.get(id)];
    if (state) return nameOf(state) ? [nameNodeId(id)] : [];
    return activity ? companionsOf(activity) : [];
  }

  /** Drops the nodes, their classifiers, states, or activity nodes, and the edges a removal
   *  names; and asks Comb, once the change is told, to remove what went with each node removed and
   *  is left, a point's or a pin's name and an expansion node's outer rectangles. */
  removed(nodes: readonly string[], edges: readonly string[]): void {
    const [goneNodes, goneEdges] = [new Set(nodes), new Set(edges)];
    const names = nodes
      .flatMap((id) => this.companionsOf(id))
      .filter((name) => !goneNodes.has(name) && this.node(name));
    this.graph.nodes = this.graph.nodes.filter(({ id }) => !goneNodes.has(id));
    this.graph.edges = this.graph.edges.filter(({ id }) => !goneEdges.has(id));
    for (const id of nodes) {
      this.classifiers.delete(id);
      this.states.delete(id);
      this.activities.delete(id);
      this.useCases.delete(id);
    }
    for (const id of edges) {
      this.kinds.delete(id);
      this.transitions.delete(id);
      this.flows.delete(id);
    }
    if (names.length > 0)
      // After the change that removed the point is told: Comb takes no edit from inside a listener.
      queueMicrotask(() => {
        try {
          this.comb.removeNodes(names);
        } catch (error) {
          // A lost engine: the name stays with the canvas that keeps its last frame.
          console.warn("uml: what went with a removed node was not removed", error);
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

  /** Whether the user may delete `nodes`: what goes with a node, a point's or a pin's name and an
   *  expansion node's outer rectangles, goes only with it. */
  deletable(nodes: readonly string[]): boolean {
    const gone = new Set(nodes);
    const owners = [...this.states.keys(), ...this.activities.keys()];
    return nodes.every((id) => {
      const owner = owners.find((each) => this.companionsOf(each).includes(id));
      return owner === undefined || gone.has(owner);
    });
  }

  /** Adds `edge`; one without a kind, as the user connects it, becomes the kind a connection
   *  between its ends adds, docked as the descriptor says. A transition or a flow has no record of
   *  its parts until the sidebar first edits them. */
  added(edge: AddedEdge): void {
    this.graph.edges.push({ ...edge });
    if (this.kinds.has(edge.id)) return;
    const { docking } = this.descriptor;
    // The user connects nodes alone (API-edges-dock-nodes-or-edges), so both ends are nodes.
    const connected = this.connectedKind(edge.source!, edge.target!);
    this.kinds.set(edge.id, connected);
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

/** The box of the last region of `path`, the regions from those `node` is divided into down to
 *  it, each in the box of the one before, `inner` the part of `node`'s box below its content. The
 *  example divides every node it divides by `divide`, and a region within a region the same
 *  way. */
function pathBox(inner: Box, { node, path }: { node: NodeData; path: RegionData[] }): Box {
  let [box, divide, regions] = [inner, node.divide!, node.regions!];
  for (const region of path) {
    const own = regionBox(box, divide, regions, region.id);
    if (region === path.at(-1)) return own;
    box = bandless(own, divide, region.name);
    [divide, regions] = [region.divide!, region.regions!];
  }
  return box;
}

/** `box`, the box of a region named `name` among regions divided `divide`, without its band: at
 *  its top where the regions lie side by side, at its left where they lie one above the other;
 *  whole where it has no name (ARCH-regions-are-container-slots). */
function bandless(box: Box, divide: string, name: string | undefined): Box {
  if (name === undefined) return box;
  return divide === "across"
    ? { ...box, y: box.y + BAND, height: box.height - BAND }
    : { ...box, x: box.x + BAND, width: box.width - BAND };
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
