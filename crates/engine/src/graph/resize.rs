//! The resize of a node by its resize handles (API-edits-report-nested-changes, *Resizing*): the
//! eight handles, the box a drag of one leaves, never smaller than 8 world units a side, than the
//! node's content, or than the boxes of the nodes that lie directly in it, a circle kept as high
//! as wide, and the node given that box while what it holds keeps its world position. Also what
//! a node's data says of its size: the height it gives and whether the user may resize it.

use super::{CANVAS, Graph, MoveError, PositionError, SlotError};
use crate::geometry::{Rect, WORLD_LIMIT};
use crate::shape::{BAR_HEIGHT, NodeShape};

/// The least extent of a side a resize leaves, the height of a bar.
pub const LEAST_SIDE: f64 = BAR_HEIGHT;

/// A resize handle of a selected node: a corner or the middle of a side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Handle {
    TopLeft,
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
}

impl Handle {
    /// Every handle, clockwise from the top left corner.
    pub const ALL: [Self; 8] = [
        Self::TopLeft,
        Self::Top,
        Self::TopRight,
        Self::Right,
        Self::BottomRight,
        Self::Bottom,
        Self::BottomLeft,
        Self::Left,
    ];

    /// The sides it pulls on each axis: -1 the left or the top, 1 the right or the bottom, and 0
    /// neither.
    pub const fn pulls(self) -> [i8; 2] {
        match self {
            Self::TopLeft => [-1, -1],
            Self::Top => [0, -1],
            Self::TopRight => [1, -1],
            Self::Right => [1, 0],
            Self::BottomRight => [1, 1],
            Self::Bottom => [0, 1],
            Self::BottomLeft => [-1, 1],
            Self::Left => [-1, 0],
        }
    }

    /// Where it stands on a node of `bounds`: a corner, or the middle of a side.
    pub(super) fn at(self, bounds: &Rect) -> [f64; 2] {
        let [px, py] = self.pulls();
        let along = |pull: i8, min: f64, max: f64| match pull {
            -1 => min,
            1 => max,
            _ => f64::midpoint(min, max),
        };
        [
            along(px, bounds.min_x, bounds.max_x),
            along(py, bounds.min_y, bounds.max_y),
        ]
    }
}

/// The box a drag of `handle` by `by` leaves of a node of node shape `shape` whose box was `from`
/// at the press: each side it pulls moved by the drag, never so far that the node is less than
/// `LEAST_SIDE` wide or `least_height` high, nor that it leaves out any of `held`, the boxes of
/// the nodes that lie directly in it together, or none. A circle and a ringed circle stay as high
/// as wide, by the greater of the two pulls; a corner keeps the opposite corner where it stands,
/// a side the opposite side, and the other extent grows about the node's centre line. Every side
/// stays within the world's limit.
pub fn resized(
    shape: NodeShape,
    handle: Handle,
    from: &Rect,
    by: [f64; 2],
    least_height: f64,
    held: Option<&Rect>,
) -> Rect {
    let pulls = handle.pulls();
    let lo = [from.min_x, from.min_y];
    let hi = [from.max_x, from.max_y];
    let held_lo = held.map(|h| [h.min_x, h.min_y]);
    let held_hi = held.map(|h| [h.max_x, h.max_y]);
    let (mut new_lo, mut new_hi) = (lo, hi);
    if matches!(shape, NodeShape::Circle | NodeShape::RingedCircle) {
        let centre = [0, 1].map(|axis| f64::midpoint(lo[axis], hi[axis]));
        let mut side = LEAST_SIDE.max(least_height);
        let mut pulled = f64::NEG_INFINITY;
        for axis in 0..2 {
            let extent = hi[axis] - lo[axis];
            match pulls[axis] {
                0 => {}
                pull => pulled = pulled.max(extent + f64::from(pull) * by[axis]),
            }
            if let (Some(h_lo), Some(h_hi)) = (held_lo, held_hi) {
                side = side.max(match pulls[axis] {
                    -1 => hi[axis] - h_lo[axis],
                    1 => h_hi[axis] - lo[axis],
                    _ => 2.0 * (centre[axis] - h_lo[axis]).max(h_hi[axis] - centre[axis]),
                });
            }
        }
        let side = side.max(pulled);
        for axis in 0..2 {
            match pulls[axis] {
                -1 => new_lo[axis] = hi[axis] - side,
                1 => new_hi[axis] = lo[axis] + side,
                _ => {
                    new_lo[axis] = centre[axis] - side / 2.0;
                    new_hi[axis] = centre[axis] + side / 2.0;
                }
            }
        }
    } else {
        let least = [LEAST_SIDE, LEAST_SIDE.max(least_height)];
        for axis in 0..2 {
            match pulls[axis] {
                -1 => {
                    let mut at = (lo[axis] + by[axis]).min(hi[axis] - least[axis]);
                    if let Some(h) = held_lo {
                        at = at.min(h[axis]);
                    }
                    new_lo[axis] = at;
                }
                1 => {
                    let mut at = (hi[axis] + by[axis]).max(lo[axis] + least[axis]);
                    if let Some(h) = held_hi {
                        at = at.max(h[axis]);
                    }
                    new_hi[axis] = at;
                }
                _ => {}
            }
        }
    }
    let within = |v: f64| v.clamp(-WORLD_LIMIT, WORLD_LIMIT);
    Rect::new(
        within(new_lo[0]),
        within(new_lo[1]),
        within(new_hi[0]),
        within(new_hi[1]),
    )
}

