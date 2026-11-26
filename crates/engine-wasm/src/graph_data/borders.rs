//! Border nodes in graph data (ARCH-border-nodes-ride-sides): the checks of a node with
//! `attachedTo`, `side`, and `offset`, of a load and of `addNode`, beside the rule of its
//! attachment in `checks`, and their attachment in the engine once the graph holds the node they
//! ride.

use comb_engine::graph::{CANVAS, Graph};

use super::GraphDataProblem;
use super::checks::invalid_attachment;
use super::item::Border;
use super::problem::malformed;

/// Checks the border node `id` of place `border`, which the rule of its attachment passed, by its
/// offset: one that is not finite is refused as `nonFiniteCoordinate`.
pub(super) fn check_border(id: &str, border: &Border) -> Result<(), GraphDataProblem> {
    if !border.offset.is_finite() {
        return Err(GraphDataProblem::NonFiniteCoordinate {
            node: id.to_owned(),
        });
    }
    Ok(())
}

/// Checks what the border node `node` in `slot` is attached to: `on`, the slot of a node, or
/// none where `attached_to`, the identifier its data names, names no node; `is_border` says
/// whether a slot holds a border node. One naming no node is refused as `missingNode`, one
/// attached to itself or to a border node as `invalidAttachment`.
pub(super) fn check_target(
    node: &str,
    slot: u32,
    on: Option<u32>,
    attached_to: &str,
    is_border: impl Fn(u32) -> bool,
) -> Result<u32, GraphDataProblem> {
    let Some(on) = on else {
        return Err(GraphDataProblem::MissingNode {
            edge: None,
            border_node: Some(node.to_owned()),
            node: attached_to.to_owned(),
        });
    };
    if on == slot || is_border(on) {
        return Err(invalid_attachment(node, "attachedTo"));
    }
    Ok(on)
}

/// Attaches the node in `slot` at its place `border` to the node in `on`, which the checks above
/// passed, and returns the offset the engine held within the side's length.
pub(super) fn attached(
    graph: &mut Graph,
    slot: u32,
    on: u32,
    border: &Border,
) -> Result<f64, GraphDataProblem> {
    graph
        .attach(slot, on, border.side, border.offset)
        .map_err(|_| malformed("a border node rides a node the checks did not pass"))
}

/// The slot `attached` names for a load of `count` nodes: none for `CANVAS`, which names no node;
/// a slot past the nodes, which the snapshot never hands over, is malformed.
pub(super) fn target_of(attached: u32, count: usize) -> Result<Option<u32>, GraphDataProblem> {
    if attached == CANVAS {
        return Ok(None);
    }
    if attached as usize >= count {
        return Err(malformed("a border node rides a slot past the nodes"));
    }
    Ok(Some(attached))
}

#[cfg(test)]
mod tests {
    use super::super::tests::{add, batch, load_columns};
    use super::super::{
        Divide, Field, GraphList, NodeInput, NodePatch, OwnedColumns, PatchValue, RegionInput,
        Side, add_node_to, graph_of,
        problem::{A_BORDER_SIDE, A_NUMBER},
    };
    use super::*;
    use comb_engine::content::Fonts;

    /// A node `n` as a border node of `on` on `side` at `offset`, of no position, 10 wide.
    fn pin(id: &str, on: &str, side: Side, offset: f64) -> NodeInput {
        let mut node = batch(&[(id, 0.0, 0.0)], &[]).nodes.remove(0);
        node.x = Field::absent();
        node.y = Field::absent();
        node.width = 10.0.into();
        node.attached_to = Some(on.to_owned()).into();
        node.side = Some(side).into();
        node.offset = Some(offset).into();
        node
    }

    /// The load of the action `a`, at (100, 50), 100 wide, and of `nodes` after it.
    fn load(nodes: &[NodeInput]) -> Result<Graph, GraphDataProblem> {
        let a = batch(&[("a", 100.0, 50.0)], &[]).nodes.remove(0);
        let mut columns = OwnedColumns::of(std::iter::once(Some(&a)).chain(nodes.iter().map(Some)));
        // Its marks as containers, which the columns of nesting carry.
        for (i, node) in nodes.iter().enumerate() {
            columns.is_container[i + 1] = u8::from(node.is_container.0 == Some(Some(true)));
        }
        load_columns(&columns)
    }

    fn invalid(field: &str) -> Result<(), GraphDataProblem> {
        Err(GraphDataProblem::InvalidAttachment {
            node: "p".into(),
            field: field.into(),
        })
    }

    #[test]
    fn a_loaded_border_node_rides_its_node_at_its_offset_held_within_its_side() {
        // Verifies: ARCH-border-nodes-ride-sides, API-bridge-columns-carry-nesting
        let graph = load(&[pin("p", "a", Side::Right, 1e9)]).unwrap();
        let place = graph.place_of(1).unwrap();
        let height = f64::from(graph.sizes()[1]);
        assert_eq!((place.on, place.offset), (0, height));
        // Centred on the right side's far end.
        let at = &graph.positions()[2..4];
        let size = graph.sizes()[3];
        assert_eq!(at[0], 200.0 - 5.0);
        assert_eq!(f64::from(at[1] + size / 2.0), 50.0 + height);
        // As `addNode` adds one.
        let mut graph = graph_of(&batch(&[("a", 100.0, 50.0)], &[])).unwrap();
        let node = pin("p", "a", Side::Top, -4.0);
        let slot = add_node_to(&mut graph, &node, (None, Some(0)), &Fonts::default(), 0)
            .unwrap()
            .slot;
        assert_eq!(graph.place_of(slot).unwrap().offset, 0.0);
        let size = graph.sizes()[slot as usize * 2 + 1];
        assert_eq!(graph.positions()[2], 95.0);
        assert_eq!(graph.positions()[3] + size / 2.0, 50.0);
    }

