//! The edges of the graph: the lists of the edges at each node and of the edges that end on each
//! edge, an addition into the free slot freed last or a new one, a change of an edge's label
//! placements, style, and sides, a removal, which takes the edges that end on a removed edge along,
//! and the path of each edge, its bounds, and the point of each of its labels
//! (ARCH-engine-edits-graph-in-place, API-edges-dock-nodes-or-edges).

use super::slots::put;
use super::{AddEdgeError, EdgeSpec, End, Graph, LabelPlacement, SlotError, Which};
use crate::geometry::{Dock, EdgePath, Point, Rect, Sides, centre, end_of, on_edge};
use crate::stroke::EdgeStyle;

impl Graph {
    /// How many edge slots hold an edge.
    pub fn edges_in_use(&self) -> u32 {
        self.edge_slots.in_use()
    }

    /// Whether `slot` holds an edge: a slot below the slots and not free.
    pub(super) fn holds_edge(&self, slot: u32) -> bool {
        self.edge_slots.holds(slot)
    }

    /// Refuses `slots` where one holds no edge, beyond the slots or free, naming the first: the
    /// one check of the edge slots a call names (ARCH-engine-edits-graph-in-place).
    pub(super) fn edges_held(&self, slots: &[u32]) -> Result<(), SlotError> {
        match slots.iter().find(|&&s| !self.holds_edge(s)) {
            Some(&slot) => Err(SlotError::NoEdge { slot }),
            None => Ok(()),
        }
    }

    /// The node slots at the ends of the edge in `slot` that lie on a node, each once.
    pub(super) fn ends(&self, slot: u32) -> impl Iterator<Item = u32> {
        let edge = &self.edges[slot as usize];
        let (source, target) = (edge.source.node(), edge.target.node());
        source
            .into_iter()
            .chain(target.filter(|&target| Some(target) != source))
    }

    /// The edge slots the ends of the edge in `slot` lie on, each once
    /// (API-edges-dock-nodes-or-edges, *An end on an edge*).
    fn anchors(&self, slot: u32) -> impl Iterator<Item = u32> {
        let edge = &self.edges[slot as usize];
        let (source, target) = (edge.source.edge(), edge.target.edge());
        source
            .into_iter()
            .chain(target.filter(|&target| Some(target) != source))
    }

    /// Builds the lists of edges at each node and of the edges that end on each edge.
    pub(super) fn link(&mut self) {
        let mut incident = vec![Vec::new(); self.node_slots.count() as usize];
        let mut anchored = vec![Vec::new(); self.edge_slots.count() as usize];
        for edge in 0..self.edge_slots.count() {
            for end in self.ends(edge) {
                incident[end as usize].push(edge);
            }
            for on in self.anchors(edge) {
                anchored[on as usize].push(edge);
            }
        }
        self.incident = incident;
        self.anchored = anchored;
    }

    /// `edges`, and the slots of the edges that end on any of them, each once, in ascending order:
    /// what a removal of those edges takes along, and what a move of their paths moves
    /// (API-edges-dock-nodes-or-edges, *Ends*; REN-moving-layer-moves-content).
    pub(super) fn with_anchored(&self, mut edges: Vec<u32>) -> Vec<u32> {
        let count = edges.len();
        for i in 0..count {
            edges.extend_from_slice(&self.anchored[edges[i] as usize]);
        }
        edges.sort_unstable();
        edges.dedup();
        edges
    }

    /// The slots of the edges in `slots`, each once in the order first named, then of every other
    /// edge that ends on one of them, in ascending order: what a removal of those edges would take
    /// along, named before anything is removed (API-edges-dock-nodes-or-edges, *Ends*). A slot
    /// that holds no edge refuses the call.
    pub fn edge_removal(&self, slots: &[u32]) -> Result<Vec<u32>, SlotError> {
        self.edges_held(slots)?;
        let mut seen = std::collections::HashSet::with_capacity(slots.len());
        let mut named: Vec<u32> = slots.iter().copied().filter(|&s| seen.insert(s)).collect();
        let mut anchored: Vec<u32> = self
            .with_anchored(named.clone())
            .into_iter()
            .filter(|edge| !seen.contains(edge))
            .collect();
        named.append(&mut anchored);
        Ok(named)
    }

