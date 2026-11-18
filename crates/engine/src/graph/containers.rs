//! Containers (ARCH-engine-edits-nested-graph): which node each node lies in, checked so that a
//! node lies only in a container and never in itself or in a node it holds; the world position of
//! each node, the sum of the positions along its chain of containers; and the order in which
//! containers are drawn and hit, each after its own container.

use std::collections::HashSet;

use super::{Graph, MoveIntoError, SlotError};
use crate::geometry::{Point, Rect};

/// The container of a node that lies on the canvas.
pub const CANVAS: u32 = u32::MAX;

/// Which node each node of a load lies in, and which nodes are containers: per node slot the slot
/// of its container or `CANVAS`, and whether it is a container.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Nesting {
    pub containers: Vec<u32>,
    pub is_container: Vec<bool>,
}

/// Why a nesting was refused, naming the first node in slot order whose container is wrong
/// (ARCH-engine-edits-nested-graph).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NestError {
    /// The node's container names a slot that holds no node.
    NoNode { node: u32 },
    /// The node's container is a node that is no container.
    NotAContainer { node: u32 },
    /// The node lies in itself, or in a node it holds.
    InItself { node: u32 },
}

impl Nesting {
    /// The nesting of `count` nodes on the canvas, none of them a container.
    #[cfg(test)]
    pub(crate) fn on_canvas(count: usize) -> Self {
        Self {
            containers: vec![CANVAS; count],
            is_container: vec![false; count],
        }
    }

    /// How many nodes it names.
    fn count(&self) -> usize {
        self.containers.len()
    }

    /// The container of the node in `slot`, or none where it lies on the canvas.
    fn container_of(&self, slot: usize) -> Option<usize> {
        let container = self.containers[slot];
        (container != CANVAS).then_some(container as usize)
    }

    /// Refuses the nesting where a node lies in a slot that holds no node, in a node that is no
    /// container, or in itself or a node it holds, naming the first such node in slot order, each
    /// node's container judged in that order of its rules. Marks shorter than the nodes name the
    /// first node without a mark as one in no node; marks past the nodes name no node and are not
    /// read, and `Graph::nested` refuses lists of unequal length as a mismatch.
    pub fn check(&self) -> Result<(), NestError> {
        let count = self.count();
        let marked = self.is_container.len();
        if marked < count {
            return Err(NestError::NoNode {
                node: slot32(marked),
            });
        }
        let cycles = self.on_cycles();
        for (node, &on_cycle) in cycles.iter().enumerate() {
            let Some(container) = self.container_of(node) else {
                continue;
            };
            let node32 = slot32(node);
            if container >= count {
                return Err(NestError::NoNode { node: node32 });
            }
            if !self.is_container[container] {
                return Err(NestError::NotAContainer { node: node32 });
            }
            if on_cycle {
                return Err(NestError::InItself { node: node32 });
            }
        }
        Ok(())
    }

    /// Whether each node lies on a cycle of containers, in itself or in a node it holds: found by
    /// one walk up from each node, each node walked once, in time linear in the nodes. A walk stops
    /// at the canvas, at a slot beyond the nodes, and at a node that is no container, which `check`
    /// refuses on their own.
    fn on_cycles(&self) -> Vec<bool> {
        let count = self.count();
        // 0: not walked; 1: on the walk under way; 2: walked.
        let mut state = vec![0_u8; count];
        let mut cycles = vec![false; count];
        let mut walk = Vec::new();
        for start in 0..count {
            walk.clear();
            let mut at = start;
            loop {
                match state[at] {
                    2 => break,
                    1 => {
                        // Back on the walk under way: every node from `at` on lies on the cycle.
                        let from = walk.iter().position(|&n| n == at).unwrap_or(walk.len());
                        for &n in &walk[from..] {
                            cycles[n] = true;
                        }
                        break;
                    }
                    _ => {}
                }
                state[at] = 1;
                walk.push(at);
                match self.container_of(at) {
                    Some(up) if up < count && self.is_container[up] => at = up,
                    _ => break,
                }
            }
            for &n in &walk {
                state[n] = 2;
            }
        }
        cycles
    }

