// The edits of the graph: every method of `Comb` that changes it, and the user's connection and
// deletion, each run through `edit`, which holds their order (Q-7,
// API-edits-report-division-moves, ARCH-one-workspace-per-example); and `heightOf`, which reads
// and checks as `addNode` does and changes nothing (REN-node-content-and-hits). Refuse once the
// engine is lost; read the host's input once, whole, into plain data; refuse what the store's map
// shows, as it stands after the read, since a getter of the input is the host's code and may have
// changed the graph through `Comb`; check the code units of identifiers the graph would hold; have
// the bridge check the plain data and the engine apply it; and have the store take the result and
// record the change, by whom it names. The user's edits come after the host application's veto,
// asked here for each, the connection, the deletion, and the move into a container, and a veto
// during whose call the store records a change, which Comb tells to `onChange`, ends its gesture
// with nothing done (API-edits-report-division-moves).
import {
  NO_SLOT,
  refuseIfLost,
  type Bridge,
  type GraphDataProblem,
  type PlainPatch,
  type RegionRead,
  type SlotError,
} from "../bridge";
import type { Connect, ContainerMove, Delete, Deletion, MoveInto, Proposal } from "../interaction";
import type {
  By,
  EdgeData,
  EdgePatch,
  GraphData,
  GraphState,
  GraphStore,
  NodeContent,
  NodeShape,
  NodeData,
  NodePatch,
  Divided,
  KeptEdge,
} from "../store";
import { labelUnits } from "../store";
import {
  edgePatchOf,
  edgeSnapshotOf,
  idListOf,
  idsOf,
  isUnreadable,
  listsOf,
  nodeSnapshotOf,
  patchOf,
  snapshotOf,
  type Limits,
} from "./snapshot";

/** Graph data Comb refused in a method that changes the graph, with what was wrong and where:
 *  `problem`, whose `kind` tells which of the generated `GraphDataProblem`s it is. */
export class GraphDataError extends Error {
  constructor(readonly problem: GraphDataProblem) {
    super(`comb: malformed graph data (${problem.kind})`);
    this.name = "GraphDataError";
  }
}

/** Has the bridge check the lengths of the lists an input holds, before any item is read. */
type Sized = (nodes: number, edges: number) => void;

/** One edit of the graph, by the steps `edit` takes in order. `P` is the plain data the input
 *  is read into, `R` what of it the bridge takes once the map has been asked, and `T` what the
 *  bridge returns. */
interface Edit<P, R, T> {
  /** Reads the host's input once, whole, into plain data; `sized` checks a list's length. */
  read(sized: Sized): P;
  /** Refuses what the map of `state` shows of `plain`, and returns what the bridge takes, or
   *  nothing for an edit that changes nothing and tells nothing. */
  resolve(plain: P, state: GraphState): R | undefined;
  /** The code units of every identifier the graph would hold after the edit, for one that brings
   *  identifiers in. */
  idUnits?(plain: P, state: GraphState): number;
  /** Has the bridge check `resolved` and the engine apply it. */
  engine(resolved: R): T;
  /** Has the store take what the engine applied and record the change. */
  record(state: GraphState, resolved: R, result: T): void;
}

/** Whether `error` is a refusal the bridge produced: a plain object with a `kind`. */
function isRefusal(error: unknown): error is GraphDataProblem | SlotError {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.getPrototypeOf(error) === Object.prototype &&
    typeof (error as { kind?: unknown }).kind === "string"
  );
}

/** Whether a problem of the bridge's is a `SlotError`: a slot the shell named that holds no node
 *  or no edge, a mistake of Comb's own, never one of graph data. */
function isSlotError(error: GraphDataProblem | SlotError): error is SlotError {
  return error.kind === "noNode" || error.kind === "noEdge";
}

/** Calls the bridge with plain data; what it refuses of the data becomes a `GraphDataError`. A
 *  `SlotError` is the shell's mistake and becomes an `Error` naming the slot, as does any other
 *  error, such as the `EngineLostError` of a trap, which is thrown on as it is. */
