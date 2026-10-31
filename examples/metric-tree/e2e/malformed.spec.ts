import { expect, test, type Page } from "@playwright/test";
import type { GraphData, GraphDataProblem, NodeContent, NodePatch } from "comb";
import { drawnGraph, node, open, setViewport, titled } from "./shared";

const edge = (id: string, source: string, target: string) => ({ id, source, target });
/** Nodes `a` and `b` and an edge `e` between them whose label lies in view at the near level,
 *  where a label the store kept would be drawn in the next frame. */
const labelled = (label: unknown): GraphData => ({
  nodes: [node("a"), node("b", 300)],
  edges: [
    { ...edge("e", "a", "b"), label: { text: "e", t: 0.5, offset: 0, ...(label as object) } },
  ],
});
/** A value of the wrong type, as a host application without types might hand it over. */
const wrong = <T>(value: unknown) => value as T;

/** Waits until two frames have passed, so that a render the page scheduled has run. */
async function frames(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await frame();
    await frame();
  });
}

/** Each kind of malformed graph data Q-7 names, with the problem `load` reports for it. */
const MALFORMED: { name: string; graph: GraphData; problem: unknown }[] = [
  {
    name: "a non-finite coordinate",
    graph: { nodes: [node("a"), node("b", Number.POSITIVE_INFINITY)], edges: [] },
    problem: { kind: "nonFiniteCoordinate", node: "b" },
  },
  {
    name: "a coordinate beyond the range of a 32-bit float",
    graph: { nodes: [node("a"), node("b", 300, 1e300)], edges: [] },
    problem: { kind: "nonFiniteCoordinate", node: "b" },
  },
  // Verifies: ADR-0028
  {
    name: "a node whose far side lies beyond what a 32-bit float holds",
    graph: { nodes: [node("a"), { ...node("b", 3e38), width: 3e38 }], edges: [] },
    problem: { kind: "beyondWorld", list: "nodes", id: "b", field: "x", limit: 2 ** 120 },
  },
  {
    name: "a node within the world whose far side lies beyond it",
    graph: { nodes: [node("a"), { ...node("b", 2 ** 119), width: 2 ** 119 + 1e30 }], edges: [] },
    problem: { kind: "beyondWorld", list: "nodes", id: "b", field: "width", limit: 2 ** 120 },
  },
  {
    name: "an edge to a missing node",
    graph: { nodes: [node("a"), node("b", 300)], edges: [edge("e", "a", "z")] },
    problem: { kind: "missingNode", edge: "e", node: "z" },
  },
  {
    name: "two nodes of one identifier",
    graph: { nodes: [node("a"), node("a", 300)], edges: [] },
    problem: { kind: "duplicateNode", node: "a" },
  },
  {
    name: "two edges of one identifier",
    graph: {
      nodes: [node("a"), node("b", 300)],
      edges: [edge("e", "a", "b"), edge("e", "b", "a")],
    },
    problem: { kind: "duplicateEdge", edge: "e" },
  },
  // Verifies: ADR-0028
  {
    name: "a title that is not a string",
    graph: {
      nodes: [node("a"), { ...node("b", 300), content: titled(wrong<string>(5)) }],
      edges: [],
    },
    problem: { kind: "invalidContentText", node: "b", row: 0, column: 0, field: "text" },
  },
  {
    name: "a label text that is not a string",
    graph: labelled({ text: { toString: "e" } }),
    problem: { kind: "invalidLabelText", edge: "e" },
  },
  ...[-5, 0x1000000, 1e20, 0.5, Number.NaN, 5n, {}, "red"].map((background) => ({
    name: `a label background of ${typeof background === "object" || typeof background === "string" ? JSON.stringify(background) : typeof background === "bigint" ? `${background}n` : String(background)}`,
    graph: labelled({ background }),
    problem: { kind: "invalidBackground", edge: "e" },
  })),
  {
    name: "a node identifier of 257 characters",
    graph: { nodes: [node("a"), node("x".repeat(257), 300)], edges: [] },
    problem: { kind: "idTooLong", list: "nodes", index: 1, field: "id", limit: 256 },
  },
  {
    name: "an edge source of 257 characters",
    graph: { nodes: [node("a"), node("b", 300)], edges: [edge("e", "x".repeat(257), "b")] },
    problem: { kind: "idTooLong", list: "edges", index: 0, field: "source", limit: 256 },
  },
  {
    name: "a title of 1,001 characters",
    graph: {
      nodes: [node("a"), { ...node("b", 300), content: titled("x".repeat(1001)) }],
      edges: [],
    },
    problem: {
      kind: "contentTextTooLong",
      node: "b",
      row: 0,
      column: 0,
      field: "text",
      limit: 1000,
    },
  },
  {
    name: "a label text of 1,001 UTF-16 code units",
    graph: labelled({ text: "\u{1F600}".repeat(500) + "x" }),
    problem: { kind: "labelTextTooLong", edge: "e", limit: 1000 },
  },
  ...[
    ["graph data that is not an object", null],
    ["graph data that is a number", 5],
    ["nodes that are not a list", { nodes: "ab", edges: [] }],
    ["a node that is not an object", { nodes: [null], edges: [] }],
  ].map(([name, graph]) => ({
    name: name as string,
    graph: wrong<GraphData>(graph),
    problem: expect.objectContaining({ kind: "malformed" }),
  })),
];

/** What a field expects, as the problem names it. */
const NUMBER = "a finite number";
const SIZE = "a finite number of 0 or more";
const COLOR = "an integer from 0 to 0xFFFFFF";
const DASH = "a list of two finite numbers, or none";
const ID = "a well-formed string of at most 256 code units";
const SIDE = '"top", "right", "bottom", or "left"';
const ROWS = "a list of rows";
/** A text element of node `b`'s content where it lies, as a problem of its text names it. */
const TEXT_AT = { node: "b", row: 0, column: 0, field: "text" };

/** Nodes `a` and `b` and an edge `e` between them, with `change` made to `b` or to `e`. */
function changed(item: "b" | "e", change: (fields: Record<string, unknown>) => void): GraphData {
  const b: Record<string, unknown> = { ...node("b", 300) };
  const e: Record<string, unknown> = {
    ...edge("e", "a", "b"),
    label: { text: "e", t: 0.5, offset: 0 },
  };
  change(item === "b" ? b : e);
  return wrong<GraphData>({ nodes: [node("a"), b], edges: [e] });
}

/** A field of node `b` or edge `e` missing or of another type, with the problem `load` reports
 *  for it: the node or edge, by index and by identifier where it has one, and the field. */
