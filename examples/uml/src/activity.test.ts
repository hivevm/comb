// The activity diagram's building blocks, the veto of a move into a container, the kind a
// connection adds, and a flow's label, against what tickets 12 and 14 of uml-diagrams settled with
// the human on 2026-11-18 and the connector's roundness decided for history on 2026-11-19, written
// here from those decisions and docs/CONVENTIONS.md, not read from the example.
// Verifies: G-20
import { expect, test } from "bun:test";
import type { BorderNodeData, Comb, Divide, NodeShape } from "comb";
import {
  ACTIVITY_BORDERS,
  ACTIVITY_SHAPES,
  canMoveInto,
  connectedOf,
  droppedParameterSet,
  flowLabelOf,
  nodesOf,
} from "./activity";
import { styleOf } from "./relationships";

/** Each kind's node shape, its outline where dashed, whether it holds nodes, a height where it
 *  is given one, and the direction it is divided in: a send signal action a pentagon, an accept
 *  event action a notched rectangle, an accept time event action an hourglass; a decision and a
 *  merge diamonds, a fork and a join bars given a height, an initial node a circle, an activity
 *  final a ringed circle, a flow final a crossed circle; a data store and a central buffer
 *  rectangles; the interruptible and the expansion region and a structured node dashed rounded
 *  rectangles holding nodes, a conditional and a loop node the same divided one above the other;
 *  an expansion node, a pin, and a value pin small rectangles, a parameter set a dashed one; a
 *  connector an ellipse; an activity parameter node a rectangle; the frame divided across. */
const BLOCKS: Record<
  string,
  { shape: NodeShape; dashed?: true; holds?: true; height?: true; divide?: Divide }
> = {
  action: { shape: "rounded-rectangle" },
  "call-behavior-action": { shape: "rounded-rectangle" },
  "send-signal-action": { shape: "pentagon" },
  "accept-event-action": { shape: "notched-rectangle" },
  "accept-time-event-action": { shape: "hourglass" },
  "object-node": { shape: "rectangle" },
  "input-pin": { shape: "rectangle" },
  "output-pin": { shape: "rectangle" },
  "data-store": { shape: "rectangle" },
  "central-buffer": { shape: "rectangle" },
  "decision-node": { shape: "diamond" },
  "merge-node": { shape: "diamond" },
  "initial-node": { shape: "circle" },
  "activity-final": { shape: "ringed-circle" },
  "flow-final": { shape: "crossed-circle" },
  "fork-node": { shape: "bar", height: true },
  "join-node": { shape: "bar", height: true },
  "interruptible-region": { shape: "rounded-rectangle", dashed: true, holds: true },
  "expansion-region": { shape: "rounded-rectangle", dashed: true, holds: true },
  "expansion-node": { shape: "rectangle" },
  "structured-node": { shape: "rounded-rectangle", dashed: true, holds: true },
  "conditional-node": { shape: "rounded-rectangle", dashed: true, divide: "down" },
  "loop-node": { shape: "rounded-rectangle", dashed: true, divide: "down" },
  "value-pin": { shape: "rectangle" },
  "parameter-set": { shape: "rectangle", dashed: true },
  connector: { shape: "ellipse" },
  "activity-comment": { shape: "note" },
  "activity-frame": { shape: "frame", divide: "across" },
  "input-parameter": { shape: "rectangle" },
  "output-parameter": { shape: "rectangle" },
};

test("each kind of the activity diagram takes the building block settled for it", () => {
  expect(Object.keys(ACTIVITY_SHAPES).sort()).toEqual(Object.keys(BLOCKS).sort());
  for (const [kind, block] of Object.entries(BLOCKS)) {
    const { shape, outline, holds, height, width, divide } =
      ACTIVITY_SHAPES[kind as keyof typeof ACTIVITY_SHAPES];
    const dashed = Array.isArray(outline) ? true : undefined;
    expect({ kind, shape, dashed, holds, divide }).toEqual({
      kind,
      shape: block.shape,
      dashed: block.dashed,
      holds: block.holds,
      divide: block.divide,
    });
    // A bar given a height stands upright, taller than wide.
    if (block.height)
      expect({ kind, upright: (height ?? 0) > width }).toEqual({ kind, upright: true });
  }
});

test("a pin, a value pin, and a parameter set ride an action, an expansion node an expansion region, a parameter node the frame", () => {
  expect(ACTIVITY_BORDERS).toEqual({
    "input-pin": ["action", "call-behavior-action"],
    "output-pin": ["action", "call-behavior-action"],
    "value-pin": ["action", "call-behavior-action"],
    "parameter-set": ["action", "call-behavior-action"],
    "expansion-node": ["expansion-region"],
    "input-parameter": ["activity-frame"],
    "output-parameter": ["activity-frame"],
  });
});

test("the example allows a move into a partition or a region, and refuses one onto the canvas", () => {
  // Verifies: API-edits-report-nested-changes
  expect(canMoveInto({ node: "build", container: "shell" })).toBe(true);
  expect(canMoveInto({ node: "build", container: "interruptible" })).toBe(true);
  expect(canMoveInto({ node: "lay-out", container: "engine" })).toBe(true);
  expect(canMoveInto({ node: "build", container: null })).toBe(false);
});

