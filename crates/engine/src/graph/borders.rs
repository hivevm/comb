//! Border nodes (ARCH-border-nodes-ride-sides): a node attached to the outline of another, which
//! is no border node, at a side of that node's box and an offset along it. The engine keeps its
//! world position from its place, the node's box, and its node shape, and places it again in the
//! same call as anything moves, resizes, or reshapes that node. A border node lies in no
//! container's list of what it holds: it follows its node wherever that node lies, so that it lies
//! in the same container, and goes with it.

use super::{CANVAS, Graph, SlotError};
use crate::geometry::{Point, Side, WORLD_LIMIT};
use crate::shape::{held, side_length};

/// Why a border node was not attached, placed, or slid: a slot that holds no node, or a node the
/// call cannot take as a border node (ARCH-border-nodes-ride-sides, *Attachment*). Each is the
/// shell's own mistake, which the bridge refuses in the graph data first.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AttachError {
    Slot(SlotError),
    /// The node is attached to itself or to a border node, is a container, lies in a container,
    /// or has border nodes of its own; or, for a place or a slide, is no border node.
    NotBorder {
        slot: u32,
    },
    /// An offset or a point that is not finite.
    NonFinite,
}

impl From<SlotError> for AttachError {
    fn from(error: SlotError) -> Self {
        Self::Slot(error)
    }
}

/// Where a border node sits: the slot of the node it is attached to, the side of that node's box,
/// and the offset along it from the side's start, held within the side's length when `attach`,
/// `set_place`, or `slide` set it; a resize keeps it as it is and holds it within the side's
/// length only where it places the border node.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Place {
    pub on: u32,
    pub side: Side,
    pub offset: f64,
}

/// Grows `list` with `fill` until it holds index `i`.
fn grow_to<T: Clone>(list: &mut Vec<T>, i: usize, fill: T) {
    if list.len() <= i {
        list.resize(i + 1, fill);
    }
}

impl Graph {
    /// Where the border node in `slot` sits, or none where it is no border node.
    pub fn place_of(&self, slot: u32) -> Option<Place> {
        self.places.get(slot as usize).copied().flatten()
    }

    /// Whether the node in `slot` is a border node.
    pub fn is_border(&self, slot: u32) -> bool {
        self.place_of(slot).is_some()
    }

    /// The border nodes attached to the node in `slot`, in the order they were attached.
    pub fn borders(&self, slot: u32) -> &[u32] {
        self.borders.get(slot as usize).map_or(&[], Vec::as_slice)
    }

    /// Attaches the node in `slot` to the node in `on` at `side` and `offset`, held within the
    /// side's length, and places it there, its edges with it; returns the offset held
    /// (ARCH-border-nodes-ride-sides, *Attachment*, *Place*). A slot that holds no node, a node
    /// attached to itself or to a border node, and one that is a container, lies in a container,
    /// or has border nodes of its own, refuse the call, as does an offset that is not finite; the
    /// graph then stays as it was.
    pub fn attach(
        &mut self,
        slot: u32,
        on: u32,
        side: Side,
        offset: f64,
    ) -> Result<f64, AttachError> {
        self.nodes_held(&[slot, on])?;
        if !offset.is_finite() {
            return Err(AttachError::NonFinite);
        }
        let refused = slot == on
            || self.is_border(on)
            || self.is_border(slot)
            || self.is_container(slot)
            || self.container(slot) != CANVAS
            || !self.borders(slot).is_empty();
        if refused {
            return Err(AttachError::NotBorder { slot });
        }
        let i = slot as usize;
        let offset = self.held_on(on, side, offset);
        grow_to(&mut self.places, i, None);
        self.places[i] = Some(Place { on, side, offset });
        grow_to(&mut self.borders, on as usize, Vec::new());
        self.borders[on as usize].push(slot);
        self.ride_one(slot);
        self.keep_index();
        Ok(offset)
    }

    /// Gives the border node in `slot` the side `side` and the offset `offset`, held within that
    /// side's length, and places it there; returns the offset held (`updateNode`,
    /// API-edits-report-nested-changes). A slot that holds no border node, or an offset that is
    /// not finite, refuses the call, which then changes nothing.
    pub fn set_place(&mut self, slot: u32, side: Side, offset: f64) -> Result<f64, AttachError> {
        self.nodes_held(&[slot])?;
        let Some(place) = self.place_of(slot) else {
            return Err(AttachError::NotBorder { slot });
        };
        if !offset.is_finite() {
            return Err(AttachError::NonFinite);
        }
        let offset = self.held_on(place.on, side, offset);
        self.places[slot as usize] = Some(Place {
            side,
            offset,
            ..place
        });
        self.ride_one(slot);
        self.keep_index();
        Ok(offset)
    }