/// `value`, a coordinate or an extent within the world's limit, as the `f32` the engine keeps.
#[expect(
    clippy::cast_possible_truncation,
    reason = "within twice the world's limit, far within f32"
)]
const fn kept(value: f64) -> f32 {
    value as f32
}

impl Graph {
    /// Gives the node in `slot` what its data says of its size: the height it gives, or none, and
    /// whether the user may resize it (API-edits-report-nested-changes). Its height in the sizes
    /// buffer is the caller's, through `resize_node`. A slot that holds no node refuses the call.
    pub fn set_sizing(
        &mut self,
        slot: u32,
        given: Option<f32>,
        resizable: bool,
    ) -> Result<(), SlotError> {
        self.nodes_held(&[slot])?;
        let i = slot as usize;
        if self.given.len() <= i {
            self.given.resize(i + 1, None);
            self.resizable.resize(i + 1, false);
        }
        self.given[i] = given;
        self.resizable[i] = resizable;
        Ok(())
    }

    /// The height the data of the node in `slot` gives, or the one a resize left, or none.
    pub fn given_height(&self, slot: u32) -> Option<f32> {
        self.given.get(slot as usize).copied().flatten()
    }

    /// Whether the user may resize the node in `slot` by its resize handles.
    pub fn is_resizable(&self, slot: u32) -> bool {
        self.resizable.get(slot as usize) == Some(&true)
    }

    /// Resizes the node in `slot`, whose box was `from` at the press, by a drag of `handle` by
    /// `by`, never lower than `least_height`, the height its content needs, as `resized` says,
    /// and returns the box it now has. The nodes it holds keep their world positions, so that
    /// their positions relative to it change with its left and top side; its height becomes the
    /// one its data gives; its edges and its place in the index move along. A slot that holds no
    /// node, or a box or a drag that is not finite, refuses the call, which then changes nothing.
    pub fn resize(
        &mut self,
        slot: u32,
        handle: Handle,
        from: &Rect,
        by: [f64; 2],
        least_height: f64,
    ) -> Result<Rect, MoveError> {
        self.nodes_held(&[slot])?;
        let numbers = [from.min_x, from.min_y, from.max_x, from.max_y, by[0], by[1]];
        if !numbers.iter().all(|n| n.is_finite()) {
            return Err(PositionError::NonFinite.into());
        }
        let held = self
            .held(slot)
            .iter()
            .map(|&s| self.node_bounds(s))
            .reduce(|a, b| a.union(&b));
        let shape = self.shape(slot);
        let to = resized(shape, handle, from, by, least_height, held.as_ref());
        let i = slot as usize * 2;
        self.positions[i] = kept(to.min_x);
        self.positions[i + 1] = kept(to.min_y);
        self.sizes[i] = kept(to.max_x - to.min_x);
        self.sizes[i + 1] = kept(to.max_y - to.min_y);
        let resizable = self.is_resizable(slot);
        self.set_sizing(slot, Some(self.sizes[i + 1]), resizable)?;
        if self.container(slot) != CANVAS {
            self.keep_relative(slot);
        }
        for child in self.held(slot).to_vec() {
            self.keep_relative(child);
        }
        self.reboxed(slot);
        Ok(self.node_bounds(slot))
    }
}

#[cfg(test)]
mod tests {
    use super::super::{EdgeSpec, Nesting};
    use super::*;
    use crate::geometry::{Dock, Sides};
    use crate::stroke::EdgeStyle;

    /// Container 0 at (100, 100), 400 × 200, holding node 1 at (150, 140), 100 × 64, and node 2
    /// on the canvas, an edge from 0 to 2.
    fn held() -> Graph {
        let mut graph = Graph::nested(
            vec![100.0, 100.0, 150.0, 140.0, 900.0, 100.0],
            vec![400.0, 200.0, 100.0, 64.0, 100.0, 64.0],
            vec![EdgeSpec {
                source: 0,
                target: 2,
                sides: Sides {
                    source: Dock::Outline,
                    target: Dock::Outline,
                },
                label: None,
                style: EdgeStyle::unstyled(),
            }],
            Nesting {
                containers: vec![CANVAS, 0, CANVAS],
                is_container: vec![true, false, false],
            },
        )
        .unwrap();
        graph.set_sizing(0, None, true).unwrap();
        graph
    }

