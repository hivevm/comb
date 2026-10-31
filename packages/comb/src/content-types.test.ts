// The type of node content as a host application imports it from `comb` (ADR-0013): the kinds of
// element and the roles of a text it admits are exactly those the engine generates, so that a
// `switch` on `element.kind` without a `default` covers them. The type check decides it: each
// table below holds one entry per kind or role, and lacks one for a kind the union gains and holds
// one for a kind it loses, which the type check refuses either way. Of the six kinds of ADR-0013,
// `text`, `action`, `badge`, `progress`, and `metric` are built so far; each further kind joins the table
// with the ticket that builds it.
// Verifies: ADR-0013
import { describe, expect, test } from "bun:test";
import type { ContentClick, ContentElement, NodeContent, NodeData, TextRole } from ".";

type Kind = ContentElement["kind"];

/** The element of kind `K`, with the fields of its kind. */
type Of<K extends Kind> = Extract<ContentElement, { kind: K }>;

/** The direction of a metric's trend. */
type TrendDirection = Of<"metric">["trend"]["direction"];

/** What a host application reads of an element, by kind. */
const READ: { [K in Kind]: (element: Of<K>) => string } = {
  text: (element) => `${element.role}: ${element.text} (${element.weight ?? 1})`,
  action: (element) => `${element.id}: ${element.text} (${element.weight ?? 1})`,
  badge: (element) => `#${element.color.toString(16)}: ${element.text} (${element.weight ?? 1})`,
  progress: (element) =>
    `${element.segments.map((s) => `${s.fraction} #${s.color.toString(16)}`).join(", ")} (${element.weight ?? 1})`,
  metric: ({ caption, value, trend, weight }) =>
    `${caption} ${value} ${ARROWS[trend.direction]} ${trend.text} #${trend.color.toString(16)} (${weight ?? 1})`,
};

/** The arrow of each direction of a trend, once each. */
const ARROWS: { [D in TrendDirection]: string } = { up: "▲", down: "▼", flat: "▶" };

/** Whether `A` and `B` are the same type. */
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** A click names the kinds of element content admits, no more and no fewer. */
const CLICKED: Same<ContentClick["kind"], Kind> = true;

/** Every role of a text, once each. */
const ROLES: { [R in TextRole]: R } = { title: "title", body: "body", caption: "caption" };

describe("the type of node content", () => {
  test("it admits exactly the kinds of element the engine draws, text, action, badge, progress, and metric for now", () => {
    expect(Object.keys(READ)).toEqual(["text", "action", "badge", "progress", "metric"]);
    expect(Object.keys(ROLES)).toEqual(["title", "body", "caption"]);
    expect(Object.keys(ARROWS)).toEqual(["up", "down", "flat"]);
    const content: NodeContent = [
      [{ kind: "text", role: "title", text: "A" }],
      [{ kind: "action", text: "Details", id: "details", weight: 2 }],
      [{ kind: "badge", text: "Done", color: 0x22c55e }],
      [
        {
          kind: "progress",
          segments: [
            { fraction: 0.3, color: 0x22c55e },
            { fraction: 0.2, color: 0x9ca3af },
          ],
        },
      ],
      [
        {
          kind: "metric",
          caption: "Revenue",
          value: "42",
          trend: { text: "+3%", direction: "up", color: 0x22c55e },
        },
      ],
    ];
    const node: NodeData = { id: "a", x: 0, y: 0, width: 220, content };
    const read = (element: ContentElement) => {
      switch (element.kind) {
        case "text":
          return READ.text(element);
        case "action":
          return READ.action(element);
        case "badge":
          return READ.badge(element);
        case "progress":
          return READ.progress(element);
        case "metric":
          return READ.metric(element);
      }
    };
    expect(node.content.flat().map(read)).toEqual([
      "title: A (1)",
      "details: Details (2)",
      "#22c55e: Done (1)",
      "0.3 #22c55e, 0.2 #9ca3af (1)",
      "Revenue 42 ▲ +3% #22c55e (1)",
    ]);
    // @ts-expect-error A kind the engine does not draw is no element.
    const icon: ContentElement = { kind: "icon", role: "title", text: "B" };
    // @ts-expect-error A progress bar is divided into segments.
    const unsegmented: ContentElement = { kind: "progress" };
    // @ts-expect-error A segment is a fraction and a colour.
    const uncoloured: ContentElement = { kind: "progress", segments: [{ fraction: 0.5 }] };
    // @ts-expect-error A badge is drawn on a colour.
    const colourless: ContentElement = { kind: "badge", text: "B" };
    // @ts-expect-error A role of no font is no role.
    const headline: ContentElement = { kind: "text", role: "headline", text: "C" };
    // @ts-expect-error An action names what a click on it means.
    const unnamed: ContentElement = { kind: "action", text: "D" };
    expect([icon, unsegmented, uncoloured, colourless, headline, unnamed]).toHaveLength(6);
    expect(CLICKED).toBe(true);
  });
});

describe("the type of a metric", () => {
  test("a metric shows a trend of a direction up, down, or flat", () => {
    const sideways: ContentElement = {
      kind: "metric",
      caption: "E",
      value: "1",
      // @ts-expect-error A trend's direction is up, down, or flat.
      trend: { text: "+1", direction: "sideways", color: 0 },
    };
    // @ts-expect-error A metric shows its trend.
    const trendless: ContentElement = { kind: "metric", caption: "F", value: "2" };
    expect([sideways, trendless]).toHaveLength(2);
  });
});
