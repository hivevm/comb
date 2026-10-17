// The PixiJS scene (ADR-0012): a `world` render group with its layers in drawing order, and an
// `overlay` in screen coordinates. This render reads the store and never writes it (ADR-0009).
//
// After every change, the scene asks the engine which nodes, edges, and edge labels meet the
// viewport and a margin around it, and binds pooled node views and edge-label views to exactly
// those. The edge mesh and the levels of detail of ADR-0012 are not built yet: the found edges
// share one Graphics.
import { Application, BitmapText, Container, Graphics } from "pixi.js";
import type { Bridge, Rect, Visible } from "../bridge";
import type { GraphView, NodeView, Viewport } from "../store";

const NODE_FILL = 0xffffff;
const NODE_STROKE = 0xd0d4dc;
const SELECTED_STROKE = 0x3b82f6;
const EDGE_COLOR = 0x9aa1ad;
const TEXT_COLOR = 0x1f2430;

/** How far beyond the viewport the scene binds display objects, in screen pixels, so that a
 *  small pan finds them bound. */
export const CULLING_MARGIN = 128;
/** How far an edge label's pill reaches from its point at least, in world units: half the
 *  width of a label of up to 224 pixels. The reach grows to the widest label drawn so far; a
 *  label whose point lies farther outside is not bound. */
export const LABEL_REACH = 120;

/** A display object a layer binds to one slot at a time. */
interface Pooled extends Container {
  /** The render that last bound it, and to which slot. */
  seen: number;
  slot: number;
}

/** Above this many views returned in one render, a layer rebuilds its children in one pass
 *  instead of removing each, which searches the children. */
const BULK_RELEASE = 64;

/** The views of one layer bound to slots: a render binds the slots it found, in ascending order,
 *  and the views of the others go back to a pool for reuse. A view draws in the order of its
 *  slot, as without pooling, so that overlapping nodes stack and take the pointer the same way
 *  however the user panned. */
class Bindings<V extends Pooled> {
  private readonly bound = new Map<number, V>();
  private readonly free: V[] = [];
  /** The views this render bound, in slot order. */
  private readonly order: V[] = [];
  /** The highest slot among the layer's children, and whether this render bound a view below
   *  it, which an append would draw out of order. */
  private highest = -1;
  private disordered = false;
  private render = 0;

  constructor(
    private readonly layer: Container,
    private readonly make: () => V,
  ) {}

  /** Starts a render. */
  begin(): void {
    this.render += 1;
    this.order.length = 0;
  }

  /** The view bound to `slot`, taken from the pool if the slot had none. Slots come in ascending
   *  order within a render. */
  bind(slot: number): V {
    let view = this.bound.get(slot);
    if (!view) {
      view = this.free.pop() ?? this.make();
      this.bound.set(slot, view);
      if (slot < this.highest) this.disordered = true;
      else this.layer.addChild(view);
    }
    view.seen = this.render;
    view.slot = slot;
    this.order.push(view);
    return view;
  }

