//! Regions (ARCH-regions-are-container-slots): a node or a region divided side by side or one
//! above the other into regions, each a container in a node slot of its own, whose box the engine
//! derives from the box of what it divides, the sizes of the regions, and the bands of their
//! names; the line between two regions, which a drag moves and a hit test finds; and the change a
//! resize of the divided node makes to the regions at the side it pulls.

use std::collections::HashMap;

use super::{CANVAS, Graph, SlotError, TooManySlots};
use crate::geometry::{Point, Rect};
use crate::shape::BAR_HEIGHT;

/// The least extent of a region along the direction of its division, the height of a bar.
pub const LEAST_REGION: f64 = BAR_HEIGHT;

/// The thickness of the band a region's name stands in, in world units: at the top of a region
/// side by side with others, at the left of one above or below others.
pub const BAND: f64 = 24.0;

/// How near a press has to come to a line between two regions to hit it, in screen pixels
/// (REN-node-content-and-hits, *Line between regions*).
pub(super) const LINE_REACH: f64 = 4.0;

/// The direction a node or a region is divided in: `Across` for regions side by side, which
/// share its width, and `Down` for regions one above the other, which share its height.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Axis {
    Across,
    Down,
}

impl Axis {
    /// The axis its regions follow one another along: 0 for `x`, 1 for `y`.
    pub const fn index(self) -> usize {
        match self {
            Self::Across => 0,
            Self::Down => 1,
        }
    }
}

/// What a node slot is of regions: whether it is a region, whether a region has a name and so a
/// band, the direction it is divided in, or none, and for a divided node the height of its
/// content, below which its regions lie, the width its data gives, from which `arrange` grows it
/// to what its regions need, and whether only its division made it a container.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(super) struct Division {
    pub(super) region: bool,
    pub(super) band: bool,
    pub(super) divide: Option<Axis>,
    pub(super) top: f32,
    pub(super) width: f32,
    pub(super) made: bool,
}

/// Why a line between regions was not moved: a slot that holds no region, or a region with no
/// region after it in what it divides.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineError {
    Slot(SlotError),
    /// The slot holds no region that has a line after it.
    NoLine {
        slot: u32,
    },
}

impl From<SlotError> for LineError {
    fn from(error: SlotError) -> Self {
        Self::Slot(error)
    }
}

/// A region of a division `divide` makes (ARCH-regions-are-container-slots): its size along the
/// direction of the division it lies in, whether it has a name and so a band, its own division,
/// which it takes where parts lie in it, the index among the parts of the part it lies in, before
/// it, or none for one of the node itself, and the region of the node whose content it keeps, or
/// none.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Part {
    pub size: f32,
    pub named: bool,
    pub divide: Option<Axis>,
    pub of: Option<usize>,
    pub keeps: Option<u32>,
}

/// Where the parts of a division take their slots: `Added`, slots the engine adds, each into what
/// it divides; or `Built`, the slots a load built for them, one per part in their order, each in
/// what it divides, the divided node a container for them, which its data marks one where
/// `marked`.
#[derive(Clone, Copy, Debug)]
pub enum RegionSlots<'a> {
    Added,
    Built { slots: &'a [u32], marked: bool },
}

/// What a division changed: the slots of its regions in the order of its parts, and those of the
/// nodes and the edges that went with the regions the node had, as `remove_nodes` returns them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Divided {
    pub regions: Vec<u32>,
    pub nodes: Vec<u32>,
    pub edges: Vec<u32>,
}

/// Why a division was refused: a slot that holds no node, a slot that holds a region, which only
/// the division of its node divides, more slots than the graph holds, or a part, at `index`, that
/// lies in no part before it, in a part divided in no direction, or whose built slot does not fit
/// it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DivideError {
    Slot(SlotError),
    Region { slot: u32 },
    TooManySlots(TooManySlots),
    Part { index: usize },
}

impl From<SlotError> for DivideError {
    fn from(error: SlotError) -> Self {
        Self::Slot(error)
    }
}

impl From<TooManySlots> for DivideError {
    fn from(error: TooManySlots) -> Self {
        Self::TooManySlots(error)
    }
}

/// Where a node a kept region held lands once the node is divided anew: at its position relative
/// to the region of its part, or at its world position in a region inside that part.
#[derive(Clone, Copy, Debug)]
enum Landing {
    Relative([f64; 2]),
    World([f64; 2]),
}

/// Whether each of `parts` holds parts of its own.
fn holding(parts: &[Part]) -> Vec<bool> {
    let mut holds = vec![false; parts.len()];
    for of in parts.iter().filter_map(|part| part.of) {
        holds[of] = true;
    }
    holds
}

/// The part of `parts` a node held by the region the part at `index` keeps moves into: that part
/// where it holds none, else its first part, to any depth (the human's decision of 2026-11-18).
fn first_leaf(parts: &[Part], holds: &[bool], index: usize) -> usize {
    let mut at = index;
    while holds[at] {
        // A part that holds parts holds one after it, the first of them next in the list.
        match (at + 1..parts.len()).find(|&next| parts[next].of == Some(at)) {
            Some(next) => at = next,
            None => break,
        }
    }
    at
}

/// The low and the high end of `rect` along `axis`.
const fn span(rect: &Rect, axis: usize) -> [f64; 2] {
    if axis == 0 {
        [rect.min_x, rect.max_x]
    } else {
        [rect.min_y, rect.max_y]
    }
}

/// `rect` with its ends along `axis` set to `ends`.
const fn with_span(rect: Rect, axis: usize, ends: [f64; 2]) -> Rect {
    if axis == 0 {
        Rect::new(ends[0], rect.min_y, ends[1], rect.max_y)
    } else {
        Rect::new(rect.min_x, ends[0], rect.max_x, ends[1])
    }
}

/// `value`, a coordinate or an extent within the world's limit, as the `f32` the engine keeps.
#[expect(
    clippy::cast_possible_truncation,
    reason = "a coordinate or an extent within the world's limit, far within f32"
)]
const fn kept(value: f64) -> f32 {
    value as f32
}

/// The least box, `width, height`, each of `parts` of the division `divide` of a node needs, in
/// their order, and the node itself, `top` high above them (ARCH-regions-are-container-slots,
/// *Division*): a region its band where it is named, at the start of what it divides, and what
/// its own parts need, at least `LEAST_REGION` a side; what is divided, along its division the sum
/// of its parts in their order, each at least its size, and across it the most of them. The one
/// computation of what a division grows a node to, which `arrange` lays out by and the bridge
/// checks against the world's limit before it divides. Parts that `check_order` refuses refuse it.
/// `top` must be finite and not negative: the old `needs()` held the node's need at 0 or more,
/// which this sum keeps only for such a `top`; the bridge's `content_top` never yields another.
pub fn division_needs(
    divide: Axis,
    top: f32,
    parts: &[Part],
) -> Result<(Vec<[f64; 2]>, [f64; 2]), DivideError> {
    check_order(parts)?;
    // The parts in each part, and in the node, in their order.
    let mut within: Vec<Vec<usize>> = vec![Vec::new(); parts.len()];
    let mut top_level = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        match part.of {
            Some(of) => within[of].push(index),
            None => top_level.push(index),
        }
    }
    // What `holds`, divided by `axis`, needs inside, from `needs` of the parts it holds.
    let inner = |holds: &[usize], axis: Axis, needs: &[[f64; 2]]| {
        let (a, b) = (axis.index(), 1 - axis.index());
        let mut inner = [0.0_f64; 2];
        for &index in holds {
            let need = needs[index];
            inner[a] += f64::from(parts[index].size).max(LEAST_REGION).max(need[a]);
            inner[b] = inner[b].max(need[b]);
        }
        inner
    };
    let mut needs = vec![[0.0_f64; 2]; parts.len()];
    // The deepest first: a part lies after the part it lies in.
    for (index, part) in parts.iter().enumerate().rev() {
        let along = part.of.and_then(|of| parts[of].divide).unwrap_or(divide);
        let band = match (part.named, along) {
            (false, _) => [0.0; 2],
            (true, Axis::Down) => [BAND, 0.0],
            (true, Axis::Across) => [0.0, BAND],
        };
        let held = part
            .divide
            .map_or([0.0; 2], |axis| inner(&within[index], axis, &needs));
        // A region is never less than the least region on either side.
        needs[index] = [0, 1].map(|k| (band[k] + held[k]).max(LEAST_REGION));
    }
    let node = inner(&top_level, divide, &needs);
    Ok((needs, [node[0], f64::from(top) + node[1]]))
}

/// Refuses `parts` where one lies in no part before it, or in a part that is divided in no
/// direction, as `Part` at its index.
fn check_order(parts: &[Part]) -> Result<(), DivideError> {
    for (index, part) in parts.iter().enumerate() {
        if part
            .of
            .is_some_and(|of| of >= index || parts[of].divide.is_none())
        {
            return Err(DivideError::Part { index });
        }
    }
    Ok(())
}

