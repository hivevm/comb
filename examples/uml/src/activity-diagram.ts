// The activity diagram of the example (G-20): a load of Comb, from `createComb` to the first
// frame, in the notation of UML 2.5.1 that `activity.ts` builds, inside the frame of its activity,
// which is divided side by side into the partitions of the host application, the shell, and the
// engine, each named in its band (ARCH-regions-are-container-slots). It holds actions and call
// behavior actions, send signal, accept event, and accept time event actions, object nodes, pins,
// a data store and a central buffer, the veto as a decision, a fork and a join, an interruptible
// region with its interrupting edge, an exception handler, an expansion region with its expansion
// nodes, a pair of connectors, comments anchored on a node and at the middle of an edge
// (API-edges-dock-nodes-or-edges), and the frame's activity parameter nodes. The notation diagram
// shows the elements of the activity diagram this load does not hold.
import type { Comb, EdgeData } from "comb";
import { activityData, ACTIVITY_EDITS, at, type FlowSeed, type Seed } from "./activity";
import { styleOf, type RelationshipKind } from "./relationships";
import type { DiagramData, DiagramDescriptor } from "./shared";

/** The frame of the load, 1760 by 1520, its partitions 520, 600, and 640 wide, and what lies in
 *  them, each centre relative to its partition's or its region's top left corner. */
