// The sidebar's forms (G-12, G-5): the selected classifier's name, stereotype, attributes, and
// operations, one member per line, or the selected package's or state's name; the selected
// relationship's kind and label, the selected dependency's «import» or «use», or the selected
// transition's event. A pseudostate has nothing to edit. Which form a node or an edge shows, and
// what its heading calls it, the descriptor of the diagram shown says. Each edit shows on the
// canvas at once.
import type { Selection } from "comb";
import type { Diagram } from "./diagram";
import { element } from "./element";
import { KINDS, labelOf, RELATIONSHIPS, type RelationshipKind } from "./relationships";
import type { NodeForm } from "./shared";

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
    this.label.addEventListener("input", () => this.relabel(this.label.value));
    this.dependency.addEventListener("change", () => this.relabel(this.dependency.value));
    this.event.addEventListener("input", () => this.relabel(this.event.value));
  }

  /** Shows the form of what `selection` names, or the hint where it names nothing to edit. */
  show(selection: Selection): void {
    this.node = selection?.kind === "node" ? selection.id : null;
    this.edge = selection?.kind === "edge" ? selection.id : null;
    const [form, kind] = [this.formOfNode(), this.kindOf()];
    this.nodeForm.hidden = form === "none";
    this.edgeForm.hidden = !kind;
    this.empty.hidden = !this.nodeForm.hidden || !this.edgeForm.hidden;
    if (form !== "none") this.fillNode(form);
    if (kind) this.fillEdge(kind);
  }

  /** The selected edge's kind, none where no edge is selected. */
  private kindOf(): RelationshipKind | undefined {
    return this.edge === null ? undefined : this.diagram.kinds.get(this.edge);
  }

  /** The form the selected node is edited in, by its kind in the diagram shown; "none" where no
   *  node is selected, or its kind has nothing to edit. */
  private formOfNode(): NodeForm {
    const kind = this.node === null ? undefined : this.diagram.kindOf(this.node);
    return this.diagram.descriptor.nodes.find((each) => each.kind === kind)?.form ?? "none";
  }

  /** Fills the node form of `form` from the selected node's classifier, or from its state, which
   *  has a name and no stereotype or members. */
  private fillNode(form: Exclude<NodeForm, "none">): void {
    const classifier = this.diagram.classifiers.get(this.node!);
    const { stereotype = "", attributes = [], operations = [] } = classifier ?? {};
    for (const field of this.classifierFields) field.hidden = form !== "classifier";
    this.nodeHeading.textContent = `Selected ${this.diagram.descriptor.selected.node}`;
    this.name.value = classifier?.name ?? this.diagram.states.get(this.node!)?.name ?? "";
    this.stereotype.value = stereotype;
    this.attributes.value = attributes.join("\n");
    this.operations.value = operations.join("\n");
  }

  private fillEdge(kind: RelationshipKind): void {
    const { edgeForm: form, selected } = this.diagram.descriptor;
    for (const field of this.relationshipFields) field.hidden = form !== "relationship";
    this.dependencyField.hidden = form !== "import-or-use";
    this.eventField.hidden = form !== "event";
    this.edgeHeading.textContent = `Selected ${selected.edge}`;
    const text = this.diagram.edge(this.edge!)?.label?.text;
    // The kind select offers the kinds a relationship's form changes between, and is set only
    // where that form shows.
    if (form === "relationship") this.kind.value = kind;
    this.label.value = text ?? "";
    this.dependency.value = text ?? "«use»";
    this.event.value = text ?? "";
  }

  /** Replaces the selected classifier, or the selected state's name, with what the form holds;
   *  the classifier keeps its kind whatever its stereotype reads. */
  private editNode(): void {
    if (this.formOfNode() === "none") return;
    const state = this.diagram.states.get(this.node!);
    if (state) {
      this.diagram.editState(state.id, { ...state, name: this.name.value });
      return;
    }
    const current = this.node === null ? undefined : this.diagram.classifiers.get(this.node);
    if (!current) return;
    const stereotype = this.stereotype.value.trim();
    this.diagram.edit(current.id, {
      id: current.id,
      kind: current.kind,
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

  /** Gives the selected edge a label of its kind that reads `text`, where its label stands, or none
   *  for no text: a relationship's label, a dependency's «import» or «use», or a transition's
   *  event. */
  private relabel(text: string): void {
    if (this.edge === null) return;
    const kind = this.diagram.kinds.get(this.edge)!;
    const current = this.diagram.edge(this.edge)?.label;
    this.diagram.updateLabel(this.edge, text === "" ? null : labelOf(kind, text, current));
  }
}
