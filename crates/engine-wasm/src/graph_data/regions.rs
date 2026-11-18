//! The regions a node is divided into (ARCH-regions-are-container-slots,
//! API-edits-report-nested-changes): as the host application hands them over to `addNode` and
//! `updateNode`, as a load's columns carry them (API-bridge-columns-carry-nesting), checked, and
//! built into the engine's graph as node slots of their own.

use std::collections::HashSet;
use std::fmt;

use comb_engine::graph::{Axis, Graph};
use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use tsify::Tsify;

use super::checks::{dash_of, id_length};
use super::problem::{A_DIVIDE, A_REGION_LIST};
use super::{Field, GraphDataProblem, GraphList, MAX_TEXT, Pair, utf16_length};

/// The direction a node or a region is divided in: `across` for regions side by side, `down` for
/// regions one above the other.
#[derive(Tsify, Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Divide {
    Across,
    Down,
}

impl From<Axis> for Divide {
    fn from(axis: Axis) -> Self {
        match axis {
            Axis::Across => Self::Across,
            Axis::Down => Self::Down,
        }
    }
}

impl From<Divide> for Axis {
    fn from(divide: Divide) -> Self {
        match divide {
            Divide::Across => Self::Across,
            Divide::Down => Self::Down,
        }
    }
}

/// The division a code of a load's columns names: 1 across, 2 down, and none for 0 and for a
/// code none has.
pub(crate) const fn divide_of(code: u8) -> Option<Axis> {
    match code {
        1 => Some(Axis::Across),
        2 => Some(Axis::Down),
        _ => None,
    }
}

/// The line after a region, between it and the next: solid, or dashed by a dash and a gap in
/// world units.
#[derive(Tsify, Clone, Copy, Debug, PartialEq)]
#[tsify(type = "\"solid\" | [number, number]")]
pub enum Line {
    Solid,
    Dashed(Pair),
}

impl<'de> Deserialize<'de> for Line {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(LineVisitor)
    }
}

struct LineVisitor;

impl<'de> Visitor<'de> for LineVisitor {
    type Value = Line;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("\"solid\" or a list of two numbers")
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Line, E> {
        if value == "solid" {
            Ok(Line::Solid)
        } else {
            Err(E::invalid_value(de::Unexpected::Str(value), &self))
        }
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, seq: A) -> Result<Line, A::Error> {
        Pair::deserialize(de::value::SeqAccessDeserializer::new(seq)).map(Line::Dashed)
    }
}

/// A region as `api` hands it over (API-edits-report-nested-changes, *Graph data of nesting*): its
/// identifier, its name, its size along the direction of the division it lies in, the line after
/// it, its own division, and `of`, the index in the same list of the region it lies in, none for
/// one that divides the node itself. `api` flattens the host application's tree of regions into
/// this list, each region after the one it lies in, so that a tree of any depth crosses, and is
/// read and dropped, without a walk that recurses.
#[derive(Tsify, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RegionInput {
    #[tsify(type = "string")]
    pub id: Field<String>,
    #[tsify(type = "string", optional)]
    pub name: Field<Option<String>>,
    #[tsify(type = "number")]
    pub size: Field<f64>,
    #[tsify(type = "Line")]
    pub line: Field<Line>,
    #[tsify(type = "Divide", optional)]
    pub divide: Field<Option<Divide>>,
    #[tsify(type = "number", optional)]
    pub of: Field<Option<u32>>,
}

/// A region read, each of its fields of the type it expects, and the index of the region it lies
/// in among the regions of its node, none for one of the node itself; `check_regions` holds it to
/// the rules.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Region {
    pub id: String,
    pub name: Option<String>,
    pub size: f64,
    pub dash: Option<[f64; 2]>,
    pub divide: Option<Axis>,
    pub parent: Option<usize>,
}

impl Region {
    /// The code units of its name, which count against the budget of content.
    pub(crate) fn name_units(&self) -> u64 {
        self.name
            .as_deref()
            .map_or(0, |name| utf16_length(name) as u64)
    }
}