    /// The slots of the edges at the nodes in `slots`, each once, in ascending order: what a
    /// removal of those nodes would take along, named before anything is removed
    /// (ARCH-engine-edits-graph-in-place). A slot that holds no node refuses the call.
    pub fn edges_at(&self, slots: &[u32]) -> Result<Vec<u32>, SlotError> {
        self.nodes_held(slots)?;
        let mut edges: Vec<u32> = slots
            .iter()
            .flat_map(|&s| self.incident[s as usize].iter().copied())
            .collect();
        edges.sort_unstable();
        edges.dedup();
        Ok(edges)
    }

    /// Adds the edge `spec` and returns its slot: the free slot freed last, or a new one after the
    /// highest. It goes into the lists of its ends and into the index in place, which the rule of
    /// ARCH-engine-edits-graph-in-place then builds again where it asks for it. An end on a slot
    /// that holds no node, or no edge, refuses the edge, and so does an end on an edge that itself
    /// ends on an edge (API-edges-dock-nodes-or-edges, *Ends*); a slot past those a `u32` numbers
    /// refuses it as it refuses a node. Either way, nothing changes.
    pub fn add_edge(&mut self, spec: EdgeSpec) -> Result<u32, AddEdgeError> {
        let ends = [(Which::Source, spec.source), (Which::Target, spec.target)];
        let nodes: Vec<u32> = ends.iter().filter_map(|(_, end)| end.node()).collect();
        self.nodes_held(&nodes)?;
        let edges: Vec<u32> = ends.iter().filter_map(|(_, end)| end.edge()).collect();
        self.edges_held(&edges)?;
        for (which, end) in ends {
            if end
                .edge()
                .is_some_and(|on| self.anchors(on).next().is_some())
            {
                return Err(AddEdgeError::OnEdgeEnd(which));
            }
        }
        let slot = self.edge_slots.take()?;
        let i = slot as usize;
        put(&mut self.pills, i, vec![None; spec.labels.len()]);
        put(&mut self.edges, i, spec);
        put(&mut self.anchored, i, Vec::new());
        for end in self.ends(slot).collect::<Vec<_>>() {
            self.incident[end as usize].push(slot);
        }
        for on in self.anchors(slot).collect::<Vec<_>>() {
            self.anchored[on as usize].push(slot);
        }
        self.place_edge(slot);
        self.keep_index();
        Ok(slot)
    }

    /// The edge in `slot`, its ends, label placements, and style, where the slot holds one.
    pub fn edge(&self, slot: u32) -> Option<&EdgeSpec> {
        self.holds_edge(slot).then(|| &self.edges[slot as usize])
    }

    /// Gives the edge in `slot` the label placements `labels`, the whole list, its pills unmeasured
    /// again, the style `style`, and the sides `sides`, and places it again in place
    /// (ARCH-engine-edits-graph-in-place, API-edges-dock-nodes-or-edges). A slot that holds no
    /// edge refuses the change.
    pub fn update_edge(
        &mut self,
        slot: u32,
        labels: Vec<LabelPlacement>,
        style: EdgeStyle,
        sides: Sides,
    ) -> Result<(), SlotError> {
        self.edges_held(&[slot])?;
        self.pills[slot as usize] = vec![None; labels.len()];
        let spec = &mut self.edges[slot as usize];
        spec.labels = labels;
        spec.style = style;
        spec.sides = sides;
        self.place_edge(slot);
        self.keep_index();
        Ok(())
    }

    /// Removes the edges in `slots` and every edge that ends on one of them, and returns the slots
    /// of all of them as `edge_removal` names them (API-edges-dock-nodes-or-edges, *Ends*). Their
    /// slots go onto the free list in that order, and they leave the index and the lists of edges
    /// at their ends (ARCH-engine-edits-graph-in-place). A slot that holds no edge refuses the
    /// call, which then changes nothing.
    pub fn remove_edges(&mut self, slots: &[u32]) -> Result<Vec<u32>, SlotError> {
        let removed = self.edge_removal(slots)?;
        // A removal builds nothing: the index is built again after growth and moves
        // (ARCH-engine-edits-graph-in-place).
        self.free_edges_at(&removed);
        Ok(removed)
    }

