// The PixiJS scene (REN-virtualized-nested-scene): a `world` render group with its layers in
// drawing order, and an `overlay` in screen coordinates. This render reads the store and never
// writes it (ARCH-one-workspace-per-example).
//
// After every change, the scene asks the engine which nodes, edges, and edge labels meet the
// viewport and a margin around it, and binds pooled node views and edge-label views to exactly
// those; the found edges are drawn as one mesh. The zoom chooses one of three levels of detail:
// near draws node boxes, their content, and edge labels; middle draws node boxes and the texts of
// role title; far draws nodes as particles and edges as thin lines, without text.
//
// A drag, and at the far level an edit of a few slots, keep the query
// (REN-moving-layer-moves-content): the moving layer of `moving.ts` leaves what they move or
// remove out of what it drew, and draws what they move or add above it, from the engine's mesh of
// the edges at the dragged nodes and of the added edges; dragged views and their edges' labels move
// where the query bound them. A drag's release queries once.
//
// The world is drawn relative to the origin of the last query (API-bridge-columns-keep-no-size):
// the `world` render group stands at the screen point of the origin, the edges and the edge labels,
// which the engine hands over relative to it, at (0, 0) in it, and the nodes and particles, placed
// by the positions buffer, at minus the origin. The GPU, which takes PixiJS's transforms as `f32`,
// then sees only distances from the origin for the edges, the edge labels, and the node views,
// however far from the world's origin the viewport lies; the particles, whose shader takes their
// container's whole transform, keep the rounding they had.
import { Application, BitmapText, Container } from "pixi.js";
import type { Bridge, Detail, Level, NodeContent, NodeShape, Outline, Rect } from "../bridge";
import type { GraphView } from "../store";
import { EdgesContainer, type EdgeLayer, type MeshSize } from "./edges";
import { EdgeFill } from "./edges-canvas";
import { LabelsContainer, type LabelView } from "./labels";
import {
  NodeGraphic,
  NodesContainer,
  type DrawnArrow,
  type DrawnOutline,
  type DrawnPill,
  type DrawnRegion,
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
import { ResizeHandles, type DrawnHandle } from "./handles";
import { MovingLayer, type KeptQuery } from "./moving";
import { levelAt, toScreen, worldRect } from "../store/viewport";

/** The level of detail the scene draws at (REN-virtualized-nested-scene); the engine strokes edges
 *  for it. */
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
  /** The layers of the world in drawing order, bottom first, by their labels
   *  (REN-virtualized-nested-scene). */
  layers: string[];
  /** Every node drawn, by a view or, at the far level, as a particle, at the height its content
   *  lays out to; `texts` are the texts a view draws, each placed relative to its node, with the
   *  width and the fill its text object draws at, `pills` the pills of badges its `Graphics`
   *  draws, `bars` the pieces of progress bars it draws, each bar's segments and then its track,
   *  `arrows` the triangles of metrics' trends it draws, each its points and its colour,
   *  `icons` the sprites of icons it draws, each the name its texture is registered under and its
   *  rectangle, `content` the node's content as the engine keeps it, built
   *  when asked, `title` the text of its first title, `shape` its node shape, and `outline` the
   *  parts of it the view draws, each its primitive, its bounds, its fill's or its stroke's
   *  colour, and a rounded rectangle's corner radius, `outlined` how its outline is drawn,
   *  `dashes` the dash segments the engine laid of a dashed one, `rules` the lines of its
   *  separators, `inner` the inner rectangle its content is laid out in, as the engine gives
   *  it, and of an actor and an hourglass `drawing` the box the parts of its drawing span; a
   *  particle draws none of them. */
  nodes: {
    id: string;
    /** The layer it is drawn in: `containers` for a container, below the edges, else `nodes`. */
    layer: "containers" | "nodes";
    x: number;
    y: number;
    width: number;
    height: number;
    title?: string;
    content?: NodeContent;
    shape?: NodeShape;
    /** Whether the user may resize it, as Comb took it, where its data says. */
    resizable?: boolean;
    /** Where it is a region, the band of its name and the line after it as its view draws them
     *  (ARCH-regions-are-container-slots). */
    region?: DrawnRegion;
    outline?: DrawnOutline[];
    outlined?: Outline;
    /** Each `[x0, y0, x1, y1]` relative to the node (REN-node-shapes-cover-uml). */
    dashes?: number[][];
    rules?: DrawnPill[];
    inner?: { x: number; y: number; width: number; height: number };
    drawing?: { x: number; y: number; width: number; height: number };
    texts?: (Omit<DrawnText, "pill"> & { drawnWidth: number; fill: unknown })[];
    pills?: DrawnPill[];
    bars?: DrawnPill[];
    arrows?: DrawnArrow[];
    icons?: DrawnSprite[];
  }[];
  /** How many nodes that are no container are drawn as particles; containers' particles are
   *  reported among `nodes`, in the layer `containers`. */
  particles: number;
  /** How many text objects are bound. */
  texts: number;
  /** The node drawn as selected, if one is drawn. */
  highlighted: string | null;
  edges: { id: string; source: { x: number; y: number }; target: { x: number; y: number } }[];
  /** Every edge label drawn, with the text its pill draws. */
  edgeLabels: { edge: string; label: string; x: number; y: number; text: string }[];
  /** How many triangles the edges layer draws: the edge mesh's, or the fill's on Canvas 2D. */
  edgeTriangles: number;
  /** How many vertices and indices the edge mesh draws, how many its buffers hold before they
   *  grow, and its detail: complete, or coarsened where the engine's mesh budget or memory ran
   *  short (REN-virtualized-nested-scene). */
  edgeMesh: MeshSize & { detail: Detail };
  /** Every display object under the world, the layers themselves included. */
  displayObjects: number;
  /** How many times the scene has rendered. */
  renders: number;
  /** How many of the renders queried the engine; the others moved the world alone. */
  queries: number;
  /** The connectors the connectors layer draws (API-edges-dock-nodes-or-edges). */
  connectors: DrawnConnector[];
  /** Where each connector the layer draws is centred, in world units, in the order of
   *  `connectors`. */
  connectorPoints: DrawnConnectorPoint[];
  /** How many times the connectors layer drew its connectors anew. */
  connectorRedraws: number;
  /** The resize handles the overlay draws of the selected node, each its node, which one it is,
   *  and its middle in world units (API-edits-report-division-moves). */
  handles: DrawnHandle[];
  /** The squares of those handles as the overlay fills them, in screen pixels. */
  handleSquares: { x: number; y: number; width: number; height: number }[];
  /** The connection being dragged, from its source's connector to the pointer, in world units. */
  connection: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
}