    /// The world position of each node, `x, y` per slot, from `relative`, its position relative to
    /// its container's top left corner, or a world position on the canvas: the sum of the positions
    /// along its chain of containers, in `f64`, each node summed once. The nesting must pass
    /// `check`; a node past the chain's end counts as on the canvas.
    pub fn world(&self, relative: &[f32]) -> Vec<f64> {
        let count = self.count();
        let mut world = vec![0.0; count * 2];
        let mut done = vec![false; count];
        let mut walk = Vec::new();
        for start in 0..count {
            walk.clear();
            let mut at = start;
            // Up to the first node summed already, or to the canvas.
            let mut base = (0.0, 0.0);
            loop {
                if done[at] {
                    base = (world[at * 2], world[at * 2 + 1]);
                    break;
                }
                walk.push(at);
                // A chain longer than the nodes is a cycle, which `check` refuses.
                match self.container_of(at) {
                    Some(up) if up < count && walk.len() <= count => at = up,
                    _ => break,
                }
            }
            // Down again, each node its container's world position plus its own.
            for &n in walk.iter().rev() {
                base.0 += f64::from(relative[n * 2]);
                base.1 += f64::from(relative[n * 2 + 1]);
                world[n * 2] = base.0;
                world[n * 2 + 1] = base.1;
                done[n] = true;
            }
        }
        world
    }
}

/// Grows `list` with `fill` until it holds index `i`, so that a list kept only once a graph nests
/// takes a slot past its end.
fn grow_to<T: Clone>(list: &mut Vec<T>, i: usize, fill: T) {
    if list.len() <= i {
        list.resize(i + 1, fill);
    }
}

/// The slot of a node of a nesting, whose nodes are numbered in a `u32` as every slot is.
#[expect(
    clippy::cast_possible_truncation,
    reason = "a node of a nesting the graph numbers in u32 slots, whose count `slot` checked"
)]
fn slot32(index: usize) -> u32 {
    index as u32
}

impl Graph {
    /// Whether the node in `slot` is a container.
    pub fn is_container(&self, slot: u32) -> bool {
        self.is_container.get(slot as usize) == Some(&true)
    }

    /// The container of the node in `slot`, or `CANVAS`.
    pub fn container(&self, slot: u32) -> u32 {
        self.containers
            .get(slot as usize)
            .copied()
            .unwrap_or(CANVAS)
    }

    /// The slots the container in `slot` holds directly, in the order they joined it.
    pub(super) fn held(&self, slot: u32) -> &[u32] {
        self.held.get(slot as usize).map_or(&[], Vec::as_slice)
    }

    /// The slots the container in `slot` holds directly, in the order they joined it, as a list
    /// of its own.
    pub fn held_by(&self, slot: u32) -> Vec<u32> {
        self.held(slot).to_vec()
    }

    /// The nodes in `slots` and everything each holds, at every depth, each once: each named node
    /// followed by what it holds, depth first, in the order each joined its container; a node
    /// named after a container that holds it comes where that container's content lists it. A
    /// slot that holds no node refuses the call (ARCH-engine-edits-nested-graph).
    pub fn with_held(&self, slots: &[u32]) -> Result<Vec<u32>, SlotError> {
        self.nodes_held(slots)?;
        let mut found = Vec::with_capacity(slots.len());
        let mut seen = HashSet::new();
        let mut stack = Vec::new();
        for &slot in slots {
            stack.push(slot);
            while let Some(node) = stack.pop() {
                if !seen.insert(node) {
                    continue;
                }
                found.push(node);
                stack.extend(self.held(node).iter().rev());
            }
        }
        Ok(found)
    }

    /// What a removal of the nodes in `slots` takes along, named before anything is removed: the
    /// nodes, as `with_held` names them, and the edges at any of them, in ascending order
    /// (ARCH-engine-edits-nested-graph, *Removing a container*). A slot that holds no node refuses
    /// the call.
    pub fn removal(&self, slots: &[u32]) -> Result<(Vec<u32>, Vec<u32>), SlotError> {
        let nodes = self.with_held(slots)?;
        let edges = self.edges_at(&nodes)?;
        Ok((nodes, edges))
    }

    /// Puts the node just added in `slot` into `container`, or onto the canvas for `CANVAS`, and
    /// marks it a container where `is_container`; a container added takes its place among the
    /// containers by its rank, above its siblings. The container holds a container, which the
    /// caller checked.
    pub(super) fn nest_added(&mut self, slot: u32, container: u32, is_container: bool) {
        if container == CANVAS && !is_container {
            return;
        }
        let i = slot as usize;
        grow_to(&mut self.containers, i, CANVAS);
        grow_to(&mut self.is_container, i, false);
        grow_to(&mut self.held, i, Vec::new());
        self.containers[i] = container;
        self.is_container[i] = is_container;
        if container != CANVAS {
            self.held[container as usize].push(slot);
            self.keep_relative(slot);
        }
        if is_container {
            self.order_containers();
        }
    }