const FIELDS: { name: string; graph: GraphData; problem: unknown }[] = [
  ...[
    ["a coordinate that is a string", (b: Record<string, unknown>) => (b.x = "1"), "x", NUMBER],
    ["a missing width", (b: Record<string, unknown>) => delete b.width, "width", SIZE],
    ["content that is null", (b: Record<string, unknown>) => (b.content = null), "content", ROWS],
  ].map(([name, change, field, expected]) => ({
    name: name as string,
    graph: changed("b", change as (b: Record<string, unknown>) => void),
    problem: { kind: "invalidField", list: "nodes", index: 1, id: "b", field, expected },
  })),
  {
    name: "a node identifier that is a number",
    graph: changed("b", (b) => (b.id = 5)),
    problem: { kind: "invalidField", list: "nodes", index: 1, field: "id", expected: ID },
  },
  ...(
    [
      ["an edge source that is an object", (e) => (e.source = { id: "a" }), "source", ID],
      ["a missing edge target", (e) => delete e.target, "target", ID],
      ["a colour that is a string", (e) => (e.color = "red"), "color", COLOR],
      ["an arrow at the start", (e) => (e.arrow = "start"), "arrow", '"end" or "none"'],
      ["a label that is a string", (e) => (e.label = "e"), "label", "an object, or none"],
      [
        "a label without its offset",
        (e) => delete (e.label as Record<string, unknown>).offset,
        "label.offset",
        NUMBER,
      ],
      ["a dash of three numbers", (e) => (e.dash = [6, 4, 2]), "dash", DASH],
    ] as [string, (e: Record<string, unknown>) => void, string, string][]
  ).map(([name, change, field, expected]) => ({
    name,
    graph: changed("e", change),
    problem: { kind: "invalidField", list: "edges", index: 0, id: "e", field, expected },
  })),
];

for (const { name, graph, problem } of FIELDS) {
  test(`load refuses ${name}, naming the node or edge and the field`, async ({ page }) => {
    // Verifies: Q-7, ADR-0034
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const before = await drawnGraph(page);
    const refused = await page.evaluate((data) => {
      try {
        window.comb.load(data);
        return null;
      } catch (error) {
        const { name: thrown, problem: found } = error as Error & { problem: unknown };
        return { name: thrown, problem: found };
      }
    }, graph);
    expect(errors).toEqual([]);
    expect(refused).toStrictEqual({ name: "GraphDataError", problem });
    expect(await drawnGraph(page)).toEqual(before);
  });
}

/** Each refusal a node of a load can cause, of node `b` after node `a`: the graph data is built in
 *  the page, where a lone surrogate keeps its code unit, by `nodeRefusal`. */
const NODE_REFUSALS: { kind: string; problem: unknown }[] = [
  ...(
    [
      ["missingId", "id", ID],
      ["numberId", "id", ID],
      ["loneSurrogateId", "id", ID],
      ["stringX", "x", NUMBER],
      ["missingY", "y", NUMBER],
      ["nullWidth", "width", SIZE],
      ["booleanContent", "content", ROWS],
    ] as const
  ).map(([kind, field, expected]) => {
    const problem = { kind: "invalidField", list: "nodes", index: 1, id: "b", field, expected };
    if (field === "id") delete (problem as { id?: string }).id;
    return { kind, problem };
  }),
  {
    kind: "noObject",
    problem: { kind: "malformed", message: "the value does not have the shape the bridge expects" },
  },
  { kind: "missingTitle", problem: { kind: "invalidContentText", ...TEXT_AT } },
  { kind: "loneSurrogateTitle", problem: { kind: "invalidContentText", ...TEXT_AT } },
  {
    kind: "longId",
    problem: { kind: "idTooLong", list: "nodes", index: 1, field: "id", limit: 256 },
  },
  { kind: "longTitle", problem: { kind: "contentTextTooLong", ...TEXT_AT, limit: 1000 } },
  { kind: "duplicate", problem: { kind: "duplicateNode", node: "a" } },
  {
    kind: "beyondWorld",
    problem: { kind: "beyondWorld", list: "nodes", id: "b", field: "x", limit: 2 ** 120 },
  },
  { kind: "nonFinite", problem: { kind: "nonFiniteCoordinate", node: "b" } },
  { kind: "negativeSize", problem: { kind: "invalidSize", node: "b" } },
];

/** Loads nodes `a` and `b` with `b` changed as `kind` names, in the page, and returns the problem
 *  `load` throws, or none. */
function nodeRefusal(kind: string) {
  const b: Record<string, unknown> = { ...window.node("b", 300) };
  const changes: Record<string, () => unknown> = {
    missingId: () => delete b.id,
    numberId: () => (b.id = 5),
    loneSurrogateId: () => (b.id = "b\uD800"),
    stringX: () => (b.x = "1"),
    missingY: () => delete b.y,
    nullWidth: () => (b.width = null),
    booleanContent: () => (b.content = true),
    missingTitle: () => (b.content = [[{ kind: "text", role: "title" }]]),
    loneSurrogateTitle: () => (b.content = [[{ kind: "text", role: "title", text: "b\uDC00" }]]),
    longId: () => (b.id = "b".repeat(257)),
    longTitle: () => (b.content = [[{ kind: "text", role: "title", text: "b".repeat(1001) }]]),
    duplicate: () => (b.id = "a"),
    beyondWorld: () => (b.x = 2 ** 121),
    nonFinite: () => (b.x = Number.NEGATIVE_INFINITY),
    negativeSize: () => (b.width = -1),
  };
  const nodes: unknown[] = [window.node("a"), b];
  if (kind === "noObject") nodes[1] = 5;
  else changes[kind]!();
  try {
    window.comb.load({ nodes, edges: [] } as never);
    return null;
  } catch (error) {
    return (error as { problem?: unknown }).problem ?? null;
  }
}

for (const { kind, problem } of NODE_REFUSALS) {
  test(`load refuses a node (${kind}) as before, its nodes crossing as columns, and the previous graph stays drawn`, async ({
    page,
  }) => {
    // Verifies: ADR-0034
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const before = await drawnGraph(page);
    const refused = await page.evaluate(nodeRefusal, kind);
    await frames(page);
    expect(errors).toEqual([]);
    expect(refused).toStrictEqual(problem);
    expect(await drawnGraph(page)).toEqual(before);
  });
}

/** Each refusal an edge of a load can cause, of edge `e` after edge `d`, both between nodes `a`
 *  and `b`: the graph data is built in the page, where a lone surrogate keeps its code unit, by
 *  `edgeRefusal`. */