    fn box_of(graph: &Graph, slot: u32) -> [f32; 4] {
        let i = slot as usize * 2;
        [
            graph.positions()[i],
            graph.positions()[i + 1],
            graph.sizes()[i],
            graph.sizes()[i + 1],
        ]
    }

    #[test]
    fn a_container_grown_at_its_left_keeps_what_it_holds_where_it_lies() {
        // Verifies: API-edits-report-nested-changes
        let mut graph = held();
        let from = Rect::of_node(100.0, 100.0, 400.0, 200.0);
        graph
            .resize(0, Handle::Left, &from, [-60.0, 25.0], 64.0)
            .unwrap();
        // The left side moved out, the right side and the height as they were.
        assert_eq!(box_of(&graph, 0), [40.0, 100.0, 460.0, 200.0]);
        // The node it holds stays at (150, 140) in the world, 110 from the container's left now.
        assert_eq!(box_of(&graph, 1), [150.0, 140.0, 100.0, 64.0]);
        assert_eq!(graph.relative[1], [110.0, 40.0]);
        // A move of the container takes it along by its new relative position.
        graph.translate(&[0], 10.0, 0.0).unwrap();
        assert_eq!(box_of(&graph, 1), [160.0, 140.0, 100.0, 64.0]);
        assert_eq!(graph.given_height(0), Some(200.0));
    }

    #[test]
    fn a_resize_stops_at_the_boxes_held_at_8_a_side_and_at_the_content_s_height() {
        // Verifies: API-edits-report-nested-changes
        let mut graph = held();
        let from = Rect::of_node(100.0, 100.0, 400.0, 200.0);
        // The right side pulled in past the node held stops at its right side, 250.
        graph
            .resize(0, Handle::Right, &from, [-380.0, 0.0], 64.0)
            .unwrap();
        assert_eq!(box_of(&graph, 0), [100.0, 100.0, 150.0, 200.0]);
        // The top pulled down past the node stops at its top, 140.
        graph
            .resize(0, Handle::Top, &from, [0.0, 500.0], 64.0)
            .unwrap();
        assert_eq!(box_of(&graph, 0), [100.0, 140.0, 400.0, 160.0]);
        // A node that holds none stops at 8 wide and at its content's height.
        let lone = Rect::of_node(900.0, 100.0, 100.0, 64.0);
        graph
            .resize(2, Handle::BottomLeft, &lone, [500.0, -500.0], 30.0)
            .unwrap();
        assert_eq!(box_of(&graph, 2), [992.0, 100.0, 8.0, 30.0]);
        graph
            .resize(2, Handle::BottomLeft, &lone, [500.0, -500.0], 0.0)
            .unwrap();
        assert_eq!(box_of(&graph, 2), [992.0, 100.0, 8.0, 8.0]);
    }

    #[test]
    fn a_circle_stays_as_high_as_wide_by_the_greater_pull_about_its_centre_line() {
        // Verifies: API-edits-report-nested-changes
        let circle = NodeShape::Circle;
        let from = Rect::of_node(0.0, 0.0, 40.0, 40.0);
        // A corner keeps the opposite corner, by the greater of the two pulls.
        let to = resized(circle, Handle::BottomRight, &from, [10.0, 30.0], 0.0, None);
        assert_eq!(to, Rect::new(0.0, 0.0, 70.0, 70.0));
        let to = resized(circle, Handle::TopLeft, &from, [-5.0, 20.0], 0.0, None);
        assert_eq!(to, Rect::new(-5.0, -5.0, 40.0, 40.0));
        // A side keeps the opposite side and grows the other extent about the centre line.
        let to = resized(circle, Handle::Right, &from, [20.0, 99.0], 0.0, None);
        assert_eq!(to, Rect::new(0.0, -10.0, 60.0, 50.0));
        // Never below 8 a side.
        let to = resized(circle, Handle::Left, &from, [100.0, 0.0], 0.0, None);
        assert_eq!(to, Rect::new(32.0, 16.0, 40.0, 24.0));
        // A bar sets both freely.
        let bar = resized(
            NodeShape::Bar,
            Handle::BottomRight,
            &from,
            [10.0, 30.0],
            0.0,
            None,
        );
        assert_eq!(bar, Rect::new(0.0, 0.0, 50.0, 70.0));
    }

    #[test]
    fn a_resize_that_is_not_finite_or_of_a_free_slot_changes_nothing() {
        // Verifies: API-edits-report-nested-changes
        let mut graph = held();
        let from = Rect::of_node(100.0, 100.0, 400.0, 200.0);
        let before = box_of(&graph, 0);
        assert!(
            graph
                .resize(0, Handle::Left, &from, [f64::NAN, 0.0], 64.0)
                .is_err()
        );
        assert!(
            graph
                .resize(7, Handle::Left, &from, [1.0, 0.0], 64.0)
                .is_err()
        );
        assert_eq!(box_of(&graph, 0), before);
    }
}
