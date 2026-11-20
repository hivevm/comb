//! The property test of the mesh budget (REN-virtualized-nested-scene): graphs of long edges, and
//! of many edges between few nodes, queried at random rectangles, scales, and levels with the
//! budget lowered, keep their mesh within the budget, draw every edge they find, report the mesh
//! complete exactly when every edge is meshed in full, draw each edge within a quarter pixel inside
//! the rectangle, edges from (0, 0) to (-1e8, 3e7) among them, and split each segment that meets
//! the rectangle where it leaves the rectangle grown by the stroke's width.
// Verifies: Q-7, Q-4, REN-virtualized-nested-scene, API-edges-dock-nodes-or-edges

use super::tests::{Lcg, random_sides, random_style};
use super::{EdgeSpec, Graph, Level, Visible};
use crate::geometry::{Dock, EdgePath, Point, Rect, Sides};
use crate::graph::End;
use crate::stroke::{
    Arrowhead, Detail, EdgeStyle, Mesh, Stroke, crossing, distance_to_segment, flattened,
};

/// How many random queries one run makes.
const CASES: u64 = 400;
/// How many edges of each query the accuracy is measured for, of those drawn without an
/// arrowhead.
const MEASURED: usize = 6;

/// A graph of `nodes` nodes within `spread` of the origin and `edges` random edges between them,
/// edge slot `i` in the colour `i + 1`, so that its vertices can be told apart in the mesh.
fn random_graph(rng: &mut Lcg, nodes: usize, edges: usize, spread: f64) -> Graph {
    let mut positions = Vec::new();
    let mut sizes = Vec::new();
    for _ in 0..nodes {
        positions.extend([
            rng.range(-spread, spread) as f32,
            rng.range(-spread, spread) as f32,
        ]);
        sizes.extend([rng.range(0.0, 300.0) as f32, rng.range(0.0, 120.0) as f32]);
    }
    let specs = (0..edges)
        .map(|i| EdgeSpec {
            sides: random_sides(rng),
            source: End::Node(rng.below(nodes)),
            target: End::Node(rng.below(nodes)),
            labels: Vec::new(),
            style: EdgeStyle {
                color: i as u32 + 1,
                dash: (rng.next() < 0.3).then(|| (rng.range(1.0, 20.0) as f32, 4.0)),
                ..random_style(rng)
            },
        })
        .collect();
    Graph::new(positions, sizes, specs).unwrap()
}

/// Edges between (0, 0), (-1e8, 3e7), and (1e8, -3e7), which need deep subdivision to keep a
/// quarter pixel where the viewport lies on their curve.
fn farthest(rng: &mut Lcg) -> Graph {
    let positions = vec![0.0, 0.0, -1e8, 3e7, 1e8, -3e7];
    let edges = 1 + rng.below(40);
    let specs = (0..edges)
        .map(|i| EdgeSpec {
            sides: random_sides(rng),
            source: End::Node(rng.below(3)),
            target: End::Node(rng.below(3)),
            labels: Vec::new(),
            style: EdgeStyle {
                color: i + 1,
                dash: None,
                ..random_style(rng)
            },
        })
        .collect();
    Graph::new(positions, [220.0, 64.0].repeat(3), specs).unwrap()
}

/// Edges between two to four nodes at one place, both ends on the outline, so that each path is
/// a point and its full mesh its arrowhead alone, of every arrowhead: the floors that
/// `any_budget` takes to be four vertices an edge (REN-virtualized-nested-scene).
fn coincident(rng: &mut Lcg) -> Graph {
    let nodes = 2 + rng.below(3) as usize;
    let at = [rng.range(-1e4, 1e4) as f32, rng.range(-1e4, 1e4) as f32];
    let edges = 1 + rng.below(300);
    let outline = Sides {
        source: Dock::Outline,
        target: Dock::Outline,
    };
    let specs = (0..edges)
        .map(|i| EdgeSpec {
            sides: outline,
            source: End::Node(rng.below(nodes)),
            target: End::Node(rng.below(nodes)),
            labels: Vec::new(),
            style: EdgeStyle {
                color: i + 1,
                dash: None,
                ..random_style(rng)
            },
        })
        .collect();
    let sizes = [220.0, 64.0].repeat(nodes);
    Graph::new(at.repeat(nodes), sizes, specs).unwrap()
}

/// Long edges between nodes far apart, edges from (0, 0) to (-1e8, 3e7), many edges between a
/// few nodes, or edges whose full mesh is their arrowhead alone.
fn any_graph(rng: &mut Lcg) -> Graph {
    let shape = rng.next();
    if shape < 0.1 {
        return coincident(rng);
    }
    if shape < 0.3 {
        return farthest(rng);
    }
    if shape < 0.6 {
        let (nodes, edges) = (2 + rng.below(30) as usize, 1 + rng.below(150) as usize);
        random_graph(rng, nodes, edges, 2e5)
    } else {
        let (nodes, edges) = (1 + rng.below(4) as usize, 50 + rng.below(1500) as usize);
        random_graph(rng, nodes, edges, 3000.0)
    }
}

