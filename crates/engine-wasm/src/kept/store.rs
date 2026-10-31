//! The content of the nodes the graph holds, by slot, and the code units of its strings, which
//! every edit holds to the budget a load is held to (ADR-0013, ADR-0022).

use std::collections::HashMap;

use crate::graph_data::{Checked, ContentData, NodeContent};

/// The content of the nodes the graph holds, by slot: that of the last load, the content each
/// addition or patch since gave a slot, and the code units of the strings of all of it, the texts
/// and the names alike, which every edit holds to the budget a load is held to (ADR-0013). A slot
/// a removal freed holds no content and no code units until an addition takes it (ADR-0022).
#[derive(Debug, Default)]
pub(crate) struct ContentStore {
    /// The content of the nodes of the last load, by slot.
    loaded: ContentData,
    /// The content of each slot an addition or a patch gave content since the load, boxed with
    /// the code units of its strings, and none for each slot a removal freed since: an entry of
    /// 8 bytes in WebAssembly's memory, about 9 to 18 with the map's control byte and spare room.
    edited: HashMap<u32, Option<Box<(ContentData, u64)>>>,
    units: u64,
    /// The content of a free slot: none, which allocates nothing.
    empty: ContentData,
}

impl ContentStore {
    /// The content of a load, `loaded`, whose strings the load's check counted to `units`.
    pub(crate) fn of_load(loaded: ContentData, units: u64) -> Self {
        Self {
            loaded,
            edited: HashMap::new(),
            units,
            empty: ContentData::default(),
        }
    }

    /// The code units of the strings of content the graph holds.
    pub(crate) const fn units(&self) -> u64 {
        self.units
    }

    /// The code units of the strings of content the graph holds besides the node in `slot`; all of
    /// them for a free slot.
    pub(crate) fn held_besides(&self, slot: u32) -> u64 {
        self.units - self.units_at(slot)
    }

    /// The content that holds the node in `slot`, and the node's index in it; empty content for a
    /// free slot.
    pub(crate) fn of(&self, slot: u32) -> (&ContentData, usize) {
        match self.edited.get(&slot) {
            Some(Some(edited)) => (&edited.0, 0),
            Some(None) => (&self.empty, 0),
            None => (&self.loaded, slot as usize),
        }
    }

    /// The content of the node in `slot`, as the host application's type describes it.
    pub(crate) fn content_of(&self, slot: u32) -> NodeContent {
        let (content, node) = self.of(slot);
        content.content_of(node)
    }

    /// Gives the node in `slot`, added or patched, the content `checked`: the code units of the
    /// content it held leave the count, and those of `checked` join it.
    pub(crate) fn set(&mut self, slot: u32, checked: Checked) {
        self.units = self.units - self.units_at(slot) + checked.units;
        let edited = Box::new((checked.data, checked.units));
        self.edited.insert(slot, Some(edited));
    }

    /// Takes the content of the nodes in `slots` out of the count and leaves each slot empty, so
    /// that a slot named twice leaves the count once.
    pub(crate) fn remove(&mut self, slots: &[u32]) {
        for &slot in slots {
            self.units -= self.units_at(slot);
            self.edited.insert(slot, None);
        }
    }

    /// The code units of the strings of content of the node in `slot`.
    fn units_at(&self, slot: u32) -> u64 {
        match self.edited.get(&slot) {
            Some(Some(edited)) => edited.1,
            Some(None) => 0,
            None => self.loaded.units_of(slot as usize),
        }
    }
}

#[cfg(test)]
impl ContentStore {
    /// The slots an addition, a patch, or a removal gave content since the load, in ascending
    /// order.
    pub(crate) fn edited_slots(&self) -> Vec<u32> {
        let mut slots: Vec<u32> = self.edited.keys().copied().collect();
        slots.sort_unstable();
        slots
    }
}
