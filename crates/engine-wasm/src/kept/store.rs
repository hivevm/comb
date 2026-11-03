//! The content of the nodes the graph holds, by slot, and the code units of its strings, which
//! every edit holds to the budget a load is held to (ADR-0013, ADR-0023).

use std::collections::HashMap;

use crate::graph_data::{Checked, ContentData, NodeContent};

/// The content of the nodes the graph holds, by slot: that of the last load, the content each
/// addition or patch since gave a slot, and the code units of the strings of all of it, the texts
/// and the names alike, which every edit holds to the budget a load is held to (ADR-0013). A slot
/// a removal freed holds no content and no code units until an addition takes it (ADR-0023).
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

// The malformed-data tests of graph data verify ADR-0010 (see `graph_data::tests`).
// Verifies: ADR-0010
#[cfg(test)]
mod tests {
    use crate::graph_data::tests::{
        action, batch, content, load_into, named_content, text, titled,
    };
    use crate::graph_data::{
        ContentElement, ContentInput, GraphDataProblem, MAX_CONTENT_UNITS, NodeInput, NodePatch,
        OwnedColumns, OwnedEdgeColumns, RoleCode, TEST_BUDGET, TextRole,
    };

    /// An engine of a load at the budget lowered to 6 code units: node `a` of a title "abc", and
    /// `b` of an action showing "de" and naming "f", 3 + 2 + 1.
    fn at_the_budget() -> crate::Engine {
        TEST_BUDGET.set(Some(6));
        let mut data = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]);
        data.nodes[0].content = titled("abc");
        data.nodes[1].content = named_content(&[&[action("de", "f")]]).into();
        let mut engine = crate::Engine::new();
        let nodes = OwnedColumns::of(data.nodes.iter().map(Some));
        let none = OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        assert_eq!(engine.content.units(), 6);
        engine
    }

    /// The node `id` at (0, 200), 100 wide, of `content`.
    fn node_of(id: &str, content: ContentInput) -> NodeInput {
        NodeInput {
            id: id.to_owned().into(),
            x: 0.0.into(),
            y: 200.0.into(),
            width: 100.0.into(),
            content: content.into(),
        }
    }

    /// A patch of a node's content to `content`.
    fn patch_to(content: ContentInput) -> NodePatch {
        NodePatch(vec![("content".to_owned(), content.into())])
    }

    /// The refusal of a string of content of the node `node` past the budget.
    fn past_budget(node: &str) -> GraphDataProblem {
        GraphDataProblem::ContentBudgetExceeded {
            node: node.into(),
            limit: MAX_CONTENT_UNITS,
        }
    }

    #[test]
    fn a_node_added_to_a_graph_at_the_budget_is_refused_naming_it_and_the_graph_kept() {
        // Verifies: ADR-0013, ADR-0010, Q-7
        let mut engine = at_the_budget();
        let one = node_of("c", content(&[&[text(RoleCode::Title, "x")]]));
        let added = engine.add(&one);
        // A node whose content holds no string adds no code unit and is taken.
        let none = engine.add(&node_of("d", content(&[])));
        TEST_BUDGET.set(None);
        assert_eq!(added, Err(past_budget("c")));
        assert_eq!(none, Ok(2));
        assert_eq!(engine.graph.nodes_in_use(), 3);
        assert_eq!(engine.content.units(), 6);
        assert_eq!(engine.content.edited_slots(), [2]);
    }

    #[test]
    fn an_update_past_the_budget_is_refused_and_one_of_as_many_code_units_or_fewer_taken() {
        // Verifies: ADR-0013, ADR-0010, Q-7
        let mut engine = at_the_budget();
        let sizes = engine.graph.sizes().to_vec();
        // `b`'s action of 3 code units grows to 4: refused, and nothing changes.
        let grown = engine.update(1, "b", &patch_to(named_content(&[&[action("dex", "f")]])));
        let kept = (
            engine.graph.sizes().to_vec(),
            engine.content.edited_slots().len(),
            engine.content.units(),
        );
        // Two rows of as many code units, and then of fewer: taken.
        let rows = content(&[&[text(RoleCode::Title, "d")], &[text(RoleCode::Body, "ef")]]);
        let as_many = engine.update(1, "b", &patch_to(rows));
        let after_as_many = engine.content.units();
        let fewer = engine.update(1, "b", &patch_to(content(&[&[text(RoleCode::Title, "d")]])));
        // A patch of `a`, a loaded node, counts on from what the others hold: 4 of 3 + 1 = 6 fits.
        let a = engine.update(
            0,
            "a",
            &patch_to(content(&[&[text(RoleCode::Title, "abcd")]])),
        );
        let past = engine.update(
            0,
            "a",
            &patch_to(content(&[&[text(RoleCode::Title, "abcdef")]])),
        );
        TEST_BUDGET.set(None);
        assert_eq!(grown, Err(crate::CallRefusal::Data(past_budget("b"))));
        assert_eq!(kept, (sizes, 0, 6));
        assert_eq!(as_many, Ok(()));
        assert_eq!(after_as_many, 6);
        assert_eq!(fewer, Ok(()));
        assert_eq!(a, Ok(()));
        assert_eq!(past, Err(crate::CallRefusal::Data(past_budget("a"))));
        assert_eq!(engine.content.units(), 5);
        let abcd = ContentElement::Text {
            role: TextRole::Title,
            text: "abcd".into(),
            weight: Some(1.0),
        };
        assert_eq!(engine.content.content_of(0).0, [[abcd]]);
    }

    #[test]
    fn a_deleted_nodes_code_units_are_free_for_a_node_added_after_it() {
        // Verifies: ADR-0013, ADR-0010, Q-7
        let mut engine = at_the_budget();
        // A removal that names a slot holding no node is refused and leaves the count.
        let no_node = Err(crate::SlotError::NoNode { slot: 99 });
        assert_eq!(engine.remove_nodes(&[0, 99]), no_node);
        assert_eq!(engine.content.units(), 6);
        // `a` named twice leaves the count once.
        assert_eq!(engine.remove_nodes(&[0, 0]), Ok(Vec::new()));
        let units = engine.content.units();
        let three = engine.add(&node_of("c", content(&[&[text(RoleCode::Title, "xyz")]])));
        let one = engine.add(&node_of("d", content(&[&[text(RoleCode::Title, "x")]])));
        // An added node deleted frees its code units too.
        assert_eq!(engine.remove_nodes(&[0]), Ok(Vec::new()));
        let again = engine.add(&node_of("e", content(&[&[text(RoleCode::Title, "x")]])));
        TEST_BUDGET.set(None);
        assert_eq!(units, 3);
        assert_eq!(three, Ok(0));
        assert_eq!(one, Err(past_budget("d")));
        assert_eq!(again, Ok(0));
        assert_eq!(engine.content.units(), 4);
    }
}