const EDGE_REFUSALS: { kind: string; problem: unknown }[] = [
  ...(
    [
      ["missingId", "id", ID],
      ["numberId", "id", ID],
      ["loneSurrogateId", "id", ID],
      ["loneSurrogateSource", "source", ID],
      ["objectSource", "source", ID],
      ["nullTarget", "target", ID],
      ["booleanLabel", "label", "an object, or none"],
      ["stringLabelT", "label.t", NUMBER],
      ["missingLabelOffset", "label.offset", NUMBER],
      ["stringColor", "color", COLOR],
      ["dashOfThree", "dash", DASH],
      ["dashOfStrings", "dash", DASH],
      ["arrowAtStart", "arrow", '"end" or "none"'],
      ["numberArrow", "arrow", '"end" or "none"'],
      ["middleSourceSide", "sourceSide", SIDE],
      ["numberTargetSide", "targetSide", SIDE],
      ["loneSurrogateTargetSide", "targetSide", SIDE],
    ] as const
  ).map(([kind, field, expected]) => {
    const problem = { kind: "invalidField", list: "edges", index: 1, id: "e", field, expected };
    if (field === "id") delete (problem as { id?: string }).id;
    return { kind, problem };
  }),
  {
    kind: "noObject",
    problem: { kind: "malformed", message: "the value does not have the shape the bridge expects" },
  },
  { kind: "missingEnd", problem: { kind: "missingNode", edge: "e", node: "z" } },
  { kind: "duplicate", problem: { kind: "duplicateEdge", edge: "d" } },
  {
    kind: "longId",
    problem: { kind: "idTooLong", list: "edges", index: 1, field: "id", limit: 256 },
  },
  {
    kind: "longTarget",
    problem: { kind: "idTooLong", list: "edges", index: 1, field: "target", limit: 256 },
  },
  { kind: "missingLabelText", problem: { kind: "invalidLabelText", edge: "e" } },
  { kind: "loneSurrogateLabelText", problem: { kind: "invalidLabelText", edge: "e" } },
  { kind: "longLabelText", problem: { kind: "labelTextTooLong", edge: "e", limit: 1000 } },
  { kind: "stringBackground", problem: { kind: "invalidBackground", edge: "e" } },
  { kind: "backgroundBeyondRgb", problem: { kind: "invalidBackground", edge: "e" } },
  { kind: "colorBeyondRgb", problem: { kind: "invalidColor", edge: "e" } },
  { kind: "negativeGap", problem: { kind: "invalidDash", edge: "e" } },
  { kind: "nonFiniteLabel", problem: { kind: "nonFiniteLabel", edge: "e" } },
  {
    kind: "labelBeyondWorld",
    problem: {
      kind: "beyondWorld",
      list: "edges",
      id: "e",
      field: "label.offset",
      limit: 2 ** 120,
    },
  },
];

/** Loads nodes `a` and `b` and edges `d` and `e` between them, with `e` changed as `kind` names,
 *  or as it is for a kind none names, in the page, and returns the problem `load` throws, or
 *  none. */
function edgeRefusal(kind: string) {
  const label: Record<string, unknown> = { text: "e", t: 0.5, offset: 0, background: 0x123456 };
  const e: Record<string, unknown> = { id: "e", source: "b", target: "a", label, dash: [6, 4] };
  const changes: Record<string, () => unknown> = {
    missingId: () => delete e.id,
    numberId: () => (e.id = 5),
    loneSurrogateId: () => (e.id = "e\uD800"),
    loneSurrogateSource: () => (e.source = "\uDC00b"),
    objectSource: () => (e.source = { id: "b" }),
    nullTarget: () => (e.target = null),
    booleanLabel: () => (e.label = true),
    stringLabelT: () => (label.t = "1"),
    missingLabelOffset: () => delete label.offset,
    stringColor: () => (e.color = "red"),
    dashOfThree: () => (e.dash = [6, 4, 2]),
    dashOfStrings: () => (e.dash = ["6", 4]),
    arrowAtStart: () => (e.arrow = "start"),
    numberArrow: () => (e.arrow = 1),
    middleSourceSide: () => (e.sourceSide = "middle"),
    numberTargetSide: () => (e.targetSide = 3),
    loneSurrogateTargetSide: () => (e.targetSide = "left\uD800"),
    missingEnd: () => (e.target = "z"),
    duplicate: () => (e.id = "d"),
    longId: () => (e.id = "e".repeat(257)),
    longTarget: () => (e.target = "a".repeat(257)),
    missingLabelText: () => delete label.text,
    loneSurrogateLabelText: () => (label.text = "e\uDC00"),
    longLabelText: () => (label.text = "\u{1F600}".repeat(500) + "e"),
    stringBackground: () => (label.background = "red"),
    backgroundBeyondRgb: () => (label.background = 0x1000000),
    colorBeyondRgb: () => (e.color = 0x1000000),
    negativeGap: () => (e.dash = [6, -1]),
    nonFiniteLabel: () => (label.t = Number.POSITIVE_INFINITY),
    labelBeyondWorld: () => (label.offset = 2 ** 121),
  };
  const edges: unknown[] = [{ id: "d", source: "a", target: "b" }, e];
  if (kind === "noObject") edges[1] = 5;
  else changes[kind]?.();
  try {
    window.comb.load({ nodes: [window.node("a"), window.node("b", 300)], edges } as never);
    return null;
  } catch (error) {
    return (error as { problem?: unknown }).problem ?? null;
  }
}

for (const { kind, problem } of EDGE_REFUSALS) {
  test(`load refuses an edge (${kind}) as before, its edges crossing as columns, and the previous graph stays drawn`, async ({
    page,
  }) => {
    // Verifies: ADR-0034
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const before = await drawnGraph(page);
    const refused = await page.evaluate(edgeRefusal, kind);
    await frames(page);
    expect(errors).toEqual([]);
    expect(refused).toStrictEqual(problem);
    expect(await drawnGraph(page)).toEqual(before);
  });
}

test("load takes an edge with every field, its edges crossing as columns", async ({ page }) => {
  // Verifies: ADR-0034
  await open(page);
  const refused = await page.evaluate(edgeRefusal, "none");
  expect(refused).toBeNull();
});

for (const { name, graph, problem } of MALFORMED) {
  test(`load refuses ${name} with a GraphDataError, and the previous graph stays drawn`, async ({
    page,
  }) => {
    // Verifies: Q-7
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    // At the near level, with the origin in view, so that an edge label the store kept is drawn.
    await setViewport(page, { x: 100, y: 100, scale: 1 });
    const before = await drawnGraph(page);
    expect(before.nodes.length).toBeGreaterThan(0);
    const refused = await page.evaluate((data) => {
      try {
        window.comb.load(data);
        return null;
      } catch (error) {
        const { name: thrown, problem: found } = error as Error & { problem: unknown };
        return { name: thrown, problem: found };
      }
    }, graph);
    await frames(page);
    // First, since a value the check let through throws in the next frame, not in `load`.
    expect(errors).toEqual([]);
    expect(refused).toEqual({ name: "GraphDataError", problem });
    expect(await drawnGraph(page)).toEqual(before);
  });
}

test("updateNode with an identifier the graph does not hold throws a GraphDataError naming it, and changes nothing", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0028
  await open(page);
  const before = await drawnGraph(page);
  const result = await page.evaluate(async () => {
    await window.comb.whenRendered();
    // Two frames with nothing to draw, so that a render the call would schedule is counted.
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await frame();
    const renders = window.renderCount();
    let refused = null;
    try {
      window.comb.updateNode("no-such-node", {
        content: [[{ kind: "text", role: "title", text: "Renamed" }]],
      });
    } catch (error) {
      const { name, problem } = error as Error & { problem: unknown };
      refused = { name, problem };
    }
    await frame();
    await frame();
    return { refused, rendered: window.renderCount() - renders };
  });
  expect(result).toEqual({
    refused: { name: "GraphDataError", problem: { kind: "unknownNode", node: "no-such-node" } },
    rendered: 0,
  });
  expect(await drawnGraph(page)).toEqual(before);
});