    /// Keeps the position of the node in `slot`, which lies in a container, relative to its
    /// container, from the world positions both hold now (`relative`).
    pub(super) fn keep_relative(&mut self, slot: u32) {
        let [i, c] = [slot as usize * 2, self.container(slot) as usize * 2];
        let at = |axis: usize| f64::from(self.positions[i + axis]);
        let origin = |axis: usize| f64::from(self.positions[c + axis]);
        let relative = [at(0) - origin(0), at(1) - origin(1)];
        grow_to(&mut self.relative, slot as usize, [0.0; 2]);
        self.relative[slot as usize] = relative;
    }

    /// The world position of the node in `slot`, which lies in a container, as the sum of its
    /// container's world position and its own relative to it (`relative`).
    pub(super) fn summed(&self, slot: u32) -> [f64; 2] {
        let c = self.container(slot) as usize * 2;
        let [x, y] = self.relative[slot as usize];
        [
            f64::from(self.positions[c]) + x,
            f64::from(self.positions[c + 1]) + y,
        ]
    }

    /// Takes `nesting`, which `check` passed, as the containers of the loaded nodes: the lists of
    /// what each container holds and the order of the containers.
    pub(super) fn nest(&mut self, nesting: Nesting) {
        let count = nesting.count();
        let mut held = vec![Vec::new(); count];
        for node in 0..count {
            if let Some(container) = nesting.container_of(node) {
                held[container].push(slot32(node));
            }
        }
        self.containers = nesting.containers;
        self.is_container = nesting.is_container;
        self.held = held;
        self.relative = Vec::new();
        for node in 0..count {
            let slot = slot32(node);
            if self.container(slot) != CANVAS {
                self.keep_relative(slot);
            }
        }
        self.order_containers();
    }

    /// Takes the node in `slot` out of its container and out of being one: what it held lies on
    /// the canvas, at the world position it had, so that no node points at a freed slot.
    pub(super) fn forget_nesting(&mut self, slot: u32) {
        let i = slot as usize;
        let container = self.container(slot);
        if container != CANVAS {
            self.held[container as usize].retain(|&s| s != slot);
            self.containers[i] = CANVAS;
        }
        if let Some(held) = self.held.get_mut(i) {
            for s in std::mem::take(held) {
                self.containers[s as usize] = CANVAS;
            }
        }
        if let Some(mark) = self.is_container.get_mut(i) {
            *mark = false;
        }
    }

    /// Puts the node in `slot` into the container in `container`, or onto the canvas for
    /// `CANVAS`, at the world position it has, so that its position relative to its container
    /// changes, and gives it the next rank, as an added node takes it; a container takes its place
    /// among the containers by it (ARCH-engine-edits-nested-graph, *Moving into a container*). A
    /// slot that holds no node, a container that holds no container, and a container that is the
    /// node or a node it holds refuse the move, the shell's own mistakes, and the graph stays as
    /// it was. A move into the node's own container changes nothing, its rank kept, as a drop
    /// within it keeps its rank (API-edits-report-nested-changes, *Vetoes*).
    pub fn move_into(&mut self, slot: u32, container: u32) -> Result<(), MoveIntoError> {
        self.nodes_held(&[slot])?;
        if container == self.container(slot) {
            return Ok(());
        }
        if container != CANVAS {
            if !(self.holds_node(container) && self.is_container(container)) {
                return Err(MoveIntoError::NoContainer { slot: container });
            }
            if self.lies_in(container, slot) {
                return Err(MoveIntoError::InItself { slot: container });
            }
        }
        let rank = self.take_rank();
        self.next_rank += 1;
        let i = slot as usize;
        self.ranks[i] = rank;
        let own = self.container(slot);
        if own != CANVAS {
            self.held[own as usize].retain(|&s| s != slot);
        }
        grow_to(&mut self.containers, i, CANVAS);
        self.containers[i] = container;
        if container != CANVAS {
            self.held[container as usize].push(slot);
            self.keep_relative(slot);
        }
        if self.is_container(slot) {
            self.order_containers();
        }
        Ok(())
    }

    /// The container a drop of the node in `dragged` at `point` lands in: of the containers whose
    /// outline holds `point`, neither `dragged` nor a node it holds at any depth, nor a node or a
    /// region divided into regions, whose regions take a drop in its place, the last in the order
    /// of containers; none for the canvas (API-edits-report-nested-changes, *Vetoes*). A slot that
    /// holds no node refuses the call.
    pub fn container_at(&mut self, point: Point, dragged: u32) -> Result<Option<u32>, SlotError> {
        self.nodes_held(&[dragged])?;
        self.node_grid
            .candidates(&Rect::at(point), &mut self.scratch);
        Ok(self
            .scratch
            .iter()
            .copied()
            .filter(|&s| {
                self.is_container(s)
                    && !self.holds_regions(s)
                    && !self.lies_in(s, dragged)
                    && self.within_outline(s, point)
            })
            .max_by_key(|&s| self.container_order[s as usize]))
    }

