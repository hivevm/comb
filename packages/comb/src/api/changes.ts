// How a change the store records reaches the host application: `GraphChange`, what `onChange`
// delivers, read from the store and the engine's buffer as copies no listener can reach into
// (API-edits-reported-as-typed-changes), and the listeners of `onChange` and `onSelectionChange`
// told from one subscription; and the listeners of `onContentClick`, told of each click on an
// element (REN-node-content-in-rows).
import { positionAt, type Bridge } from "../bridge";
import type { ContentClick } from "../interaction";
import {
  edgeNamed,
  type By,
  type EdgeData,
  type EdgeLabelData,
  type KeptLabel,
  type EdgePatch,
  type GraphState,
  type GraphStore,
  type NodeData,
  type NodePatch,
  type RegionData,
  type Selection,
  type Side,
  type StoreChange,
} from "../store";

/** The attributes `updateEdge` changes on an edge, as `edgeUpdated` reports them merged: its
 *  colour, arrowhead, lightning bolt, dash pattern or none, and labels, their places filled in,
 *  or none (API-edits-reported-as-typed-changes, API-edges-dock-nodes-or-edges). */
type EdgeChangePatch = {
  readonly [K in keyof EdgePatch]: K extends "labels"
    ? readonly Readonly<KeptLabel>[] | null
    : EdgePatch[K];
};

/** A region and its size along the direction of its division, as Comb keeps it now. */
export type RegionSize = { readonly id: string; readonly size: number };

/** One change of the graph, by its `kind` and by who made it, `"user"` or `"host"`, as
 *  `onChange` delivers it (API-edits-reported-as-typed-changes). */
export type GraphChange =
  /** `load` replaced the graph. */
  | { readonly kind: "loaded"; readonly by: "host" }
  /** `addNode` added `node`, as Comb took it. */
  | { readonly kind: "nodeAdded"; readonly by: "host"; readonly node: Readonly<NodeData> }
  /** `updateNode` changed the node `id` by `patch`, its content as Comb keeps it. */
  | {
      readonly kind: "nodeUpdated";
      readonly by: "host";
      readonly id: string;
      readonly patch: Readonly<NodePatch>;
    }
  /** A drag left the node `id` at `x`, `y`, relative to `container`, the identifier of the
   *  container it lies in, or on the canvas for `null` (API-edits-report-nested-changes); or, by
   *  the host, `updateNode` moved it into the first region of a region it divided anew
   *  (ARCH-regions-are-container-slots). */
  | {
      readonly kind: "nodeMoved";
      readonly by: By;
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly container: string | null;
    }
  /** A drag left the border node `id` on `side` of the node it rides, at `offset` along it
   *  (ARCH-border-nodes-ride-sides, API-edits-report-nested-changes). */
  | {
      readonly kind: "nodeMoved";
      readonly by: "user";
      readonly id: string;
      readonly side: Side;
      readonly offset: number;
    }
  /** A resize left the node `id` at `x`, `y`, relative to its container, `width` × `height`; of
   *  the nodes that lie directly in it, `moved` names each whose position relative to it changed,
   *  with that position, since a resize at the left or the top keeps them where they lie in the
   *  world (API-edits-report-nested-changes). */
  | {
      readonly kind: "nodeResized";
      readonly by: "user";
      readonly id: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly moved: readonly { readonly id: string; readonly x: number; readonly y: number }[];
      /** Its regions whose size the resize changed, each with its size now
       *  (ARCH-regions-are-container-slots). */
      readonly regions: readonly RegionSize[];
    }
  /** A drag of a line of the divided node `node` changed the sizes of its regions `regions`, and
   *  the positions relative to their region of the nodes `moved`, each with that position
   *  (ARCH-regions-are-container-slots, *Lines*). */
  | {
      readonly kind: "regionsMoved";
      readonly by: "user";
      readonly node: string;
      readonly regions: readonly RegionSize[];
      readonly moved: readonly { readonly id: string; readonly x: number; readonly y: number }[];
    }
  /** The nodes `nodes` were removed, and with them the edges `edges`. */
  | {
      readonly kind: "nodesRemoved";
      readonly by: By;
      readonly nodes: readonly string[];
      readonly edges: readonly string[];
    }
  /** The edge `edge` was added, as Comb keeps it, its defaults filled, its labels' places among
   *  them. */
  | {
      readonly kind: "edgeAdded";
      readonly by: By;
      readonly edge: Readonly<
        Omit<EdgeData, "labels"> &
          Required<Pick<EdgeData, "color" | "arrow" | "sourceSide" | "targetSide">> & {
            readonly labels?: readonly Readonly<KeptLabel>[];
          }
      >;
    }
  /** `updateEdge` changed the edge `id` by `patch`, as Comb merged it. */
  | {
      readonly kind: "edgeUpdated";
      readonly by: "host";
      readonly id: string;
      readonly patch: EdgeChangePatch;
    }
  /** The edges `edges` were removed. */
  | {
      readonly kind: "edgesRemoved";
      readonly by: By;
      readonly edges: readonly string[];
    }
  /** A drag left the label `label` of the edge `edge` at path parameter `t` and label offset
   *  `offset`; the edge's other labels stayed (API-edges-dock-nodes-or-edges). */
  | {
      readonly kind: "labelMoved";
      readonly by: "user";
      readonly edge: string;
      readonly label: string;
      readonly t: number;
      readonly offset: number;
    };

