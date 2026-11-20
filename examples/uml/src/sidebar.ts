// The sidebar's forms (G-12, G-20, G-5): the selected classifier's name, stereotype, attributes,
// and operations, one member per line; the selected state's name, entry, do, and exit behaviours,
// internal transitions, and deferred triggers; a submachine state's name and state machine; a
// comment's lines; or the name alone of a package, a state list, a point, a signal, the state
// machine, an action, an object node, a pin, a parameter, a connector, or the activity; an
// expansion region's mode; a use case's name and extension points; a pin's name, or a value pin's
// value, and whether it streams; the names of a conditional node's clauses, or the frame's name
// and the names of its partitions, nested ones among them, one per line, since Comb selects no
// region on its own (ARCH-regions-are-container-slots); the selected relationship's
// kind and label, or its kind alone among those the rules allow between its ends, the selected
// dependency's «import» or «use», the selected transition's trigger, guard, and effect, the
// selected flow's guard and weight, or the selected association's multiplicities. A pseudostate,
// a control node, an anchor, and an exception handler have nothing to edit. Which form a node or an
// edge shows, and what its heading calls it, the descriptor of the diagram shown says. Each edit
// shows on the canvas at once. An edit Comb refuses leaves its text in the field, which is marked
// invalid and says why under it, and the node or the edge keeps what Comb kept; the next edit of
// the form Comb takes clears every mark of the form. Where the rules refuse a connection or a
// drop, the sidebar says why.
import { EngineLostError, GraphDataError, type RegionData, type Selection } from "comb";
import type { Diagram, Refusal } from "./diagram";
import { element } from "./element";
import {
  KINDS,
  labelIn,
  labelOf,
  multiplicitiesIn,
  RELATIONSHIPS,
  type Multiplicities,
  type RelationshipKind,
} from "./relationships";
import type {
  ActivityNode,
  Classifier,
  EdgeForm,
  Flow,
  NodeForm,
  State,
  Transition,
  UseCaseNode,
} from "./shared";

/** A field of the sidebar's forms whose edit Comb may refuse. */
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** A state, an activity node, or a node of the use case diagram, which the node form edits by the
 *  same parts. */
type PartedNode = State | ActivityNode | UseCaseNode;

/** `limit` as the sidebar writes a number, with a comma between thousands. */
const count = (limit: number) => limit.toLocaleString("en");

/** Why Comb refused an edit, in the user's words, from what its error tells. */
function reasonOf({ error }: Refusal): string {
  const kept = "the diagram keeps what it had.";
  if (error instanceof GraphDataError) {
    const { problem } = error;
    switch (problem.kind) {
      case "contentTextTooLong":
      case "labelTextTooLong":
        return `Not taken: a text holds at most ${count(problem.limit)} characters; ${kept}`;
      case "contentBudgetExceeded":
        return `Not taken: the diagram's texts would hold more than ${count(problem.limit)} characters together; ${kept}`;
      default:
        return `Not taken: Comb refused it (${problem.kind}); ${kept}`;
    }
  }
  if (error instanceof EngineLostError) return "Not taken: Comb lost its engine; reload the page.";
  return `Not taken: ${error instanceof Error ? error.message : String(error)}; ${kept}`;
}

/** The names of `regions`, one per line, depth first, a region within a region indented by two
 *  spaces more than the one it lies in. */
const regionLines = (regions: readonly RegionData[], depth = 0): string[] =>
  regions.flatMap((region) => [
    "  ".repeat(depth) + (region.name ?? ""),
    ...regionLines(region.regions ?? [], depth + 1),
  ]);

/** The lines of a textarea, each trimmed, the empty ones left out. */
const linesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** The parts of a state or an activity node the node form edits beside its name, each by the
 *  identifier of its field: a line of text, a list of one item per line, or a checkbox. */