/** A node drawn as a particle, as `NodeParticles.drawn` reports it. */
type SceneParticle = ReturnType<NodeParticles["drawn"]>[number];

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
interface Drawn extends KeptQuery {
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
  /** The containers layer, below the edges: the node views of containers and, at the far level,
   *  their particles (REN-virtualized-nested-scene). */
  readonly containers = new Container({ label: "containers" });
  readonly containerParticles = new NodeParticles();
  readonly containerNodes = new NodesContainer();
  /** The edges layer: the mesh on WebGL2, the fill on Canvas 2D (REN-webgl2-or-canvas-fallback). */
  readonly edges: EdgeLayer;
  readonly particles = new NodeParticles();
  readonly nodes = new NodesContainer();
  readonly labels = new LabelsContainer();
  /** What a drag or an edit at the far level moved or added, above the kept query
   *  (REN-moving-layer-moves-content). */
  readonly moving: MovingLayer;
  readonly connectors = new ConnectorsLayer();
  readonly overlay = new Container();
  /** The icons the host application registered, which the node views draw. */
  readonly icons = new Icons();
  private readonly connection = new ConnectionLine();
  /** The resize handles of the selected node, in the overlay. */
  private readonly handles = new ResizeHandles();
  level: Level = "near";
  /** The detail of the edge mesh the last query drew, which inspection reports; the host
   *  application is not told. */
  private detail: Detail = "complete";
  /** How many renders queried the engine; the others moved the world alone. */
  queries = 0;
  private drawn: Drawn | null = null;
  /** The world point the last query handed its edges and labels over relative to. */
  private origin = { x: 0, y: 0 };
  /** The bridge of the last render, for inspection. */
  private source: { bridge: Bridge } | null = null;

