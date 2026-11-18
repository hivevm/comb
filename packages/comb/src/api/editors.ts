// The edits of the graph: every method of `Comb` that changes it, and the user's connection and
// deletion, each run through `edit`, which holds their order (Q-7,
// API-edits-reported-as-typed-changes, ARCH-one-workspace-per-example); and `heightOf`, which reads
// and checks as `addNode` does and changes nothing (API-host-asks-content-height). Refuse once the
// engine is lost; read the host's input once, whole, into plain data; refuse what the store's map
// shows, as it stands after the read, since a getter of the input is the host's code and may have
// changed the graph through `Comb`; check the code units of identifiers the graph would hold; have
// the bridge check the plain data and the engine apply it; and have the store take the result and
// record the change, by whom it names. The user's edits come after the host application's veto,
// asked here for each, the connection, the deletion, and the move into a container, and a veto
// during whose call the store records a change, which Comb tells to `onChange`, ends its gesture
// with nothing done (API-edits-reported-as-typed-changes, API-edits-report-nested-changes).
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
  NodeView,
  Divided,
  KeptGraph,
} from "../store";
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
 *  application allows loops (API-edges-dock-side-or-outline). */
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
    record: (state, { kept, idUnits }) => state.load(widened(kept, bridge), idUnits),
  });
}

/** `kept` with each node divided into regions as wide as the engine made it to hold them
 *  (ARCH-regions-are-container-slots). */
function widened(kept: KeptGraph, bridge: Bridge): KeptGraph {
  if (!kept.nodes.some((node) => node.divide !== undefined)) return kept;
  const { sizes } = bridge.nodeBuffers();
  const nodes = kept.nodes.map((node, slot) =>
    node.divide === undefined ? node : { ...node, width: sizes[slot * 2]! },
  );
  return { ...kept, nodes };
}

/** `heightOf`: the content, width, and node shape read once as the node `addNode` reads, named
 *  `""` and at the origin, and checked by the bridge as `addNode` checks it; the graph is not
 *  asked and nothing changes (API-host-asks-content-height, REN-closed-set-of-node-shapes). */
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
 *  has checked it and the engine laid the node's new content out (REN-node-content-in-rows). */