/** Each kind of patch `updateNode` refuses, with the problem it reports for it. */
const PATCHES: { patch: unknown; problem: unknown }[] = [
  { patch: { id: "b" }, problem: { kind: "unknownPatchField", node: "a", field: "id" } },
  { patch: { width: -1 }, problem: { kind: "unknownPatchField", node: "a", field: "width" } },
  {
    patch: { content: [[{ kind: "text", role: "title", text: 5 }]] },
    problem: { kind: "invalidContentText", node: "a", row: 0, column: 0, field: "text" },
  },
  {
    patch: { content: null },
    problem: {
      kind: "invalidField",
      list: "nodes",
      index: 0,
      id: "a",
      field: "content",
      expected: ROWS,
    },
  },
  { patch: [["content", titled("a")]], problem: expect.objectContaining({ kind: "malformed" }) },
];

for (const { patch, problem } of PATCHES) {
  test(`updateNode refuses the patch ${JSON.stringify(patch)} with a GraphDataError, and changes nothing`, async ({
    page,
  }) => {
    // Verifies: Q-7, ADR-0028
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await page.evaluate(async () => {
      window.comb.load({
        nodes: [window.node("a")],
        edges: [],
      });
      await window.comb.whenRendered();
    });
    const before = await drawnGraph(page);
    const result = await page.evaluate(async (changes) => {
      // Two frames with nothing to draw, so that a render the call would schedule is counted;
      // the store schedules one for any change, so none means its nodes stayed as they were.
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      await frame();
      const renders = window.renderCount();
      let refused = null;
      try {
        window.comb.updateNode("a", changes as NodePatch);
      } catch (error) {
        const { name, problem: found } = error as Error & { problem: unknown };
        refused = { name, problem: found };
      }
      await frame();
      await frame();
      return { refused, rendered: window.renderCount() - renders };
    }, patch);
    expect(result).toEqual({ refused: { name: "GraphDataError", problem }, rendered: 0 });
    expect(await drawnGraph(page)).toEqual(before);
    expect(errors).toEqual([]);
  });
}

/** A source of random graph data and patches, from a fixed seed: `window.randomCase()`. */
type Generated = { graph: GraphData; patch: unknown };
type Random = Window & { randomCase: () => Generated };

/** Installs `window.randomCase` in the page: mostly well formed graph data, with a value of the
 *  wrong type or out of range now and then in any field, and a patch for its first node. */
function installGenerator(): void {
  // mulberry32, from a fixed seed, so that a failing case is found again.
  let seed = 0x5eed;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  /** Mostly `good()`, now and then one of `bad`. */
  const mostly = (good: () => unknown, bad: readonly unknown[]) =>
    random() < 0.97 ? good() : pick(bad);
  const fail = () => {
    throw new Error("host code");
  };
  /** One row of one title, `text`. */
  const title = (text: unknown) => [[{ kind: "text", role: "title", text }]];
  let deep: unknown[] = [];
  for (let i = 0; i < 200_000; i++) deep = [deep];
  const odd = [
    ...[undefined, null, -5, Number.NaN, Infinity, 1e20, 0.5, 5n, "", "x", {}, [], true],
    new Proxy({}, { get: fail, getPrototypeOf: fail, has: fail, ownKeys: fail }),
    Object.defineProperty({}, Symbol.toStringTag, { get: fail }),
    deep,
    new Array(2 ** 32 - 1),
    "x".repeat(1001),
  ];
  (window as unknown as Random).randomCase = () => {
    // Each node its own identifier, now and then that of the first or one of the wrong type.
    const ids = Array.from({ length: 1 + Math.floor(random() * 3) }, (_, k) => `n${k}`);
    const nodes = ids.map((id) => ({
      id: mostly(() => id, ["n0", ...odd]),
      content: mostly(() => title(mostly(() => pick(["", "Revenue", "\u{1F600}"]), odd)), odd),
      x: mostly(() => random() * 600 - 100, odd),
      y: mostly(() => random() * 300 - 100, odd),
      width: mostly(() => random() * 220, odd),
    }));
    const label = () => ({
      text: mostly(() => pick(["", "ok", "x".repeat(40)]), odd),
      t: mostly(() => random(), odd),
      offset: mostly(() => random() * 40 - 20, odd),
      background: mostly(() => pick([undefined, 0, 0xffffff, 0x123456]), odd),
    });
    const edges = Array.from({ length: Math.floor(random() * 3) }, (_, k) => ({
      id: mostly(() => `e${k}`, ["e0", ...odd]),
      source: mostly(() => pick(ids), ["z", ...odd]),
      target: mostly(() => pick(ids), ["z", ...odd]),
      color: mostly(() => pick([undefined, 0, 0x22a55b, 0xffffff]), odd),
      dash: mostly(() => pick([undefined, [6, 4]]), odd),
      arrow: mostly(() => pick([undefined, "end", "none"]), odd),
      label: mostly(label, [undefined, null]),
    }));
    const patch = mostly(
      () => ({ content: mostly(() => title("Renamed"), odd) }),
      [{ id: "z" }, { width: -1 }, {}],
    );
    return { graph: { nodes, edges } as unknown as GraphData, patch };
  };
}

/** Loads `cases` graphs of `window.randomCase` and patches the first node of each one loaded;
 *  counts what was refused with a `GraphDataError` and what was drawn, and lists anything else. */
