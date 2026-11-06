// The sidebar's forms (G-12, G-5): the selected classifier's name, stereotype, attributes, and
// operations, one member per line, and the selected relationship's kind and label. Each edit
// shows on the canvas at once.
import type { EdgeLabelData, Selection } from "comb";
import type { Classifier } from "./class-diagram";
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
  private node: string | null = null;
  private edge: string | null = null;

  constructor(private readonly diagram: Diagram) {
    this.kind.append(...KINDS.map((kind) => new Option(RELATIONSHIPS[kind].name, kind)));
    for (const field of [this.name, this.stereotype, this.attributes, this.operations])
      field.addEventListener("input", () => this.editNode());
    this.kind.addEventListener("change", () => this.changeKind());
    this.label.addEventListener("input", () => this.changeLabel());
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

  private fillNode({ name, stereotype, attributes, operations }: Classifier): void {
    this.name.value = name;
    this.stereotype.value = stereotype ?? "";
    this.attributes.value = attributes.join("\n");
    this.operations.value = operations.join("\n");
  }

  private fillEdge(kind: RelationshipKind): void {
    this.kind.value = kind;
    this.label.value = this.diagram.edge(this.edge!)?.label?.text ?? "";
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