function checked<T>(check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (isRefusal(error)) {
      if (!isSlotError(error)) throw new GraphDataError(error);
      const item = error.kind === "noNode" ? "node" : "edge";
      throw new Error(`comb: the engine holds no ${item} in slot ${error.slot}`, { cause: error });
    }
    throw error instanceof Error ? error : new Error("comb: the engine failed");
  }
}

/** Reads the host's input with `read`, in JavaScript, before the store or the bridge sees it;
 *  what reading throws (graph data that is not an object, nodes that are not a list, a getter
 *  that throws) refuses it as malformed. The message is Comb's own: a value the host application
 *  threw is not read. A length `sized` refuses is thrown on as the bridge's refusal. */
function readOnce<P>(bridge: Bridge, read: (sized: Sized) => P): P {
  let refusal: { error: unknown } | undefined;
  const sized: Sized = (nodes, edges) => {
    try {
      checked(() => bridge.checkGraphSize(nodes, edges));
    } catch (error) {
      refusal = { error };
      throw error;
    }
  };
  try {
    return read(sized);
  } catch (error) {
    if (refusal && error === refusal.error) throw error;
    const message = isUnreadable(error) ? error.message : "comb: graph data could not be read";
    throw new GraphDataError({ kind: "malformed", message });
  }
}

/** Runs the edit `step` on `store` through `bridge`, in the order Q-7 rests on: the input is read
 *  whole before the map is asked, so that the map shows every change a getter made. */
function edit<P, R, T>(store: GraphStore, bridge: Bridge, step: Edit<P, R, T>): void {
  refuseIfLost();
  const plain = readOnce(bridge, (sized) => step.read(sized));
  const state = store.getState();
  const resolved = step.resolve(plain, state);
  if (resolved === undefined) return;
  if (step.idUnits) {
    const units = step.idUnits(plain, state);
    checked(() => bridge.checkIdBudget(units));
  }
  const result = checked(() => step.engine(resolved));
  step.record(store.getState(), resolved, result);
}

/** What one Comb's edits need: its store, its bridge, the bridge's limits, and whether the host
 *  application allows loops (API-edges-dock-nodes-or-edges). */
interface Editing {
  readonly store: GraphStore;
  readonly bridge: Bridge;
  readonly limits: Limits;
  readonly loops: boolean;
}

/** `load`: the graph data read once, its lists' lengths checked before any item is, and handed
 *  to the engine, its nodes as columns; the store takes the same nodes and edges with the code
 *  units its snapshot counted. */
function load({ store, bridge, limits }: Editing, graph: GraphData): void {
  edit(store, bridge, {
    read(sized) {
      const lists = listsOf(graph);
      sized(lists.nodeCount, lists.edgeCount);
      return snapshotOf(lists, limits);
    },
    resolve: (plain) => plain,
    idUnits: (plain) => plain.idUnits,
    engine({ snapshot, content }) {
      // A load whose texts of content pass the budget the snapshot stopped reading at, refused
      // naming the node that passed it before anything crosses.
      if (content.past !== undefined) {
        bridge.checkContentBudget(content.units, content.past);
        // A snapshot read short is never loaded, whatever the bridge's budget holds.
        throw { kind: "malformed", message: "comb: graph data was read short of its content" };
      }
      return bridge.loadGraph(snapshot);
    },
    record: (state, { kept, idUnits }) => state.load(kept, idUnits),
  });
}

/** `heightOf`: the content, width, and node shape read once as the node `addNode` reads, named
 *  `""` and at the origin, and checked by the bridge as `addNode` checks it; the graph is not
 *  asked and nothing changes (REN-node-content-and-hits, REN-node-shapes-cover-uml). */
function heightOf(
  { bridge, limits }: Editing,
  content: unknown,
  width: unknown,
  shape: unknown,
): number {
  refuseIfLost();
  const { snapshot } = readOnce(bridge, () =>
    nodeSnapshotOf({ id: "", x: 0, y: 0, width, shape, content }, limits),
  );
  return checked(() => bridge.heightOf(snapshot));
}

