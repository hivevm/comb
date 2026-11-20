// The kinds of relationship of the class diagram and how each is drawn (G-12, G-11). The example
// draws an edge in one colour, solid or dashed, with a filled arrowhead at its target or none, and
// with a list of one label, `kind`; Comb has no diamond and no arrowhead at the source. So each
// kind is told by a family of colour, its dash pattern, and its arrowhead, and by its label where
// those cannot tell it; docs/CONVENTIONS.md records the mapping, and the sidebar's legend lists it.
// The state diagram's transition is a kind of its own, drawn grey with an open arrowhead, as UML
// 2.5.1 draws one, and so is the anchor of a comment, grey, dashed, and without one. The activity
// diagram's control and object flows are drawn as a transition is; its interrupting edge and the
// edge of an exception handler add a lightning bolt, as UML 2.5.1 draws both. The use case
// diagram's include and extend are drawn as a dependency is, with an open arrowhead and their
// keyword, its generalization in a generalization's blue with a hollow triangle, and its
// association as the class diagram's, with a multiplicity at each end. The label of
// an edge of any kind is built here, by `labelOf`, and so is the label a change of kind leaves, by
// `patchOf`.
import type { Arrowhead, EdgeData, EdgeLabelData, EdgePatch } from "comb";

/** The colour families, each dark enough that the white text Comb draws on a label in it has a
 *  contrast ratio of at least 4.5: grey for plain links, blue for inheritance, green for a whole
 *  and its parts. */
const GREY = 0x6b7280;
const BLUE = 0x1d4ed8;
const GREEN = 0x15803d;
/** The dash pattern of a dashed relationship, as the metric tree's dashed edges. */
const DASH = [6, 4] as const;

/** How a kind is drawn: its name, its colour, its dash pattern (solid without), its arrowhead,
 *  whether it is drawn as a lightning bolt, the text of the label each of its edges starts with
 *  (none without), and where its label stands, at `t` along the edge and `offset` to the left of
 *  its direction of travel (in the middle and on the edge without), and whether the legend lists
 *  it and the sidebar offers it. A whole is the source of an aggregation or a composition, so
 *  their label lies near the source, where UML draws the diamond. */
