// The sidebar's forms (G-12, G-20, G-5): the selected classifier's name, stereotype, attributes,
// and operations, one member per line; the selected state's name, entry, do, and exit behaviours,
// internal transitions, and deferred triggers; a submachine state's name and state machine; a
// comment's lines; or the name alone of a package, a state list, a point, a signal, or the state
// machine; the selected relationship's kind and label, the selected dependency's «import» or
// «use», or the selected transition's trigger, guard, and effect. A pseudostate and an anchor have
// nothing to edit. Which form a node or an edge shows, and what its heading calls it, the
// descriptor of the diagram shown says. Each edit shows on the canvas at once. An edit Comb
// refuses leaves its text in the field, which is marked invalid and says why under it, and the
// node or the edge keeps what Comb kept; the next edit of the form Comb takes clears every mark of
// the form, since an edit sends every field of it. Where the rules refuse a connection, the
// sidebar says why.
import { EngineLostError, GraphDataError, type Selection } from "comb";
import type { Diagram, Refusal } from "./diagram";
import { element } from "./element";
import { KINDS, labelIn, labelOf, RELATIONSHIPS, type RelationshipKind } from "./relationships";
import type { Classifier, EdgeForm, NodeForm, State, Transition } from "./shared";

/** A field of the sidebar's forms whose edit Comb may refuse. */
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

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

/** The lines of a textarea, each trimmed, the empty ones left out. */
const linesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** The parts of a state the node form edits beside its name, each by the identifier of its field:
 *  a line of text, or a list of one item per line. */
const STATE_PARTS = [
  ["entry", "entry", "text"],
  ["do-activity", "doActivity", "text"],
  ["exit", "exit", "text"],
  ["internal", "internal", "list"],
  ["deferred", "deferred", "list"],
  ["machine", "machine", "text"],
  ["lines", "body", "list"],
] as const;

/** The fields each node form shows, by their identifiers. */
const SHOWN: Record<Exclude<NodeForm, "none">, readonly string[]> = {
  classifier: ["name", "stereotype", "attributes", "operations"],
  name: ["name"],
  behaviours: ["name", "entry", "do-activity", "exit", "internal", "deferred"],
  "name-and-machine": ["name", "machine"],
  lines: ["lines"],
};

/** The fields of a transition, each by the part of it it edits. */
const TRANSITION_PARTS = ["trigger", "guard", "effect"] as const;

/** The text `field` holds, trimmed, none where it is empty. */
const textIn = (field: HTMLInputElement | HTMLTextAreaElement) => field.value.trim() || undefined;