  /** Returns every view this render did not bind to the pool, and puts the layer's children in
   *  slot order where this render disturbed it. */
  end(): void {
    const released: V[] = [];
    for (const [slot, view] of this.bound) {
      if (view.seen === this.render) continue;
      this.bound.delete(slot);
      released.push(view);
    }
    if (this.disordered || released.length > BULK_RELEASE) {
      this.layer.removeChildren();
      for (const view of this.order) this.layer.addChild(view);
    } else {
      for (const view of released) this.layer.removeChild(view);
    }
    for (const view of released) this.free.push(view);
    this.disordered = false;
    this.highest = this.order.at(-1)?.slot ?? -1;
  }
}

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
  seen = 0;
  slot = -1;

  constructor() {
    super();
    this.title.position.set(12, 10);
    this.addChild(this.box, this.title);
    this.eventMode = "static";
    this.cursor = "grab";
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

type DrawnEdge = { id: string; source: { x: number; y: number }; target: { x: number; y: number } };

/** The edges layer: the path of every edge the query found, drawn into one Graphics. */
export class EdgesContainer extends Container {
  private readonly paths = new Graphics();
  /** What the last sync drew, copied out of the engine's buffers for inspection. */
  private last = {
    edges: [] as GraphView["edges"],
    slots: new Uint32Array(),
    points: new Float32Array(),
  };

  constructor() {
    super();
    this.addChild(this.paths);
  }

  sync(state: GraphView, visible: Visible): void {
    const { edges, edgePoints: p } = visible;
    this.paths.clear();
    for (let i = 0, at = 0; i < edges.length; i += 1, at += 8) {
      const edge = state.edges[edges[i]!];
      if (!edge) continue;
      this.paths
        .moveTo(p[at]!, p[at + 1]!)
        .bezierCurveTo(p[at + 2]!, p[at + 3]!, p[at + 4]!, p[at + 5]!, p[at + 6]!, p[at + 7]!)
        .stroke({ color: edge.color ?? EDGE_COLOR, width: 2 });
    }
    this.last = { edges: state.edges, slots: edges.slice(), points: p.slice() };
  }

  /** The edges the last sync drew, with their ends. */
  drawn(): DrawnEdge[] {
    const { edges, slots, points } = this.last;
    return [...slots].flatMap((slot, i) => {
      const edge = edges[slot];
      if (!edge) return [];
      const [x0, y0, , , , , x3, y3] = points.subarray(i * 8, i * 8 + 8);
      return [{ id: edge.id, source: { x: x0!, y: y0! }, target: { x: x3!, y: y3! } }];
    });
  }
}

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
    const color = edge.label?.background ?? edge.color ?? EDGE_COLOR;
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

  sync(state: GraphView, visible: Visible): void {
    this.views.begin();
    visible.labels.forEach((slot, i) => {
      const edge = state.edges[slot];
      if (!edge?.label) return;
      const view = this.views.bind(slot);
      this.reach = Math.max(this.reach, view.bind(edge));
      view.position.set(visible.labelPoints[i * 2], visible.labelPoints[i * 2 + 1]);
    });
    this.views.end();
  }
}

/** What the scene draws at one moment, in world coordinates, for tests and tooling. Its shape
 *  follows the scene and changes with it; it is not part of the stable interface. */
export interface SceneSnapshot {
  viewport: { x: number; y: number; scale: number };
  nodes: { id: string; x: number; y: number; width: number; height: number }[];
  edges: { id: string; source: { x: number; y: number }; target: { x: number; y: number } }[];
  edgeLabels: { edge: string; x: number; y: number }[];
  /** Every display object under the world, the layers themselves included. */
  displayObjects: number;
  /** How many times the scene has rendered. */
  renders: number;
}

function countDisplayObjects(container: Container): number {
  return container.children.reduce((sum, child) => sum + countDisplayObjects(child), 1);
}

/** The world rectangle a screen of `width` × `height` shows through `viewport`, grown by the
 *  culling margin. */
export function cullingRect(viewport: Viewport, width: number, height: number): Rect {
  const { x, y, scale } = viewport;
  const margin = CULLING_MARGIN / scale;
  return {
    minX: -x / scale - margin,
    minY: -y / scale - margin,
    maxX: (width - x) / scale + margin,
    maxY: (height - y) / scale + margin,
  };
}

/** The scene: layers in drawing order inside one render group that pans and zooms. */
export class Scene {
  /** How many times the scene has rendered; cheap to read on every frame. */
  renders = 0;
  readonly world = new Container({ isRenderGroup: true });
  readonly edges = new EdgesContainer();
  readonly nodes = new NodesContainer();
  readonly labels = new LabelsContainer();
  readonly overlay = new Container();

  constructor(readonly app: Application) {
    this.world.addChild(this.edges, this.nodes, this.labels);
    app.stage.addChild(this.world, this.overlay);
  }

  render(state: GraphView, bridge: Bridge): void {
    const { width, height } = this.app.screen;
    const visible = bridge.query(cullingRect(state.viewport, width, height), this.labels.reach);
    const positions = bridge.positions();
    this.nodes.sync(state, visible.nodes, positions);
    this.edges.sync(state, visible);
    this.labels.sync(state, visible);
    this.world.position.set(state.viewport.x, state.viewport.y);
    this.world.scale.set(state.viewport.scale);
    this.renders += 1;
  }

  inspect(): SceneSnapshot {
    return {
      viewport: { x: this.world.x, y: this.world.y, scale: this.world.scale.x },
      nodes: this.nodes.children.map((view) => ({
        id: (view as NodeGraphic).nodeId,
        ...(view as NodeGraphic).size,
        x: view.x,
        y: view.y,
      })),
      edges: this.edges.drawn(),
      edgeLabels: this.labels.children.map((label) => ({
        edge: label.label,
        x: label.x,
        y: label.y,
      })),
      displayObjects: countDisplayObjects(this.world),
      renders: this.renders,
    };
  }
}
