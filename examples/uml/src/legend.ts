// The legend of the kinds of relationship in the sidebar (G-12, G-11): one entry per kind, a
// short line drawn as the kind is beside its name and its label, or the labels the diagram shown
// gives its edges of that kind.
import { KINDS, RELATIONSHIPS, type RelationshipKind } from "./relationships";

const SVG = "http://www.w3.org/2000/svg";

/** A short line drawn as `kind` is, for the legend: its colour, its dash pattern, and its
 *  arrowhead, each set as an attribute, so that the policy of Q-6 lets it through. */
function swatchOf(kind: RelationshipKind): SVGSVGElement {
  const { color, dash, arrow } = RELATIONSHIPS[kind];
  const hex = `#${color.toString(16).padStart(6, "0")}`;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 48 12");
  svg.setAttribute("width", "48");
  svg.setAttribute("height", "12");
  const line = document.createElementNS(SVG, "line");
  const attributes: Record<string, string> = {
    x1: "1",
    y1: "6",
    x2: arrow === "end" ? "40" : "47",
    y2: "6",
    stroke: hex,
    "stroke-width": "2",
  };
  for (const [name, value] of Object.entries(attributes)) line.setAttribute(name, value);
  if (dash) line.setAttribute("stroke-dasharray", dash.join(" "));
  svg.append(line);
  if (arrow === "end") {
    const head = document.createElementNS(SVG, "polygon");
    head.setAttribute("points", "38,1 47,6 38,11");
    head.setAttribute("fill", hex);
    svg.append(head);
  }
  return svg;
}

/** Fills the legend afresh with one entry per kind: its swatch, its name, and the labels
 *  `labels` gives it, or else its own label where it has one. */
export function fillLegend(
  list: HTMLElement,
  labels: Partial<Record<RelationshipKind, readonly string[]>> = {},
): void {
  list.replaceChildren(
    ...KINDS.map((kind) => {
      const { name, label } = RELATIONSHIPS[kind];
      const named = labels[kind] ?? (label ? [label] : []);
      const item = document.createElement("li");
      item.dataset.kind = kind;
      const text = document.createElement("span");
      text.textContent = [name, named.join(" or ")].filter(Boolean).join(" ");
      item.append(swatchOf(kind), text);
      return item;
    }),
  );
}