/** The change of an edge `change` names, as `onChange` delivers it: the edge as the store keeps
 *  it, its colour and arrowhead filled, or the patch as merged. */
function edgeDeliveryOf(
  change: Extract<StoreChange, { kind: "edgeAdded" | "edgeUpdated" }>,
  state: GraphState,
): GraphChange {
  if (change.kind === "edgeUpdated") {
    // Copies all down, so that no listener reaches into what the store keeps.
    const { dash, labels, ...patch } = change.patch;
    return {
      kind: change.kind,
      by: change.by,
      id: change.id,
      patch: {
        ...patch,
        ...(dash === undefined ? {} : { dash: dash && ([dash[0], dash[1]] as const) }),
        ...(labels === undefined ? {} : { labels: labels && copiedLabels(labels) }),
      },
    };
  }
  const { dash, labels, ...edge } = edgeNamed(state, change.id).edge;
  return {
    kind: change.kind,
    by: change.by,
    edge: {
      ...edge,
      color: edge.color!,
      arrow: edge.arrow!,
      sourceSide: edge.sourceSide!,
      targetSide: edge.targetSide!,
      ...(dash ? { dash: [dash[0], dash[1]] as const } : {}),
      ...(labels ? { labels: copiedLabels(labels) } : {}),
    },
  };
}

/** A copy of `labels` the store keeps, their places filled in, so that no listener reaches into
 *  it. */
function copiedLabels(labels: readonly EdgeLabelData[]): readonly KeptLabel[] {
  return labels.map((label) => ({ ...(label as KeptLabel) }));
}

/** The height the node in `slot` has, as the engine keeps it. */
function heightAt(bridge: Bridge, slot: number): number {
  return bridge.nodeBuffers().sizes[slot * 2 + 1]!;
}

/** The change `nodeUpdated` as `onChange` delivers it, with the content the engine keeps, built
 *  for this delivery, where the patch set it, the height the node has where it set one, raised
 *  where it was below its content's, and whether it is resizable where it set it. */
function nodeUpdatedOf(
  change: Extract<StoreChange, { kind: "nodeUpdated" }>,
  state: GraphState,
  bridge: Bridge,
): GraphChange {
  const slot = state.slots.get(change.id)!;
  const patch: NodePatch = change.content ? { content: bridge.content(slot) } : {};
  if (change.height) patch.height = heightAt(bridge, slot);
  if (change.resizable !== undefined) patch.resizable = change.resizable;
  if (change.outline !== undefined) patch.outline = change.outline;
  if (change.regions) {
    const { divide } = state.nodes[slot]!;
    if (divide !== undefined) patch.divide = divide;
    patch.regions = regionsAt(state, bridge, slot);
  }
  Object.assign(patch, placePatched(change, bridge, slot));
  return { kind: change.kind, by: change.by, id: change.id, patch };
}

