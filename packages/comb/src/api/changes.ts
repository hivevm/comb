// How a change the store records reaches the host application: `GraphChange`, what `onChange`
// delivers, read from the store and the engine's buffer as copies no listener can reach into
// (ADR-0030), and the listeners of `onChange` and `onSelectionChange` told from one subscription.
import { positionAt, type Bridge } from "../bridge";
import {
  edgeNamed,
  type By,
  type EdgeData,
  type EdgeLabelData,
  type EdgePatch,
  type GraphState,
  type GraphStore,
  type NodeData,
  type Selection,
  type StoreChange,
} from "../store";

/** The attributes `updateEdge` changes on an edge, as `edgeUpdated` reports them merged: its
 *  colour, arrowhead, dash pattern or none, and label or none (ADR-0030). */
type EdgeChangePatch = {
  readonly [K in keyof EdgePatch]: K extends "label"
    ? Readonly<EdgeLabelData> | null
    : EdgePatch[K];
};

/** One change of the graph, by its `kind` and by who made it, `"user"` or `"host"`, as
 *  `onChange` delivers it (ADR-0030). */
export type GraphChange =
  /** `load` replaced the graph. */
  | { readonly kind: "loaded"; readonly by: "host" }
  /** `addNode` added `node`, as Comb took it. */
  | { readonly kind: "nodeAdded"; readonly by: "host"; readonly node: Readonly<NodeData> }
  /** `updateNode` changed the node `id` by `patch`, as Comb merged it. */
  | {
      readonly kind: "nodeUpdated";
      readonly by: "host";
      readonly id: string;
      readonly patch: Readonly<Partial<Pick<NodeData, "title">>>;
    }
  /** A drag left the node `id` at `x`, `y`. */
  | {
      readonly kind: "nodeMoved";
      readonly by: "user";
      readonly id: string;
      readonly x: number;
      readonly y: number;
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

/** The change of the graph `change` names, as `onChange` delivers it: what it carries read from
 *  `state` and, for a position, from the engine's buffer as it is now. */
function deliveryOf(change: StoreChange, state: GraphState, bridge: Bridge): GraphChange {
  switch (change.kind) {
    case "loaded":
      return { kind: change.kind, by: change.by };
    case "nodeUpdated":
      return { kind: change.kind, by: change.by, id: change.id, patch: { ...change.patch } };
    case "nodeMoved": {
      const { x, y } = positionAt(bridge.positions(), state.slots.get(change.id)!);
      return { kind: change.kind, by: change.by, id: change.id, x, y };
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
    case "labelMoved": {
      const { t, offset } = edgeNamed(state, change.edge).edge.label!;
      return { kind: change.kind, by: change.by, edge: change.edge, t, offset };
    }
    case "nodeAdded": {
      const slot = state.slots.get(change.id)!;
      const { id, title, width, height } = state.nodes[slot]!;
      const { x, y } = positionAt(bridge.positions(), slot);
      return { kind: change.kind, by: change.by, node: { id, title, x, y, width, height } };
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
