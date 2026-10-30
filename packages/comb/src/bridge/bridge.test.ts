import { beforeAll, describe, expect, test } from "bun:test";
import {
  createBridgeSync,
  edgeColumns,
  nodeColumns,
  PIECE_BOUND,
  type NodeField,
  type Bridge,
  type GraphSnapshot,
  type NodePatch,
  type EdgeSnapshot,
  type NodeSnapshot,
  type PlainEdgePatch,
  type PlainPatch,
} from ".";
import { listsOf, snapshotOf } from "../api/snapshot";
import { EdgeField, SideCode } from "../../wasm/engine.js";

let bridge: Bridge;

beforeAll(async () => {
  const bytes = await Bun.file(new URL("../../wasm/engine_bg.wasm", import.meta.url)).arrayBuffer();
  bridge = createBridgeSync(bytes);
});

const node = (id: string, x: number, y: number) => ({
  id,
  title: id,
  x,
  y,
  width: 100,
  height: 50,
});
const edge = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  color: 0x22a55b,
  arrow: "none" as const,
  sourceSide: "right" as const,
  targetSide: "left" as const,
});
// The bridge takes only what `api/snapshot.ts` produces (ADR-0028); its own tests stand in for
// that module and hand it plain data of their own, the nodes and edges written into columns as
// it writes them (ADR-0034).
type PlainNode = ReturnType<typeof node>;
const graph = (nodes: readonly PlainNode[], edges: readonly object[] = [], bound = PIECE_BOUND) => {
  const columns = nodeColumns(nodes.length, bound);
  for (const n of nodes as readonly unknown[]) {
    if (typeof n !== "object" || n === null) columns.noObject();
    else {
      const { id, title, x, y, width, height } = n as Record<string, unknown>;
      columns.node(id, title, x, y, width, height);
    }
  }
  const written = edgeColumns(edges.length, bound);
  for (const e of edges as readonly unknown[]) {
    if (typeof e !== "object" || e === null) written.noObject();
    else {
      const { id, source, target, label, color, dash, arrow, sourceSide, targetSide } = e as Record<
        string,
        unknown
      >;
      written.edge(id, source, target, label, color, dash, arrow, sourceSide, targetSide);
    }
  }
  return { nodes: columns.columns(), edges: written.columns() } as GraphSnapshot;
};
const plain = (patch: NodePatch) => patch as PlainPatch;
const added = (fields: object) => fields as NodeSnapshot;
const edgeOf = (fields: object) =>
  ({ color: 0, arrow: "end", sourceSide: "right", targetSide: "left", ...fields }) as EdgeSnapshot;
const plainEdge = (patch: object) => patch as PlainEdgePatch;
/** The slot of the node a press at `(x, y)` hits, at a screen pixel of one world unit. */
const nodeAt = (x: number, y: number) => {
  const hit = bridge.hit(x, y, 1, "near", false);
  return hit.kind === "node" ? hit.slot : undefined;
};
/** Nodes `a` and `b`. */
const two = () => [node("a", 0, 0), node("b", 1, 1)];
const everywhere = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

