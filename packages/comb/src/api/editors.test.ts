// The edits of the graph against the engine itself: every method that changes the graph reads
// its input whole before the store's map is asked (Q-7), the user's deletion removes through the
// same function as `removeNodes` and `removeEdges`, and a slot the shell names wrongly is no
// problem of graph data.
import { beforeAll, describe, expect, test } from "bun:test";
import { createBridgeSync, type Bridge } from "../bridge";
import { deleteSelection } from "../interaction/delete";
import { createGraphStore, type GraphStore, type NodeContent, type NodeData } from "../store";
import { editorsOf, GraphDataError } from "./editors";

let bytes: ArrayBuffer;

beforeAll(async () => {
  bytes = await Bun.file(new URL("../../wasm/engine_bg.wasm", import.meta.url)).arrayBuffer();
});

/** One row of one title, `title`. */
const titled = (title: string): NodeContent => [[{ kind: "text", role: "title", text: title }]];
const node = (id: string, x = 0): NodeData => ({ id, x, y: 0, width: 100, content: titled(id) });

/** A store and an engine holding the nodes `a` and `b` and the edge `a-b`, the edits of the Comb
 *  on them, and the bridge, wrapped by `around` where a test gives it. */
function editing(around: (bridge: Bridge) => Bridge = (bridge) => bridge) {
  const store = createGraphStore();
  const bridge = around(createBridgeSync(bytes));
  const limits = {
    text: bridge.textLimit(),
    id: bridge.idLimit(),
    idBudget: bridge.idBudget(),
    contentBudget: bridge.contentBudget(),
    rows: bridge.rowLimit(),
    columns: bridge.columnLimit(),
    segments: bridge.segmentLimit(),
  };
  const editors = editorsOf(store, bridge, limits, {});
  editors.host.load({
    nodes: [node("a"), node("b", 300)],
    edges: [{ id: "a-b", source: "a", target: "b" }],
  });
  return { store, bridge, ...editors };
}

/** Where the store and the engine disagree: a node or an edge the store keeps in another slot
 *  than its map names, and a slot whose node the engine holds, or the edges at it, otherwise
 *  than the store does; none where they agree. */
function disagreements(store: GraphStore, bridge: Bridge): string[] {
  const { nodes, slots, edges, edgeSlots } = store.getState();
  const found: string[] = [];
  nodes.forEach((item, slot) => {
    if (item && slots.get(item.id) !== slot) found.push(`node ${item.id} kept in slot ${slot}`);
  });
  edges.forEach((item, slot) => {
    if (item && edgeSlots.get(item.id) !== slot) found.push(`edge ${item.id} kept in slot ${slot}`);
  });
  if (slots.size !== nodes.filter(Boolean).length) found.push("the map names another node count");
  for (let slot = 0; slot <= nodes.length; slot++) {
    const kept = nodes[slot];
    const stored = kept
      ? edges.flatMap((edge, at) =>
          edge && (edge.source === kept.id || edge.target === kept.id) ? [at] : [],
        )
      : "none";
    let engine: number[] | "none";
    try {
      engine = [...bridge.edgesAt(Uint32Array.of(slot))];
    } catch {
      engine = "none";
    }
    if (JSON.stringify(engine) !== JSON.stringify(stored))
      found.push(`slot ${slot}: the engine holds ${String(engine)}, the store ${String(stored)}`);
  }
  return found;
}

/** The problem of the `GraphDataError` `call` throws, or what else it throws, or "accepted". */
function refusal(call: () => void): unknown {
  try {
    call();
    return "accepted";
  } catch (error) {
    return error instanceof GraphDataError ? error.problem : error;
  }
}

/** A list of the one identifier `id`, read through a getter that runs `edit` first. */
function listReading(id: string, edit: () => void): string[] {
  const ids: string[] = [];
  Object.defineProperty(ids, 0, {
    get() {
      edit();
      return id;
    },
    enumerable: true,
  });
  return ids;
}

type Editing = ReturnType<typeof editing>;

/** Each method that changes the graph, called with an input whose getter edits the graph through
 *  `Comb`, and what it does as if the getter's edit had come first. */
