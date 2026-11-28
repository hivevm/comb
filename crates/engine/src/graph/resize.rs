//! The resize of a node by its resize handles (API-edits-report-division-moves, *Resizing*): the
//! eight handles, the box a drag of one leaves, never smaller than 8 world units a side, than the
//! node's content, an actor's and an hourglass's drawing among it, or than the boxes of the nodes
//! that lie directly in it, a circle, a crossed circle, and a cross kept as high as wide, and the
//! node given that box while what it holds keeps its world position, and its regions laid out below
//! the top its new width gives. Also what a node's data says of its size: the height it gives,
//! whether the user may resize it, and its content, from which the engine computes its height.

use super::{Beyond, CANVAS, DivideError, Graph, MoveError, PositionError, SlotError};
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
/// at the press and whose rows and padding are `content` high as in a rectangle, none for a node
/// without rows: each side it pulls moved by the drag, never so far that the node is less than
/// `LEAST_SIDE` wide or less high than its node shape needs for that content at its new width
/// (`NodeShape::height` given a height of 0, which it raises to the least its content and its node
/// shape need), an actor and an hourglass their drawing too, nor that it leaves out any of
/// `held`, the boxes of the nodes that lie directly in it together, or none. A circle, a ringed
/// circle, a crossed circle, and a cross stay as high as wide, by the greater of the two pulls; a
/// corner keeps the opposite corner where it stands, a side the opposite side, and the other
/// extent grows about the node's centre line. Every side stays within the world's limit.
pub fn resized(
    shape: NodeShape,
    handle: Handle,
    from: &Rect,
    by: [f64; 2],
    content: Option<f64>,
    held: Option<&Rect>,
) -> Rect {
    let pulls = handle.pulls();
    let lo = [from.min_x, from.min_y];
    let hi = [from.max_x, from.max_y];
    let held_lo = held.map(|h| [h.min_x, h.min_y]);
    let held_hi = held.map(|h| [h.max_x, h.max_y]);
    let (mut new_lo, mut new_hi) = (lo, hi);
    if matches!(
        shape,
        NodeShape::Circle | NodeShape::RingedCircle | NodeShape::CrossedCircle | NodeShape::Cross
    ) {
        let centre = [0, 1].map(|axis| f64::midpoint(lo[axis], hi[axis]));
        let mut side = LEAST_SIDE;
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
        let mut least = [LEAST_SIDE; 2];
        for axis in 0..2 {
            if axis == 1 {
                // The height its content needs at the width the drag left.
                let width = new_hi[0] - new_lo[0];
                least[1] = LEAST_SIDE.max(shape.height(width, content, Some(0.0)));
            }
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

/// The height of a node of node shape `shape`, `width` wide, whose content is `content` as
/// `Graph::set_content` takes it and whose data gives the height `given`, or none: the height the
/// engine gives it (`NodeShape::height`), as it keeps it; or `Beyond::Height` where its far side,
/// from `y`, lies past the world's limit (ARCH-one-workspace-per-example, *World*). It changes
/// nothing, so that a caller asks it before it hands the engine a node or its content, and a
/// refused edit changes nothing.
pub fn height_within(
    shape: NodeShape,
    [y, width]: [f32; 2],
    content: Option<f64>,
    given: Option<f32>,
) -> Result<f32, Beyond> {
    let height = kept(shape.height(f64::from(width), content, given.map(f64::from)));
    // `y` lies within the limit and the height is not negative, so only the far side past the
    // positive limit is beyond. Compared as `height > limit - y`, which `f64` holds exactly where
    // it matters: a height of hundreds of units past a `y` on the limit, which `y + height` would
    // round back onto it.
    if f64::from(height) > WORLD_LIMIT - f64::from(y) {
        return Err(Beyond::Height);
    }
    Ok(height)
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
    /// whether the user may resize it (API-edits-report-division-moves). Its height in the sizes
    /// buffer follows through `set_content`. A slot that holds no node refuses the call.
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

    /// The rows and padding of the content of the node in `slot`, as `set_content` gave them,
    /// none for a node without rows.
    pub(crate) fn content(&self, slot: u32) -> Option<f64> {
        self.contents.get(slot as usize).copied().flatten()
    }

    /// Gives the node in `slot` its content: its rows and padding, `content` high as in a
    /// rectangle before the least height of a node, or none for a node without rows
    /// (REN-node-content-and-hits). The node then takes the height `NodeShape::height` gives at the
    /// width it lays its content out at (`own_width`) and the height its data gives, its edges and
    /// its place in the index moved along where it changed, and its regions are laid out anew
    /// below its top (`top`). A slot that holds no node, or a region, which holds no content,
    /// refuses the call, which then changes nothing.
    pub fn set_content(&mut self, slot: u32, content: Option<f64>) -> Result<(), DivideError> {
        self.nodes_held(&[slot])?;
        if self.is_region(slot) {
            return Err(DivideError::Region { slot });
        }
        let i = slot as usize;
        if self.contents.len() <= i {
            self.contents.resize(i + 1, None);
        }
        self.contents[i] = content;
        let width = self.own_width(slot);
        let given = self.given_height(slot).map(f64::from);
        let height = kept(self.shape(slot).height(f64::from(width), content, given));
        if self.divided(slot).is_some() {
            // The height its regions grow it from, which `arrange` gives it.
            self.set_divided_size(slot, [width, height]);
        } else if self.sizes[i * 2 + 1] != height {
            self.resize_node(slot, height)?;
        }
        self.arrange(slot);
        Ok(())
    }

    /// Resizes the node in `slot`, whose box was `from` at the press, by a drag of `handle` by
    /// `by`, never lower than its node shape needs for its content at its new width, as `resized`
    /// says, and returns the box it now has. The nodes it holds keep their world positions, so
    /// that their positions relative to it change with its left and top side; its regions are
    /// laid out below the top its new width gives (`top`), the first region giving way where that
    /// top moves down and the node growing by only what the first region lacks of its least; its
    /// height becomes the one its data gives; its edges and its place in the index move along. A
    /// slot that holds no node, or a box or a drag that is not finite, refuses the call, which
    /// then changes nothing.
    pub fn resize(
        &mut self,
        slot: u32,
        handle: Handle,
        from: &Rect,
        by: [f64; 2],
    ) -> Result<Rect, MoveError> {
        self.nodes_held(&[slot])?;
        let numbers = [from.min_x, from.min_y, from.max_x, from.max_y, by[0], by[1]];
        if !numbers.iter().all(|n| n.is_finite()) {
            return Err(PositionError::NonFinite.into());
        }
        let held = if self.divided(slot).is_some() {
            // What its regions need at each side, which a resize moves
            // (ARCH-regions-are-container-slots, *Resizing what is divided*).
            Some(Rect::new(
                self.reach(slot, 0, -1),
                self.reach(slot, 1, -1),
                self.reach(slot, 0, 1),
                self.reach(slot, 1, 1),
            ))
        } else {
            self.held(slot)
                .iter()
                .map(|&s| self.node_bounds(s))
                .reduce(|a, b| a.union(&b))
        };
        let shape = self.shape(slot);
        let to = resized(shape, handle, from, by, self.content(slot), held.as_ref());
        let i = slot as usize * 2;
        self.positions[i] = kept(to.min_x);
        self.positions[i + 1] = kept(to.min_y);
        self.sizes[i] = kept(to.max_x - to.min_x);
        self.sizes[i + 1] = kept(to.max_y - to.min_y);
        if self.container(slot) != CANVAS {
            self.keep_relative(slot);
        }
        for child in self.held(slot).to_vec() {
            self.keep_relative(child);
        }
        self.reboxed(slot);
        // Its width now the one its top and a later layout of its regions follow: an actor's or an
        // hourglass's drawing follows it, and its regions lie below the top it gives.
        let top = self.top(slot);
        self.set_divided_size(slot, [self.sizes[i], self.sizes[i + 1]]);
        self.refit(slot);
        if self.top(slot) != top {
            // `refit` gave a top that moved down the first region's room; laid out anew from the
            // sizes it left, the node grows by only what that region lacks of its least, and keeps
            // the box the drag left otherwise (the maintainer's decision of 2026-11-27).
            self.arrange(slot);
        }
        let resizable = self.is_resizable(slot);
        self.set_sizing(slot, Some(self.sizes[i + 1]), resizable)?;
        Ok(self.node_bounds(slot))
    }
}

#[cfg(test)]
mod tests {
    use super::super::{EdgeSpec, Nesting};
    use super::*;
    use crate::geometry::{Dock, Sides};
    use crate::graph::End;
    use crate::stroke::EdgeStyle;

    /// Container 0 at (100, 100), 400 × 200, holding node 1 at (150, 140), 100 × 64, and node 2
    /// on the canvas, an edge from 0 to 2.
    fn held() -> Graph {
        let mut graph = Graph::nested(
            vec![100.0, 100.0, 150.0, 140.0, 900.0, 100.0],
            vec![400.0, 200.0, 100.0, 64.0, 100.0, 64.0],
            vec![EdgeSpec {
                source: End::Node(0),
                target: End::Node(2),
                sides: Sides {
                    source: Dock::Outline,
                    target: Dock::Outline,
                },
                labels: Vec::new(),
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
        // Verifies: API-edits-report-division-moves
        let mut graph = held();
        let from = Rect::of_node(100.0, 100.0, 400.0, 200.0);
        graph.resize(0, Handle::Left, &from, [-60.0, 25.0]).unwrap();
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
        // Verifies: API-edits-report-division-moves
        let mut graph = held();
        let from = Rect::of_node(100.0, 100.0, 400.0, 200.0);
        // The right side pulled in past the node held stops at its right side, 250.
        graph
            .resize(0, Handle::Right, &from, [-380.0, 0.0])
            .unwrap();
        assert_eq!(box_of(&graph, 0), [100.0, 100.0, 150.0, 200.0]);
        // The top pulled down past the node stops at its top, 140.
        graph.resize(0, Handle::Top, &from, [0.0, 500.0]).unwrap();
        assert_eq!(box_of(&graph, 0), [100.0, 140.0, 400.0, 160.0]);
        // A node that holds none stops at 8 wide and at its content's height: rows and padding of
        // 30 raised to the least height of 64, or of 80 kept; without content, at 8.
        let lone = Rect::of_node(900.0, 100.0, 100.0, 64.0);
        graph.set_content(2, Some(30.0)).unwrap();
        graph
            .resize(2, Handle::BottomLeft, &lone, [500.0, -500.0])
            .unwrap();
        assert_eq!(box_of(&graph, 2), [992.0, 100.0, 8.0, 64.0]);
        graph.set_content(2, Some(80.0)).unwrap();
        graph
            .resize(2, Handle::BottomLeft, &lone, [500.0, -500.0])
            .unwrap();
        assert_eq!(box_of(&graph, 2), [992.0, 100.0, 8.0, 80.0]);
        graph.set_content(2, None).unwrap();
        graph
            .resize(2, Handle::BottomLeft, &lone, [500.0, -500.0])
            .unwrap();
        assert_eq!(box_of(&graph, 2), [992.0, 100.0, 8.0, 8.0]);
    }

    #[test]
    fn a_circle_stays_as_high_as_wide_by_the_greater_pull_about_its_centre_line() {
        // Verifies: API-edits-report-division-moves
        let circle = NodeShape::Circle;
        let from = Rect::of_node(0.0, 0.0, 40.0, 40.0);
        // A corner keeps the opposite corner, by the greater of the two pulls.
        let to = resized(circle, Handle::BottomRight, &from, [10.0, 30.0], None, None);
        assert_eq!(to, Rect::new(0.0, 0.0, 70.0, 70.0));
        let to = resized(circle, Handle::TopLeft, &from, [-5.0, 20.0], None, None);
        assert_eq!(to, Rect::new(-5.0, -5.0, 40.0, 40.0));
        // A side keeps the opposite side and grows the other extent about the centre line.
        let to = resized(circle, Handle::Right, &from, [20.0, 99.0], None, None);
        assert_eq!(to, Rect::new(0.0, -10.0, 60.0, 50.0));
        // Never below 8 a side.
        let to = resized(circle, Handle::Left, &from, [100.0, 0.0], None, None);
        assert_eq!(to, Rect::new(32.0, 16.0, 40.0, 24.0));
        // A bar sets both freely.
        let bar = resized(
            NodeShape::Bar,
            Handle::BottomRight,
            &from,
            [10.0, 30.0],
            None,
            None,
        );
        assert_eq!(bar, Rect::new(0.0, 0.0, 50.0, 70.0));
    }

    #[test]
    fn a_pentagon_a_notch_a_note_and_a_frame_are_resized_freely_as_a_rectangle_is() {
        // Verifies: REN-node-shapes-cover-uml
        // Each takes the width and the height its corner is dragged to, each on its own, as a
        // rectangle does, never below the content its caller gives.
        let from = Rect::of_node(0.0, 0.0, 220.0, 64.0);
        for shape in [
            NodeShape::Pentagon,
            NodeShape::NotchedRectangle,
            NodeShape::Note,
            NodeShape::Frame,
        ] {
            let to = resized(
                shape,
                Handle::BottomRight,
                &from,
                [-100.0, 80.0],
                Some(64.0),
                None,
            );
            assert_eq!(to, Rect::new(0.0, 0.0, 120.0, 144.0), "{shape:?}");
            let to = resized(
                shape,
                Handle::BottomRight,
                &from,
                [30.0, -40.0],
                Some(64.0),
                None,
            );
            assert_eq!(to, Rect::new(0.0, 0.0, 250.0, 64.0), "{shape:?}");
        }
    }

    #[test]
    fn a_crossed_circle_and_a_cross_set_width_and_height_together_as_a_circle_does() {
        // Verifies: REN-node-shapes-cover-uml
        let from = Rect::of_node(0.0, 0.0, 40.0, 40.0);
        for shape in [NodeShape::CrossedCircle, NodeShape::Cross] {
            let to = resized(shape, Handle::BottomRight, &from, [10.0, 30.0], None, None);
            assert_eq!(to, Rect::new(0.0, 0.0, 70.0, 70.0), "{shape:?}");
            let to = resized(shape, Handle::Right, &from, [20.0, 99.0], None, None);
            assert_eq!(to, Rect::new(0.0, -10.0, 60.0, 50.0), "{shape:?}");
        }
    }

    #[test]
    fn an_actor_and_an_hourglass_are_resized_freely_never_lower_than_their_drawing_and_content() {
        // Verifies: REN-node-shapes-cover-uml
        // An actor 100 wide holds content 38 high below its drawing of 48: 86 high. Its width and
        // height each follow the drag, the height never below the drawing at the new width and
        // the content.
        let from = Rect::of_node(0.0, 0.0, 100.0, 86.0);
        let actor = NodeShape::Actor;
        let to = resized(
            actor,
            Handle::BottomRight,
            &from,
            [20.0, 40.0],
            Some(38.0),
            None,
        );
        assert_eq!(to, Rect::new(0.0, 0.0, 120.0, 126.0));
        let to = resized(
            actor,
            Handle::Bottom,
            &from,
            [0.0, -500.0],
            Some(38.0),
            None,
        );
        assert_eq!(to, Rect::new(0.0, 0.0, 100.0, 86.0));
        // Narrowed to 20, its drawing is 40 high, so it may be 78 high.
        let to = resized(
            actor,
            Handle::BottomRight,
            &from,
            [-80.0, -500.0],
            Some(38.0),
            None,
        );
        assert_eq!(to, Rect::new(0.0, 0.0, 20.0, 78.0));
        // Without content, as high as its drawing at least: an hourglass 20 wide, 30.
        let from = Rect::of_node(0.0, 0.0, 100.0, 48.0);
        let hourglass = NodeShape::Hourglass;
        let to = resized(
            hourglass,
            Handle::BottomRight,
            &from,
            [-80.0, -500.0],
            None,
            None,
        );
        assert_eq!(to, Rect::new(0.0, 0.0, 20.0, 30.0));
        let to = resized(hourglass, Handle::TopLeft, &from, [10.0, -20.0], None, None);
        assert_eq!(to, Rect::new(10.0, -20.0, 100.0, 48.0));
    }

    #[test]
    fn the_height_and_a_division_within_the_world_are_checked_without_a_graph() {
        // Verifies: ARCH-regions-are-container-slots, REN-node-shapes-cover-uml
        // A title's rows and padding of 38 under an actor 100 wide: 86 high, refused where its far
        // side passes the limit, at the height or by its regions' growth, never at the width.
        use super::super::{Axis, Beyond, Part, WithinError, division_within};
        let actor = NodeShape::Actor;
        let limit = WORLD_LIMIT as f32;
        assert_eq!(
            height_within(actor, [0.0, 100.0], Some(38.0), None),
            Ok(86.0)
        );
        assert_eq!(
            height_within(actor, [0.0, 100.0], Some(38.0), Some(90.0)),
            Ok(90.0)
        );
        assert_eq!(
            height_within(actor, [limit, 100.0], Some(38.0), None),
            Err(Beyond::Height)
        );
        // Two regions one above the other below the top of 86, each a quarter of the limit, or
        // each 0.6 of it, which grows the node past it; or a node whose far side across passes it.
        let parts = |size: f32| {
            [Part {
                size,
                ..Part::default()
            }; 2]
        };
        let within = |size: f32, at: [f32; 2]| {
            division_within(
                actor,
                Some(38.0),
                (Axis::Down, &parts(size)),
                [at, [100.0, 86.0]],
            )
        };
        assert_eq!(within(limit / 4.0, [0.0; 2]), Ok(()));
        assert_eq!(
            within(limit * 0.6, [0.0; 2]),
            Err(WithinError::Beyond(Beyond::Height))
        );
        assert_eq!(
            within(40.0, [limit, 0.0]),
            Err(WithinError::Beyond(Beyond::Width))
        );
        let late = [Part {
            of: Some(1),
            ..Part::default()
        }];
        assert_eq!(
            division_within(actor, None, (Axis::Down, &late), [[0.0; 2], [100.0, 48.0]]),
            Err(WithinError::Divide(super::super::DivideError::Part {
                index: 0
            }))
        );
    }

    #[test]
    fn a_resize_that_is_not_finite_or_of_a_free_slot_changes_nothing() {
        // Verifies: API-edits-report-division-moves
        let mut graph = held();
        let from = Rect::of_node(100.0, 100.0, 400.0, 200.0);
        let before = box_of(&graph, 0);
        assert!(
            graph
                .resize(0, Handle::Left, &from, [f64::NAN, 0.0])
                .is_err()
        );
        assert!(graph.resize(7, Handle::Left, &from, [1.0, 0.0]).is_err());
        assert_eq!(box_of(&graph, 0), before);
    }
}
