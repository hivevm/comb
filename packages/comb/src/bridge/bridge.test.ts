import { beforeAll, describe, expect, test } from "bun:test";
import {
  createBridgeSync,
  edgeColumns,
  nodeColumns,
  PIECE_BOUND,
  type Bridge,
  type NodeColumnWriter,
  type GraphSnapshot,
  type NodePatch,
  type EdgeSnapshot,
  type NodeSnapshot,
  type PlainEdgePatch,
  type PlainPatch,
} from ".";
import { listsOf, nodeSnapshotOf, patchOf, snapshotOf } from "../api/snapshot";
import {
  DirectionCode,
  EdgeField,
  KindCode,
  NodeField,
  RoleCode,
  SideCode,
} from "../../wasm/engine.js";

let bridge: Bridge;

beforeAll(async () => {
  const bytes = await Bun.file(new URL("../../wasm/engine_bg.wasm", import.meta.url)).arrayBuffer();
  bridge = createBridgeSync(bytes);
});

/** The content of a node of the time before content: one row of one title, `title`. */
const titled = (title: string) => [
  [{ kind: "text" as const, role: "title" as const, text: title, weight: 1 }],
];
/** A node of one title, 100 wide: 64 high, the least height of a node (ADR-0013). */
const node = (id: string, x: number, y: number) => ({
  id,
  x,
  y,
  width: 100,
  content: titled(id),
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
/** Writes the plain content `content` of the node just started into `columns`, as the snapshot
 *  writes a node's content. */
function writeContent(columns: NodeColumnWriter, content: unknown) {
  if (!Array.isArray(content)) return columns.noContent();
  for (const cells of content as unknown[]) {
    if (!Array.isArray(cells)) columns.noRow();
    else if (cells.length === 0) columns.endRow();
    else
      cells.forEach((element: unknown, c) => {
        const last = c === cells.length - 1;
        if (typeof element !== "object" || element === null || Array.isArray(element))
          columns.noElement(last);
        else {
          const { kind, role, weight, color, text, id } = element as Record<string, unknown>;
          if (kind === "metric") return writeMetric(columns, element as object, last);
          if (kind !== "progress")
            return columns.element(kind, role, weight, color, text, id, last);
          // A progress bar's segments follow it before its row ends.
          columns.element(kind, role, weight, undefined, undefined, undefined, false);
          writeSegments(columns, (element as Record<string, unknown>).segments);
          if (last) columns.endRow();
        }
      });
  }
}
/** Writes the plain metric `metric` into `columns`, its trend's fields where it is an object. */
function writeMetric(columns: NodeColumnWriter, metric: object, last: boolean) {
  const { weight, caption, value, trend } = metric as Record<string, unknown>;
  const fields = (typeof trend === "object" && trend !== null ? trend : {}) as Record<
    string,
    unknown
  >;
  columns.metric(weight, caption, value, fields.direction, fields.color, fields.text, last);
}
/** Writes the plain segments `segments` of the progress bar just written into `columns`. */
function writeSegments(columns: NodeColumnWriter, segments: unknown) {
  if (!Array.isArray(segments)) return columns.noSegments();
  for (const segment of segments as unknown[]) {
    if (typeof segment !== "object" || segment === null || Array.isArray(segment))
      columns.noSegment();
    else {
      const { fraction, color } = segment as Record<string, unknown>;
      columns.segment(fraction, color);
    }
  }
}
const graph = (nodes: readonly PlainNode[], edges: readonly object[] = [], bound = PIECE_BOUND) => {
  const columns = nodeColumns(nodes.length, bound);
  for (const n of nodes as readonly unknown[]) {
    if (typeof n !== "object" || n === null) columns.noObject();
    else {
      const { id, x, y, width, content } = n as Record<string, unknown>;
      columns.node(id, x, y, width);
      writeContent(columns, content);
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
/** A font whose glyphs advance by 7 and whose lines are 16 apart. */
const FONT = {
  codes: new Uint32Array(0),
  advances: new Float64Array(0),
  fallback: 7,
  lineHeight: 16,
};
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
      ["updateNode", () => bridge.updateNode(0, "n0", plain({ content: titled("A") }))],
      ["addNode", () => bridge.addNode(added(node("c", 5, 6)))],
      ["nodeBuffers", () => bridge.nodeBuffers()],
      ["content", () => bridge.content(0)],
      ["setFont", () => bridge.setFont("body", FONT)],
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
const CONTENT = "a list of rows";

/** One field of node `b` or edge `e` corrupted, with a value of another type or by leaving it out,
 *  each with the problem the bridge reports for it. A field that may be left out (an edge's label
 *  and dash, a label's background) is only given a value of another type. */
const CORRUPTIONS: { field: string; value?: unknown; problem: object }[] = [
  ...["x", "y", "width", "content"].flatMap((field) => {
    const expected = field === "width" ? SIZE : field === "content" ? CONTENT : NUMBER;
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
    field: "node.content.text",
    ...corruption,
    problem: { kind: "invalidContentText", node: "b", row: 0, column: 0, field: "text" },
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
  const title: Record<string, unknown> = { kind: "text", role: "title", text: "b", weight: 1 };
  const b: Record<string, unknown> = { ...node("b", 300, 0), content: [[title]] };
  const label: Record<string, unknown> = { text: "x", t: 0.5, offset: 0, background: 0x123456 };
  const e: Record<string, unknown> = { ...edge("e", "a", "b"), label, dash: [6, 4] };
  const [item, ...field] = path.split(".");
  const inner = item === "node" ? title : label;
  const target = field.length > 1 ? inner : item === "node" ? b : e;
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
    const refused = { id: false, x: false, y: false, width: false, content: false };
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
      () => bridge.updateNode(0, "a", 5 as never),
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
  contentBudget: bridge.contentBudget(),
  rows: bridge.rowLimit(),
  columns: bridge.columnLimit(),
  segments: bridge.segmentLimit(),
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
    const nodes = ids.map((id, i) => ({ ...node(id, i * 300, 0), content: titled(titles[i]!) }));
    const edges = [edge("e0", ids[1]!, ids[2]!), edge("e1", ids[3]!, ids[0]!)];
    const { kept, snapshot } = snapshotted(nodes, edges);
    expect(kept.nodes.map((n) => n.id)).toEqual(ids);
    expect(bridge.loadGraph(snapshot)).toBe(4);
    // The engine keeps the titles, and hands each back as it was given.
    const title = (slot: number) => {
      const element = bridge.content(slot)[0]![0]!;
      return element.kind === "text" ? element.text : undefined;
    };
    expect([0, 1, 2, 3].map(title)).toEqual(titles);
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
      outcome(() => bridge.loadGraph(longer({ ...nodes[0]!, content: titled(titles[0] + "x") }))),
    ).toEqual({
      kind: "contentTextTooLong",
      node: ids[0],
      row: 0,
      column: 0,
      field: "text",
      limit: 1000,
    });
  });
});

describe("bridge actions", () => {
  /** A node `b` of a title and an action whose identifier is `id`. */
  const withAction = (id: unknown) => ({
    ...node("b", 300, 0),
    content: [
      [{ kind: "text", role: "title", text: "Bet" }],
      [{ kind: "action", text: "Details", id }],
    ],
  });

  test("an action crosses with its identifier among the names and comes back as given", () => {
    // Verifies: ADR-0013, ADR-0034
    const { snapshot } = snapshotted([node("a", 0, 0), withAction("\u{1F600}details")]);
    expect(snapshot.nodes.content.names).toEqual(["\u{1F600}details"]);
    expect([...snapshot.nodes.content.kinds]).toEqual([
      KindCode.Text,
      KindCode.Text,
      KindCode.Action,
    ]);
    expect(bridge.loadGraph(snapshot)).toBe(2);
    expect(bridge.content(1)[1]).toEqual([
      { kind: "action", text: "Details", id: "\u{1F600}details", weight: 1 },
    ]);
  });

  test("an action whose identifier is no string or too long is refused naming the node", () => {
    // Verifies: ADR-0013, ADR-0034, Q-7
    const at = { node: "b", row: 1, column: 0, field: "id" };
    const cases: [unknown, object][] = [
      [undefined, { kind: "invalidContentText", ...at }],
      [5, { kind: "invalidContentText", ...at }],
      ["\ud800", { kind: "invalidContentText", ...at }],
      ["d".repeat(1001), { kind: "contentTextTooLong", ...at, limit: 1000 }],
    ];
    for (const [id, problem] of cases) {
      const { snapshot } = snapshotted([node("a", 0, 0), withAction(id)]);
      expect(outcome(() => bridge.loadGraph(snapshot))).toEqual(problem);
    }
    // Through `addNode` alike, and an identifier at the limit is taken.
    bridge.loadGraph(snapshotted([node("a", 0, 0)]).snapshot);
    expect(outcome(() => bridge.addNode(added(withAction(5))))).toEqual({
      kind: "invalidContentText",
      ...at,
    });
    expect(bridge.addNode(added(withAction("d".repeat(1000))))).toBe(1);
  });
});

/** A node `b` of a title and, below it, a badge showing `text` on `color`. */
const withBadge = (text: unknown, color: unknown) => ({
  ...node("b", 300, 0),
  content: [[{ kind: "text", role: "title", text: "Bet" }], [{ kind: "badge", text, color }]],
});

describe("bridge badges", () => {
  test("a badge crosses with its colour among the numbers, is drawn near on it, and comes back as given", () => {
    // Verifies: ADR-0013, ADR-0034
    const { snapshot } = snapshotted([node("a", 0, 0), withBadge("Done", 0x22c55e)]);
    const c = snapshot.nodes.content;
    expect([...c.kinds]).toEqual([KindCode.Text, KindCode.Text, KindCode.Badge]);
    expect([...c.colors]).toEqual([Number.NaN, Number.NaN, 0x22c55e]);
    expect([...c.roles]).toEqual([RoleCode.Title, RoleCode.Title, 0]);
    expect(c.names).toEqual([]);
    // A body whose glyphs advance by 7: "Done" on a pill 28 + 2 * 8 wide and 16 + 2 * 3 high,
    // at the left of its column of 76 below the title.
    bridge.setFont("body", FONT);
    expect(bridge.loadGraph(snapshot)).toBe(2);
    const near = bridge.query(everywhere, "near", 1, 0).content;
    expect([...near.kinds]).toEqual([KindCode.Text, KindCode.Text, KindCode.Badge]);
    expect([...near.roles]).toEqual([RoleCode.Title, RoleCode.Title, RoleCode.Body]);
    expect([...near.colors]).toEqual([0, 0, 0x22c55e]);
    expect([...near.rects.subarray(8, 12)]).toEqual([12, 28, 44, 22]);
    // The padding the pill was laid out with, by which the shell places the text on it.
    expect(near.badgePadding).toEqual({ x: 8, y: 3 });
    expect(near.texts).toBe("aBetDone");
    expect(bridge.nodeBuffers().sizes[3]).toBe(64);
    expect(bridge.content(1)[1]).toEqual([
      { kind: "badge", text: "Done", color: 0x22c55e, weight: 1 },
    ]);
    // A press on the pill reports the badge; beside it in its column, none.
    expect(bridge.hit(320, 35, 1, "near", false)).toMatchObject({
      kind: "node",
      slot: 1,
      element: { row: 1, column: 0, kind: "badge" },
    });
    expect(bridge.hit(370, 35, 1, "near", false)).not.toHaveProperty("element");
    // The middle level hits no badge, as it draws none.
    expect(bridge.hit(320, 35, 1, "middle", false)).not.toHaveProperty("element");
  });
});

describe("bridge badges refused", () => {
  test("a badge whose colour is no integer in 0 to 0xffffff, or whose text is malformed, is refused naming the node", () => {
    // Verifies: ADR-0013, ADR-0034, Q-7
    const at = { node: "b", row: 1, column: 0 };
    const color = { kind: "invalidContentColor", ...at };
    const cases: [unknown, unknown, object][] = [
      ["Done", -1, color],
      ["Done", 0x1000000, color],
      ["Done", 0.5, color],
      ["Done", Number.NaN, color],
      ["Done", "#22c55e", color],
      ["Done", undefined, color],
      [5, 0, { kind: "invalidContentText", ...at, field: "text" }],
      ["\ud800", 0, { kind: "invalidContentText", ...at, field: "text" }],
      ["d".repeat(1001), 0, { kind: "contentTextTooLong", ...at, field: "text", limit: 1000 }],
    ];
    for (const [text, shade, problem] of cases) {
      const { snapshot } = snapshotted([node("a", 0, 0), withBadge(text, shade)]);
      expect(outcome(() => bridge.loadGraph(snapshot))).toEqual(problem);
      // Through `addNode` and `updateNode` alike, as the snapshot reads a single node.
      bridge.loadGraph(snapshotted([node("a", 0, 0)]).snapshot);
      const single = nodeSnapshotOf(withBadge(text, shade), limits()).snapshot;
      expect(outcome(() => bridge.addNode(single))).toEqual(problem);
      const content = patchOf({ content: withBadge(text, shade).content }, limits());
      expect(outcome(() => bridge.updateNode(0, "b", content))).toEqual(problem);
    }
    // Both ends of the colours are taken.
    for (const shade of [0, 0xffffff]) {
      const { snapshot } = snapshotted([node("a", 0, 0), withBadge("Done", shade)]);
      expect(bridge.loadGraph(snapshot)).toBe(2);
      expect(bridge.content(1)[1]).toEqual([
        { kind: "badge", text: "Done", color: shade, weight: 1 },
      ]);
    }
  });
});

/** A node `b` of a title and, below it, a progress bar of `segments`. */
const withProgress = (segments: unknown) => ({
  ...node("b", 300, 0),
  content: [[{ kind: "text", role: "title", text: "Bet" }], [{ kind: "progress", segments }]],
});
const [GREEN, GREY] = [0x22c55e, 0x9ca3af];

describe("bridge progress bars", () => {
  test("a progress bar crosses with its segments among the numbers, is drawn near as its segments and track, and comes back as given", () => {
    // Verifies: ADR-0013, ADR-0034
    const segments = [
      { fraction: 0.3, color: GREEN },
      { fraction: 0.2, color: GREY },
    ];
    const { snapshot } = snapshotted([node("a", 0, 0), withProgress(segments)]);
    const c = snapshot.nodes.content;
    expect([...c.kinds]).toEqual([KindCode.Text, KindCode.Text, KindCode.Progress]);
    expect([...c.segmentBounds]).toEqual([0, 0, 0, 2]);
    expect([...c.fractions]).toEqual([0.3, 0.2]);
    expect([...c.segmentColors]).toEqual([GREEN, GREY]);
    // It fills no text: the two titles' alone.
    expect([...c.textValid]).toEqual([1, 1]);
    // Its cell is its column below the title, 76 wide, and a body's line of 16; its bar 8 high in
    // the middle of it, its segments 22.8 and 15.2 long from the column's left, then the track.
    bridge.setFont("body", FONT);
    expect(bridge.loadGraph(snapshot)).toBe(2);
    const near = bridge.query(everywhere, "near", 1, 0).content;
    expect([...near.kinds]).toEqual([KindCode.Text, KindCode.Text, KindCode.Progress]);
    expect([...near.rects.subarray(8, 12)]).toEqual([12, 28, 76, 16]);
    expect([...near.barBounds]).toEqual([0, 0, 0, 3]);
    expect([...near.barColors]).toEqual([GREEN, GREY, 0]);
    const expected = [12, 32, 22.8, 8, 34.8, 32, 15.2, 8, 50, 32, 38, 8];
    [...near.bars].forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 4));
    expect(near.texts).toBe("aBet");
    expect(bridge.content(1)[1]).toEqual([{ kind: "progress", segments, weight: 1 }]);
    // A press on its line in its column reports the bar, above the bar too; the middle level hits
    // none, as it draws none.
    for (const y of [29, 36])
      expect(bridge.hit(380, y, 1, "near", false)).toMatchObject({
        kind: "node",
        slot: 1,
        element: { row: 1, column: 0, kind: "progress" },
      });
    expect(bridge.hit(320, 36, 1, "middle", false)).not.toHaveProperty("element");
  });

  test("a snapshot hands over one segment beyond the limit at most", () => {
    // Verifies: ADR-0034, Q-7
    const many = Array.from({ length: 20 }, () => ({ fraction: 0, color: 0 }));
    const { snapshot } = snapshotted([withProgress(many)]);
    expect([...snapshot.nodes.content.segmentBounds]).toEqual([0, 0, 9]);
    const single = nodeSnapshotOf(withProgress(many), limits()).snapshot as {
      content: { segments?: unknown[] }[][];
    };
    expect(single.content[1]![0]!.segments).toHaveLength(9);
  });
});

describe("bridge progress bars refused", () => {
  test("a progress bar whose segments are refused is named with its node and the segment, through every export", () => {
    // Verifies: ADR-0013, ADR-0034, Q-7
    const at = { node: "b", row: 1, column: 0 };
    const segment = (fraction: unknown, color: unknown = GREEN) => ({ fraction, color });
    const shape = (expected: string) => ({
      kind: "invalidContentShape",
      index: 1,
      id: "b",
      row: 1,
      column: 0,
      expected,
    });
    const cases: [unknown, object][] = [
      [[segment(-0.1)], { kind: "invalidFraction", ...at, segment: 0 }],
      [[segment(0.3), segment(Number.NaN)], { kind: "invalidFraction", ...at, segment: 1 }],
      [[segment(0.3), segment(Infinity)], { kind: "invalidFraction", ...at, segment: 1 }],
      [[segment(0.3), segment("0.2")], { kind: "invalidFraction", ...at, segment: 1 }],
      [[segment(0.3), segment(0.2, 0x1000000)], { kind: "invalidContentColor", ...at, segment: 1 }],
      [[segment(0.3), segment(0.2, "#fff")], { kind: "invalidContentColor", ...at, segment: 1 }],
      [[segment(0.3), { fraction: 0.2 }], { kind: "invalidContentColor", ...at, segment: 1 }],
      [Array(9).fill(segment(0.1)), { kind: "tooManySegments", ...at, limit: 8 }],
      [[segment(0.6), segment(0.4 + 2e-9)], { kind: "fractionsPastOne", ...at }],
      [5, shape("a list of segments")],
      [undefined, shape("a list of segments")],
      [[segment(0.3), null], shape("an object")],
      [[segment(0.3), [0.2, GREEN]], shape("an object")],
    ];
    for (const [segments, problem] of cases) {
      const { snapshot } = snapshotted([node("a", 0, 0), withProgress(segments)]);
      expect(outcome(() => bridge.loadGraph(snapshot))).toEqual(problem);
      // Through `addNode` and `updateNode` alike, as the snapshot reads a single node: the node
      // at index 0 there.
      const single = { ...problem, ...("index" in problem ? { index: 0 } : {}) };
      bridge.loadGraph(snapshotted([node("a", 0, 0)]).snapshot);
      const alone = nodeSnapshotOf(withProgress(segments), limits()).snapshot;
      expect(outcome(() => bridge.addNode(alone))).toEqual(single);
      const content = patchOf({ content: withProgress(segments).content }, limits());
      expect(outcome(() => bridge.updateNode(0, "b", content))).toEqual(single);
    }
    // At the limit, summing a little past 1 within what the bridge admits, and of no segments,
    // the bar is taken.
    for (const segments of [
      Array(8).fill(segment(0.125)),
      [segment(0.6), segment(0.4 + 5e-10)],
      [],
    ]) {
      const { snapshot } = snapshotted([node("a", 0, 0), withProgress(segments)]);
      expect(bridge.loadGraph(snapshot)).toBe(2);
    }
  });
});

/** A node `b` of a title and, below it, a metric "Revenue" over "42" and its trend `trend`. */
const withMetric = (trend: unknown, caption: unknown = "Revenue", value: unknown = "42") => ({
  ...node("b", 300, 0),
  content: [
    [{ kind: "text", role: "title", text: "Bet" }],
    [{ kind: "metric", caption, value, trend }],
  ],
});

describe("bridge metrics", () => {
  test("a metric crosses with its direction and colour, is drawn near as its three texts and its arrow, and comes back as given", () => {
    // Verifies: ADR-0013, ADR-0034
    const trend = { text: "+3%", direction: "up" as const, color: GREEN };
    const { snapshot } = snapshotted([node("a", 0, 0), withMetric(trend)]);
    const c = snapshot.nodes.content;
    expect([...c.kinds]).toEqual([KindCode.Text, KindCode.Text, KindCode.Metric]);
    expect([...c.directions]).toEqual([0, 0, DirectionCode.Up]);
    expect([...c.colors].slice(2)).toEqual([GREEN]);
    // Its caption, value, and trend's text among the texts, after the two titles.
    expect([...c.textValid]).toEqual([1, 1, 1, 1, 1]);
    expect([...c.textBounds]).toEqual([0, 1, 4, 11, 13, 16]);
    // Its cell is its column below the title, 76 wide, and two lines, 30; the caption on the
    // first, the value "42" at the left of the second, 14 wide, the arrow 8 after it, a square of
    // 10 in the middle of the line, and the trend's text 4 after the arrow, to the column's end.
    bridge.setFont("body", FONT);
    expect(bridge.loadGraph(snapshot)).toBe(2);
    const near = bridge.query(everywhere, "near", 1, 0).content;
    expect([...near.kinds]).toEqual([KindCode.Text, KindCode.Text, KindCode.Metric]);
    expect([...near.colors]).toEqual([0, 0, GREEN]);
    expect([...near.rects.subarray(8, 12)]).toEqual([12, 28, 76, 30]);
    expect(near.texts).toBe("aBetRevenue42+3%");
    expect([...near.partBounds]).toEqual([0, 0, 0, 3]);
    expect([...near.partEnds]).toEqual([11, 13, 16]);
    expect([...near.parts]).toEqual([12, 28, 76, 14, 12, 42, 14, 16, 48, 42, 40, 16]);
    expect([...near.arrowBounds]).toEqual([0, 0, 0, 1]);
    expect([...near.arrows]).toEqual([34, 55, 44, 55, 39, 45]);
    expect(bridge.content(1)[1]).toEqual([
      { kind: "metric", caption: "Revenue", value: "42", trend, weight: 1 },
    ]);
    // A press anywhere in its cell reports the metric; the middle level hits none, as it draws
    // none.
    for (const [x, y] of [
      [380, 30],
      [330, 50],
      [387, 57],
    ] as const)
      expect(bridge.hit(x, y, 1, "near", false)).toMatchObject({
        kind: "node",
        slot: 1,
        element: { row: 1, column: 0, kind: "metric" },
      });
    expect(bridge.hit(320, 50, 1, "middle", false)).not.toHaveProperty("element");
  });
});

describe("bridge metrics refused", () => {
  test("a metric whose direction, texts, or colour are refused is named with its node and the field, through every export", () => {
    // Verifies: ADR-0013, ADR-0034, Q-7
    const at = { node: "b", row: 1, column: 0 };
    const trend = (fields: object) => ({ text: "+3%", direction: "up", color: GREEN, ...fields });
    const direction = { kind: "invalidDirection", ...at };
    const color = { kind: "invalidContentColor", ...at };
    const text = (field: string) => ({ kind: "invalidContentText", ...at, field });
    const cases: [unknown, unknown, unknown, object][] = [
      [trend({ direction: "sideways" }), "Revenue", "42", direction],
      [trend({ direction: 1 }), "Revenue", "42", direction],
      [trend({ direction: undefined }), "Revenue", "42", direction],
      [5, "Revenue", "42", direction],
      [null, "Revenue", "42", direction],
      [[], "Revenue", "42", direction],
      [trend({ color: 0x1000000 }), "Revenue", "42", color],
      [trend({ color: "#fff" }), "Revenue", "42", color],
      [trend({ color: undefined }), "Revenue", "42", color],
      [trend({}), 5, "42", text("caption")],
      [trend({}), "Revenue", 42, text("value")],
      [trend({}), "Revenue", "\ud800", text("value")],
      [trend({ text: undefined }), "Revenue", "42", text("trend.text")],
      [
        trend({ text: "d".repeat(1001) }),
        "Revenue",
        "42",
        { kind: "contentTextTooLong", ...at, field: "trend.text", limit: 1000 },
      ],
      // The direction before the texts, the texts before the colour.
      [trend({ direction: "x", text: 5 }), 5, 5, direction],
      [trend({ color: -1 }), 5, "42", text("caption")],
    ];
    for (const [shown, caption, value, problem] of cases) {
      const { snapshot } = snapshotted([node("a", 0, 0), withMetric(shown, caption, value)]);
      expect(outcome(() => bridge.loadGraph(snapshot))).toEqual(problem);
      // Through `addNode` and `updateNode` alike, as the snapshot reads a single node.
      bridge.loadGraph(snapshotted([node("a", 0, 0)]).snapshot);
      const alone = nodeSnapshotOf(withMetric(shown, caption, value), limits()).snapshot;
      expect(outcome(() => bridge.addNode(alone))).toEqual(problem);
      const content = patchOf({ content: withMetric(shown, caption, value).content }, limits());
      expect(outcome(() => bridge.updateNode(0, "b", content))).toEqual(problem);
    }
    // Each direction, and both ends of the colours, are taken.
    for (const [shown, shade] of [
      ["up", 0],
      ["down", 0xffffff],
      ["flat", GREEN],
    ] as const) {
      const { snapshot } = snapshotted([
        node("a", 0, 0),
        withMetric(trend({ direction: shown, color: shade })),
      ]);
      expect(bridge.loadGraph(snapshot)).toBe(2);
    }
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
    const nodes = ids.map((id, i) => ({ ...node(id, i * 300, 0), content: titled("") }));
    const edges = ids.slice(1).map((id, i) => edge(id, ids[i]!, id));
    const snapshot = graph(nodes, edges, bound);
    const n = snapshot.nodes;
    const e = snapshot.edges;
    const columns: [string[], Uint32Array, readonly string[]][] = [
      [n.ids, n.idBounds, ids],
      [n.content.texts, n.content.textBounds, ids.map(() => "")],
      [e.ids, e.idBounds, ids.slice(1)],
      [e.sources, e.sourceBounds, ids.slice(0, -1)],
      [e.targets, e.targetBounds, ids.slice(1)],
      [e.labels, e.labelBounds, ids.slice(1).map(() => "")],
    ];
    for (const [pieces, bounds, values] of columns) expectPieces(pieces, bounds, values, bound);
    expect([n.ids.length, e.sources.length, n.content.texts.length, e.labels.length]).toEqual([
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
    expect(() => nodeColumns(1, 16).node("x".repeat(17), 0, 0, 1)).toThrow(RangeError);
    expect(() =>
      nodeColumns(1, 16).element("text", "title", 1, undefined, "x".repeat(17), undefined, true),
    ).toThrow(RangeError);
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

/** A text of `role` and weight `weight`, as the snapshot hands one over. */
const textOf = (role: string, value: unknown, weight: unknown = 1) => ({
  kind: "text",
  role,
  text: value,
  weight,
});

describe("bridge columns of a load's content", () => {
  test("rows of several texts cross as columns read back exactly per node, row, and element", () => {
    // Verifies: ADR-0034
    // Node a: a title beside a caption, then a body; node b: no rows; node c: a row of none, then
    // three texts beyond the basic plane. Cut with a small bound, the texts cross in pieces.
    const contents = [
      [
        [textOf("title", "A\u{1F600}", 2), textOf("caption", "cap", 0.5)],
        [textOf("body", "\u{1D49C}b")],
      ],
      [],
      [
        [],
        [
          textOf("title", "\u{10FFFF}"),
          textOf("body", ""),
          textOf("caption", "\u{1F601}".repeat(4)),
        ],
      ],
    ];
    const nodes = contents.map((content, i) => ({ ...node(`n${i}`, i * 300, 0), content }));
    const { nodes: n } = graph(nodes as never, [], 8);
    const c = n.content;
    expect([...c.rowBounds]).toEqual([0, 2, 2, 4]);
    expect([...c.elementBounds]).toEqual([0, 2, 3, 3, 6]);
    expect([...c.kinds]).toEqual(Array(6).fill(KindCode.Text));
    expect([...c.weights]).toEqual([2, 0.5, 1, 1, 1, 1]);
    const { Title, Body, Caption } = RoleCode;
    expect([...c.roles]).toEqual([Title, Caption, Body, Title, Body, Caption]);
    expect([...c.textValid]).toEqual(Array(6).fill(1));
    const texts = ["A\u{1F600}", "cap", "\u{1D49C}b", "\u{10FFFF}", "", "\u{1F601}".repeat(4)];
    expectPieces(c.texts, c.textBounds, texts, 8);
    expect(c.texts.length).toBeGreaterThan(1);
    expect(n.refused).toBeUndefined();
    // The engine reads them as they crossed: each node as high as its rows and padding, here below
    // the least height of a node.
    expect(bridge.loadGraph(graph(nodes as never, [], 8))).toBe(3);
    const heights = (sizes: Float32Array) => [sizes[1], sizes[3], sizes[5]];
    expect(heights(bridge.nodeBuffers().sizes)).toEqual([64, 64, 64]);
  });

  test("a kind, a role, a weight, or a text of another type crosses as its code or as none", () => {
    // Verifies: ADR-0034
    const content = [
      [
        { kind: "icon", role: "title", text: "x", weight: 1 },
        textOf("headline", "y"),
        textOf("body", 5, "1"),
      ],
    ];
    const { nodes: n } = graph([{ ...node("a", 0, 0), content } as never]);
    const c = n.content;
    expect([...c.kinds]).toEqual([KindCode.Unnamed, KindCode.Text, KindCode.Text]);
    expect([...c.roles]).toEqual([0, RoleCode.Unnamed, RoleCode.Body]);
    expect([...c.weights]).toEqual([1, 1, Number.NaN]);
    // The element of no kind fills no text; the others one each, the one of no string as none.
    expect([...c.textValid]).toEqual([1, 0]);
    expect(n.refused).toBeUndefined();
    expect(
      outcome(() => bridge.loadGraph(graph([{ ...node("a", 0, 0), content } as never]))),
    ).toEqual({
      kind: "invalidElementKind",
      node: "a",
      row: 0,
      column: 0,
    });
  });
});

describe("bridge shapes of content", () => {
  test("a row that is no list or an element that is no object is named where it lies", () => {
    // Verifies: ADR-0034
    const shaped = (content: unknown) =>
      graph([node("a", 0, 0), { ...node("b", 300, 0), content } as never]);
    const rows = shaped([[textOf("title", "t")], 5, "x"]);
    expect(rows.nodes.refused).toEqual({
      index: 1,
      field: NodeField.Row,
      row: 1,
      column: undefined,
    });
    // A row it cannot read crosses as a row of no elements, in its place.
    expect([...rows.nodes.content.rowBounds]).toEqual([0, 1, 4]);
    expect([...rows.nodes.content.elementBounds]).toEqual([0, 1, 2, 2, 2]);
    expect(outcome(() => bridge.loadGraph(rows))).toEqual({
      kind: "invalidContentShape",
      index: 1,
      id: "b",
      row: 1,
      expected: "a list of elements",
    });
    const element = shaped([[textOf("title", "t"), null, [textOf("body", "b")]]]);
    expect(element.nodes.refused).toEqual({
      index: 1,
      field: NodeField.Element,
      row: 0,
      column: 1,
    });
    // An element it cannot read crosses as one of no kind, which fills no text.
    expect([...element.nodes.content.kinds]).toEqual([
      KindCode.Text,
      KindCode.Text,
      KindCode.Unnamed,
      KindCode.Unnamed,
    ]);
    expect(outcome(() => bridge.loadGraph(element))).toEqual({
      kind: "invalidContentShape",
      index: 1,
      id: "b",
      row: 0,
      column: 1,
      expected: "an object",
    });
    // A position that names no row or column of the columns is refused as malformed.
    const nowhere = { ...element.nodes, refused: { ...element.nodes.refused!, row: 3 } };
    expect(outcome(() => bridge.loadGraph({ ...element, nodes: nowhere }))).toEqual({
      kind: "malformed",
      message: "the columns of the nodes do not fit together",
    });
  });
});

describe("bridge content that does not fit, and its layout", () => {
  test("content that does not fit together is refused as malformed, and the engine keeps working", () => {
    // Verifies: ADR-0034
    const { nodes, edges } = graph(two());
    const c = nodes.content;
    const misfits = [
      { ...c, rowBounds: new Uint32Array([0, 2, 1]) },
      { ...c, elementBounds: new Uint32Array([0, 1]) },
      { ...c, kinds: new Uint8Array([KindCode.Text, KindCode.Unnamed + 1]) },
      { ...c, roles: new Uint8Array([RoleCode.Title, RoleCode.Unnamed + 1]) },
      { ...c, textValid: new Uint8Array([1, 2]) },
      { ...c, weights: new Float64Array([1]) },
      { ...c, kinds: new Uint8Array([KindCode.Text, KindCode.Unnamed]) },
    ];
    for (const content of misfits) {
      expect(
        outcome(() => bridge.loadGraph({ nodes: { ...nodes, content }, edges } as never)),
      ).toEqual({
        kind: "malformed",
        message: "the columns of the nodes do not fit together",
      });
    }
    expect(bridge.loadGraph(graph(two()))).toBe(2);
  });
});

describe("bridge layout of content", () => {
  test("a query lays the content out at the near and middle level, and a patch lays it out anew", () => {
    // Verifies: ADR-0013
    bridge.setFont("title", { ...FONT, lineHeight: 18 });
    bridge.loadGraph(
      graph([node("a", 0, 0), { ...node("b", 300, 0), content: titled("abcdefghijklmnop") }]),
    );
    const near = bridge.query(everywhere, "near", 1, 0);
    expect([...near.nodes]).toEqual([0, 1]);
    expect([...near.content.bounds]).toEqual([0, 1, 2]);
    expect([...near.content.rects]).toEqual([12, 10, 76, 18, 12, 10, 76, 18]);
    // Sixteen glyphs of 7 pass 76: nine fit beside the ellipsis, which advances by 7 too.
    const { texts, textBounds, roles } = near.content;
    expect(texts).toBe("aabcdefghi\u2026");
    expect([...textBounds]).toEqual([0, 1, 11]);
    expect([...roles]).toEqual([RoleCode.Title, RoleCode.Title]);
    // The content as it was given, each weight as the engine keeps it.
    expect(bridge.content(1)).toEqual([
      [{ kind: "text", role: "title", text: "abcdefghijklmnop", weight: 1 }],
    ]);
    expect([...bridge.query(everywhere, "middle", 1, 0).content.bounds]).toEqual([0, 1, 2]);
    expect([...bridge.query(everywhere, "far", 1, 0).content.bounds]).toEqual([]);
    // Five rows: 10 + 18 + 4 * 16 + 10 = 102.
    const rows = [titled("t")[0]!, ...Array(4).fill([textOf("body", "b")])];
    bridge.updateNode(1, "b", plain({ content: rows as never }));
    expect(bridge.nodeBuffers().sizes[3]).toBe(102);
    expect(nodeAt(350, 100)).toBe(1);
    expect(nodeAt(50, 100)).toBeUndefined();
    const patched = bridge.query(everywhere, "near", 1, 0);
    expect([...patched.content.bounds]).toEqual([0, 1, 6]);
    expect([...patched.content.rects.subarray(8, 12)]).toEqual([12, 28, 76, 16]);
    expect(patched.content.texts).toBe("atbbbb");
    expect(outcome(() => bridge.updateNode(7, "c", plain({ content: titled("x") })))).toEqual({
      kind: "noNode",
      slot: 7,
    });
  });

  test("the texts of content of a load past the budget are refused naming the node that passes it", () => {
    // Verifies: ADR-0034, Q-7
    const budget = bridge.contentBudget();
    expect(budget).toBe(1_000_000_000);
    expect(outcome(() => bridge.checkContentBudget(budget, "n7"))).toBe("accepted");
    expect(outcome(() => bridge.checkContentBudget(budget + 1, "n7"))).toEqual({
      kind: "contentBudgetExceeded",
      node: "n7",
      limit: budget,
    });
    expect(outcome(() => bridge.checkContentBudget(Number.NaN, "n7"))).toMatchObject({
      kind: "malformed",
    });
  });

  test("a font the engine cannot take is refused as the shell's mistake", () => {
    // Verifies: ADR-0031
    for (const font of [
      { ...FONT, fallback: Number.NaN },
      { ...FONT, lineHeight: -1 },
      { ...FONT, codes: new Uint32Array([65]) },
    ]) {
      expect(outcome(() => bridge.setFont("caption", font))).toEqual({ kind: "invalidFont" });
    }
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
    for (const field of [8, 255, 2 ** 32 - 1]) {
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
      graph([{ ...node("a", 0, 0), content: titled(5 as unknown as string) }]),
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
      { kind: "invalidContentText", node: "a", row: 0, column: 0, field: "text" },
      { kind: "invalidLabelText", edge: "e" },
      { kind: "invalidBackground", edge: "e" },
    ]);
  });

  test("a patch of a node comes back as a typed error unless it holds only content", () => {
    // Verifies: ADR-0028, ADR-0034
    bridge.loadGraph(graph([node("a", 0, 0)]));
    expect(bridge.updateNode(0, "a", plain({ content: titled("A") }))).toBeUndefined();
    expect(bridge.updateNode(0, "a", plain({}))).toBeUndefined();
    const errors = [{ id: "b" }, { content: titled(5 as never) }, { content: 5 }].map((patch) => {
      try {
        bridge.updateNode(0, "a", patch as never);
      } catch (error) {
        return error;
      }
    });
    expect(errors).toEqual([
      { kind: "unknownPatchField", node: "a", field: "id" },
      { kind: "invalidContentText", node: "a", row: 0, column: 0, field: "text" },
      {
        kind: "invalidField",
        list: "nodes",
        index: 0,
        id: "a",
        field: "content",
        expected: CONTENT,
      },
    ]);
  });
});

describe("bridge query", () => {
  test("a query reads the slots in a rectangle", () => {
    bridge.loadGraph(row(5));
    const visible = bridge.query({ minX: 350, minY: 0, maxX: 450, maxY: 64 }, "near", 4, 0);
    // n2 spans 400..500; of its edges, n1→n2 runs over 300..400 and meets 350..450, n2→n3 runs
    // over 500..600 and does not.
    expect([...visible.nodes]).toEqual([2]);
    // The edges it found, and their ends, are asked for when needed.
    const drawn = bridge.drawnEdges();
    expect([...drawn.slots]).toEqual([1]);
    expect([...drawn.ends]).toEqual([300, 32, 400, 32]);
  });

  test("a query read after memory grew holds the current slots", () => {
    // Verifies: ADR-0034
    bridge.loadGraph(row(3));
    expect([...bridge.query(everywhere, "near", 4, 0).nodes]).toEqual([0, 1, 2]);
    bridge.loadGraph(row(200_000));
    bridge.query(everywhere, "near", 4, 0);
    bridge.loadGraph(row(4));
    const visible = bridge.query({ minX: 590, minY: 0, maxX: 2000, maxY: 64 }, "near", 4, 0);
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
    // The edge runs level from (100, 32) to (200, 32); its label sits at (150, 20).
    const near = bridge.query({ minX: 140, minY: -100, maxX: 160, maxY: 0 }, "near", 4, 20);
    expect([...near.labels]).toEqual([0]);
    // The point crosses relative to the query's origin (ADR-0034).
    expect(near.labelPoints[0]! + near.origin.x).toBeCloseTo(150, 4);
    expect(near.labelPoints[1]! + near.origin.y).toBeCloseTo(20, 4);
    expect([
      ...bridge.query({ minX: 140, minY: -100, maxX: 160, maxY: 0 }, "near", 4, 19).labels,
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
    expect([...mesh.positions.slice(0, 2)]).toEqual([200, 32]);
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
    // The arrowhead's tip, at the target's left middle (5e7 + 200, 32), less the origin.
    expect([...mesh.positions.slice(0, 2)]).toEqual([5e7 + 200 - origin.x, 32]);
  });

  test("a query at the far level draws thin lines without arrowheads", () => {
    bridge.loadGraph(
      graph([node("a", 0, 0), node("b", 200, 0)], [{ ...edge("e", "a", "b"), arrow: "end" }]),
    );
    const { mesh } = bridge.query(everywhere, "far", 1, 0);
    // Two vertices per point and no arrowhead: the first vertex lies at the source, not the tip.
    expect(mesh.indices.length).toBe(3 * (mesh.distances.length - 2));
    expect([...mesh.positions.slice(0, 2)]).toEqual([100, 32.5]);
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
      added({ ...node("c", 0, 0), content: titled(5 as never) }),
      added({ ...node("c", 0, 0), content: false }),
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
      { kind: "invalidContentText", node: "c", row: 0, column: 0, field: "text" },
      {
        kind: "invalidField",
        list: "nodes",
        index: 0,
        id: "c",
        field: "content",
        expected: CONTENT,
      },
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
