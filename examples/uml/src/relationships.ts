// The kinds of relationship of the class diagram and how each is drawn (G-12, G-11). Comb draws an
// edge in one colour, solid or dashed, with an arrowhead at its target or none, and with one label;
// it has no hollow triangle, no diamond, and no arrowhead at the source. So each kind is told by a
// family of colour, its dash pattern, and its arrowhead, and by its label where those cannot tell
// it; docs/CONVENTIONS.md records the mapping, and the sidebar's legend lists it. The state
// diagram's transition is a kind of its own, drawn grey with an arrowhead. The label of an edge of
// any kind is built here, by `labelOf`, and so is the label a change of kind leaves, by `patchOf`.
import type { EdgeData, EdgeLabelData, EdgePatch } from "comb";

/** The colour families, each dark enough that the white text Comb draws on a label in it has a
 *  contrast ratio of at least 4.5: grey for plain links, blue for inheritance, green for a whole
 *  and its parts. */
const GREY = 0x6b7280;
const BLUE = 0x1d4ed8;
const GREEN = 0x15803d;
/** The dash pattern of a dashed relationship, as the metric tree's dashed edges. */
const DASH = [6, 4] as const;

/** How a kind is drawn: its name, its colour, its dash pattern (solid without), its arrowhead,
 *  the text of the label each of its edges starts with (none without), and where its label stands,
 *  at `t` along the edge and `offset` to the left of its direction of travel (in the middle and on
 *  the edge without), and whether the legend lists it and the sidebar offers it. A whole is the
 *  source of an aggregation or a composition, so their label lies near the source, where UML draws
 *  the diamond. */
export interface RelationshipStyle {
  name: string;
  color: number;
  dash?: readonly [number, number];
  arrow: "end" | "none";
  label?: string;
  place?: { t: number; offset: number };
  listed?: false;
}

/** The kinds of relationship, each drawn as its style says, in the order the legend lists them and
 *  the sidebar offers them. */
const STYLES = {
  association: { name: "Association", color: GREY, arrow: "none" },
  "directed-association": { name: "Directed association", color: GREY, arrow: "end" },
  generalization: { name: "Generalization", color: BLUE, arrow: "end" },
  realization: { name: "Realization", color: BLUE, dash: DASH, arrow: "end" },
  dependency: { name: "Dependency", color: GREY, dash: DASH, arrow: "end", label: "«use»" },
  aggregation: {
    name: "Aggregation",
    color: GREEN,
    arrow: "none",
    label: "«aggregation»",
    place: { t: 0.4, offset: 0 },
  },
  composition: {
    name: "Composition",
    color: GREEN,
    arrow: "none",
    label: "«composition»",
    place: { t: 0.4, offset: 0 },
  },
  // The state diagram's one kind, which its sidebar labels by its event, and which neither the
  // legend nor the class and the package diagram's kind select lists. Its label stands 14 to the
  // left of its direction of travel, so that the labels of two transitions that run along one line
  // in opposite directions stand either side of it.
  transition: {
    name: "Transition",
    color: GREY,
    arrow: "end",
    place: { t: 0.5, offset: 14 },
    listed: false,
  },
} satisfies Record<string, RelationshipStyle>;

export type RelationshipKind = keyof typeof STYLES;

export const RELATIONSHIPS: Readonly<Record<RelationshipKind, RelationshipStyle>> = STYLES;

/** The kinds the legend lists and the sidebar's kind select offers, those of the class and the
 *  package diagram, in the table's order. */
export const KINDS = (Object.keys(RELATIONSHIPS) as RelationshipKind[]).filter(
  (kind) => RELATIONSHIPS[kind].listed !== false,
);

/** The label of an edge of `kind` that reads `text`, on a pill of the kind's colour, standing where
 *  `current`, the label the edge has, stands, or else where the kind places it. */
export function labelOf(
  kind: RelationshipKind,
  text: string,
  current?: EdgeLabelData,
): EdgeLabelData {
  const { color, place } = RELATIONSHIPS[kind];
  return { t: 0.5, offset: 0, ...place, ...current, background: color, text };
}

/** The fields of an edge of `kind` that draw it, its label where the kind has one. */
export function styleOf(
  kind: RelationshipKind,
): Pick<EdgeData, "color" | "dash" | "arrow" | "label"> {
  const { color, dash, arrow, label } = RELATIONSHIPS[kind];
  return {
    color,
    arrow,
    ...(dash ? { dash } : {}),
    ...(label ? { label: labelOf(kind, label) } : {}),
  };
}

/** The patch that draws an edge of `kind` as `to`, clearing a dash the kind has none of. Its
 *  label, `current`, survives where the user typed it, drawn in the colour of `to` where it
 *  stands; one that reads the label of `kind` itself, or none, becomes the label of `to`, or none
 *  where `to` has none. */
export function patchOf(
  kind: RelationshipKind,
  to: RelationshipKind,
  current?: EdgeLabelData,
): EdgePatch {
  const { color, arrow, dash = null, label = null } = styleOf(to);
  const typed = current !== undefined && current.text !== RELATIONSHIPS[kind].label;
  return { color, arrow, dash, label: typed ? labelOf(to, current.text, current) : label };
}
