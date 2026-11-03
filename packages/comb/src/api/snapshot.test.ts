// The snapshot hands over a string with a lone surrogate as `false`, which the bridge refuses, and
// every other string as it is, a well-formed surrogate pair among them (ADR-0009).
import { expect, test } from "bun:test";
import { edgeSnapshotOf, listsOf, nodeSnapshotOf, snapshotOf } from "./snapshot";

const limits = {
  text: 1000,
  id: 256,
  idBudget: 64_000_000,
  contentBudget: 1e9,
  rows: 8,
  columns: 6,
  segments: 8,
};

const cases: [name: string, value: string, read: string | false][] = [
  ["a lone high surrogate at the end", "ab\uD83D", false],
  ["a lone low surrogate at the start", "\uDE00ab", false],
  ["a well-formed pair", "a😀b", "a😀b"],
  ["no surrogate", "ab", "ab"],
];

for (const [name, value, read] of cases) {
  test(`the snapshot reads an identifier and a text with ${name}`, () => {
    // Verifies: ADR-0009
    const content = [[{ kind: "text", role: "title", text: value }]];
    const node = nodeSnapshotOf({ id: value, x: 0, y: 0, width: 1, content }, limits);
    const title = { kind: "text", role: "title", text: read };
    expect(node.snapshot).toMatchObject({ id: read, content: [[title]] });
    const edge = edgeSnapshotOf(
      { id: value, source: "a", target: "b", label: { text: value, t: 0.5, offset: 0 } },
      limits,
    );
    expect(edge.snapshot).toMatchObject({ id: read, label: { text: read } });
  });
}

test("the snapshot of a load stops reading once its texts of content pass the budget", () => {
  // Verifies: ADR-0010, Q-7
  // A budget of 5 code units: node n0's texts of 2 and 3 hold it, n1's of 1 passes it, and n2 is
  // not read at all.
  const text = (value: string) => ({ kind: "text", role: "title", text: value });
  const nodes = [
    { id: "n0", x: 0, y: 0, width: 1, content: [[text("aa"), text("aaa")]] },
    { id: "n1", x: 0, y: 0, width: 1, content: [[text("b")]] },
    {
      id: "n2",
      x: 0,
      y: 0,
      width: 1,
      get content(): never {
        throw new Error("read past the budget");
      },
    },
  ];
  const { kept, content } = snapshotOf(listsOf({ nodes, edges: [] } as never), {
    ...limits,
    contentBudget: 5,
  });
  expect(kept.nodes.map((node) => node && node.id)).toEqual(["n0", "n1"]);
  expect(content).toEqual({ units: 6, past: "n1" });
  // Within it, reading goes on.
  const within = snapshotOf(listsOf({ nodes: nodes.slice(0, 2), edges: [] } as never), {
    ...limits,
    contentBudget: 6,
  });
  expect(within.content).toEqual({ units: 6, past: undefined });
});

/** An object whose fields `fields` are getters that count each read into `reads` under
 *  `name.field`. */
function counting(name: string, fields: Record<string, unknown>, reads: Record<string, number>) {
  const counted: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(fields))
    Object.defineProperty(counted, field, {
      enumerable: true,
      get() {
        reads[`${name}.${field}`] = (reads[`${name}.${field}`] ?? 0) + 1;
        return value;
      },
    });
  return counted;
}

test("the snapshot reads each field of an element once, and a progress bar's and a metric's text and role not at all", () => {
  // Verifies: ADR-0009, ADR-0010
  const elements = (reads: Record<string, number>) => {
    const segment = counting("segment", { fraction: 0.5, color: 0x22c55e }, reads);
    const trend = counting("trend", { text: "+3%", direction: "up", color: 0x22c55e }, reads);
    const fields = (kind: string, more: Record<string, unknown>) => ({
      kind,
      role: "body",
      weight: 2,
      text: "t",
      ...more,
    });
    return [
      [counting("text", fields("text", {}), reads)],
      [counting("action", fields("action", { id: "go" }), reads)],
      [counting("badge", fields("badge", { color: 0x22c55e }), reads)],
      [counting("progress", fields("progress", { segments: [segment] }), reads)],
      [counting("metric", fields("metric", { caption: "c", value: "1", trend }), reads)],
    ];
  };
  const expected = {
    "text.kind": 1,
    "text.role": 1,
    "text.weight": 1,
    "text.text": 1,
    "action.kind": 1,
    "action.role": 1,
    "action.weight": 1,
    "action.text": 1,
    "action.id": 1,
    "badge.kind": 1,
    "badge.role": 1,
    "badge.weight": 1,
    "badge.text": 1,
    "badge.color": 1,
    "progress.kind": 1,
    "progress.weight": 1,
    "progress.segments": 1,
    "segment.fraction": 1,
    "segment.color": 1,
    "metric.kind": 1,
    "metric.weight": 1,
    "metric.caption": 1,
    "metric.value": 1,
    "metric.trend": 1,
    "trend.text": 1,
    "trend.direction": 1,
    "trend.color": 1,
  };
  // Through a load, which writes the columns, and through the snapshot of a single node alike.
  const loaded: Record<string, number> = {};
  const node = (content: unknown) => ({ id: "a", x: 0, y: 0, width: 100, content });
  snapshotOf(listsOf({ nodes: [node(elements(loaded))], edges: [] } as never), limits);
  expect(loaded).toEqual(expected);
  const single: Record<string, number> = {};
  nodeSnapshotOf(node(elements(single)), limits);
  expect(single).toEqual(expected);
});

