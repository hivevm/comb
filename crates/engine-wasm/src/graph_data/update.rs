//! `updateNode`: a patch of a node, its fields read and checked by `patch_of` and then held, by
//! `update_node_in`, to the graph's size, the budget of content, the rule of its attachment, and
//! the world, in the order a load checks a node; given to the node in the graph and laid out anew
//! as a load lays a node out, and answered with what the content the bridge keeps takes of it.

use comb_engine::content::Fonts;
use comb_engine::geometry::Side;
use comb_engine::graph::{Axis, DivideError, Divided, Graph, Place, RegionSlots, SlotError};
use comb_engine::shape::NodeShape;

use super::{
    Checked, ContentData, GraphDataProblem, NodePatch, Region, check_attachment, check_graph_size,
    checked_height, content_top, division_problem, malformed, names_within, parts_of, patch_of,
    within_world_divided,
};

/// Why a patch of `updateNode` was refused: its data, which the host application handed over, or
/// a slot that holds no node, which is the shell's mistake (ARCH-engine-edits-nested-graph).
#[derive(Debug, PartialEq)]
pub(crate) enum NodeRefusal {
    Data(GraphDataProblem),
    Slot(SlotError),
}

impl From<GraphDataProblem> for NodeRefusal {
    fn from(problem: GraphDataProblem) -> Self {
        Self::Data(problem)
    }
}

impl From<SlotError> for NodeRefusal {
    fn from(error: SlotError) -> Self {
        Self::Slot(error)
    }
}

/// What the content the bridge keeps holds of the node a patch names, before the patch: the code
/// units of the strings of content besides the node's, those of its regions' names among them,
/// and those of its own content, and the content that holds the node with the node's index in it,
/// laid out only where the patch sets no content. A slot that holds no node holds no names.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Held<'a> {
    pub besides: u64,
    pub names: u64,
    pub units: u64,
    pub content: (&'a ContentData, usize),
}

/// What the content the bridge keeps takes of an accepted patch: the node's new content, where the
/// patch set content, and, where it set regions, what the division changed with the code units of
/// each new region's name, in the order of its regions.
#[derive(Debug, Default)]
pub(crate) struct Updated {
    pub content: Option<Checked>,
    pub divided: Option<(Divided, Vec<u64>)>,
}

/// Checks the patch `updateNode` hands over for the node `id` in `slot` as a load checks a node's
/// content, its strings counted against the budget on from `held`, and gives the node in `graph`
/// the height its content, new or `held`, lays out to in `fonts` (REN-node-content-and-hits). A
/// patch that sets regions divides the node anew, `kept` naming per region, depth first, the slot
/// of the node's region of its identifier, or `u32::MAX`. A refused patch changes nothing; a slot
/// that holds no node is refused as the shell's mistake.
pub(crate) fn update_node_in(
    graph: &mut Graph,
    fonts: &Fonts,
    slot: u32,
    id: &str,
    patch: &NodePatch,
    kept: &[u32],
    held: Held<'_>,
) -> Result<Updated, NodeRefusal> {
    // A patch of regions replaces the node's, whose names then count no more.
    let divides = patch
        .0
        .iter()
        .any(|(key, _)| key == "regions" || key == "divide");
    let besides = if divides {
        held.besides - held.names
    } else {
        held.besides
    };
    // A slot that holds no node is refused below as a slot, whatever node shape it held.
    let shape = if graph.holds_node(slot) {
        graph.shape(slot)
    } else {
        NodeShape::Rectangle
    };
    let place = graph.place_of(slot);
    let patched = patch_of(
        id,
        (shape, place.is_some()),
        graph.divided(slot),
        patch,
        fonts,
        besides,
    )?;
    if patched.is_inert() {
        return Ok(Updated::default());
    }
    if !graph.holds_node(slot) {
        return Err(SlotError::NoNode { slot }.into());
    }
    // A region holds no content of its own and takes its box from the node it divides; refused
    // before anything changes, as the engine's division and `set_top` refuse it.
    if graph.is_region(slot) {
        return Err(division_problem(DivideError::Region { slot }).into());
    }
    if let Some((_, regions)) = &patched.regions {
        // Each new region takes a node slot, the old ones free theirs.
        let old = graph.regions_of(slot).len();
        let nodes = f64::from(graph.nodes_in_use()) + regions.len() as f64 - old as f64;
        check_graph_size(nodes, 0.0)?;
        // Their names count against the budget of content beside the node's content.
        let content = patched
            .content
            .as_ref()
            .map_or(held.units, |(checked, _)| checked.units);
        names_within(id, besides + content, regions)?;
    }
    // Then the rule of its attachment, after the budget, as a load and `addNode` check a node.
    check_attachment(id, place.is_some(), patched.given)?;
    // The height the node then has, never less than its content, old or new, needs.
    let given = patched.height.or_else(|| graph.given_height(slot));
    let laid = patched.content.as_ref().map_or_else(
        || {
            let (content, node) = held.content;
            content.laid(node, fonts)
        },
        |&(_, laid)| laid,
    );
    let width = graph.sizes()[slot as usize * 2];
    let at = [0, 1].map(|axis| graph.positions()[slot as usize * 2 + axis]);
    let height = checked_height(id, shape, [at[1], width], laid, given)?;
    let top = content_top(shape, width, laid);
    if let Some((divide, regions)) = &patched.regions {
        within_world_divided(id, *divide, at, [width, height], top, regions)?;
    }
    graph.resize_node(slot, height)?;
    let resizable = patched
        .resizable
        .unwrap_or_else(|| graph.is_resizable(slot));
    graph.set_sizing(slot, given, resizable)?;
    graph.set_outline(slot, patched.outline.unwrap_or(graph.outline(slot)))?;
    let divided = divide_anew(graph, slot, patched.regions, kept, top)?;
    if let Some(place) = place {
        place_anew(graph, slot, place, patched.side, patched.offset)?;
    }
    Ok(Updated {
        content: patched.content.map(|(content, _)| content),
        divided,
    })
}