/** `updateNode`: a node the graph does not hold refused, and the patch merged once the bridge
 *  has checked it and the engine laid the node's new content out (REN-node-content-and-hits). */
function updateNode({ store, bridge, limits }: Editing, id: string, patch: unknown): void {
  edit(store, bridge, {
    read: () => patchOf(patch, limits),
    resolve(plain, state) {
      const slot = nodeSlotOf(state, id);
      if (slot === undefined) throw new GraphDataError({ kind: "unknownNode", node: id });
      const divides = "regions" in plain || "divide" in plain;
      const old = divides ? [...bridge.regionsOf(slot)] : [];
      const kept = divides ? keptOf(plain.regions, old, state) : new Uint32Array();
      return { slot, plain, old, kept, held: divides ? heldIn(id, old, state) : [] };
    },
    idUnits(plain, state) {
      const old = [...bridge.regionsOf(state.slots.get(id)!)];
      const before = old.reduce((units, slot) => units + state.nodes[slot]!.id.length, 0);
      return state.idUnits - before + idsIn(plain.regions).reduce((n, i) => n + i.length, 0);
    },
    engine: ({ slot, plain, kept }) => bridge.updateNode(slot, id, plain, kept),
    record: (state, { slot, plain, old, held }, removal) => {
      const divided = old.length > 0 || "regions" in plain || "divide" in plain;
      // What went with a region the patch left out goes as the host's removal, before the change
      // of the node (ARCH-regions-are-container-slots, *Removing a region*).
      const content = [...removal.nodes].some((s) => !state.nodes[s]?.region);
      if (content || removal.edges.length > 0)
        state.removeNodes([...removal.nodes], [...removal.edges], "host");
      const after = store.getState();
      const anew = divided ? dividedAnew(plain, after, bridge, slot, old) : undefined;
      after.updateNode({ id, patch: plain, divided: anew });
      // What the division moved into another region, where the engine put it, the host's move.
      for (const { node, into } of movedBy(bridge, store.getState(), held))
        store.getState().nodeMoved(node, into, "host");
      // The regions moved, or a border node, which a query the scene keeps does not survive.
      if (divided || "side" in plain || "offset" in plain) store.getState().positionsMoved();
    },
  });
}

/** How the patch `plain` divided the node in `slot` anew, which held the regions in `old`: in
 *  the direction it names or the node has, into its regions, which the engine took into the
 *  slots it names (ARCH-regions-are-container-slots). */
function dividedAnew(
  plain: PlainPatch,
  state: GraphState,
  bridge: Bridge,
  slot: number,
  old: readonly number[],
): Divided {
  return {
    divide: plain.divide ?? state.nodes[slot]!.divide,
    regions: (plain.regions || []) as RegionRead[],
    slots: [...bridge.regionsOf(slot)],
    old,
  };
}

/** The slot of the node `id` in the map of `state`, none where it holds none or `id` names a
 *  region, which is no node of the host application's (ARCH-regions-are-container-slots). */
function nodeSlotOf(state: GraphState, id: string): number | undefined {
  const slot = state.slots.get(id);
  return slot === undefined || state.nodes[slot]!.region ? undefined : slot;
}

/** The identifiers of `regions`, read into one list; none where they are no list. */
function idsIn(regions: unknown): string[] {
  if (!Array.isArray(regions)) return [];
  return (regions as RegionRead[]).map(({ id }) => id);
}

/** The nodes that lie directly in the node `id` or in one of its regions `old`, no regions, each
 *  with the identifier of what holds it: what a division anew may move into another region. */
function heldIn(
  id: string,
  old: readonly number[],
  state: GraphState,
): { node: string; from: string }[] {
  const holders = new Set([id, ...old.map((slot) => state.nodes[slot]!.id)]);
  const held: { node: string; from: string }[] = [];
  for (const node of state.nodes)
    if (node && !node.region && node.container !== undefined && holders.has(node.container))
      held.push({ node: node.id, from: node.container });
  return held;
}

