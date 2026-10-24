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
function fakeBridge(
  hit: { kind: string; slot?: number; side?: string } | ((x: number) => unknown) = {
    kind: "node",
    slot: 0,
  },
) {
  const moves: { slots: number[]; dx: number; dy: number }[] = [];
  const bridge = {
    hit: (x: number) => (typeof hit === "function" ? hit(x) : hit),
    edgesAt: () => new Uint32Array(0),
    positions: () => new Float32Array(8),
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

/** A store holding node `a`, with interaction attached; `changes` lists every change recorded
 *  from then on. */
function dragged() {
  const store = createGraphStore();
  store.getState().load({
    nodes: [{ id: "a", title: "A", x: 0, y: 0, width: 100, height: 40 }],
    edges: [],
  });
  const { app, emit } = fakeApp();
  attachInteraction(app, store, fakeBridge().bridge);
  const changes: unknown[] = [];
  store.subscribe((state, previous) => {
    if (state.change !== previous.change) changes.push(state.change);
  });
  return { store, app, emit, changes };
}

describe("interaction records where a drag left its node", () => {
  for (const release of ["pointerup", "pointerupoutside"]) {
    test(`a drag records one nodeMoved on ${release}, and none per frame`, () => {
      // Verifies: ADR-0023
      const { emit, changes } = dragged();
      emit("pointerdown", 10, 10);
      for (let frame = 1; frame <= 6; frame += 1) emit("globalpointermove", 10 + frame * 5, 10);
      expect(changes).toEqual([]);
      emit(release, 40, 10);
      expect(changes).toEqual([{ kind: "nodeMoved", by: "user", id: "a" }]);
      // The drag is over: a later move moves nothing and records nothing.
      emit("globalpointermove", 80, 10);
      emit(release, 80, 10);
      expect(changes).toHaveLength(1);
    });
  }

  test("a press released where it began, or with moves that move nothing, records no change", () => {
    // Verifies: ADR-0023
    const { emit, changes } = dragged();
    emit("pointerdown", 10, 10);
    emit("pointerup", 10, 10);
    emit("pointerdown", 10, 10);
    emit("globalpointermove", 10, 10);
    emit("pointerup", 10, 10);
    expect(changes).toEqual([]);
  });
});

describe("interaction ends a drag the graph took its node from", () => {
  test("a load during a drag ends it, and its release tells nothing", () => {
    // Verifies: ADR-0023
    const { store, emit, changes } = dragged();
    emit("pointerdown", 10, 10);
    emit("globalpointermove", 30, 10);
    store.getState().load({
      nodes: [{ id: "z", title: "Z", x: 0, y: 0, width: 100, height: 40 }],
      edges: [],
    });
    emit("pointerup", 30, 10);
    expect(changes).toEqual([{ kind: "loaded", by: "host" }]);
  });

  test("a press after a drag whose release never came tells the drag's nodeMoved first", () => {
    // Verifies: ADR-0023
    const { emit, changes } = dragged();
    emit("pointerdown", 10, 10);
    emit("globalpointermove", 30, 10);
    emit("pointerdown", 30, 10);
    expect(changes).toEqual([{ kind: "nodeMoved", by: "user", id: "a" }]);
    emit("pointerup", 30, 10);
    expect(changes).toHaveLength(1);
  });

  test("a listener that throws on release leaves the drag over and the cursor updated", () => {
    // Verifies: ADR-0023
    const { store, app, emit, changes } = dragged();
    store.subscribe((state, previous) => {
      if (state.change !== previous.change) throw new Error("host listener");
    });
    emit("pointerdown", 10, 10);
    emit("globalpointermove", 30, 10);
    expect(() => emit("pointerup", 30, 10)).toThrow("host listener");
    expect(changes).toEqual([{ kind: "nodeMoved", by: "user", id: "a" }]);
    // The fake bridge has a node under every point, so the cursor offers to grab it again.
    expect(app.canvas.style.cursor).toBe("grab");
    emit("globalpointermove", 50, 10);
    emit("pointerup", 50, 10);
    expect(changes).toHaveLength(1);
  });

  test("a removal of the dragged node ends the drag, which then moves and tells nothing", () => {
    // Verifies: ADR-0022, ADR-0023
    const { store, emit, changes } = dragged();
    emit("pointerdown", 10, 10);
    emit("globalpointermove", 30, 10);
    store.getState().removeNodes([0], []);
    // A node added takes the freed slot; the drag moves it not.
    store.getState().addNode({ id: "e", title: "E", x: 0, y: 0, width: 100, height: 40 }, 0);
    const { positionsVersion } = store.getState();
    emit("globalpointermove", 50, 10);
    emit("pointerup", 50, 10);
    expect(store.getState().positionsVersion).toBe(positionsVersion);
    expect(changes.map((change) => (change as { kind: string }).kind)).toEqual([
      "nodesRemoved",
      "nodeAdded",
    ]);
  });
});

describe("interaction on an edge", () => {
  test("a press on an edge selects it, pans once the pointer moves beyond 4 pixels, and shows a pointer", () => {
    // Verifies: ADR-0025
    const store = createGraphStore();
    store.getState().load({
      nodes: [
        { id: "a", title: "A", x: 0, y: 0, width: 100, height: 40 },
        { id: "b", title: "B", x: 300, y: 0, width: 100, height: 40 },
      ],
      edges: [{ id: "a-b", source: "a", target: "b" }],
    });
    const { app, emit } = fakeApp();
    attachInteraction(app, store, fakeBridge({ kind: "edge", slot: 0 }).bridge);
    emit("globalpointermove", 200, 20);
    expect(app.canvas.style.cursor).toBe("pointer");
    const { viewport } = store.getState();
    emit("pointerdown", 200, 20);
    // Within the slop the press stays a selection.
    emit("globalpointermove", 203, 22);
    expect(store.getState().viewport).toBe(viewport);
    // Beyond it, a pan from the press.
    emit("globalpointermove", 260, 80);
    emit("pointerup", 260, 80);
    expect(store.getState().selection).toEqual({ kind: "edge", id: "a-b" });
    expect(store.getState().viewport).toEqual({ x: 60, y: 60, scale: 1 });
  });

  test("the cursor over nothing is the default, and a press there pans", () => {
    // Verifies: ADR-0025
    const store = createGraphStore();
    const { app, emit } = fakeApp();
    attachInteraction(app, store, fakeBridge({ kind: "none" }).bridge);
    emit("globalpointermove", 200, 20);
    expect(app.canvas.style.cursor).toBe("");
    emit("pointerdown", 200, 20);
    emit("globalpointermove", 260, 80);
    expect(store.getState().viewport).toEqual({ x: 60, y: 60, scale: 1 });
  });
});

describe("interaction connects", () => {
  test("a connection a later press ends, its release never having come, proposes no edge", () => {
    // Verifies: ADR-0023, ADR-0024
    const store = createGraphStore();
    store.getState().load({
      nodes: [
        { id: "a", title: "A", x: 0, y: 0, width: 100, height: 40 },
        { id: "b", title: "B", x: 300, y: 0, width: 100, height: 40 },
      ],
      edges: [],
    });
    const { app, emit } = fakeApp();
    // The press at x = 100 meets a's right connector, the move to x = 300 b's left one.
    const hit = (x: number) =>
      x < 200
        ? { kind: "connector", slot: 0, side: "right" }
        : { kind: "connector", slot: 1, side: "left" };
    const proposals: unknown[] = [];
    attachInteraction(app, store, fakeBridge(hit).bridge, (proposal) => proposals.push(proposal));
    emit("pointerdown", 100, 20);
    emit("globalpointermove", 300, 20);
    expect(store.getState().connection?.target).toEqual({ slot: 1, side: "left" });
    // The release never comes; the next press ends the connection.
    emit("pointerdown", 100, 20);
    expect(proposals).toEqual([]);
    emit("globalpointermove", 300, 20);
    emit("pointerup", 300, 20);
    expect(proposals).toEqual([
      { source: "a", sourceSide: "right", target: "b", targetSide: "left" },
    ]);
  });

  for (const taken of ["a removal of its source, whose slot a node then takes", "a load"]) {
    test(`a connection ends at ${taken}, and its release proposes no edge`, () => {
      // Verifies: ADR-0023, ADR-0024
      const store = createGraphStore();
      const graph = {
        nodes: [
          { id: "a", title: "A", x: 0, y: 0, width: 100, height: 40 },
          { id: "b", title: "B", x: 300, y: 0, width: 100, height: 40 },
        ],
        edges: [],
      };
      store.getState().load(graph);
      const { app, emit } = fakeApp();
      const hit = (x: number) =>
        x < 200
          ? { kind: "connector", slot: 0, side: "right" }
          : { kind: "connector", slot: 1, side: "left" };
      const proposals: unknown[] = [];
      attachInteraction(app, store, fakeBridge(hit).bridge, (proposal) => proposals.push(proposal));
      emit("pointerdown", 100, 20);
      emit("globalpointermove", 300, 20);
      if (taken === "a load") store.getState().load(graph);
      else {
        store.getState().removeNodes([0], [], "host");
        store.getState().addNode({ id: "z", title: "Z", x: 0, y: 0, width: 100, height: 40 }, 0);
      }
      expect(store.getState().connection).toBeNull();
      emit("globalpointermove", 300, 20);
      emit("pointerup", 300, 20);
      expect(proposals).toEqual([]);
    });
  }
});