    /// Frees the edges in `slots`, each that holds an edge once, and takes them out of the lists
    /// of the nodes in use at their ends and of the edges in use they end on, each list once, so
    /// that a node of many edges costs its edges once and not once per edge. The caller names
    /// every edge that ends on one of them too.
    pub(super) fn free_edges_at(&mut self, slots: &[u32]) {
        let mut touched = Vec::new();
        let mut on = Vec::new();
        for &slot in slots {
            if !self.edge_slots.free(slot) {
                continue;
            }
            self.pills[slot as usize] = Vec::new();
            self.anchored[slot as usize] = Vec::new();
            touched.extend(self.ends(slot).filter(|&end| self.holds_node(end)));
            on.extend(self.anchors(slot).filter(|&edge| self.holds_edge(edge)));
        }
        self.edge_grid.take(slots);
        touched.sort_unstable();
        touched.dedup();
        for end in touched {
            let edge_slots = &self.edge_slots;
            self.incident[end as usize].retain(|&e| edge_slots.holds(e));
        }
        on.sort_unstable();
        on.dedup();
        for edge in on {
            let edge_slots = &self.edge_slots;
            self.anchored[edge as usize].retain(|&e| edge_slots.holds(e));
        }
    }

    /// The path of the edge `spec` from the current positions and the paths of the edges it ends
    /// on (API-edges-dock-nodes-or-edges): a loop's where it leads its node back to itself, else
    /// from end to end. An end on a node docks as its side says, towards the other end's node's
    /// centre or the point of the other end on an edge; an end on an edge lies on that edge's path,
    /// pulling out towards the other end. Between a container and a node it holds, at any depth,
    /// both on the outline, the path runs inside the container along the line from its centre
    /// through the held node's (`held_ends`, `EdgePath::inward`); with a side on one end, where the
    /// two share a centre, each end looks to the right of it.
    fn path_of(&self, spec: &EdgeSpec) -> EdgePath {
        if let (End::Node(source), End::Node(target)) = (spec.source, spec.target)
            && source == target
        {
            return EdgePath::looped(
                &self.node_bounds(source),
                self.shape(source),
                spec.sides.source,
            );
        }
        if let (End::Node(source), End::Node(target)) = (spec.source, spec.target)
            && spec.sides.source == Dock::Outline
            && spec.sides.target == Dock::Outline
        {
            if self.lies_in(target, source) {
                let (outer, inner) = self.held_ends(source, target);
                return EdgePath::inward(outer, inner);
            }
            if self.lies_in(source, target) {
                let (outer, inner) = self.held_ends(target, source);
                return EdgePath::inward(inner, outer);
            }
        }
        let at = |end: End| match end {
            End::Node(node) => centre(&self.node_bounds(node)),
            End::Edge { slot, t } => self.paths[slot as usize].point_at(t),
        };
        let (mut towards_target, mut towards_source) = (at(spec.target), at(spec.source));
        if let (End::Node(source), End::Node(target)) = (spec.source, spec.target)
            && towards_target == towards_source
            && (self.lies_in(source, target) || self.lies_in(target, source))
        {
            towards_target.x += 1.0;
            towards_source.x += 1.0;
        }
        let on_node = |end: End, dock, towards| {
            end.node().map(|node| {
                let shape = self.shape(node);
                end_of(dock, &self.node_bounds(node), shape, towards)
            })
        };
        let from = on_node(spec.source, spec.sides.source, towards_target);
        let to = on_node(spec.target, spec.sides.target, towards_source);
        let on_path = |end: End, towards| match end {
            End::Edge { slot, t } => on_edge(&self.paths[slot as usize], t, towards),
            End::Node(_) => unreachable!("an end on a node docked above"),
        };
        let from = from.unwrap_or_else(|| on_path(spec.source, to.map_or(towards_target, |e| e.0)));
        let to = to.unwrap_or_else(|| on_path(spec.target, from.0));
        EdgePath::joining(from, to)
    }

    /// The ends on the outline of an edge between the container in `container` and the node in
    /// `held` it holds, at any depth (API-edges-dock-nodes-or-edges, *An end on a container toward
    /// a node it holds*): the container's where the line from its centre through the held node's,
    /// continued, crosses its outline, and the held node's where that line crosses the held node's
    /// outline towards the container's end; the line runs to the right where the two centres
    /// coincide.
    fn held_ends(&self, container: u32, held: u32) -> (Point, Point) {
        let (outer, inner) = (self.node_bounds(container), self.node_bounds(held));
        let (c, h) = (centre(&outer), centre(&inner));
        let (dx, dy) = if c == h {
            (1.0, 0.0)
        } else {
            (h.x - c.x, h.y - c.y)
        };
        let towards = |from: Point| Point::new(from.x + dx, from.y + dy);
        let (end, _) = end_of(Dock::Outline, &outer, self.shape(container), towards(c));
        let (inner_end, _) = end_of(Dock::Outline, &inner, self.shape(held), towards(h));
        (end, inner_end)
    }

