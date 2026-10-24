//! The nodes of the graph: an addition into the free slot freed last or a new one, with the next
//! rank, so that it is drawn and hit above every other node; a removal, which takes the edges at
//! the nodes along; and a move, which takes them along too (ADR-0022).

use super::slots::put;
use super::{Graph, GraphError, SlotError};
use crate::geometry::{Rect, WORLD_LIMIT};
use crate::positions::{self, PositionError};

impl Graph {
    /// How many node slots hold a node.
    pub fn nodes_in_use(&self) -> u32 {
        self.node_slots.in_use()
    }

    /// Whether `slot` holds a node: a slot below the slots and not free.
    pub(super) fn holds_node(&self, slot: u32) -> bool {
        self.node_slots.holds(slot)
    }

    /// Adds the node at `(x, y)` of size `(width, height)` and returns its slot: the free slot
    /// freed last, or a new one after the highest. It takes the next rank, so that it is drawn and
    /// hit above every other node, and goes into the index in place, which the rule of ADR-0022
    /// then builds again where it asks for it.
    pub fn add_node(&mut self, x: f32, y: f32, width: f32, height: f32) -> Result<u32, GraphError> {
        let rank = self.take_rank();
        let slot = self.node_slots.take()?;
        let i = slot as usize;
        put(&mut self.positions, i * 2, x);
        put(&mut self.positions, i * 2 + 1, y);
        put(&mut self.sizes, i * 2, width);
        put(&mut self.sizes, i * 2 + 1, height);
        put(&mut self.ranks, i, rank);
        // A node added has no edges yet.
        put(&mut self.incident, i, Vec::new());
        self.next_rank += 1;
        let bounds = self.node_bounds(slot);
        self.node_grid.set(slot, &bounds);
        self.keep_index();
        Ok(slot)
    }

    /// The rank the next node added takes, after the ranks in use are numbered again from 0 in
    /// their order where it would pass `u32::MAX`.
    fn take_rank(&mut self) -> u32 {
        if let Ok(rank) = u32::try_from(self.next_rank) {
            return rank;
        }
        let mut order: Vec<u32> = self.node_slots.in_use_slots().collect();
        order.sort_unstable_by_key(|&s| self.ranks[s as usize]);
        let mut next = 0;
        for &s in &order {
            self.ranks[s as usize] = next;
            next += 1;
        }
        self.next_rank = u64::from(next);
        next
    }

    /// The rectangle of the node in `slot`.
    pub(super) fn node_bounds(&self, slot: u32) -> Rect {
        let i = slot as usize * 2;
        Rect::of_node(
            f64::from(self.positions[i]),
            f64::from(self.positions[i + 1]),
            f64::from(self.sizes[i]),
            f64::from(self.sizes[i + 1]),
        )
    }

    /// Removes the nodes in `slots` and every edge at them, and returns the slots of those edges
    /// in ascending order. Their slots go onto the free lists, the one named last freed last, and
    /// they leave the index; nothing else moves (ADR-0022). A slot that holds no node refuses the
    /// call, which then changes nothing.
    pub fn remove_nodes(&mut self, slots: &[u32]) -> Result<Vec<u32>, SlotError> {
        let edges = self.edges_at(slots)?;
        // The nodes go first, so that the edges leave only the lists of the nodes that stay.
        for &slot in slots {
            if self.node_slots.free(slot) {
                self.incident[slot as usize].clear();
            }
        }
        self.node_grid.take(slots);
        // A removal builds nothing: the index is built again after growth and moves (ADR-0022).
        self.free_edges_at(&edges);
        Ok(edges)
    }