impl Graph {
    /// What the node in `slot` is of regions; a slot past the list is nothing of them.
    pub(super) fn division(&self, slot: u32) -> Division {
        self.divisions
            .get(slot as usize)
            .copied()
            .unwrap_or_default()
    }

    /// Writes what the node in `slot` is of regions.
    fn set_division(&mut self, slot: u32, division: Division) {
        let i = slot as usize;
        if self.divisions.len() <= i {
            self.divisions.resize(i + 1, Division::default());
        }
        self.divisions[i] = division;
    }

    /// Forgets what the node in a slot taken again was of regions.
    pub(super) fn forget_division(&mut self, slot: u32) {
        if let Some(division) = self.divisions.get_mut(slot as usize) {
            *division = Division::default();
        }
    }

    /// Whether the node in `slot` is a region.
    pub fn is_region(&self, slot: u32) -> bool {
        self.division(slot).region
    }

    /// The direction the node or region in `slot` is divided in, or none.
    pub fn divided(&self, slot: u32) -> Option<Axis> {
        self.division(slot).divide
    }

    /// Whether the node or region in `slot` is divided into regions: a container a node never lies
    /// in directly (ARCH-regions-are-container-slots, *Regions in a slot*).
    pub fn holds_regions(&self, slot: u32) -> bool {
        self.division(slot).divide.is_some()
    }

    /// The node a region in `slot` divides at its outermost, through every region it lies in; the
    /// slot itself where it is no region.
    pub fn divided_node(&self, slot: u32) -> u32 {
        let mut at = slot;
        while self.is_region(at) {
            let up = self.container(at);
            if up == CANVAS {
                break;
            }
            at = up;
        }
        at
    }

    /// The regions of the node or region in `slot`, at every depth: each region followed by its
    /// own, in the order of each division.
    pub fn regions_of(&self, slot: u32) -> Vec<u32> {
        let mut found = Vec::new();
        let mut stack: Vec<u32> = self.regions_in(slot).rev().collect();
        while let Some(region) = stack.pop() {
            found.push(region);
            stack.extend(self.regions_in(region).rev());
        }
        found
    }