async function runCases(cases: number) {
  const { comb, randomCase } = window as unknown as Random;
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const drawnOrHung = () =>
    Promise.race([
      comb.whenRendered().then(() => "drawn"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 2000)),
    ]);
  /** Whether a refusal's message, or what it says a field expects, names a Rust type or crate:
   *  a path, a backtick, or a primitive of Rust. */
  const namesRust = (error: unknown) => {
    const { message, expected } = (error as { problem: { message?: string; expected?: string } })
      .problem;
    return [message, expected].some((text) =>
      /::|`|\b(?:f32|f64|u32|usize|String|JsValue)\b/.test(text ?? ""),
    );
  };
  const tally = { refused: 0, drawn: 0, other: [] as string[] };
  for (let i = 0; i < cases; i++) {
    const { graph, patch } = randomCase();
    try {
      comb.load(graph);
    } catch (error) {
      if ((error as Error).name !== "GraphDataError")
        tally.other.push(`load ${i}: ${String(error)}`);
      else if (namesRust(error)) tally.other.push(`load ${i}: ${JSON.stringify(error)}`);
      else tally.refused++;
      continue;
    }
    try {
      comb.updateNode(graph.nodes[0]!.id, patch as NodePatch);
    } catch (error) {
      if ((error as Error).name !== "GraphDataError")
        tally.other.push(`updateNode ${i}: ${String(error)}`);
    }
    const result = await drawnOrHung();
    if (result === "drawn") tally.drawn++;
    else tally.other.push(`render ${i}: ${String(result)}`);
    await frame();
  }
  return tally;
}

test("random graph data and patches through the public interface end in a GraphDataError or a drawn graph, and no page error", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0028
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await setViewport(page, { x: 100, y: 100, scale: 1 });
  await page.evaluate(installGenerator);
  const outcome = await page.evaluate(runCases, 300);
  expect(errors).toEqual([]);
  expect(outcome.other).toEqual([]);
  // Both outcomes occur, so that neither the generator nor the check is degenerate.
  expect(outcome.refused).toBeGreaterThan(30);
  expect(outcome.drawn).toBeGreaterThan(30);
  expect(outcome.refused + outcome.drawn).toBe(300);
});

/** What a call through `window.comb` did in the page: the problem it threw, if any, how often
 *  the host's getter was read, and what the canvas drew of its nodes afterwards. */
type Read = { refused: unknown; reads: number; titles: unknown[] };

test("load reads the host's graph data once and keeps what the bridge checked", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0028
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await setViewport(page, { x: 100, y: 100, scale: 1 });
  const read: Read = await page.evaluate(async () => {
    // A background that is a colour on the first read and one PixiJS cannot convert after it.
    let reads = 0;
    const label = { text: "e", t: 0.5, offset: 0 };
    Object.defineProperty(label, "background", {
      enumerable: true,
      get: () => (reads++ === 0 ? 0x123456 : -5),
    });
    const nodeAt = (id: string, x: number) => window.node(id, x);
    let refused = null;
    try {
      window.comb.load({
        nodes: [nodeAt("a", 0), nodeAt("b", 300)],
        edges: [{ id: "e", source: "a", target: "b", label }],
      });
    } catch (error) {
      refused = (error as Error & { problem: unknown }).problem;
    }
    await window.comb.whenRendered();
    return { refused, reads, titles: window.inspect().nodes.map(({ title }) => title) };
  });
  await frames(page);
  expect(errors).toEqual([]);
  expect(read).toEqual({ refused: null, reads: 1, titles: ["a", "b"] });
});

/** Each patch built in the page, since neither a getter nor a `Map` survives serialisation, with
 *  what `updateNode` does with it. */
const READ_ONCE: { name: string; kind: "turning" | "map" | "throwing"; expected: Read }[] = [
  {
    name: "content that turns into a number on its second read",
    kind: "turning",
    expected: { refused: null, reads: 1, titles: ["Renamed"] },
  },
  {
    name: "a Map, which is no plain object",
    kind: "map",
    expected: {
      refused: expect.objectContaining({ kind: "malformed" }),
      reads: 0,
      titles: ["a"],
    },
  },
  {
    name: "a getter that throws",
    kind: "throwing",
    expected: {
      refused: { kind: "malformed", message: "comb: graph data could not be read" },
      reads: 1,
      titles: ["a"],
    },
  },
];

/** In the page: loads one node `a`, hands `updateNode` the patch of `kind`, and reports. */
async function patchOnce(kind: (typeof READ_ONCE)[number]["kind"]): Promise<Read> {
  window.comb.load({
    nodes: [window.node("a")],
    edges: [],
  });
  let reads = 0;
  const renamed: NodeContent = [[{ kind: "text", role: "title", text: "Renamed" }]];
  const patches = {
    turning: () => ({
      get content() {
        return reads++ === 0 ? renamed : (5 as unknown as NodeContent);
      },
    }),
    map: () => new Map([["content", renamed]]) as unknown as NodePatch,
    throwing: () => ({
      get content(): NodeContent {
        reads++;
        throw new Error("no content");
      },
    }),
  };
  let refused = null;
  try {
    window.comb.updateNode("a", patches[kind]());
  } catch (error) {
    refused = (error as Error & { problem: unknown }).problem;
  }
  await window.comb.whenRendered();
  return { refused, reads, titles: window.inspect().nodes.map(({ title }) => title) };
}

for (const { name, kind, expected } of READ_ONCE) {
  test(`updateNode reads the host's patch once and keeps what the bridge checked: ${name}`, async ({
    page,
  }) => {
    // Verifies: Q-7, ADR-0028
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const read = await page.evaluate(patchOnce, kind);
    await frames(page);
    expect(errors).toEqual([]);
    expect(read).toEqual(expected);
  });
}

test("load copies nodes out of a list whose own map would hand over the host's objects", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0028
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const read: Read = await page.evaluate(async () => {
    // Content that is a list of rows on its first read and a number after it, in a list whose
    // `map` returns the host's own node, not the copy it was asked for.
    let reads = 0;
    const { id, x, y, width, content } = window.node("a");
    const nodeAt = { id, x, y, width };
    Object.defineProperty(nodeAt, "content", {
      enumerable: true,
      get: () => (reads++ === 0 ? content : 5),
    });
    const nodes = [nodeAt];
    Object.defineProperty(nodes, "map", { value: () => [nodeAt] });
    window.comb.load({ nodes: nodes as never, edges: [] });
    await window.comb.whenRendered();
    return { refused: null, reads, titles: window.inspect().nodes.map(({ title }) => title) };
  });
  await frames(page);
  expect(errors).toEqual([]);
  expect(read).toEqual({ refused: null, reads: 1, titles: ["a"] });
});

test("updateNode refuses thousands of patches whose getter throws, and the engine still works", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0028
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const result = await page.evaluate(async () => {
    window.comb.load({
      nodes: [window.node("a")],
      edges: [],
    });
    const kinds = new Set<unknown>();
    for (let i = 0; i < 5000; i++) {
      try {
        window.comb.updateNode("a", {
          get content(): NodeContent {
            throw new Error("no content");
          },
        });
      } catch (error) {
        kinds.add((error as Error & { problem: { kind: string } }).problem.kind);
      }
    }
    window.comb.updateNode("a", {
      content: [[{ kind: "text", role: "title", text: "Renamed" }]],
    });
    await window.comb.whenRendered();
    return { kinds: [...kinds], titles: window.inspect().nodes.map(({ title }) => title) };
  });
  expect(errors).toEqual([]);
  expect(result).toEqual({ kinds: ["malformed"], titles: ["Renamed"] });
});

test("load draws a title and a label text of 1,000 UTF-16 code units", async ({ page }) => {
  // Verifies: Q-7, ADR-0028
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await setViewport(page, { x: 100, y: 100, scale: 1 });
  const title = "x".repeat(1000);
  await page.evaluate(
    async (graph) => {
      window.comb.load(graph);
      await window.comb.whenRendered();
    },
    {
      ...labelled({ text: "\u{1F600}".repeat(500) }),
      nodes: [{ ...node("a"), content: titled(title) }, node("b", 300)],
    },
  );
  await frames(page);
  expect(errors).toEqual([]);
  expect((await drawnGraph(page)).nodes.map(({ title: shown }) => shown?.length)).toEqual([
    1000, 1,
  ]);
});