const CASES: {
  name: string;
  call: (comb: Editing["host"]) => void;
  outcome: unknown;
  nodes: string[];
  edges: string[];
}[] = [
  {
    name: "load, whose getter adds a node the load replaces",
    call: (comb) =>
      comb.load({
        nodes: [
          {
            ...node("x"),
            get content() {
              comb.addNode(node("c", 600));
              return titled("X");
            },
          },
        ],
        edges: [],
      }),
    outcome: "accepted",
    nodes: ["x"],
    edges: [],
  },
  {
    name: "updateNode, whose getter removes the node",
    call: (comb) =>
      comb.updateNode("a", {
        get content() {
          comb.removeNodes(["a"]);
          return titled("A2");
        },
      }),
    outcome: { kind: "unknownNode", node: "a" },
    nodes: ["b"],
    edges: [],
  },
  {
    name: "addNode, whose getter adds a node of the same identifier",
    call: (comb) =>
      comb.addNode({
        ...node("c", 600),
        get content() {
          comb.addNode(node("c", 900));
          return titled("C");
        },
      }),
    outcome: { kind: "duplicateNode", node: "c" },
    nodes: ["a", "b", "c"],
    edges: ["a-b"],
  },
  {
    name: "addEdge, whose getter removes its target",
    call: (comb) =>
      comb.addEdge({
        id: "e",
        source: "a",
        get target() {
          comb.removeNodes(["b"]);
          return "b";
        },
      }),
    outcome: { kind: "missingNode", edge: "e", node: "b" },
    nodes: ["a"],
    edges: [],
  },
  {
    name: "addEdge, whose getter adds its target",
    call: (comb) =>
      comb.addEdge({
        id: "e",
        source: "a",
        get target() {
          comb.addNode(node("c", 600));
          return "c";
        },
      }),
    outcome: "accepted",
    nodes: ["a", "b", "c"],
    edges: ["a-b", "e"],
  },
  {
    name: "updateEdge, whose getter removes the edge and adds another into its slot",
    call: (comb) =>
      comb.updateEdge("a-b", {
        get color() {
          comb.removeEdges(["a-b"]);
          comb.addEdge({ id: "b-a", source: "b", target: "a" });
          return 0xff0000;
        },
      }),
    outcome: { kind: "unknownEdge", edge: "a-b" },
    nodes: ["a", "b"],
    edges: ["b-a"],
  },
  {
    name: "removeNodes, whose getter removes the node",
    call: (comb) => comb.removeNodes(listReading("a", () => comb.removeNodes(["a"]))),
    outcome: { kind: "unknownNode", node: "a" },
    nodes: ["b"],
    edges: [],
  },
  {
    name: "removeNodes, whose getter adds the node",
    call: (comb) => comb.removeNodes(listReading("c", () => comb.addNode(node("c", 600)))),
    outcome: "accepted",
    nodes: ["a", "b"],
    edges: ["a-b"],
  },
  {
    name: "removeEdges, whose getter removes the edge",
    call: (comb) => comb.removeEdges(listReading("a-b", () => comb.removeEdges(["a-b"]))),
    outcome: { kind: "unknownEdge", edge: "a-b" },
    nodes: ["a", "b"],
    edges: [],
  },
];

describe("an input whose getter edits the graph through Comb", () => {
  for (const { name, call, outcome, nodes, edges } of CASES) {
    test(`${name} acts as if the getter's edit came first`, () => {
      // Verifies: Q-7
      const { store, bridge, host } = editing();
      expect(refusal(() => call(host))).toEqual(outcome);
      const state = store.getState();
      expect([[...state.slots.keys()].sort(), [...state.edgeSlots.keys()].sort()]).toEqual([
        nodes,
        edges,
      ]);
      expect(disagreements(store, bridge)).toEqual([]);
    });
  }
});

/** `bridge` recording the name of each call into `calls`. */
const recording =
  (calls: string[]) =>
  (bridge: Bridge): Bridge =>
    Object.fromEntries(
      Object.entries(bridge).map(([name, call]) => [
        name,
        (...args: unknown[]) => (calls.push(name), (call as (...a: unknown[]) => unknown)(...args)),
      ]),
    ) as unknown as Bridge;

describe("the user's deletion", () => {
  for (const [selection, list] of [
    [{ kind: "node", id: "a" }, "nodes"],
    [{ kind: "edge", id: "a-b" }, "edges"],
  ] as const) {
    test(`of ${list} removes as the host's removal does, and tells the same change but for by`, () => {
      // Verifies: ADR-0030
      const hostCalls: string[] = [];
      const byHost = editing(recording(hostCalls));
      hostCalls.length = 0;
      if (list === "nodes") byHost.host.removeNodes(["a"]);
      else byHost.host.removeEdges(["a-b"]);
      const userCalls: string[] = [];
      const byUser = editing(recording(userCalls));
      byUser.store.getState().select(selection);
      userCalls.length = 0;
      deleteSelection(byUser.store, byUser.bridge, byUser.user.delete);
      // The deletion names what would go before the veto; from there it is the host's removal.
      expect(userCalls.filter((name) => name !== "edgesAt")).toEqual(hostCalls);
      const told = byHost.store.getState().change;
      expect(byUser.store.getState().change as unknown).toEqual({ ...told, by: "user" });
      expect(told?.by).toBe("host");
    });
  }
});

describe("a slot the shell names that holds nothing", () => {
  const holdingNothing = (
    name: "removeNodes" | "removeEdges" | "addEdge",
    kind: "noNode" | "noEdge",
  ) =>
    editing((bridge) => ({
      ...bridge,
      [name]: () => {
        throw { kind, slot: 7 };
      },
    }));

  test("is thrown as an Error naming the slot, no GraphDataError, and changes nothing", () => {
    // Verifies: ADR-0022
    for (const [name, kind, item, call] of [
      ["removeNodes", "noNode", "node", (comb: Editing["host"]) => comb.removeNodes(["a"])],
      ["removeEdges", "noEdge", "edge", (comb: Editing["host"]) => comb.removeEdges(["a-b"])],
      [
        "addEdge",
        "noNode",
        "node",
        (comb: Editing["host"]) => comb.addEdge({ id: "e", source: "b", target: "a" }),
      ],
    ] as const) {
      const { store, host } = holdingNothing(name, kind);
      const before = store.getState();
      const error = refusal(() => call(host));
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(GraphDataError);
      expect((error as Error).message).toBe(`comb: the engine holds no ${item} in slot 7`);
      expect((error as Error).cause).toEqual({ kind, slot: 7 });
      expect(store.getState()).toBe(before);
    }
  });
});
