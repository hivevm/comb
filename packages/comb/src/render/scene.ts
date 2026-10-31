// The PixiJS scene (ADR-0027): a `world` render group with its layers in drawing order, and an
// `overlay` in screen coordinates. This render reads the store and never writes it (ADR-0028).
//
// After every change, the scene asks the engine which nodes, edges, and edge labels meet the
// viewport and a margin around it, and binds pooled node views and edge-label views to exactly
// those; the found edges are drawn as one mesh. The zoom chooses one of three levels of detail:
// near draws node boxes, their content, and edge labels; middle draws node boxes and the texts of
// role title; far draws nodes as particles and edges as thin lines, without text.
//
// The world is drawn relative to the origin of the last query (ADR-0034): the `world` render
// group stands at the screen point of the origin, the edges and the edge labels, which the engine
// hands over relative to it, at (0, 0) in it, and the nodes and particles, placed by the positions
// buffer, at minus the origin. The GPU, which takes PixiJS's transforms as `f32`, then sees only
// distances from the origin for the edges, the edge labels, and the node views, however far from
// the world's origin the viewport lies; the particles, whose shader takes their container's whole
// transform, keep the rounding they had.
import { Application, BitmapText, Container } from "pixi.js";
import type { Bridge, Detail, Level, NodeContent, Rect } from "../bridge";
import type { GraphView } from "../store";
import { EdgesContainer, type MeshSize } from "./edges";
import { EdgeFill } from "./edges-canvas";
import { LabelsContainer, type LabelView } from "./labels";
import {
  NodeGraphic,
  NodesContainer,
  type DrawnArrow,
  type DrawnPill,
  type DrawnSprite,
  type DrawnText,
} from "./nodes";
import { Icons, type IconImage } from "./icons";
import {
  ConnectionLine,
  ConnectorsLayer,
  type DrawnConnector,
  type DrawnConnectorPoint,
} from "./connectors";
import { NodeParticles } from "./particles";
import { levelAt, toScreen, worldRect } from "../store/viewport";

/** The level of detail the scene draws at (ADR-0027); the engine strokes edges for it. */
export type { Level };

const NONE = new Uint32Array(0);
/** How far beyond the viewport the scene binds display objects, in screen pixels, so that a
 *  small pan finds them bound: at least this far when it queries, and at most twice as far while
 *  it moves the world alone between queries. */
export const CULLING_MARGIN = 128;

/** What the scene draws at one moment, in world coordinates, for tests and tooling. Its shape
 *  follows the scene and changes with it; it is not part of the stable interface. */
export interface SceneSnapshot {
  /** The PixiJS renderer that draws: `"webgl"` where WebGL2 is available, `"canvas"` on the
   *  Canvas 2D fallback a host application opted into. */
  renderer: string;
  viewport: { x: number; y: number; scale: number };
  /** The level of detail the scene draws at. */
  level: Level;
  /** Every node drawn, by a view or, at the far level, as a particle, at the height its content
   *  lays out to; `texts` are the texts a view draws, each placed relative to its node, with the
   *  width and the fill its text object draws at, `pills` the pills of badges its `Graphics`
   *  draws, `bars` the pieces of progress bars it draws, each bar's segments and then its track,
   *  `arrows` the triangles of metrics' trends it draws, each its points and its colour,
   *  `icons` the sprites of icons it draws, each the name its texture is registered under and its
   *  rectangle, `content` the node's content as the engine keeps it, built
   *  when asked, and `title` the text of its first title; a particle draws none of them. */
  nodes: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    content?: NodeContent;
    texts?: (Omit<DrawnText, "pill"> & { drawnWidth: number; fill: unknown })[];
    pills?: DrawnPill[];
    bars?: DrawnPill[];
    arrows?: DrawnArrow[];
    icons?: DrawnSprite[];
  }[];
  /** How many nodes are drawn as particles. */
  particles: number;
  /** How many text objects are bound. */
  texts: number;
  /** The node drawn as selected, if one is drawn. */
  highlighted: string | null;
  edges: { id: string; source: { x: number; y: number }; target: { x: number; y: number } }[];
  /** Every edge label drawn, with the text its pill draws. */
  edgeLabels: { edge: string; x: number; y: number; text: string }[];
  /** How many triangles the edges layer draws: the edge mesh's, or the fill's on Canvas 2D. */
  edgeTriangles: number;
  /** How many vertices and indices the edge mesh draws, how many its buffers hold before they
   *  grow, and its detail: complete, or coarsened where the engine's mesh budget or memory ran
   *  short (ADR-0027). */
  edgeMesh: MeshSize & { detail: Detail };
  /** Every display object under the world, the layers themselves included. */
  displayObjects: number;
  /** How many times the scene has rendered. */
  renders: number;
  /** How many of the renders queried the engine; the others moved the world alone. */
  queries: number;
  /** The connectors the connectors layer draws (ADR-0024). */
  connectors: DrawnConnector[];
  /** Where each connector the layer draws is centred, in world units, in the order of
   *  `connectors`. */
  connectorPoints: DrawnConnectorPoint[];
  /** How many times the connectors layer drew its connectors anew. */
  connectorRedraws: number;
  /** The connection being dragged, from its source's connector to the pointer, in world units. */
  connection: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
}