/** A part as its field holds it: its text or its lines, none where the field is empty. */
function partOf(field: HTMLInputElement | HTMLTextAreaElement, type: "text" | "list") {
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
  /** The field of each part of a state, with the part it edits and how. */
  private readonly stateParts = STATE_PARTS.map(([id, key, type]) => ({
    field: element<HTMLInputElement | HTMLTextAreaElement>(id),
    key,
    type,
  }));
  private readonly transitionInputs = TRANSITION_PARTS.map((key) => ({
    field: element<HTMLInputElement>(key),
    key,
  }));
  private readonly connection = element("connection-refusal");
  private readonly nodeHeading = element("node-heading");
  private readonly edgeHeading = element("edge-heading");
  /** The wrapper of each field of the node form, by the field's identifier. */
  private readonly nodeWrappers = [
    ...["name", "stereotype", "attributes", "operations"],
    ...STATE_PARTS.map(([id]) => id),
  ].map((id) => [id, element(`${id}-field`)] as const);
  private readonly relationshipFields = ["kind-field", "label-field"].map((id) => element(id));
  private readonly dependencyField = element("dependency-field");
  private readonly transitionFields = TRANSITION_PARTS.map((key) => element(`${key}-field`));
  /** The fields of each form, whose marks a refill or an edit Comb took clears. */
  private readonly nodeFields: readonly Field[] = [
    this.name,
    this.stereotype,
    this.attributes,
    this.operations,
    ...this.stateParts.map(({ field }) => field),
  ];
  private readonly edgeFields: readonly Field[] = [
    this.label,
    this.dependency,
    ...this.transitionInputs.map(({ field }) => field),
  ];
  private node: string | null = null;
  private edge: string | null = null;

  constructor(private readonly diagram: Diagram) {
    this.kind.append(...KINDS.map((kind) => new Option(RELATIONSHIPS[kind].name, kind)));
    for (const field of this.nodeFields)
      field.addEventListener("input", () => this.answer(field, this.nodeFields, this.editNode()));
    this.kind.addEventListener("change", () => this.changeKind());
    for (const [field, event] of [
      [this.label, "input"],
      [this.dependency, "change"],
    ] as const)
      field.addEventListener(event, () =>
        this.answer(field, this.edgeFields, this.relabel(field.value)),
      );
    for (const { field } of this.transitionInputs)
      field.addEventListener("input", () =>
        this.answer(field, this.edgeFields, this.editTransition()),
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

  /** Says why the rules refused the user's last connection, or clears what it said for `null`. */
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
    return this.diagram.descriptor.nodes.find((each) => each.kind === kind)?.form ?? "none";
  }

  /** Fills the node form of `form` from the selected node's classifier, or from its state, which
   *  has no stereotype or members, showing the fields `form` shows. */
  private fillNode(form: Exclude<NodeForm, "none">): void {
    const classifier = this.diagram.classifiers.get(this.node!);
    const state = this.diagram.states.get(this.node!);
    for (const [id, wrapper] of this.nodeWrappers) wrapper.hidden = !SHOWN[form].includes(id);
    this.nodeHeading.textContent = `Selected ${this.diagram.descriptor.selected.node}`;
    this.name.value = classifier?.name ?? state?.name ?? "";
    this.fillMembers(classifier);
    for (const { field, key } of this.stateParts) {
      const value = state?.[key] ?? "";
      field.value = Array.isArray(value) ? value.join("\n") : value;
    }
    this.clear(this.nodeFields);
  }

  /** Fills the stereotype and the members of `classifier`, empty for none. */
  private fillMembers(classifier: Classifier | undefined): void {
    const { stereotype = "", attributes = [], operations = [] } = classifier ?? {};
    this.stereotype.value = stereotype;
    this.attributes.value = attributes.join("\n");
    this.operations.value = operations.join("\n");
  }

  private fillEdge(kind: RelationshipKind, form: Exclude<EdgeForm, "none">): void {
    for (const field of this.relationshipFields) field.hidden = form !== "relationship";
    this.dependencyField.hidden = form !== "import-or-use";
    for (const field of this.transitionFields) field.hidden = form !== "trigger-guard-effect";
    this.edgeHeading.textContent = `Selected ${this.diagram.descriptor.selected.edge}`;
    const text = labelIn(this.diagram.edge(this.edge!))?.text;
    // The kind select offers the kinds a relationship's form changes between, and is set only
    // where that form shows.
    if (form === "relationship") this.kind.value = kind;
    this.label.value = text ?? "";
    this.dependency.value = text ?? "«use»";
    const transition = this.diagram.transitions.get(this.edge!) ?? {};
    const parts = this.diagram.partsOf(this.edge!);
    for (const { field, key } of this.transitionInputs) field.value = transition[key] ?? "";
    // A part UML 2.5.1 does not let the transition have is not offered (`transitionParts`).
    TRANSITION_PARTS.forEach((key, i) => {
      if (!parts.includes(key)) this.transitionFields[i]!.hidden = true;
    });
    this.clear(this.edgeFields);
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

  /** The selected state as the form of `form` holds it: its name, and its behaviours, internal
   *  transitions, and deferred triggers, its state machine, or its lines, where the form shows
   *  them; a field left empty leaves its part out. */
  private stateOf(state: State, form: Exclude<NodeForm, "none">): State {
    const shown = SHOWN[form];
    const parts = this.stateParts
      .filter(({ field }) => shown.includes(field.id))
      .map(({ field, key, type }) => [key, partOf(field, type)] as const);
    const name = shown.includes("name") ? { name: this.name.value } : {};
    // A part the form leaves empty is left out of the state, not kept as undefined.
    return Object.fromEntries(
      Object.entries({ ...state, ...name, ...Object.fromEntries(parts) }).filter(
        ([, value]) => value !== undefined,
      ),
    ) as unknown as State;
  }

  /** Replaces the selected classifier, or the selected state, with what the form holds; the
   *  classifier keeps its kind whatever its stereotype reads; Comb's refusal where it refused the
   *  content. */
  private editNode(): Refusal | undefined {
    const form = this.formOfNode();
    if (form === "none") return undefined;
    const state = this.diagram.states.get(this.node!);
    if (state) return this.diagram.editState(state.id, this.stateOf(state, form));
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

  /** Changes the selected edge to the chosen kind; a label the user typed survives, one that
   *  reads the old kind's own label, or none, becomes the new kind's, or none. */
  private changeKind(): void {
    if (this.edge === null) return;
    this.diagram.rekind(this.edge, this.kind.value as RelationshipKind);
    this.label.value = labelIn(this.diagram.edge(this.edge))?.text ?? "";
    this.clear([this.label]);
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
