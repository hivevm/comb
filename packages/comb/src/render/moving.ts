// The moving layer (ADR-0027): what a drag, and at the far level an edit of a few slots, move or
// add, drawn above the query the scene keeps, and what they move or remove, hidden in what that
// query drew. It holds the state of those decisions: the edits read from the store's arrays
// against the kept query's, what it hides and draws, and what inspection reports of it. The scene
// asks it each render, and queries anew where it says the kept query does not survive.
import type { Bridge, Detail, DrawnEdges, Level, Rect } from "../bridge";
import type { GraphView } from "../store";
import { EdgesContainer, holds, type EdgeLayer } from "./edges";
import { EdgeFill } from "./edges-canvas";
import type { LabelsContainer } from "./labels";
import type { NodesContainer } from "./nodes";
import { NodeParticles } from "./particles";
import { edited, editsSince, NO_EDITS, type Edits } from "./edits";

const NONE = new Uint32Array(0);
const NONE_F32 = new Float32Array(0);
/** The mesh of no edge, which the moving layer draws once no drag or edit is left to draw. */
const EMPTY_MESH = {
  mesh: {
    positions: NONE_F32,
    distances: NONE_F32,
    colors: NONE,
    dashes: NONE_F32,
    indices: NONE,
  },
};

/** What the scene last queried for, as the moving layer reads it. */
export interface KeptQuery {
  rect: Rect;
  scale: number;
  level: Level;
  nodes: GraphView["nodes"];
  edges: GraphView["edges"];
}

/** The query the moving layer draws against: what it was made for, how many queries the scene has
 *  made with it, and the world point it handed its edges and labels over relative to. */
export interface Kept {
  drawn: KeptQuery | null;
  queries: number;
  origin: { x: number; y: number };
}

/** The layers of the kept query, in which the moving layer hides and places what moved. */
export interface QueryLayers {
  edges: EdgeLayer;
  particles: NodeParticles;
  nodes: NodesContainer;
  labels: LabelsContainer;
}

/** The moving layer: its edges directly above the query's edges, its particles directly above the
 *  query's particles. */
export class MovingLayer {
  /** The edges at the nodes a drag moves and the added edges: a mesh on WebGL2, a fill on
   *  Canvas 2D (ADR-0018). */
  readonly edges: EdgeLayer;
  /** The particles of the nodes a drag moves and of the added nodes, at the far level. */
  readonly particles = new NodeParticles();
  /** What the moving layer leaves out of the query it keeps, by the query's count: the edges and
   *  the particles hidden so far; none while it draws nothing. */
  private hidden: { queries: number; edges: Set<number>; particles: Set<number> } | null = null;
  /** The edits since the kept query, null where it does not survive them, and the arrays they were
   *  read from. */
  private edits: Edits | null = NO_EDITS;
  private editedFrom: Pick<GraphView, "nodes" | "edges"> | null = null;
  /** The edge slots the moving layer draws, and what its mesh was made for. */
  private edgeSlots = NONE;
  private madeFor: unknown[] = [];
  /** The slots the last render's drag moved. */
  private draggedAt: readonly number[] = [];
  /** The store's arrays at the last render, which inspection reads. */
  private current: Pick<GraphView, "nodes" | "edges" | "edgeSlots"> = {
    nodes: [],
    edges: [],
    edgeSlots: new Map(),
  };
  /** The detail of the moving layer's mesh, which joins the query's in inspection. */
  detail: Detail = "complete";

  constructor(
    canvas: boolean,
    private readonly query: QueryLayers,
  ) {
    this.edges = canvas ? new EdgeFill() : new EdgesContainer();
  }

  /** Whether the kept query survives the edits `read` found. */
  get keepsQuery(): boolean {
    return this.edits !== null;
  }

  /** Reads the edits since the query drawn from the store's arrays when either is a new one: none
   *  where they are the query's, the edits at the far level where the kept query survives them,
   *  and null where it does not, past `EDIT_BOUND`, at another level, or once a drag ended with no
   *  release, by a removal of what it moved. */
  read(state: GraphView, drawn: KeptQuery | null): void {
    const now = { nodes: state.nodes, edges: state.edges };
    this.current = { ...now, edgeSlots: state.edgeSlots };
    if (!drawn || (drawn.nodes === now.nodes && drawn.edges === now.edges)) {
      [this.edits, this.editedFrom] = [NO_EDITS, null];
    } else {
      const from = this.editedFrom;
      if (!from || from.nodes !== now.nodes || from.edges !== now.edges) {
        this.editedFrom = now;
        this.edits = drawn.level === "far" ? editsSince(drawn, now) : null;
      }
    }
    if (this.draggedAt.length > 0 && !state.dragged) this.edits = null;
  }

  /** Takes up a query the scene just made: no edit since it. */
  queried(): void {
    this.edits = NO_EDITS;
    this.editedFrom = null;
  }

  /** Draws the moving layer of this render against `kept`: a frame of what a drag moved or edits
   *  changed, or, once neither is left, nothing. */
  draw(state: GraphView, bridge: Bridge, kept: Kept): void {
    if (state.dragged || edited(this.edits ?? NO_EDITS)) this.moving(state, bridge, kept);
    else if (this.hidden) this.dropped(state);
  }

