//! The spatial index over the graph: a grid each for nodes and edges, built over the slots in use,
//! which edits keep current in place, and the rule that builds it again (ADR-0022, *The spatial
//! index*). A rebuild builds the grids from the edges as they are placed and places none: a load
//! places every edge once, and every edit places the edges it changes before it asks for one.

use super::Graph;
use crate::geometry::Rect;
use crate::spatial::Grid;

/// Whether an index whose grid holds `beyond` of `items` items beyond its extent is to be built
/// again: more than an eighth of them, and at least 16.
fn stale(beyond: usize, items: usize) -> bool {
    beyond > (items / 8).max(16)
}

impl Graph {
    /// Builds the index again where the rule of ADR-0022 asks for it, after every addition and
    /// move: where the slots in use of a kind pass twice the count it was built for, or more than an
    /// eighth of them, and at least 16, lie beyond its extent.
    pub(super) fn keep_index(&mut self) {
        let (nodes, edges) = (self.nodes_in_use(), self.edges_in_use());
        if nodes > self.indexed_nodes.saturating_mul(2)
            || edges > self.indexed_edges.saturating_mul(2)
            || stale(self.node_grid.beyond_extent(), nodes as usize)
            || stale(self.edge_grid.beyond_extent(), edges as usize)
        {
            self.index();
        }
    }

    /// The side of a grid cell: about twice the mean node, and large enough that the grid has
    /// about one cell per node. It affects only how fast a query runs, not which slots it returns:
    /// the grid is exact for any cell side, as the query test against a brute-force scan holds.
    fn cell_side(&self, extent: &Rect) -> f64 {
        let count = f64::from(self.nodes_in_use().max(1));
        let sizes = self.sizes.as_chunks::<2>().0;
        let mean = self
            .node_slots
            .in_use_slots()
            .map(|s| {
                let size = sizes[s as usize];
                f64::from(size[0].max(size[1]))
            })
            .sum::<f64>()
            / count;
        let area = (extent.max_x - extent.min_x) * (extent.max_y - extent.min_y);
        (2.0 * mean).max((area / count).sqrt())
    }

    /// Rebuilds both grids from the current positions of the slots in use and the edges as they
    /// are placed: free slots count for nothing, neither in the extent nor in the cell side, and
    /// stay out of the grids (ADR-0022). It places no edge: a load places every edge before the
    /// first build, and every edit after it places the edges it changes before it asks for one.
    pub(super) fn index(&mut self) {
        #[cfg(test)]
        {
            self.builds += 1;
        }
        self.indexed_nodes = self.nodes_in_use();
        self.indexed_edges = self.edges_in_use();
        let nodes: Vec<(u32, Rect)> = self
            .node_slots
            .in_use_slots()
            .map(|s| (s, self.node_bounds(s)))
            .collect();
        let extent = nodes
            .iter()
            .map(|&(_, bounds)| bounds)
            .reduce(|a, b| a.union(&b))
            .unwrap_or(Rect::new(0.0, 0.0, 1.0, 1.0));
        let cell = self.cell_side(&extent);
        self.node_grid = Grid::new(extent, cell, self.node_slots.count() as usize);
        for (slot, bounds) in &nodes {
            self.node_grid.set(*slot, bounds);
        }
        let edge_slots = self.edge_slots.count();
        self.edge_grid = Grid::new(extent, cell, edge_slots as usize);
        for slot in 0..edge_slots {
            if self.holds_edge(slot) {
                self.reindex_edge(slot);
            }
        }
    }