test("load refuses a million and one nodes by their count, before it copies any", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0028
  await open(page);
  const result = await page.evaluate(() => {
    const nodes = new Array(1_000_001);
    const start = performance.now();
    let problem = null;
    try {
      window.comb.load({ nodes, edges: [] });
    } catch (error) {
      problem = (error as Error & { problem: unknown }).problem;
    }
    return { problem, ms: performance.now() - start };
  });
  console.log(`a million and one nodes refused in ${result.ms.toFixed(2)} ms`);
  expect(result.problem).toEqual({ kind: "tooMany", list: "nodes", limit: 1_000_000 });
  // Refused by the count alone: copying a million nodes takes far longer.
  expect(result.ms).toBeLessThan(50);
});

/** The hostile values a host application might hand over, built in the page, since none of them
 *  survives serialisation. */
const HOSTILE = ["proxy", "toStringTag", "deep", "huge"] as const;
/** Where a hostile value goes. */
const PLACES = [
  "title",
  "id",
  "x",
  "text",
  "background",
  "nodes",
  "graph",
  "patch",
  "patchTitle",
] as const;

/** Installs `window.hostileValue` in the page, which builds a hostile value of `kind`. */
function installHostile(): void {
  const fail = () => {
    throw new Error("host code");
  };
  const values = {
    proxy: () =>
      new Proxy(
        {},
        {
          get: fail,
          getPrototypeOf: fail,
          has: fail,
          ownKeys: fail,
          getOwnPropertyDescriptor: fail,
        },
      ),
    toStringTag: () => ({
      get [Symbol.toStringTag]() {
        return fail();
      },
    }),
    deep: () => {
      let list: unknown[] = [];
      for (let i = 0; i < 200_000; i++) list = [list];
      return list;
    },
    huge: () => new Array(2 ** 32 - 1),
  };
  (window as unknown as Hostile).hostileValue = (kind) => values[kind]();
}

type Hostile = Window & { hostileValue: (kind: (typeof HOSTILE)[number]) => unknown };

/** In the page: hands the hostile value `kind` to Comb in `place`, then loads a valid graph, and
 *  reports what the first call threw and what the canvas drew after the second. */
async function hostile([kind, place]: [(typeof HOSTILE)[number], (typeof PLACES)[number]]) {
  const value = (window as unknown as Hostile).hostileValue(kind) as never;
  const nodeAt = (id: string) => window.node(id);
  const label = { text: "e", t: 0.5, offset: 0 };
  const anEdge = { id: "e", source: "a", target: "b", label };
  const calls = {
    title: () =>
      window.comb.load({
        nodes: [{ ...nodeAt("a"), content: [[{ kind: "text", role: "title", text: value }]] }],
        edges: [],
      }),
    id: () => window.comb.load({ nodes: [{ ...nodeAt("a"), id: value }], edges: [] }),
    x: () => window.comb.load({ nodes: [{ ...nodeAt("a"), x: value }], edges: [] }),
    text: () =>
      window.comb.load({
        nodes: [nodeAt("a"), nodeAt("b")],
        edges: [{ ...anEdge, label: { ...label, text: value } }],
      }),
    background: () =>
      window.comb.load({
        nodes: [nodeAt("a"), nodeAt("b")],
        edges: [{ ...anEdge, label: { ...label, background: value } }],
      }),
    nodes: () => window.comb.load({ nodes: value, edges: [] }),
    graph: () => window.comb.load(value),
    patch: () => window.comb.updateNode("a", value),
    patchTitle: () =>
      window.comb.updateNode("a", { content: [[{ kind: "text", role: "title", text: value }]] }),
  };
  window.comb.load({ nodes: [nodeAt("a")], edges: [] });
  let first: unknown = "accepted";
  try {
    calls[place]();
  } catch (error) {
    first = (error as Error).name;
  }
  window.comb.load({ nodes: [nodeAt("ok")], edges: [] });
  await window.comb.whenRendered();
  return { first, titles: window.inspect().nodes.map(({ title }) => title) };
}

for (const kind of HOSTILE) {
  test(`a hostile value (${kind}) anywhere in graph data or a patch is refused, and the engine still loads`, async ({
    page,
  }) => {
    // Verifies: Q-7, ADR-0028
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    await page.evaluate(installHostile);
    const outcomes: Record<string, unknown> = {};
    for (const place of PLACES) {
      const at: [(typeof HOSTILE)[number], (typeof PLACES)[number]] = [kind, place];
      outcomes[place] = await page.evaluate(hostile, at);
    }
    expect(errors).toEqual([]);
    expect(outcomes).toEqual(
      Object.fromEntries(
        PLACES.map((place) => [place, { first: "GraphDataError", titles: ["ok"] }]),
      ),
    );
  });
}

/** The kinds of refusal `refusal` provokes. */
type RefusalKind =
  | "bigX"
  | "sharedTitle"
  | "symbolKey"
  | "hiddenKey"
  | "hugeKey"
  | "thrownProxy"
  | "loneSurrogateId"
  | "loneSurrogateTitle"
  | "loneSurrogateKey";

/** In the page: loads one node `a`, provokes the refusal of `kind`, and reports what it threw, how
 *  long it took, and what the canvas drew after a valid load that follows it. */
async function refusal(kind: RefusalKind) {
  const nodeAt = (id: string) => window.node(id);
  window.comb.load({ nodes: [nodeAt("a")], edges: [] });
  const big = "\u4e00".repeat(50_000_000);
  const textOf = (text: string) => [[{ kind: "text" as const, role: "title" as const, text }]];
  // A thrown value whose prototype chain runs the host's code.
  const thrown = new Proxy(
    {},
    {
      getPrototypeOf: () => {
        throw new TypeError("host code");
      },
    },
  );
  const calls = {
    bigX: () => window.comb.load({ nodes: [{ ...nodeAt("a"), x: big as never }], edges: [] }),
    sharedTitle: () =>
      window.comb.load({
        nodes: Array.from({ length: 10_000 }, (_, i) => ({
          ...nodeAt(`n${i}`),
          content: textOf(big),
        })),
        edges: [],
      }),
    symbolKey: () => window.comb.updateNode("a", { [Symbol("extra")]: 1 } as never),
    hiddenKey: () => window.comb.updateNode("a", Object.defineProperty({}, "id", { value: "z" })),
    hugeKey: () => window.comb.updateNode("a", { [big]: 1 } as never),
    // The bridge would read both as "a\uFFFD" and join the edge to a node the store's edge misses.
    loneSurrogateId: () =>
      window.comb.load({
        nodes: [nodeAt("a\uD800"), nodeAt("b")],
        edges: [{ id: "e", source: "a\uD801", target: "b" }],
      }),
    loneSurrogateTitle: () => window.comb.updateNode("a", { content: textOf("x\uDC00") }),
    loneSurrogateKey: () => window.comb.updateNode("a", { "x\uDC00": 1 } as never),
    thrownProxy: () =>
      window.comb.load({
        nodes: [
          Object.defineProperty(nodeAt("a"), "content", {
            get: () => {
              throw thrown;
            },
          }),
        ],
        edges: [],
      }),
  };
  const start = performance.now();
  let problem: unknown = null;
  try {
    calls[kind]();
  } catch (error) {
    problem =
      error instanceof Error && error.name === "GraphDataError"
        ? (error as Error & { problem: unknown }).problem
        : `untyped ${typeof error}`;
  }
  const ms = performance.now() - start;
  window.comb.load({ nodes: [nodeAt("ok")], edges: [] });
  await window.comb.whenRendered();
  return { problem, ms, titles: window.inspect().nodes.map(({ title }) => title) };
}