const SEEDS: Seed[] = [
  {
    node: { id: "load", kind: "activity-frame", name: "Load" },
    place: { x: 880, y: 760 },
    size: {
      width: 1760,
      height: 1520,
      regions: [
        { id: "host", name: "Host application", size: 520 },
        { id: "shell", name: "Shell", size: 600 },
        { id: "engine", name: "Engine", size: 640 },
      ],
    },
  },
  {
    node: { id: "options", kind: "input-parameter", name: "options : CombOptions" },
    place: { attachedTo: "load", side: "left", offset: 174 },
  },
  {
    node: { id: "comb", kind: "output-parameter", name: "comb : Comb" },
    place: { attachedTo: "load", side: "top", offset: 1000 },
  },
  // The host application.
  {
    node: { id: "build", kind: "action", name: "Build the graph" },
    place: at("host", 260, 420),
  },
  {
    node: { id: "build-graph", kind: "output-pin", name: "graph" },
    place: { attachedTo: "build", side: "right", offset: 30 },
  },
  {
    node: { id: "graph", kind: "object-node", name: "graph : GraphData" },
    place: at("host", 260, 620),
  },
  {
    node: {
      id: "refused-note",
      kind: "activity-comment",
      body: ["A refused load throws", "GraphDataError."],
    },
    place: at("host", 260, 830),
  },
  {
    node: { id: "copy", kind: "data-store", name: "the host's copy" },
    place: at("host", 260, 1250),
  },
  // The shell.
  {
    node: { id: "create", kind: "call-behavior-action", name: "createComb" },
    place: at("shell", 300, 140),
  },
  {
    node: { id: "create-options", kind: "input-pin", name: "options" },
    place: { attachedTo: "create", side: "left", offset: 30 },
  },
  {
    node: { id: "create-comb", kind: "output-pin", name: "comb" },
    place: { attachedTo: "create", side: "right", offset: 30 },
  },
  {
    node: { id: "refuse", kind: "action", name: "Refuse the engine" },
    place: at("shell", 120, 330),
    size: { width: 200, height: 120 },
  },
  {
    node: { id: "refuse-error", kind: "input-pin", name: "error" },
    place: { attachedTo: "refuse", side: "right", offset: 30 },
  },
  {
    node: { id: "lost", kind: "send-signal-action", name: "EngineLostError" },
    place: at("shell", 470, 330),
  },
  {
    node: { id: "apply", kind: "call-behavior-action", name: "load" },
    place: at("shell", 300, 560),
  },
  {
    node: { id: "apply-graph", kind: "input-pin", name: "graph" },
    place: { attachedTo: "apply", side: "left", offset: 30 },
  },
  {
    node: { id: "apply-rows", kind: "output-pin", name: "rows" },
    place: { attachedTo: "apply", side: "right", offset: 30 },
  },
  { node: { id: "veto", kind: "decision-node" }, place: at("shell", 300, 720) },
  {
    node: { id: "graph-error", kind: "send-signal-action", name: "GraphDataError" },
    place: at("shell", 480, 820),
  },
  { node: { id: "fork", kind: "fork-node" }, place: at("shell", 300, 880) },
  {
    node: { id: "bind", kind: "action", name: "Bind the scene" },
    place: at("shell", 130, 1010),
    size: { width: 200, height: 64 },
  },
  { node: { id: "join", kind: "join-node" }, place: at("shell", 300, 1110) },
  {
    node: { id: "next-frame", kind: "accept-time-event-action", name: "next frame" },
    place: at("shell", 300, 1250),
  },
  {
    node: { id: "draw", kind: "call-behavior-action", name: "DrawFrame" },
    place: at("shell", 300, 1380),
  },
  {
    node: { id: "draw-heights", kind: "input-pin", name: "heights" },
    place: { attachedTo: "draw", side: "right", offset: 30 },
  },
  {
    node: { id: "draw-change", kind: "output-pin", name: "loaded" },
    place: { attachedTo: "draw", side: "left", offset: 30 },
  },
  {
    node: { id: "heights", kind: "central-buffer", name: "heights" },
    place: at("shell", 490, 1260),
  },
  { node: { id: "a-in", kind: "connector", name: "A" }, place: at("shell", 510, 1110) },
  // The engine.
  {
    node: { id: "interruptible", kind: "interruptible-region" },
    place: at("engine", 320, 300),
    size: { width: 560, height: 300 },
  },
  {
    node: { id: "instantiate", kind: "action", name: "Instantiate the engine" },
    place: at("interruptible", 170, 90),
    size: { width: 240, height: 64 },
  },
  {
    node: { id: "trap", kind: "accept-event-action", name: "trap" },
    place: at("interruptible", 170, 220),
  },
  {
    node: {
      id: "trap-note",
      kind: "activity-comment",
      body: ["A trap loses the engine", "of every Comb on the page."],
    },
    place: at("engine", 320, 560),
  },
  {
    node: { id: "measure", kind: "expansion-region", mode: "iterative" },
    place: at("engine", 320, 900),
    size: { width: 400, height: 300 },
  },
  {
    node: { id: "rows", kind: "expansion-node" },
    place: { attachedTo: "measure", side: "top", offset: 200 },
  },
  {
    node: { id: "row-heights", kind: "expansion-node" },
    place: { attachedTo: "measure", side: "bottom", offset: 200 },
  },
  {
    node: { id: "lay-out", kind: "action", name: "Lay out the row" },
    place: at("measure", 200, 150),
  },
  {
    node: { id: "lay-out-row", kind: "input-pin", name: "row" },
    place: { attachedTo: "lay-out", side: "left", offset: 30 },
  },
  {
    node: { id: "lay-out-height", kind: "output-pin", name: "height" },
    place: { attachedTo: "lay-out", side: "right", offset: 30 },
  },
  { node: { id: "a-out", kind: "connector", name: "A" }, place: at("engine", 320, 1250) },
];

/** Each flow: its source, its target, its kind where it is no control flow, and its guard and
 *  weight. */
