import { describe, expect, test } from "bun:test";
import type { Application } from "pixi.js";
import { attachInteraction } from ".";
import type { Bridge } from "../bridge";
import { createGraphStore } from "../store";

type Handler = (event: { global: { x: number; y: number } }) => void;

/** The parts of a PixiJS application interaction uses: a stage that takes listeners, a screen,
 *  and a canvas; `emit` plays a pointer event on the stage. */
function fakeApp() {
  const handlers = new Map<string, Handler[]>();
  const stage = {
    eventMode: "",
    hitArea: null as unknown,
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    removeAllListeners() {
      handlers.clear();
    },
  };
  const canvas = {
    style: { cursor: "" },
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  const app = { stage, canvas, screen: { width: 800, height: 600 } };
  const emit = (name: string, x: number, y: number) =>
    handlers.get(name)?.forEach((handler) => handler({ global: { x, y } }));
  return { app: app as unknown as Application, emit };
}

/** A bridge with one node under every point, which records the moves it is asked for. */
function fakeBridge() {
  const moves: { slots: number[]; dx: number; dy: number }[] = [];
  const bridge = {
    hit: () => 0,
    translate: (slots: Uint32Array, dx: number, dy: number) =>
      moves.push({ slots: [...slots], dx, dy }),
  };
  return { bridge: bridge as unknown as Bridge, moves };
}

describe("interaction", () => {
  test("a drag across many frames moves the node through the engine and keeps the graph", () => {
    // Verifies: ADR-0011
    const store = createGraphStore();
    store.getState().load({
      nodes: [{ id: "a", title: "A", x: 0, y: 0, width: 100, height: 40 }],
      edges: [],
    });
    const { app, emit } = fakeApp();
    const { bridge, moves } = fakeBridge();
    attachInteraction(app, store, bridge);
    const { nodes, edges, slots } = store.getState();
    emit("pointerdown", 10, 10);
    const { positionsVersion } = store.getState();
    let notified = 0;
    const unsubscribe = store.subscribe(() => (notified += 1));
    // One pointer move per frame, as a browser delivers them while the user drags.
    const frames = 12;
    for (let frame = 1; frame <= frames; frame += 1) {
      emit("globalpointermove", 10 + frame * 5, 10);
      const state = store.getState();
      expect(state.positionsVersion).toBe(positionsVersion + frame);
      expect(state.nodes).toBe(nodes);
      expect(state.edges).toBe(edges);
      expect(state.slots).toBe(slots);
    }
    unsubscribe();
    expect(notified).toBe(frames);
    expect(moves).toHaveLength(frames);
    expect(moves.every((move) => move.slots[0] === 0 && move.dx === 5 && move.dy === 0)).toBe(true);
    expect(store.getState().selection).toEqual({ kind: "node", id: "a" });
  });
});
