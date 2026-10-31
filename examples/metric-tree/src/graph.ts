// The metric tree of the example (G-9): bets lead to epics, epics to input metrics, input metrics
// to one north-star metric, and that to KPIs. Each node's type is told only by the content the
// example describes for it (G-10). Edges between metrics carry their correlation; every edge ends
// in an arrowhead at its target.
import type { ContentElement, EdgeData, GraphData, NodeContent, NodeData } from "comb";

const GREY = 0x9aa1ad;
const GREEN = 0x22a55b;
const RED = 0xe0453a;
export const NODE_WIDTH = 220;
/** The height Comb lays a node of one title out to, the least height of a node (ADR-0013). */
export const NODE_HEIGHT = 64;
const COLUMN = 300;
const ROW = 110;

/** The types of node of the tree, each named as the icon it shows. */
export type NodeType = "bet" | "epic" | "input-metric" | "north-star" | "kpi";

/** The statuses of a bet and of an epic, each with the colour of its badge: white text on each
 *  has a contrast ratio of at least 4.5. */
export const STATUSES = {
  bet: { Idea: 0x4b5563, Testing: 0x1d4ed8, Validated: 0x15803d, Invalidated: 0xb91c1c },
  epic: { Planned: 0x4b5563, "In progress": 0x1d4ed8, Done: 0x15803d, Blocked: 0xb91c1c },
} as const;
export type BetStatus = keyof (typeof STATUSES)["bet"];
export type EpicStatus = keyof (typeof STATUSES)["epic"];

/** A metric's value in one period and its change from the period before, in percent. */
export interface Period {
  label: string;
  value: string;
  change: number;
}

/** What the sidebar edits of a node, by its type, from which the example describes its content. */
export type Fields =
  | { type: "bet"; title: string; hypothesis: string; status: BetStatus }
  | { type: "epic"; title: string; progress: number; status: EpicStatus }
  | { type: "input-metric" | "north-star" | "kpi"; title: string; periods: Period[] };

/** Per type, the colour of its icon, what the sidebar calls it, the title a node of it dropped
 *  from the palette starts with, and the caption beside its "Details" where it shows no badge. */
export const TYPES: Record<
  NodeType,
  { color: string; name: string; dropped: string; caption?: string }
> = {
  bet: { color: "#7c3aed", name: "Bet", dropped: "New bet" },
  epic: { color: "#2563eb", name: "Epic", dropped: "New epic" },
  "input-metric": {
    color: "#0891b2",
    name: "Input metric",
    dropped: "New input metric",
    caption: "Last three quarters",
  },
  "north-star": {
    color: "#d97706",
    name: "North-star metric",
    dropped: "New north-star metric",
    caption: "North-star metric",
  },
  kpi: { color: "#16a34a", name: "KPI", dropped: "New KPI", caption: "KPI" },
};

/** The height Comb lays a node of each type out to, from the engine's padding of 10 above and
 *  below and the shell's lines (ADR-0013): a title's row of 18; a hypothesis's or a progress bar's
 *  row of 16; a badge's row of 22; a row of metrics of 30; a caption beside "Details" of 16. The
 *  example places each node by it so that its middle, where its edges meet it, lies on its row. */
export const HEIGHTS: Record<NodeType, number> = {
  bet: 10 + 18 + 16 + 22 + 10,
  epic: 10 + 18 + 16 + 22 + 10,
  "input-metric": 10 + 18 + 30 + 16 + 10,
  "north-star": 10 + 18 + 30 + 16 + 10,
  kpi: 10 + 18 + 30 + 16 + 10,
};

/** The colour of a trend, drawn on the node's white: green up, red down, grey flat, each with a
 *  contrast ratio of at least 4.5 there. */
const TRENDS = { up: 0x15803d, down: 0xb91c1c, flat: 0x4b5563 } as const;
/** The colour of an epic's progress bar. */
const PROGRESS = 0x2563eb;
/** The identifier of the action every node shows, which opens it in the sidebar. */
export const DETAILS = "details";

/** The element of `period`: its label above its value, its change as its trend. */
function metricOf({ label, value, change }: Period): ContentElement {
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  // The arrow tells the direction, so that the text, without a sign, fits three periods.
  const text = `${Math.abs(change)}%`;
  return {
    kind: "metric",
    caption: label,
    value,
    trend: { text, direction, color: TRENDS[direction] },
  };
}

/** The content of a node of `fields`: its icon beside its title; below them what its type shows;
 *  and last "Details", beside a bet's or an epic's status badge or a metric's caption. */
export function contentOf(fields: Fields): NodeContent {
  const head: ContentElement[] = [
    { kind: "icon", name: fields.type },
    { kind: "text", role: "title", text: fields.title, weight: 9 },
  ];
  const details: ContentElement = { kind: "action", text: "Details", id: DETAILS };
  switch (fields.type) {
    case "bet":
      return [
        head,
        [{ kind: "text", role: "body", text: fields.hypothesis }],
        [badge(fields.status, STATUSES.bet[fields.status]), details],
      ];
    case "epic":
      return [
        head,
        [
          {
            kind: "progress",
            segments: [{ fraction: fields.progress / 100, color: PROGRESS }],
            weight: 4,
          },
          { kind: "text", role: "caption", text: `${fields.progress}%` },
        ],
        [badge(fields.status, STATUSES.epic[fields.status]), details],
      ];
    default:
      return [
        head,
        fields.periods.map(metricOf),
        [{ kind: "text", role: "caption", text: TYPES[fields.type].caption!, weight: 2 }, details],
      ];
  }
}