/// The regions of a node read from what `addNode` or `updateNode` hands over, with its division,
/// or none where it has none; a field of another type, or a region that lies in none before it,
/// is refused as `invalidField` naming the node at `index` and its field `regions` or `divide`.
pub(crate) fn regions_of(
    id: &str,
    index: usize,
    divide: &Field<Option<Divide>>,
    regions: &Field<Option<Vec<RegionInput>>>,
) -> Result<(Option<Axis>, Vec<Region>), GraphDataProblem> {
    let refused = |field: &str, expected: &str| GraphDataProblem::InvalidField {
        list: GraphList::Nodes,
        index: super::slot(index).unwrap_or(u32::MAX),
        id: Some(id.to_owned()),
        field: field.to_owned(),
        expected: expected.to_owned(),
    };
    let Field(Some(divide)) = divide else {
        return Err(refused("divide", A_DIVIDE));
    };
    let Field(Some(regions)) = regions else {
        return Err(refused("regions", A_REGION_LIST));
    };
    let read = regions
        .as_deref()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(at, input)| read_region(at, input))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| refused("regions", A_REGION_LIST))?;
    Ok((divide.map(Axis::from), read))
}

/// `input` at `at` of its list read, or none where a field of it holds a value of another type,
/// or it lies in no region before it.
fn read_region(at: usize, input: &RegionInput) -> Option<Region> {
    let parent = input.of.0?.map(|of| of as usize);
    if parent.is_some_and(|of| of >= at) {
        return None;
    }
    Some(Region {
        id: input.id.0.clone()?,
        name: input.name.0.clone()?,
        size: input.size.0?,
        dash: match input.line.0? {
            Line::Solid => None,
            Line::Dashed(Pair(dash)) => Some(dash),
        },
        divide: input.divide.0?.map(Axis::from),
        parent,
    })
}

/// Whether each of `regions` holds regions of its own.
pub(crate) fn holding(regions: &[Region]) -> Vec<bool> {
    let mut holds = vec![false; regions.len()];
    for parent in regions.iter().filter_map(|region| region.parent) {
        holds[parent] = true;
    }
    holds
}

/// Holds the regions of the node `id` at `index` of a load, or 0 for an edit, divided by
/// `divide`, to the rules of a load, in their order, each region's fields in their order: regions
/// need a division of what they lie in (`invalidField` of `divide`); an identifier no longer than
/// `MAX_ID` and shared with no node or region of the load (`duplicateNode`); a size above 0 as
/// `f32` (`invalidSize`, naming the region); a name no longer than `MAX_TEXT`; and a dash and a gap
/// a line's dash pattern holds. Returns the identifiers' code units. `taken` holds the
/// identifiers the graph or the load holds already, and takes the regions'.
pub(crate) fn check_regions(
    id: &str,
    index: usize,
    divide: Option<Axis>,
    regions: &[Region],
    taken: &mut HashSet<String>,
) -> Result<usize, GraphDataProblem> {
    let refused = |field: &str, expected: &str| GraphDataProblem::InvalidField {
        list: GraphList::Nodes,
        index: super::slot(index).unwrap_or(u32::MAX),
        id: Some(id.to_owned()),
        field: field.to_owned(),
        expected: expected.to_owned(),
    };
    let mut units = 0;
    for region in regions {
        let within = region
            .parent
            .map_or(divide, |parent| regions[parent].divide);
        if within.is_none() {
            return Err(refused("divide", A_DIVIDE));
        }
        units += id_length("nodes", index, "regions", &region.id)?;
        if !taken.insert(region.id.clone()) {
            return Err(GraphDataProblem::DuplicateNode {
                node: region.id.clone(),
            });
        }
        #[expect(
            clippy::cast_possible_truncation,
            reason = "checked as f32 below, so that what f32 cannot hold is refused"
        )]
        let size = region.size as f32;
        if !size.is_finite() || size <= 0.0 {
            return Err(GraphDataProblem::InvalidSize {
                node: region.id.clone(),
            });
        }
        if region
            .name
            .as_deref()
            .is_some_and(|name| utf16_length(name) > MAX_TEXT)
        {
            return Err(refused("regions", A_REGION_LIST));
        }
        if let Some(dash) = region.dash
            && dash_of(&region.id, dash).is_err()
        {
            return Err(refused("regions", A_REGION_LIST));
        }
    }
    Ok(units)
}

