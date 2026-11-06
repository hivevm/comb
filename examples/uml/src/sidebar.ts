// The sidebar's forms (G-12, G-5): the selected classifier's name, stereotype, attributes, and
// operations, one member per line, or the selected package's or state's name; the selected
// relationship's kind and label, the selected dependency's «import» or «use», or the selected
// transition's event. A pseudostate has nothing to edit. Each edit shows on the canvas at once.
import type { EdgeLabelData, Selection } from "comb";
import { kindOf, type Classifier } from "./class-diagram";
import type { Diagram } from "./diagram";
import { KINDS, RELATIONSHIPS, type RelationshipKind } from "./relationships";
import { eventLabel, type State } from "./state-diagram";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

/** The lines of a textarea, each trimmed, the empty ones left out. */
const linesOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

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
  private readonly event = element<HTMLInputElement>("event");
  private readonly nodeHeading = element("node-heading");
  private readonly edgeHeading = element("edge-heading");
  /** The fields a classifier shows and a package does not. */
  private readonly classifierFields = [
    "stereotype-field",
    "attributes-field",
    "operations-field",
  ].map((id) => element(id));
  private readonly relationshipFields = ["kind-field", "label-field"].map((id) => element(id));
  private readonly dependencyField = element("dependency-field");
  private readonly eventField = element("event-field");
  private node: string | null = null;
  private edge: string | null = null;

  constructor(private readonly diagram: Diagram) {
    this.kind.append(...KINDS.map((kind) => new Option(RELATIONSHIPS[kind].name, kind)));
    for (const field of [this.name, this.stereotype, this.attributes, this.operations])
      field.addEventListener("input", () => this.editNode());
    this.kind.addEventListener("change", () => this.changeKind());
    this.label.addEventListener("input", () => this.changeLabel());
    this.dependency.addEventListener("change", () => this.changeDependency());
    this.event.addEventListener("input", () => this.changeEvent());
  }

  /** Shows the form of what `selection` names, or the hint where it names nothing to edit. */
  show(selection: Selection): void {
    this.node = selection?.kind === "node" ? selection.id : null;
    this.edge = selection?.kind === "edge" ? selection.id : null;
    const [classifier, state, kind] = [this.classifier(), this.namedState(), this.kindOf()];
    this.nodeForm.hidden = !classifier && !state;
    this.edgeForm.hidden = !kind;
    this.empty.hidden = !this.nodeForm.hidden || !this.edgeForm.hidden;
    if (classifier) this.fillNode(classifier);
    if (state) this.fillState(state);
    if (kind) this.fillEdge(kind);
  }

  /** The selected edge's kind, none where no edge is selected. */
  private kindOf(): RelationshipKind | undefined {
    return this.edge === null ? undefined : this.diagram.kinds.get(this.edge);
  }

  /** The selected node's classifier, none where no classifier is selected. */
  private classifier(): Classifier | undefined {
    return this.node === null ? undefined : this.diagram.classifiers.get(this.node);
  }

  /** The selected node's state where it is a state, which has a name; none for a pseudostate. */
  private namedState(): State | undefined {
    const state = this.node === null ? undefined : this.diagram.states.get(this.node);
    return state?.kind === "state" ? state : undefined;
  }

  private fillNode(classifier: Classifier): void {
    const { name, stereotype, attributes, operations } = classifier;
    const isPackage = kindOf(classifier) === "package";
    for (const field of this.classifierFields) field.hidden = isPackage;
    this.nodeHeading.textContent = "Selected node";
    this.name.value = name;
    this.stereotype.value = stereotype ?? "";
    this.attributes.value = attributes.join("\n");
    this.operations.value = operations.join("\n");
  }

  private fillState({ name }: State): void {
    for (const field of this.classifierFields) field.hidden = true;
    this.nodeHeading.textContent = "Selected state";
    this.name.value = name ?? "";
  }

  /** What the selected edge of `kind` shows: a transition its event, a dependency of packages
   *  its «import» or «use», any other relationship its kind and label. */
  private formOf(kind: RelationshipKind): "transition" | "dependency" | "relationship" {
    if (kind === "transition") return "transition";
    const source = this.diagram.classifiers.get(this.diagram.edge(this.edge!)?.source ?? "");
    return source && kindOf(source) === "package" ? "dependency" : "relationship";
  }

  private fillEdge(kind: RelationshipKind): void {
    const form = this.formOf(kind);
    for (const field of this.relationshipFields) field.hidden = form !== "relationship";
    this.dependencyField.hidden = form !== "dependency";
    this.eventField.hidden = form !== "transition";
    this.edgeHeading.textContent = `Selected ${form === "transition" ? "transition" : "relationship"}`;
    const text = this.diagram.edge(this.edge!)?.label?.text;
    this.kind.value = kind;
    this.label.value = text ?? "";
    this.dependency.value = text ?? "«use»";
    this.event.value = text ?? "";
  }

  /** Gives the selected dependency of packages the chosen «import» or «use» as its label. */
  private changeDependency(): void {
    if (this.edge === null) return;
    this.label.value = this.dependency.value;
    this.changeLabel();
  }

  /** Replaces the selected classifier, or the selected state's name, with what the form holds. */
  private editNode(): void {
    const state = this.namedState();
    if (state) {
      this.diagram.editState(state.id, { ...state, name: this.name.value });
      return;
    }
    const current = this.node === null ? undefined : this.diagram.classifiers.get(this.node);
    if (!current) return;
    const stereotype = this.stereotype.value.trim();
    this.diagram.edit(current.id, {
      id: current.id,
      ...(stereotype ? { stereotype } : {}),
      name: this.name.value,
      attributes: linesOf(this.attributes.value),
      operations: linesOf(this.operations.value),
    });
  }

  /** Gives the selected transition the event's text as its label, or none for no text. */
  private changeEvent(): void {
    if (this.edge === null) return;
    const text = this.event.value;
    const current = this.diagram.edge(this.edge)?.label;
    this.diagram.updateLabel(this.edge, text === "" ? null : eventLabel(text, current));
  }

  /** Changes the selected edge to the chosen kind; its label becomes the kind's, or none. */
  private changeKind(): void {
    if (this.edge === null) return;
    this.diagram.rekind(this.edge, this.kind.value as RelationshipKind);
    this.label.value = this.diagram.edge(this.edge)?.label?.text ?? "";
  }

  /** Gives the selected edge the label's text, in its kind's colour, or none for no text. */
  private changeLabel(): void {
    if (this.edge === null) return;
    const kind = this.diagram.kinds.get(this.edge)!;
    const { color, label } = RELATIONSHIPS[kind];
    const text = this.label.value;
    const current = this.diagram.edge(this.edge)?.label;
    const next: EdgeLabelData = {
      t: label?.t ?? 0.5,
      offset: 0,
      ...current,
      background: color,
      text,
    };
    this.diagram.updateLabel(this.edge, text === "" ? null : next);
  }
}