    /// Puts the edge in `slot` into the edge grid under the bounds of its path and its label point
    /// together.
    pub(super) fn reindex_edge(&mut self, slot: u32) {
        let path = self.bounds[slot as usize];
        let bounds = self.labels[slot as usize].map_or(path, |p| path.union(&Rect::at(p)));
        self.edge_grid.set(slot, &bounds);
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{Lcg, paired, plane, random_graph, row};
    use super::super::{EdgeSpec, Level, Visible};
    use super::*;
    use crate::geometry::{Point, Sides};
    use crate::stroke::EdgeStyle;

    #[test]
    fn a_rebuild_places_no_edge_and_finds_every_edge_placed_as_it_lies() {
        // Verifies: ADR-0022
        let mut rng = Lcg(11);
        let mut graph = random_graph(&mut rng, 200, 300);
        graph.remove_edges(&[5, 9, 40]).unwrap();
        let placed = |graph: &Graph| {
            (0..graph.edge_slots.count())
                .filter(|&e| graph.holds_edge(e))
                .map(|e| {
                    let i = e as usize;
                    (graph.paths[i], graph.bounds[i], graph.labels[i])
                })
                .collect::<Vec<_>>()
        };
        // Nodes moved far, one a move, until the index is built again: each move places the edges
        // at its node, and the rebuild it ends in places none.
        let builds = graph.builds;
        let mut node = 0;
        while graph.builds == builds {
            let before = graph.placements.get();
            graph.translate(&[node], 1e6, 1e6).unwrap();
            let edges = graph.incident[node as usize].len() as u32;
            assert_eq!(graph.placements.get() - before, edges, "node {node}");
            node += 1;
        }
        // What the rebuild left is where every edge lies now.
        let fresh: Vec<_> = (0..graph.edge_slots.count())
            .filter(|&e| graph.holds_edge(e))
            .map(|e| graph.placement(e))
            .collect();
        assert_eq!(placed(&graph), fresh);
        // A rebuild on its own changes no placement and makes none.
        let (before, placements) = (placed(&graph), graph.placements.get());
        graph.index();
        assert_eq!(placed(&graph), before);
        assert_eq!(graph.placements.get(), placements);
    }

    #[test]
    fn nodes_dragged_far_beyond_the_extent_rebuild_the_index() {
        // 200 nodes: the index is rebuilt once more than 200 / 8 = 25 lie beyond its extent.
        let mut graph = row(200);
        let far: Vec<u32> = (0..25).collect();
        graph.translate(&far, 1e6, 1e6).unwrap();
        assert_eq!(
            graph.node_grid.beyond_extent(),
            25,
            "not rebuilt at 25 of 200"
        );
        graph.translate(&[25], 1e6, 1e6).unwrap();
        assert_eq!(graph.node_grid.beyond_extent(), 0, "rebuilt at 26 of 200");
        let mut out = Visible::default();
        graph.query(
            &Rect::new(1e6, 1e6, 1e6 + 300.0, 1e6 + 10.0),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes, (0..26).collect::<Vec<u32>>());
    }

    #[test]
    fn in_a_small_graph_the_index_is_rebuilt_once_more_than_16_nodes_leave_it() {
        // 40 nodes: an eighth is 5, below the floor of 16.
        let mut graph = row(40);
        let far: Vec<u32> = (0..16).collect();
        graph.translate(&far, 1e6, 1e6).unwrap();
        assert_eq!(
            graph.node_grid.beyond_extent(),
            16,
            "not rebuilt at 16 of 40"
        );
        graph.translate(&[16], 1e6, 1e6).unwrap();
        assert_eq!(graph.node_grid.beyond_extent(), 0, "rebuilt at 17 of 40");
    }

    #[test]
    fn a_node_and_an_edge_removed_and_a_node_added_within_the_extent_of_50_000_build_nothing() {
        // Verifies: ADR-0022
        let mut graph = plane(50_000);
        let edges = (0..1_000)
            .map(|i| EdgeSpec {
                sides: Sides::default(),
                source: i,
                target: i + 1,
                label: None,
                style: EdgeStyle::unstyled(),
            })
            .collect();
        let positions = graph.positions.clone();
        let sizes = graph.sizes.clone();
        graph = Graph::new(positions, sizes, edges).unwrap();
        assert_eq!(graph.builds, 1);
        // Node 500 lies at (0, 200), between edges 499 and 500.
        assert_eq!(graph.remove_nodes(&[500]), Ok(vec![499, 500]));
        graph.remove_edges(&[5]).unwrap();
        assert_eq!(graph.add_node(20.0, 220.0, 50.0, 50.0), Ok(500));
        assert_eq!(graph.builds, 1);
        assert_eq!(graph.node_at(Point::new(35.0, 235.0)), Some(500));
    }

    #[test]
    fn edges_added_within_the_extent_go_into_the_index_in_place_until_they_double() {
        // Verifies: ADR-0022
        let mut graph = paired(100);
        let builds = graph.builds;
        for i in 0..100 {
            graph
                .add_edge(EdgeSpec {
                    sides: Sides::default(),
                    source: 2 * i + 1,
                    target: 2 * i + 2,
                    label: None,
                    style: EdgeStyle::unstyled(),
                })
                .unwrap();
        }
        assert_eq!(graph.builds, builds);
        graph
            .add_edge(EdgeSpec {
                sides: Sides::default(),
                source: 0,
                target: 3,
                label: None,
                style: EdgeStyle::unstyled(),
            })
            .unwrap();
        assert_eq!(graph.builds, builds + 1);
    }

    #[test]
    fn the_rule_that_rebuilds_the_index_counts_the_edges_in_use() {
        // Verifies: ADR-0022
        // 20 edges dragged beyond the extent: of 400 edges in use, fewer than an eighth.
        let far: Vec<u32> = (0..20).map(|i| 2 * i).collect();
        let mut graph = paired(400);
        graph.translate(&far, 1e6, 0.0).unwrap();
        assert_eq!(graph.builds, 1);
        // Of 1,000 edges, 900 removed: the 20 are more than an eighth of the 100 in use, and 16.
        let mut graph = paired(1_000);
        let removed: Vec<u32> = (100..1_000).collect();
        graph.remove_edges(&removed).unwrap();
        graph.translate(&far, 1e6, 0.0).unwrap();
        assert_eq!(graph.builds, 2);
    }

    #[test]
    fn a_rebuild_after_removals_covers_only_the_slots_in_use() {
        // Verifies: ADR-0022
        // Nine nodes in a row, and one far away, which a rebuild would stretch the extent to.
        let mut positions: Vec<f32> = (0..9).flat_map(|i| [i as f32 * 100.0, 0.0]).collect();
        positions.extend([1e6, 1e6]);
        let mut graph = Graph::new(positions, vec![50.0; 20], Vec::new()).unwrap();
        graph.remove_nodes(&[9]).unwrap();
        graph.index();
        assert_eq!(graph.indexed_nodes, 9);
        assert_eq!(graph.node_grid.beyond_extent(), 0);
        // The extent is the row's: a node at the far one's place lies beyond it.
        let slot = graph.add_node(1e6, 1e6, 50.0, 50.0).unwrap();
        assert_eq!(slot, 9);
        assert_eq!(graph.node_grid.beyond_extent(), 1);
        let mut out = Visible::default();
        graph.query(
            &Rect::new(-1e7, -1e7, 1e7, 1e7),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes.len(), 10);
    }

    #[test]
    fn a_node_added_within_the_extent_of_50_000_is_found_without_building_the_index() {
        // Verifies: ADR-0022
        let mut graph = plane(50_000);
        assert_eq!(graph.builds, 1);
        let slot = graph.add_node(1_020.0, 1_020.0, 50.0, 50.0).unwrap();
        assert_eq!(graph.builds, 1);
        // It overlaps the node at (1,000, 1,000), slot 10 · 250 + 10, and is drawn above it.
        let mut out = Visible::default();
        let rect = Rect::new(1_030.0, 1_030.0, 1_040.0, 1_040.0);
        graph.query(&rect, Level::Near, 4.0, 0.0, &mut out);
        assert_eq!(out.nodes, [2_510, slot]);
        assert_eq!(graph.node_at(Point::new(1_035.0, 1_035.0)), Some(slot));
        graph.query(
            &Rect::new(1_060.0, 1_060.0, 1_065.0, 1_065.0),
            Level::Near,
            4.0,
            0.0,
            &mut out,
        );
        assert_eq!(out.nodes, [slot]);
    }

    #[test]
    fn a_graph_grown_by_additions_inside_its_extent_is_indexed_again_at_each_doubling() {
        // Verifies: ADR-0022
        let mut rng = Lcg(5);
        let mut graph = plane(100);
        let mut built_at = Vec::new();
        for _ in 100..1_000 {
            // Within the extent of the row, (0, 0) to (9,950, 50).
            let (x, y) = (rng.range(0.0, 9_900.0), 0.0);
            let builds = graph.builds;
            graph.add_node(x as f32, y as f32, 50.0, 50.0).unwrap();
            if graph.builds > builds {
                built_at.push(graph.nodes_in_use());
            }
        }
        // Built for 100, again past 200; built for 201, again past 402; then past 806.
        assert_eq!(built_at, [201, 403, 807]);
    }

    #[test]
    fn nodes_added_far_beyond_the_extent_build_the_index_again() {
        // Verifies: ADR-0022
        // 200 nodes: once more than an eighth of the nodes in use lie beyond the extent, it is
        // built again; 28 of 228 are not more than 228 / 8 = 28, and 29 of 229 are.
        let mut graph = row(200);
        for i in 0..28 {
            graph
                .add_node(1e6 + i as f32 * 10.0, 1e6, 5.0, 5.0)
                .unwrap();
        }
        assert_eq!(graph.builds, 1);
        assert_eq!(graph.node_grid.beyond_extent(), 28);
        graph.add_node(1e6 + 280.0, 1e6, 5.0, 5.0).unwrap();
        assert_eq!(graph.builds, 2);
        assert_eq!(graph.node_grid.beyond_extent(), 0);
    }
}