const NODE_PARTS = [
  ["entry", "entry", "text"],
  ["do-activity", "doActivity", "text"],
  ["exit", "exit", "text"],
  ["internal", "internal", "list"],
  ["deferred", "deferred", "list"],
  ["machine", "machine", "text"],
  ["lines", "body", "list"],
  ["mode", "mode", "text"],
  ["points", "points", "list"],
  ["value", "value", "text"],
  ["stream", "stream", "flag"],
] as const;

/** The fields each node form shows, by their identifiers. */
const SHOWN: Record<Exclude<NodeForm, "none">, readonly string[]> = {
  classifier: ["name", "stereotype", "attributes", "operations"],
  name: ["name"],
  "name-and-partitions": ["name", "partitions"],
  behaviours: ["name", "entry", "do-activity", "exit", "internal", "deferred"],
  "name-and-machine": ["name", "machine"],
  lines: ["lines"],
  mode: ["mode"],
  "name-and-points": ["name", "points"],
  "name-and-stream": ["name", "stream"],
  "value-and-stream": ["value", "stream"],
  clauses: ["clauses"],
};

/** The fields of a transition, each by the part of it it edits. */
const TRANSITION_PARTS = ["trigger", "guard", "effect"] as const;

/** The fields of a flow, each by the part of it it edits. */
const FLOW_PARTS = ["guard", "weight"] as const;

/** The ends of an association, each the end of the multiplicity its field edits. */
const ENDS = ["source", "target"] as const;

/** The text `field` holds, trimmed, none where it is empty. */
const textIn = (field: Field) => field.value.trim() || undefined;

/** A part as its field holds it: its text or its lines, none where the field is empty, or `true`
 *  where its checkbox is checked, none where it is not. */
function partOf(field: Field, type: "text" | "list" | "flag") {
  if (type === "flag") return (field as HTMLInputElement).checked || undefined;
  if (type === "text") return textIn(field);
  const lines = linesOf(field.value);
  return lines.length > 0 ? lines : undefined;
}

export class Sidebar {
  private readonly nodeForm = element("node-form");
  private readonly edgeForm = element("edge-form");
  private readonly empty = element("empty");
  private readonly name = element<HTMLInputElement>("name");
  private readonly stereotype = element<HTMLInputElement>("stereotype");
  private readonly attributes = element<HTMLTextAreaElement>("attributes");
  private readonly operations = element<HTMLTextAreaElement>("operations");
  private readonly kind = element<HTMLSelectElement>("kind");
  private readonly label = element<HTMLInputElement>("label");
  private readonly dependency = element<HTMLSelectElement>("dependency");
  private readonly clauses = element<HTMLTextAreaElement>("clauses");
  private readonly partitions = element<HTMLTextAreaElement>("partitions");
  /** The fields that name the regions of the selected node, one name per line, each with what it
   *  calls them. */
  private readonly regionNames = [
    [this.clauses, "clauses"],
    [this.partitions, "partitions"],
  ] as const;
  /** The field of each part of a state or an activity node, with the part it edits and how. */
  private readonly nodeParts = NODE_PARTS.map(([id, key, type]) => ({
    field: element<Field>(id),
    key,
    type,
  }));
  private readonly transitionInputs = TRANSITION_PARTS.map((key) => ({
    field: element<HTMLInputElement>(key),
    key,
  }));
  private readonly weight = element<HTMLInputElement>("weight");
  private readonly weightField = element("weight-field");
  /** The field of the multiplicity at each end of an association, by its end. */
  private readonly multiplicities = ENDS.map((end) => ({
    field: element<HTMLInputElement>(`${end}-multiplicity`),
    end,
  }));
  private readonly multiplicityFields = ENDS.map((end) => element(`${end}-multiplicity-field`));
  private readonly connection = element("connection-refusal");
  private readonly nodeHeading = element("node-heading");
  private readonly edgeHeading = element("edge-heading");
  /** The wrapper of each field of the node form, by the field's identifier. */
  private readonly nodeWrappers = [
    ...["name", "stereotype", "attributes", "operations", "clauses", "partitions"],
    ...NODE_PARTS.map(([id]) => id),
  ].map((id) => [id, element(`${id}-field`)] as const);
  private readonly kindField = element("kind-field");
  private readonly labelField = element("label-field");
  private readonly dependencyField = element("dependency-field");
  private readonly transitionFields = TRANSITION_PARTS.map((key) => element(`${key}-field`));
  /** The fields of each form, whose marks a refill or an edit Comb took clears; of the node form,
   *  those an edit of the node sends, and the names of its regions, which an edit of their own
   *  sends, but whose taken edit clears the marks of every field of the form, as any other does. */
  private readonly partFields: readonly Field[] = [
    this.name,
    this.stereotype,
    this.attributes,
    this.operations,
    ...this.nodeParts.map(({ field }) => field),
  ];
  private readonly nodeFields: readonly Field[] = [
    ...this.partFields,
    ...this.regionNames.map(([field]) => field),
  ];
  private readonly edgeFields: readonly Field[] = [
    this.label,
    this.dependency,
    ...this.transitionInputs.map(({ field }) => field),
    this.weight,
    ...this.multiplicities.map(({ field }) => field),
  ];
  private node: string | null = null;
  private edge: string | null = null;