/// Gives the border node in `slot`, at `place`, the side and the offset a patch set, each kept
/// where it set none (ARCH-border-nodes-ride-sides).
fn place_anew(
    graph: &mut Graph,
    slot: u32,
    place: Place,
    side: Option<Side>,
    offset: Option<f64>,
) -> Result<(), GraphDataProblem> {
    if side.is_none() && offset.is_none() {
        return Ok(());
    }
    let side = side.unwrap_or(place.side);
    let offset = offset.unwrap_or(place.offset);
    graph
        .set_place(slot, side, offset)
        .map_err(|_| malformed("a border node the patch checked refused its place"))?;
    Ok(())
}

/// Divides the node in `slot` anew into `regions` in their direction, below its content, `top`
/// high, in place of the regions it has, by the engine's one division, and returns what it
/// changed, with the code units of each new region's name: what went with the regions it had is
/// what a region `kept` does not name held, with every edge at it. `kept` names, per region of
/// `regions` at every depth, depth first, the slot of the region of the node that has its
/// identifier, or `u32::MAX` (ARCH-regions-are-container-slots, *Removing a region*). Without
/// regions, the node's regions are laid out anew below its content, and none goes.
fn divide_anew(
    graph: &mut Graph,
    slot: u32,
    regions: Option<(Option<Axis>, Vec<Region>)>,
    kept: &[u32],
    top: f32,
) -> Result<Option<(Divided, Vec<u64>)>, GraphDataProblem> {
    let Some((divide, regions)) = regions else {
        graph.set_top(slot, top).map_err(division_problem)?;
        return Ok(None);
    };
    let parts = parts_of(&regions, kept);
    let divided = graph
        .divide(slot, divide, top, &parts, RegionSlots::Added)
        .map_err(division_problem)?;
    let names = regions.iter().map(Region::name_units).collect();
    Ok(Some((divided, names)))
}

#[cfg(test)]
mod tests {
    use crate::tests::{fonted, near};
    use crate::{ContentElement, Field, KindCode, NodePatch, RoleCode, TextRole};
    use comb_engine::graph::Handle;

    use super::super::patch_of;

