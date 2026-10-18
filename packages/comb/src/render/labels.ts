// The edge-labels layer at the near level (ADR-0012, G-6): a pooled pill per edge label in view,
// centred on the point the engine placed it at.
import { BitmapText, Container, Graphics } from "pixi.js";
import type { Visible } from "../bridge";
import type { GraphView } from "../store";
import { Bindings } from "./bindings";
import { edgeColor } from "./edges";

/** How far an edge label's pill reaches from its point at least, in world units: half the
 *  width of a label of up to 224 pixels. The reach grows to the widest label drawn so far; a
 *  label whose point lies farther outside is not bound. */
export const LABEL_REACH = 120;

type EdgeView = GraphView["edges"][number];

/** One edge label: a pill with its text, centred on its point. A pooled view. */
class LabelView extends Container {
  private readonly pill = new Graphics();
  private readonly text = new BitmapText({
    text: "",
    style: { fontFamily: "Arial", fontSize: 12, fill: 0xffffff },
  });
  /** What the view last drew, compared by content, since a pooled view shows another label
   *  from one binding to the next. */
  private drawn = { text: "", color: -1 };
  seen = 0;
  slot = -1;

  constructor() {
    super();
    this.addChild(this.pill, this.text);
  }

  /** Shows the label of `edge`, drawing again only when its text or colour changed; returns
   *  how far its pill reaches from its point. */
  bind(edge: EdgeView): number {
    this.label = edge.id;
    const text = edge.label?.text ?? "";
    const color = edge.label?.background ?? edgeColor(edge);
    if (text !== this.drawn.text || color !== this.drawn.color) {
      this.drawn = { text, color };
      this.text.text = text;
      this.pill
        .clear()
        .roundRect(-this.text.width / 2 - 8, -11, this.text.width + 16, 22, 11)
        .fill({ color });
      this.text.position.set(-this.text.width / 2, -this.text.height / 2);
    }
    return this.text.width / 2 + 8;
  }
}

/** The edge-labels layer: a pooled pill for every edge label the query found (G-6). */
export class LabelsContainer extends Container {
  private readonly views = new Bindings(this, () => new LabelView());
  /** How far the widest pill drawn so far reaches from its point, and at least `LABEL_REACH`:
   *  the reach the next query uses for labels. */
  reach = LABEL_REACH;

  /** Binds a label view to every label `visible` found, or to none where `shown` is false. */
  sync(state: GraphView, visible: Visible, shown: boolean): void {
    this.views.begin();
    if (shown) this.bindAll(state, visible);
    this.views.end();
  }

  private bindAll(state: GraphView, visible: Visible): void {
    visible.labels.forEach((slot, i) => {
      const edge = state.edges[slot];
      if (!edge?.label) return;
      const view = this.views.bind(slot);
      this.reach = Math.max(this.reach, view.bind(edge));
      view.position.set(visible.labelPoints[i * 2], visible.labelPoints[i * 2 + 1]);
    });
  }
}
