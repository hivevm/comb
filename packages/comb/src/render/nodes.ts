// The nodes layer at the near and the middle level (ADR-0012): a pooled view per node in view,
// its box and its title.
import { BitmapText, Container, Graphics } from "pixi.js";
import type { GraphView, NodeView } from "../store";
import { Bindings } from "./bindings";

const NODE_FILL = 0xffffff;
const NODE_STROKE = 0xd0d4dc;
const SELECTED_STROKE = 0x3b82f6;
const TEXT_COLOR = 0x1f2430;

/** One node: its box and its title. A pooled view, bound to one node slot at a time. */
export class NodeGraphic extends Container {
  private readonly box = new Graphics();
  private readonly title = new BitmapText({
    text: "",
    style: { fontFamily: "Arial", fontSize: 14, fill: TEXT_COLOR },
  });
  /** The node the view shows. */
  nodeId = "";
  /** What the view last drew, compared by content, since a pooled view shows another node from
   *  one binding to the next. */
  private drawn = { title: "", width: -1, height: -1, selected: false };

  /** Whether the view draws its node as selected. */
  get selected(): boolean {
    return this.drawn.selected;
  }
  seen = 0;
  slot = -1;

  constructor() {
    super();
    this.title.position.set(12, 10);
    this.addChild(this.box, this.title);
    // The engine answers which node lies under the pointer; the view takes no events.
    this.eventMode = "none";
  }

  /** The size the node was last drawn at. */
  size = { width: 0, height: 0 };

  /** Shows `node`, drawing again only when what it shows changed. */
  bind(node: Readonly<NodeView>, selected: boolean): void {
    this.nodeId = node.id;
    const { drawn } = this;
    if (
      drawn.title === node.title &&
      drawn.width === node.width &&
      drawn.height === node.height &&
      drawn.selected === selected
    )
      return;
    this.drawn = { title: node.title, width: node.width, height: node.height, selected };
    this.size = { width: node.width, height: node.height };
    this.box
      .clear()
      .roundRect(0, 0, node.width, node.height, 6)
      .fill({ color: NODE_FILL })
      .stroke({ color: selected ? SELECTED_STROKE : NODE_STROKE, width: selected ? 2 : 1 });
    this.title.text = node.title;
  }
}

/** The nodes layer: a pooled view for every node slot the query found, and none for the rest. */
export class NodesContainer extends Container {
  private readonly views = new Bindings(this, () => new NodeGraphic());

  sync(state: GraphView, slots: Uint32Array, positions: Float32Array): void {
    const selected = state.selection?.kind === "node" ? state.selection.id : null;
    this.views.begin();
    for (const slot of slots) {
      const node = state.nodes[slot];
      if (!node) continue;
      const view = this.views.bind(slot);
      view.bind(node, node.id === selected);
      view.position.set(positions[slot * 2], positions[slot * 2 + 1]);
    }
    this.views.end();
  }
}