const REFUSALS: { name: string; kind: RefusalKind; problem: unknown }[] = [
  {
    name: "a coordinate that is a string of 50 million characters",
    kind: "bigX",
    problem: {
      kind: "invalidField",
      list: "nodes",
      index: 0,
      id: "a",
      field: "x",
      expected: "a finite number",
    },
  },
  {
    name: "a title of 50 million characters shared by 10,000 nodes",
    kind: "sharedTitle",
    problem: {
      kind: "contentTextTooLong",
      node: "n0",
      row: 0,
      column: 0,
      field: "text",
      limit: 1000,
    },
  },
  {
    name: "a patch with a Symbol key",
    kind: "symbolKey",
    problem: { kind: "malformed", message: "comb: the patch has a key that is no string" },
  },
  {
    name: "a patch with a key that is not enumerable",
    kind: "hiddenKey",
    problem: { kind: "unknownPatchField", node: "a", field: "id" },
  },
  {
    name: "a patch with a key of 50 million characters",
    kind: "hugeKey",
    problem: { kind: "unknownPatchField", node: "a", field: "\u4e00".repeat(1001) },
  },
  {
    name: "identifiers that differ in a lone surrogate",
    kind: "loneSurrogateId",
    problem: {
      kind: "invalidField",
      list: "nodes",
      index: 0,
      field: "id",
      expected: "a well-formed string of at most 256 code units",
    },
  },
  {
    name: "a title with a lone surrogate",
    kind: "loneSurrogateTitle",
    problem: { kind: "invalidContentText", node: "a", row: 0, column: 0, field: "text" },
  },
  {
    // The bridge crate reads the lone surrogate as U+FFFD, so the field names the key as a Rust
    // string can carry it.
    name: "a patch with a key that holds a lone surrogate",
    kind: "loneSurrogateKey",
    problem: { kind: "unknownPatchField", node: "a", field: "x\uFFFD" },
  },
  {
    name: "a getter that throws a Proxy",
    kind: "thrownProxy",
    problem: { kind: "malformed", message: "comb: graph data could not be read" },
  },
];

for (const { name, kind, problem } of REFUSALS) {
  test(`refuses ${name} quickly with a typed problem, and the engine still loads`, async ({
    page,
  }) => {
    // Verifies: Q-7, ADR-0028
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page);
    const result = await page.evaluate(refusal, kind);
    expect(errors).toEqual([]);
    expect({ problem: result.problem, titles: result.titles }).toEqual({ problem, titles: ["ok"] });
    // A text is handed over no longer than the limit allows, so its length costs nothing.
    expect(result.ms).toBeLessThan(500);
  });
}

test("load draws identifiers of 256 characters", async ({ page }) => {
  // Verifies: Q-7, ADR-0028
  await open(page);
  const a = "a".repeat(256);
  const b = "b".repeat(256);
  await page.evaluate(
    async (graph) => {
      window.comb.load(graph);
      await window.comb.whenRendered();
    },
    { nodes: [node(a), node(b, 300)], edges: [edge("e".repeat(256), a, b)] },
  );
  const drawnNow = await drawnGraph(page);
  expect(drawnNow.nodes.map(({ id }) => id.length)).toEqual([256, 256]);
  expect(drawnNow.edges.map((id) => id.length)).toEqual([256]);
});

/** In the page: loads a million edges between two nodes whose identifiers hold `length` code
 *  units each, then, before a frame draws them, a graph of one node; reports the problem and the
 *  time of the first load, and what the canvas drew. */
async function budgeted(length: number) {
  const nodeAt = (id: string, x: number) => window.node(id, x);
  const edges = Array.from({ length: 1_000_000 }, (_, i) => ({
    id: String(i).padStart(length, "e"),
    source: "a",
    target: "b",
  }));
  const start = performance.now();
  let problem: unknown = null;
  try {
    window.comb.load({ nodes: [nodeAt("a", 0), nodeAt("b", 300)], edges });
  } catch (error) {
    problem = (error as Error & { problem: unknown }).problem;
  }
  const ms = performance.now() - start;
  window.comb.load({ nodes: [nodeAt("ok", 0)], edges: [] });
  await window.comb.whenRendered();
  return { problem, ms, titles: window.inspect().nodes.map(({ title }) => title) };
}

test("load takes a million edges whose identifiers hold 63 million code units, and refuses 66 million by the budget, quickly", async ({
  page,
}) => {
  // Verifies: Q-7, ADR-0028
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  // 1,000,000 × (61 + 1 + 1) + 2 code units, within the budget of 64,000,000.
  const within = await page.evaluate(budgeted, 61);
  // 1,000,000 × (64 + 1 + 1) + 2, beyond it.
  const beyond = await page.evaluate(budgeted, 64);
  console.log(
    `a million edges: ${within.ms.toFixed(0)} ms within the budget, ${beyond.ms.toFixed(0)} ms refused`,
  );
  expect(errors).toEqual([]);
  expect(within).toEqual({ problem: null, ms: within.ms, titles: ["ok"] });
  expect(beyond).toEqual({
    problem: { kind: "idBudgetExceeded", limit: 64_000_000 },
    ms: beyond.ms,
    titles: ["ok"],
  });
  // Refused while reading, before the edges cross into the engine.
  expect(beyond.ms).toBeLessThan(within.ms / 2);
});

/** In the page: loads 600,000 nodes, each with one text of 1,000 code units, or, with `edges`,
 *  two nodes and 600,000 edges between them whose label texts hold 1,000 each, a column of
 *  600,000,000 code units beyond V8's longest string; then a graph of one node. Reports the
 *  problem of the first load, whether the canvas drew its nodes, and the time it took. */
