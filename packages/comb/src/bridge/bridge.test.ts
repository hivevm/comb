import { beforeAll, describe, expect, test } from "bun:test";
import { createBridgeSync, type Bridge, type GraphBatch } from ".";

let bridge: Bridge;

beforeAll(async () => {
  const bytes = await Bun.file(new URL("../../wasm/engine_bg.wasm", import.meta.url)).arrayBuffer();
  bridge = createBridgeSync(bytes);
});

const node = (id: string, x: number, y: number) => ({ id, x, y, width: 100, height: 50 });
const edge = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  color: 0x22a55b,
  arrow: "none" as const,
});
const graph = (nodes: GraphBatch["nodes"], edges: GraphBatch["edges"] = []) => ({ nodes, edges });
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

  test("malformed graph data comes back as a typed error", () => {
    // Verifies: ADR-0010
    expect(() => bridge.loadGraph(graph([node("a", Number.NaN, 0)]))).toThrow();
    const errors = [
      graph([node("a", 0, 0), node("a", 1, 1)]),
      graph([node("a", 0, 0)], [edge("e", "a", "z")]),
      graph([{ ...node("a", 0, 0), width: -1 }]),
      graph(
        [node("a", 0, 0), node("b", 1, 1)],
        [{ ...edge("e", "a", "b"), arrow: "start" as "end" }],
      ),
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
      { kind: "invalidSize", node: "a" },
      expect.objectContaining({ kind: "malformed" }),
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
        [{ ...edge("e", "a", "b"), label: { t: 0.5, offset: 12 } }],
      ),
    );
    // The edge runs level from (100, 25) to (200, 25); its label sits at (150, 13).
    const near = bridge.query({ minX: 140, minY: -100, maxX: 160, maxY: 0 }, "near", 4, 13);
    expect([...near.labels]).toEqual([0]);
    expect(near.labelPoints[0]).toBeCloseTo(150, 4);
    expect(near.labelPoints[1]).toBeCloseTo(13, 4);
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
    const { mesh } = bridge.query(everywhere, "near", 1, 0);
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