  /** Draws a frame of what moved or was edited against the query the scene keeps: the edges at
   *  the dragged nodes and the added edges meshed into the moving layer when the drag moved or the
   *  arrays changed; those edges and the removed ones, and at the far level the dragged and the
   *  removed nodes' particles, hidden in what the query drew, each once a query; the dragged and
   *  added nodes' particles drawn in the moving layer at the far level, and nearer the dragged
   *  views and their edges' labels where they are now. */
  private moving(state: GraphView, bridge: Bridge, kept: Kept): void {
    const { drawn, queries, origin } = kept;
    if (!drawn) return;
    const dragged = state.dragged ?? [];
    this.draggedAt = dragged;
    const { addedEdges, removedEdges, addedNodes, removedNodes } = this.edits ?? NO_EDITS;
    const key = [queries, state.movesVersion, state.nodes, state.edges, dragged];
    if (key.some((part, i) => part !== this.madeFor[i])) {
      const slots = Uint32Array.from(dragged);
      const also = Uint32Array.from(addedEdges);
      const moving = bridge.meshAt(slots, also, drawn.rect, drawn.level, 1 / drawn.scale);
      // Copied before the next call into the engine, which may detach the views.
      this.edgeSlots = Uint32Array.from(moving.edges);
      this.edges.sync(moving);
      this.detail = moving.detail;
      this.madeFor = key;
    }
    const far = drawn.level === "far";
    if (!this.hidden || this.hidden.queries !== queries) {
      this.hidden = { queries, edges: new Set(), particles: new Set() };
      // A query nearer than far, after a zoom across the level, draws the nodes' views instead.
      if (!far) this.particles.sync(state, NONE, NONE_F32, NONE_F32);
    }
    this.hideNew(far, [...this.edgeSlots, ...removedEdges], [...dragged, ...removedNodes]);
    const { positions, sizes } = bridge.nodeBuffers();
    if (far) {
      // The dragged nodes keep their ranks, below every added node, which the newest ranks hold.
      const drawnHere = [...dragged, ...addedNodes.filter((slot) => !dragged.includes(slot))];
      this.particles.sync(state, Uint32Array.from(drawnHere), positions, sizes);
    } else this.query.nodes.place(dragged, positions);
    if (drawn.level === "near") this.query.labels.follow(this.edgeSlots, bridge, origin);
  }

  /** Hides in what the kept query drew the edges of `edges` and, at the far level, the particles of
   *  `particles` it does not hide yet, each slot looked at once a query: the edges by the one span
   *  of indices they cover, the particles all uploaded once a time the set grows by one drawn. */
  private hideNew(far: boolean, edges: number[], particles: readonly number[]): void {
    const hidden = this.hidden!;
    const newEdges = edges.filter((slot) => !hidden.edges.has(slot));
    if (newEdges.length > 0) {
      for (const slot of newEdges) hidden.edges.add(slot);
      this.query.edges.hide(new Set(newEdges));
    }
    if (!far) return;
    const newParticles = particles.filter((slot) => !hidden.particles.has(slot));
    if (newParticles.length === 0) return;
    for (const slot of newParticles) hidden.particles.add(slot);
    // Only what the query drew uploads: a node it never drew, one an edit added, needs no hiding.
    if (newParticles.some((slot) => this.query.particles.holds(slot))) {
      this.query.particles.hide(hidden.particles);
    }
  }

  /** Ends the drawing of a drag or edits whose query is gone: the moving layer emptied. */
  private dropped(state: GraphView): void {
    this.edges.sync(EMPTY_MESH);
    this.detail = "complete";
    this.particles.sync(state, NONE, NONE_F32, NONE_F32);
    this.edgeSlots = NONE;
    this.madeFor = [];
    this.draggedAt = [];
    this.hidden = null;
  }

  /** Whether the edge in `slot`, which the last query found or the moving layer meshed, is drawn
   *  now: held by the store, and not hidden unless the moving layer draws it. */
  edgeDrawn(slot: number): boolean {
    if (!this.current.edges[slot]) return false;
    return !this.hidden?.edges.has(slot) || this.edgeSlots.includes(slot);
  }

  /** Whether the last render drew the store's edge `id`, answered from what the scene holds,
   *  without asking the engine: found by the query `found` drew or meshed by the moving layer, and
   *  drawn now as `edgeDrawn` says; as `drawnEdges` reports it. */
  drawsEdge(id: string, found: EdgeLayer): boolean {
    const slot = this.current.edgeSlots.get(id);
    if (slot === undefined) return false;
    return (found.names(slot) || holds(this.edgeSlots, slot)) && this.edgeDrawn(slot);
  }

  /** Those of the edges the engine names drawn, with their ends, that are drawn now, named by the
   *  store's edges, not the query's. */
  drawnEdges({ slots, ends }: DrawnEdges): {
    id: string;
    source: { x: number; y: number };
    target: { x: number; y: number };
  }[] {
    const { edges } = this.current;
    return [...slots].flatMap((slot, i) => {
      const edge = edges[slot];
      if (!edge || !this.edgeDrawn(slot)) return [];
      const [x0, y0, x1, y1] = ends.subarray(i * 4, i * 4 + 4);
      return [{ id: edge.id, source: { x: x0!, y: y0! }, target: { x: x1!, y: y1! } }];
    });
  }
}