async function atTheTextLimit(edges: boolean) {
  const count = 600_000;
  const text = "x".repeat(1000);
  const nodeAt = (id: string, x: number) => window.node(id, x);
  const graph = edges
    ? {
        nodes: [nodeAt("a", 0), nodeAt("b", 300)],
        edges: Array.from({ length: count }, (_, i) => ({
          id: `e${i}`,
          source: "a",
          target: "b",
          label: { text, t: 0.5, offset: 0 },
        })),
      }
    : {
        nodes: Array.from({ length: count }, (_, i) => ({
          ...nodeAt(`n${i}`, i * 200),
          content: [[{ kind: "text" as const, role: "title" as const, text }]],
        })),
        edges: [],
      };
  const start = performance.now();
  let problem: unknown = null;
  try {
    window.comb.load(graph);
  } catch (error) {
    problem = (error as Error & { problem?: unknown }).problem ?? String(error);
  }
  const ms = performance.now() - start;
  const drawn = window.inspect().nodes.length > 0;
  window.comb.load({ nodes: [nodeAt("ok", 0)], edges: [] });
  await window.comb.whenRendered();
  return { problem, drawn, ms };
}

test("load takes 600,000 titles and 600,000 label texts of 1,000 code units, their columns in pieces", async ({
  page,
}) => {
  // Verifies: ADR-0034
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  const titles = await page.evaluate(atTheTextLimit, false);
  const labels = await page.evaluate(atTheTextLimit, true);
  console.log(
    `600,000 texts of 1,000: ${titles.ms.toFixed(0)} ms titles, ${labels.ms.toFixed(0)} ms labels`,
  );
  expect(errors).toEqual([]);
  expect(titles).toEqual({ problem: null, drawn: true, ms: titles.ms });
  expect(labels).toEqual({ problem: null, drawn: true, ms: labels.ms });
});

/** The calls `installKinds` leaves in the page, one per kind of `GraphDataProblem`. */
type Kinds = Window & { kindCalls: Record<string, () => void> };

/** In the page: installs a call that provokes each kind of `GraphDataProblem` through `load` or an
 *  edit, which `everyKind` makes. Its table is typed by the kinds, so that a kind the union gains
 *  or loses fails the type check; it leaves out `contentBudgetExceeded`, more text than a browser
 *  test holds, which the bridge crate's tests decide. */
function installKinds() {
  const nodeAt = (id: string) => window.node(id);
  const [two, anEdge] = [[nodeAt("a"), nodeAt("b")], { id: "e", source: "a", target: "b" }];
  const [label, long] = [{ text: "e", t: 0.5, offset: 0 }, "x".repeat(256)];
  const load = (graph: unknown) => () => window.comb.load(graph as GraphData);
  const nodes = (fields: object) => load({ nodes: [{ ...nodeAt("a"), ...fields }], edges: [] });
  const edges = (fields: object) => load({ nodes: two, edges: [{ ...anEdge, ...fields }] });
  const title = { kind: "text", role: "title", text: "a" };
  const element = (fields: object) => nodes({ content: [[{ ...title, ...fields }]] });
  const segment = { fraction: 0.4, color: 0x22c55e };
  const calls: Record<Exclude<GraphDataProblem["kind"], "contentBudgetExceeded">, () => void> = {
    malformed: load(null),
    invalidField: nodes({ x: "1" }),
    nonFiniteCoordinate: nodes({ x: Number.POSITIVE_INFINITY }),
    beyondWorld: nodes({ x: 3e38, width: 3e38 }),
    invalidSize: nodes({ width: -1 }),
    invalidContentShape: nodes({ content: [5] }),
    tooManyRows: nodes({ content: Array.from({ length: 9 }, () => [title]) }),
    tooManyColumns: nodes({ content: [Array.from({ length: 7 }, () => title)] }),
    invalidElementKind: element({ kind: "icon" }),
    invalidWeight: element({ weight: 0 }),
    invalidRole: element({ role: "headline" }),
    invalidDirection: element({ kind: "metric", trend: { text: "x", direction: "sideways" } }),
    invalidContentText: element({ text: 5 }),
    contentTextTooLong: element({ text: "x".repeat(1001) }),
    invalidContentColor: element({ kind: "badge", color: 0x1000000 }),
    tooManySegments: element({ kind: "progress", segments: Array(9).fill(segment) }),
    invalidFraction: element({ kind: "progress", segments: [{ ...segment, fraction: -1 }] }),
    fractionsPastOne: element({ kind: "progress", segments: [segment, segment, segment] }),
    unknownPatchField: () => window.comb.updateNode("a", { id: "b" } as never),
    duplicateNode: load({ nodes: [nodeAt("a"), nodeAt("a")], edges: [] }),
    duplicateEdge: load({ nodes: two, edges: [anEdge, anEdge] }),
    missingNode: edges({ target: "z" }),
    nonFiniteLabel: edges({ label: { ...label, t: Number.NaN } }),
    invalidLabelText: edges({ label: { ...label, text: 5 } }),
    labelTextTooLong: edges({ label: { ...label, text: "x".repeat(1001) } }),
    invalidBackground: edges({ label: { ...label, background: -5 } }),
    invalidColor: edges({ color: -1 }),
    invalidDash: edges({ dash: [0, 4] }),
    tooMany: load({ nodes: new Array(1_000_001), edges: [] }),
    idTooLong: nodes({ id: long + "x" }),
    // 250,001 identifiers of 256 code units hold more than 64,000,000 together.
    idBudgetExceeded: load({
      nodes: Array.from({ length: 250_001 }, () => nodeAt(long)),
      edges: [],
    }),
    unknownNode: () => window.comb.updateNode("z", { content: [] }),
    unknownEdge: () => window.comb.removeEdges(["z"]),
    selfEdge: () => window.comb.addEdge({ id: "e", source: "a", target: "a" }),
    unknownEdgePatchField: () => {
      window.comb.addNode(nodeAt("b"));
      window.comb.addEdge({ id: "e", source: "a", target: "b" });
      window.comb.updateEdge("e", { width: 2 } as never);
    },
  };
  (window as unknown as Kinds).kindCalls = calls;
}

/** In the page: makes each call `installKinds` left, one after a valid load each, and reports the
 *  kind of problem each threw. */
function everyKind() {
  const nodeAt = (id: string) => window.node(id);
  const thrown: Record<string, unknown> = {};
  for (const [kind, call] of Object.entries((window as unknown as Kinds).kindCalls)) {
    window.comb.load({ nodes: [nodeAt("a")], edges: [] });
    try {
      call();
      thrown[kind] = "accepted";
    } catch (error) {
      thrown[kind] =
        error instanceof Error && error.name === "GraphDataError"
          ? (error as Error & { problem: GraphDataProblem }).problem.kind
          : `untyped ${String(error)}`;
    }
  }
  return thrown;
}

test("load and the methods that edit the graph throw every kind of GraphDataProblem", async ({
  page,
}) => {
  // Verifies: Q-3, Q-7, ADR-0034
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page.evaluate(installKinds);
  const thrown = await page.evaluate(everyKind);
  expect(errors).toEqual([]);
  expect(thrown).toEqual(Object.fromEntries(Object.keys(thrown).map((kind) => [kind, kind])));
  expect(Object.keys(thrown).length).toBe(35);
});
