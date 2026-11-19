// The activity diagram's building blocks, the veto of a move into a container, the kind a
// connection adds, and a flow's label, against what ticket 12 of uml-diagrams settled with the
// human on 2026-11-18 and the connector's roundness decided for history on 2026-11-19, written
// here from those decisions and docs/CONVENTIONS.md, not read from the example.
// Verifies: G-20
import { expect, test } from "bun:test";
import type { NodeShape } from "comb";
import {
  ACTIVITY_BORDERS,
  ACTIVITY_SHAPES,
  canMoveInto,
  connectedOf,
  flowLabelOf,
} from "./activity-diagram";
import { styleOf } from "./relationships";

/** Each kind's node shape, its outline where dashed, whether it holds nodes, and a height where
 *  it is given one: a send signal action a pentagon, an accept event action a notched rectangle,
 *  an accept time event action an hourglass; a decision a diamond, a fork and a join bars given a
 *  height; a data store and a central buffer rectangles; the interruptible and the expansion
 *  region dashed rounded rectangles holding nodes; an expansion node and a pin small rectangles; a
 *  connector an ellipse; an activity parameter node a rectangle. */
const BLOCKS: Record<string, { shape: NodeShape; dashed?: true; holds?: true; height?: true }> = {
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
  "fork-node": { shape: "bar", height: true },
  "join-node": { shape: "bar", height: true },
  "interruptible-region": { shape: "rounded-rectangle", dashed: true, holds: true },
  "expansion-region": { shape: "rounded-rectangle", dashed: true, holds: true },
  "expansion-node": { shape: "rectangle" },
  connector: { shape: "ellipse" },
  "activity-comment": { shape: "note" },
  "activity-frame": { shape: "frame" },
  "input-parameter": { shape: "rectangle" },
  "output-parameter": { shape: "rectangle" },
};

test("each kind of the activity diagram takes the building block settled for it", () => {
  expect(Object.keys(ACTIVITY_SHAPES).sort()).toEqual(Object.keys(BLOCKS).sort());
  for (const [kind, block] of Object.entries(BLOCKS)) {
    const { shape, outline, holds, height, width } =
      ACTIVITY_SHAPES[kind as keyof typeof ACTIVITY_SHAPES];
    const dashed = Array.isArray(outline) ? true : undefined;
    expect({ kind, shape, dashed, holds }).toEqual({
      kind,
      shape: block.shape,
      dashed: block.dashed,
      holds: block.holds,
    });
    // A bar given a height stands upright, taller than wide.
    if (block.height)
      expect({ kind, upright: (height ?? 0) > width }).toEqual({ kind, upright: true });
  }
});

test("a pin rides an action, an expansion node an expansion region, a parameter node the frame", () => {
  expect(ACTIVITY_BORDERS).toEqual({
    "input-pin": ["action", "call-behavior-action"],
    "output-pin": ["action", "call-behavior-action"],
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
