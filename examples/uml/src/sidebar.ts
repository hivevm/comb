// The sidebar's forms (G-12, G-5): the selected classifier's name, stereotype, attributes, and
// operations, one member per line, or the selected package's name; the selected relationship's
// kind and label, or the selected dependency's «import» or «use». Each edit shows on the canvas
// at once.
import type { EdgeLabelData, Selection } from "comb";
import { kindOf, type Classifier } from "./class-diagram";
import type { Diagram } from "./diagram";
import { KINDS, RELATIONSHIPS, type RelationshipKind } from "./relationships";

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
  /** The fields a classifier shows and a package does not. */
  private readonly classifierFields = [
    "stereotype-field",
    "attributes-field",
    "operations-field",
  ].map((id) => element(id));
  private readonly relationshipFields = ["kind-field", "label-field"].map((id) => element(id));
  private readonly dependencyField = element("dependency-field");
  private node: string | null = null;
  private edge: string | null = null;

  constructor(private readonly diagram: Diagram) {
    this.kind.append(...KINDS.map((kind) => new Option(RELATIONSHIPS[kind].name, kind)));
    for (const field of [this.name, this.stereotype, this.attributes, this.operations])
      field.addEventListener("input", () => this.editNode());
    this.kind.addEventListener("change", () => this.changeKind());
    this.label.addEventListener("input", () => this.changeLabel());
    this.dependency.addEventListener("change", () => this.changeDependency());
  }

  /** Shows the form of what `selection` names, or the hint where it names nothing. */
  show(selection: Selection): void {
    this.node = selection?.kind === "node" ? selection.id : null;
    this.edge = selection?.kind === "edge" ? selection.id : null;
    const classifier = this.node === null ? undefined : this.diagram.classifiers.get(this.node);
    const kind = this.edge === null ? undefined : this.diagram.kinds.get(this.edge);
    this.nodeForm.hidden = !classifier;
    this.edgeForm.hidden = !kind;
    this.empty.hidden = !!classifier || !!kind;
    if (classifier) this.fillNode(classifier);
    if (kind) this.fillEdge(kind);
  }

  private fillNode(classifier: Classifier): void {
    const { name, stereotype, attributes, operations } = classifier;
    const isPackage = kindOf(classifier) === "package";
    for (const field of this.classifierFields) field.hidden = isPackage;
    this.name.value = name;
    this.stereotype.value = stereotype ?? "";
    this.attributes.value = attributes.join("\n");
    this.operations.value = operations.join("\n");
  }

  private fillEdge(kind: RelationshipKind): void {
    const edge = this.diagram.edge(this.edge!);
    const source = edge && this.diagram.classifiers.get(edge.source);
    const ofPackages = !!source && kindOf(source) === "package";
    for (const field of this.relationshipFields) field.hidden = ofPackages;
    this.dependencyField.hidden = !ofPackages;
    this.kind.value = kind;
    this.label.value = edge?.label?.text ?? "";
    this.dependency.value = edge?.label?.text ?? "«use»";
  }

  /** Gives the selected dependency of packages the chosen «import» or «use» as its label. */
  private changeDependency(): void {
    if (this.edge === null) return;
    this.label.value = this.dependency.value;
    this.changeLabel();
  }

  /** Replaces the selected classifier with what the form holds. */
  private editNode(): void {
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