/** Of `held`, the nodes a division anew left in the graph in another container than the one that
 *  held them, each with the region the engine put it in (`containerOf`), as `state` names it once
 *  it took the division: what a kept region divided anew held, which goes into its first region
 *  (the human's decision of 2026-11-18), and what the node held directly, which goes into the
 *  region at its position, else the first (the maintainer's decisions of 2026-11-25,
 *  ARCH-regions-are-container-slots). One rule, the engine's, for both. */
function movedBy(
  bridge: Bridge,
  state: GraphState,
  held: readonly { node: string; from: string }[],
): { node: string; into: string }[] {
  const moved: { node: string; into: string }[] = [];
  for (const { node, from } of held) {
    const slot = state.slots.get(node);
    if (slot === undefined) continue;
    const container = bridge.containerOf(slot);
    const into = container === undefined ? undefined : state.nodes[container]?.id;
    if (into !== undefined && into !== from) moved.push({ node, into });
  }
  return moved;
}

/** Per region of the patch `regions`, depth first, the slot of the region of its identifier in
 *  `old`, the regions the node has, or `NO_SLOT`; refuses, as a load refuses it, an identifier the
 *  graph holds for anything else (ARCH-regions-are-container-slots, *Identifiers*). */
function keptOf(regions: unknown, old: readonly number[], state: GraphState): Uint32Array {
  const own = new Set(old);
  return Uint32Array.from(idsIn(regions), (region) => {
    const slot = state.slots.get(region);
    if (slot === undefined) return NO_SLOT;
    if (!own.has(slot)) throw new GraphDataError({ kind: "duplicateNode", node: region });
    return slot;
  });
}

/** The slot of the container the node `snapshot` names in the map of `state`, `NO_SLOT` where
 *  the map holds no such identifier, or none on the canvas. The bridge crate refuses a container
 *  by the one rule a load refuses it by, `NO_SLOT` as no node of the graph
 *  (API-edits-report-division-moves), and a container that is no string by its field. */
function containerSlotOf(snapshot: unknown, state: GraphState): number | undefined {
  const { container } = snapshot as { container?: unknown };
  if (typeof container !== "string") return undefined;
  return state.slots.get(container) ?? NO_SLOT;
}

/** The slot of the node the border node `snapshot` names by its `attachedTo` in the map of
 *  `state`, or none where it names none; refuses one the graph does not hold, a region among
 *  them, as `missingNode`, as an edge's end is (ARCH-border-nodes-ride-sides). An `attachedTo`
 *  that is no string the bridge refuses by its field. */
function attachedOf(snapshot: unknown, state: GraphState): number | undefined {
  const { id, attachedTo } = snapshot as { id?: unknown; attachedTo?: unknown };
  if (typeof attachedTo !== "string") return undefined;
  const slot = nodeSlotOf(state, attachedTo);
  if (slot !== undefined) return slot;
  const borderNode = typeof id === "string" ? id : "";
  throw new GraphDataError({ kind: "missingNode", borderNode, node: attachedTo });
}

/** `addNode`: an identifier the map holds already refused; the bridge refuses a container that
 *  cannot hold the node, one the map does not hold among them; the engine chooses the slot the
 *  store keeps the node in, and places it relative to its container
 *  (ARCH-engine-edits-nested-graph). */
