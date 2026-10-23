import { beforeAll, describe, expect, test } from "bun:test";
import { createBridgeSync, type Bridge, type GraphBatch } from ".";

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
});
const graph = (nodes: GraphBatch["nodes"], edges: GraphBatch["edges"] = []) => ({ nodes, edges });
/** Nodes `a` and `b`. */
const two = () => [node("a", 0, 0), node("b", 1, 1)];
const everywhere = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

/** A row of `count` nodes 200 apart, each linked to the next. */
function row(count: number): GraphBatch {
  const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`, i * 200, 0));
  const edges = nodes.slice(1).map((_, i) => edge(`e${i}`, `n${i}`, `n${i + 1}`));
  return graph(nodes, edges);
}

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
    // Verifies: ADR-0010
    bridge.loadGraph(graph([node("a", 7, 8)]));
    const big = Array.from({ length: 200_000 }, (_, i) => node(`n${i}`, i, i));
    bridge.loadGraph(graph(big));
    bridge.loadGraph(graph([node("a", 7, 8)]));
    expect([...bridge.positions()]).toEqual([7, 8]);
  });

  test("in test mode, every call detaches the views taken before it", () => {
    // Verifies: ADR-0010
    // Under `bun test` the bridge runs in test mode: it grows the engine's memory before each of
    // its calls, so a view kept across any call reads empty, not only when memory happens to grow.
    // Only a grown memory detaches its buffer, so an empty view shows that the call grew it.
    bridge.loadGraph(graph([node("a", 1, 2), node("b", 3, 4)]));
    const calls: [string, () => unknown][] = [
      ["loadGraph", () => bridge.loadGraph(graph([node("a", 1, 2), node("b", 3, 4)]))],
      ["checkNodePatch", () => bridge.checkNodePatch("a", { title: "A" })],
      ["translate", () => bridge.translate(new Uint32Array([0]), 0, 0)],
      ["positions", () => bridge.positions()],
      ["query", () => bridge.query(everywhere, "near", 4, 0)],
      ["drawnEdges", () => bridge.drawnEdges()],
      ["hit", () => bridge.hit(0, 0)],
    ];
    const after = calls.map(([name, call]) => {
      const kept = bridge.positions();
      call();
      return { name, kept: kept.length };
    });
    expect(after).toEqual(calls.map(([name]) => ({ name, kept: 0 })));
  });

  test("malformed graph data comes back as a typed error", () => {
    // Verifies: ADR-0010
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

/** Nodes `a` and `b` and an edge `e` between them with every field of its own, with `path`
 *  (`node.…` for `b`, `edge.…` for `e`) set to `value`, or left out where `value` is absent. */
function corrupted(path: string, corruption: { value?: unknown }): GraphBatch {
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
      // Verifies: ADR-0010
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
    // Verifies: ADR-0010
    const refused = { id: false, title: false, x: false, y: false, width: false, height: false };
    const nodes = Array.from({ length: 1_000_000 }, () => ({ ...refused }));
    const start = performance.now();
    let problem: unknown = null;
    try {
      bridge.loadGraph({ nodes, edges: [] } as never);
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
    // Only the first is read: each refused value costs an error of serde-wasm-bindgen, about six
    // seconds for all six million of them.
    expect(ms).toBeLessThan(1000);
  });

  test("a message names no Rust type or crate", () => {
    // Verifies: ADR-0010
    const refusals = [
      ...CORRUPTIONS.map(
        (corruption) => () => bridge.loadGraph(corrupted(corruption.field, corruption)),
      ),
      () => bridge.loadGraph(5 as never),
      () => bridge.loadGraph({ nodes: [5], edges: [] } as never),
      () => bridge.loadGraph({ nodes: [], edges: "e" } as never),
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

/** What names a Rust type or crate: a path, a backtick, a primitive or a type of the bridge crate,
 *  serde, or JsValue. */
const RUST =
  /::|`|\b(?:f32|f64|u8|u32|u64|i32|i64|usize|isize|str|String|Vec|Option|JsValue|serde\w*|comb_\w+|GraphBatch|NodeInput|EdgeInput|LabelInput|Arrow|[A-Z][a-z]+[A-Z]\w*)\b/;

describe("bridge fields the engine does not keep", () => {
  test("a title, label text, or label background of the wrong kind comes back as a typed error", () => {
    // Verifies: ADR-0009, ADR-0010
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
    // Verifies: ADR-0009, ADR-0010
    expect(bridge.checkNodePatch("a", { title: "A" })).toEqual({ title: "A" });
    expect(bridge.checkNodePatch("a", {})).toEqual({});
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
    // Verifies: ADR-0010
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
    // The point crosses relative to the query's origin (ADR-0010).
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
    // Verifies: ADR-0010
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
    expect(bridge.hit(10, 10)).toBe(0);
    expect(bridge.hit(60, 30)).toBe(1);
    expect(bridge.hit(300, 10)).toBeUndefined();
    bridge.translate(new Uint32Array([2]), -440, 0);
    expect(bridge.hit(70, 10)).toBe(2);
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