    /// Moves the nodes in `slots` by `(dx, dy)` and their edges with them. A refused move changes
    /// nothing. Once more than an eighth of the nodes or edges, and at least 16, reach beyond the
    /// extent the index was built for, the index is built again over the current extent.
    pub fn translate(&mut self, slots: &[u32], dx: f32, dy: f32) -> Result<(), PositionError> {
        // A free slot is refused as a slot beyond the graph (ADR-0022).
        if let Some(&slot) = slots.iter().find(|&&s| !self.holds_node(s)) {
            return Err(PositionError::SlotOutOfRange { slot });
        }
        // Each node stops where it meets the world's limit, so that nothing derived from it turns
        // infinite.
        positions::translate(
            &mut self.positions,
            &self.sizes,
            slots,
            [dx, dy],
            WORLD_LIMIT,
        )?;
        let mut edges = std::mem::take(&mut self.scratch);
        edges.clear();
        for &slot in slots {
            let bounds = self.node_bounds(slot);
            self.node_grid.set(slot, &bounds);
            edges.extend_from_slice(&self.incident[slot as usize]);
        }
        edges.sort_unstable();
        edges.dedup();
        for &edge in &edges {
            self.place_edge(edge);
        }
        self.scratch = edges;
        self.keep_index();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{paired, row};
    use super::super::{EdgeSpec, Level, Visible};
    use super::*;
    use crate::geometry::{Point, Sides};
    use crate::stroke::EdgeStyle;

    #[test]
    fn a_moved_node_takes_its_edges_along() {
        let mut graph = Graph::new(
            vec![0.0, 0.0, 300.0, 0.0, 600.0, 0.0],
            vec![100.0, 50.0, 100.0, 50.0, 100.0, 50.0],
            vec![
                EdgeSpec {
                    sides: Sides::default(),
                    source: 0,
                    target: 1,
                    label: None,
                    style: EdgeStyle::unstyled(),
                },
                EdgeSpec {
                    sides: Sides::default(),
                    source: 1,
                    target: 2,
                    label: None,
                    style: EdgeStyle::unstyled(),
                },
            ],
        )
        .unwrap();
        graph.translate(&[1], 0.0, 5000.0).unwrap();
        let mut ends = Vec::new();
        graph.edge_ends(&[0, 1], &mut ends);
        assert_eq!(&ends[2..6], [300.0, 5025.0, 400.0, 5025.0]);
        let mut out = Visible::default();
        graph.query(
            &Rect::new(250.0, 4900.0, 450.0, 5100.0),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes, [1]);
        assert_eq!(out.edges, [0, 1]);
    }

    #[test]
    fn a_refused_move_changes_nothing() {
        let mut graph = Graph::new(vec![0.0, 0.0], vec![1.0, 1.0], Vec::new()).unwrap();
        assert!(graph.translate(&[1], 1.0, 1.0).is_err());
        assert_eq!(graph.positions(), [0.0, 0.0]);
    }

    #[test]
    fn a_node_of_200_000_edges_is_removed_and_its_edges_leave_every_list_in_linear_time() {
        // Verifies: ADR-0022
        // A hub in slot 0 with an edge to and from each of 100,000 others.
        let count = 100_001u32;
        let positions = (0..count).flat_map(|i| [i as f32, 0.0]).collect();
        let edges = (1..count)
            .flat_map(|i| [(0, i), (i, 0)])
            .map(|(source, target)| EdgeSpec {
                sides: Sides::default(),
                source,
                target,
                label: None,
                style: EdgeStyle::unstyled(),
            })
            .collect();
        let mut graph = Graph::new(positions, vec![1.0; count as usize * 2], edges).unwrap();
        let start = std::time::Instant::now();
        assert_eq!(graph.remove_nodes(&[0]).unwrap().len(), 200_000);
        let hub = start.elapsed();
        let mut graph2 = paired(1_000);
        let all: Vec<u32> = (0..1_000).collect();
        graph2.remove_edges(&all).unwrap();
        assert!(graph.incident.iter().all(Vec::is_empty));
        assert!(graph2.incident.iter().all(Vec::is_empty));
        // Quadratic, the removal would compare some 10^10 pairs; linear, it takes well under this.
        assert!(hub.as_secs_f64() < 5.0, "the hub took {hub:?}");
    }

    #[test]
    fn a_node_added_takes_the_slot_after_the_highest_and_its_place() {
        // Verifies: ADR-0022
        let mut graph = row(3);
        assert_eq!(graph.add_node(500.0, 0.0, 5.0, 5.0), Ok(3));
        assert_eq!(graph.add_node(510.0, 0.0, 5.0, 5.0), Ok(4));
        assert_eq!(&graph.positions()[6..], [500.0, 0.0, 510.0, 0.0]);
        assert_eq!(graph.nodes_in_use(), 5);
        // A node added has no edges: a move of it moves no edge, and of the others none of its.
        graph.translate(&[3, 0], 1.0, 1.0).unwrap();
        assert!(graph.incident.iter().all(Vec::is_empty));
    }

    #[test]
    fn an_addition_takes_the_slot_freed_last_before_a_new_one() {
        // Verifies: ADR-0022
        // The slot named last is freed last, and taken first.
        let mut graph = row(4);
        graph.remove_nodes(&[2, 0]).unwrap();
        assert_eq!(graph.nodes_in_use(), 2);
        assert_eq!(graph.add_node(100.0, 0.0, 5.0, 5.0), Ok(0));
        assert_eq!(graph.add_node(110.0, 0.0, 5.0, 5.0), Ok(2));
        assert_eq!(graph.add_node(120.0, 0.0, 5.0, 5.0), Ok(4));
        assert_eq!(&graph.positions()[..2], [100.0, 0.0]);
        assert_eq!(&graph.sizes[4..6], [5.0, 5.0]);
    }

    #[test]
    fn a_graph_that_never_loaded_takes_a_node_and_finds_it() {
        // Verifies: ADR-0022
        let mut graph = Graph::default();
        assert_eq!(graph.add_node(10.0, 20.0, 50.0, 50.0), Ok(0));
        assert_eq!(graph.node_at(Point::new(30.0, 40.0)), Some(0));
        assert_eq!(graph.node_at(Point::new(5.0, 40.0)), None);
    }

    #[test]
    fn a_node_added_into_a_lower_slot_is_drawn_and_hit_above_the_nodes_it_overlaps() {
        // Verifies: ADR-0022
        // Nodes 0 to 3 overlap at (0, 0); slot 1 is free, so the addition takes it.
        let positions = vec![0.0; 8];
        let mut graph = Graph::new(positions, vec![50.0; 8], Vec::new()).unwrap();
        graph.remove_nodes(&[1]).unwrap();
        let slot = graph.add_node(10.0, 10.0, 50.0, 50.0).unwrap();
        assert_eq!(slot, 1);
        let mut out = Visible::default();
        let rect = Rect::new(0.0, 0.0, 100.0, 100.0);
        graph.query(&rect, Level::Near, 4.0, 0.0, &mut out);
        assert_eq!(out.nodes, [0, 2, 3, 1]);
        assert_eq!(graph.node_at(Point::new(20.0, 20.0)), Some(1));
    }

    #[test]
    fn a_load_ranks_nodes_by_slot() {
        // Verifies: ADR-0022
        let mut graph = Graph::new(vec![0.0; 6], vec![50.0; 6], Vec::new()).unwrap();
        let mut out = Visible::default();
        graph.query(
            &Rect::new(0.0, 0.0, 10.0, 10.0),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes, [0, 1, 2]);
        assert_eq!(graph.node_at(Point::new(5.0, 5.0)), Some(2));
        assert_eq!(graph.add_node(0.0, 0.0, 50.0, 50.0), Ok(3));
        assert_eq!(graph.ranks, [0, 1, 2, 3]);
    }

    #[test]
    fn ranks_are_numbered_again_from_0_in_their_order_before_they_pass_u32_max() {
        // Verifies: ADR-0022
        let mut graph = Graph::new(vec![0.0; 8], vec![50.0; 8], Vec::new()).unwrap();
        graph.ranks = vec![u32::MAX - 1, 7, u32::MAX, 3];
        graph.remove_nodes(&[1]).unwrap();
        graph.next_rank = u64::from(u32::MAX) + 1;
        let slot = graph.add_node(0.0, 0.0, 50.0, 50.0).unwrap();
        assert_eq!(slot, 1);
        // In use, by rank: 3, 0, 2; the new node above them.
        assert_eq!(graph.ranks, [1, 3, 2, 0]);
        assert_eq!(graph.next_rank, 4);
        assert_eq!(graph.add_node(0.0, 0.0, 50.0, 50.0), Ok(4));
        assert_eq!(graph.ranks[4], 4);
        assert_eq!(graph.node_at(Point::new(5.0, 5.0)), Some(4));
    }
}