function addNode({ store, bridge, limits }: Editing, node: unknown): void {
  edit(store, bridge, {
    read: () => nodeSnapshotOf(node, limits),
    resolve(plain, state) {
      const { id, regions } = plain.snapshot as { id?: unknown; regions?: unknown };
      // Its regions' identifiers share the space of the nodes' (ARCH-regions-are-container-slots).
      for (const named of [id, ...idsIn(regions)])
        if (typeof named === "string" && state.slots.has(named))
          throw new GraphDataError({ kind: "duplicateNode", node: named });
      const attached = attachedOf(plain.snapshot, state);
      return { ...plain, container: containerSlotOf(plain.snapshot, state), attached };
    },
    idUnits: (plain, state) => state.idUnits + plain.idUnits,
    engine: ({ snapshot, container, attached }) => bridge.addNode(snapshot, container, attached),
    // The bridge took the node, so each field holds a value of its type.
    record: (state, { snapshot }, slot) => {
      const regions = [...bridge.regionsOf(slot)];
      // The bridge took the regions, each of its fields of its type, in one list.
      const read = ((snapshot as { regions?: unknown }).regions ?? []) as RegionRead[];
      state.addNode(snapshot as unknown as NodeData, slot, { read, slots: regions });
      // Regions laid out in the engine, which a query the scene keeps does not survive.
      if (regions.length > 0) store.getState().positionsMoved();
    },
  });
}

/** The slots of the ends of the edge `snapshot` names in the maps of `state`, each of a node or,
 *  where it names an edge, of an edge, refusing an identifier the map holds already, an end it does
 *  not hold, and an end on the edge itself (API-edges-dock-nodes-or-edges, *Ends*). An identifier,
 *  source, or target that is no string, or longer than the limit, and an end that names both a
 *  node and an edge, the bridge refuses before the maps are asked, as a load refuses them before
 *  any end is resolved. */
function endsOf(snapshot: unknown, state: GraphState, limits: Limits): [number, number] {
  const edge = snapshot as Record<string, unknown>;
  const named = (value: unknown): value is string =>
    typeof value === "string" && value.length <= limits.id;
  const given = (value: unknown) => value !== undefined && value !== null;
  const ends = (["source", "target"] as const).map((end) => {
    const onEdge = given(edge[`${end}Edge`]);
    const other = onEdge ? edge[end] : edge[`${end}Edge`];
    return { end, onEdge, named: edge[onEdge ? `${end}Edge` : end], alone: !given(other) };
  });
  const { id } = edge;
  if (!(named(id) && ends.every((e) => named(e.named) && e.alone))) return [0, 0];
  if (state.edgeSlots.has(id)) throw new GraphDataError({ kind: "duplicateEdge", edge: id });
  const [source, target] = ends.map(({ end, onEdge, named: on }) => {
    const other = on as string;
    if (!onEdge) {
      const slot = nodeSlotOf(state, other);
      if (slot === undefined)
        throw new GraphDataError({ kind: "missingNode", edge: id, node: other });
      return slot;
    }
    if (other === id)
      throw new GraphDataError({ kind: "invalidEdgeEnd", edge: id, end: `${end}Edge` });
    const slot = state.edgeSlots.get(other);
    if (slot === undefined)
      throw new GraphDataError({ kind: "missingEdge", edge: id, missing: other });
    return slot;
  });
  return [source!, target!];
}

/** `addEdge`, and the user's connection, as `by` makes it: the edge added between the slots of
 *  its ends (ARCH-engine-edits-nested-graph), a loop only where the host application allows loops
 *  (API-edges-dock-nodes-or-edges). */
function addEdge({ store, bridge, limits, loops }: Editing, edge: unknown, by: By): void {
  edit(store, bridge, {
    read: () => edgeSnapshotOf(edge, limits),
    resolve: (plain, state) => ({ ...plain, ends: endsOf(plain.snapshot, state, limits) }),
    idUnits: (plain, state) => state.idUnits + plain.idUnits,
    engine: ({ snapshot, ends: [from, to] }) => bridge.addEdge(snapshot, from, to, loops),
    // The bridge took the edge, so each field holds a value of its type.
    record: (state, { snapshot }, slot) => state.addEdge(snapshot as unknown as KeptEdge, slot, by),
  });
}

