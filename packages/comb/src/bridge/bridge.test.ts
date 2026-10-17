import { beforeAll, describe, expect, test } from "bun:test";
import { createBridgeSync, type Bridge } from ".";

let bridge: Bridge;

beforeAll(async () => {
  const bytes = await Bun.file(new URL("../../wasm/engine_bg.wasm", import.meta.url)).arrayBuffer();
  bridge = createBridgeSync(bytes);
});

const node = (id: string, x: number, y: number) => ({ id, x, y });

describe("bridge", () => {
  test("positions are read back in slot order", () => {
    expect(bridge.loadNodes({ nodes: [node("a", 1, 2), node("b", 3, 4)] })).toBe(2);
    expect([...bridge.positions()]).toEqual([1, 2, 3, 4]);
  });

  test("a move is visible through a fresh view", () => {
    bridge.loadNodes({ nodes: [node("a", 0, 0), node("b", 10, 10)] });
    bridge.translate(new Uint32Array([1]), 5, -5);
    expect([...bridge.positions()]).toEqual([0, 0, 15, 5]);
  });

  test("a view read after memory grew still sees the positions", () => {
    bridge.loadNodes({ nodes: [node("a", 7, 8)] });
    const big = Array.from({ length: 200_000 }, (_, i) => node(`n${i}`, i, i));
    bridge.loadNodes({ nodes: big });
    bridge.loadNodes({ nodes: [node("a", 7, 8)] });
    expect([...bridge.positions()]).toEqual([7, 8]);
  });

  test("malformed graph data comes back as a typed error", () => {
    expect(() => bridge.loadNodes({ nodes: [node("a", Number.NaN, 0)] })).toThrow();
    try {
      bridge.loadNodes({ nodes: [node("a", 0, 0), node("a", 1, 1)] });
    } catch (error) {
      expect(error).toEqual({ kind: "duplicateNode", node: "a" });
    }
    expect.assertions(2);
  });

  test("a label sits at its path point moved along the normal", () => {
    const at = bridge.labelPosition({ x: 0, y: 0 }, { x: 200, y: 0 }, 0.5, 12);
    expect(at.x).toBeCloseTo(100, 6);
    expect(at.y).toBeCloseTo(-12, 6);
  });
});