test("a connection adds an anchor from a comment, an object flow at an object node, else a control flow", () => {
  expect(connectedOf("activity-comment", "action")).toBe("anchor");
  expect(connectedOf("activity-comment", "object-node")).toBe("anchor");
  expect(connectedOf("output-pin", "object-node")).toBe("object-flow");
  expect(connectedOf("decision-node", "input-pin")).toBe("object-flow");
  expect(connectedOf("action", "decision-node")).toBe("control-flow");
});

test("a flow's label shows its guard in brackets and its weight in braces", () => {
  expect(flowLabelOf({})).toBeNull();
  expect(flowLabelOf({ guard: "accepted" })).toBe("[accepted]");
  expect(flowLabelOf({ weight: "*" })).toBe("{weight=*}");
  expect(flowLabelOf({ guard: "rows left", weight: "2" })).toBe("[rows left] {weight=2}");
});

test("flows have an open arrowhead, and the interrupting edge and the exception handler are lightning bolts", () => {
  for (const kind of ["control-flow", "object-flow"] as const)
    expect(styleOf(kind)).toEqual({ color: 0x6b7280, arrow: "open" });
  for (const kind of ["interrupting-edge", "exception-handler"] as const)
    expect(styleOf(kind)).toEqual({ color: 0x6b7280, arrow: "open", lightning: true });
});

/** A height for any content, as Comb's least height of a node. */
const heightOf: Comb["heightOf"] = () => 64;

test("a frame dropped without partitions takes two of half its width, a conditional node two clauses, and a loop node its setup, test, and body, one above the other below its keyword", () => {
  // Settled with the human on 2026-11-19 for ticket 15 of uml-diagrams.
  const [frame] = nodesOf({ id: "f", kind: "activity-frame" }, { x: 0, y: 0 }, heightOf);
  expect(frame).toMatchObject({
    divide: "across",
    regions: [
      { id: "f-partition-1", name: "Partition 1", size: 600 },
      { id: "f-partition-2", name: "Partition 2", size: 600 },
    ],
  });
  // 240 high, its keyword 64 of it: each region an equal share of the 176 below.
  const dropped = {
    "conditional-node": ["Clause 1", "Clause 2"],
    "loop-node": ["setup", "test", "body"],
  } as const;
  for (const [kind, names] of Object.entries(dropped)) {
    const [node] = nodesOf(
      { id: "n", kind: kind as keyof typeof dropped },
      { x: 0, y: 0 },
      heightOf,
    );
    expect({ kind, divide: node?.divide, height: node?.height }).toEqual({
      kind,
      divide: "down",
      height: 240,
    });
    expect({ kind, regions: node?.regions?.map(({ name, size }) => [name, size]) }).toEqual({
      kind,
      regions: names.map((name) => [name, 176 / names.length]),
    });
    const size = { width: 360, height: 240, regions: [{ id: "body", name: "body", size: 200 }] };
    const [given] = nodesOf(
      { id: "n", kind: kind as keyof typeof dropped },
      { x: 0, y: 0 },
      heightOf,
      size,
    );
    expect({ kind, given }).toMatchObject({
      kind,
      given: { divide: "down", regions: [{ id: "body", name: "body", size: 200 }] },
    });
  }
  const [structured] = nodesOf({ id: "s", kind: "structured-node" }, { x: 0, y: 0 }, heightOf);
  expect(structured?.regions).toBeUndefined();
});

test("a parameter set dropped on an action's side is a dashed border node there, added before two new input pins inside it, each with its name", () => {
  // Settled with the human on 2026-11-19 for ticket 15 of uml-diagrams.
  for (const side of ["right", "top"] as const) {
    const place = { attachedTo: "a", side, offset: 100, length: 240 };
    const { nodes, activities } = droppedParameterSet("p", place, heightOf);
    expect(activities.map(({ kind }) => kind)).toEqual(["parameter-set", "input-pin", "input-pin"]);
    const [set, ...rest] = nodes as BorderNodeData[];
    expect({ side, id: set!.id, outline: set!.outline }).toEqual({
      side,
      id: "p",
      outline: [6, 4],
    });
    const along = side === "top" ? set!.width : set!.height!;
    for (const node of rest) {
      expect({ id: node.id, attachedTo: node.attachedTo, side: node.side }).toEqual({
        id: node.id,
        attachedTo: "a",
        side,
      });
    }
    // Each pin lies within the set along the side.
    for (const pin of rest.filter(({ id }) => activities.some((each) => each.id === id)))
      expect(Math.abs(pin.offset - set!.offset) + pin.width / 2).toBeLessThanOrEqual(along / 2);
  }
  // Dropped near the end of a side, it keeps clear of it.
  const near = droppedParameterSet(
    "p",
    { attachedTo: "a", side: "left", offset: 5, length: 240 },
    heightOf,
  );
  const set = near.nodes[0] as BorderNodeData;
  expect(set.offset - set.height! / 2).toBeGreaterThanOrEqual(0);
});