    /// The path, its bounds, a lightning bolt's turns among them, and the point of each label of
    /// the edge in `slot` from the current positions (`path_of`).
    pub(super) fn placement(&self, slot: u32) -> (EdgePath, Rect, Vec<Point>) {
        #[cfg(test)]
        self.placements.set(self.placements.get() + 1);
        let spec = &self.edges[slot as usize];
        let path = self.path_of(spec);
        let labels = spec
            .labels
            .iter()
            .map(|label| path.label_position(label.t, label.offset))
            .collect();
        // A lightning bolt's turns lie off the path, and the bounds take them in, so that the
        // query, the index, and the hit test find the edge there (API-edges-dock-nodes-or-edges).
        let mut bounds = path.bounds();
        if spec.style.lightning {
            let (_, turns, _) = path.lightning();
            for turn in turns {
                bounds = bounds.union(&Rect::at(turn));
            }
        }
        (path, bounds, labels)
    }

    /// Computes the path, bounds, and label points of every edge, as a load does, once, before
    /// the index is built from them: the edges whose ends lie on nodes first, then those that end
    /// on one of them. Every later edit places the edges it changes itself.
    pub(super) fn place_edges(&mut self) {
        let count = self.edge_slots.count();
        let on_nodes = |graph: &Self, e: u32| graph.anchors(e).next().is_none();
        (self.paths, self.bounds, self.labels) = (
            Vec::with_capacity(count as usize),
            Vec::with_capacity(count as usize),
            Vec::with_capacity(count as usize),
        );
        for e in 0..count {
            // An edge that ends on an edge is placed once every edge it may end on is.
            let (path, bounds, labels) = if on_nodes(self, e) {
                self.placement(e)
            } else {
                (EdgePath::default(), Rect::at(Point::default()), Vec::new())
            };
            self.paths.push(path);
            self.bounds.push(bounds);
            self.labels.push(labels);
        }
        for e in 0..count {
            if on_nodes(self, e) {
                continue;
            }
            let (path, bounds, labels) = self.placement(e);
            let i = e as usize;
            (self.paths[i], self.bounds[i], self.labels[i]) = (path, bounds, labels);
        }
    }

    /// Whether the nesting of the nodes of the edge in `slot` may decide its path (`path_of`): it
    /// runs between two nodes that both dock on the outline or that share a centre.
    fn nesting_places(&self, slot: u32) -> bool {
        let spec = &self.edges[slot as usize];
        if let (End::Node(source), End::Node(target)) = (spec.source, spec.target) {
            let outline = spec.sides.source == Dock::Outline && spec.sides.target == Dock::Outline;
            source != target
                && (outline
                    || centre(&self.node_bounds(source)) == centre(&self.node_bounds(target)))
        } else {
            false
        }
    }

    /// Places again the edges at the nodes in `nodes` whose path the nesting of their nodes may
    /// decide, once one of them has moved into a container or out of one (`path_of`).
    pub(super) fn place_nested_at(&mut self, nodes: &[u32]) {
        let mut edges: Vec<u32> = nodes
            .iter()
            .flat_map(|&node| self.incident[node as usize].iter().copied())
            .filter(|&e| self.nesting_places(e))
            .collect();
        edges.sort_unstable();
        edges.dedup();
        for edge in edges {
            self.place_edge(edge);
        }
    }

    /// Computes the path and labels of the edge in `slot`, an edge taken into a new slot among
    /// them, and puts it into the edge grid there; and so of every edge that ends on it, whose
    /// ends follow its path (API-edges-dock-nodes-or-edges, *An end on an edge*).
    pub(super) fn place_edge(&mut self, slot: u32) {
        self.place_one(slot);
        if let Some(anchored) = self.anchored.get_mut(slot as usize) {
            let anchored = std::mem::take(anchored);
            for &edge in &anchored {
                self.place_one(edge);
            }
            self.anchored[slot as usize] = anchored;
        }
    }

    /// Computes the path and labels of the edge in `slot` alone, and puts it into the edge grid.
    fn place_one(&mut self, slot: u32) {
        let (path, bounds, labels) = self.placement(slot);
        let i = slot as usize;
        put(&mut self.paths, i, path);
        put(&mut self.bounds, i, bounds);
        put(&mut self.labels, i, labels);
        self.reindex_edge(slot);
    }

    /// The path of the edge in `slot`, as the tests outside the graph read it.
    #[cfg(test)]
    pub(crate) fn path(&self, slot: u32) -> EdgePath {
        self.paths[slot as usize]
    }

