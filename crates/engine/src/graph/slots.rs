//! The slots of one kind, nodes or edges, the graph keeps one each of (ADR-0022): how many there
//! are, which of them are free, and the list of the free ones, the one freed last taken first.

use super::{TooManySlots, slot};

/// The slots of a kind: those a load numbered and those additions appended, free ones among them.
#[derive(Debug, Default)]
pub(super) struct Slots {
    /// How many slots there are, free ones included.
    count: u32,
    /// The free slots, the one freed last at the end.
    free: Vec<u32>,
    /// Whether each slot is free.
    is_free: Vec<bool>,
}

impl Slots {
    /// The `count` slots of a load, none of them free.
    pub(super) fn loaded(count: u32) -> Self {
        Self {
            count,
            free: Vec::new(),
            is_free: vec![false; count as usize],
        }
    }

    /// How many slots there are, free ones included.
    pub(super) fn count(&self) -> u32 {
        self.count
    }

    /// How many slots hold an item.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the free slots are slots below `count`, a u32, and no more of them"
    )]
    pub(super) fn in_use(&self) -> u32 {
        self.count - self.free.len() as u32
    }

    /// Whether `slot` holds an item: a slot below the slots and not free.
    pub(super) fn holds(&self, slot: u32) -> bool {
        self.is_free.get(slot as usize) == Some(&false)
    }

    /// The slots that hold an item, in ascending order.
    pub(super) fn in_use_slots(&self) -> impl Iterator<Item = u32> + '_ {
        (0..self.count).filter(|&s| !self.is_free[s as usize])
    }

    /// Takes a slot for an item added: the free slot freed last, or a new one after the highest,
    /// refused where it would lie beyond `u32`, which then changes nothing.
    pub(super) fn take(&mut self) -> Result<u32, TooManySlots> {
        if let Some(free) = self.free.pop() {
            self.is_free[free as usize] = false;
            return Ok(free);
        }
        let new = self.count;
        self.count = slot(new as usize + 1)?;
        self.is_free.push(false);
        Ok(new)
    }

    /// Frees `slot`, a slot below the slots, and says whether it held an item; a free one stays as
    /// it is.
    pub(super) fn free(&mut self, slot: u32) -> bool {
        let free = &mut self.is_free[slot as usize];
        if *free {
            return false;
        }
        *free = true;
        self.free.push(slot);
        true
    }

    /// Makes the slots `count`, those past the ones recorded holding nothing, for the tests of a
    /// slot past those a `u32` numbers.
    #[cfg(test)]
    pub(super) fn set_count(&mut self, count: u32) {
        self.count = count;
    }

    /// The free slots, the one freed last at the end.
    #[cfg(test)]
    pub(super) fn free_list(&self) -> &[u32] {
        &self.free
    }
}

/// Writes `value` into `list` at `i`, appending it where `i` is the list's end: the record of a
/// slot taken again, or of one appended after the highest.
pub(super) fn put<T>(list: &mut Vec<T>, i: usize, value: T) {
    if i == list.len() {
        list.push(value);
    } else {
        list[i] = value;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slot_freed_is_taken_again_last_freed_first_before_a_new_one() {
        // Verifies: ADR-0022
        let mut slots = Slots::loaded(3);
        assert!(slots.free(2));
        assert!(slots.free(0));
        assert!(!slots.free(0), "a free slot is freed once");
        assert_eq!(slots.in_use(), 1);
        assert_eq!(slots.in_use_slots().collect::<Vec<_>>(), [1]);
        assert!(!slots.holds(0) && slots.holds(1) && !slots.holds(3));
        assert_eq!(slots.take(), Ok(0));
        assert_eq!(slots.take(), Ok(2));
        assert_eq!(slots.take(), Ok(3));
        assert_eq!((slots.count(), slots.in_use()), (4, 4));
        assert!(slots.holds(3));
    }

    #[test]
    fn a_slot_past_u32_is_refused_and_nothing_changes() {
        let mut slots = Slots::loaded(0);
        slots.count = u32::MAX;
        assert_eq!(slots.take(), Err(TooManySlots));
        assert_eq!(slots.count(), u32::MAX);
        assert!(slots.is_free.is_empty());
    }

    #[test]
    fn a_record_is_written_in_place_or_appended_at_the_end() {
        let mut list = vec![1, 2];
        put(&mut list, 0, 5);
        put(&mut list, 2, 7);
        assert_eq!(list, [5, 2, 7]);
    }
}