    /// Slides the border node in `slot` to the point of its node's outline nearest the world point
    /// `point`, by the side its node shape places it there from (`NodeShape::side_of`), and
    /// returns its place (ARCH-border-nodes-ride-sides, *Drag*). A slot that holds no border
    /// node, or a point that is not finite, refuses the call, which then changes nothing.
    pub fn slide(&mut self, slot: u32, point: Point) -> Result<Place, AttachError> {
        self.nodes_held(&[slot])?;
        let Some(place) = self.place_of(slot) else {
            return Err(AttachError::NotBorder { slot });
        };
        if !(point.x.is_finite() && point.y.is_finite()) {
            return Err(AttachError::NonFinite);
        }
        let box_ = self.node_bounds(place.on);
        let (width, height) = (box_.max_x - box_.min_x, box_.max_y - box_.min_y);
        let shape = self.shape(place.on);
        let (x, y) = shape.nearest(width, height, point.x - box_.min_x, point.y - box_.min_y);
        let (side, offset) = shape.side_of(width, height, x, y);
        let place = Place {
            side,
            offset,
            ..place
        };
        self.places[slot as usize] = Some(place);
        self.ride_one(slot);
        self.keep_index();
        Ok(place)
    }

    /// `offset` held within the length of `side` of the node in `on`.
    fn held_on(&self, on: u32, side: Side, offset: f64) -> f64 {
        let i = on as usize * 2;
        let (width, height) = (f64::from(self.sizes[i]), f64::from(self.sizes[i + 1]));
        held(offset, side_length(width, height, side))
    }

    /// Places the border nodes of the node in `slot` again from its box, as `ride_one` places one,
    /// their edges with them.
    pub(super) fn ride(&mut self, slot: u32) {
        let Some(list) = self.borders.get_mut(slot as usize) else {
            return;
        };
        if list.is_empty() {
            return;
        }
        let borders = std::mem::take(list);
        for &border in &borders {
            self.ride_one(border);
        }
        self.borders[slot as usize] = borders;
    }

    /// Puts the border node in `slot` where its place says on its node's outline, centred there,
    /// cut where it meets the world's limit, and takes its box into the index and places its
    /// edges again.
    fn ride_one(&mut self, slot: u32) {
        self.position_border(slot);
        let bounds = self.node_bounds(slot);
        self.node_grid.set(slot, &bounds);
        let edges = std::mem::take(&mut self.incident[slot as usize]);
        for &edge in &edges {
            self.place_edge(edge);
        }
        self.incident[slot as usize] = edges;
    }