/** `updateEdge`: an edge the graph does not hold refused, and the patch merged once the bridge
 *  has checked every field of it; a patch that sets nothing changes and tells nothing. Its labels
 *  replace the edge's whole list, and their identifiers count against the budget of identifiers in
 *  place of the old ones' (API-edges-dock-nodes-or-edges). */
function updateEdge({ store, bridge, limits }: Editing, id: string, patch: unknown): void {
  edit(store, bridge, {
    read: () => edgePatchOf(patch, limits),
    resolve(plain, state) {
      const slot = state.edgeSlots.get(id);
      if (slot === undefined) throw new GraphDataError({ kind: "unknownEdge", edge: id });
      return Object.keys(plain).length === 0 ? undefined : { slot, plain };
    },
    idUnits(plain, state) {
      if (!Array.isArray(plain.labels) && plain.labels !== null) return state.idUnits;
      const before = labelUnits(state.edges[state.edgeSlots.get(id)!]!.labels);
      const ids = (plain.labels ?? []) as readonly { id?: unknown }[];
      const after = ids.reduce((n, l) => n + (typeof l.id === "string" ? l.id.length : 0), 0);
      return state.idUnits - before + after;
    },
    engine: ({ slot, plain }) => bridge.updateEdge(slot, id, plain),
    record: (state, { plain }) => state.updateEdge(id, plain as unknown as EdgePatch),
  });
}

/** The identifier list `ids` read once, its length checked by `size` before any identifier is
 *  read; `name` names the list in a refusal. */
function idListRead(
  ids: unknown,
  name: string,
  limits: Limits,
  size: (count: number) => void,
): string[] {
  const listed = idListOf(ids, name);
  size(listed.count);
  return idsOf(listed.list, listed.count, name, limits);
}

/** The slots of `ids` in `map`, each once, in the order first named, or nothing where `ids` names
 *  none; refuses, before anything is removed, an identifier the map does not hold with the problem
 *  `unknown` makes of it. */
function slotsOf(
  ids: readonly string[],
  map: ReadonlyMap<string, number> | ((id: string) => number | undefined),
  unknown: (id: string) => GraphDataProblem,
): Uint32Array | undefined {
  const slots = new Set<number>();
  for (const id of ids) {
    const slot = typeof map === "function" ? map(id) : map.get(id);
    if (slot === undefined) throw new GraphDataError(unknown(id));
    slots.add(slot);
  }
  return slots.size === 0 ? undefined : Uint32Array.from(slots);
}

/** `removeNodes`, and the user's deletion of nodes, as `by` makes it: the nodes `ids` removed with
 *  everything they hold and every edge at any of them, which the engine names
 *  (ARCH-engine-edits-nested-graph). An identifier the graph does not hold is refused, and a list
 *  that names none changes and tells nothing. */
function removeNodes({ store, bridge, limits }: Editing, ids: unknown, by: By): void {
  edit(store, bridge, {
    read: (sized) => idListRead(ids, "node identifiers", limits, (count) => sized(count, 0)),
    resolve: (read, state) =>
      slotsOf(
        read,
        (node) => nodeSlotOf(state, node),
        (node) => ({ kind: "unknownNode", node }),
      ),
    engine: (slots) => bridge.removeNodes(slots),
    record: (state, _, { nodes, edges }) => state.removeNodes([...nodes], [...edges], by),
  });
}

/** `removeEdges`, and the user's deletion of edges, as `by` makes it: the edges `ids` removed, as
 *  `removeNodes` removes nodes. */
function removeEdges({ store, bridge, limits }: Editing, ids: unknown, by: By): void {
  edit(store, bridge, {
    read: (sized) => idListRead(ids, "edge identifiers", limits, (count) => sized(0, count)),
    resolve: (read, state) =>
      slotsOf(read, state.edgeSlots, (edge) => ({ kind: "unknownEdge", edge })),
    engine: (slots) => bridge.removeEdges(slots),
    // The engine removed every edge that ends on one named too (API-edges-dock-nodes-or-edges).
    record: (state, _, removed) => state.removeEdges([...removed], by),
  });
}

