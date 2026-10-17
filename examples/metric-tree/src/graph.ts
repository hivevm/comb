// The metric tree of the example (G-9): bets lead to epics, epics to input metrics, input metrics
// to one north-star metric, and that to KPIs. Edges between metrics carry their correlation.
import type { EdgeData, GraphData, NodeData } from "comb";

const GREY = 0x9aa1ad;
const GREEN = 0x22a55b;
const RED = 0xe0453a;
const WIDTH = 220;
const HEIGHT = 64;
const COLUMN = 300;
const ROW = 110;

const columns: string[][] = [
  ["Launch push notifications", "Improve song recommendations"],
  [
    "New marketing campaign",
    "Social notifications",
    "Time-based notifications",
    "AI model for song recommendations",
    "More prominent sharing prompts",
  ],
  [
    "Premium trial users",
    "Avg. sessions per week",
    "Average session duration",
    "Avg. shares per session",
  ],
  ["Time spent listening to music by subscribers"],
  ["ARR", "Monthly retention", "Monthly premium subscriptions"],
];

const links: [string, string, number?][] = [
  ["0.0", "1.1"],
  ["0.0", "1.2"],
  ["0.1", "1.3"],
  ["1.0", "2.0"],
  ["1.1", "2.1"],
  ["1.2", "2.1"],
  ["1.3", "2.2"],
  ["1.4", "2.3"],
  ["2.0", "3.0", 0.998],
  ["2.1", "3.0", 0.998],
  ["2.2", "3.0", -0.644],
  ["2.3", "3.0", 0.999],
  ["3.0", "4.0", 0.224],
  ["3.0", "4.1", 0.999],
  ["3.0", "4.2", 0.998],
];

function nodesOf(copy: number, top: number): NodeData[] {
  return columns.flatMap((titles, c) =>
    titles.map((title, r) => ({
      id: `${copy}:${c}.${r}`,
      title,
      x: c * COLUMN,
      y: top + (r - (titles.length - 1) / 2) * ROW,
      width: WIDTH,
      height: HEIGHT,
    })),
  );
}

function edgesOf(copy: number): EdgeData[] {
  return links.map(([from, to, correlation]) => {
    const color = correlation === undefined ? GREY : correlation < 0 ? RED : GREEN;
    return {
      id: `${copy}:${from}-${to}`,
      source: `${copy}:${from}`,
      target: `${copy}:${to}`,
      color,
      label:
        correlation === undefined
          ? undefined
          : { text: correlation.toFixed(3), t: 0.5, offset: 0, background: color },
    };
  });
}

/** The tree `copies` times, stacked vertically. */
export function metricTree(copies: number): GraphData {
  const height = 6 * ROW;
  const trees = Array.from({ length: copies }, (_, copy) => copy);
  return {
    nodes: trees.flatMap((copy) => nodesOf(copy, copy * height)),
    edges: trees.flatMap((copy) => edgesOf(copy)),
  };
}