function updateNode({ store, bridge, limits }: Editing, id: string, patch: unknown): void {
  edit(store, bridge, {
    read: () => patchOf(patch, limits),
    resolve(plain, state) {
      const slot = nodeSlotOf(state, id);
      if (slot === undefined) throw new GraphDataError({ kind: "unknownNode", node: id });
      const divides = "regions" in plain || "divide" in plain;
      const old = divides ? [...bridge.regionsOf(slot)] : [];
      const kept = divides ? keptOf(plain.regions, old, state) : new Uint32Array();
      return { slot, plain, old, kept, moving: movingOf(plain.regions, kept, state) };
    },
    idUnits(plain, state) {
      const old = [...bridge.regionsOf(state.slots.get(id)!)];
      const before = old.reduce((units, slot) => units + state.nodes[slot]!.id.length, 0);
      return state.idUnits - before + idsIn(plain.regions).reduce((n, i) => n + i.length, 0);
    },
    engine: ({ slot, plain, kept }) => bridge.updateNode(slot, id, plain, kept),
    record: (state, { slot, plain, old, moving }, removal) => {
      const { height, resizable } = plain;
      const sizing = {
        ...("height" in plain ? { height } : {}),
        ...("resizable" in plain ? { resizable } : {}),
      };
      const divided = old.length > 0 || "regions" in plain || "divide" in plain;
      // What went with a region the patch left out goes as the host's removal, before the change
      // of the node (ARCH-regions-are-container-slots, *Removing a region*).
      const content = [...removal.nodes].some((s) => !state.nodes[s]?.region);
      if (content || removal.edges.length > 0)
        state.removeNodes([...removal.nodes], [...removal.edges], "host");
      const after = store.getState();
      const anew = divided ? dividedAnew(plain, after, bridge, slot, old) : undefined;
      after.updateNode(id, "content" in plain, sizing, anew);
      // What a kept region divided anew held now lies in its first region, the host's move.
      for (const { node, into } of moving) store.getState().nodeMoved(node, into, "host");
      // The regions moved, which a query the scene keeps does not survive.
      if (divided) store.getState().positionsMoved();
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
    width: bridge.nodeBuffers().sizes[slot * 2]!,
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

/** The nodes a kept region holds that the patch `regions` divides into regions of its own, each
 *  with the region it moves into: its first region, to any depth, by the human's decision of
 *  2026-11-18 (ARCH-regions-are-container-slots); `kept` names the region the node has per region
 *  of the patch. */
function movingOf(
  regions: unknown,
  kept: Uint32Array,
  state: GraphState,
): { node: string; into: string }[] {
  if (!Array.isArray(regions)) return [];
  const read = regions as RegionRead[];
  const first = new Map<number, number>();
  read.forEach(({ of }, i) => {
    if (of !== undefined && !first.has(of)) first.set(of, i);
  });
  const moving: { node: string; into: string }[] = [];
  kept.forEach((slot, i) => {
    if (slot === NO_SLOT || !first.has(i)) return;
    let leaf = i;
    while (first.has(leaf)) leaf = first.get(leaf)!;
    const from = state.nodes[slot]!.id;
    for (const node of state.nodes)
      if (node && !node.region && node.container === from)
        moving.push({ node: node.id, into: read[leaf]!.id });
  });
  return moving;
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

/** What `invalidContainer` says a node's container has to be, as a load says it
 *  (ARCH-engine-edits-nested-graph). */
const A_NODE_OF_THE_GRAPH = "the identifier of a node of the graph";
const A_MARKED_CONTAINER = "the identifier of a node marked isContainer";
const AN_UNDIVIDED =
  "the identifier of a container or a region, not of a node divided into regions";

/** What `invalidContainer` says a container has to be where `view` is none, or none where it may
 *  hold a node: a node or a region divided into regions holds its regions alone
 *  (ARCH-regions-are-container-slots, *Regions in a slot*). */
function refusedAs(view: NodeView | undefined): string | undefined {
  if (view === undefined) return A_NODE_OF_THE_GRAPH;
  if ((view.divide ?? view.region?.divide) !== undefined) return AN_UNDIVIDED;
  return view.isContainer === true ? undefined : A_MARKED_CONTAINER;
}

/** The slot of the container the node `snapshot` names in the map of `state`, or none on the
 *  canvas; refuses a container the graph does not hold, or one that is no container, as a load
 *  refuses it (API-edits-report-nested-changes). A container that is no string the bridge refuses
 *  by its field. */
function containerOf(snapshot: unknown, state: GraphState): number | undefined {
  const { id, container } = snapshot as { id?: unknown; container?: unknown };
  if (typeof container !== "string") return undefined;
  const slot = state.slots.get(container);
  const expected = refusedAs(slot === undefined ? undefined : state.nodes[slot]!);
  if (expected === undefined) return slot;
  const node = typeof id === "string" ? id : "";
  throw new GraphDataError({ kind: "invalidContainer", node, field: "container", expected });
}

/** `addNode`: an identifier the map holds already refused, and a container it does not hold as
 *  one; the engine chooses the slot the store keeps the node in, and places it relative to its
 *  container (ARCH-engine-edits-nested-graph). */
function addNode({ store, bridge, limits }: Editing, node: unknown): void {
  edit(store, bridge, {
    read: () => nodeSnapshotOf(node, limits),
    resolve(plain, state) {
      const { id, regions } = plain.snapshot as { id?: unknown; regions?: unknown };
      // Its regions' identifiers share the space of the nodes' (ARCH-regions-are-container-slots).
      for (const named of [id, ...idsIn(regions)])
        if (typeof named === "string" && state.slots.has(named))
          throw new GraphDataError({ kind: "duplicateNode", node: named });
      return { ...plain, container: containerOf(plain.snapshot, state) };
    },
    idUnits: (plain, state) => state.idUnits + plain.idUnits,
    engine: ({ snapshot, container }) => bridge.addNode(snapshot, container),
    // The bridge took the node, so each field holds a value of its type.
    record: (state, { snapshot }, slot) => {
      const regions = [...bridge.regionsOf(slot)];
      // The bridge took the regions, each of its fields of its type, in one list.
      const read = ((snapshot as { regions?: unknown }).regions ?? []) as RegionRead[];
      const { sizes } = bridge.nodeBuffers();
      // As wide as the engine made it to hold its regions.
      const taken = { ...(snapshot as unknown as NodeData), width: sizes[slot * 2]! };
      state.addNode(taken, slot, { read, slots: regions });
      // Regions laid out in the engine, which a query the scene keeps does not survive.
      if (regions.length > 0) store.getState().positionsMoved();
    },
  });
}

/** The slots of the ends of the edge `snapshot` names in the map of `state`, refusing an
 *  identifier the map holds already and an end it does not hold. An identifier, source, or target
 *  that is no string, or longer than the limit, the bridge refuses before the map is asked, as a
 *  load refuses it before any end is resolved. */
function endsOf(snapshot: unknown, state: GraphState, limits: Limits): [number, number] {
  const { id, source, target } = snapshot as { id?: unknown; source?: unknown; target?: unknown };
  const named = (value: unknown): value is string =>
    typeof value === "string" && value.length <= limits.id;
  if (!(named(id) && named(source) && named(target))) return [0, 0];
  if (state.edgeSlots.has(id)) throw new GraphDataError({ kind: "duplicateEdge", edge: id });
  const end = (node: string) => {
    const slot = nodeSlotOf(state, node);
    if (slot === undefined) throw new GraphDataError({ kind: "missingNode", edge: id, node });
    return slot;
  };
  return [end(source), end(target)];
}

/** `addEdge`, and the user's connection, as `by` makes it: the edge added between the slots of
 *  its ends (ARCH-engine-edits-graph-in-place), a loop only where the host application allows loops
 *  (API-edges-dock-side-or-outline). */
function addEdge({ store, bridge, limits, loops }: Editing, edge: unknown, by: By): void {
  edit(store, bridge, {
    read: () => edgeSnapshotOf(edge, limits),
    resolve: (plain, state) => ({ ...plain, ends: endsOf(plain.snapshot, state, limits) }),
    idUnits: (plain, state) => state.idUnits + plain.idUnits,
    engine: ({ snapshot, ends: [from, to] }) => bridge.addEdge(snapshot, from, to, loops),
    // The bridge took the edge, so each field holds a value of its type.
    record: (state, { snapshot }, slot) => state.addEdge(snapshot as unknown as EdgeData, slot, by),
  });
}

/** `updateEdge`: an edge the graph does not hold refused, and the patch merged once the bridge
 *  has checked every field of it; a patch that sets nothing changes and tells nothing. */
function updateEdge({ store, bridge, limits }: Editing, id: string, patch: unknown): void {
  edit(store, bridge, {
    read: () => edgePatchOf(patch, limits),
    resolve(plain, state) {
      const slot = state.edgeSlots.get(id);
      if (slot === undefined) throw new GraphDataError({ kind: "unknownEdge", edge: id });
      return Object.keys(plain).length === 0 ? undefined : { slot, plain };
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
    record: (state, slots) => state.removeEdges([...slots], by),
  });
}

/** The host application's vetoes of the user's connection, deletion, and move into a container
 *  (API-edits-reported-as-typed-changes, API-edits-report-nested-changes). */
export interface Vetoes {
  readonly canConnect?: ((proposal: Proposal) => unknown) | undefined;
  readonly canDelete?: ((deletion: Deletion) => unknown) | undefined;
  readonly canMoveInto?: ((move: ContainerMove) => unknown) | undefined;
}

/** What the veto `ask` answers, or `undefined` where the store recorded a change of the graph
 *  during its call, a change Comb tells to `onChange`: its answer was given about a graph that is
 *  gone, so the gesture ends with nothing done, and no error (API-edits-reported-as-typed-changes).
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
 *  (API-edits-report-nested-changes). */
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
 *  edge. Each adds a loop only where `loops` allows loops (API-edges-dock-side-or-outline). */
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