/** The host application's vetoes of the user's connection, deletion, and move into a container
 *  (API-edits-report-division-moves). */
export interface Vetoes {
  readonly canConnect?: ((proposal: Proposal) => unknown) | undefined;
  readonly canDelete?: ((deletion: Deletion) => unknown) | undefined;
  readonly canMoveInto?: ((move: ContainerMove) => unknown) | undefined;
}

/** What the veto `ask` answers, or `undefined` where the store recorded a change of the graph
 *  during its call, a change Comb tells to `onChange`: its answer was given about a graph that is
 *  gone, so the gesture ends with nothing done, and no error (API-edits-report-division-moves).
 *  An error it throws is
 *  thrown on. */
function answerOf(store: GraphStore, ask: () => unknown): unknown {
  const before = store.getState().change;
  const answer = ask();
  return store.getState().change === before ? answer : undefined;
}

/** The user's move of a node into a container, or onto the canvas, after the host application's
 *  `canMoveInto`, without which it is allowed: the engine puts the node there at the world
 *  position it has, and the store records `nodeMoved` with its container
 *  (API-edits-report-division-moves). */
function moveIntoOf({ store, bridge }: Editing, canMoveInto: Vetoes["canMoveInto"]): MoveInto {
  return ({ node, container }) => {
    if (canMoveInto && answerOf(store, () => canMoveInto({ node, container })) !== true)
      return false;
    // No change was told during the veto's call, so the slots looked up now are the node's and
    // the container's.
    const { slots, nodeMoved } = store.getState();
    bridge.moveInto(slots.get(node)!, container === null ? undefined : slots.get(container));
    nodeMoved(node, container);
    return true;
  };
}

/** The edits of one Comb on `store` through `bridge`: `host`, the methods of `Comb` that change
 *  the graph, and `user`, the user's connection, deletion, and move into a container after the
 *  host's `vetoes`, which
 *  interaction is handed; `connect` none without `canConnect`, since Comb has no name to give the
 *  edge. Each adds a loop only where `loops` allows loops (API-edges-dock-nodes-or-edges). */
export function editorsOf(
  store: GraphStore,
  bridge: Bridge,
  limits: Limits,
  vetoes: Vetoes,
  loops: boolean,
) {
  const editing: Editing = { store, bridge, limits, loops };
  const host = {
    load: (graph: GraphData) => load(editing, graph),
    updateNode: (id: string, patch: NodePatch) => updateNode(editing, id, patch),
    addNode: (node: NodeData) => addNode(editing, node),
    heightOf: (content: NodeContent, width: number, shape?: NodeShape) =>
      heightOf(editing, content, width, shape),
    addEdge: (edge: EdgeData) => addEdge(editing, edge, "host"),
    updateEdge: (id: string, patch: EdgePatch) => updateEdge(editing, id, patch),
    removeNodes: (ids: readonly string[]) => removeNodes(editing, ids, "host"),
    removeEdges: (ids: readonly string[]) => removeEdges(editing, ids, "host"),
  };
  const { canConnect, canDelete } = vetoes;
  // The veto is handed copies, so that one that writes into what it is asked about changes
  // nothing that goes.
  const connect: Connect | undefined =
    canConnect &&
    (({ source, sourceSide, target, targetSide }) => {
      const id = answerOf(store, () => canConnect({ source, sourceSide, target, targetSide }));
      if (typeof id !== "string") return;
      addEdge(editing, { id, source, target, sourceSide, targetSide }, "user");
    });
  const deletion: Delete = ({ nodes, edges }) => {
    if (
      canDelete &&
      answerOf(store, () => canDelete({ nodes: [...nodes], edges: [...edges] })) !== true
    )
      return;
    if (nodes.length > 0) removeNodes(editing, nodes, "user");
    else removeEdges(editing, edges, "user");
  };
  const moveInto = moveIntoOf(editing, vetoes.canMoveInto);
  return { host, user: { connect, delete: deletion, moveInto } };
}
