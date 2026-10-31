// The metric tree of the example (G-9): bets lead to epics, epics to input metrics, input metrics
// to one north-star metric, and that to KPIs. Edges between metrics carry their correlation;
// every edge ends in an arrowhead at its target.
import type { EdgeData, GraphData, NodeContent, NodeData } from "comb";

const GREY = 0x9aa1ad;
const GREEN = 0x22a55b;
const RED = 0xe0453a;
export const NODE_WIDTH = 220;
/** The height Comb lays a node of one title out to, the least height of a node (ADR-0013). */
export const NODE_HEIGHT = 64;
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

/** The content of a node that shows `title` alone: one row of one text of role title. */
export function titled(title: string): NodeContent {
  return [[{ kind: "text", role: "title", text: title }]];
}

/** The title a node of the example shows: the text of its first title, or none. */
export function titleOf(node: Pick<NodeData, "content">): string {
  for (const row of node.content)
    for (const element of row)
      if (element.kind === "text" && element.role === "title") return element.text;
  return "";
}

function nodesOf(copy: number, top: number): NodeData[] {
  return columns.flatMap((titles, c) =>
    titles.map((title, r) => ({
      id: `${copy}:${c}.${r}`,
      x: c * COLUMN,
      y: top + (r - (titles.length - 1) / 2) * ROW,
      width: NODE_WIDTH,
      content: titled(title),
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
      // Edges without a correlation, from bets to epics to input metrics, are dashed.
      dash: correlation === undefined ? ([6, 4] as const) : undefined,
      label:
        correlation === undefined
          ? undefined
          : { text: correlation.toFixed(3), t: 0.5, offset: 0, background: color },
    };
  });
}

/** The tree `copies` times, in a grid about as wide as it is tall, so that fitting the view
 *  shows all of them. */
export function metricTree(copies: number): GraphData {
  const width = columns.length * COLUMN;
  const height = 7 * ROW;
  const perRow = Math.ceil(Math.sqrt((copies * height) / width));
  const trees = Array.from({ length: copies }, (_, copy) => copy);
  return {
    nodes: trees.flatMap((copy) =>
      nodesOf(copy, Math.floor(copy / perRow) * height).map((node) => ({
        ...node,
        x: node.x + (copy % perRow) * width,
      })),
    ),
    edges: trees.flatMap((copy) => edgesOf(copy)),
  };
}