    /// Whether the node in `node` is the node in `slot` or lies in it, at any depth: one walk up
    /// its chain of containers, which `Nesting::check` and `move_into` keep free of cycles.
    pub(super) fn lies_in(&self, node: u32, slot: u32) -> bool {
        let mut at = node;
        while at != CANVAS {
            if at == slot {
                return true;
            }
            at = self.container(at);
        }
        false
    }

    /// Numbers the containers in the order they are drawn and hit
    /// (ARCH-engine-edits-nested-graph): a container after its own container, and containers in
    /// one container, or on the canvas, in the order of their ranks, each followed by what it
    /// contains.
    pub(super) fn order_containers(&mut self) {
        let by_rank = |graph: &Self, list: &mut Vec<u32>| {
            list.sort_unstable_by_key(|&s| graph.ranks[s as usize]);
        };
        let mut roots: Vec<u32> = self
            .node_slots
            .in_use_slots()
            .filter(|&s| self.is_container(s) && self.container(s) == CANVAS)
            .collect();
        by_rank(self, &mut roots);
        let mut order = vec![0; self.is_container.len()];
        let mut next = 0;
        // Depth first, the stack holding what is still to come in reverse.
        let mut stack: Vec<u32> = roots.into_iter().rev().collect();
        let mut children = Vec::new();
        while let Some(container) = stack.pop() {
            order[container as usize] = next;
            next += 1;
            children.clear();
            children.extend(
                self.held(container)
                    .iter()
                    .copied()
                    .filter(|&s| self.is_container(s)),
            );
            by_rank(self, &mut children);
            stack.extend(children.iter().rev());
        }
        self.container_order = order;
    }

    /// Where the node in `slot` is drawn and hit among the nodes, the higher above the lower: every
    /// node that is no container above every container, the others by their rank, and containers
    /// by their order (ARCH-engine-edits-nested-graph).
    pub(super) fn draw_key(&self, slot: u32) -> (bool, u32) {
        if self.is_container(slot) {
            (false, self.container_order[slot as usize])
        } else {
            (true, self.ranks[slot as usize])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nesting(containers: &[u32], is_container: &[bool]) -> Nesting {
        Nesting {
            containers: containers.to_vec(),
            is_container: is_container.to_vec(),
        }
    }

    #[test]
    fn a_node_in_no_node_in_a_node_that_is_no_container_or_in_itself_is_refused() {
        // Verifies: ARCH-engine-edits-nested-graph
        let c = CANVAS;
        assert_eq!(nesting(&[c, 0], &[true, false]).check(), Ok(()));
        assert_eq!(
            nesting(&[c, 2], &[true, false]).check(),
            Err(NestError::NoNode { node: 1 })
        );
        assert_eq!(
            nesting(&[c, 0], &[false, false]).check(),
            Err(NestError::NotAContainer { node: 1 })
        );
        // In itself.
        assert_eq!(
            nesting(&[c, 1], &[false, true]).check(),
            Err(NestError::InItself { node: 1 })
        );
        // In a node it holds: 0 in 2, 2 in 1, 1 in 0; node 3 in the cycle but not on it.
        assert_eq!(
            nesting(&[2, 0, 1, 1], &[true, true, true, false]).check(),
            Err(NestError::InItself { node: 0 })
        );
        // The first node in slot order is named, whatever its rule.
        assert_eq!(
            nesting(&[c, 0, 3, 2], &[false, false, true, true]).check(),
            Err(NestError::NotAContainer { node: 1 })
        );
        // Lists of unequal length name the first node past the shorter.
        assert_eq!(
            nesting(&[c, c], &[false]).check(),
            Err(NestError::NoNode { node: 1 })
        );
        assert_eq!(nesting(&[c], &[false, true]).check(), Ok(()));
    }

    #[test]
    fn a_world_position_is_the_sum_along_the_chain_of_containers() {
        // Verifies: ARCH-engine-edits-nested-graph
        // 2 in 0 on the canvas, 1 in 2, 3 on the canvas; listed before their containers.
        let c = CANVAS;
        let n = nesting(&[c, 2, 0, c], &[true, false, true, false]);
        let relative = [100.0, 200.0, 5.0, 6.0, 10.0, 20.0, -7.0, -8.0];
        assert_eq!(
            n.world(&relative),
            [100.0, 200.0, 115.0, 226.0, 110.0, 220.0, -7.0, -8.0]
        );
    }
}