    #[test]
    fn an_empty_list_of_regions_is_no_regions_of_a_border_node_in_a_load_add_node_and_update_node()
    {
        // Verifies: ARCH-border-nodes-ride-sides
        let mut p = pin("p", "a", Side::Top, 0.0);
        p.regions = Some(Vec::new()).into();
        let mut graph = load(&[p]).unwrap();
        let mut q = pin("q", "a", Side::Top, 0.0);
        q.regions = Some(Vec::new()).into();
        let added = add_node_to(&mut graph, &q, (None, Some(0)), &Fonts::default(), 0);
        assert!(added.is_ok());
        // Through `updateNode`, which refuses a list with a region by its rule of attachment.
        let mut engine = crate::Engine::new();
        let a = batch(&[("a", 100.0, 50.0)], &[]).nodes.remove(0);
        engine.add(&a, (None, None)).unwrap();
        let slot = engine
            .add(&pin("p", "a", Side::Top, 0.0), (None, Some(0)))
            .unwrap();
        let regions = |list: Vec<RegionInput>| {
            NodePatch(vec![
                (
                    "divide".to_owned(),
                    PatchValue::Divide(Some(Divide::Across).into()),
                ),
                ("regions".to_owned(), PatchValue::Regions(Some(list).into())),
            ])
        };
        assert!(engine.update(slot, "p", &regions(Vec::new())).is_ok());
        assert!(engine.graph.regions_of(slot).is_empty());
        let one = RegionInput {
            id: "r".to_owned().into(),
            name: None.into(),
            size: 10.0.into(),
            line: super::super::Line::Solid.into(),
            divide: None.into(),
            of: None.into(),
        };
        assert_eq!(
            engine.update(slot, "p", &regions(vec![one])),
            Err(crate::CallRefusal::Data(invalid("regions").unwrap_err()))
        );
    }

    #[test]
    fn a_border_node_that_cannot_be_one_is_refused_naming_it_and_its_field() {
        // Verifies: ARCH-border-nodes-ride-sides, API-edits-report-nested-changes, Q-7
        type Change = fn(&mut NodeInput);
        let cases: [(Change, Result<(), GraphDataProblem>); 9] = [
            (
                |n| n.attached_to = Some("p".to_owned()).into(),
                invalid("attachedTo"),
            ),
            (
                |n| n.attached_to = Some("q".to_owned()).into(),
                invalid("attachedTo"),
            ),
            (|n| n.resizable = Some(true).into(), invalid("resizable")),
            (
                |n| n.is_container = Some(true).into(),
                invalid("isContainer"),
            ),
            (|n| n.x = 4.0.into(), invalid("x")),
            (|n| n.y = 4.0.into(), invalid("y")),
            (
                |n| n.container = Some("a".to_owned()).into(),
                invalid("container"),
            ),
            (
                |n| n.offset = Some(f64::NAN).into(),
                Err(GraphDataProblem::NonFiniteCoordinate { node: "p".into() }),
            ),
            (
                |n| n.attached_to = Some("z".to_owned()).into(),
                Err(GraphDataProblem::MissingNode {
                    edge: None,
                    border_node: Some("p".into()),
                    node: "z".into(),
                }),
            ),
        ];
        for (change, problem) in cases {
            let mut p = pin("p", "a", Side::Top, 0.0);
            change(&mut p);
            assert_eq!(
                load(&[pin("q", "a", Side::Left, 0.0), p]).map(drop),
                problem
            );
        }
        // A side or an offset left out or of another type, by its field; the outline is no side.
        let field = |field: &str, expected: &str| GraphDataProblem::InvalidField {
            list: GraphList::Nodes,
            index: 1,
            id: Some("p".into()),
            field: field.into(),
            expected: expected.into(),
        };
        let mut p = pin("p", "a", Side::Top, 0.0);
        p.side = Field(None);
        assert_eq!(load(&[p]).map(drop), Err(field("side", A_BORDER_SIDE)));
        let mut p = pin("p", "a", Side::Top, 0.0);
        p.offset = Field::absent();
        assert_eq!(load(&[p]).map(drop), Err(field("offset", A_NUMBER)));
        // `addNode` refuses as a load does, and names a node the graph does not hold.
        let mut graph = load(&[pin("q", "a", Side::Left, 0.0)]).unwrap();
        let mut p = pin("p", "a", Side::Top, 0.0);
        p.resizable = Some(true).into();
        assert_eq!(
            add_node_to(&mut graph, &p, (None, Some(0)), &Fonts::default(), 0).map(drop),
            invalid("resizable")
        );
        let p = pin("p", "q", Side::Top, 0.0);
        assert_eq!(
            add_node_to(&mut graph, &p, (None, Some(1)), &Fonts::default(), 0).map(drop),
            invalid("attachedTo")
        );
        assert_eq!(
            add(&mut graph, &pin("p", "z", Side::Top, 0.0)).map(drop),
            Err(GraphDataProblem::MissingNode {
                edge: None,
                border_node: Some("p".into()),
                node: "z".into(),
            })
        );
        assert_eq!(graph.nodes_in_use(), 2);
    }
}