/** A row of `count` nodes 200 apart, each linked to the next. */
function row(count: number): GraphSnapshot {
  const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`, i * 200, 0));
  const edges = nodes.slice(1).map((_, i) => edge(`e${i}`, `n${i}`, `n${i + 1}`));
  return graph(nodes, edges);
}

describe("bridge views", () => {
  test("in test mode, every call detaches the views taken before it", () => {
    // Verifies: ADR-0034
    // Under `bun test` the bridge runs in test mode: it grows the engine's memory before each of
    // its calls, so a view kept across any call reads empty, not only when memory happens to grow.
    // Only a grown memory detaches its buffer, so an empty view shows that the call grew it.
    bridge.loadGraph(graph([node("a", 1, 2), node("b", 3, 4)]));
    const calls: [string, () => unknown][] = [
      ["loadGraph", () => bridge.loadGraph(row(3))],
      ["checkNodePatch", () => bridge.checkNodePatch("a", plain({ title: "A" }))],
      ["addNode", () => bridge.addNode(added(node("c", 5, 6)))],
      ["translate", () => bridge.translate(new Uint32Array([0]), 0, 0)],
      ["positions", () => bridge.positions()],
      ["query", () => bridge.query(everywhere, "near", 4, 0)],
      ["drawnEdges", () => bridge.drawnEdges()],
      ["hit", () => bridge.hit(0, 0, 1, "near", true)],
      ["addEdge", () => bridge.addEdge(edgeOf(edge("x", "n0", "n2")), 0, 2)],
      ["updateEdge", () => bridge.updateEdge(0, "e0", plainEdge({ color: 0 }))],
      ["removeEdges", () => bridge.removeEdges(new Uint32Array([0]))],
      ["removeNodes", () => bridge.removeNodes(new Uint32Array([1]))],
    ];
    const after = calls.map(([name, call]) => {
      const kept = bridge.positions();
      call();
      return { name, kept: kept.length };
    });
    expect(after).toEqual(calls.map(([name]) => ({ name, kept: 0 })));
  });
});

describe("bridge", () => {
  test("positions are read back in slot order", () => {
    expect(bridge.loadGraph(graph([node("a", 1, 2), node("b", 3, 4)]))).toBe(2);
    expect([...bridge.positions()]).toEqual([1, 2, 3, 4]);
  });

  test("a move is visible through a fresh view", () => {
    bridge.loadGraph(graph([node("a", 0, 0), node("b", 10, 10)]));
    bridge.translate(new Uint32Array([1]), 5, -5);
    expect([...bridge.positions()]).toEqual([0, 0, 15, 5]);
  });

  test("a view read after memory grew still sees the positions", () => {
    // Verifies: ADR-0034
    bridge.loadGraph(graph([node("a", 7, 8)]));
    const big = Array.from({ length: 200_000 }, (_, i) => node(`n${i}`, i, i));
    bridge.loadGraph(graph(big));
    bridge.loadGraph(graph([node("a", 7, 8)]));
    expect([...bridge.positions()]).toEqual([7, 8]);
  });

  test("malformed graph data comes back as a typed error", () => {
    // Verifies: ADR-0034
    expect(() => bridge.loadGraph(graph([node("a", Number.NaN, 0)]))).toThrow();
    const errors = [
      graph([node("a", 0, 0), node("a", 1, 1)]),
      graph([node("a", 0, 0)], [edge("e", "a", "z")]),
      graph(two(), [edge("e", "a", "b"), edge("e", "b", "a")]),
      graph([{ ...node("a", 0, 0), width: -1 }]),
    ].map((batch) => {
      try {
        bridge.loadGraph(batch);
      } catch (error) {
        return error;
      }
    });
    expect(errors).toEqual([
      { kind: "duplicateNode", node: "a" },
      { kind: "missingNode", edge: "e", node: "z" },
      { kind: "duplicateEdge", edge: "e" },
      { kind: "invalidSize", node: "a" },
    ]);
  });
});

/** What a field of a node or an edge expects, as the problem says it: plain words, no Rust type. */
const NUMBER = "a finite number";
const SIZE = "a finite number of 0 or more";
const ID = "a well-formed string of at most 256 code units";

/** One field of node `b` or edge `e` corrupted, with a value of another type or by leaving it out,
 *  each with the problem the bridge reports for it. A field that may be left out (an edge's label
 *  and dash, a label's background) is only given a value of another type. */
const CORRUPTIONS: { field: string; value?: unknown; problem: object }[] = [
  ...["x", "y", "width", "height"].flatMap((field) => {
    const expected = field === "x" || field === "y" ? NUMBER : SIZE;
    const problem = { kind: "invalidField", list: "nodes", index: 1, id: "b", field, expected };
    return [
      { field: `node.${field}`, value: "1", problem },
      { field: `node.${field}`, problem },
    ];
  }),
  ...[{ value: 5 }, {}].map((corruption) => ({
    field: "node.id",
    ...corruption,
    problem: { kind: "invalidField", list: "nodes", index: 1, field: "id", expected: ID },
  })),
  ...[{ value: 5 }, {}].map((corruption) => ({
    field: "node.title",
    ...corruption,
    problem: { kind: "invalidTitle", node: "b" },
  })),
  ...[
    ["id", 5, ID],
    ["source", 5, ID],
    ["target", null, ID],
    ["color", "red", "an integer from 0 to 0xFFFFFF"],
    ["arrow", "start", '"end" or "none"'],
    ["label.t", "1", NUMBER],
    ["label.offset", false, NUMBER],
  ].flatMap(([field, value, expected]) => {
    const problem = { kind: "invalidField", list: "edges", index: 0, id: "e", field, expected };
    if (field === "id") delete (problem as { id?: string }).id;
    return [
      { field: `edge.${field}`, value, problem },
      { field: `edge.${field}`, problem },
    ];
  }),
  ...[
    ["label", 5, "an object, or none"],
    ["dash", [6, 4, 2], "a list of two finite numbers, or none"],
    ["dash", ["6", 4], "a list of two finite numbers, or none"],
  ].map(([field, value, expected]) => ({
    field: `edge.${field}`,
    value,
    problem: { kind: "invalidField", list: "edges", index: 0, id: "e", field, expected },
  })),
  ...[{ value: 5 }, {}].map((corruption) => ({
    field: "edge.label.text",
    ...corruption,
    problem: { kind: "invalidLabelText", edge: "e" },
  })),
  {
    field: "edge.label.background",
    value: "red",
    problem: { kind: "invalidBackground", edge: "e" },
  },
];

/** Columns that do not fit together: one `x` fewer than there are nodes, which the shell never
 *  hands over, as graph data the bridge cannot read. */
function unfit(): GraphSnapshot {
  const { nodes, edges } = graph(two());
  return { nodes: { ...nodes, x: nodes.x.subarray(1) }, edges } as GraphSnapshot;
}

/** Nodes `a` and `b` and an edge `e` between them with every field of its own, with `path`
 *  (`node.…` for `b`, `edge.…` for `e`) set to `value`, or left out where `value` is absent. */
function corrupted(path: string, corruption: { value?: unknown }): GraphSnapshot {
  const b: Record<string, unknown> = node("b", 300, 0);
  const label: Record<string, unknown> = { text: "x", t: 0.5, offset: 0, background: 0x123456 };
  const e: Record<string, unknown> = { ...edge("e", "a", "b"), label, dash: [6, 4] };
  const [item, ...field] = path.split(".");
  const target = item === "node" ? b : field.length > 1 ? label : e;
  const name = field[field.length - 1]!;
  if ("value" in corruption) target[name] = corruption.value;
  else delete target[name];
  return graph([node("a", 0, 0), b as never], [e as never]);
}

describe("bridge refusals of a single field", () => {
  for (const { field, problem, ...corruption } of CORRUPTIONS) {
    const how = "value" in corruption ? `holds ${JSON.stringify(corruption.value)}` : "is missing";
    test(`where ${field} ${how}, the problem names the field and its node or edge`, () => {
      // Verifies: ADR-0034
      expect(bridge.loadGraph(corrupted("node.x", { value: 0 }))).toBe(2);
      let refused: unknown = null;
      try {
        bridge.loadGraph(corrupted(field, corruption));
      } catch (error) {
        refused = error;
      }
      expect(refused).toStrictEqual(problem);
    });
  }

  test("a million nodes with every field refused are refused quickly, naming the first", () => {
    // Verifies: ADR-0034
    const refused = { id: false, title: false, x: false, y: false, width: false, height: false };
    const nodes = Array.from({ length: 1_000_000 }, () => ({ ...refused }));
    const start = performance.now();
    let problem: unknown = null;
    try {
      bridge.loadGraph(graph(nodes as never));
    } catch (error) {
      problem = error;
    }
    const ms = performance.now() - start;
    expect(problem).toStrictEqual({
      kind: "invalidField",
      list: "nodes",
      index: 0,
      field: "id",
      expected: ID,
    });
    // Only the first is named: the columns say where it lies, and no refused value costs an error
    // of its own. The time is that of writing the columns in TypeScript and of the load together.
    expect(ms).toBeLessThan(1000);
  });

  test("a message names no Rust type or crate", () => {
    // Verifies: ADR-0034
    const refusals = [
      ...CORRUPTIONS.map(
        (corruption) => () => bridge.loadGraph(corrupted(corruption.field, corruption)),
      ),
      () => bridge.loadGraph(unfit()),
      () => bridge.loadGraph(graph([5 as never])),
      () => bridge.loadGraph(graph([], "e" as never)),
      () => bridge.checkNodePatch("a", 5 as never),
      () => bridge.checkGraphSize(Number.NaN, 0),
      () => bridge.checkIdBudget(-1),
    ];
    for (const refuse of refusals) {
      let refused: Record<string, unknown> = {};
      try {
        refuse();
      } catch (error) {
        refused = error as Record<string, unknown>;
      }
      const words = Object.values(refused).filter((value) => typeof value === "string");
      expect(words.length).toBeGreaterThan(0);
      for (const word of words) expect(word).not.toMatch(RUST);
    }
  });
});

/** How `call` ended: `"accepted"`, or what it threw. */
function outcome(call: () => unknown): unknown {
  try {
    call();
    return "accepted";
  } catch (error) {
    return error;
  }
}

/** The bridge's limits, as `api` reads them. */
const limits = () => ({
  text: bridge.textLimit(),
  id: bridge.idLimit(),
  idBudget: bridge.idBudget(),
});

/** The snapshot `api/snapshot.ts` builds of `nodes` and `edges`, and the graph the store keeps. */
const snapshotted = (nodes: unknown[], edges: unknown[] = []) =>
  snapshotOf(listsOf({ nodes, edges } as never), limits());

describe("bridge columns of a load", () => {
  test("identifiers cut inside a surrogate pair side by side are refused for their length", () => {
    // Verifies: ADR-0034
    const pair = "\u{1F600}";
    // 300 code units each: the snapshot cuts the first after the high half of its pair, and the
    // second begins with a low half, so that the two halves meet across the boundary.
    const first = "a".repeat(256) + pair + "a".repeat(42);
    const second = pair.slice(1) + "b".repeat(299);
    expect([first.length, second.length]).toEqual([300, 300]);
    const { snapshot } = snapshotted([node(first, 0, 0), node(second, 300, 0)]);
    expect([...snapshot.nodes.idBounds]).toEqual([0, 257, 514]);
    expect(snapshot.nodes.ids[0]!.codePointAt(256)).toBe(0x1f600);
    expect(outcome(() => bridge.loadGraph(snapshot))).toStrictEqual({
      kind: "idTooLong",
      list: "nodes",
      index: 0,
      field: "id",
      limit: 256,
    });
    // A boundary inside a character that no length refuses is refused as malformed, never
    // mapped: the shell never hands one over.
    const inside = graph([node("\u{1F600}", 0, 0), node("", 300, 0)]);
    const cut = { ...inside.nodes, idBounds: new Uint32Array([0, 1, 2]) };
    expect(outcome(() => bridge.loadGraph({ ...inside, nodes: cut }))).toStrictEqual({
      kind: "malformed",
      message: "an identifier ends inside a character",
    });
  });

  test("identifiers and titles beyond the basic plane are held exactly by the store and the engine", () => {
    // Verifies: ADR-0034
    // Two identifiers that differ only in a character beyond the basic plane, one of 256 code
    // units of such characters, and titles of them up to the limit.
    const ids = ["\u{1F600}", "\u{1F601}", "\u{1D49C}".repeat(128), "x\u{10FFFF}y"];
    const titles = ["\u{1F600}".repeat(500), "\u{1D49C}", "", "\u{10FFFF}"];
    const nodes = ids.map((id, i) => ({ ...node(id, i * 300, 0), title: titles[i]! }));
    const edges = [edge("e0", ids[1]!, ids[2]!), edge("e1", ids[3]!, ids[0]!)];
    const { kept, snapshot } = snapshotted(nodes, edges);
    expect(kept.nodes.map((n) => [n.id, n.title])).toEqual(ids.map((id, i) => [id, titles[i]!]));
    expect(bridge.loadGraph(snapshot)).toBe(4);
    // Each edge's ends resolve to the slots of exactly the identifiers it names.
    expect([...bridge.edgesAt(new Uint32Array([1]))]).toEqual([0]);
    expect([...bridge.edgesAt(new Uint32Array([2]))]).toEqual([0]);
    expect([...bridge.edgesAt(new Uint32Array([0]))]).toEqual([1]);
    expect([...bridge.edgesAt(new Uint32Array([3]))]).toEqual([1]);
    // A code unit more than the limits is refused: the lengths are those JavaScript counts.
    const longer = (n: (typeof nodes)[number]) => snapshotted([n]).snapshot;
    expect(outcome(() => bridge.loadGraph(longer({ ...nodes[2]!, id: ids[2] + "x" })))).toEqual({
      kind: "idTooLong",
      list: "nodes",
      index: 0,
      field: "id",
      limit: 256,
    });
    expect(
      outcome(() => bridge.loadGraph(longer({ ...nodes[0]!, title: titles[0] + "x" }))),
    ).toEqual({ kind: "titleTooLong", node: ids[0], limit: 1000 });
  });
});

// Identifiers of 0 to 16 code units, characters beyond the basic plane among them; titles and
// label texts of none, columns of no code units.
const PIECED_IDS = [
  "",
  "a",
  "\u{1F600}",
  "x".repeat(16),
  "\u{1F600}".repeat(8),
  "ab\u{1D49C}",
  "y".repeat(15),
  "\u{10FFFF}z",
  "\u{1D49C}".repeat(7) + "q",
];

/** Asserts that `pieces` hold at most `bound` code units each, none empty, that each ends on one of
 *  `bounds`, that their lengths sum to the last, and that `values` are read back exactly. */
function expectPieces(
  pieces: readonly string[],
  bounds: Uint32Array,
  values: readonly string[],
  bound: number,
) {
  const ends = new Set(bounds);
  let end = 0;
  for (const piece of pieces) {
    expect(piece.length).toBeGreaterThan(0);
    expect(piece.length).toBeLessThanOrEqual(bound);
    end += piece.length;
    expect(ends.has(end)).toBe(true);
  }
  expect(end).toBe(bounds[bounds.length - 1]!);
  const joined = pieces.join("");
  expect(values.map((_, i) => joined.slice(bounds[i], bounds[i + 1]))).toEqual([...values]);
}

describe("bridge pieces of a string column", () => {
  test("a column cut with a small bound crosses in pieces that end where values end, read back exactly", () => {
    // Verifies: ADR-0034
    const bound = 16;
    const ids = PIECED_IDS;
    const nodes = ids.map((id, i) => ({ ...node(id, i * 300, 0), title: "" }));
    const edges = ids.slice(1).map((id, i) => edge(id, ids[i]!, id));
    const snapshot = graph(nodes, edges, bound);
    const n = snapshot.nodes;
    const e = snapshot.edges;
    const columns: [string[], Uint32Array, readonly string[]][] = [
      [n.ids, n.idBounds, ids],
      [n.titles, n.titleBounds, ids.map(() => "")],
      [e.ids, e.idBounds, ids.slice(1)],
      [e.sources, e.sourceBounds, ids.slice(0, -1)],
      [e.targets, e.targetBounds, ids.slice(1)],
      [e.labels, e.labelBounds, ids.slice(1).map(() => "")],
    ];
    for (const [pieces, bounds, values] of columns) expectPieces(pieces, bounds, values, bound);
    expect([n.ids.length, e.sources.length, n.titles.length, e.labels.length]).toEqual([
      7, 6, 0, 0,
    ]);
    // The engine maps every identifier exactly: each edge's ends resolve to the slots of the
    // identifiers it names, and a node or an edge refused in the first pass is named by its own.
    expect(bridge.loadGraph(snapshot)).toBe(ids.length);
    for (let slot = 0; slot < ids.length; slot++) {
      const touching = [slot - 1, slot].filter((at) => at >= 0 && at < edges.length);
      expect([...bridge.edgesAt(new Uint32Array([slot]))]).toEqual(touching);
    }
    ids.forEach((id, index) => {
      const refused = nodes.map((each, i) => (i === index ? { ...each, x: "0" } : each));
      const problem = outcome(() => bridge.loadGraph(graph(refused as never, edges, bound)));
      expect(problem).toMatchObject({ kind: "invalidField", list: "nodes", index, id, field: "x" });
    });
    edges.forEach(({ id }, index) => {
      const refused = edges.map((each, i) => (i === index ? { ...each, color: "red" } : each));
      const problem = outcome(() => bridge.loadGraph(graph(nodes, refused, bound)));
      expect(problem).toMatchObject({ kind: "invalidField", list: "edges", index, id });
    });
  });

  test("a value longer than the bound on a piece fits in none, and the writer refuses it", () => {
    // Verifies: ADR-0034
    expect(() => nodeColumns(1, 16).node("x".repeat(17), "", 0, 0, 1, 1)).toThrow(RangeError);
    expect(() =>
      edgeColumns(1, 16).edge(
        "e",
        "a",
        "b",
        { text: "x".repeat(17) },
        0,
        null,
        "end",
        "right",
        "left",
      ),
    ).toThrow(RangeError);
  });
});

describe("bridge columns of a load's edges", () => {
  test("edge identifiers and label texts beyond the basic plane are held exactly by the store and the engine", () => {
    // Verifies: ADR-0034
    // An edge's identifier and label text beyond the basic plane, read back exactly where the
    // bridge names the edge, and the label text's length counted as JavaScript counts it.
    const ids = ["\u{1F600}", "\u{1F601}"];
    const nodes = ids.map((id, i) => node(id, i * 300, 0));
    const edgeIds = ["\u{1F602}", "\u{1F603}"];
    const text = "\u{1D49C}".repeat(500);
    const labelled = edgeIds.map((id) => ({
      ...edge(id, ids[0]!, ids[1]!),
      label: { text, t: 0.5, offset: 0 },
    }));
    const withEdges = snapshotted(nodes, labelled);
    expect(withEdges.kept.edges.map((e) => [e.id, e.label?.text])).toEqual(
      edgeIds.map((id) => [id, text]),
    );
    expect(bridge.loadGraph(withEdges.snapshot)).toBe(2);
    expect([...bridge.edgesAt(new Uint32Array([0]))]).toEqual([0, 1]);
    const twice = snapshotted(nodes, [labelled[0]!, labelled[0]!]).snapshot;
    expect(outcome(() => bridge.loadGraph(twice))).toEqual({
      kind: "duplicateEdge",
      edge: edgeIds[0],
    });
    const long = { ...labelled[1]!, label: { ...labelled[1]!.label, text: text + "x" } };
    expect(outcome(() => bridge.loadGraph(snapshotted(nodes, [long]).snapshot))).toEqual({
      kind: "labelTextTooLong",
      edge: edgeIds[1],
      limit: 1000,
    });
  });
});

describe("bridge columns that do not fit", () => {
  test("a refused field of a code no field has is refused as malformed, and the engine keeps working", () => {
    // Verifies: ADR-0034
    const { nodes, edges } = graph(two());
    for (const field of [6, 255, 2 ** 32 - 1]) {
      const refused = { index: 0, field: field as NodeField };
      expect(
        outcome(() => bridge.loadGraph({ nodes: { ...nodes, refused }, edges } as never)),
      ).toStrictEqual({
        kind: "malformed",
        message: "the columns of the nodes do not fit together",
      });
    }
    expect(bridge.loadGraph(graph(two()))).toBe(2);
    expect([...bridge.positions()]).toEqual([0, 0, 1, 1]);
  });

  test("an edge's refused field or code no field or value has is refused as malformed, and the engine keeps working", () => {
    // Verifies: ADR-0034
    const { nodes, edges } = graph(two(), [edge("e", "a", "b")]);
    const misfits = [
      { ...edges, refused: { index: 0, field: 12 } },
      { ...edges, refused: { index: 1, field: 1 } },
      { ...edges, arrow: new Uint8Array([3]) },
      { ...edges, targetSide: new Uint8Array([5]) },
      { ...edges, gap: new Float64Array(0) },
    ];
    for (const columns of misfits) {
      expect(outcome(() => bridge.loadGraph({ nodes, edges: columns } as never))).toStrictEqual({
        kind: "malformed",
        message: "the columns of the edges do not fit together",
      });
    }
    expect(bridge.loadGraph(graph(two(), [edge("e", "a", "b")]))).toBe(2);
    expect([...bridge.edgesAt(new Uint32Array([0]))]).toEqual([0]);
  });

  test("an edge's arrowhead or side that names none crosses as its code and is refused at its place", () => {
    // Verifies: ADR-0034
    const snapshot = graph(two(), [
      edge("d", "a", "b"),
      { ...edge("e", "b", "a"), sourceSide: "middle" as never, arrow: false as never },
    ]);
    expect([...snapshot.edges.sourceSide]).toEqual([SideCode.Right, SideCode.Unnamed]);
    expect(snapshot.edges.refused).toEqual({ index: 1, field: EdgeField.Arrow });
    expect(outcome(() => bridge.loadGraph(snapshot))).toStrictEqual({
      kind: "invalidField",
      list: "edges",
      index: 1,
      id: "e",
      field: "arrow",
      expected: '"end" or "none"',
    });
    const unnamed = graph(two(), [{ ...edge("e", "b", "a"), targetSide: "middle" as never }]);
    expect(unnamed.edges.refused).toBeUndefined();
    expect(outcome(() => bridge.loadGraph(unnamed))).toStrictEqual({
      kind: "invalidField",
      list: "edges",
      index: 0,
      id: "e",
      field: "targetSide",
      expected: '"top", "right", "bottom", or "left"',
    });
  });
});

/** What names a Rust type or crate: a path, a backtick, a primitive or a type of the bridge crate,
 *  serde, or JsValue. */
const RUST =
  /::|`|\b(?:f32|f64|u8|u32|u64|i32|i64|usize|isize|str|String|Vec|Option|JsValue|serde\w*|comb_\w+|GraphBatch|NodeInput|EdgeInput|LabelInput|Arrow|[A-Z][a-z]+[A-Z]\w*)\b/;

describe("bridge fields the engine does not keep", () => {
  test("a title, label text, or label background of the wrong kind comes back as a typed error", () => {
    // Verifies: ADR-0028, ADR-0034
    const label = (fields: object) => ({ text: "x", t: 0.5, offset: 0, ...fields });
    const errors = [
      graph([{ ...node("a", 0, 0), title: 5 as unknown as string }]),
      graph(two(), [{ ...edge("e", "a", "b"), label: label({ text: null }) as never }]),
      graph(two(), [{ ...edge("e", "a", "b"), label: label({ background: -5 }) }]),
    ].map((batch) => {
      try {
        bridge.loadGraph(batch);
      } catch (error) {
        return error;
      }
    });
    expect(errors).toEqual([
      { kind: "invalidTitle", node: "a" },
      { kind: "invalidLabelText", edge: "e" },
      { kind: "invalidBackground", edge: "e" },
    ]);
  });

  test("a patch of a node comes back as a typed error unless it holds only a title", () => {
    // Verifies: ADR-0028, ADR-0034
    expect(bridge.checkNodePatch("a", plain({ title: "A" }))).toEqual({ title: "A" });
    expect(bridge.checkNodePatch("a", plain({}))).toEqual({});
    const errors = [{ id: "b" }, { title: 5 }].map((patch) => {
      try {
        bridge.checkNodePatch("a", patch as never);
      } catch (error) {
        return error;
      }
    });
    expect(errors).toEqual([
      { kind: "unknownPatchField", node: "a", field: "id" },
      { kind: "invalidTitle", node: "a" },
    ]);
  });
});

describe("bridge query", () => {
  test("a query reads the slots in a rectangle", () => {
    bridge.loadGraph(row(5));
    const visible = bridge.query({ minX: 350, minY: 0, maxX: 450, maxY: 50 }, "near", 4, 0);
    // n2 spans 400..500; of its edges, n1→n2 runs over 300..400 and meets 350..450, n2→n3 runs
    // over 500..600 and does not.
    expect([...visible.nodes]).toEqual([2]);
    // The edges it found, and their ends, are asked for when needed.
    const drawn = bridge.drawnEdges();
    expect([...drawn.slots]).toEqual([1]);
    expect([...drawn.ends]).toEqual([300, 25, 400, 25]);
  });

  test("a query read after memory grew holds the current slots", () => {
    // Verifies: ADR-0034
    bridge.loadGraph(row(3));
    expect([...bridge.query(everywhere, "near", 4, 0).nodes]).toEqual([0, 1, 2]);
    bridge.loadGraph(row(200_000));
    bridge.query(everywhere, "near", 4, 0);
    bridge.loadGraph(row(4));
    const visible = bridge.query({ minX: 590, minY: 0, maxX: 2000, maxY: 50 }, "near", 4, 0);
    expect([...visible.nodes]).toEqual([3]);
    expect([...bridge.drawnEdges().slots]).toEqual([2]);
  });

  test("a query after a move finds the node at its new place", () => {
    bridge.loadGraph(row(3));
    bridge.translate(new Uint32Array([0]), 0, 5000);
    const visible = bridge.query({ minX: -10, minY: 4990, maxX: 10, maxY: 5010 }, "near", 4, 0);
    expect([...visible.nodes]).toEqual([0]);
  });

  test("a label is found by its point, within the reach", () => {
    bridge.loadGraph(
      graph(
        [node("a", 0, 0), node("b", 200, 0)],
        [{ ...edge("e", "a", "b"), label: { text: "x", t: 0.5, offset: 12 } }],
      ),
    );
    // The edge runs level from (100, 25) to (200, 25); its label sits at (150, 13).
    const near = bridge.query({ minX: 140, minY: -100, maxX: 160, maxY: 0 }, "near", 4, 13);
    expect([...near.labels]).toEqual([0]);
    // The point crosses relative to the query's origin (ADR-0034).
    expect(near.labelPoints[0]! + near.origin.x).toBeCloseTo(150, 4);
    expect(near.labelPoints[1]! + near.origin.y).toBeCloseTo(13, 4);
    expect([
      ...bridge.query({ minX: 140, minY: -100, maxX: 160, maxY: 0 }, "near", 4, 12).labels,
    ]).toEqual([]);
  });
});

describe("bridge mesh and hit", () => {
  test("a query builds the mesh of the edges it found, in their colours", () => {
    bridge.loadGraph(
      graph(
        [node("a", 0, 0), node("b", 200, 0)],
        [{ ...edge("e", "a", "b"), dash: [6, 4], arrow: "end" }],
      ),
    );
    const { mesh, detail } = bridge.query(everywhere, "near", 1, 0);
    expect(detail).toBe("complete");
    const vertices = mesh.distances.length;
    expect(vertices).toBeGreaterThan(3);
    expect(mesh.positions.length).toBe(2 * vertices);
    expect(mesh.dashes.length).toBe(2 * vertices);
    expect(mesh.indices.length % 3).toBe(0);
    expect(Math.max(...mesh.indices)).toBe(vertices - 1);
    const rgba = new Uint8Array(mesh.colors.buffer, mesh.colors.byteOffset, 4);
    expect([...rgba]).toEqual([0x22, 0xa5, 0x5b, 0xff]);
    // The arrowhead comes first, its tip at the target's left middle.
    expect([...mesh.positions.slice(0, 2)]).toEqual([200, 25]);
  });

  test("a query far from the world's origin hands over its mesh relative to its origin", () => {
    // Verifies: ADR-0034
    bridge.loadGraph(
      graph(
        [node("a", 5e7, 0), node("b", 5e7 + 200, 0)],
        [{ ...edge("e", "a", "b"), arrow: "end" }],
      ),
    );
    const rect = { minX: 5e7 - 100, minY: -100, maxX: 5e7 + 300, maxY: 300 };
    const { mesh, origin } = bridge.query(rect, "near", 0.25, 0);
    // The centre (5e7 + 100, 100) snapped to the grid of 512 that holds the side of 400.
    expect(origin).toEqual({ x: 97_656 * 512, y: 0 });
    // The arrowhead's tip, at the target's left middle (5e7 + 200, 25), less the origin.
    expect([...mesh.positions.slice(0, 2)]).toEqual([5e7 + 200 - origin.x, 25]);
  });

  test("a query at the far level draws thin lines without arrowheads", () => {
    bridge.loadGraph(
      graph([node("a", 0, 0), node("b", 200, 0)], [{ ...edge("e", "a", "b"), arrow: "end" }]),
    );
    const { mesh } = bridge.query(everywhere, "far", 1, 0);
    // Two vertices per point and no arrowhead: the first vertex lies at the source, not the tip.
    expect(mesh.indices.length).toBe(3 * (mesh.distances.length - 2));
    expect([...mesh.positions.slice(0, 2)]).toEqual([100, 25.5]);
  });

  test("a hit finds the node drawn on top at a point", () => {
    bridge.loadGraph(graph([node("a", 0, 0), node("b", 50, 25), node("c", 500, 0)]));
    expect(nodeAt(10, 10)).toBe(0);
    expect(nodeAt(60, 30)).toBe(1);
    expect(nodeAt(300, 10)).toBeUndefined();
    bridge.translate(new Uint32Array([2]), -440, 0);
    expect(nodeAt(70, 10)).toBe(2);
  });
});

describe("bridge additions", () => {
  test("an added node takes the next slot, is found where it was placed, and drawn and hit on top", () => {
    // Verifies: ADR-0022
    bridge.loadGraph(graph([node("a", 0, 0), node("b", 40, 20)]));
    expect(bridge.addNode(added(node("c", 20, 10)))).toBe(2);
    expect([...bridge.positions()]).toEqual([0, 0, 40, 20, 20, 10]);
    const visible = bridge.query({ minX: 0, minY: 0, maxX: 200, maxY: 200 }, "near", 1, 0);
    expect([...visible.nodes]).toEqual([0, 1, 2]);
    // (45, 25) lies in all three; c, added last, is on top.
    expect(nodeAt(45, 25)).toBe(2);
  });

  test("an added node the bridge refuses comes back as a typed error, the graph as it was", () => {
    // Verifies: ADR-0028, Q-7
    bridge.loadGraph(graph([node("a", 0, 0)]));
    const refusals = [
      added({ ...node("c", 0, 0), x: Number.POSITIVE_INFINITY }),
      added({ ...node("c", 0, 0), title: 5 }),
      added({ ...node("c", 0, 0), height: false }),
      added({ ...node("c", 0, 0), id: "x".repeat(257) }),
      false as unknown as NodeSnapshot,
    ].map((refused) => {
      try {
        bridge.addNode(refused);
        return "accepted";
      } catch (error) {
        return error;
      }
    });
    expect(refusals).toEqual([
      { kind: "nonFiniteCoordinate", node: "c" },
      { kind: "invalidTitle", node: "c" },
      { kind: "invalidField", list: "nodes", index: 0, id: "c", field: "height", expected: SIZE },
      { kind: "idTooLong", list: "nodes", index: 0, field: "id", limit: 256 },
      expect.objectContaining({ kind: "malformed" }),
    ]);
    expect([...bridge.positions()]).toEqual([0, 0]);
  });
});

describe("bridge removals", () => {
  test("a removed node takes its edges along, and its slot is the next addition's", () => {
    // Verifies: ADR-0022
    bridge.loadGraph(row(4));
    expect([...bridge.removeNodes(new Uint32Array([1]))]).toEqual([0, 1]);
    expect([...bridge.query(everywhere, "near", 1, 0).nodes]).toEqual([0, 2, 3]);
    expect([...bridge.drawnEdges().slots]).toEqual([2]);
    bridge.removeEdges(new Uint32Array([2]));
    bridge.query(everywhere, "near", 1, 0);
    expect([...bridge.drawnEdges().slots]).toEqual([]);
    expect(bridge.addNode(added(node("c", 200, 0)))).toBe(1);
    expect(nodeAt(205, 5)).toBe(1);
  });

  test("moveLabel on a free slot throws the SlotError the other slot exports throw", () => {
    // Verifies: ADR-0022
    bridge.loadGraph(row(3));
    bridge.removeEdges(new Uint32Array([1]));
    let refused: unknown = "accepted";
    try {
      bridge.moveLabel(1, 300, 0);
    } catch (error) {
      refused = error;
    }
    expect(refused).toEqual({ kind: "noEdge", slot: 1 });
  });

  test("a free slot is refused wherever a call names one, and the graph stays as it was", () => {
    // Verifies: ADR-0022
    bridge.loadGraph(row(3));
    bridge.removeNodes(new Uint32Array([2]));
    const refused = (call: () => unknown) => {
      try {
        call();
        return "accepted";
      } catch (error) {
        return error;
      }
    };
    expect(refused(() => bridge.removeNodes(new Uint32Array([0, 2])))).toEqual({
      kind: "noNode",
      slot: 2,
    });
    expect(refused(() => bridge.removeEdges(new Uint32Array([1])))).toEqual({
      kind: "noEdge",
      slot: 1,
    });
    expect(refused(() => bridge.translate(new Uint32Array([2]), 1, 1))).toEqual({
      kind: "noNode",
      slot: 2,
    });
    // addEdge and updateEdge throw the shell's mistake as the other exports do, no problem of data.
    expect(refused(() => bridge.addEdge(edgeOf(edge("x", "n0", "n2")), 0, 2))).toEqual({
      kind: "noNode",
      slot: 2,
    });
    expect(refused(() => bridge.updateEdge(1, "e1", plainEdge({ color: 0 })))).toEqual({
      kind: "noEdge",
      slot: 1,
    });
    bridge.query(everywhere, "near", 1, 0);
    expect([...bridge.drawnEdges().slots]).toEqual([0]);
    expect([...bridge.query(everywhere, "near", 1, 0).nodes]).toEqual([0, 1]);
    expect([...bridge.positions()].slice(0, 4)).toEqual([0, 0, 200, 0]);
  });
});

describe("the numbers the shell computes", () => {
  test("a point, a pixel, or a delta an export cannot take crosses as a NumberError of its kind", () => {
    // Verifies: ADR-0031
    bridge.loadGraph(row(2));
    const refused = (call: () => unknown) => {
      try {
        call();
        return "accepted";
      } catch (error) {
        return error;
      }
    };
    const point = { kind: "nonFinitePoint" };
    const pixel = { kind: "invalidPixel" };
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(refused(() => bridge.hit(bad, 0, 1, "near", true))).toEqual(point);
      expect(refused(() => bridge.hit(0, bad, 1, "near", true))).toEqual(point);
      expect(refused(() => bridge.moveLabel(0, bad, 0))).toEqual(point);
      expect(refused(() => bridge.hit(0, 0, bad, "near", true))).toEqual(pixel);
      expect(refused(() => bridge.query(everywhere, "near", bad, 0))).toEqual(pixel);
      expect(refused(() => bridge.translate(new Uint32Array([0]), bad, 0))).toEqual({
        kind: "nonFiniteDelta",
      });
    }
    for (const bad of [0, -1]) {
      expect(refused(() => bridge.hit(0, 0, bad, "near", true))).toEqual(pixel);
      expect(refused(() => bridge.query(everywhere, "near", bad, 0))).toEqual(pixel);
    }
    expect([...bridge.positions()]).toEqual([0, 0, 200, 0]);
  });
});

describe("a trap", () => {
  test("loses the engine: every later call throws an EngineLostError, and the listeners hear it once", () => {
    // Verifies: ADR-0021
    const fixture = new URL("./trap.fixture.ts", import.meta.url).pathname;
    const run = Bun.spawnSync([process.execPath, "run", fixture], {
      env: { ...process.env, NODE_ENV: "test" },
    });
    expect(run.stderr.toString()).toBe("");
    const lost = "EngineLostError (RuntimeError)";
    expect(JSON.parse(run.stdout.toString())).toEqual({
      before: "ok",
      trap: lost,
      after: [lost, lost, lost, lost],
      told: ["before: EngineLostError", "after: EngineLostError"],
    });
  });
});