  constructor(private readonly diagram: Diagram) {
    this.kind.append(...KINDS.map((kind) => new Option(RELATIONSHIPS[kind].name, kind)));
    for (const field of this.partFields)
      field.addEventListener("input", () => this.answer(field, this.nodeFields, this.editNode()));
    for (const [field, noun] of this.regionNames)
      field.addEventListener("input", () =>
        this.answer(field, this.nodeFields, this.nameRegions(field, noun)),
      );
    this.kind.addEventListener("change", () => this.changeKind());
    for (const [field, event] of [
      [this.label, "input"],
      [this.dependency, "change"],
    ] as const)
      field.addEventListener(event, () =>
        this.answer(field, this.edgeFields, this.relabel(field.value)),
      );
    for (const field of [...this.transitionInputs.map((each) => each.field), this.weight])
      field.addEventListener("input", () => this.answer(field, this.edgeFields, this.editParts()));
    for (const { field } of this.multiplicities)
      field.addEventListener("input", () =>
        this.answer(field, this.edgeFields, this.editMultiplicities()),
      );
  }

  /** Shows the form of what `selection` names, or the hint where it names nothing to edit. */
  show(selection: Selection): void {
    this.node = selection?.kind === "node" ? selection.id : null;
    this.edge = selection?.kind === "edge" ? selection.id : null;
    const [form, kind] = [this.formOfNode(), this.kindOf()];
    const edgeForm = this.formOfEdge(kind);
    this.nodeForm.hidden = form === "none";
    this.edgeForm.hidden = edgeForm === "none";
    this.empty.hidden = !this.nodeForm.hidden || !this.edgeForm.hidden;
    if (form !== "none") this.fillNode(form);
    if (edgeForm !== "none") this.fillEdge(kind!, edgeForm);
  }

  /** Fills the names of the regions of node `id` anew where it is the selected node and its
   *  regions no longer have the names the fields hold, as after a partition dropped onto the
   *  frame; an edit of the names, which Comb took as the fields hold them, refills nothing, so
   *  that the user's typing stands. */
  regionsChanged(id: string): void {
    if (id !== this.node) return;
    const names = (text: string) =>
      text
        .split("\n")
        .map((line) => line.trim())
        .join("\n");
    const now = names(regionLines(this.diagram.node(id)?.regions ?? []).join("\n"));
    if (this.regionNames.some(([field]) => names(field.value) === now)) return;
    this.fillRegionNames();
    for (const [field] of this.regionNames) this.clear([field]);
  }

  /** Says why the example refused the user's last connection or drop, or clears what it said for
   *  `null`. */
  refused(reason: string | null): void {
    this.connection.textContent = reason ?? "";
    this.connection.hidden = reason === null;
  }

  /** The selected edge's kind, none where no edge is selected. */
  private kindOf(): RelationshipKind | undefined {
    return this.edge === null ? undefined : this.diagram.kinds.get(this.edge);
  }