/** What the patch of `change` set of the place of the border node in `slot`: its side, and its
 *  offset as the engine held it, told also where the patch set the side alone, since the engine
 *  holds the offset within the new side, so that the host's copy follows what Comb took
 *  (ARCH-border-nodes-ride-sides). */
function placePatched(
  change: Extract<StoreChange, { kind: "nodeUpdated" }>,
  bridge: Bridge,
  slot: number,
): Pick<NodePatch, "side" | "offset"> {
  const place = change.side || change.offset ? bridge.borderOf(slot) : undefined;
  if (!place) return {};
  return {
    ...(change.side ? { side: place.side } : {}),
    offset: place.offset,
  };
}

/** The size of the region in `slot` as the engine keeps it: its extent along the direction of
 *  its division. */
function sizeAt(state: GraphState, sizes: Float32Array, slot: number): number {
  const across = state.nodes[slot]!.region!.axis === "across";
  return sizes[slot * 2 + (across ? 0 : 1)]!;
}

/** The regions of the node in `slot` as the host application's type has them, each with its
 *  size as the engine keeps it, at every depth (ARCH-regions-are-container-slots). */
function regionsAt(state: GraphState, bridge: Bridge, slot: number): RegionData[] {
  const order = [...bridge.regionsOf(slot)];
  const { sizes } = bridge.nodeBuffers();
  const byId = new Map<string, RegionData[]>();
  const top: RegionData[] = [];
  const own = state.nodes[slot]!.id;
  for (const at of order) {
    const view = state.nodes[at]!;
    const { name, line, divide } = view.region!;
    const region: RegionData = { id: view.id, size: sizeAt(state, sizes, at), line };
    if (typeof line !== "string") region.line = [line[0], line[1]];
    if (name !== undefined) region.name = name;
    if (divide !== undefined) region.divide = divide;
    const into = view.container === own ? top : byId.get(view.container!)!;
    into.push(region);
    const inner: RegionData[] = [];
    byId.set(view.id, inner);
    if (divide !== undefined) region.regions = inner;
  }
  return top;
}

/** Each of `regions`, by identifier, with its size as the engine keeps it now. */
function regionSizes(state: GraphState, bridge: Bridge, regions: readonly string[]) {
  const { sizes } = bridge.nodeBuffers();
  return regions.map((id) => ({ id, size: sizeAt(state, sizes, state.slots.get(id)!) }));
}

/** The change `nodeResized` as `onChange` delivers it: the node's box, its position relative to
 *  its container, and the positions relative to it of the nodes the resize moved there. */
function nodeResizedOf(
  change: Extract<StoreChange, { kind: "nodeResized" }>,
  state: GraphState,
  bridge: Bridge,
): GraphChange {
  const slot = state.slots.get(change.id)!;
  // Read before the next call into the engine, which may detach the view.
  const { sizes } = bridge.nodeBuffers();
  const [width, height] = [sizes[slot * 2]!, sizes[slot * 2 + 1]!];
  const { x, y } = placeOf(state, bridge, slot);
  const moved = movedOf(state, bridge, change.moved);
  const regions = regionSizes(state, bridge, change.regions);
  return { kind: change.kind, by: change.by, id: change.id, x, y, width, height, moved, regions };
}

/** Each node of `moved` with its position relative to its container now. */
function movedOf(state: GraphState, bridge: Bridge, moved: readonly string[]) {
  return moved.map((id) => {
    const at = placeOf(state, bridge, state.slots.get(id)!);
    return { id, x: at.x, y: at.y };
  });
}