/// A rectangle of a screen of 200 to 2000 pixels a side at `scale`, around a point of an edge or
/// anywhere.
fn any_rect(rng: &mut Lcg, graph: &Graph, scale: f64) -> Rect {
    let (w, h) = (
        rng.range(200.0, 2000.0) / scale,
        rng.range(200.0, 2000.0) / scale,
    );
    let slot = rng.below(graph.paths.len()) as usize;
    let at = if rng.next() < 0.8 {
        let t = rng.next();
        graph.paths[slot].point_at(t)
    } else {
        Point::new(rng.range(-3e5, 3e5), rng.range(-3e5, 3e5))
    };
    let (x, y) = (at.x + rng.range(-w, w) / 4.0, at.y + rng.range(-h, h) / 4.0);
    Rect::new(x - w / 2.0, y - h / 2.0, x + w / 2.0, y + h / 2.0)
}

/// A budget at least the floors of `found` edges, four vertices each
/// (REN-virtualized-nested-scene): those floors exactly, the full mesh's `full` vertices exactly,
/// one fewer, anywhere between the floors and it, or more.
fn any_budget(rng: &mut Lcg, found: usize, full: usize) -> u32 {
    let floors = 4 * found;
    let budget = match rng.below(5) {
        4 => floors,
        0 => full,
        1 => full.saturating_sub(1),
        2 => rng.range(floors as f64, full as f64) as usize,
        _ => rng.range(full as f64, full as f64 * 1.25 + 1.0) as usize,
    };
    u32::try_from(budget.max(floors)).unwrap()
}

/// The edges of `mesh` in the order it meshed them, each from its first vertex index in
/// `edge_starts` to the next one's: per edge the colour of its first vertex and the range of its
/// vertices, which it adds after the edge before. Read from the indices, not from runs of one
/// colour, so that a hollow arrowhead's white fill, or an edge of the colour of the one before it,
/// counts in its own edge (API-edges-dock-nodes-or-edges).
fn runs(mesh: &Mesh) -> Vec<(u32, std::ops::Range<usize>)> {
    let starts = mesh.edge_starts.iter().map(|&start| start as usize);
    let ends = starts.clone().skip(1).chain([mesh.indices.len()]);
    starts
        .zip(ends)
        .map(|(start, end)| {
            let indices = &mesh.indices[start..end];
            let first = indices.iter().min().map_or(0, |&i| i as usize);
            let last = indices.iter().max().map_or(0, |&i| i as usize + 1);
            (mesh.colors.get(first).copied().unwrap_or(0), first..last)
        })
        .collect()
}

/// The colour of edge slot `slot` in the mesh, as `random_graph` gave it: `slot + 1` as the bytes
/// R, G, B, 255 in memory order.
fn color_of(slot: u32) -> u32 {
    let [_, r, g, b] = (slot + 1).to_be_bytes();
    u32::from_le_bytes([r, g, b, 0xff])
}

/// Points along the parts of `path` whose control points meet `rect`, about `step` apart.
fn samples(path: &EdgePath, rect: &Rect, step: f64, depth: u32, out: &mut Vec<Point>) {
    if !path.hull().meets(rect) {
        return;
    }
    let hull = path.hull();
    if depth >= 40 || (hull.max_x - hull.min_x).max(hull.max_y - hull.min_y) <= step {
        out.extend((0..4).map(|i| path.point_at(f64::from(i) / 4.0)));
        return;
    }
    let (left, right) = path.split();
    samples(&left, rect, step, depth + 1, out);
    samples(&right, rect, step, depth + 1, out);
}

/// How far, in screen pixels, `points` stray from `path` inside `rect` at most.
fn worst_inside(path: &EdgePath, points: &[Point], rect: &Rect, scale: f64) -> f64 {
    let tolerance = 0.25 / scale;
    let near = rect.grown(tolerance * 4.0);
    let segments: Vec<(Point, Point)> = points
        .windows(2)
        .map(|s| (s[0], s[1]))
        .filter(|(a, b)| Rect::at(*a).union(&Rect::at(*b)).meets(&near))
        .collect();
    let mut along = Vec::new();
    samples(path, rect, tolerance * 2.0, 0, &mut along);
    along
        .into_iter()
        .filter(|p| rect.contains(*p))
        .map(|p| {
            let off = segments
                .iter()
                .map(|&(a, b)| distance_to_segment(p, a, b))
                .fold(f64::INFINITY, f64::min);
            off * scale
        })
        .fold(0.0, f64::max)
}

