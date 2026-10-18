// The PixiJS scene (ADR-0012): a `world` render group with its layers in drawing order, and an
// `overlay` in screen coordinates. This render reads the store and never writes it (ADR-0009).
//
// After every change, the scene asks the engine which nodes, edges, and edge labels meet the
// viewport and a margin around it, and binds pooled node views and edge-label views to exactly
// those; the found edges are drawn as one mesh. The zoom chooses one of three levels of detail:
// near draws node boxes, titles, and edge labels; middle draws node boxes and titles; far draws
// nodes as particles and edges as thin lines, without text.
import { Application, BitmapText, Container, Graphics } from "pixi.js";
import type { Bridge, Rect, Visible } from "../bridge";
import { EDGE_COLOR, EdgesContainer } from "./edges";
import { NodeParticles } from "./particles";
import type { GraphView, NodeView, Viewport } from "../store";

const NODE_FILL = 0xffffff;
const NODE_STROKE = 0xd0d4dc;
const SELECTED_STROKE = 0x3b82f6;
const TEXT_COLOR = 0x1f2430;

/** How far a drawn edge may stray from its path, in screen pixels: half the 0.5 px of Q-4. */
export const FLATNESS = 0.25;

/** The level of detail the scene draws at (ADR-0012). */
export type Level = "near" | "middle" | "far";
/** The scale from which the scene draws near: edge labels, 12 px, are 7 px tall there, the least
 *  that still reads. */
export const NEAR_SCALE = 0.6;
/** The scale below which the scene draws far: titles, 14 px, are under 4 px tall there and no
 *  longer read, so nodes become particles. */
export const FAR_SCALE = 0.3;

/** The level of detail at `scale`. */
export function levelAt(scale: number): Level {
  if (scale >= NEAR_SCALE) return "near";
  return scale >= FAR_SCALE ? "middle" : "far";
}

/** The width of an edge at the far level, in screen pixels. */
const FAR_EDGE_WIDTH = 1;
/** The width of an edge at the other levels, in world units. */
const EDGE_WIDTH = 2;
const NONE = new Uint32Array(0);
/** How far beyond the viewport the scene binds display objects, in screen pixels, so that a
 *  small pan finds them bound: at least this far when it queries, and at most twice as far while
 *  it moves the world alone between queries. */
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

/** What the scene draws at one moment, in world coordinates, for tests and tooling. Its shape
 *  follows the scene and changes with it; it is not part of the stable interface. */
export interface SceneSnapshot {
  /** The PixiJS renderer that draws: `"webgl"` where WebGL2 is available. */
  renderer: string;
  viewport: { x: number; y: number; scale: number };
  /** The level of detail the scene draws at. */
  level: Level;
  /** Every node drawn, by a view or, at the far level, as a particle. */
  nodes: { id: string; x: number; y: number; width: number; height: number }[];
  /** How many nodes are drawn as particles. */
  particles: number;
  /** How many text objects are bound. */
  texts: number;
  /** The node drawn as selected, if one is drawn. */
  highlighted: string | null;
  edges: { id: string; source: { x: number; y: number }; target: { x: number; y: number } }[];
  edgeLabels: { edge: string; x: number; y: number }[];
  /** How many triangles the edge mesh draws. */
  edgeTriangles: number;
  /** Every display object under the world, the layers themselves included. */
  displayObjects: number;
  /** How many times the scene has rendered. */
  renders: number;
  /** How many of the renders queried the engine; the others moved the world alone. */
  queries: number;
}

function countDisplayObjects(container: Container): number {
  return container.children.reduce((sum, child) => sum + countDisplayObjects(child), 1);
}

function countTexts(container: Container): number {
  const own = container instanceof BitmapText ? 1 : 0;
  return container.children.reduce((sum, child) => sum + countTexts(child), own);
}

/** The world rectangle a screen of `width` × `height` shows through `viewport`, grown by the
 *  culling margin. */
export function cullingRect(
  viewport: Viewport,
  width: number,
  height: number,
  margin = CULLING_MARGIN,
): Rect {
  const { x, y, scale } = viewport;
  margin /= scale;
  return {
    minX: -x / scale - margin,
    minY: -y / scale - margin,
    maxX: (width - x) / scale + margin,
    maxY: (height - y) / scale + margin,
  };
}

/** How far the scale may move from the one the scene last queried at before it queries again:
 *  a mesh flattened within a quarter pixel then strays at most 0.31 px, within Q-4. */
const RESCALE = 1.25;