/** The change `nodeAdded` as `onChange` delivers it: the node as Comb took it, its position
 *  relative to its container, its height as raised, and its content built for this delivery. */
function nodeAddedOf(
  change: Extract<StoreChange, { kind: "nodeAdded" }>,
  state: GraphState,
  bridge: Bridge,
): GraphChange {
  const slot = state.slots.get(change.id)!;
  const { id, width, shape, outline, isContainer, height, resizable, divide } = state.nodes[slot]!;
  const place = bridge.borderOf(slot);
  if (place) {
    // A border node, at the offset the engine held within its side (ARCH-border-nodes-ride-sides).
    const { attachedTo } = state.nodes[slot]!;
    const content = bridge.content(slot);
    const { side, offset } = place;
    const border: NodeData = { id, width, shape, content, attachedTo: attachedTo!, side, offset };
    if (outline !== undefined) border.outline = outline;
    if (height !== undefined) border.height = heightAt(bridge, slot);
    return { kind: change.kind, by: change.by, node: border };
  }
  const { x, y, container } = placeOf(state, bridge, slot);
  const node: NodeData = { id, x, y, width, shape, content: bridge.content(slot) };
  if (container !== null) node.container = container;
  if (outline !== undefined) node.outline = outline;
  if (isContainer !== undefined) node.isContainer = isContainer;
  // The height as Comb took it: raised where it was below its content's.
  if (height !== undefined) node.height = heightAt(bridge, slot);
  if (resizable !== undefined) node.resizable = resizable;
  if (divide !== undefined) {
    node.divide = divide;
    node.regions = regionsAt(state, bridge, slot);
    // As wide as its regions made it.
    node.width = bridge.nodeBuffers().sizes[slot * 2]!;
  }
  return { kind: change.kind, by: change.by, node };
}

/** Where the node in `slot` lies: its position relative to its container, the difference of the
 *  world positions the engine keeps, or its world position on the canvas, and the identifier of
 *  its container, or `null` on the canvas (API-edits-report-nested-changes). */
function placeOf(state: GraphState, bridge: Bridge, slot: number) {
  const positions = bridge.positions();
  const { container } = state.nodes[slot]!;
  const at = positionAt(positions, slot);
  if (container === undefined) return { ...at, container: null };
  const origin = positionAt(positions, state.slots.get(container)!);
  return { x: at.x - origin.x, y: at.y - origin.y, container };
}

/** The change `nodeMoved` as `onChange` delivers it: where the node lies relative to its
 *  container, or a border node's side and offset (ARCH-border-nodes-ride-sides). */
function nodeMovedOf(
  change: Extract<StoreChange, { kind: "nodeMoved" }>,
  state: GraphState,
  bridge: Bridge,
): GraphChange {
  const slot = state.slots.get(change.id)!;
  const place = bridge.borderOf(slot);
  if (place) {
    const { side, offset } = place;
    return { kind: change.kind, by: "user", id: change.id, side, offset };
  }
  const { x, y, container } = placeOf(state, bridge, slot);
  return { kind: change.kind, by: change.by, id: change.id, x, y, container };
}

/** A change of one node, which `nodeChangeOf` delivers. */
type NodeChange = Extract<StoreChange, { kind: "nodeAdded" | "nodeUpdated" | "nodeResized" }>;

/** The kinds of `NodeChange`. */
const NODE_CHANGES: ReadonlySet<StoreChange["kind"]> = new Set([
  "nodeAdded",
  "nodeUpdated",
  "nodeResized",
]);

/** Whether `change` is a change of one node. */
const isNodeChange = (change: StoreChange): change is NodeChange => NODE_CHANGES.has(change.kind);

/** The change of a node `change` names, as `onChange` delivers it. */
function nodeChangeOf(change: NodeChange, state: GraphState, bridge: Bridge): GraphChange {
  switch (change.kind) {
    case "nodeAdded":
      return nodeAddedOf(change, state, bridge);
    case "nodeUpdated":
      return nodeUpdatedOf(change, state, bridge);
    case "nodeResized":
      return nodeResizedOf(change, state, bridge);
  }
}

