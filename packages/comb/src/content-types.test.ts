// The type of node content as a host application imports it from `comb` (ADR-0013): the kinds of
// element and the roles of a text it admits are exactly those the engine generates, so that a
// `switch` on `element.kind` without a `default` covers them. The type check decides it: each
// table below holds one entry per kind or role, and lacks one for a kind the union gains and holds
// one for a kind it loses, which the type check refuses either way. Of the six kinds of ADR-0013,
// only `text` is built so far; each further kind joins the table with the ticket that builds it.
// Verifies: ADR-0013
import { describe, expect, test } from "bun:test";
import type { ContentElement, NodeContent, NodeData, TextRole } from ".";

type Kind = ContentElement["kind"];

/** The element of kind `K`, with the fields of its kind. */
type Of<K extends Kind> = Extract<ContentElement, { kind: K }>;

/** What a host application reads of an element, by kind. */
const READ: { [K in Kind]: (element: Of<K>) => string } = {
  text: (element) => `${element.role}: ${element.text} (${element.weight ?? 1})`,
};

/** Every role of a text, once each. */
const ROLES: { [R in TextRole]: R } = { title: "title", body: "body", caption: "caption" };

describe("the type of node content", () => {
  test("it admits exactly the kinds of element the engine draws, text alone for now", () => {
    expect(Object.keys(READ)).toEqual(["text"]);
    expect(Object.keys(ROLES)).toEqual(["title", "body", "caption"]);
    const content: NodeContent = [[{ kind: "text", role: "title", text: "A" }]];
    const node: NodeData = { id: "a", x: 0, y: 0, width: 220, content };
    const element = node.content[0]![0]!;
    expect(READ[element.kind](element)).toBe("title: A (1)");
    // @ts-expect-error A kind the engine does not draw is no element.
    const badge: ContentElement = { kind: "badge", role: "title", text: "B" };
    // @ts-expect-error A role of no font is no role.
    const headline: ContentElement = { kind: "text", role: "headline", text: "C" };
    expect([badge, headline]).toHaveLength(2);
  });
});