    #[test]
    fn a_patch_of_content_lays_the_node_out_anew_and_a_refused_one_changes_nothing() {
        // Verifies: REN-node-content-and-hits, API-edits-report-nested-changes
        use crate::graph_data::tests::{TITLE, b_of, content, load_into, text};
        let mut engine = fonted();
        let nodes = b_of(&[&[TITLE]]);
        let none = crate::graph_data::OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        let body = text(RoleCode::Body, "b");
        let long = text(RoleCode::Title, "abcdefghijklmnopqrst");
        let rows = content(&[&[long], &[body], &[body], &[body], &[body]]);
        let patch = NodePatch(vec![("content".to_owned(), rows.into())]);
        let slot = 1;
        engine.update(slot, "b", &patch).unwrap();
        assert_eq!(engine.graph.sizes()[2..], [100.0, 102.0]);
        near(&mut engine, [-10.0, -10.0, 500.0, 200.0]);
        // The long title is cut to 9 glyphs and an ellipsis within its column of 76.
        let long = &engine.drawn.texts[engine.drawn.bounds[1] as usize..];
        assert!(long.starts_with("abcdefghi\u{2026}b"), "{long}");
        assert_eq!(engine.drawn.bounds[2] - engine.drawn.bounds[1], 10);
        // Its content, built when asked, is the patch's, each weight as the engine keeps it.
        let text = |role, text: &str| ContentElement::Text {
            role,
            text: text.to_owned(),
            weight: Some(1.0),
        };
        let rows = engine.content.content_of(slot).0;
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0], [text(TextRole::Title, "abcdefghijklmnopqrst")]);
        assert_eq!(rows[4], [text(TextRole::Body, "b")]);
        assert_eq!(
            engine.content.content_of(0).0,
            [[text(TextRole::Title, "x")]]
        );
        // A refused patch leaves the node as it was.
        let refused = NodePatch(vec![(
            "content".to_owned(),
            content(&[&[(KindCode::Unnamed, 1.0, RoleCode::Title, None)]]).into(),
        )]);
        assert!(
            patch_of(
                "b",
                (crate::graph_data::RECTANGLE.0, false),
                None,
                &refused,
                &engine.fonts,
                0
            )
            .is_err()
        );
        assert_eq!(engine.graph.sizes()[2..], [100.0, 102.0]);
        // A slot that holds no node is the shell's mistake.
        assert_eq!(
            engine.graph.resize_node(7, 64.0),
            Err(comb_engine::graph::SlotError::NoNode { slot: 7 })
        );
    }

    #[test]
    fn a_patch_of_height_and_resizable_raises_the_height_and_a_resize_stops_at_the_content() {
        // Verifies: API-edits-report-nested-changes, REN-node-shapes-cover-uml
        use crate::graph_data::PatchValue;
        use crate::graph_data::tests::{TITLE, b_of, content, load_into, text};
        let mut engine = fonted();
        let nodes = b_of(&[&[TITLE]]);
        let none = crate::graph_data::OwnedEdgeColumns::of([]);
        assert_eq!(load_into(&mut engine, &nodes, &none), Ok(2));
        let content_height = engine.graph.sizes()[3];
        // A height below the content's raised to it, and the node resizable.
        let patch = NodePatch(vec![
            ("height".to_owned(), PatchValue::Height(Field(Some(10.0)))),
            (
                "resizable".to_owned(),
                PatchValue::Resizable(Field(Some(true))),
            ),
        ]);
        engine.update(1, "b", &patch).unwrap();
        assert_eq!(engine.graph.sizes()[3], content_height);
        assert!(engine.graph.is_resizable(1));
        // A greater one kept, through a patch of more content too.
        let patch = NodePatch(vec![(
            "height".to_owned(),
            PatchValue::Height(Field(Some(300.0))),
        )]);
        engine.update(1, "b", &patch).unwrap();
        assert_eq!(engine.graph.sizes()[3], 300.0);
        let body = text(RoleCode::Body, "b");
        let patch = NodePatch(vec![("content".to_owned(), content(&[&[body]]).into())]);
        engine.update(1, "b", &patch).unwrap();
        assert_eq!(engine.graph.sizes()[3], 300.0);
        // A height not above 0 is refused, the node as it was.
        let patch = NodePatch(vec![(
            "height".to_owned(),
            PatchValue::Height(Field(Some(0.0))),
        )]);
        assert!(engine.update(1, "b", &patch).is_err());
        assert_eq!(engine.graph.sizes()[3], 300.0);
        // A resize of the bottom far up stops at the height its content needs, and keeps it.
        let [x, y] = [0, 1].map(|axis| f64::from(engine.graph.positions()[2 + axis]));
        let from = [x, y, 100.0, 300.0];
        engine
            .resize(1, Handle::Bottom, &from, [0.0, -1000.0])
            .unwrap();
        assert_eq!(engine.graph.sizes()[3], content_height);
        assert_eq!(engine.graph.given_height(1), Some(content_height));
    }
}