  /** The form an edge of `kind` is edited in, in the diagram shown; "none" where no edge of a kind
   *  is selected. */
  private formOfEdge(kind: RelationshipKind | undefined): EdgeForm {
    if (kind === undefined) return "none";
    const { edgeForm, edgeForms } = this.diagram.descriptor;
    return edgeForms?.[kind] ?? edgeForm;
  }

  /** The form the selected node is edited in, by its kind in the diagram shown; "none" where no
   *  node is selected, or its kind has nothing to edit. */
  private formOfNode(): NodeForm {
    const kind = this.node === null ? undefined : this.diagram.kindOf(this.node);
    const entry = this.diagram.descriptor.nodes.find((each) => each.kind === kind);
    return entry && "form" in entry ? entry.form : "none";
  }

  /** Fills the node form of `form` from the selected node's classifier, or from its state or its
   *  activity node, which have no stereotype or members, showing the fields `form` shows. */
  private fillNode(form: Exclude<NodeForm, "none">): void {
    const classifier = this.diagram.classifiers.get(this.node!);
    const parted: PartedNode | undefined =
      this.diagram.states.get(this.node!) ??
      this.diagram.activities.get(this.node!) ??
      this.diagram.useCases.get(this.node!);
    for (const [id, wrapper] of this.nodeWrappers) wrapper.hidden = !SHOWN[form].includes(id);
    this.nodeHeading.textContent = `Selected ${this.diagram.descriptor.selected.node}`;
    this.name.value = classifier?.name ?? parted?.name ?? "";
    this.fillMembers(classifier);
    this.fillParts(parted);
    this.fillRegionNames();
    this.clear(this.nodeFields);
  }

  /** Fills the fields of the names of the selected node's regions, one per line, depth first. */
  private fillRegionNames(): void {
    const regions = regionLines(this.diagram.node(this.node!)?.regions ?? []).join("\n");
    for (const [field] of this.regionNames) field.value = regions;
  }

  /** Fills the field of each part of `node`, a state or an activity node, empty or unchecked for
   *  a part it has not, or for none. */
  private fillParts(node: PartedNode | undefined): void {
    const parts = (node ?? {}) as Partial<Record<string, string | string[] | true>>;
    for (const { field, key, type } of this.nodeParts) {
      const value = parts[key] ?? "";
      if (type === "flag") (field as HTMLInputElement).checked = value === true;
      else field.value = Array.isArray(value) ? value.join("\n") : String(value);
    }
  }

  /** Fills the stereotype and the members of `classifier`, empty for none. */
  private fillMembers(classifier: Classifier | undefined): void {
    const { stereotype = "", attributes = [], operations = [] } = classifier ?? {};
    this.stereotype.value = stereotype;
    this.attributes.value = attributes.join("\n");
    this.operations.value = operations.join("\n");
  }

  private fillEdge(kind: RelationshipKind, form: Exclude<EdgeForm, "none">): void {
    this.kindField.hidden = !["relationship", "kind", "guard-and-weight"].includes(form);
    this.labelField.hidden = form !== "relationship";
    for (const field of this.multiplicityFields) field.hidden = form !== "multiplicities";
    this.dependencyField.hidden = form !== "import-or-use";
    for (const field of this.transitionFields) field.hidden = form !== "trigger-guard-effect";
    this.weightField.hidden = form !== "guard-and-weight";
    this.edgeHeading.textContent = `Selected ${this.diagram.descriptor.selected.edge}`;
    const text = labelIn(this.diagram.edge(this.edge!))?.text;
    // The kind select offers the kinds a relationship's form changes between, and is filled and
    // set only where that form shows.
    if (!this.kindField.hidden) this.fillKinds(kind);
    this.label.value = text ?? "";
    this.dependency.value = text ?? "«use»";
    if (form === "guard-and-weight") this.fillFlow();
    else this.fillTransition();
    this.fillMultiplicities();
    this.clear(this.edgeFields);
  }

