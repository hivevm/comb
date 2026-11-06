// The kinds of relationship of the class diagram and how each is drawn (G-12, G-11). Comb draws an
// edge in one colour, solid or dashed, with an arrowhead at its target or none, and with one label;
// it has no hollow triangle, no diamond, and no arrowhead at the source. So each kind is told by a
// family of colour, its dash pattern, and its arrowhead, and by its label where those cannot tell
// it; docs/CONVENTIONS.md records the mapping, and the sidebar's legend lists it.
import type { EdgeData, EdgePatch } from "comb";

export type RelationshipKind =
  | "association"
  | "directed-association"
  | "generalization"
  | "realization"
  | "dependency"
  | "aggregation"
  | "composition";

/** The colour families, each dark enough that the white text Comb draws on a label in it has a
 *  contrast ratio of at least 4.5: grey for plain links, blue for inheritance, green for a whole
 *  and its parts. */
export const GREY = 0x6b7280;
export const BLUE = 0x1d4ed8;
export const GREEN = 0x15803d;
/** The dash pattern of a dashed relationship, as the metric tree's dashed edges. */
export const DASH = [6, 4] as const;

/** How a kind is drawn: its colour, its dash pattern (solid without), its arrowhead, and its
 *  label's text and place along the edge (none without). A whole is the source of an aggregation
 *  or a composition, so their label lies near the source, where UML draws the diamond. */
export interface RelationshipStyle {
  name: string;
  color: number;
  dash?: readonly [number, number];
  arrow: "end" | "none";
  label?: { text: string; t: number };
}

export const RELATIONSHIPS: Record<RelationshipKind, RelationshipStyle> = {
  association: { name: "Association", color: GREY, arrow: "none" },
  "directed-association": { name: "Directed association", color: GREY, arrow: "end" },
  generalization: { name: "Generalization", color: BLUE, arrow: "end" },
  realization: { name: "Realization", color: BLUE, dash: DASH, arrow: "end" },
  dependency: {
    name: "Dependency",
    color: GREY,
    dash: DASH,
    arrow: "end",
    label: { text: "«use»", t: 0.5 },
  },
  aggregation: {
    name: "Aggregation",
    color: GREEN,
    arrow: "none",
    label: { text: "«aggregation»", t: 0.4 },
  },
  composition: {
    name: "Composition",
    color: GREEN,
    arrow: "none",
    label: { text: "«composition»", t: 0.4 },
  },
};

/** The kinds in the order the legend lists them. */
export const KINDS = Object.keys(RELATIONSHIPS) as RelationshipKind[];

/** The fields of an edge of `kind` that draw it, its label in its kind's colour. */
export function styleOf(
  kind: RelationshipKind,
): Pick<EdgeData, "color" | "dash" | "arrow" | "label"> {
  const { color, dash, arrow, label } = RELATIONSHIPS[kind];
  return {
    color,
    arrow,
    ...(dash ? { dash } : {}),
    ...(label ? { label: { ...label, offset: 0, background: color } } : {}),
  };
}

/** The patch that draws an edge as `kind`, clearing a dash or a label the kind has none of. */
export function patchOf(kind: RelationshipKind): EdgePatch {
  const { color, arrow, dash = null, label = null } = styleOf(kind);
  return { color, arrow, dash, label };
}