/// Adds the regions `regions` into the node in `slot`, divided by `divide`, each into what it
/// lies in, at its size along that direction, and returns their slots in their order; `arrange`
/// of the divided node lays them out. A region that holds none is not divided. The slot holds a
/// node, and the regions passed `check_regions`.
pub(crate) fn add_regions(
    graph: &mut Graph,
    slot: u32,
    divide: Axis,
    regions: &[Region],
) -> Result<Vec<u32>, GraphDataProblem> {
    let holds = holding(regions);
    let mut slots: Vec<u32> = Vec::with_capacity(regions.len());
    for (region, &holds) in regions.iter().zip(&holds) {
        let (into, axis) = region.parent.map_or((slot, Some(divide)), |parent| {
            (slots[parent], regions[parent].divide)
        });
        let mut size = [0.0; 2];
        #[expect(
            clippy::cast_possible_truncation,
            reason = "a size `check_regions` held to f32"
        )]
        let extent = region.size as f32;
        size[axis.map_or(0, Axis::index)] = extent;
        let added = graph
            .add_node_in(into, true, [0.0, 0.0, size[0], size[1]])
            .map_err(|_| GraphDataProblem::from(comb_engine::graph::TooManySlots))?;
        // A slot just added, which no mark refuses.
        let _ = graph.mark_region(
            added,
            region.name.is_some(),
            region.divide.filter(|_| holds),
        );
        slots.push(added);
    }
    Ok(slots)
}

/// The regions of a load as columns (API-bridge-columns-carry-nesting), region `k` in the node
/// slot after the nodes and the regions before it, each listed after what it divides: its
/// identifier, as the nodes' are, the slot of the node or region it divides, its size, its own
/// division as a code, the dash and the gap of the line after it where it is dashed, and its name
/// where it has one, as the identifiers are.
pub struct RegionColumns<'a> {
    pub ids: &'a [String],
    pub id_bounds: &'a [u32],
    pub of: &'a [u32],
    pub size: &'a [f64],
    pub divide: &'a [u8],
    pub has_dash: &'a [u8],
    pub dash: &'a [f64],
    pub gap: &'a [f64],
    pub named: &'a [u8],
    pub names: &'a [String],
    pub name_bounds: &'a [u32],
}