function badge(text: string, color: number): ContentElement {
  return { kind: "badge", text, color, weight: 2 };
}

/** The fields a node of `type` dropped from the palette starts with. */
export function newFields(type: NodeType): Fields {
  const title = TYPES[type].dropped;
  switch (type) {
    case "bet":
      return { type, title, hypothesis: "We believe that ...", status: "Idea" };
    case "epic":
      return { type, title, progress: 0, status: "Planned" };
    case "input-metric":
      return { type, title, periods: ["Q1", "Q2", "Q3"].map(period) };
    default:
      return { type, title, periods: [period("This quarter")] };
  }
}

const period = (label: string): Period => ({ label, value: "0", change: 0 });

/** The content of a node that shows `title` alone: one row of one text of role title. */
export function titled(title: string): NodeContent {
  return [[{ kind: "text", role: "title", text: title }]];
}

/** `content` with the text of its first title replaced by `title`, every other element kept. */
export function retitled(content: NodeContent, title: string): NodeContent {
  let done = false;
  return content.map((row) =>
    row.map((element) => {
      if (done || element.kind !== "text" || element.role !== "title") return element;
      done = true;
      return { ...element, text: title };
    }),
  );
}

/** The title a node of the example shows: the text of its first title, or none. */
export function titleOf(node: Pick<NodeData, "content">): string {
  for (const row of node.content)
    for (const element of row)
      if (element.kind === "text" && element.role === "title") return element.text;
  return "";
}

const q = (values: [string, string, string], changes: [number, number, number]): Period[] =>
  values.map((value, i) => ({ label: `Q${i + 1}`, value, change: changes[i]! }));

/** The nodes of one tree by column, from left to right. */
const columns: Fields[][] = [
  [
    {
      type: "bet",
      title: "Launch push notifications",
      hypothesis: "Reminders bring listeners back",
      status: "Testing",
    },
    {
      type: "bet",
      title: "Improve song recommendations",
      hypothesis: "Better picks keep listeners longer",
      status: "Validated",
    },
  ],
  [
    { type: "epic", title: "New marketing campaign", progress: 100, status: "Done" },
    { type: "epic", title: "Social notifications", progress: 60, status: "In progress" },
    { type: "epic", title: "Time-based notifications", progress: 35, status: "In progress" },
    { type: "epic", title: "AI model for song recommendations", progress: 20, status: "Blocked" },
    { type: "epic", title: "More prominent sharing prompts", progress: 0, status: "Planned" },
  ],
  [
    {
      type: "input-metric",
      title: "Premium trial users",
      periods: q(["12k", "13k", "14k"], [4, 8, 8]),
    },
    {
      type: "input-metric",
      title: "Avg. sessions per week",
      periods: q(["4.1", "4.4", "4.3"], [2, 7, -2]),
    },
    {
      type: "input-metric",
      title: "Average session duration",
      periods: q(["21m", "21m", "23m"], [-3, 0, 9]),
    },
    {
      type: "input-metric",
      title: "Avg. shares per session",
      periods: q(["2.0", "2.1", "2.2"], [0, 5, 5]),
    },
  ],
  [
    {
      type: "north-star",
      title: "Weekly listening time",
      periods: [{ label: "Hours per subscriber and week", value: "6.2 h", change: 4 }],
    },
  ],
  [
    {
      type: "kpi",
      title: "ARR",
      periods: [{ label: "This quarter", value: "$4.2M", change: 8 }],
    },
    {
      type: "kpi",
      title: "Monthly retention",
      periods: [{ label: "Last month", value: "92%", change: -1 }],
    },
    {
      type: "kpi",
      title: "Monthly premium subscriptions",
      periods: [{ label: "Last month", value: "310k", change: 3 }],
    },
  ],
];
/** The content of each node of `columns`, shared by every copy of the tree. */
const contents = columns.map((column) => column.map(contentOf));

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

function nodesOf(copy: number, left: number, top: number, fields: Map<string, Fields>): NodeData[] {
  return columns.flatMap((column, c) =>
    column.map((each, r) => {
      const id = `${copy}:${c}.${r}`;
      fields.set(id, each);
      const middle = top + (r - (column.length - 1) / 2) * ROW + NODE_HEIGHT / 2;
      return {
        id,
        x: left + c * COLUMN,
        y: middle - HEIGHTS[each.type] / 2,
        width: NODE_WIDTH,
        content: contents[c]![r]!,
      };
    }),
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
 *  shows all of them, with the fields of each node by its identifier. */
export function metricTree(copies: number): { graph: GraphData; fields: Map<string, Fields> } {
  const width = columns.length * COLUMN;
  const height = 7 * ROW;
  const perRow = Math.ceil(Math.sqrt((copies * height) / width));
  const trees = Array.from({ length: copies }, (_, copy) => copy);
  const fields = new Map<string, Fields>();
  return {
    graph: {
      nodes: trees.flatMap((copy) =>
        nodesOf(copy, (copy % perRow) * width, Math.floor(copy / perRow) * height, fields),
      ),
      edges: trees.flatMap((copy) => edgesOf(copy)),
    },
    fields,
  };
}