const FLOWS: FlowSeed[] = [
  ["options", "create-options", "object-flow"],
  ["create-comb", "comb", "object-flow"],
  ["create", "instantiate"],
  ["instantiate", "apply"],
  ["build-graph", "graph", "object-flow"],
  ["graph", "apply-graph", "object-flow"],
  ["apply", "veto"],
  ["veto", "graph-error", "control-flow", { guard: "refused" }],
  ["veto", "fork", "control-flow", { guard: "accepted" }],
  ["fork", "bind"],
  ["fork", "measure"],
  ["apply-rows", "rows", "object-flow"],
  ["rows", "lay-out-row", "object-flow"],
  ["lay-out-height", "row-heights", "object-flow"],
  ["row-heights", "a-out", "object-flow"],
  ["a-in", "heights", "object-flow"],
  ["heights", "draw-heights", "object-flow", { weight: "*" }],
  ["bind", "join"],
  ["measure", "join"],
  ["join", "next-frame"],
  ["next-frame", "draw"],
  ["draw-change", "copy", "object-flow"],
  ["trap", "lost", "interrupting-edge"],
];

/** The edges that are no flow: the exception handler, from the protected action to the pin of the
 *  handler's body that takes the error, and the anchors of the comments, one on the decision of
 *  the veto, one at the middle of the interrupting edge. */
const OTHERS: [EdgeData, RelationshipKind][] = [
  [
    {
      id: "instantiate-refuse-error",
      source: "instantiate",
      target: "refuse-error",
      sourceSide: "outline",
      targetSide: "outline",
      ...styleOf("exception-handler"),
    },
    "exception-handler",
  ],
  [
    {
      id: "refused-note-anchor",
      source: "refused-note",
      target: "veto",
      sourceSide: "outline",
      targetSide: "outline",
      ...styleOf("anchor"),
    },
    "anchor",
  ],
  [
    {
      id: "trap-note-anchor",
      source: "trap-note",
      sourceSide: "outline",
      targetEdge: "trap-lost",
      targetT: 0.5,
      ...styleOf("anchor"),
    },
    "anchor",
  ],
];

/** The activity diagram as graph data, as `activityData` builds it from what is written above. */
export function activityDiagram(heightOf: Comb["heightOf"]): DiagramData {
  return activityData(SEEDS, FLOWS, OTHERS, heightOf);
}

/** The activity diagram as the host application chooses it: the palette drops each kind of the
 *  load, each edited as its notation shows it, the frame by its name and its partitions' names, and
 *  the rest as `ACTIVITY_EDITS` says. */
export const ACTIVITY_DIAGRAM: DiagramDescriptor = {
  id: "activity",
  name: "Activity diagram",
  build: activityDiagram,
  nouns: ["elements", "edges"],
  nodes: [
    { kind: "action", name: "Action", form: "name" },
    { kind: "call-behavior-action", name: "Call behavior action", form: "name" },
    { kind: "send-signal-action", name: "Send signal action", form: "name" },
    { kind: "accept-event-action", name: "Accept event action", form: "name" },
    { kind: "accept-time-event-action", name: "Accept time event action", form: "name" },
    { kind: "object-node", name: "Object node", form: "name" },
    { kind: "input-pin", name: "Input pin", form: "name" },
    { kind: "output-pin", name: "Output pin", form: "name" },
    { kind: "data-store", name: "Data store", form: "name" },
    { kind: "central-buffer", name: "Central buffer", form: "name" },
    { kind: "decision-node", name: "Decision", form: "none" },
    { kind: "fork-node", name: "Fork", form: "none" },
    { kind: "join-node", name: "Join", form: "none" },
    { kind: "interruptible-region", name: "Interruptible region", form: "none" },
    { kind: "expansion-region", name: "Expansion region", form: "mode" },
    { kind: "expansion-node", name: "Expansion node", form: "none" },
    { kind: "connector", name: "Connector", form: "name" },
    { kind: "activity-comment", name: "Comment", form: "lines" },
    { kind: "activity-frame", name: "Activity frame", form: "name-and-partitions" },
    { kind: "input-parameter", name: "Input parameter node", form: "name" },
    { kind: "output-parameter", name: "Output parameter node", form: "name" },
  ],
  ...ACTIVITY_EDITS,
};
