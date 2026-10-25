//! The edges of the graph: the lists of the edges at each node, an addition into the free slot
//! freed last or a new one, a change of an edge's label placement, style, and sides, a removal,
//! and the path of each edge, its bounds, and the point of its label (ADR-0022, ADR-0024).

use super::slots::put;
use super::{AddEdgeError, EdgeSpec, Graph, LabelPlacement, SlotError};
use crate::geometry::{EdgePath, Point, Rect, Sides};
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
    /// one check of the edge slots a call names (ADR-0022).
    pub(super) fn edges_held(&self, slots: &[u32]) -> Result<(), SlotError> {
        match slots.iter().find(|&&s| !self.holds_edge(s)) {
            Some(&slot) => Err(SlotError::NoEdge { slot }),
            None => Ok(()),
        }
    }

    /// The node slots at the ends of the edge in `slot`, each once.
    pub(super) fn ends(&self, slot: u32) -> impl Iterator<Item = u32> {
        let edge = self.edges[slot as usize];
        std::iter::once(edge.source).chain((edge.target != edge.source).then_some(edge.target))
    }

    /// Builds the lists of edges at each node.
    pub(super) fn link(&mut self) {
        let mut incident = vec![Vec::new(); self.node_slots.count() as usize];
        for edge in 0..self.edge_slots.count() {
            for end in self.ends(edge) {
                incident[end as usize].push(edge);
            }
        }
        self.incident = incident;
    }

    /// The slots of the edges at the nodes in `slots`, each once, in ascending order: what a
    /// removal of those nodes would take along, named before anything is removed (ADR-0022). A
    /// slot that holds no node refuses the call.
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
    /// ADR-0022 then builds again where it asks for it. An end that holds no node refuses the
    /// edge, and a slot past those a `u32` numbers refuses it as it refuses a node; either way,
    /// nothing changes.
    pub fn add_edge(&mut self, spec: EdgeSpec) -> Result<u32, AddEdgeError> {
        self.nodes_held(&[spec.source, spec.target])?;
        let slot = self.edge_slots.take()?;
        let i = slot as usize;
        put(&mut self.edges, i, spec);
        put(&mut self.pills, i, None);
        for end in self.ends(slot).collect::<Vec<_>>() {
            self.incident[end as usize].push(slot);
        }
        self.place_edge(slot);
        self.keep_index();
        Ok(slot)
    }

    /// The edge in `slot`, its ends, label placement, and style, where the slot holds one.
    pub fn edge(&self, slot: u32) -> Option<EdgeSpec> {
        self.holds_edge(slot).then(|| self.edges[slot as usize])
    }

    /// Gives the edge in `slot` the label placement `label`, the style `style`, and the sides
    /// `sides`, and places it again in place (ADR-0022, ADR-0024). A slot that holds no edge
    /// refuses the change.
    pub fn update_edge(
        &mut self,
        slot: u32,
        label: Option<LabelPlacement>,
        style: EdgeStyle,
        sides: Sides,
    ) -> Result<(), SlotError> {
        self.edges_held(&[slot])?;
        let spec = &mut self.edges[slot as usize];
        spec.label = label;
        spec.style = style;
        spec.sides = sides;
        self.place_edge(slot);
        self.keep_index();
        Ok(())
    }

    /// Removes the edges in `slots`. Their slots go onto the free list, the one named last freed
    /// last, and they leave the index and the lists of edges at their ends (ADR-0022). A slot that
    /// holds no edge refuses the call, which then changes nothing.
    pub fn remove_edges(&mut self, slots: &[u32]) -> Result<(), SlotError> {
        self.edges_held(slots)?;
        // A removal builds nothing: the index is built again after growth and moves (ADR-0022).
        self.free_edges_at(slots);
        Ok(())
    }

    /// Frees the edges in `slots`, each that holds an edge once, and takes them out of the lists
    /// of the nodes in use at their ends, each list once, so that a node of many edges costs its
    /// edges once and not once per edge.
    pub(super) fn free_edges_at(&mut self, slots: &[u32]) {
        let mut touched = Vec::new();
        for &slot in slots {
            if !self.edge_slots.free(slot) {
                continue;
            }
            self.pills[slot as usize] = None;
            touched.extend(self.ends(slot).filter(|&end| self.holds_node(end)));
        }
        self.edge_grid.take(slots);
        touched.sort_unstable();
        touched.dedup();
        for end in touched {
            let edge_slots = &self.edge_slots;
            self.incident[end as usize].retain(|&e| edge_slots.holds(e));
        }
    }

    /// The path, its bounds, and the label point of the edge in `slot` from the current positions.
    pub(super) fn placement(&self, slot: u32) -> (EdgePath, Rect, Option<Point>) {
        let spec = self.edges[slot as usize];
        let path = EdgePath::between(
            &self.node_bounds(spec.source),
            &self.node_bounds(spec.target),
            spec.sides,
        );
        let label = spec
            .label
            .map(|label| path.label_position(label.t, label.offset));
        (path, path.bounds(), label)
    }

    /// Computes the path and label of the edge in `slot`, an edge taken into a new slot among
    /// them, and puts it into the edge grid there.
    pub(super) fn place_edge(&mut self, slot: u32) {
        let (path, bounds, label) = self.placement(slot);
        let i = slot as usize;
        put(&mut self.paths, i, path);
        put(&mut self.bounds, i, bounds);
        put(&mut self.labels, i, label);
        self.reindex_edge(slot);
    }

    /// Writes into `out`, after clearing it, the ends of the edges in `slots` as they lie now:
    /// per edge the point it leaves its source and the point it enters its target, `x, y` each,
    /// and NaN for a slot that holds no edge, beyond the slots or free, so that the pairs stay in
    /// step with `slots`.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "an end is the middle of a side of a node, whose position and size the engine \
                  keeps as f32; the ends cross without an origin, rounded by their distance from \
                  the world's origin (ADR-0010); a node lies within `WORLD_LIMIT`, its far side \
                  included, so an end does too, far within f32"
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
    use super::super::GraphError;
    use super::super::tests::{Lcg, paired, random_graph};
    use super::*;

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
            let spec = graph.edges[e as usize];
            let fresh = EdgePath::between(
                &graph.node_bounds(spec.source),
                &graph.node_bounds(spec.target),
                spec.sides,
            )
            .bounds();
            assert_eq!(graph.bounds[e as usize], fresh, "edge {e}");
        }
    }

    #[test]
    fn the_ends_of_unknown_slots_keep_their_place() {
        let edges = vec![EdgeSpec {
            sides: Sides::default(),
            source: 0,
            target: 1,
            label: None,
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
        // Verifies: ADR-0022
        let mut graph = paired(4);
        graph.remove_nodes(&[7]).unwrap();
        let spec = |source, target| EdgeSpec {
            sides: Sides::default(),
            source,
            target,
            label: None,
            style: EdgeStyle::unstyled(),
        };
        let edges = graph.edge_slots.count();
        assert_eq!(
            graph.add_edge(spec(0, 7)),
            Err(SlotError::NoNode { slot: 7 }.into())
        );
        assert_eq!(
            graph.add_edge(spec(5_000, 0)),
            Err(SlotError::NoNode { slot: 5_000 }.into())
        );
        assert_eq!(graph.edge_slots.count(), edges);
        assert_eq!(
            graph.update_edge(3, None, EdgeStyle::unstyled(), Sides::default()),
            Err(SlotError::NoEdge { slot: 3 })
        );
        assert_eq!(graph.edge(3), None);
        // The freed edge slot is the next addition's.
        assert_eq!(graph.add_edge(spec(0, 2)), Ok(3));
        assert_eq!(graph.add_edge(spec(2, 0)), Ok(4));
    }

    #[test]
    fn an_edge_past_the_slots_a_u32_numbers_is_refused_as_a_node_past_them_and_nothing_changes() {
        // Verifies: ADR-0022
        let spec = EdgeSpec {
            sides: Sides::default(),
            source: 0,
            target: 1,
            label: None,
            style: EdgeStyle::unstyled(),
        };
        let mut graph = paired(4);
        graph.node_slots.set_count(u32::MAX);
        assert_eq!(
            graph.add_node(0.0, 0.0, 5.0, 5.0),
            Err(GraphError::TooManySlots)
        );
        let mut graph = paired(4);
        graph.edge_slots.set_count(u32::MAX);
        assert_eq!(
            graph.add_edge(spec),
            Err(AddEdgeError::Graph(GraphError::TooManySlots))
        );
        assert_eq!((graph.edges.len(), graph.paths.len()), (4, 4));
        assert_eq!(
            (&graph.incident[0], &graph.incident[1]),
            (&vec![0], &vec![0])
        );
    }
}