/// Asserts that the vertices `range` of the mesh of `out`, an edge without an arrowhead, are the
/// stroke of `points` `width` wide: the middle of each pair of vertices, its origin added back, is
/// a point, within what `f32` holds of its distance from the origin
/// (API-bridge-columns-carry-nesting).
fn assert_stroke_of(out: &Visible, range: std::ops::Range<usize>, points: &[Point], width: f64) {
    assert_eq!(range.len(), 2 * points.len());
    let mesh = &out.mesh;
    let origin = [out.origin.x, out.origin.y];
    for (i, point) in range.step_by(2).zip(points) {
        let middle = |axis: usize| {
            let (a, b) = (
                mesh.positions[2 * i + axis],
                mesh.positions[2 * i + 2 + axis],
            );
            (f64::from(a) + f64::from(b)) / 2.0 + origin[axis]
        };
        let (dx, dy) = (point.x - origin[0], point.y - origin[1]);
        let rounding = (dx.abs().max(dy.abs()) + width) * f64::from(f32::EPSILON);
        assert!((middle(0) - point.x).abs() <= rounding, "{point:?}");
        assert!((middle(1) - point.y).abs() <= rounding, "{point:?}");
    }
}

/// Asserts that no segment of `points` that meets `rect` has an end beyond `rect` grown by
/// `width`, the stroke's: where one would, the segment is split there, so that each rounds by its
/// distance from the query's origin (REN-virtualized-nested-scene).
fn assert_within_reach(points: &[Point], rect: &Rect, width: f64, context: &str) {
    let area = rect.grown(width);
    let slack = |p: Point| 1e-9 * (1.0 + p.x.abs().max(p.y.abs()));
    for s in points.windows(2) {
        if crossing(s[0], s[1], rect).is_some() {
            for p in [s[0], s[1]] {
                assert!(area.grown(slack(p)).contains(p), "{context}: {p:?}");
            }
        }
    }
}

/// Asserts that `out` holds at most `budget` vertices and three times as many indices, in step,
/// and draws every edge it found, once, in slot order.
fn assert_within(out: &Visible, budget: u32, context: &str) {
    let mesh = &out.mesh;
    let vertices = mesh.distances.len();
    assert!(vertices <= budget as usize, "{context}: {vertices}");
    assert!(mesh.indices.len() <= 3 * budget as usize, "{context}");
    assert_eq!(mesh.positions.len(), 2 * vertices, "{context}");
    assert_eq!(mesh.dashes.len(), 2 * vertices, "{context}");
    assert_eq!(mesh.colors.len(), vertices, "{context}");
    assert!(mesh.indices.iter().all(|&i| (i as usize) < vertices));
    let drawn: Vec<u32> = runs(mesh).into_iter().map(|(color, _)| color).collect();
    let found: Vec<u32> = out.edges.iter().map(|&slot| color_of(slot)).collect();
    assert_eq!(drawn, found, "{context}");
}

/// Asserts that the complete mesh of `full` draws its edges within a quarter pixel inside `rect`,
/// measured on the polyline it strokes, before its vertices are rounded to `f32`; a lightning
/// bolt's parts before and after its zigzag are measured, and the zigzag's turns are points of the
/// polyline (API-edges-dock-nodes-or-edges). The stroke of an edge with an arrowhead stops at its
/// base, off the path where it bends there, which the arrowhead's own tests decide; the flattening
/// is the same for all edges. Asserts too that the query found every lightning bolt with a turn in
/// `rect`, which lies off its path. Returns how many of the edges measured are loops.
fn assert_accurate(graph: &Graph, full: &Visible, rect: &Rect, level: Level, scale: f64) -> u32 {
    let stroke = Stroke::at(level, 1.0 / scale);
    for slot in 0..graph.edges_in_use() {
        let (spec, path) = (&graph.edges[slot as usize], graph.paths[slot as usize]);
        let (_, turns, _) = path.lightning();
        if spec.style.lightning && turns.iter().any(|&turn| rect.contains(turn)) {
            assert!(
                full.edges.contains(&slot),
                "{rect:?}: bolt {slot} not found"
            );
        }
    }
    let plain = |&(&slot, _): &(&u32, _)| {
        let style = graph.edges[slot as usize].style;
        level == Level::Far || style.arrow == Arrowhead::None
    };
    let measured = full
        .edges
        .iter()
        .zip(runs(&full.mesh))
        .filter(plain)
        .take(MEASURED);
    let mut loops = 0;
    for (&slot, (_, range)) in measured {
        let spec = &graph.edges[slot as usize];
        loops += u32::from(spec.source == spec.target);
        let path = graph.paths[slot as usize];
        let lightning = spec.style.lightning;
        let points = flattened((&path, lightning), &stroke, rect);
        assert_stroke_of(full, range, &points, stroke.width);
        assert_within_reach(&points, rect, stroke.width, &format!("edge {slot}"));
        let parts = if lightning {
            let (before, _, after) = path.lightning();
            vec![before, after]
        } else {
            vec![path]
        };
        for part in parts {
            let worst = worst_inside(&part, &points, rect, scale);
            assert!(
                worst <= 0.25,
                "{rect:?} at {scale}: edge {slot} strays {worst} px"
            );
        }
    }
    loops
}