export interface RelationshipStyle {
  name: string;
  color: number;
  dash?: readonly [number, number];
  arrow: Arrowhead;
  lightning?: true;
  /** The kind carries no label: an edge that becomes one drops the label it had. */
  unlabelled?: true;
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
  // The state diagram's kinds, which neither the legend nor the class and the package diagram's
  // kind select lists: a transition, which its sidebar labels by its trigger, guard, and effect,
  // its label 14 to the left of its direction of travel, so that the labels of two transitions
  // that run along one line in opposite directions stand either side of it; and the anchor of a
  // comment, which carries no label.
  transition: {
    name: "Transition",
    color: GREY,
    arrow: "open",
    place: { t: 0.5, offset: 14 },
    listed: false,
  },
  anchor: { name: "Anchor", color: GREY, dash: DASH, arrow: "none", listed: false },
  // The activity diagram's kinds, which neither the legend nor the kind select lists either: a
  // control flow and an object flow, labelled by their guard and weight where a transition is
  // labelled; an interrupting edge, a control flow drawn as a lightning bolt; and the edge of an
  // exception handler, a lightning bolt without a label.
  "control-flow": {
    name: "Control flow",
    color: GREY,
    arrow: "open",
    place: { t: 0.5, offset: 14 },
    listed: false,
  },
  "object-flow": {
    name: "Object flow",
    color: GREY,
    arrow: "open",
    place: { t: 0.5, offset: 14 },
    listed: false,
  },
  "interrupting-edge": {
    name: "Interrupting edge",
    color: GREY,
    arrow: "open",
    lightning: true,
    place: { t: 0.5, offset: 14 },
    listed: false,
  },
  "exception-handler": {
    name: "Exception handler",
    color: GREY,
    arrow: "open",
    lightning: true,
    unlabelled: true,
    listed: false,
  },
  // The use case diagram's kinds, which neither the legend nor the class diagram's kind select
  // lists: an include and an extend, dashed with an open arrowhead and their keyword, and a
  // generalization between two actors or two use cases, ending in a hollow triangle.
  include: {
    name: "Include",
    color: GREY,
    dash: DASH,
    arrow: "open",
    label: "«include»",
    place: { t: 0.5, offset: 14 },
    listed: false,
  },
  extend: {
    name: "Extend",
    color: GREY,
    dash: DASH,
    arrow: "open",
    label: "«extend»",
    place: { t: 0.5, offset: 14 },
    listed: false,
  },
  "use-case-generalization": {
    name: "Generalization",
    color: BLUE,
    arrow: "hollow",
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

/** The identifier of the one label an edge of the example carries
 *  (API-edges-dock-nodes-or-edges). */
export const LABEL = "kind";

/** The label of an edge of `kind` that reads `text`, on a pill of the kind's colour, standing where
 *  `current`, the label the edge has, stands, or else where the kind places it. */
export function labelOf(
  kind: RelationshipKind,
  text: string,
  current?: EdgeLabelData,
): EdgeLabelData {
  const { color, place } = RELATIONSHIPS[kind];
  return { id: LABEL, t: 0.5, offset: 0, ...place, ...current, background: color, text };
}

/** The one label of `edge`, or none. */
export const labelIn = (edge: Pick<EdgeData, "labels"> | undefined): EdgeLabelData | undefined =>
  edge?.labels?.[0];

/** The fields of an edge of `kind` that draw it, its labels a list of one where the kind has a
 *  label. */
export function styleOf(
  kind: RelationshipKind,
): Pick<EdgeData, "color" | "dash" | "arrow" | "lightning" | "labels"> {
  const { color, dash, arrow, lightning, label } = RELATIONSHIPS[kind];
  return {
    color,
    arrow,
    ...(dash ? { dash } : {}),
    ...(lightning ? { lightning } : {}),
    ...(label ? { labels: [labelOf(kind, label)] } : {}),
  };
}

/** The patch that draws an edge of `kind` as `to`, clearing a dash or a lightning bolt the kind
 *  has none of. Its label, `current`, survives where the user typed it, drawn in the colour of
 *  `to` where it stands; one that reads the label of `kind` itself, or none, becomes the label of
 *  `to`, or none where `to` has none; a kind without labels drops it. */
export function patchOf(
  kind: RelationshipKind,
  to: RelationshipKind,
  current?: EdgeLabelData,
): EdgePatch {
  const { color, arrow, dash = null, lightning = false, labels = null } = styleOf(to);
  const typed =
    current !== undefined &&
    current.text !== RELATIONSHIPS[kind].label &&
    !RELATIONSHIPS[to].unlabelled;
  const label = typed ? [labelOf(to, current.text, current)] : labels;
  return { color, arrow, dash, lightning, labels: label };
}

/** The identifiers of the labels of an association's multiplicities, at its source and its target
 *  end. */
const MULTIPLICITY_LABELS = {
  source: "source-multiplicity",
  target: "target-multiplicity",
} as const;

/** The path parameter of the label of a multiplicity at each end of an association. */
const MULTIPLICITY_T = { source: 0.1, target: 0.9 } as const;

/** The multiplicities of an association, at its source and its target end, each where it has
 *  one. */
export type Multiplicities = { source?: string; target?: string };

/** The labels of the multiplicities `multiplicities` of an association, one at each end that has
 *  one, at the path parameters 0.1 and 0.9 on the edge, or where the label of that end among
 *  `current` stands; on a pill of the edge's colour. */
export function multiplicityLabelsOf(
  multiplicities: Multiplicities,
  current: readonly EdgeLabelData[] = [],
): EdgeLabelData[] {
  return (["source", "target"] as const).flatMap((end) => {
    const text = multiplicities[end];
    if (text === undefined) return [];
    const id = MULTIPLICITY_LABELS[end];
    const kept = current.find((label) => label.id === id);
    return [{ id, text, t: kept?.t ?? MULTIPLICITY_T[end], offset: kept?.offset ?? 0 }];
  });
}

/** The multiplicities the labels of `edge` show, each where it has one. */
export function multiplicitiesIn(edge: Pick<EdgeData, "labels">): Multiplicities {
  const textOf = (id: string) => edge.labels?.find((label) => label.id === id)?.text;
  const [source, target] = [textOf(MULTIPLICITY_LABELS.source), textOf(MULTIPLICITY_LABELS.target)];
  return {
    ...(source === undefined ? {} : { source }),
    ...(target === undefined ? {} : { target }),
  };
}