  constructor(readonly app: Application) {
    const canvas = app.renderer.name === "canvas";
    this.edges = canvas ? new EdgeFill() : new EdgesContainer();
    const { edges, particles, nodes, labels, containerParticles, containerNodes } = this;
    this.moving = new MovingLayer(canvas, {
      edges,
      particles,
      nodes,
      labels,
      containerParticles,
      containerNodes,
    });
    // The moving particles of containers directly above the query's
    // (REN-moving-layer-moves-content).
    this.containers.addChild(
      this.containerParticles,
      this.moving.containerParticles,
      this.containerNodes,
    );
    this.edges.label = "edges";
    this.moving.edges.label = "movingEdges";
    this.particles.label = "particles";
    this.moving.particles.label = "movingParticles";
    this.nodes.label = "nodes";
    this.labels.label = "labels";
    this.connectors.label = "connectors";
    this.world.addChild(
      this.containers,
      this.edges,
      this.moving.edges,
      this.particles,
      this.moving.particles,
      this.nodes,
      this.labels,
      this.connectors,
    );
    // The engine answers every hit test (REN-node-content-and-hits); interaction listens on the
    // stage alone. The world and its layers take no events, so that PixiJS's event system walks
    // none of them, and hit-tests no edge mesh, on a pointer move.
    this.world.eventMode = "none";
    this.overlay.addChild(this.connection, this.handles);
    app.stage.addChild(this.world, this.overlay);
  }