/// Checks one query of `graph` with a budget the rng picks against the same query unbounded, and
/// returns how many loops it measured the accuracy of.
fn check(graph: &mut Graph, rng: &mut Lcg, case: u64) -> u32 {
    // Each level at the scales the scene draws it at: near from 0.6, middle from 0.3, far below.
    let (level, least, most) = [
        (Level::Near, 0.6, 10.0),
        (Level::Middle, 0.3, 0.6),
        (Level::Far, 0.001, 0.3),
    ][rng.below(3) as usize];
    let scale = f64::exp(rng.range(f64::ln(least), f64::ln(most)));
    let rect = any_rect(rng, graph, scale);
    let mut full = Visible::default();
    graph.query_within(&rect, level, 1.0 / scale, 0.0, u32::MAX, &mut full);
    assert_eq!(full.mesh.detail, Detail::Complete, "case {case}");
    let loops = assert_accurate(graph, &full, &rect, level, scale);
    let need = full.mesh.distances.len();
    let budget = any_budget(rng, full.edges.len(), need);
    let mut out = Visible::default();
    graph.query_within(&rect, level, 1.0 / scale, 0.0, budget, &mut out);
    let context = format!("case {case}: {need} vertices in full, budget {budget}");
    assert_eq!(out.edges, full.edges, "{context}");
    assert_within(&out, budget, &context);
    // Complete exactly where every edge is meshed in full: the mesh is the unbounded one.
    let (a, b) = (&out.mesh, &full.mesh);
    let in_full = a.positions == b.positions
        && a.distances == b.distances
        && a.colors == b.colors
        && a.dashes == b.dashes
        && a.indices == b.indices;
    let expected = if in_full {
        Detail::Complete
    } else {
        Detail::Coarsened
    };
    assert_eq!(out.mesh.detail, expected, "{context}");
    loops
}

#[test]
fn every_query_keeps_its_mesh_within_the_budget_and_draws_every_edge_it_finds() {
    let mut rng = Lcg(2026);
    let mut loops = 0;
    for case in 0..CASES {
        let mut graph = any_graph(&mut rng);
        loops += check(&mut graph, &mut rng, case);
    }
    // Loops among the edges measured, which the graphs of few nodes draw often
    // (API-edges-dock-nodes-or-edges).
    assert!(loops >= 200, "{loops} loops measured");
}

/// The graph of the reproduction: `a` at (0, 0) and `b` at (-1e7, 3e6), and `edges` edges from `a`
/// to `b`, with arrowheads or without.
fn far_apart(edges: u32, arrow: Arrowhead) -> Graph {
    let specs = (0..edges)
        .map(|i| EdgeSpec {
            sides: Sides::default(),
            source: End::Node(0),
            target: End::Node(1),
            labels: Vec::new(),
            style: EdgeStyle {
                color: i + 1,
                dash: None,
                arrow,
                lightning: false,
            },
        })
        .collect();
    let sizes = vec![220.0, 64.0, 220.0, 64.0];
    Graph::new(vec![0.0, 0.0, -1e7, 3e6], sizes, specs).unwrap()
}

/// The rectangle the scene queries at `(0, 0)` and `scale` on a canvas of 1440 × 900 pixels: the
/// viewport grown by the culling margin of 128 pixels.
fn viewport_at(scale: f64) -> Rect {
    Rect::new(0.0, 0.0, 1440.0 / scale, 900.0 / scale).grown(128.0 / scale)
}

#[test]
fn twenty_thousand_edges_between_two_nodes_far_apart_mesh_in_full_zoomed_in() {
    // Verifies: Q-7, REN-virtualized-nested-scene
    let mut graph = far_apart(20_000, Arrowhead::End);
    let rect = viewport_at(4.0);
    let mut out = Visible::default();
    graph.query(&rect, Level::Near, 0.25, 0.0, &mut out);
    assert_eq!(out.edges.len(), 20_000);
    assert_eq!(out.mesh.detail, Detail::Complete);
    // Outside the rectangle each edge is chords: a few dozen vertices.
    let vertices = out.mesh.distances.len();
    assert!(vertices <= 20_000 * 100, "{vertices}");
    let path = graph.paths[0];
    let points = flattened((&path, false), &Stroke::at(Level::Near, 0.25), &rect);
    let worst = worst_inside(&path, &points, &rect, 4.0);
    assert!(worst <= 0.25, "strays {worst} px inside");
}