/** What the scene last queried for: the graph state and the world rectangle it covers. */
interface Drawn {
  rect: Rect;
  scale: number;
  level: Level;
  nodes: GraphView["nodes"];
  edges: GraphView["edges"];
  selection: GraphView["selection"];
  positionsVersion: number;
}

const within = (inner: Rect, outer: Rect) =>
  outer.minX <= inner.minX &&
  inner.maxX <= outer.maxX &&
  outer.minY <= inner.minY &&
  inner.maxY <= outer.maxY;

/** The scene: layers in drawing order inside one render group that pans and zooms. */
export class Scene {
  /** How many times the scene has rendered; cheap to read on every frame. */
  renders = 0;
  readonly world = new Container({ isRenderGroup: true });
  readonly edges = new EdgesContainer();
  readonly particles = new NodeParticles();
  readonly nodes = new NodesContainer();
  readonly labels = new LabelsContainer();
  readonly overlay = new Container();
  level: Level = "near";
  /** How many renders queried the engine; the others moved the world alone. */
  queries = 0;
  private drawn: Drawn | null = null;

  constructor(readonly app: Application) {
    this.world.addChild(this.edges, this.particles, this.nodes, this.labels);
    app.stage.addChild(this.world, this.overlay);
  }

  render(state: GraphView, bridge: Bridge): void {
    if (!this.covers(state)) this.query(state, bridge);
    this.world.position.set(state.viewport.x, state.viewport.y);
    this.world.scale.set(state.viewport.scale);
    this.renders += 1;
  }

  /** Whether what the scene last queried for still holds everything the viewport shows, at about
   *  its scale: nothing in the graph changed, and the viewport lies within the queried rectangle,
   *  margin included. A pan within the margin then moves the world alone. */
  private covers(state: GraphView): boolean {
    const { drawn } = this;
    if (!drawn) return false;
    const { width, height } = this.app.screen;
    const { scale } = state.viewport;
    return (
      drawn.positionsVersion === state.positionsVersion &&
      drawn.nodes === state.nodes &&
      drawn.edges === state.edges &&
      drawn.selection === state.selection &&
      drawn.level === levelAt(scale) &&
      scale <= drawn.scale * RESCALE &&
      scale >= drawn.scale / RESCALE &&
      within(cullingRect(state.viewport, width, height, 0), drawn.rect) &&
      within(drawn.rect, cullingRect(state.viewport, width, height, 2 * CULLING_MARGIN))
    );
  }

  private query(state: GraphView, bridge: Bridge): void {
    const { width, height } = this.app.screen;
    const rect = cullingRect(state.viewport, width, height);
    const { scale } = state.viewport;
    const level = levelAt(scale);
    const far = level === "far";
    const stroke = {
      tolerance: FLATNESS / scale,
      width: far ? FAR_EDGE_WIDTH / scale : EDGE_WIDTH,
      plain: far,
    };
    // Every view of the query is read before the next call into the engine (ADR-0010).
    const visible = bridge.query(rect, this.labels.reach, stroke);
    this.nodes.sync(state, far ? NONE : visible.nodes, visible.positions);
    this.particles.sync(state, far ? visible.nodes : NONE, visible.positions);
    this.edges.sync(state, visible);
    this.labels.sync(state, visible, level === "near");
    this.level = level;
    this.queries += 1;
    const { nodes, edges, selection, positionsVersion } = state;
    this.drawn = { rect, scale, level, nodes, edges, selection, positionsVersion };
  }

  inspect(): SceneSnapshot {
    return {
      renderer: this.app.renderer.name,
      viewport: { x: this.world.x, y: this.world.y, scale: this.world.scale.x },
      level: this.level,
      nodes: [
        ...this.nodes.children.map((view) => ({
          id: (view as NodeGraphic).nodeId,
          ...(view as NodeGraphic).size,
          x: view.x,
          y: view.y,
        })),
        ...this.particles.drawn(),
      ],
      particles: this.particles.particleChildren.length,
      texts: countTexts(this.world),
      highlighted:
        this.particles.highlighted ??
        (this.nodes.children as NodeGraphic[]).find((view) => view.selected)?.nodeId ??
        null,
      edges: this.edges.drawn(),
      edgeTriangles: this.edges.triangles(),
      edgeLabels: this.labels.children.map((label) => ({
        edge: label.label,
        x: label.x,
        y: label.y,
      })),
      displayObjects: countDisplayObjects(this.world),
      renders: this.renders,
      queries: this.queries,
    };
  }
}