    /// Writes the world position of the border node in `slot` from its place, no more: the caller
    /// takes it into the index and places its edges.
    pub(super) fn position_border(&mut self, slot: u32) {
        let Some(Place { on, side, offset }) = self.place_of(slot) else {
            return;
        };
        let box_ = self.node_bounds(on);
        let (width, height) = (box_.max_x - box_.min_x, box_.max_y - box_.min_y);
        let (x, y) = self.shape(on).on_side(width, height, side, offset);
        let i = slot as usize * 2;
        let centre = [box_.min_x + x, box_.min_y + y];
        for axis in 0..2 {
            let size = f64::from(self.sizes[i + axis]);
            let at = centre[axis] - size / 2.0;
            #[expect(
                clippy::cast_possible_truncation,
                reason = "cut to within the world's limit, far within f32, before it is rounded"
            )]
            let cut = at.clamp(-WORLD_LIMIT, (WORLD_LIMIT - size).max(-WORLD_LIMIT)) as f32;
            self.positions[i + axis] = cut;
        }
    }

    /// Forgets that the node in `slot` is a border node or has any, as its slot is freed or
    /// taken again: a border node leaves its node's list, and a node's list is emptied.
    pub(super) fn forget_borders(&mut self, slot: u32) {
        let i = slot as usize;
        if let Some(Place { on, .. }) = self.place_of(slot) {
            if let Some(list) = self.borders.get_mut(on as usize) {
                list.retain(|&s| s != slot);
            }
            self.places[i] = None;
        }
        if let Some(list) = self.borders.get_mut(i) {
            list.clear();
        }
    }

    /// The nodes in `nodes` and the border nodes of each, each once, in that order: what goes
    /// with a removal of them (ARCH-border-nodes-ride-sides, *Removal*).
    pub(super) fn with_borders(&self, mut nodes: Vec<u32>) -> Vec<u32> {
        let mut seen: std::collections::HashSet<u32> = nodes.iter().copied().collect();
        for k in 0..nodes.len() {
            for &border in self.borders(nodes[k]) {
                if seen.insert(border) {
                    nodes.push(border);
                }
            }
        }
        nodes
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Level, Target, Visible};
    use super::*;
    use crate::geometry::Rect;

    /// An action, 0, at (0, 0) 200 × 100, a pin, 1, 10 × 10 on its right side at 40, and a node,
    /// 2, added after the action where the pin lies.
    fn action_with_pin() -> Graph {
        let mut graph = Graph::new(Vec::new(), Vec::new(), Vec::new()).unwrap();
        let action = graph.add_node(0.0, 0.0, 200.0, 100.0).unwrap();
        let pin = graph.add_node(0.0, 0.0, 10.0, 10.0).unwrap();
        assert_eq!(graph.attach(pin, action, Side::Right, 40.0), Ok(40.0));
        let other = graph.add_node(150.0, 0.0, 100.0, 100.0).unwrap();
        assert_eq!((action, pin, other), (0, 1, 2));
        graph
    }

    fn found(graph: &mut Graph) -> (Vec<u32>, Vec<u32>) {
        let mut out = Visible::default();
        let all = Rect::new(-10_000.0, -10_000.0, 10_000.0, 10_000.0);
        graph.query(&all, Level::Near, 1.0, 0.0, &mut out);
        (out.containers, out.nodes)
    }

    #[test]
    fn a_border_node_is_centred_on_its_side_and_drawn_and_hit_directly_after_its_node() {
        // Verifies: ARCH-border-nodes-ride-sides, ARCH-engine-edits-nested-graph
        let mut graph = action_with_pin();
        assert_eq!(&graph.positions()[2..4], [195.0, 35.0]);
        // After its action, below the node added after it, which its action lies below too.
        assert_eq!(found(&mut graph).1, vec![0, 1, 2]);
        let at = Point::new(197.0, 40.0);
        assert_eq!(
            graph.hit_at(at, 1.0, Level::Far, false),
            Some(Target::Node(2))
        );
        // A node added after both lies above them; the pin of a node added later follows it.
        let late = graph.add_node(1000.0, 0.0, 100.0, 100.0).unwrap();
        let pin = graph.add_node(0.0, 0.0, 10.0, 10.0).unwrap();
        graph.attach(pin, late, Side::Top, 0.0).unwrap();
        let other_pin = graph.add_node(0.0, 0.0, 10.0, 10.0).unwrap();
        graph.attach(other_pin, 0, Side::Left, 0.0).unwrap();
        assert_eq!(found(&mut graph).1, vec![0, 1, other_pin, 2, late, pin]);
        // A border node of a container lies above every container, at its container's rank.
        let container = graph
            .add_node_in(CANVAS, true, [-500.0, -500.0, 100.0, 100.0])
            .unwrap();
        let on_container = graph.add_node(0.0, 0.0, 10.0, 10.0).unwrap();
        graph
            .attach(on_container, container, Side::Bottom, 50.0)
            .unwrap();
        let (containers, nodes) = found(&mut graph);
        assert_eq!(containers, vec![container]);
        assert_eq!(nodes.last(), Some(&on_container));
        assert_eq!(
            graph.hit_at(Point::new(-450.0, -400.0), 1.0, Level::Far, false),
            Some(Target::Node(on_container))
        );
    }

    #[test]
    fn a_border_node_moves_with_its_node_into_a_container_and_keeps_its_place_through_a_resize() {
        // Verifies: ARCH-border-nodes-ride-sides
        let mut graph = action_with_pin();
        let container = graph
            .add_node_in(CANVAS, true, [-500.0, -500.0, 2000.0, 2000.0])
            .unwrap();
        graph.move_into(0, container).unwrap();
        // It lies in no container's list, follows its action, and is drawn after it.
        assert_eq!(graph.held(container), [0]);
        graph.translate(&[container], 10.0, 20.0).unwrap();
        assert_eq!(&graph.positions()[2..4], [205.0, 55.0]);
        assert_eq!(found(&mut graph).1, vec![2, 0, 1]);
        // A shrink holds its offset within the side, a growth gives it back. The action holds no
        // content, so it may be as low as 8.
        let from = Rect::new(10.0, 20.0, 210.0, 120.0);
        let to = graph
            .resize(0, crate::graph::Handle::Bottom, &from, [0.0, -80.0], 0.0)
            .unwrap();
        assert_eq!(to.max_y, 40.0);
        assert_eq!(&graph.positions()[2..4], [205.0, 35.0]);
        let from = to;
        graph
            .resize(0, crate::graph::Handle::Bottom, &from, [0.0, 80.0], 0.0)
            .unwrap();
        assert_eq!(&graph.positions()[2..4], [205.0, 55.0]);
        assert_eq!(graph.place_of(1).unwrap().offset, 40.0);
        // A move or a drop of the border node itself moves nothing.
        graph.translate(&[1], 100.0, 100.0).unwrap();
        graph.move_into(1, container).unwrap();
        assert_eq!(&graph.positions()[2..4], [205.0, 55.0]);
        assert_eq!(graph.container(1), CANVAS);
    }

    #[test]
    fn an_action_moved_into_a_container_above_a_later_node_keeps_each_pin_directly_after_it() {
        // Verifies: ARCH-engine-edits-nested-graph
        // The action, 0, its pin on the right, 1, the node above both, 2, and a second pin, 3,
        // on the action's bottom at 180, added after that node; both pins reach into it.
        let mut graph = action_with_pin();
        let second = graph.add_node(0.0, 0.0, 10.0, 10.0).unwrap();
        assert_eq!(graph.attach(second, 0, Side::Bottom, 180.0), Ok(180.0));
        let pins = [
            (1, Point::new(197.0, 40.0)),
            (second, Point::new(180.0, 97.0)),
        ];
        // Each pin directly after the action, though the second was added after the node above.
        assert_eq!(found(&mut graph).1, vec![0, 1, second, 2]);
        for (_, at) in pins {
            assert_eq!(
                graph.hit_at(at, 1.0, Level::Near, false),
                Some(Target::Node(2))
            );
        }
        let container = graph
            .add_node_in(CANVAS, true, [-500.0, -500.0, 2000.0, 2000.0])
            .unwrap();
        graph.move_into(0, container).unwrap();
        // The action takes the next rank and lies above the node, its pins directly after it.
        assert_eq!(found(&mut graph), (vec![container], vec![2, 0, 1, second]));
        for (pin, at) in pins {
            assert_eq!(
                graph.hit_at(at, 1.0, Level::Near, false),
                Some(Target::Node(pin))
            );
        }
        let beside = Point::new(170.0, 50.0);
        assert_eq!(
            graph.hit_at(beside, 1.0, Level::Near, false),
            Some(Target::Node(0))
        );
    }

    #[test]
    fn a_border_node_is_removed_alone_or_with_its_node_and_its_slot_taken_again_is_none() {
        // Verifies: ARCH-border-nodes-ride-sides
        let mut graph = action_with_pin();
        assert_eq!(graph.removal(&[0]).unwrap().0, vec![0, 1]);
        assert_eq!(graph.removal(&[1, 0]).unwrap().0, vec![1, 0]);
        assert_eq!(graph.remove_nodes(&[1]).unwrap().0, vec![1]);
        assert!(graph.borders(0).is_empty());
        let again = graph.add_node(0.0, 0.0, 10.0, 10.0).unwrap();
        assert_eq!(again, 1);
        assert!(!graph.is_border(again));
        graph.attach(again, 0, Side::Top, 10.0).unwrap();
        assert_eq!(graph.remove_nodes(&[0]).unwrap().0, vec![0, 1]);
        let taken = graph.add_node(0.0, 0.0, 10.0, 10.0).unwrap();
        assert!(!graph.is_border(taken) && graph.borders(taken).is_empty());
    }

    #[test]
    fn a_border_node_on_itself_on_a_border_node_or_that_holds_nodes_is_refused_and_nothing_changes()
    {
        // Verifies: ARCH-border-nodes-ride-sides
        let mut graph = action_with_pin();
        let refused = |slot| Err(AttachError::NotBorder { slot });
        assert_eq!(graph.attach(2, 2, Side::Top, 0.0), refused(2));
        assert_eq!(graph.attach(2, 1, Side::Top, 0.0), refused(2));
        assert_eq!(graph.attach(0, 2, Side::Top, 0.0), refused(0));
        let container = graph
            .add_node_in(CANVAS, true, [0.0, 0.0, 10.0, 10.0])
            .unwrap();
        assert_eq!(
            graph.attach(container, 2, Side::Top, 0.0),
            refused(container)
        );
        assert_eq!(
            graph.attach(2, 0, Side::Top, f64::NAN),
            Err(AttachError::NonFinite)
        );
        assert_eq!(
            graph.attach(2, 99, Side::Top, 0.0),
            Err(AttachError::Slot(SlotError::NoNode { slot: 99 }))
        );
        assert_eq!(graph.set_place(2, Side::Top, 0.0), refused(2));
        assert_eq!(
            graph.slide(2, Point::new(0.0, 0.0)),
            Err(AttachError::NotBorder { slot: 2 })
        );
        assert_eq!(
            graph.slide(1, Point::new(f64::INFINITY, 0.0)),
            Err(AttachError::NonFinite)
        );
        assert!(!graph.is_border(2) && graph.borders(0) == [1]);
        assert_eq!(&graph.positions()[2..4], [195.0, 35.0]);
    }
}