  /** Offers the kinds the selected edge may change between, by the rules between its ends, and
   *  sets the select on its kind, `kind`. */
  private fillKinds(kind: RelationshipKind): void {
    const offered = this.diagram.offeredKinds(this.edge!);
    this.kind.replaceChildren(...offered.map((each) => new Option(RELATIONSHIPS[each].name, each)));
    this.kind.value = kind;
  }

  /** Fills the multiplicity at each end of the selected edge, empty where it has none. */
  private fillMultiplicities(): void {
    const multiplicities = multiplicitiesIn(this.diagram.edge(this.edge!) ?? {});
    for (const { field, end } of this.multiplicities) field.value = multiplicities[end] ?? "";
  }

  /** Fills the selected transition's trigger, guard, and effect, hiding a part UML 2.5.1 does not
   *  let it have (`transitionParts`). */
  private fillTransition(): void {
    const transition = this.diagram.transitions.get(this.edge!) ?? {};
    const parts = this.diagram.partsOf(this.edge!);
    for (const { field, key } of this.transitionInputs) field.value = transition[key] ?? "";
    TRANSITION_PARTS.forEach((key, i) => {
      if (!parts.includes(key)) this.transitionFields[i]!.hidden = true;
    });
  }

  /** Fills the selected flow's guard and weight, the guard in the transition's field of it. */
  private fillFlow(): void {
    const { guard = "", weight = "" } = this.diagram.flows.get(this.edge!) ?? {};
    this.transitionFields[TRANSITION_PARTS.indexOf("guard")]!.hidden = false;
    this.fieldOf("guard").value = guard;
    this.weight.value = weight;
  }

  /** The field of the transition's part `key`. */
  private fieldOf(key: (typeof TRANSITION_PARTS)[number]): HTMLInputElement {
    return this.transitionInputs.find((each) => each.key === key)!.field;
  }

  /** Marks `field` invalid where Comb refused its edit, with why under it; else clears the marks
   *  of `fields`, its form's, since the edit took what each of them holds. */
  private answer(field: Field, fields: readonly Field[], refusal: Refusal | undefined): void {
    if (!refusal) {
      this.clear(fields);
      return;
    }
    field.setAttribute("aria-invalid", "true");
    this.say(field, reasonOf(refusal));
  }

  /** Clears the marks of `fields` and their messages. */
  private clear(fields: readonly Field[]): void {
    for (const field of fields) {
      field.removeAttribute("aria-invalid");
      this.say(field, "");
    }
  }

  /** Puts `text` under `field`, only where it differs from what stands there: a message is an
   *  alert, which a screen reader announces anew whenever its text is written. */
  private say(field: Field, text: string): void {
    const message = this.messageOf(field);
    if (message.textContent !== text) message.textContent = text;
  }

  /** The message under `field`, the element that describes it. */
  private messageOf(field: Field): HTMLElement {
    return element(field.getAttribute("aria-describedby")!);
  }

  /** The selected state or activity node, `node`, as the form of `form` holds it: its name, and a
   *  state's behaviours, internal transitions, and deferred triggers, its state machine, its lines,
   *  an expansion region's mode, or a value pin's value and whether a pin streams, where the form
   *  shows them; a field left empty or unchecked leaves its part out. */
  private editedOf<T extends PartedNode>(node: T, form: Exclude<NodeForm, "none">): T {
    const shown = SHOWN[form];
    const parts = this.nodeParts
      .filter(({ field }) => shown.includes(field.id))
      .map(({ field, key, type }) => [key, partOf(field, type)] as const);
    const name = shown.includes("name") ? { name: this.name.value } : {};
    // A part the form leaves empty is left out of the node, not kept as undefined.
    return Object.fromEntries(
      Object.entries({ ...node, ...name, ...Object.fromEntries(parts) }).filter(
        ([, value]) => value !== undefined,
      ),
    ) as unknown as T;
  }