    /// Writes into `out`, after clearing it, the ends of the edges in `slots` as they lie now:
    /// per edge the point it leaves its source and the point it enters its target, `x, y` each,
    /// and NaN for a slot that holds no edge, beyond the slots or free, so that the pairs stay in
    /// step with `slots`.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "an end is the middle of a side of a node or a point of its outline, within the \
                  node, whose position and size the engine keeps as f32; the ends cross without \
                  an origin, rounded by their distance from the world's origin (API-bridge-takes-serde-and-columns); a \
                  node lies within `WORLD_LIMIT`, its far side included, so an end does too, \
                  far within f32"
    )]
    pub fn edge_ends(&self, slots: &[u32], out: &mut Vec<f32>) {
        out.clear();
        for &slot in slots {
            match self
                .paths
                .get(slot as usize)
                .filter(|_| self.holds_edge(slot))
            {
                Some(path) => out.extend([
                    path.source.x as f32,
                    path.source.y as f32,
                    path.target.x as f32,
                    path.target.y as f32,
                ]),
                None => out.extend([f32::NAN; 4]),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{Lcg, drawn_bounds, paired, path_of, random_graph};
    use super::super::{GraphError, TooManySlots};
    use super::*;

    #[test]
    fn an_edge_from_a_node_to_itself_is_placed_as_a_loop_and_follows_its_node() {
        // Verifies: API-edges-dock-side-or-outline
        // A loop on `a` of each dock, labelled at the middle parameter, and an edge from `a` to
        // `b`: the loop is drawn on the side it names, the top for the outline, by a load, an
        // addition, a move, and a change of node shape, which its ends follow onto the outline,
        // its label at its outermost point.
        use crate::geometry::{Dock, Side};
        use crate::shape::NodeShape;
        let looped = |sides: Sides| EdgeSpec {
            sides,
            source: End::Node(0),
            target: End::Node(0),
            labels: vec![LabelPlacement {
                t: 0.5,
                offset: 0.0,
            }],
            style: EdgeStyle::unstyled(),
        };
        let on = |dock: Dock| Sides {
            source: dock,
            target: Dock::Outline,
        };
        let mut graph = Graph::new(
            vec![0.0, 0.0, 400.0, 0.0],
            vec![200.0, 40.0, 100.0, 40.0],
            vec![
                looped(on(Dock::Outline)),
                EdgeSpec {
                    sides: Sides::default(),
                    source: End::Node(0),
                    target: End::Node(1),
                    labels: Vec::new(),
                    style: EdgeStyle::unstyled(),
                },
            ],
        )
        .unwrap();
        for side in [Side::Top, Side::Right, Side::Bottom, Side::Left] {
            graph.add_edge(looped(on(side.into()))).unwrap();
        }
        let check = |graph: &Graph, shape: NodeShape, context: &str| {
            let node = graph.node_bounds(0);
            let docks = [Dock::Outline, Side::Top.into(), Side::Right.into()];
            let docks = docks
                .into_iter()
                .chain([Side::Bottom.into(), Side::Left.into()]);
            for (slot, dock) in [0, 2, 3, 4, 5].into_iter().zip(docks) {
                let path = EdgePath::looped(&node, shape, dock);
                assert_eq!(graph.paths[slot], path, "{context}: edge {slot}");
                assert_eq!(graph.bounds[slot], path.bounds(), "{context}: edge {slot}");
                assert_eq!(graph.labels[slot], [path.point_at(0.5)], "{context}");
            }
        };
        check(&graph, NodeShape::Rectangle, "loaded and added");
        graph.translate(&[0], 37.0, -1200.0).unwrap();
        check(&graph, NodeShape::Rectangle, "moved");
        graph.set_shape(0, NodeShape::Ellipse).unwrap();
        check(&graph, NodeShape::Ellipse, "shaped");
    }

    /// Three nodes, `a` at the origin, `b` to its right and below, `c` above them, an extend from
    /// `a` to `b` in slot 1, an anchor from `c` onto the middle of the extend in slot 0, loaded
    /// before the edge it ends on, and an edge in slot 2 between two points of the extend
    /// (API-edges-dock-nodes-or-edges, *An end on an edge*).
    fn anchored_graph() -> Graph {
        let edge = |source, target| EdgeSpec {
            sides: Sides::default(),
            source,
            target,
            labels: vec![LabelPlacement {
                t: 0.5,
                offset: 0.0,
            }],
            style: EdgeStyle::unstyled(),
        };
        let on = |slot, t| End::Edge { slot, t };
        Graph::new(
            vec![0.0, 0.0, 400.0, 200.0, 180.0, -300.0],
            vec![100.0, 40.0, 100.0, 40.0, 120.0, 60.0],
            vec![
                edge(End::Node(2), on(1, 0.5)),
                edge(End::Node(0), End::Node(1)),
                edge(on(1, 0.2), on(1, 0.9)),
            ],
        )
        .unwrap()
    }

    /// Asserts that the ends of the anchor and of the edge between two points of the extend lie
    /// on the extend's path at their path parameters, the anchor's control point on the normal
    /// there on the side of `c`, within Q-4's precision: to the bit, since both are computed from
    /// the extend's path as it is kept.
    fn assert_anchored(graph: &Graph, context: &str) {
        let extend = graph.paths[1];
        let (anchor, between) = (graph.paths[0], graph.paths[2]);
        assert_eq!(anchor.target, extend.point_at(0.5), "{context}");
        let tangent = extend.tangent_at(0.5);
        let pull = Point::new(
            anchor.control_target.x - anchor.target.x,
            anchor.control_target.y - anchor.target.y,
        );
        let scale = anchor.target.x.abs().max(anchor.target.y.abs()).max(1.0);
        assert!(
            (pull.x * tangent.x + pull.y * tangent.y).abs() <= 1e-9 * scale,
            "{context}"
        );
        let towards_c = Point::new(
            anchor.source.x - anchor.target.x,
            anchor.source.y - anchor.target.y,
        );
        assert!(
            pull.x * towards_c.x + pull.y * towards_c.y > 0.0,
            "{context}"
        );
        assert_eq!(
            (between.source, between.target),
            (extend.point_at(0.2), extend.point_at(0.9)),
            "{context}"
        );
        for slot in 0..3 {
            let (path, bounds, labels) = graph.placement(slot);
            assert_eq!(graph.paths[slot as usize], path, "{context}: {slot}");
            assert_eq!(graph.bounds[slot as usize], bounds, "{context}: {slot}");
            assert_eq!(graph.labels[slot as usize], labels, "{context}: {slot}");
        }
    }

    #[test]
    fn an_end_on_an_edge_lies_on_its_path_at_its_parameter_and_follows_it_as_its_nodes_move() {
        // Verifies: API-edges-dock-nodes-or-edges, REN-moving-layer-moves-content, Q-4
        // Loaded with the anchor before the extend, then after each move of a use case at either
        // end, backwards past the other and far from the origin, a change of node shape, of the
        // extend's sides and labels, and an anchor added onto the extend.
        use crate::shape::NodeShape;
        let mut graph = anchored_graph();
        assert_anchored(&graph, "loaded");
        graph.translate(&[0], 37.0, -120.0).unwrap();
        assert_anchored(&graph, "source moved");
        graph.translate(&[1], -900.0, 15.0).unwrap();
        assert_anchored(&graph, "target moved behind the source");
        graph.translate(&[0, 1, 2], 4.0e8, -3.0e8).unwrap();
        assert_anchored(&graph, "far from the origin");
        graph.set_shape(1, NodeShape::Ellipse).unwrap();
        let outline = Sides {
            source: crate::geometry::Dock::Outline,
            target: crate::geometry::Dock::Outline,
        };
        graph
            .update_edge(1, Vec::new(), EdgeStyle::unstyled(), outline)
            .unwrap();
        assert_anchored(&graph, "reshaped and docked anew");
        let added = graph
            .add_edge(EdgeSpec {
                sides: Sides::default(),
                source: End::Edge { slot: 1, t: 0.75 },
                target: End::Node(2),
                labels: Vec::new(),
                style: EdgeStyle::unstyled(),
            })
            .unwrap();
        assert_eq!(
            graph.paths[added as usize].source,
            graph.paths[1].point_at(0.75)
        );
        graph.translate(&[1], 10.0, 10.0).unwrap();
        assert_eq!(
            graph.paths[added as usize].source,
            graph.paths[1].point_at(0.75)
        );
        assert_anchored(&graph, "an anchor added");
    }

    #[test]
    fn an_end_on_an_edge_of_an_edge_on_itself_or_on_a_slot_without_an_edge_is_refused() {
        // Verifies: API-edges-dock-nodes-or-edges
        let spec = |source, target| EdgeSpec {
            sides: Sides::default(),
            source,
            target,
            labels: Vec::new(),
            style: EdgeStyle::unstyled(),
        };
        let on = |slot, t| End::Edge { slot, t };
        let mut graph = anchored_graph();
        // Onto the anchor, which ends on the extend; onto the edge between two of its points.
        for (source, target, which) in [
            (End::Node(2), on(0, 0.5), Which::Target),
            (on(2, 0.1), End::Node(0), Which::Source),
            (on(1, 0.5), on(0, 0.5), Which::Target),
        ] {
            assert_eq!(
                graph.add_edge(spec(source, target)),
                Err(AddEdgeError::OnEdgeEnd(which))
            );
        }
        graph.remove_edges(&[2]).unwrap();
        assert_eq!(
            graph.add_edge(spec(End::Node(0), on(2, 0.5))),
            Err(SlotError::NoEdge { slot: 2 }.into())
        );
        assert_eq!(
            graph.add_edge(spec(on(9, 0.5), End::Node(0))),
            Err(SlotError::NoEdge { slot: 9 }.into())
        );
        assert_eq!(graph.edge_slots.count(), 3);
        // A load of an edge on itself, of a chain, and of two edges on each other.
        let positions = vec![0.0, 0.0, 300.0, 0.0];
        let sizes = vec![100.0, 40.0, 100.0, 40.0];
        let base = || spec(End::Node(0), End::Node(1));
        for (edges, edge) in [
            (vec![base(), spec(End::Node(0), on(1, 0.5))], 1),
            (
                vec![
                    base(),
                    spec(End::Node(0), on(0, 0.5)),
                    spec(on(1, 0.5), End::Node(1)),
                ],
                2,
            ),
            (
                vec![
                    spec(End::Node(0), on(1, 0.5)),
                    spec(on(0, 0.3), End::Node(1)),
                ],
                0,
            ),
        ] {
            assert_eq!(
                Graph::new(positions.clone(), sizes.clone(), edges).err(),
                Some(GraphError::EdgeEndOnEdgeEnd { edge })
            );
        }
        assert_eq!(
            Graph::new(
                positions,
                sizes,
                vec![base(), spec(End::Node(0), on(2, 0.5))]
            )
            .err(),
            Some(GraphError::EdgeEndOutOfRange { edge: 1 })
        );
    }

    #[test]
    fn a_drag_of_a_node_redraws_its_edges_and_the_edges_that_end_on_them() {
        // Verifies: REN-moving-layer-moves-content, API-edges-dock-nodes-or-edges
        let mut graph = anchored_graph();
        // A drag of a use case at the extend's end redraws the extend and what ends on it.
        let at = crate::graph::MeshAt {
            rect: Rect::new(-1.0e3, -1.0e3, 1.0e3, 1.0e3),
            level: crate::graph::Level::Near,
            pixel: 1.0,
            origin: Point::default(),
        };
        let (mut edges, mut mesh) = (Vec::new(), crate::stroke::Mesh::default());
        graph
            .mesh_at(&[1], &[], &at, &mut edges, &mut mesh)
            .unwrap();
        assert_eq!(edges, [0, 1, 2]);
    }

    #[test]
    fn a_removal_names_the_edges_that_end_on_the_edges_it_takes_before_anything_goes() {
        // Verifies: API-edges-dock-nodes-or-edges
        let graph = anchored_graph();
        assert_eq!(graph.edge_removal(&[1]), Ok(vec![1, 0, 2]));
        assert_eq!(graph.edge_removal(&[0]), Ok(vec![0]));
        assert_eq!(
            graph.removal(&[0]).map(|(_, edges)| edges),
            Ok(vec![0, 1, 2])
        );
        assert_eq!(graph.removal(&[2]).map(|(_, edges)| edges), Ok(vec![0]));
    }

    #[test]
    fn removing_an_edge_or_a_node_takes_the_edges_that_end_on_its_edges_along() {
        // Verifies: API-edges-dock-nodes-or-edges
        let mut graph = anchored_graph();
        // The anchor alone goes alone, and leaves the extend's list.
        assert_eq!(graph.remove_edges(&[0]), Ok(vec![0]));
        assert_eq!(graph.anchored[1], [2]);
        assert_eq!(graph.remove_edges(&[1]), Ok(vec![1, 2]));
        assert_eq!(graph.edges_in_use(), 0);
        assert!(graph.incident.iter().all(Vec::is_empty));
        assert!(graph.anchored.iter().all(Vec::is_empty));
        let mut graph = anchored_graph();
        assert_eq!(graph.remove_edges(&[2, 0]), Ok(vec![2, 0]));
        assert!(graph.anchored[1].is_empty());
        let mut graph = anchored_graph();
        assert_eq!(graph.remove_nodes(&[1]), Ok((vec![1], vec![0, 1, 2])));
        assert_eq!(graph.edges_in_use(), 0);
        assert!(graph.anchored.iter().all(Vec::is_empty));
    }

    #[test]
    fn the_bounds_kept_per_edge_are_those_of_its_path_after_moves() {
        let mut rng = Lcg(11);
        let mut graph = random_graph(&mut rng, 200, 300);
        for _ in 0..60 {
            let moved: Vec<u32> = (0..3).map(|_| rng.below(200)).collect();
            let (dx, dy) = (rng.range(-500.0, 500.0), rng.range(-500.0, 500.0));
            graph.translate(&moved, dx as f32, dy as f32).unwrap();
        }
        for e in 0..graph.edge_slots.count() {
            let spec = &graph.edges[e as usize];
            let fresh = path_of(
                spec,
                &graph.node_bounds(spec.nodes().0),
                &graph.node_bounds(spec.nodes().1),
            );
            let fresh = drawn_bounds(spec, &fresh);
            assert_eq!(graph.bounds[e as usize], fresh, "edge {e}");
        }
    }

    #[test]
    fn the_ends_of_unknown_slots_keep_their_place() {
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
            source: End::Node(0),
            target: End::Node(1),
            labels: Vec::new(),
            style: EdgeStyle::unstyled(),
        }];
        let graph = Graph::new(
            vec![0.0, 0.0, 300.0, 100.0],
            vec![220.0, 64.0, 220.0, 64.0],
            edges,
        )
        .unwrap();
        let mut ends = Vec::new();
        graph.edge_ends(&[7, 0], &mut ends);
        assert!(ends[..4].iter().all(|v| v.is_nan()));
        assert_eq!(&ends[4..], [220.0, 32.0, 300.0, 132.0]);
    }

    #[test]
    fn an_edge_to_a_slot_that_holds_no_node_or_a_change_of_a_free_edge_is_refused() {
        // Verifies: ARCH-engine-edits-graph-in-place
        let mut graph = paired(4);
        graph.remove_nodes(&[7]).unwrap();
        let spec = |source, target| EdgeSpec {
            sides: Sides::default(),
            source,
            target,
            labels: Vec::new(),
            style: EdgeStyle::unstyled(),
        };
        let edges = graph.edge_slots.count();
        assert_eq!(
            graph.add_edge(spec(End::Node(0), End::Node(7))),
            Err(SlotError::NoNode { slot: 7 }.into())
        );
        assert_eq!(
            graph.add_edge(spec(End::Node(5_000), End::Node(0))),
            Err(SlotError::NoNode { slot: 5_000 }.into())
        );
        assert_eq!(graph.edge_slots.count(), edges);
        assert_eq!(
            graph.update_edge(3, Vec::new(), EdgeStyle::unstyled(), Sides::default()),
            Err(SlotError::NoEdge { slot: 3 })
        );
        assert_eq!(graph.edge(3), None);
        // The freed edge slot is the next addition's.
        assert_eq!(graph.add_edge(spec(End::Node(0), End::Node(2))), Ok(3));
        assert_eq!(graph.add_edge(spec(End::Node(2), End::Node(0))), Ok(4));
    }

    #[test]
    fn an_edge_past_the_slots_a_u32_numbers_is_refused_as_a_node_past_them_and_nothing_changes() {
        // Verifies: ARCH-engine-edits-graph-in-place
        let spec = EdgeSpec {
            sides: Sides::default(),
            source: End::Node(0),
            target: End::Node(1),
            labels: Vec::new(),
            style: EdgeStyle::unstyled(),
        };
        let mut graph = paired(4);
        graph.node_slots.set_count(u32::MAX);
        assert_eq!(graph.add_node(0.0, 0.0, 5.0, 5.0), Err(TooManySlots));
        let mut graph = paired(4);
        graph.edge_slots.set_count(u32::MAX);
        assert_eq!(
            graph.add_edge(spec),
            Err(AddEdgeError::TooManySlots(TooManySlots))
        );
        assert_eq!((graph.edges.len(), graph.paths.len()), (4, 4));
        assert_eq!(
            (&graph.incident[0], &graph.incident[1]),
            (&vec![0], &vec![0])
        );
    }
}