/** The change of the graph `change` names, as `onChange` delivers it: what it carries read from
 *  `state` and, for a position, from the engine's buffer as it is now. */
function deliveryOf(change: StoreChange, state: GraphState, bridge: Bridge): GraphChange {
  if (isNodeChange(change)) return nodeChangeOf(change, state, bridge);
  switch (change.kind) {
    case "loaded":
      return { kind: change.kind, by: change.by };
    case "nodeMoved":
      return nodeMovedOf(change, state, bridge);
    case "nodesRemoved":
      return {
        kind: change.kind,
        by: change.by,
        nodes: [...change.nodes],
        edges: [...change.edges],
      };
    case "edgesRemoved":
      return { kind: change.kind, by: change.by, edges: [...change.edges] };
    case "edgeAdded":
    case "edgeUpdated":
      return edgeDeliveryOf(change, state);
    case "regionsMoved":
      return {
        kind: change.kind,
        by: change.by,
        node: change.node,
        regions: regionSizes(state, bridge, change.regions),
        moved: movedOf(state, bridge, change.moved),
      };
    case "labelMoved": {
      const labels = edgeNamed(state, change.edge).edge.labels!;
      const { t, offset } = labels.find(({ id }) => id === change.label)!;
      const { kind, by, edge, label } = change;
      return { kind, by, edge, label, t, offset };
    }
  }
}

/** `onChange` and `onSelectionChange` of one Comb, told from one subscription to `store`, so that
 *  a change of the graph reaches its listeners before the selection it cleared reaches theirs.
 *  Deliveries wait in one queue, so that a change a listener makes reaches every listener after
 *  the one being delivered, in the order made; a listener that throws keeps no other from being
 *  told, and the first error is thrown on once the queue is empty. */
export function listenersOf(store: GraphStore, bridge: Bridge) {
  const changes = new Set<(change: GraphChange) => void>();
  const selections = new Set<(selection: Selection) => void>();
  const add =
    <A>(set: Set<(value: A) => void>) =>
    (listener: (value: A) => void) => {
      // A registration of its own, so that one listener registered twice is told twice.
      const registration = (value: A) => listener(value);
      set.add(registration);
      return () => void set.delete(registration);
    };
  const queue: (() => void)[] = [];
  let delivering = false;
  const tell = <A>(set: Set<(value: A) => void>, value: A) =>
    queue.push(...[...set].map((listener) => () => listener(value)));
  store.subscribe((state, previous) => {
    if (state.change !== previous.change && state.change && changes.size > 0)
      tell(changes, deliveryOf(state.change, state, bridge));
    if (state.selection !== previous.selection) tell(selections, state.selection);
    if (delivering) return;
    delivering = true;
    const failed: unknown[] = [];
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          next();
        } catch (error) {
          failed.push(error);
        }
      }
    } finally {
      delivering = false;
    }
    if (failed.length > 0) throw failed[0];
  });
  return { onChange: add(changes), onSelectionChange: add(selections) };
}

/** `onContentClick` of one Comb, and the function that tells its listeners of a click: each is
 *  told, a listener that throws keeping no other from being told, and the first error is thrown
 *  on once all were. */
export function contentClicksOf(): {
  onContentClick(listener: (click: ContentClick) => void): () => void;
  tell(click: ContentClick): void;
} {
  const listeners = new Set<(click: ContentClick) => void>();
  return {
    onContentClick(listener) {
      // A registration of its own, so that one listener registered twice is told twice.
      const registration = (click: ContentClick) => listener(click);
      listeners.add(registration);
      return () => void listeners.delete(registration);
    },
    tell(click) {
      const failed: unknown[] = [];
      for (const listener of [...listeners]) {
        try {
          listener(click);
        } catch (error) {
          failed.push(error);
        }
      }
      if (failed.length > 0) throw failed[0];
    },
  };
}