  /** Replaces the selected classifier, state, activity node, or use case diagram's node with
   *  what the form holds; the classifier keeps its kind whatever its stereotype reads; Comb's
   *  refusal where it refused the content. */
  private editNode(): Refusal | undefined {
    const form = this.formOfNode();
    if (form === "none") return undefined;
    const state = this.diagram.states.get(this.node!);
    if (state) return this.diagram.editState(state.id, this.editedOf(state, form));
    const activity = this.diagram.activities.get(this.node!);
    if (activity) return this.diagram.editActivity(activity.id, this.editedOf(activity, form));
    const useCase = this.diagram.useCases.get(this.node!);
    if (useCase) return this.diagram.editUseCase(useCase.id, this.editedOf(useCase, form));
    const current = this.node === null ? undefined : this.diagram.classifiers.get(this.node);
    if (!current) return undefined;
    const stereotype = this.stereotype.value.trim();
    return this.diagram.edit(current.id, {
      id: current.id,
      kind: current.kind,
      ...(stereotype ? { stereotype } : {}),
      name: this.name.value,
      attributes: linesOf(this.attributes.value),
      operations: linesOf(this.operations.value),
    });
  }

  /** Names the regions of the selected node, `noun`, as `field` holds them, one per line, depth
   *  first: a region's name is no part of the node; Comb's refusal, or the diagram's, where the
   *  names were not taken. */
  private nameRegions(field: Field, noun: "clauses" | "partitions"): Refusal | undefined {
    if (this.node === null) return undefined;
    const names = field.value.split("\n").map((line) => line.trim());
    return this.diagram.nameRegions(this.node, names, noun);
  }

  /** Changes the selected edge to the chosen kind; a label the user typed survives, one that
   *  reads the old kind's own label, or none, becomes the new kind's, or none. */
  private changeKind(): void {
    if (this.edge === null) return;
    this.diagram.rekind(this.edge, this.kind.value as RelationshipKind);
    this.label.value = labelIn(this.diagram.edge(this.edge))?.text ?? "";
    this.clear([this.label]);
  }

  /** Gives the selected flow, or the selected transition, the parts the form holds; Comb's refusal
   *  where it refused the label that shows them. */
  private editParts(): Refusal | undefined {
    if (this.edge === null) return undefined;
    if (this.formOfEdge(this.kindOf()) !== "guard-and-weight") return this.editTransition();
    const next: Flow = {};
    for (const key of FLOW_PARTS) {
      const value = textIn(key === "guard" ? this.fieldOf(key) : this.weight);
      if (value !== undefined) next[key] = value;
    }
    return this.diagram.editFlow(this.edge, next);
  }

  /** Gives the selected transition the trigger, guard, and effect the form holds, each left out
   *  where its field is empty; Comb's refusal where it refused the label that shows them. */
  private editTransition(): Refusal | undefined {
    if (this.edge === null) return undefined;
    const next: Transition = {};
    const parts = this.diagram.partsOf(this.edge);
    for (const { field, key } of this.transitionInputs.filter((each) => parts.includes(each.key))) {
      const value = textIn(field);
      if (value !== undefined) next[key] = value;
    }
    return this.diagram.editTransition(this.edge, next);
  }

  /** Gives the selected association the multiplicities its fields hold, each left out where its
   *  field is empty; Comb's refusal where it refused the labels that show them. */
  private editMultiplicities(): Refusal | undefined {
    if (this.edge === null) return undefined;
    const next: Multiplicities = {};
    for (const { field, end } of this.multiplicities) {
      const value = textIn(field);
      if (value !== undefined) next[end] = value;
    }
    return this.diagram.editMultiplicities(this.edge, next);
  }

  /** Gives the selected edge a label of its kind that reads `text`, where its label stands, or none
   *  for no text: a relationship's label, or a dependency's «import» or «use»; Comb's refusal
   *  where it refused the label. */
  private relabel(text: string): Refusal | undefined {
    if (this.edge === null) return undefined;
    const kind = this.diagram.kinds.get(this.edge)!;
    const current = labelIn(this.diagram.edge(this.edge));
    return this.diagram.updateLabel(this.edge, text === "" ? null : labelOf(kind, text, current));
  }
}