impl RegionColumns<'_> {
    /// The regions of the load, read back into the regions of the nodes they divide: per node of
    /// `divides`, the division each node of the load has as its code, the node's regions in their
    /// order, each with the index of the region it lies in among them; or none where the columns
    /// do not fit together or a region names no slot before it.
    pub(crate) fn trees(&self, divides: &[u8]) -> Option<Vec<(Option<Axis>, Vec<Region>)>> {
        let count = self.of.len();
        let fits = [self.size.len(), self.divide.len(), self.has_dash.len()]
            .into_iter()
            .chain([self.dash.len(), self.gap.len(), self.named.len()])
            .all(|len| len == count)
            && self.id_bounds.len() == count + 1;
        if !fits {
            return None;
        }
        let ids = super::values(self.ids, self.id_bounds).ok()?;
        let named = self.named.iter().filter(|&&n| n == 1).count();
        let names = if named == 0 {
            Vec::new()
        } else {
            super::values(self.names, self.name_bounds).ok()?
        };
        if names.len() != named {
            return None;
        }
        let nodes = divides.len();
        let mut names = names.into_iter().map(str::to_owned);
        let mut trees: Vec<(Option<Axis>, Vec<Region>)> = divides
            .iter()
            .map(|&code| (divide_of(code), Vec::new()))
            .collect();
        // Per region the node it divides at its outermost and its index among that node's.
        let mut placed: Vec<(usize, usize)> = Vec::with_capacity(count);
        for k in 0..count {
            let of = self.of[k] as usize;
            if of >= nodes + k {
                return None;
            }
            let (node, parent) = if of < nodes {
                (of, None)
            } else {
                let (node, at) = placed[of - nodes];
                (node, Some(at))
            };
            let list = &mut trees[node].1;
            placed.push((node, list.len()));
            list.push(Region {
                id: (*ids.get(k)?).to_owned(),
                name: (self.named[k] == 1).then(|| names.next()).flatten(),
                size: self.size[k],
                dash: (self.has_dash[k] == 1).then(|| [self.dash[k], self.gap[k]]),
                divide: divide_of(self.divide[k]),
                parent,
            });
        }
        Some(trees)
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::{add, added, batch, load_columns};
    use super::super::{EdgeCells, OwnedColumns, OwnedEdgeColumns, graph_of, load_of};
    use super::*;
    use comb_engine::content::Fonts;

    /// A region `id` of `size`, solid, unnamed unless `name`, divided by `divide`, in the region at
    /// `of` of its list, or in the node for none.
    pub(crate) fn region(
        id: &str,
        size: f64,
        name: Option<&str>,
        divide: Option<Divide>,
        of: Option<u32>,
    ) -> RegionInput {
        RegionInput {
            id: id.to_owned().into(),
            name: name.map(str::to_owned).into(),
            size: size.into(),
            line: Line::Solid.into(),
            divide: divide.into(),
            of: of.into(),
        }
    }

    /// An activity divided across into three named partitions of 100, 150, and 100, the middle
    /// one divided down into one of 80 and a named one of 60, dashed.
    fn partitions() -> (Option<Divide>, Vec<RegionInput>) {
        let mut lower = region("p2b", 60.0, Some("Lower"), None, Some(1));
        lower.line = Line::Dashed(Pair([6.0, 4.0])).into();
        (
            Some(Divide::Across),
            vec![
                region("p1", 100.0, Some("One"), None, None),
                region("p2", 150.0, Some("Two"), Some(Divide::Down), None),
                region("p2a", 80.0, None, None, Some(1)),
                lower,
                region("p3", 100.0, Some("Three"), None, None),
            ],
        )
    }

    /// The activity `act` at (0, 0) 300 wide, divided into `partitions`, and the node `x` in the
    /// first partition at (10, 40) relative to it, as a load's columns.
    fn activity_columns() -> OwnedColumns {
        let (divide, regions) = partitions();
        let act = added(0.0, 0.0, |n| {
            n.id = "act".to_owned().into();
            n.width = 300.0.into();
            n.divide = divide.into();
            n.regions = Some(regions).into();
        });
        let x = added(10.0, 40.0, |n| n.id = "x".to_owned().into());
        // The first region takes the slot after the two nodes.
        OwnedColumns::of([Some(&act), Some(&x)]).nested(&[None, Some(2)], &[false, false])
    }

    fn rect(graph: &Graph, slot: u32) -> [f32; 4] {
        let at = &graph.positions()[slot as usize * 2..];
        let size = &graph.sizes()[slot as usize * 2..];
        [at[0], at[1], at[0] + size[0], at[1] + size[1]]
    }

    #[test]
    fn a_load_takes_the_regions_as_slots_after_the_nodes_that_tile_the_part_below_the_content() {
        // Verifies: ARCH-regions-are-container-slots, API-bridge-columns-carry-nesting
        let graph = load_columns(&activity_columns()).unwrap();
        let top = graph.top(0);
        assert!(top > 0.0);
        assert_eq!(graph.regions_of(0), [2, 3, 4, 5, 6]);
        assert_eq!(rect(&graph, 0), [0.0, 0.0, 350.0, top + 164.0]);
        assert_eq!(rect(&graph, 2), [0.0, top, 100.0, top + 164.0]);
        assert_eq!(rect(&graph, 3), [100.0, top, 250.0, top + 164.0]);
        assert_eq!(rect(&graph, 4), [100.0, top + 24.0, 250.0, top + 104.0]);
        assert_eq!(rect(&graph, 5), [100.0, top + 104.0, 250.0, top + 164.0]);
        assert_eq!(rect(&graph, 6), [250.0, top, 350.0, top + 164.0]);
        // A node may name a region of a later slot than the first, which moves it along.
        let in_third = activity_columns().nested(&[None, Some(6)], &[false, false]);
        let in_third = load_columns(&in_third).unwrap();
        assert_eq!(in_third.container(1), 6);
        assert_eq!(&rect(&in_third, 1)[..2], [260.0, top + 40.0]);
        // The node in the first partition, at its position relative to it.
        assert_eq!(graph.container(1), 2);
        assert_eq!(&rect(&graph, 1)[..2], [10.0, top + 40.0]);
    }

    #[test]
    fn a_node_in_a_divided_node_an_edge_to_a_region_and_regions_out_of_rule_are_refused() {
        // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes
        let in_divided = activity_columns().nested(&[None, Some(0)], &[false, false]);
        assert_eq!(
            load_columns(&in_divided).err(),
            Some(GraphDataProblem::InvalidContainer {
                node: "x".into(),
                field: "container".into(),
                expected: super::super::problem::AN_UNDIVIDED.into(),
            })
        );
        // An edge to a region names no node of the graph.
        let edge = EdgeCells::from(&batch(&[], &[("e", "x", "p1")]).edges[0]);
        let loaded = load_of(
            &activity_columns().view(),
            &OwnedEdgeColumns::of([Some(&edge)]).view(),
            &Fonts::default(),
        );
        assert_eq!(
            loaded.err(),
            Some(GraphDataProblem::MissingNode {
                edge: "e".into(),
                node: "p1".into(),
            })
        );
        let with = |change: fn(&mut Vec<RegionInput>) -> Option<Divide>| {
            let (_, mut regions) = partitions();
            let divide = change(&mut regions);
            let mut data = batch(&[("act", 0.0, 0.0)], &[]);
            data.nodes[0].divide = divide.into();
            data.nodes[0].regions = Some(regions).into();
            graph_of(&data).err()
        };
        assert_eq!(
            with(|r| {
                r[4].id = "act".to_owned().into();
                Some(Divide::Across)
            }),
            Some(GraphDataProblem::DuplicateNode { node: "act".into() })
        );
        assert_eq!(
            with(|r| {
                r[1].size = 0.0.into();
                Some(Divide::Across)
            }),
            Some(GraphDataProblem::InvalidSize { node: "p2".into() })
        );
        assert!(matches!(
            with(|_| None),
            Some(GraphDataProblem::InvalidField { field, .. }) if field == "divide"
        ));
        assert!(matches!(
            with(|r| {
                r[0].size = Field(None);
                Some(Divide::Across)
            }),
            Some(GraphDataProblem::InvalidField { field, .. }) if field == "regions"
        ));
    }

    #[test]
    fn a_node_added_with_regions_is_divided_and_one_added_into_a_divided_node_is_refused() {
        // Verifies: ARCH-regions-are-container-slots
        let mut graph = Graph::default();
        let (divide, regions) = partitions();
        let act = added(0.0, 0.0, |n| {
            n.divide = divide.into();
            n.regions = Some(regions).into();
        });
        let slot = add(&mut graph, &act).unwrap();
        assert_eq!(graph.regions_of(slot), [1, 2, 3, 4, 5]);
        assert!(graph.holds_regions(slot));
        let into = add_node_to_divided(&mut graph, slot);
        assert!(matches!(
            into,
            Err(GraphDataProblem::InvalidContainer { .. })
        ));
        assert!(add_node_to_divided(&mut graph, 1).is_ok());
    }

    fn add_node_to_divided(graph: &mut Graph, container: u32) -> Result<u32, GraphDataProblem> {
        let node = added(10.0, 10.0, |n| n.id = "x".to_owned().into());
        super::super::add_node_to(graph, &node, Some(container), &Fonts::default(), 0)
            .map(|(slot, _)| slot)
    }

    #[test]
    fn an_update_that_leaves_a_region_out_removes_its_content_and_keeps_that_of_a_region_it_keeps()
    {
        // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes
        let mut engine = crate::Engine::new();
        let (divide, regions) = partitions();
        let act = added(0.0, 0.0, |n| {
            n.id = "act".to_owned().into();
            n.divide = divide.into();
            n.regions = Some(regions).into();
        });
        let slot = engine.add(&act, None).unwrap();
        let [p1, p3] = [1, 5];
        let x = added(10.0, 40.0, |n| n.id = "x".to_owned().into());
        let x = engine.add(&x, Some(p1)).unwrap();
        let y = added(10.0, 40.0, |n| n.id = "y".to_owned().into());
        let y = engine.add(&y, Some(p3)).unwrap();
        // Keeps the third partition first and leaves the others out.
        let regions = vec![
            region("p3", 120.0, Some("Three"), None, None),
            region("p4", 50.0, None, None, None),
        ];
        let patch = super::super::NodePatch(vec![(
            "regions".to_owned(),
            super::super::PatchValue::Regions(Some(regions).into()),
        )]);
        let removed = engine
            .update_with(slot, "act", &patch, &[p3, u32::MAX])
            .unwrap();
        let count = removed[0] as usize;
        let nodes = &removed[1..=count];
        assert!(nodes.contains(&x) && !nodes.contains(&y));
        let regions = engine.graph.regions_of(slot);
        assert_eq!(regions.len(), 2);
        // The node takes the patch's sizes, the last region the rest of its width.
        let [first, last] = [
            rect(&engine.graph, regions[0]),
            rect(&engine.graph, regions[1]),
        ];
        assert_eq!(first[2] - first[0], 120.0);
        assert_eq!(last[2], rect(&engine.graph, slot)[2]);
        // What the kept partition holds lies in it at its position relative to it.
        assert_eq!(engine.graph.container(y), regions[0]);
        let at = rect(&engine.graph, y);
        assert_eq!([at[0] - first[0], at[1] - first[1]], [10.0, 40.0]);
    }

    #[test]
    fn a_chain_of_regions_ten_thousand_deep_loads_lays_out_resizes_and_drops_without_a_walk_that_recurses()
     {
        // Verifies: ARCH-regions-are-container-slots
        // Each region divides the next, across and down in turn, each named.
        let depth = 10_000;
        let regions: Vec<RegionInput> = (0..depth)
            .map(|k| {
                let divide = [Divide::Down, Divide::Across][k % 2];
                let of = k.checked_sub(1).map(|p| p as u32);
                let inner = (k + 1 < depth).then_some(divide);
                region(&format!("r{k}"), 10.0, Some("n"), inner, of)
            })
            .collect();
        let act = added(0.0, 0.0, |n| {
            n.id = "act".to_owned().into();
            n.divide = Some(Divide::Across).into();
            n.regions = Some(regions).into();
        });
        let batch = super::super::GraphBatch {
            nodes: vec![act],
            edges: Vec::new(),
        };
        let mut graph = graph_of(&batch).unwrap();
        assert_eq!(graph.regions_of(0).len(), depth);
        let [w, h] = [graph.sizes()[0], graph.sizes()[1]].map(f64::from);
        // Each band of 24 at the start of a named region stacks along both axes.
        assert!(w >= 12.0 * depth as f64 && h >= 12.0 * depth as f64);
        let at = comb_engine::geometry::Rect::new(0.0, 0.0, w, h);
        graph.set_sizing(0, None, true).unwrap();
        graph
            .resize(
                0,
                comb_engine::graph::Handle::BottomRight,
                &at,
                [50.0, 50.0],
                0.0,
            )
            .unwrap();
        drop(graph);
    }

    /// The engine with the activity `act` of `partitions` added, not marked a container, 300 wide.
    fn engine_with_activity() -> (crate::Engine, u32) {
        let mut engine = crate::Engine::new();
        let (divide, regions) = partitions();
        let act = added(0.0, 0.0, |n| {
            n.id = "act".to_owned().into();
            n.width = 300.0.into();
            n.divide = divide.into();
            n.regions = Some(regions).into();
        });
        let slot = engine.add(&act, None).unwrap();
        (engine, slot)
    }

    /// A patch of `updateNode` of `fields`.
    fn patch(fields: Vec<(&str, super::super::PatchValue)>) -> super::super::NodePatch {
        super::super::NodePatch(fields.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
    }

    #[test]
    fn a_node_is_refused_in_a_divided_region_by_a_load_and_by_add_node() {
        // Verifies: ARCH-regions-are-container-slots
        // `p2`, slot 3 of the load, holds `p2a` and `p2b`.
        let in_divided = activity_columns().nested(&[None, Some(3)], &[false, false]);
        assert!(matches!(
            load_columns(&in_divided),
            Err(GraphDataProblem::InvalidContainer { node, expected, .. })
                if node == "x" && expected == super::super::problem::AN_UNDIVIDED
        ));
        // Added, `p2` is slot 2.
        let (mut engine, _) = engine_with_activity();
        let x = added(0.0, 0.0, |n| n.id = "x".to_owned().into());
        assert!(matches!(
            engine.add(&x, Some(2)),
            Err(GraphDataProblem::InvalidContainer { .. })
        ));
        assert!(engine.add(&x, Some(3)).is_ok());
    }

    #[test]
    fn an_update_into_no_regions_leaves_the_node_undivided_no_container_and_as_wide_as_its_data() {
        // Verifies: ARCH-regions-are-container-slots, API-edits-report-nested-changes
        use super::super::PatchValue;
        for fields in [
            vec![("regions", PatchValue::Regions(Some(Vec::new()).into()))],
            vec![("divide", PatchValue::Divide(Some(Divide::Down).into()))],
        ] {
            let (mut engine, slot) = engine_with_activity();
            assert_eq!(engine.graph.sizes()[0], 350.0);
            engine
                .update_with(slot, "act", &patch(fields), &[])
                .unwrap();
            assert!(engine.graph.regions_of(slot).is_empty());
            assert!(!engine.graph.holds_regions(slot));
            assert!(!engine.graph.is_container(slot));
            assert_eq!(engine.graph.sizes()[0], 300.0);
        }
    }

    #[test]
    fn an_update_lays_the_regions_out_from_the_data_width_as_a_load_of_the_merged_data_does() {
        // Verifies: ARCH-regions-are-container-slots
        use super::super::PatchValue;
        let (mut engine, slot) = engine_with_activity();
        let fewer = vec![
            region("p1", 100.0, None, None, None),
            region("p3", 50.0, None, None, None),
        ];
        let fields = vec![("regions", PatchValue::Regions(Some(fewer).into()))];
        engine
            .update_with(slot, "act", &patch(fields), &[])
            .unwrap();
        // 300 wide again as its data gives, not 350 as it grew to: the last region the rest.
        assert_eq!(engine.graph.sizes()[0], 300.0);
        let last = *engine.graph.regions_of(slot).last().unwrap();
        assert_eq!(engine.graph.sizes()[last as usize * 2], 200.0);
    }

    #[test]
    fn region_names_count_against_the_budget_of_content_in_a_load_add_node_and_update_node() {
        // Verifies: ARCH-regions-are-container-slots, API-bridge-columns-carry-nesting
        use super::super::{PatchValue, TEST_BUDGET};
        // The titles of `act` and `x` hold 2 code units, the names of the regions 16.
        TEST_BUDGET.set(Some(16));
        let past = |error: Result<_, GraphDataProblem>| matches!(error, Err(GraphDataProblem::ContentBudgetExceeded { node, .. }) if node == "act");
        assert!(past(load_columns(&activity_columns()).map(drop)));
        let mut engine = crate::Engine::new();
        let (divide, regions) = partitions();
        let act = added(0.0, 0.0, |n| {
            n.id = "act".to_owned().into();
            n.divide = divide.into();
            n.regions = Some(regions).into();
        });
        assert!(past(engine.add(&act, None).map(drop)));
        TEST_BUDGET.set(Some(18));
        assert!(load_columns(&activity_columns()).is_ok());
        let slot = engine.add(&act, None).unwrap();
        // A patch whose names hold 18 code units, beside the title's 1, where those it replaces
        // held 16.
        let named = vec![region("q", 10.0, Some("123456789012345678"), None, None)];
        let fields = vec![("regions", PatchValue::Regions(Some(named).into()))];
        assert!(matches!(
            engine.update_with(slot, "act", &patch(fields), &[]),
            Err(crate::CallRefusal::Data(
                GraphDataProblem::ContentBudgetExceeded { .. }
            ))
        ));
        TEST_BUDGET.set(None);
    }

    #[test]
    fn regions_count_against_the_limit_of_nodes_of_a_load() {
        // Verifies: ARCH-regions-are-container-slots, API-bridge-columns-carry-nesting
        // Two nodes and as many regions as a load holds nodes, refused before they are read.
        let mut columns = activity_columns();
        columns.regions.of = vec![0; super::super::MAX_ITEMS as usize - 1];
        assert!(matches!(
            load_columns(&columns),
            Err(GraphDataProblem::TooMany { list, .. }) if list == "nodes"
        ));
    }

    #[test]
    fn move_line_refuses_a_free_slot_and_a_region_or_node_with_no_line_after_it() {
        // Verifies: ARCH-regions-are-container-slots
        use crate::LineRefusal;
        let (mut engine, slot) = engine_with_activity();
        let regions = engine.graph.regions_of(slot);
        // Free, past every slot.
        assert_eq!(
            engine.move_line(99, 0.0),
            Err(LineRefusal::NoNode { slot: 99 })
        );
        // The last partition, and the activity itself, have no line after them.
        let last = *regions.last().unwrap();
        assert_eq!(
            engine.move_line(last, 0.0),
            Err(LineRefusal::NoLine { slot: last })
        );
        assert_eq!(
            engine.move_line(slot, 0.0),
            Err(LineRefusal::NoLine { slot })
        );
        // The first partition's line moves.
        assert!(engine.move_line(regions[0], 120.0).is_ok());
    }
}
