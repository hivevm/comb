// The notation diagram of the example (G-20): the elements of UML 2.5.1's activity diagram that the
// load of `activity-diagram.ts` does not hold, in the notation `activity.ts` builds, as Comb drags
// a node into a container. Inside the frame of the activity "Drag a node", divided side by side
// into the partitions of the user, Comb, and the host application, Comb's divided again into the
// nested partitions of the shell and the engine (ARCH-regions-are-container-slots), it holds an
// initial node, an activity final and a flow final node, a merge node; a loop node, its setup,
// test, and body each a region, and a conditional node, its clauses each a region; a structured
// activity node; a value pin with its value beside it, a streaming pin with `{stream}` beside it,
// and a parameter set around two pins (ARCH-border-nodes-ride-sides). The decision, the guards, the
// call behavior action, and the comment that join them are of the load's notation too.
import type { Comb, EdgeData } from "comb";
import { activityData, ACTIVITY_EDITS, at, type FlowSeed, type Seed } from "./activity";
import { styleOf, type RelationshipKind } from "./relationships";
import type { DiagramData, DiagramDescriptor } from "./shared";

/** The frame of the drag, 1880 by 1640, its partitions 380, 1060, and 440 wide, Comb's divided
 *  into the shell's 540 and the engine's 520, and what lies in them, each centre relative to its
 *  partition's, its region's, or its container's top left corner. */
const SEEDS: Seed[] = [
  {
    node: { id: "drag", kind: "activity-frame", name: "Drag a node" },
    place: { x: 940, y: 820 },
    size: {
      width: 1880,
      height: 1640,
      regions: [
        { id: "user", name: "User", size: 380 },
        {
          id: "comb",
          name: "Comb",
          size: 1060,
          regions: [
            { id: "shell", name: "Shell", size: 540 },
            { id: "engine", name: "Engine", size: 520 },
          ],
        },
        { id: "host", name: "Host application", size: 440 },
      ],
    },
  },
  // The user.
  { node: { id: "start", kind: "initial-node" }, place: at("user", 190, 140) },
  {
    node: { id: "press", kind: "action", name: "Press on a node" },
    place: at("user", 190, 300),
    size: { width: 240, height: 64 },
  },
  // The shell: the loop of the drag, putting the node back, and the end.
  {
    node: { id: "follow-loop", kind: "loop-node" },
    place: at("shell", 270, 480),
    size: {
      width: 460,
      height: 640,
      regions: [
        { id: "setup", name: "setup", size: 140 },
        { id: "test", name: "test", size: 140 },
        { id: "body", name: "body", size: 300 },
      ],
    },
  },
  {
    node: { id: "lift", kind: "action", name: "Lift the node" },
    place: at("setup", 250, 70),
    size: { width: 240, height: 64 },
  },
  {
    node: { id: "test-pointer", kind: "action", name: "Test the pointer" },
    place: at("test", 250, 70),
    size: { width: 240, height: 64 },
  },
  {
    node: { id: "follow", kind: "action", name: "Follow the pointer" },
    place: at("body", 250, 150),
    size: { width: 240, height: 160 },
  },
  {
    node: { id: "follow-point", kind: "output-pin", name: "point", stream: true },
    place: { attachedTo: "follow", side: "right", offset: 80 },
  },
  {
    node: { id: "put-back", kind: "action", name: "Put the node back" },
    place: at("shell", 270, 860),
    size: { width: 240, height: 64 },
  },
  { node: { id: "merge", kind: "merge-node" }, place: at("shell", 270, 1320) },
  { node: { id: "end", kind: "activity-final" }, place: at("shell", 270, 1460) },
  // The engine: the container under the pointer, and the move.
  {
    node: { id: "hit", kind: "conditional-node" },
    place: at("engine", 260, 420),
    size: {
      width: 440,
      height: 420,
      regions: [
        { id: "over-container", name: "over a container", size: 160 },
        { id: "otherwise", name: "else", size: 200 },
      ],
    },
  },
  {
    node: { id: "take-container", kind: "action", name: "Take the deepest container" },
    place: at("over-container", 240, 80),
    size: { width: 300, height: 64 },
  },
  {
    node: { id: "take-canvas", kind: "action", name: "Take the canvas" },
    place: at("otherwise", 240, 100),
  },
  {
    node: { id: "take-canvas-container", kind: "value-pin", value: "null" },
    place: { attachedTo: "take-canvas", side: "left", offset: 30 },
  },
  {
    node: { id: "moving", kind: "structured-node" },
    place: at("engine", 260, 1160),
    size: { width: 440, height: 460 },
  },
  {
    node: { id: "move", kind: "action", name: "Move the node" },
    place: at("moving", 190, 200),
    size: { width: 200, height: 240 },
  },
  // The set is added before its pins, so that they are drawn above it.
  {
    node: { id: "position", kind: "parameter-set" },
    place: { attachedTo: "move", side: "left", offset: 90 },
    size: { width: 28, height: 124 },
  },
  {
    node: { id: "move-x", kind: "input-pin", name: "x" },
    place: { attachedTo: "move", side: "left", offset: 40 },
  },
  {
    node: { id: "move-y", kind: "input-pin", name: "y" },
    place: { attachedTo: "move", side: "left", offset: 140 },
  },
  {
    node: { id: "tell", kind: "action", name: "Tell nodeMoved" },
    place: at("moving", 190, 390),
    size: { width: 200, height: 64 },
  },
  { node: { id: "told", kind: "flow-final" }, place: at("moving", 370, 390) },
  // The host application: its veto.
  {
    node: { id: "can-move", kind: "call-behavior-action", name: "canMoveInto" },
    place: at("host", 220, 720),
  },
  { node: { id: "veto", kind: "decision-node" }, place: at("host", 220, 920) },
  {
    node: {
      id: "veto-note",
      kind: "activity-comment",
      body: ["A refused move tells", "no change."],
    },
    place: at("host", 220, 1100),
  },
];

/** Each flow: its source, its target, its kind where it is no control flow, and its guard. */
const FLOWS: FlowSeed[] = [
  ["start", "press"],
  ["press", "follow-loop"],
  ["lift", "test-pointer"],
  ["test-pointer", "follow"],
  ["follow-loop", "hit"],
  ["hit", "can-move"],
  ["can-move", "veto"],
  ["veto", "moving", "control-flow", { guard: "allowed" }],
  ["veto", "put-back", "control-flow", { guard: "refused" }],
  ["move", "tell"],
  ["tell", "told"],
  ["moving", "merge"],
  ["put-back", "merge"],
  ["merge", "end"],
];

/** The edge that is no flow: the anchor of the comment on the decision of the veto. */
const OTHERS: [EdgeData, RelationshipKind][] = [
  [
    {
      id: "veto-note-anchor",
      source: "veto-note",
      target: "veto",
      sourceSide: "outline",
      targetSide: "outline",
      ...styleOf("anchor"),
    },
    "anchor",
  ],
];

/** The notation diagram as graph data, as `activityData` builds it from what is written above. */
export function notationDiagram(heightOf: Comb["heightOf"]): DiagramData {
  return activityData(SEEDS, FLOWS, OTHERS, heightOf);
}

/** The notation diagram as the host application chooses it: no palette, and the rest as
 *  `ACTIVITY_EDITS` says. */
export const NOTATION_DIAGRAM: DiagramDescriptor = {
  id: "notation",
  name: "Notation diagram",
  build: notationDiagram,
  nouns: ["elements", "edges"],
  nodes: [],
  ...ACTIVITY_EDITS,
};