  /** Draws `state` from the engine behind `bridge`, a connection being dragged to the world point
   *  `pointer`, which interaction keeps outside the store (ARCH-graph-in-zustand-store). */
  render(
    state: GraphView,
    bridge: Bridge,
    pointer: { readonly x: number; readonly y: number },
  ): void {
    this.moving.read(state, this.drawn);
    if (!this.covers(state)) this.query(state, bridge);
    const { drawn, queries, origin } = this;
    this.moving.draw(state, bridge, { drawn, queries, origin });
    // Both views of one call, since a call into the engine may detach the views of the last.
    const { positions, sizes } = bridge.nodeBuffers();
    this.connectors.sync(state, positions, sizes, this.origin, this.level === "far");
    this.connection.sync(state, positions, sizes, pointer);
    this.handles.sync(state, positions, sizes);
    // Last, once no view of the engine's buffers is read any more: the names of the regions
    // drawn, as the engine cuts them to their bands (ARCH-regions-are-container-slots).
    this.containerNodes.nameBands();
    // And the tabs of the frames drawn and the drawings of the actors and the hourglasses, as the
    // engine lays them out (REN-node-shapes-cover-uml).
    const innerOf = (slot: number) => bridge.innerOf(slot);
    this.containerNodes.drawInners(innerOf);
    this.nodes.drawInners(innerOf);
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
   *  its scale: nothing in the graph changed but edits the moving layer draws, and the viewport
   *  lies within the queried rectangle, margin included. A pan within the margin then moves the
   *  world alone. */
  private covers(state: GraphView): boolean {
    const { drawn } = this;
    if (!drawn) return false;
    const { width, height } = this.app.screen;
    const { scale } = state.viewport;
    return (
      drawn.positionsVersion === state.positionsVersion &&
      this.moving.keepsQuery &&
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
    // A pixel `query` takes (API-shell-mistake-refused-as-shells): every writer of `viewport.scale`
    // goes through `clampScale`.
    // A region, a container, draws its name as the engine cuts it
    // (ARCH-regions-are-container-slots); asked before the query, whose views a call detaches.
    this.containerNodes.bands ??= {
      name: (name, length) => bridge.bandName(name, length),
      thickness: bridge.bandThickness(),
    };
    const visible = bridge.query(rect, level, 1 / scale, this.labels.reach);
    const { origin } = visible;
    this.origin = origin;
    this.containers.position.set(-origin.x, -origin.y);
    this.nodes.position.set(-origin.x, -origin.y);
    this.particles.position.set(-origin.x, -origin.y);
    this.moving.particles.position.set(-origin.x, -origin.y);
    const { positions, sizes, content, containers } = visible;
    const { icons } = this;
    // The containers' content lies before the other nodes' (ARCH-engine-edits-nested-graph).
    this.containerNodes.sync(state, far ? NONE : containers, positions, sizes, content, icons);
    this.containerParticles.sync(state, far ? containers : NONE, positions, sizes);
    const first = far ? 0 : containers.length;
    this.nodes.sync(state, far ? NONE : visible.nodes, positions, sizes, content, icons, first);
    this.particles.sync(state, far ? visible.nodes : NONE, positions, sizes);
    this.edges.sync(visible);
    this.detail = visible.detail;
    this.labels.sync(state, visible, level === "near", bridge);
    this.level = level;
    this.queries += 1;
    this.source = { bridge };
    const { nodes, edges, selection, positionsVersion } = state;
    this.drawn = { rect, scale, level, nodes, edges, selection, positionsVersion };
    this.moving.queried();
  }

  /** The edges drawn, those the last query found and those the moving layer meshed, with their
   *  ends, asked of the engine now; named by the store's edges, not the query's. */
  private drawnEdges(): SceneSnapshot["edges"] {
    return this.source ? this.moving.drawnEdges(this.source.bridge.drawnEdges()) : [];
  }

  /** Whether the last render drew the node or the edge of `id`: cheap beside `inspect`, which
   *  builds every drawn view and asks the engine for the drawn edges, so that the benchmark can
   *  check an edit within its timed frames; an edge is answered from the slots the scene holds. */
  draws(what: { node: string } | { edge: string }): boolean {
    if ("node" in what) {
      const { node } = what;
      const views = [...this.containerNodes.children, ...this.nodes.children] as NodeGraphic[];
      return (
        views.some((view) => view.nodeId === node) ||
        this.containerParticles.draws(node) ||
        this.moving.containerParticles.draws(node) ||
        this.particles.draws(node) ||
        this.moving.particles.draws(node)
      );
    }
    return this.source !== null && this.moving.drawsEdge(what.edge, this.edges);
  }

  /** The content of the node in `slot`, which the engine builds when asked, and the text of its
   *  first title. */
  private contentOf(slot: number): { content?: NodeContent; title?: string } {
    if (!this.source) return {};
    const content = this.source.bridge.content(slot);
    const first = content
      .flatMap((row) => (row === "separator" ? [] : row))
      .find((element) => element.kind === "text" && element.role === "title");
    const title = first?.kind === "text" ? first.text : undefined;
    return { content, ...(title === undefined ? {} : { title }) };
  }

  /** The inner rectangle of the node in `slot`, which the engine gives when asked. */
  private innerOf(slot: number): {
    inner?: { x: number; y: number; width: number; height: number };
  } {
    return this.source ? { inner: this.source.bridge.innerOf(slot) } : {};
  }

  /** The viewport the world is drawn through: its transform less the origin's screen point. */
  drawnViewport(): SceneSnapshot["viewport"] {
    const { x, y } = this.world;
    const scale = this.world.scale.x;
    return { x: x - this.origin.x * scale, y: y - this.origin.y * scale, scale };
  }

  /** The node views of `layer`, named `name`, as inspection reports them. */
  private inspectedViews(layer: NodesContainer, name: "containers" | "nodes") {
    return (layer.children as NodeGraphic[]).map((view) => ({
      id: view.nodeId,
      layer: name,
      ...view.size,
      x: view.x,
      y: view.y,
      ...this.contentOf(view.slot),
      ...view.drawnShape(),
      ...this.innerOf(view.slot),
      dashes: view.drawnDashes(),
      rules: view.drawnRules(),
      ...(view.resizable === undefined ? {} : { resizable: view.resizable }),
      ...(view.region ? { region: view.region } : {}),
      texts: view.inspected(),
      pills: view.drawnPills(),
      bars: view.drawnBars(),
      arrows: view.drawnArrows(),
      icons: view.drawnSprites(),
    }));
  }

  inspect(): SceneSnapshot {
    const layered = (layer: "containers" | "nodes") => (node: SceneParticle) => ({
      ...node,
      layer,
    });
    return {
      renderer: this.app.renderer.name,
      viewport: this.drawnViewport(),
      level: this.level,
      layers: this.world.children.map((layer) => layer.label),
      nodes: [
        ...this.containerParticles.drawn().map(layered("containers")),
        ...this.moving.containerParticles.drawn().map(layered("containers")),
        ...this.inspectedViews(this.containerNodes, "containers"),
        ...this.inspectedViews(this.nodes, "nodes"),
        ...this.particles.drawn().map(layered("nodes")),
        ...this.moving.particles.drawn().map(layered("nodes")),
      ],
      particles: this.particles.particleChildren.length,
      texts: countTexts(this.world),
      highlighted:
        this.particles.highlighted ??
        this.containerParticles.highlighted ??
        ([...this.containerNodes.children, ...this.nodes.children] as NodeGraphic[]).find(
          (view) => view.selected,
        )?.nodeId ??
        null,
      edges: this.drawnEdges(),
      edgeTriangles: this.edges.triangles(),
      edgeMesh: {
        ...this.edges.size(),
        detail: this.moving.detail === "coarsened" ? "coarsened" : this.detail,
      },
      edgeLabels: this.labels.children.map((label) => ({
        edge: label.label,
        label: (label as LabelView).labelId,
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
      handles: [...this.handles.drawn],
      handleSquares: this.handles.squares(),
    };
  }
}