    /// The regions that divide the node or region in `slot` directly, in order.
    fn regions_in(&self, slot: u32) -> impl DoubleEndedIterator<Item = u32> + '_ {
        self.held(slot)
            .iter()
            .copied()
            .filter(|&s| self.is_region(s))
    }

    /// Divides the node in `slot` into the regions `parts`, in the direction `divide`, below its
    /// content, `top` high, in place of the regions it has; or leaves it undivided where `divide`
    /// or `parts` is none (ARCH-regions-are-container-slots, *Division*). The one operation a
    /// division takes, in this order:
    ///
    /// - what each part `keeps` held directly, nodes and no regions, leaves that region: into the
    ///   part where it holds no parts, at its position relative to it, else into the first part
    ///   it holds, to any depth, at its world position (the human's decision of 2026-11-18);
    /// - what the node held directly, nodes and no regions, goes at its world position into the
    ///   region that holds that position, as a drop there lands, else into the first part, or that
    ///   part's first part to any depth (the maintainer's decisions of 2026-11-25);
    /// - the regions the node had go, with all they still hold and every edge at it
    ///   (*Removing a region*);
    /// - the node keeps the width its data gives, from which `arrange` grows it, is a container
    ///   while divided, and is none again once undivided where only its division made it one;
    /// - each part takes a slot, `slots` says which, and is marked a region and a container, with
    ///   a band where it is named, divided where parts lie in it;
    /// - `arrange` lays the regions out, and what each part keeps lands in it.
    ///
    /// Returns the slots of the regions in the order of `parts`, and of the nodes and the edges
    /// that went. A slot that holds no node, a region, or parts that `check_parts` refuses, refuse
    /// the call before it changes anything. Past the limit of node slots, which a caller checks
    /// first, it stops at the part that found no slot. `top` must be finite and not negative, as
    /// `division_needs` requires.
    pub fn divide(
        &mut self,
        slot: u32,
        divide: Option<Axis>,
        top: f32,
        parts: &[Part],
        slots: RegionSlots<'_>,
    ) -> Result<Divided, DivideError> {
        self.nodes_held(&[slot])?;
        if self.is_region(slot) {
            return Err(DivideError::Region { slot });
        }
        self.check_parts(slot, divide, parts, &slots)?;
        let divide = divide.filter(|_| !parts.is_empty());
        let parts = if divide.is_some() { parts } else { &[] };
        let old = self.regions_of(slot);
        let holds = holding(parts);
        let moved = self.take_out_kept(parts, &holds, &old);
        let tops: Vec<u32> = old
            .iter()
            .copied()
            .filter(|&r| self.container(r) == slot)
            .collect();
        let (nodes, edges) = self.remove_nodes(&tops)?;
        let marked = match slots {
            RegionSlots::Added => None,
            RegionSlots::Built { marked, .. } => Some(marked),
        };
        self.set_divided(slot, divide, top, marked);
        let regions = match slots {
            RegionSlots::Added => self.add_parts(slot, divide, parts)?,
            RegionSlots::Built { slots, .. } => slots.to_vec(),
        };
        for ((&region, part), &holds) in regions.iter().zip(parts).zip(&holds) {
            self.mark_region(region, part.named, part.divide.filter(|_| holds));
        }
        let direct = self.held_directly(slot, parts);
        self.arrange(slot);
        let mut moved = moved;
        for (held, at) in direct {
            let point = Point::new(at[0], at[1]);
            let into = self
                .region_at(&regions, point)
                .unwrap_or_else(|| first_leaf(parts, &holds, 0));
            moved.push((into, held, Landing::World(at)));
        }
        for (index, held, landing) in moved {
            let region = regions[index];
            let at = &self.positions[region as usize * 2..];
            let world = match landing {
                Landing::Relative([x, y]) => [f64::from(at[0]) + x, f64::from(at[1]) + y],
                Landing::World(world) => world,
            };
            // A node that lay in a region of the node, on the canvas since `take_out_kept`, or
            // directly in the node, which the part's region, a container just marked, now holds
            // at a finite world position.
            self.move_into(held, region)
                .unwrap_or_else(|_| unreachable!("a held node moves into a region just marked"));
            self.place(held, world[0], world[1])
                .unwrap_or_else(|_| unreachable!("a held node lands at a finite position"));
        }
        Ok(Divided {
            regions,
            nodes,
            edges,
        })
    }

    /// Refuses `parts` of the node in `slot` that `check_order` refuses, or where the slots a load
    /// `Built` for them are not one per part, each a node that lies in what its part divides and no
    /// region yet, or are built for a division in no direction, `divide` none.
    fn check_parts(
        &self,
        slot: u32,
        divide: Option<Axis>,
        parts: &[Part],
        slots: &RegionSlots<'_>,
    ) -> Result<(), DivideError> {
        check_order(parts)?;
        let RegionSlots::Built { slots: built, .. } = slots else {
            return Ok(());
        };
        if divide.is_none() && !built.is_empty() {
            return Err(DivideError::Part { index: 0 });
        }
        if built.len() != parts.len() {
            return Err(DivideError::Part {
                index: built.len().min(parts.len()),
            });
        }
        for (index, (&region, part)) in built.iter().zip(parts).enumerate() {
            let within = part.of.map_or(slot, |of| built[of]);
            let fits = self.holds_node(region)
                && self.is_container(region)
                && !self.is_region(region)
                && self.container(region) == within;
            if !fits {
                return Err(DivideError::Part { index });
            }
        }
        Ok(())
    }

    /// Takes what each of `parts` keeps of the regions `old` out onto the canvas, nodes and no
    /// regions, and returns where each goes: the index of its part, as `first_leaf` finds it, the
    /// node, and where it lands.
    fn take_out_kept(
        &mut self,
        parts: &[Part],
        holds: &[bool],
        old: &[u32],
    ) -> Vec<(usize, u32, Landing)> {
        let mut moved = Vec::new();
        for (index, part) in parts.iter().enumerate() {
            let Some(from) = part.keeps.filter(|from| old.contains(from)) else {
                continue;
            };
            let into = first_leaf(parts, holds, index);
            let origin = [0, 1].map(|axis| f64::from(self.positions[from as usize * 2 + axis]));
            for held in self.held_by(from) {
                if self.is_region(held) {
                    continue;
                }
                let at = [0, 1].map(|axis| f64::from(self.positions[held as usize * 2 + axis]));
                let landing = if into == index {
                    Landing::Relative([at[0] - origin[0], at[1] - origin[1]])
                } else {
                    Landing::World(at)
                };
                moved.push((into, held, landing));
            }
        }
        for &(_, held, _) in &moved {
            // A node a region holds, which the canvas takes.
            self.move_into(held, CANVAS)
                .unwrap_or_else(|_| unreachable!("the canvas takes a node a region holds"));
        }
        moved
    }

    /// The nodes the node in `slot` holds directly, no regions, each with its world position,
    /// which a division moves into a region (`region_at`); none where `parts` is empty, a
    /// division into none.
    fn held_directly(&self, slot: u32, parts: &[Part]) -> Vec<(u32, [f64; 2])> {
        if parts.is_empty() {
            return Vec::new();
        }
        self.held(slot)
            .iter()
            .copied()
            .filter(|&held| !self.is_region(held))
            .map(|held| {
                let at = [0, 1].map(|axis| f64::from(self.positions[held as usize * 2 + axis]));
                (held, at)
            })
            .collect()
    }

    /// The index in `regions`, the regions a division just laid out, of the region a node held
    /// directly at `point`, its world position, moves into: of the regions not divided again
    /// whose box holds the point, the last in the order of containers, as a drop there lands
    /// (`container_at`); none where no region holds it, which then takes the first region, or
    /// that region's first region (the maintainer's decisions of 2026-11-25, after the human's of
    /// 2026-11-18).
    fn region_at(&self, regions: &[u32], point: Point) -> Option<usize> {
        (0..regions.len())
            .filter(|&k| {
                let region = regions[k];
                !self.holds_regions(region) && self.node_bounds(region).contains(point)
            })
            .max_by_key(|&k| self.container_order[regions[k] as usize])
    }

    /// Adds a container for each of `parts` into what it divides, the node in `slot`, divided by
    /// `divide`, or the part it lies in, at its size along that division, at the node's top left
    /// corner, and returns their slots in their order.
    fn add_parts(
        &mut self,
        slot: u32,
        divide: Option<Axis>,
        parts: &[Part],
    ) -> Result<Vec<u32>, TooManySlots> {
        let at = [0, 1].map(|axis| self.positions[slot as usize * 2 + axis]);
        let mut added: Vec<u32> = Vec::with_capacity(parts.len());
        for part in parts {
            let (into, axis) = part
                .of
                .map_or((slot, divide), |of| (added[of], parts[of].divide));
            let mut size = [0.0; 2];
            size[axis.map_or(0, Axis::index)] = part.size;
            added.push(self.add_nested(into, true, [at[0], at[1], size[0], size[1]])?);
        }
        Ok(added)
    }

    /// Divides the node in `slot` in the direction `divide`, or takes its division for none, its
    /// regions below its content, `top` high, as `divide` says. `marked` says, for a node a load
    /// built a container for its regions, whether its data marks it one; none where it is a
    /// container by its data alone until it is divided here.
    fn set_divided(&mut self, slot: u32, divide: Option<Axis>, top: f32, marked: Option<bool>) {
        let mut division = self.division(slot);
        let width = self.sizes[slot as usize * 2];
        if divide.is_some() && division.divide.is_none() {
            division.width = width;
        }
        if divide.is_some() && marked == Some(false) {
            division.made = true;
        }
        if divide.is_some() && !self.is_container(slot) {
            self.mark_container(slot);
            division.made = true;
        }
        if divide.is_none() && division.divide.is_some() {
            // Undivided, it takes the width its data gives again, as a load of it would.
            self.sizes[slot as usize * 2] = division.width;
            self.reboxed(slot);
        }
        if divide.is_none() && division.made {
            // Its division alone made it a container, and it holds nothing once undivided.
            if let Some(mark) = self.is_container.get_mut(slot as usize) {
                *mark = false;
            }
            self.order_containers();
            division.made = false;
        }
        self.set_division(
            slot,
            Division {
                divide,
                top,
                ..division
            },
        );
    }

    /// Gives the divided node in `slot` the width its data gives, or a resize left, from which
    /// `arrange` grows it to what its regions need.
    pub(super) fn set_divided_width(&mut self, slot: u32, width: f32) {
        let division = self.division(slot);
        if division.divide.is_some() {
            self.set_division(slot, Division { width, ..division });
        }
    }

    /// Gives the divided node in `slot` the height of its content, `top`, below which its regions
    /// lie, and lays them out anew with `arrange`; a node that is not divided keeps nothing of it.
    /// A region, which holds no content, refuses it.
    pub fn set_top(&mut self, slot: u32, top: f32) -> Result<(), DivideError> {
        if self.is_region(slot) {
            return Err(DivideError::Region { slot });
        }
        let division = self.division(slot);
        if division.divide.is_some() {
            self.set_division(slot, Division { top, ..division });
            self.arrange(slot);
        }
        Ok(())
    }

    /// The height of the content of the divided node in `slot`, below which its regions lie.
    pub fn top(&self, slot: u32) -> f32 {
        self.division(slot).top
    }

    /// Marks the node in `slot`, a container in what it divides, a region of it, with a band where
    /// `band`, divided in the direction `divide` or not at all
    /// (ARCH-regions-are-container-slots, *Regions in a slot*).
    fn mark_region(&mut self, slot: u32, band: bool, divide: Option<Axis>) {
        self.set_division(
            slot,
            Division {
                region: true,
                band,
                divide,
                ..Division::default()
            },
        );
    }

    /// Marks the node in `slot` a container, among the containers by its rank.
    fn mark_container(&mut self, slot: u32) {
        let i = slot as usize;
        if self.is_container.len() <= i {
            self.is_container.resize(i + 1, false);
        }
        if self.held.len() <= i {
            self.held.resize(i + 1, Vec::new());
        }
        self.is_container[i] = true;
        self.order_containers();
    }

    /// The part of the box of the node or region in `slot` its regions do not divide, at its top
    /// and left: a divided node's content above them, and a region's band at its start, at the
    /// top of a region side by side with others, at the left of one above or below others.
    pub(super) fn inset(&self, slot: u32) -> [f64; 2] {
        let division = self.division(slot);
        if !division.region {
            return [0.0, f64::from(division.top)];
        }
        if !division.band {
            return [0.0; 2];
        }
        match self.divided(self.container(slot)) {
            Some(Axis::Down) => [BAND, 0.0],
            _ => [0.0, BAND],
        }
    }

    /// The least box each of the node or region in `slot` and its regions, at every depth, needs,
    /// `width, height`, by slot, as `division_needs` computes it from the regions as they stand.
    pub(super) fn needs(&self, slot: u32) -> HashMap<u32, [f64; 2]> {
        let regions = self.regions_of(slot);
        let index: HashMap<u32, usize> = regions.iter().enumerate().map(|(i, &r)| (r, i)).collect();
        let parts: Vec<Part> = regions
            .iter()
            .map(|&region| {
                let container = self.container(region);
                let along = self.divided(container).unwrap_or(Axis::Across);
                Part {
                    size: self.sizes[region as usize * 2 + along.index()],
                    named: self.division(region).band,
                    divide: self.divided(region),
                    of: index.get(&container).copied(),
                    keeps: None,
                }
            })
            .collect();
        let divide = self.divided(slot).unwrap_or(Axis::Across);
        let (each, node) = division_needs(divide, self.division(slot).top, &parts)
            .unwrap_or_else(|_| unreachable!("each region lies after the divided one it lies in"));
        regions
            .into_iter()
            .zip(each)
            .chain([(slot, node)])
            .collect()
    }

    /// Lays out the regions of the divided node in `slot` from their sizes, the extent of each
    /// along the direction of its division (ARCH-regions-are-container-slots, *Division*): the node
    /// grows from the width its data gives and the height it has to what its regions need, each
    /// region takes its size, or more where its own regions need it, the last of them the rest,
    /// and what each region holds moves with it, its position relative to the region kept. A slot
    /// that holds no divided node changes nothing.
    pub(super) fn arrange(&mut self, slot: u32) {
        if !self.holds_node(slot) || self.divided(slot).is_none() {
            return;
        }
        let needs = self.needs(slot);
        let need = needs[&slot];
        let i = slot as usize * 2;
        let size = [self.division(slot).width, self.sizes[i + 1]];
        let grown = [0, 1].map(|axis| f64::from(size[axis]).max(need[axis]));
        if grown != [f64::from(self.sizes[i]), f64::from(self.sizes[i + 1])] {
            self.sizes[i] = kept(grown[0]);
            self.sizes[i + 1] = kept(grown[1]);
            self.reboxed(slot);
        }
        self.lay_out_regions(slot, &needs);
    }

    /// Places the regions of the node in `slot`, whose box holds what they need, one after another
    /// from the start of the part they divide, at every depth, each what divides it first, as
    /// `arrange` says; then what each holds at its position relative to it.
    fn lay_out_regions(&mut self, slot: u32, needs: &HashMap<u32, [f64; 2]>) {
        let mut stack = vec![slot];
        while let Some(at) = stack.pop() {
            let Some(axis) = self.divided(at) else {
                continue;
            };
            let (a, b) = (axis.index(), 1 - axis.index());
            let bounds = self.node_bounds(at);
            let inset = self.inset(at);
            let lo = [bounds.min_x + inset[0], bounds.min_y + inset[1]];
            let (along, across) = (span(&bounds, a), span(&bounds, b));
            let regions: Vec<u32> = self.regions_in(at).collect();
            let mut sizes: Vec<f64> = regions
                .iter()
                .map(|&r| {
                    let size = f64::from(self.sizes[r as usize * 2 + a]);
                    size.max(LEAST_REGION).max(needs[&r][a])
                })
                .collect();
            let rest = along[1] - lo[a] - sizes.iter().sum::<f64>();
            if let Some(last) = sizes.last_mut()
                && rest > 0.0
            {
                *last += rest;
            }
            let mut start = lo[a];
            for (&region, size) in regions.iter().zip(sizes) {
                let mut lo_r = [0.0; 2];
                let mut hi_r = [0.0; 2];
                (lo_r[a], hi_r[a]) = (start, start + size);
                (lo_r[b], hi_r[b]) = (lo[b], across[1]);
                let r = region as usize * 2;
                for axis in 0..2 {
                    self.positions[r + axis] = kept(lo_r[axis]);
                    let from = f64::from(self.positions[r + axis]);
                    self.sizes[r + axis] = kept(hi_r[axis] - from);
                }
                self.keep_relative(region);
                self.reboxed(region);
                start += size;
                stack.push(region);
            }
        }
        // What each region holds, at its position relative to the region, which it kept.
        for region in self.regions_of(slot) {
            for held in self.held_by(region) {
                if self.is_region(held) {
                    continue;
                }
                let [x, y] = self.summed(held);
                self.place(held, x, y)
                    .unwrap_or_else(|_| unreachable!("a held node stays at its finite position"));
            }
        }
    }

    /// The farthest the side `side`, -1 the low or 1 the high, of the node or region in `slot` may
    /// move to along `axis`, its other side kept: no region less than `LEAST_REGION` along it or
    /// than its band, none leaving out a box of a node that lies directly in it, and its own
    /// regions each that far at the same side, the one at that side where they follow one another
    /// along `axis`, all of them where they lie side by side across it
    /// (ARCH-regions-are-container-slots, *Lines*). Each region is looked at once, the deepest
    /// first.
    pub(super) fn reach(&self, slot: u32, axis: usize, side: i8) -> f64 {
        let farther = |reach: f64, at: f64| {
            if side < 0 {
                reach.min(at)
            } else {
                reach.max(at)
            }
        };
        let mut reaches: HashMap<u32, f64> = HashMap::new();
        for at in self.regions_of(slot).into_iter().rev().chain([slot]) {
            let [lo, hi] = span(&self.node_bounds(at), axis);
            let inset = self.inset(at)[axis];
            let least = if self.is_region(at) {
                LEAST_REGION.max(inset)
            } else {
                inset
            };
            let mut reach = if side < 0 { hi - least } else { lo + least };
            for &held in self.held(at) {
                if self.is_region(held) {
                    continue;
                }
                let [h_lo, h_hi] = span(&self.node_bounds(held), axis);
                reach = farther(reach, if side < 0 { h_lo } else { h_hi });
            }
            if let Some(divide) = self.divided(at) {
                let regions: Vec<u32> = self.regions_in(at).collect();
                let at_side: &[u32] = if divide.index() != axis {
                    &regions
                } else if side < 0 {
                    &regions[..regions.len().min(1)]
                } else {
                    &regions[regions.len().saturating_sub(1)..]
                };
                // A region's low side lies the inset past the low side of what it divides.
                let shift = if side < 0 { inset } else { 0.0 };
                for region in at_side {
                    reach = farther(reach, reaches[region] - shift);
                }
            }
            reaches.insert(at, reach);
        }
        reaches[&slot]
    }

    /// Fits the regions of the node or region in `slot` into the box it has now, at every depth,
    /// each what divides it first: along the direction of its division the first region takes
    /// what its low side moved, the last what its high side moved, the others keep their extents,
    /// and across it each spans the part divided. What a region holds keeps its world position,
    /// its position relative to the region changed (ARCH-regions-are-container-slots, *Lines* and
    /// *Resizing what is divided*).
    pub(super) fn refit(&mut self, slot: u32) {
        let mut stack = vec![slot];
        while let Some(at) = stack.pop() {
            let Some(axis) = self.divided(at) else {
                continue;
            };
            let (a, b) = (axis.index(), 1 - axis.index());
            let bounds = self.node_bounds(at);
            let inset = self.inset(at);
            let lo = [bounds.min_x + inset[0], bounds.min_y + inset[1]];
            let (along, across) = (span(&bounds, a), span(&bounds, b));
            let regions: Vec<u32> = self.regions_in(at).collect();
            let last = regions.len().saturating_sub(1);
            for (n, &region) in regions.iter().enumerate() {
                let old = self.node_bounds(region);
                let mut ends = span(&old, a);
                if n == 0 {
                    ends[0] = lo[a];
                }
                if n == last {
                    ends[1] = along[1];
                }
                let new = with_span(with_span(old, a, ends), b, [lo[b], across[1]]);
                self.set_box(region, &new);
                stack.push(region);
            }
        }
    }

    /// Gives the node in `slot` the box `to`, what it holds kept where it lies in the world, its
    /// position relative to its container and theirs relative to it kept anew.
    fn set_box(&mut self, slot: u32, to: &Rect) {
        let i = slot as usize * 2;
        self.positions[i] = kept(to.min_x);
        self.positions[i + 1] = kept(to.min_y);
        self.sizes[i] = kept(to.max_x - f64::from(self.positions[i]));
        self.sizes[i + 1] = kept(to.max_y - f64::from(self.positions[i + 1]));
        if self.container(slot) != CANVAS {
            self.keep_relative(slot);
        }
        for held in self.held(slot).to_vec() {
            self.keep_relative(held);
        }
        self.reboxed(slot);
    }

    /// Moves the line after the region in `slot`, between it and the next region of what it
    /// divides, to `to` along the direction of their division, as far as the two regions and the
    /// regions inside them at the line allow (`reach`), and returns where it now stands. The two
    /// regions change their extents, the regions inside them at the line with them, to any depth;
    /// the others keep theirs, and what each holds keeps its world position
    /// (ARCH-regions-are-container-slots, *Lines*). A slot that holds no node, or no region with a
    /// region after it, refuses the call; a `to` that is not finite moves nothing.
    pub fn move_line(&mut self, slot: u32, to: f64) -> Result<f64, LineError> {
        self.nodes_held(&[slot])?;
        let (next, axis) = self.next_region(slot).ok_or(LineError::NoLine { slot })?;
        let a = axis.index();
        let before = self.node_bounds(slot);
        let at = span(&before, a)[1];
        if !to.is_finite() {
            return Ok(at);
        }
        let (low, high) = (self.reach(slot, a, 1), self.reach(next, a, -1));
        // Toward the pointer only, as far as the regions allow, and never back past where it
        // stands where a node they hold already overhangs them.
        let to = if to > at {
            to.min(high).max(at)
        } else {
            to.max(low).min(at)
        };
        if to == at {
            return Ok(at);
        }
        let after = self.node_bounds(next);
        let left = with_span(before, a, [span(&before, a)[0], to]);
        let right = with_span(after, a, [to, span(&after, a)[1]]);
        self.set_box(slot, &left);
        self.refit(slot);
        self.set_box(next, &right);
        self.refit(next);
        Ok(span(&self.node_bounds(slot), a)[1])
    }

    /// The region after the region in `slot` in what it divides, and the direction of their
    /// division; none where `slot` is no region or the last.
    fn next_region(&self, slot: u32) -> Option<(u32, Axis)> {
        if !self.is_region(slot) {
            return None;
        }
        let container = self.container(slot);
        let axis = self.divided(container)?;
        let mut regions = self.regions_in(container);
        regions.find(|&r| r == slot)?;
        regions.next().map(|next| (next, axis))
    }

    /// The region before the line within `reach` of `point`, of the lines between two regions,
    /// the line of the innermost regions where several are (REN-node-content-and-hits, *Line
    /// between regions*).
    pub(super) fn line_at(&mut self, point: Point, reach: f64) -> Option<u32> {
        if self.divisions.is_empty() {
            return None;
        }
        self.node_grid
            .candidates(&Rect::at(point).grown(reach), &mut self.scratch);
        let mut candidates = std::mem::take(&mut self.scratch);
        let found = candidates
            .iter()
            .copied()
            .filter(|&slot| {
                let Some((_, axis)) = self.next_region(slot) else {
                    return false;
                };
                let (a, b) = (axis.index(), 1 - axis.index());
                let bounds = self.node_bounds(slot);
                let p = [point.x, point.y];
                let [b_lo, b_hi] = span(&bounds, b);
                (p[a] - span(&bounds, a)[1]).abs() <= reach && b_lo <= p[b] && p[b] <= b_hi
            })
            .max_by_key(|&slot| self.container_order[slot as usize]);
        candidates.clear();
        self.scratch = candidates;
        found
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::Lcg;
    use super::super::{Handle, Level, MoveIntoError, Target, Visible};
    use super::*;

    /// A part of `size`, unnamed and undivided, in the part at `of`, or in the node for none.
    fn part(size: f32, of: Option<usize>) -> Part {
        Part {
            size,
            of,
            ..Part::default()
        }
    }

    #[test]
    fn a_division_needs_its_parts_summed_in_their_order_along_it_and_their_most_across_it() {
        // Verifies: ARCH-regions-are-container-slots
        // 2^60, then two of 100: in their order each 100 rounds away against 2^60, whose spacing
        // in f64 is 256; summed back to front, 200 would round 2^60 up by 256.
        let big = 2_f32.powi(60);
        let parts = [part(big, None), part(100.0, None), part(100.0, None)];
        let (each, node) = division_needs(Axis::Across, 30.0, &parts).unwrap();
        assert_eq!(node, [f64::from(big), LEAST_REGION + 30.0]);
        assert_eq!(each[1], [LEAST_REGION; 2]);
        // Within a named part divided down, the same order; its band on top, whose 24 rounds away
        // against 2^60 too.
        let parts = [
            Part {
                size: 50.0,
                named: true,
                divide: Some(Axis::Down),
                ..Part::default()
            },
            part(big, Some(0)),
            part(100.0, Some(0)),
            part(100.0, Some(0)),
        ];
        let (each, node) = division_needs(Axis::Across, 0.0, &parts).unwrap();
        assert_eq!(each[0], [LEAST_REGION, f64::from(big)]);
        assert_eq!(node, [50.0, f64::from(big)]);
    }

    #[test]
    fn a_division_s_needs_refuse_a_part_in_none_before_it_or_in_one_divided_in_no_direction() {
        // Verifies: ARCH-regions-are-container-slots
        let refused = |parts: &[Part]| division_needs(Axis::Across, 0.0, parts).err();
        assert_eq!(
            refused(&[part(10.0, Some(0))]),
            Some(DivideError::Part { index: 0 })
        );
        assert_eq!(
            refused(&[part(10.0, None), part(10.0, Some(5))]),
            Some(DivideError::Part { index: 1 })
        );
        assert_eq!(
            refused(&[part(10.0, None), part(10.0, Some(0))]),
            Some(DivideError::Part { index: 1 })
        );
        // The engine's division refuses them alike, and the graph is as it was.
        let mut graph = Graph::new(vec![0.0, 0.0], vec![100.0, 50.0], Vec::new()).unwrap();
        let parts = [part(10.0, None), part(10.0, Some(0))];
        assert_eq!(
            graph.divide(0, Some(Axis::Across), 0.0, &parts, RegionSlots::Added),
            Err(DivideError::Part { index: 1 })
        );
        assert!(graph.regions_of(0).is_empty());
    }

    #[test]
    fn a_region_refuses_a_division_and_a_top_of_its_own() {
        // Verifies: ARCH-regions-are-container-slots
        let mut graph = Graph::new(vec![0.0, 0.0], vec![100.0, 50.0], Vec::new()).unwrap();
        let parts = [part(40.0, None), part(40.0, None)];
        let divided = graph
            .divide(0, Some(Axis::Across), 10.0, &parts, RegionSlots::Added)
            .unwrap();
        let region = divided.regions[0];
        let sizes = graph.sizes().to_vec();
        assert_eq!(
            graph.divide(region, Some(Axis::Down), 0.0, &parts, RegionSlots::Added),
            Err(DivideError::Region { slot: region })
        );
        assert_eq!(
            graph.set_top(region, 30.0),
            Err(DivideError::Region { slot: region })
        );
        assert_eq!(graph.sizes(), sizes);
        assert_eq!(graph.set_top(0, 30.0), Ok(()));
    }

    /// A region of a test: its size, whether it has a name, and its own division and regions.
    struct Spec {
        size: f32,
        band: bool,
        divide: Option<Axis>,
        regions: Vec<Spec>,
    }

    fn leaf(size: f32, band: bool) -> Spec {
        Spec {
            size,
            band,
            divide: None,
            regions: Vec::new(),
        }
    }

    /// The parts of `specs`, depth first, each region followed by its own, those of `specs` lying
    /// in the part at `of`, or in the node for none.
    fn parts_of(specs: &[Spec], of: Option<usize>, parts: &mut Vec<Part>) {
        for spec in specs {
            let at = parts.len();
            parts.push(Part {
                size: spec.size,
                named: spec.band,
                divide: spec.divide,
                of,
                keeps: None,
            });
            parts_of(&spec.regions, Some(at), parts);
        }
    }

    /// Divides the node in `slot` by `axis` into the regions `specs`, depth first, each at its
    /// size along the division it lies in, below its content, `top` high, and returns their slots
    /// in that order.
    fn add_regions(graph: &mut Graph, slot: u32, axis: Axis, top: f32, specs: &[Spec]) -> Vec<u32> {
        let mut parts = Vec::new();
        parts_of(specs, None, &mut parts);
        let divided = graph.divide(slot, Some(axis), top, &parts, RegionSlots::Added);
        divided.unwrap().regions
    }

    /// An activity at (100, 100), 300 × 40, its content 30 high, divided across into three named
    /// partitions of 100, 150, and 100, the middle one divided down into one of 80 and a named
    /// one of 60; and a node, 50 × 30, in the first partition at (10, 40) relative to it.
    /// Slots: the activity 0, the partitions 1, 2, 3 in the order added, 2's regions 3 and 4, and
    /// the node after them.
    fn activity() -> (Graph, Vec<u32>, u32) {
        let mut graph = Graph::new(vec![100.0, 100.0], vec![300.0, 40.0], Vec::new()).unwrap();
        let specs = [
            leaf(100.0, true),
            Spec {
                size: 150.0,
                band: true,
                divide: Some(Axis::Down),
                regions: vec![leaf(80.0, false), leaf(60.0, true)],
            },
            leaf(100.0, true),
        ];
        let regions = add_regions(&mut graph, 0, Axis::Across, 30.0, &specs);
        let first = graph.node_bounds(regions[0]);
        let node = graph
            .add_node_in(
                regions[0],
                false,
                [
                    first.min_x as f32 + 10.0,
                    first.min_y as f32 + 40.0,
                    50.0,
                    30.0,
                ],
            )
            .unwrap();
        (graph, regions, node)
    }

    fn rect(graph: &Graph, slot: u32) -> [f64; 4] {
        let r = graph.node_bounds(slot);
        [r.min_x, r.min_y, r.max_x, r.max_y]
    }

    #[test]
    fn regions_tile_the_part_below_the_content_and_the_node_grows_to_what_they_need() {
        // Verifies: ARCH-regions-are-container-slots
        let (graph, r, node) = activity();
        // The partitions add up to 350 wide; the middle one needs its band, 24, and 80 + 60.
        assert_eq!(rect(&graph, 0), [100.0, 100.0, 450.0, 294.0]);
        assert_eq!(rect(&graph, r[0]), [100.0, 130.0, 200.0, 294.0]);
        assert_eq!(rect(&graph, r[1]), [200.0, 130.0, 350.0, 294.0]);
        // The middle partition's regions lie below its band.
        assert_eq!(rect(&graph, r[2]), [200.0, 154.0, 350.0, 234.0]);
        assert_eq!(rect(&graph, r[3]), [200.0, 234.0, 350.0, 294.0]);
        assert_eq!(rect(&graph, r[4]), [350.0, 130.0, 450.0, 294.0]);
        assert_eq!(rect(&graph, node), [110.0, 170.0, 160.0, 200.0]);
        assert_eq!(graph.regions_of(0), r);
        assert_eq!(graph.divided_node(r[3]), 0);
    }

    #[test]
    fn the_last_region_takes_the_rest_and_a_named_region_of_regions_one_above_another_has_its_band_at_the_left()
     {
        // Verifies: ARCH-regions-are-container-slots
        let mut graph = Graph::new(vec![0.0, 0.0], vec![200.0, 300.0], Vec::new()).unwrap();
        let specs = [
            Spec {
                size: 100.0,
                band: true,
                divide: Some(Axis::Across),
                regions: vec![leaf(50.0, false), leaf(50.0, false)],
            },
            leaf(50.0, false),
        ];
        let r = add_regions(&mut graph, 0, Axis::Down, 0.0, &specs);
        assert_eq!(rect(&graph, 0), [0.0, 0.0, 200.0, 300.0]);
        assert_eq!(rect(&graph, r[0]), [0.0, 0.0, 200.0, 100.0]);
        // Its band, 24 wide, at its left; the last of its regions takes the rest.
        assert_eq!(rect(&graph, r[1]), [24.0, 0.0, 74.0, 100.0]);
        assert_eq!(rect(&graph, r[2]), [74.0, 0.0, 200.0, 100.0]);
        assert_eq!(rect(&graph, r[3]), [0.0, 100.0, 200.0, 300.0]);
    }

    #[test]
    fn a_line_moves_its_two_regions_and_those_inside_them_and_stops_at_what_a_region_holds() {
        // Verifies: ARCH-regions-are-container-slots
        let (mut graph, r, node) = activity();
        assert_eq!(graph.move_line(r[0], 250.0), Ok(250.0));
        assert_eq!(rect(&graph, r[0]), [100.0, 130.0, 250.0, 294.0]);
        assert_eq!(rect(&graph, r[1]), [250.0, 130.0, 350.0, 294.0]);
        assert_eq!(rect(&graph, r[2]), [250.0, 154.0, 350.0, 234.0]);
        assert_eq!(rect(&graph, r[3]), [250.0, 234.0, 350.0, 294.0]);
        assert_eq!(rect(&graph, r[4]), [350.0, 130.0, 450.0, 294.0]);
        // Past the band of the lower region inside the middle partition, 24 wide at its left, and
        // the least region, it stops.
        assert_eq!(graph.move_line(r[0], 400.0), Ok(326.0));
        // Back past the node's box, it stops there; the node keeps its world position.
        assert_eq!(graph.move_line(r[0], 0.0), Ok(160.0));
        assert_eq!(rect(&graph, node), [110.0, 170.0, 160.0, 200.0]);
        // The line between the regions one above the other stops at the lower one's least.
        assert_eq!(graph.move_line(r[2], 1000.0), Ok(286.0));
        assert_eq!(
            graph.move_line(r[4], 0.0),
            Err(LineError::NoLine { slot: r[4] })
        );
        assert_eq!(graph.move_line(0, 0.0), Err(LineError::NoLine { slot: 0 }));
    }

    #[test]
    fn a_line_beside_a_node_that_overhangs_its_region_moves_only_toward_the_pointer() {
        // Verifies: ARCH-regions-are-container-slots
        let (mut graph, r, _) = activity();
        // A node in the first partition, 100 to 200, past its right side, as a load or a drop
        // leaves it.
        graph
            .add_node_in(r[0], false, [180.0, 250.0, 60.0, 20.0])
            .unwrap();
        // Dragged left, it stays where it stands rather than jump right to the node's box.
        assert_eq!(graph.move_line(r[0], 190.0), Ok(200.0));
        assert_eq!(rect(&graph, r[0])[2], 200.0);
        // Dragged right, it follows the pointer, short of the node's box too, and back no further.
        assert_eq!(graph.move_line(r[0], 220.0), Ok(220.0));
        assert_eq!(graph.move_line(r[0], 210.0), Ok(220.0));
    }

    #[test]
    fn a_resize_changes_the_region_at_the_side_it_pulls_and_no_other() {
        // Verifies: ARCH-regions-are-container-slots
        let (mut graph, r, node) = activity();
        graph.set_sizing(0, None, true).unwrap();
        let from = graph.node_bounds(0);
        graph
            .resize(0, Handle::BottomRight, &from, [50.0, 40.0], 30.0)
            .unwrap();
        assert_eq!(rect(&graph, r[0]), [100.0, 130.0, 200.0, 334.0]);
        assert_eq!(rect(&graph, r[4]), [350.0, 130.0, 500.0, 334.0]);
        // Inside the middle partition, the lower region takes the height.
        assert_eq!(rect(&graph, r[2]), [200.0, 154.0, 350.0, 234.0]);
        assert_eq!(rect(&graph, r[3]), [200.0, 234.0, 350.0, 334.0]);
        // At the left, the first partition, never past the node it holds.
        let from = graph.node_bounds(0);
        graph
            .resize(0, Handle::Left, &from, [200.0, 0.0], 30.0)
            .unwrap();
        assert_eq!(rect(&graph, r[0]), [110.0, 130.0, 200.0, 334.0]);
        assert_eq!(rect(&graph, node), [110.0, 170.0, 160.0, 200.0]);
    }

    #[test]
    fn a_division_anew_keeps_what_a_kept_region_held_and_removes_the_rest_in_one_operation() {
        // Verifies: ARCH-regions-are-container-slots
        let (mut graph, r, node) = activity();
        // A second node, in the third partition.
        let third = graph.node_bounds(r[4]);
        let other = graph
            .add_node_in(
                r[4],
                false,
                [
                    third.min_x as f32 + 5.0,
                    third.min_y as f32 + 30.0,
                    10.0,
                    10.0,
                ],
            )
            .unwrap();
        let before = rect(&graph, node);
        // The first partition is kept as a part divided down, the rest left out.
        let parts = [
            Part {
                size: 120.0,
                named: true,
                divide: Some(Axis::Down),
                keeps: Some(r[0]),
                ..Part::default()
            },
            Part {
                size: 90.0,
                of: Some(0),
                ..Part::default()
            },
            Part {
                size: 60.0,
                ..Part::default()
            },
        ];
        let divided = graph
            .divide(0, Some(Axis::Across), 30.0, &parts, RegionSlots::Added)
            .unwrap();
        assert_eq!(divided.regions.len(), 3);
        assert!(divided.nodes.contains(&other) && !divided.nodes.contains(&node));
        assert_eq!(graph.regions_of(0), divided.regions);
        // What the kept partition held lies in the first part it now holds, where it lay.
        assert_eq!(graph.container(node), divided.regions[1]);
        assert_eq!(rect(&graph, node), before);
        assert!(graph.holds_regions(divided.regions[0]));
        assert!(!graph.holds_regions(divided.regions[1]));
        // Into no parts, the node is undivided, no container, and as wide as before it was.
        let undivided = graph
            .divide(0, Some(Axis::Across), 30.0, &[], RegionSlots::Added)
            .unwrap();
        assert!(undivided.nodes.contains(&node));
        assert!(graph.regions_of(0).is_empty());
        assert_eq!(graph.divided(0), None);
        assert!(!graph.is_container(0));
        assert_eq!(graph.sizes()[0], 300.0);
    }

    #[test]
    fn a_move_into_a_node_or_a_region_divided_into_regions_is_refused_and_changes_nothing() {
        // Verifies: ARCH-regions-are-container-slots
        // A divided node holds its regions alone, as a load and a drop (`container_at`) hold it.
        let (mut graph, r, node) = activity();
        let before = (graph.positions().to_vec(), graph.ranks.clone());
        for divided in [0, r[1]] {
            assert_eq!(
                graph.move_into(node, divided),
                Err(MoveIntoError::NoContainer { slot: divided })
            );
            assert_eq!(graph.container(node), r[0]);
        }
        assert_eq!((graph.positions().to_vec(), graph.ranks.clone()), before);
        // Its regions not divided again take the node.
        assert_eq!(graph.move_into(node, r[2]), Ok(()));
        assert_eq!(graph.container(node), r[2]);
    }

    #[test]
    fn a_container_divided_moves_each_node_it_held_into_the_region_at_its_position_where_it_lay() {
        // Verifies: ARCH-regions-are-container-slots
        // The maintainer's decisions of 2026-11-25: what the node held directly goes, at its world
        // position, into the innermost region whose box holds its position, as a drop there would
        // land, and into the first region, or that region's first region, where none does, as a
        // kept region's content goes (the human's decision of 2026-11-18).
        let mut graph = Graph::default();
        let c = graph
            .add_node_in(CANVAS, true, [0.0, 0.0, 400.0, 200.0])
            .unwrap();
        let node = |graph: &mut Graph, within, x, y| {
            graph
                .add_node_in(within, false, [x, y, 10.0, 10.0])
                .unwrap()
        };
        // `a`, a container, and `z` in the first partition's part, `y` and `v` in the second's two
        // regions, `b` in `a`, and `w` beside every region.
        let a = graph
            .add_node_in(c, true, [20.0, 30.0, 80.0, 60.0])
            .unwrap();
        let b = node(&mut graph, a, 30.0, 40.0);
        let z = node(&mut graph, c, 10.0, 150.0);
        let y = node(&mut graph, c, 250.0, 20.0);
        let v = node(&mut graph, c, 250.0, 150.0);
        let w = node(&mut graph, c, 500.0, 20.0);
        let all = [a, b, z, y, v, w];
        let before = all.map(|s| rect(&graph, s));
        // Across into `r0` from 0 to 200 and `r1` from 200, `r1` down into two of 100 each.
        let parts = [
            Part {
                size: 200.0,
                ..Part::default()
            },
            Part {
                size: 200.0,
                divide: Some(Axis::Down),
                ..Part::default()
            },
            Part {
                size: 100.0,
                of: Some(1),
                ..Part::default()
            },
            Part {
                size: 100.0,
                of: Some(1),
                ..Part::default()
            },
        ];
        let divided = graph
            .divide(c, Some(Axis::Across), 0.0, &parts, RegionSlots::Added)
            .unwrap();
        assert!(divided.nodes.is_empty() && divided.edges.is_empty());
        let r = &divided.regions;
        assert_eq!(rect(&graph, r[0]), [0.0, 0.0, 200.0, 200.0]);
        assert_eq!(graph.held(c), &[r[0], r[1]]);
        let containers = all.map(|s| graph.container(s));
        assert_eq!(containers, [r[0], a, r[0], r[2], r[3], r[0]]);
        assert_eq!(all.map(|s| rect(&graph, s)), before);
        // A first part divided: a node beside every region goes into its first region.
        let mut graph = Graph::default();
        let c = graph
            .add_node_in(CANVAS, true, [0.0, 0.0, 400.0, 200.0])
            .unwrap();
        let w = node(&mut graph, c, 500.0, 20.0);
        let parts = [parts[1], parts[2], parts[3], parts[0]].map(|part| Part {
            of: part.of.map(|_| 0),
            ..part
        });
        let divided = graph
            .divide(c, Some(Axis::Across), 0.0, &parts, RegionSlots::Added)
            .unwrap();
        assert_eq!(graph.container(w), divided.regions[1]);
    }

    #[test]
    fn a_division_refuses_a_part_that_lies_in_none_before_it_or_a_built_slot_that_does_not_fit() {
        // Verifies: ARCH-regions-are-container-slots
        let mut graph =
            Graph::new(vec![0.0; 4], vec![100.0, 40.0, 10.0, 10.0], Vec::new()).unwrap();
        let late = [Part {
            of: Some(0),
            ..Part::default()
        }];
        let refused = graph.divide(0, Some(Axis::Across), 0.0, &late, RegionSlots::Added);
        assert_eq!(refused, Err(DivideError::Part { index: 0 }));
        // Slot 1 lies on the canvas, not in the node it would divide.
        let built = RegionSlots::Built {
            slots: &[1],
            marked: false,
        };
        let refused = graph.divide(0, Some(Axis::Across), 0.0, &[Part::default()], built);
        assert_eq!(refused, Err(DivideError::Part { index: 0 }));
        // Slot 1 put in the node, but built for a division in no direction.
        let nesting = super::super::Nesting {
            containers: vec![CANVAS, 0],
            is_container: vec![true, true],
        };
        let sizes = vec![100.0, 40.0, 10.0, 10.0];
        let mut built_in = Graph::nested(vec![0.0; 4], sizes, Vec::new(), nesting).unwrap();
        let undivided = RegionSlots::Built {
            slots: &[1],
            marked: true,
        };
        let refused = built_in.divide(0, None, 0.0, &[Part::default()], undivided);
        assert_eq!(refused, Err(DivideError::Part { index: 0 }));
        assert!(!built_in.is_region(1));
        let missing = graph.divide(7, None, 0.0, &[], RegionSlots::Added);
        assert_eq!(
            missing,
            Err(DivideError::Slot(SlotError::NoNode { slot: 7 }))
        );
        assert_eq!(graph.divided(0), None);
        assert!(!graph.is_container(0));
    }

    #[test]
    fn a_press_on_a_region_hits_the_node_it_divides_and_a_drop_lands_in_the_region() {
        // Verifies: ARCH-regions-are-container-slots
        let (mut graph, r, node) = activity();
        let hit = |graph: &mut Graph, x: f64, y: f64, level: Level| {
            graph.hit_at(Point::new(x, y), 1.0, level, false)
        };
        assert_eq!(
            hit(&mut graph, 200.0, 250.0, Level::Near),
            Some(Target::Line(r[0]))
        );
        assert_eq!(
            hit(&mut graph, 203.0, 250.0, Level::Middle),
            Some(Target::Line(r[0]))
        );
        // Within reach of two lines, the line of the innermost regions; none at the far level.
        assert_eq!(
            hit(&mut graph, 348.0, 234.0, Level::Near),
            Some(Target::Line(r[2]))
        );
        assert_eq!(
            hit(&mut graph, 348.0, 250.0, Level::Near),
            Some(Target::Line(r[1]))
        );
        assert_eq!(
            hit(&mut graph, 200.0, 250.0, Level::Far),
            Some(Target::Node(0))
        );
        assert_eq!(
            hit(&mut graph, 400.0, 250.0, Level::Near),
            Some(Target::Node(0))
        );
        assert_eq!(
            hit(&mut graph, 120.0, 180.0, Level::Near),
            Some(Target::Node(node))
        );
        // A drop: into the region under the point, never into the divided node itself.
        let point = |x, y| Point::new(x, y);
        assert_eq!(
            graph.container_at(point(400.0, 250.0), node),
            Ok(Some(r[4]))
        );
        assert_eq!(
            graph.container_at(point(300.0, 260.0), node),
            Ok(Some(r[3]))
        );
        assert_eq!(graph.container_at(point(300.0, 110.0), node), Ok(None));
        // On the band of the partition divided again, no container: it holds its regions alone.
        assert_eq!(graph.container_at(point(300.0, 140.0), node), Ok(None));
    }

    /// A random tree of regions below a node at `origin`: up to `depth` levels, each region named
    /// now and then, divided again now and then, its size from 4 to 120.
    fn random_specs(rng: &mut Lcg, depth: u32) -> Vec<Spec> {
        (0..1 + rng.below(3))
            .map(|_| {
                let divided = depth > 0 && rng.next() < 0.4;
                Spec {
                    size: rng.range(4.0, 120.0) as f32,
                    band: rng.next() < 0.4,
                    divide: divided.then(|| [Axis::Across, Axis::Down][rng.below(2) as usize]),
                    regions: if divided {
                        random_specs(rng, depth - 1)
                    } else {
                        Vec::new()
                    },
                }
            })
            .collect()
    }

    /// The division of the node or region in `slot` and its regions as a test builds them, read
    /// back by the graph alone where the test judges it: `regions_of` lists them, and a region's
    /// division, band, and container are the test's own.
    struct Tree {
        slot: u32,
        divide: Option<Axis>,
        band_axis: Option<usize>,
        children: Vec<Tree>,
    }

    fn tree_of(graph: &Graph, slot: u32, band_axis: Option<usize>) -> Tree {
        let divide = graph.divided(slot);
        let children = graph
            .held(slot)
            .iter()
            .copied()
            .filter(|&s| graph.is_region(s))
            .map(|s| {
                let band = graph.division(s).band;
                let axis = match divide {
                    Some(Axis::Down) => 0,
                    _ => 1,
                };
                tree_of(graph, s, band.then_some(axis))
            })
            .collect();
        Tree {
            slot,
            divide,
            band_axis,
            children,
        }
    }

    /// The lines of `tree` as a scan finds them: of each region but the last of a division, its
    /// slot, its depth below the divided node, and its line, the far side of its box along the
    /// division, as a rectangle without extent along it.
    fn lines_of(tree: &Tree, graph: &Graph, out: &mut Vec<(u32, u32, Rect)>) {
        fn walk(tree: &Tree, graph: &Graph, depth: u32, out: &mut Vec<(u32, u32, Rect)>) {
            let count = tree.children.len();
            for (n, child) in tree.children.iter().enumerate() {
                if let (Some(axis), true) = (tree.divide, n + 1 < count) {
                    let r = graph.node_bounds(child.slot);
                    let end = span(&r, axis.index())[1];
                    out.push((child.slot, depth, with_span(r, axis.index(), [end, end])));
                }
                walk(child, graph, depth + 1, out);
            }
        }
        walk(tree, graph, 0, out);
    }

    /// Asserts that the regions of `tree` tile what they divide, below its content or beside its
    /// band, each at least the least region along its direction, within `f32`'s rounding.
    fn assert_tiled(graph: &Graph, tree: &Tree, top: f64, tiled: &mut u32) {
        let Some(axis) = tree.divide else {
            return;
        };
        let (a, b) = (axis.index(), 1 - axis.index());
        let outer = graph.node_bounds(tree.slot);
        let mut inner = [outer.min_x, outer.min_y, outer.max_x, outer.max_y];
        inner[1] += top;
        if let Some(band) = tree.band_axis {
            inner[band] += BAND;
        }
        let close = |x: f64, y: f64| (x - y).abs() <= 1e-3 * (1.0 + x.abs());
        let mut at = inner[a];
        for child in &tree.children {
            let r = graph.node_bounds(child.slot);
            let [lo, hi] = span(&r, a);
            assert!(close(lo, at), "{} starts at {lo}, not {at}", child.slot);
            assert!(hi - lo >= LEAST_REGION - 1e-3, "{} too small", child.slot);
            let [c_lo, c_hi] = span(&r, b);
            assert!(close(c_lo, inner[b]) && close(c_hi, inner[b + 2]));
            at = hi;
            assert_tiled(graph, child, 0.0, tiled);
            *tiled += 1;
        }
        assert!(close(at, inner[a + 2]), "{} ends at {at}", tree.slot);
    }

    /// A divided node of the property test: its slot, its content's height, its regions at every
    /// depth, and the nodes that lie in some of them.
    struct Divided {
        node: u32,
        top: f32,
        regions: Vec<u32>,
        held: Vec<u32>,
    }

    /// The cases each clause of the property test rests on (`docs/CONVENTIONS.md`, *A random test
    /// counts the cases each clause rests on*).
    #[derive(Default)]
    struct Counts {
        tiled: u32,
        lines: u32,
        stopped: u32,
        resized: u32,
        hits: u32,
        found: u32,
        on_lines: u32,
    }

    /// Three nodes far apart, each divided at random into a random tree of regions, a small node in
    /// about half of the regions not divided again.
    fn random_round(rng: &mut Lcg, round: u32) -> (Graph, Vec<Divided>) {
        let mut graph = Graph::new(Vec::new(), Vec::new(), Vec::new()).unwrap();
        let mut nodes = Vec::new();
        for n in 0..3_u8 {
            let origin = [f32::from(n) * 3000.0, round as f32 * 10.0];
            let node = graph.add_node(origin[0], origin[1], 50.0, 20.0).unwrap();
            let axis = [Axis::Across, Axis::Down][rng.below(2) as usize];
            let top = [0.0, 30.0][rng.below(2) as usize];
            let specs = random_specs(rng, 3);
            let regions = add_regions(&mut graph, node, axis, top, &specs);
            graph.set_sizing(node, None, true).unwrap();
            let mut held = Vec::new();
            for &region in &regions {
                if graph.divided(region).is_none() && rng.next() < 0.5 {
                    let r = graph.node_bounds(region);
                    let at = [r.min_x as f32 + 2.0, r.max_y as f32 - 6.0];
                    let slot = graph
                        .add_node_in(region, false, [at[0], at[1], 4.0, 4.0])
                        .unwrap();
                    held.push(slot);
                }
            }
            nodes.push(Divided {
                node,
                top,
                regions,
                held,
            });
        }
        (graph, nodes)
    }

    /// Moves a random line of `d` or resizes it by a random handle, and asserts that what its
    /// regions hold stayed where it lay, inside them, and that they tile what they divide.
    fn random_step(graph: &mut Graph, rng: &mut Lcg, d: &Divided, counts: &mut Counts) {
        let boxes: Vec<Rect> = d.held.iter().map(|&h| graph.node_bounds(h)).collect();
        if rng.next() < 0.5 {
            let region = d.regions[rng.below(d.regions.len()) as usize];
            let at = graph.node_bounds(region);
            let to = at.max_x.max(at.max_y) + rng.range(-300.0, 300.0);
            if let Ok(moved) = graph.move_line(region, to) {
                counts.lines += 1;
                counts.stopped += u32::from(moved != to);
            }
        } else {
            let handle = Handle::ALL[rng.below(8) as usize];
            let from = graph.node_bounds(d.node);
            let by = [rng.range(-200.0, 200.0), rng.range(-200.0, 200.0)];
            graph
                .resize(d.node, handle, &from, by, f64::from(d.top))
                .unwrap();
            counts.resized += 1;
        }
        // What a region holds stays where it lay, inside it within `f32`'s rounding.
        for (&h, before) in d.held.iter().zip(&boxes) {
            assert_eq!(graph.node_bounds(h), *before);
            let region = graph.node_bounds(graph.container(h));
            assert!(
                region.grown(1e-3).contains_rect(before),
                "{h} left its region"
            );
        }
        let tree = tree_of(graph, d.node, None);
        assert_tiled(graph, &tree, f64::from(d.top), &mut counts.tiled);
    }

    /// Whether `point` lies within `LINE_REACH` of `line`, a rectangle without extent along the
    /// direction of its division, between its ends.
    fn near_line(line: &Rect, point: Point) -> bool {
        let reach = if line.max_x - line.min_x > line.max_y - line.min_y {
            Rect::new(
                line.min_x,
                line.min_y - LINE_REACH,
                line.max_x,
                line.max_y + LINE_REACH,
            )
        } else {
            Rect::new(
                line.min_x - LINE_REACH,
                line.min_y,
                line.max_x + LINE_REACH,
                line.max_y,
            )
        };
        reach.contains(point)
    }

    /// Asserts at a random point near one of `nodes` that a query and a hit test find what a scan
    /// of every box and every line finds.
    fn random_probe(graph: &mut Graph, rng: &mut Lcg, nodes: &[Divided], counts: &mut Counts) {
        let slots: Vec<u32> = (0..graph.nodes_in_use()).collect();
        let around = graph
            .node_bounds(nodes[rng.below(nodes.len()) as usize].node)
            .grown(20.0);
        let (x, y) = (
            rng.range(around.min_x, around.max_x),
            rng.range(around.min_y, around.max_y),
        );
        let rect = Rect::new(x, y, x + rng.range(0.0, 200.0), y + rng.range(0.0, 200.0));
        let mut out = Visible::default();
        graph.query(&rect, Level::Middle, 1.0, 0.0, &mut out);
        let mut queried: Vec<u32> = out.containers.iter().chain(&out.nodes).copied().collect();
        queried.sort_unstable();
        let meets = |s: &u32| graph.node_bounds(*s).meets(&rect);
        let scanned: Vec<u32> = slots.iter().copied().filter(meets).collect();
        assert_eq!(queried, scanned);
        counts.found += u32::from(scanned.iter().any(|&s| graph.is_region(s)));
        // At the far level no line is hit: a node above the regions it lies in, else a region,
        // named as the node it divides, else the divided node.
        let point = Point::new(x, y);
        let holds = |s: &u32| graph.node_bounds(*s).contains(point);
        let holding: Vec<u32> = slots.iter().copied().filter(holds).collect();
        let expected = holding
            .iter()
            .copied()
            .find(|&s| !graph.is_container(s))
            .or_else(|| holding.iter().copied().find(|&s| !graph.is_region(s)));
        let hit = graph.hit_at(point, 1.0, Level::Far, false);
        assert_eq!(hit, expected.map(Target::Node), "{point:?}");
        counts.hits += u32::from(expected.is_some());
        // At the near level a line within reach comes first, the innermost of them.
        let mut lines = Vec::new();
        for d in nodes {
            lines_of(&tree_of(graph, d.node, None), graph, &mut lines);
        }
        let on: Vec<(u32, u32)> = lines
            .iter()
            .filter(|(_, _, line)| near_line(line, point))
            .map(|&(slot, depth, _)| (depth, slot))
            .collect();
        match graph.hit_at(point, 1.0, Level::Near, false) {
            Some(Target::Line(slot)) => {
                let deepest = on.iter().map(|&(depth, _)| depth).max();
                assert!(on.contains(&(deepest.unwrap(), slot)), "{point:?}");
                counts.on_lines += 1;
            }
            hit => {
                assert!(on.is_empty(), "{point:?} missed {on:?}");
                assert_eq!(hit, expected.map(Target::Node), "{point:?}");
            }
        }
    }

    #[test]
    fn regions_of_random_trees_tile_what_they_divide_through_moved_lines_and_resizes_and_are_found_where_a_scan_finds_them()
     {
        // Verifies: ARCH-regions-are-container-slots
        let mut rng = Lcg(7);
        let mut counts = Counts::default();
        for round in 0..60 {
            let (mut graph, nodes) = random_round(&mut rng, round);
            for _ in 0..8 {
                for d in &nodes {
                    random_step(&mut graph, &mut rng, d, &mut counts);
                }
            }
            for _ in 0..40 {
                random_probe(&mut graph, &mut rng, &nodes, &mut counts);
            }
        }
        let Counts {
            tiled,
            lines,
            stopped,
            resized,
            hits,
            found,
            on_lines,
        } = counts;
        assert!(tiled > 1000 && lines > 200 && stopped > 50 && resized > 200);
        assert!(hits > 200 && found > 200, "{hits} hits, {found} found");
        assert!(on_lines > 20, "{on_lines} lines hit");
    }
}
