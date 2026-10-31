// The edge-labels layer at the near level (ADR-0027, G-6): a pooled pill per edge label in view,
// centred on the point the engine placed it at.
import { BitmapText, Container, Graphics } from "pixi.js";
import type { Bridge, Visible } from "../bridge";
import type { GraphView } from "../store";
import { Bindings } from "./bindings";
import { edgeColor } from "./edges";

/** How far an edge label's pill reaches from its point at least, in world units: half the
 *  width of a label of up to 224 pixels. The reach grows to the widest label drawn so far; a
 *  label whose point lies farther outside is not bound. */
export const LABEL_REACH = 120;

/** Half the height of an edge label's pill, in world units. */
const PILL_HALF_HEIGHT = 11;

type EdgeView = NonNullable<GraphView["edges"][number]>;

/** One edge label: a pill with its text, centred on its point. A pooled view. */
export class LabelView extends Container {
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

  /** The text the pill draws. */
  get drawnText(): string {
    return this.text.text;
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
        .roundRect(
          -this.text.width / 2 - 8,
          -PILL_HALF_HEIGHT,
          this.text.width + 16,
          2 * PILL_HALF_HEIGHT,
          PILL_HALF_HEIGHT,
        )
        .fill({ color });
      this.text.position.set(-this.text.width / 2, -this.text.height / 2);
    }
    return this.text.width / 2 + 8;
  }
}

/** The edge-labels layer: a pooled pill for every edge label the query found (G-6). */
export class LabelsContainer extends Container {
  private readonly views = new Bindings(this, () => new LabelView());

  /** How many views the layer's pool has made. */
  get created(): number {
    return this.views.created;
  }

  /** The edge each slot's pill was last measured for, against the map from edge identifiers to
   *  slots then: a new map, which an addition, a removal, or a load makes, measures again. */
  private measured = new Map<number, EdgeView>();
  private measuredWith: GraphView["edgeSlots"] | null = null;

  /** How far the widest pill drawn so far reaches from its point, and at least `LABEL_REACH`:
   *  the reach the next query uses for labels. */
  reach = LABEL_REACH;

  /** Binds a label view to every label `visible` found, or to none where `shown` is false, and
   *  hands the engine the half width and half height of each pill it has not measured for that
   *  edge, as it was drawn, by which a press hits it (ADR-0013). */
  sync(state: GraphView, visible: Visible, shown: boolean, bridge: Bridge): void {
    this.views.begin();
    const pills = shown ? this.bindAll(state, visible) : [];
    this.views.end();
    // After the views of `visible` are read: each call into the engine may detach them.
    for (const [slot, halfWidth] of pills) bridge.setLabelSize(slot, halfWidth, PILL_HALF_HEIGHT);
  }

  private bindAll(state: GraphView, visible: Visible): [number, number][] {
    if (this.measuredWith !== state.edgeSlots) {
      this.measured.clear();
      this.measuredWith = state.edgeSlots;
    }
    const pills: [number, number][] = [];
    visible.labels.forEach((slot, i) => {
      const edge = state.edges[slot];
      if (!edge?.label) return;
      const view = this.views.bind(slot);
      const halfWidth = view.bind(edge);
      this.reach = Math.max(this.reach, halfWidth);
      if (this.measured.get(slot) !== edge) {
        this.measured.set(slot, edge);
        pills.push([slot, halfWidth]);
      }
      view.position.set(visible.labelPoints[i * 2], visible.labelPoints[i * 2 + 1]);
    });
    return pills;
  }
}