function countDisplayObjects(container: Container): number {
  return container.children.reduce((sum, child) => sum + countDisplayObjects(child), 1);
}

function countTexts(container: Container): number {
  const own = container instanceof BitmapText ? 1 : 0;
  return container.children.reduce((sum, child) => sum + countTexts(child), own);
}

/** How far the scale may move from the one the scene last queried at before it queries again:
 *  a mesh flattened within a quarter pixel then strays at most 0.31 px, within Q-4. */
export const RESCALE = 1.25;

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
  /** The edges layer: the mesh on WebGL2, the fill on Canvas 2D (ADR-0018). */
  readonly edges: EdgesContainer | EdgeFill;
  readonly particles = new NodeParticles();
  readonly nodes = new NodesContainer();
  readonly labels = new LabelsContainer();
  readonly connectors = new ConnectorsLayer();
  readonly overlay = new Container();
  /** The icons the host application registered, which the node views draw. */
  readonly icons = new Icons();
  private readonly connection = new ConnectionLine();
  level: Level = "near";
  /** The detail of the edge mesh the last query drew, which inspection reports; the host
   *  application is not told. */
  private detail: Detail = "complete";
  /** How many renders queried the engine; the others moved the world alone. */
  queries = 0;
  private drawn: Drawn | null = null;
  /** The world point the last query handed its edges and labels over relative to. */
  private origin = { x: 0, y: 0 };
  /** The bridge of the last render and the edges it drew, for inspection. */
  private source: { bridge: Bridge; edges: GraphView["edges"] } | null = null;

  constructor(readonly app: Application) {
    this.edges = app.renderer.name === "canvas" ? new EdgeFill() : new EdgesContainer();
    this.world.addChild(this.edges, this.particles, this.nodes, this.labels, this.connectors);
    this.overlay.addChild(this.connection);
    app.stage.addChild(this.world, this.overlay);
  }

  /** Draws `state` from the engine behind `bridge`, a connection being dragged to the world point
   *  `pointer`, which interaction keeps outside the store (ADR-0029). */
  render(
    state: GraphView,
    bridge: Bridge,
    pointer: { readonly x: number; readonly y: number },
  ): void {
    if (!this.covers(state)) this.query(state, bridge);
    // Both views of one call, since a call into the engine may detach the views of the last.
    const { positions, sizes } = bridge.nodeBuffers();
    this.connectors.sync(state, positions, sizes, this.origin, this.level === "far");
    this.connection.sync(state, positions, sizes, pointer);
    // In f64 here, so that the world's transform on the GPU holds no far coordinate.
    const at = toScreen(state.viewport, this.origin.x, this.origin.y);
    this.world.position.set(at.x, at.y);
    this.world.scale.set(state.viewport.scale);
    this.renders += 1;
  }

  /** Registers `image` as the icon `name`, has every view drawn take it at once, without a query,
   *  so that it draws even once the engine is lost, and destroys the texture it replaces, which no
   *  view drawn holds any more; a view bound later draws its icons anew. */
  registerIcon(name: string, image: IconImage): void {
    this.icons.register(name, image);
    this.nodes.redrawIcons(this.icons);
    this.icons.release();
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
      within(worldRect(state.viewport, width, height), drawn.rect) &&
      within(drawn.rect, worldRect(state.viewport, width, height, 2 * CULLING_MARGIN))
    );
  }

  private query(state: GraphView, bridge: Bridge): void {
    const { width, height } = this.app.screen;
    const rect = worldRect(state.viewport, width, height, CULLING_MARGIN);
    const { scale } = state.viewport;
    const level = levelAt(scale);
    const far = level === "far";
    // A pixel `query` takes (ADR-0031): every writer of `viewport.scale` goes through `clampScale`.
    const visible = bridge.query(rect, level, 1 / scale, this.labels.reach);
    const { origin } = visible;
    this.origin = origin;
    this.nodes.position.set(-origin.x, -origin.y);
    this.particles.position.set(-origin.x, -origin.y);
    const { positions, sizes, content } = visible;
    this.nodes.sync(
      state,
      far ? NONE : visible.nodes,
      positions,
      sizes,
      content,
      level === "middle",
      this.icons,
    );
    this.particles.sync(state, far ? visible.nodes : NONE, positions, sizes);
    this.edges.sync(visible);
    this.detail = visible.detail;
    this.labels.sync(state, visible, level === "near", bridge);
    this.level = level;
    this.queries += 1;
    this.source = { bridge, edges: state.edges };
    const { nodes, edges, selection, positionsVersion } = state;
    this.drawn = { rect, scale, level, nodes, edges, selection, positionsVersion };
  }

  /** The edges the last query found, with their ends, asked of the engine now. */
  private drawnEdges(): SceneSnapshot["edges"] {
    if (!this.source) return [];
    const { bridge, edges } = this.source;
    const { slots, ends } = bridge.drawnEdges();
    return [...slots].flatMap((slot, i) => {
      const edge = edges[slot];
      if (!edge) return [];
      const [x0, y0, x1, y1] = ends.subarray(i * 4, i * 4 + 4);
      return [{ id: edge.id, source: { x: x0!, y: y0! }, target: { x: x1!, y: y1! } }];
    });
  }

  /** Whether the last render drew the node or the edge of `id`: cheap beside `inspect`, which
   *  builds every drawn view, so that the benchmark can check an edit within its timed frames. */
  draws(what: { node: string } | { edge: string }): boolean {
    if ("node" in what) {
      const { node } = what;
      const views = this.nodes.children as NodeGraphic[];
      return views.some((view) => view.nodeId === node) || this.particles.draws(node);
    }
    if (!this.source) return false;
    const { bridge, edges } = this.source;
    const slot = edges.findIndex((edge) => edge?.id === what.edge);
    return slot >= 0 && bridge.drawnEdges().slots.includes(slot);
  }

  /** The content of the node in `slot`, which the engine builds when asked, and the text of its
   *  first title. */
  private contentOf(slot: number): { content?: NodeContent; title?: string } {
    if (!this.source) return {};
    const content = this.source.bridge.content(slot);
    const first = content
      .flat()
      .find((element) => element.kind === "text" && element.role === "title");
    const title = first?.kind === "text" ? first.text : undefined;
    return { content, ...(title === undefined ? {} : { title }) };
  }

  /** The viewport the world is drawn through: its transform less the origin's screen point. */
  drawnViewport(): SceneSnapshot["viewport"] {
    const { x, y } = this.world;
    const scale = this.world.scale.x;
    return { x: x - this.origin.x * scale, y: y - this.origin.y * scale, scale };
  }

  inspect(): SceneSnapshot {
    return {
      renderer: this.app.renderer.name,
      viewport: this.drawnViewport(),
      level: this.level,
      nodes: [
        ...this.nodes.children.map((view) => ({
          id: (view as NodeGraphic).nodeId,
          ...(view as NodeGraphic).size,
          x: view.x,
          y: view.y,
          ...this.contentOf((view as NodeGraphic).slot),
          texts: (view as NodeGraphic).inspected(),
          pills: (view as NodeGraphic).drawnPills(),
          bars: (view as NodeGraphic).drawnBars(),
          arrows: (view as NodeGraphic).drawnArrows(),
          icons: (view as NodeGraphic).drawnSprites(),
        })),
        ...this.particles.drawn(),
      ],
      particles: this.particles.particleChildren.length,
      texts: countTexts(this.world),
      highlighted:
        this.particles.highlighted ??
        (this.nodes.children as NodeGraphic[]).find((view) => view.selected)?.nodeId ??
        null,
      edges: this.drawnEdges(),
      edgeTriangles: this.edges.triangles(),
      edgeMesh: { ...this.edges.size(), detail: this.detail },
      edgeLabels: this.labels.children.map((label) => ({
        edge: label.label,
        x: label.x + this.origin.x,
        y: label.y + this.origin.y,
        text: (label as LabelView).drawnText,
      })),
      displayObjects: countDisplayObjects(this.world),
      renders: this.renders,
      queries: this.queries,
      connectors: [...this.connectors.drawn],
      connectorPoints: [...this.connectors.points],
      connectorRedraws: this.connectors.redraws,
      connection: this.connection.drawn,
    };
  }
}