test("the snapshot reads an icon's kind, weight, and name once, and its text, role, and identifier not at all", () => {
  // Verifies: ADR-0009, ADR-0010
  const icon = (reads: Record<string, number>) => [
    [
      counting(
        "icon",
        { kind: "icon", role: "body", weight: 2, text: "t", id: "go", name: "bet" },
        reads,
      ),
    ],
  ];
  const expected = { "icon.kind": 1, "icon.weight": 1, "icon.name": 1 };
  const node = (content: unknown) => ({ id: "a", x: 0, y: 0, width: 100, content });
  const loaded: Record<string, number> = {};
  const load = snapshotOf(listsOf({ nodes: [node(icon(loaded))], edges: [] } as never), limits);
  expect(loaded).toEqual(expected);
  // Its name crosses among the names, counted with the strings of content, and fills no text.
  const columns = load.snapshot.nodes.content;
  expect([...columns.textValid]).toEqual([]);
  expect([...columns.nameValid]).toEqual([1]);
  expect(columns.names.join("")).toBe("bet");
  expect(load.content.units).toBe(3);
  const single: Record<string, number> = {};
  const { snapshot } = nodeSnapshotOf(node(icon(single)), limits);
  expect(single).toEqual(expected);
  expect(snapshot).toMatchObject({ content: [[{ kind: "icon", weight: 2, name: "bet" }]] });
});

test("the snapshot reads content no further than one row, element, and segment past its limits, for a load and a single node alike", () => {
  // Verifies: ADR-0009, ADR-0010
  const read = (crossing: "load" | "single") => {
    const reads: Record<string, number> = {};
    const element = counting("element", { kind: "text", role: "body", text: "t" }, reads);
    const segment = counting("segment", { fraction: 0.1, color: 0 }, reads);
    const progress = { kind: "progress", segments: Array(limits.segments + 5).fill(segment) };
    const row = Array(limits.columns + 5).fill(element);
    const rows = [[progress], ...Array(limits.rows + 5).fill(row)];
    const node = { id: "a", x: 0, y: 0, width: 100, content: rows };
    if (crossing === "load") snapshotOf(listsOf({ nodes: [node], edges: [] } as never), limits);
    else nodeSnapshotOf(node, limits);
    return reads;
  };
  // The progress bar's row and `limits.rows` more, each of `limits.columns + 1` elements.
  const expected = {
    "element.kind": limits.rows * (limits.columns + 1),
    "element.role": limits.rows * (limits.columns + 1),
    "element.text": limits.rows * (limits.columns + 1),
    "segment.fraction": limits.segments + 1,
    "segment.color": limits.segments + 1,
  };
  expect(read("load")).toEqual(expected);
  expect(read("single")).toEqual(expected);
});

test("the snapshot reads the length of content, a row, and a progress bar's segments once, for a load and a single node alike", () => {
  // Verifies: ADR-0009
  const read = (crossing: "load" | "single") => {
    const reads: Record<string, number> = {};
    // A list whose length the host's code answers, counted, smaller on its first read than after.
    const listed = (name: string, items: unknown[]) =>
      new Proxy(items, {
        get(target, key, receiver) {
          if (key !== "length") return Reflect.get(target, key, receiver);
          reads[name] = (reads[name] ?? 0) + 1;
          return reads[name] === 1 ? target.length : 50;
        },
      });
    const segments = listed("segments", [{ fraction: 0.1, color: 0 }]);
    const row = listed("row", [{ kind: "progress", segments }]);
    const node = { id: "a", x: 0, y: 0, width: 100, content: listed("content", [row]) };
    if (crossing === "load") snapshotOf(listsOf({ nodes: [node], edges: [] } as never), limits);
    else nodeSnapshotOf(node, limits);
    return reads;
  };
  const once = { content: 1, row: 1, segments: 1 };
  expect(read("load")).toEqual(once);
  expect(read("single")).toEqual(once);
});
