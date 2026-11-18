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
  type EdgePatch,
  type GraphState,
  type GraphStore,
  type NodeData,
  type NodePatch,
  type RegionData,
  type Selection,
  type StoreChange,
} from "../store";

/** The attributes `updateEdge` changes on an edge, as `edgeUpdated` reports them merged: its
 *  colour, arrowhead, dash pattern or none, and label or none
 *  (API-edits-reported-as-typed-changes). */
type EdgeChangePatch = {
  readonly [K in keyof EdgePatch]: K extends "label"
    ? Readonly<EdgeLabelData> | null
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
  /** The edge `edge` was added, as Comb keeps it, its defaults filled. */
  | {
      readonly kind: "edgeAdded";
      readonly by: By;
      readonly edge: Readonly<
        EdgeData & Required<Pick<EdgeData, "color" | "arrow" | "sourceSide" | "targetSide">>
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
  /** A drag left the label of the edge `edge` at path parameter `t` and label offset `offset`. */
  | {
      readonly kind: "labelMoved";
      readonly by: "user";
      readonly edge: string;
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
    const { dash, label, ...patch } = change.patch;
    return {
      kind: change.kind,
      by: change.by,
      id: change.id,
      patch: {
        ...patch,
        ...(dash === undefined ? {} : { dash: dash && ([dash[0], dash[1]] as const) }),
        ...(label === undefined ? {} : { label: label && { ...label } }),
      },
    };
  }
  const { dash, label, ...edge } = edgeNamed(state, change.id).edge;
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
      ...(label ? { label: { ...label } } : {}),
    },
  };
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
  if (change.regions) {
    const { divide } = state.nodes[slot]!;
    if (divide !== undefined) patch.divide = divide;
    patch.regions = regionsAt(state, bridge, slot);
  }
  return { kind: change.kind, by: change.by, id: change.id, patch };
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
  const { id, width, shape, isContainer, height, resizable, divide } = state.nodes[slot]!;
  const { x, y, container } = placeOf(state, bridge, slot);
  const node: NodeData = { id, x, y, width, shape, content: bridge.content(slot) };
  if (container !== null) node.container = container;
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
    case "nodeMoved": {
      const { x, y, container } = placeOf(state, bridge, state.slots.get(change.id)!);
      return {
        kind: change.kind,
        by: change.by,
        id: change.id,
        x,
        y,
        container,
      };
    }
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
      const { t, offset } = edgeNamed(state, change.edge).edge.label!;
      return { kind: change.kind, by: change.by, edge: change.edge, t, offset };
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
