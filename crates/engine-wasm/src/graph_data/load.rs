//! A load and `addNode`: the columns of a load checked and built into the engine's graph, and a
//! node checked as a load checks one and added to it.

use comb_engine::content::Fonts;
use comb_engine::geometry::WORLD_LIMIT;
use std::collections::HashSet;

use comb_engine::graph::{AddNodeError, Axis, CANVAS, Graph, NestError, Nesting, RegionSlots};
use comb_engine::shape::{NodeShape, Outline};

use super::borders::{attached, check_border, check_target, target_of};
use super::checks::{
    Given, Holder, Nodes, check_attachment, check_container, checked_height, checked_node,
    content_fits_shape, content_of, divided, edges_of, given_height, id_length, ids_of,
    names_within, nodes_of,
};
use super::item::{Batch, Border, given_of, node_of};
#[cfg(test)]
use super::snapshot::{EdgeCells, GraphBatch, OwnedColumns, OwnedEdgeColumns};
use super::{
    Checked, ContentData, EdgeColumns, GraphDataProblem, GraphList, NodeColumns, NodeInput,
    check_graph_size, lengths, text_spans,
};
use super::{
    Region, RegionColumns, check_regions, divide_of, division_problem, malformed, numbered,
    parts_of, within_world_divided,
};

/// A node `addNode` added: the slot the engine chose, the content the bridge keeps of it, and the
/// code units of the name of each of its regions, in the order of their slots.
#[derive(Debug)]
pub(crate) struct Added {
    pub slot: u32,
    pub content: Checked,
    pub names: Vec<u64>,
}

/// A load the bridge accepted: the engine's graph, where each text of its content lies in its
/// piece, which `ContentData` keeps, and the code units of the strings of its content.
pub(crate) struct Loaded {
    pub graph: Graph,
    pub spans: Vec<(u32, u32, u32)>,
    pub name_spans: Vec<(u32, u32, u32)>,
    pub units: u64,
    /// The code units of each region's name, in the order of their slots after the nodes, which
    /// count against the budget of content beside `units`.
    pub names: Vec<u64>,
}

/// Checks a load and builds the engine's graph from it, its nodes and its edges as columns, each
/// node as high as its content lays out to in `fonts`: whether the columns fit together, the
/// load's size, then every field's type, the nodes' before the edges', the identifiers' lengths,
/// the nodes, their content among them, and the edges. Only then are the identifiers and the
/// texts mapped onto the strings Rust holds, the texts once every node is checked.
pub(crate) fn load_of(
    nodes: &NodeColumns,
    edges: &EdgeColumns,
    fonts: &Fonts,
) -> Result<Loaded, GraphDataProblem> {
    let count = nodes.count()?;
    let edge_count = edges.count()?;
    // Each region takes a node slot, counted against the limit of a load
    // (ARCH-regions-are-container-slots).
    let regions = nodes.regions.of.len();
    check_graph_size((count + regions) as f64, edge_count as f64)?;
    nodes.first_refused()?;
    edges.first_refused(edge_count)?;
    let trees = nodes
        .regions
        .trees(nodes.divide)
        .ok_or_else(|| malformed("the columns of the regions do not fit together"))?;
    let region_ids = lengths(nodes.regions.id_bounds);
    ids_of(
        lengths(nodes.id_bounds).chain(region_ids),
        edges.id_lengths(),
    )?;
    let batch = Batch {
        nodes: nodes.nodes()?,
        edges: edges.edges()?,
    };
    let columns = nodes;
    let content = &columns.content;
    let mut nesting = columns.nesting(count, count + regions);
    let mut nodes = nodes_of(&batch, content, fonts)?;
    let mut taken: HashSet<String> = nodes.slots.keys().map(|&id| id.to_owned()).collect();
    // A region's name counts against the budget of content as a text does.
    let mut held = nodes.units;
    for (index, (node, (divide, list))) in batch.nodes.iter().zip(&trees).enumerate() {
        check_regions(node.id, index, *divide, list, &mut taken)?;
        held += names_within(node.id, held, list)?;
    }
    let borders = border_targets(&batch, columns, &trees)?;
    divided_nesting(&batch, &columns.regions, &trees, &mut nesting, &mut nodes)?;
    nodes.positions = world_of(&batch, &nesting, &nodes.positions, &nodes.sizes)?;
    for (i, (node, (divide, list))) in batch.nodes.iter().zip(&trees).enumerate() {
        let at = [nodes.positions[i * 2], nodes.positions[i * 2 + 1]];
        let size = [nodes.sizes[i * 2], nodes.sizes[i * 2 + 1]];
        let content = (nodes.shapes[i], nodes.contents[i]);
        within_world_divided(node.id, *divide, [at, size], content, list)?;
    }
    let spans = text_spans(content.texts, content.text_bounds)?;
    let name_spans = text_spans(content.names, content.name_bounds)?;
    let edges = edges_of(&batch, &nodes.slots)?;
    let mut graph = Graph::nested(nodes.positions, nodes.sizes, edges, nesting)?;
    for (slot, (&given, &resizable)) in (0..).zip(nodes.given.iter().zip(&nodes.resizable)) {
        if given.is_some() || resizable {
            graph
                .set_sizing(slot, given, resizable)
                .unwrap_or_else(|_| unreachable!("a slot of a node just built refuses no sizing"));
        }
    }
    for (slot, &shape) in (0..).zip(&nodes.shapes) {
        if shape != NodeShape::Rectangle {
            graph
                .set_shape(slot, shape)
                .unwrap_or_else(|_| unreachable!("a slot of a node just built refuses no shape"));
        }
    }
    for (slot, &outline) in (0..).zip(&nodes.outlines) {
        if outline != Outline::Solid {
            graph
                .set_outline(slot, outline)
                .unwrap_or_else(|_| unreachable!("a slot of a node just built refuses no outline"));
        }
    }
    divide_loaded(&mut graph, columns, &trees, &nodes.contents);
    // Last, once the boxes of the nodes they ride are what the load gives them.
    for (slot, on, border) in borders {
        attached(&mut graph, slot, on, &border)?;
    }
    Ok(Loaded {
        graph,
        spans,
        name_spans,
        units: nodes.units,
        names: region_names(&trees, &columns.regions),
    })
}

/// The border nodes of a load, checked in slot order, each with the slot of the node it rides
/// and its place (ARCH-border-nodes-ride-sides): every node by the rule of its attachment, a
/// border node then by its own fields, then by what it is attached to, one attached to no node
/// named by the identifier the snapshot handed over.
fn border_targets(
    batch: &Batch,
    columns: &NodeColumns,
    trees: &[(Option<Axis>, Vec<Region>)],
) -> Result<Vec<(u32, u32, Border)>, GraphDataProblem> {
    let count = batch.nodes.len();
    let mut borders = Vec::new();
    for (index, node) in batch.nodes.iter().enumerate() {
        let (divide, regions) = &trees[index];
        let given = Given {
            is_container: columns.is_container[index] == 1,
            regions: divided(*divide, regions).is_some(),
            resizable: node.resizable,
            ..Given::of_bits(columns.given[index])
        };
        check_attachment(node.id, node.border.is_some(), given)?;
        let Some(border) = node.border else {
            continue;
        };
        check_border(node.id, &border)?;
        let slot = numbered(index);
        let on = target_of(columns.attached[index], count)?;
        let named = columns.attached_missing.unwrap_or_default();
        let on = check_target(node.id, slot, on, named, |s| {
            columns.has_attached[s as usize] == 1
        })?;
        borders.push((slot, on, border));
    }
    Ok(borders)
}

/// The code units of the name of each region of a load, in the order of their slots.
fn region_names(trees: &[(Option<Axis>, Vec<Region>)], columns: &RegionColumns) -> Vec<u64> {
    // The regions of each node lie in the slots in the order the columns list them, which the
    // trees keep per node; read back in slot order through the node each divides.
    let nodes = trees.len();
    let mut next = vec![0; nodes];
    let mut roots: Vec<usize> = Vec::with_capacity(columns.of.len());
    columns
        .of
        .iter()
        .map(|&of| {
            let of = of as usize;
            let root = if of < nodes { of } else { roots[of - nodes] };
            roots.push(root);
            let region = &trees[root].1[next[root]];
            next[root] += 1;
            region.name_units()
        })
        .collect()
}

/// Whether each slot of a load, its nodes' and then its regions', is divided into regions: a node
/// with a division and regions, a region that holds regions.
fn divisions(trees: &[(Option<Axis>, Vec<Region>)], columns: &RegionColumns) -> Vec<bool> {
    let count = trees.len();
    let mut slots: Vec<bool> = trees
        .iter()
        .map(|(divide, list)| divided(*divide, list).is_some())
        .collect();
    slots.resize(count + columns.of.len(), false);
    for &of in columns.of {
        if of as usize >= count {
            slots[of as usize] = true;
        }
    }
    slots
}

/// Takes the regions of a load into `nesting` and `nodes` as node slots after the nodes, each in
/// what it divides at its top left corner, a container, its size its extent along the direction
/// of that division; a divided node a container too (ARCH-regions-are-container-slots). Then
/// checks each node's container by the rule of a container, in slot order, the first refused as
/// `invalidContainer`.
fn divided_nesting(
    batch: &Batch,
    regions: &RegionColumns,
    trees: &[(Option<Axis>, Vec<Region>)],
    nesting: &mut Nesting,
    nodes: &mut Nodes,
) -> Result<(), GraphDataProblem> {
    let count = batch.nodes.len();
    let divided = divisions(trees, regions);
    for (slot, &divided) in divided.iter().take(count).enumerate() {
        if divided {
            nesting.is_container[slot] = true;
        }
    }
    for (&of, &size) in regions.of.iter().zip(regions.size) {
        let parent = of as usize;
        let axis = if parent < count {
            trees[parent].0
        } else {
            divide_of(regions.divide[parent - count])
        };
        let mut extent = [0.0; 2];
        #[expect(
            clippy::cast_possible_truncation,
            reason = "a size `check_regions` held to f32"
        )]
        let size = size as f32;
        extent[axis.map_or(0, Axis::index)] = size;
        nesting.containers.push(of);
        nesting.is_container.push(true);
        nodes.positions.extend([0.0, 0.0]);
        nodes.sizes.extend(extent);
    }
    check_containers(batch, nesting, &divided)
}

/// Checks the container of each node of `batch` by `nesting`, its regions among its slots, each of
/// them `divided` into regions or not, by the rule of a container, in slot order. The engine's
/// check of the nesting names the first node in slot order whose container it refuses, for no node
/// of the graph, no container, or a cycle; that node is the one taken to lie in itself. Where the
/// engine refused it for no node or no container, the rule refuses it so before `in_itself` is
/// read; a node before it the engine refused for nothing, so the rule refuses it, if at all, only
/// for a container divided into regions, which the engine does not know.
fn check_containers(
    batch: &Batch,
    nesting: &Nesting,
    divided: &[bool],
) -> Result<(), GraphDataProblem> {
    let first = nesting.check().err().map(|error| match error {
        NestError::NoNode { node }
        | NestError::NotAContainer { node }
        | NestError::InItself { node } => node as usize,
    });
    for (index, (node, &container)) in batch.nodes.iter().zip(&nesting.containers).enumerate() {
        if container == CANVAS {
            continue;
        }
        let at = container as usize;
        let holder = (at < nesting.containers.len()).then(|| Holder {
            divided: divided[at],
            is_container: nesting.is_container[at],
        });
        check_container(node.id, holder, first == Some(index))?;
    }
    Ok(())
}

/// Hands the engine the content of each node of a load, `contents` in slot order, once it has its
/// node shape and the height its data gives: from it the engine computes the height the load
/// checked and the node's regions' top. Then divides each node `trees` divides into its regions,
/// in the slots the load built for them after the nodes, each region `k` of `columns` in slot
/// `count + k`, the regions below that top, a node its data does not mark a container one by its
/// division alone (ARCH-regions-are-container-slots).
fn divide_loaded(
    graph: &mut Graph,
    columns: &NodeColumns,
    trees: &[(Option<Axis>, Vec<Region>)],
    contents: &[Option<f64>],
) {
    for (slot, &content) in (0..).zip(contents) {
        if content.is_some() {
            graph.set_content(slot, content).unwrap_or_else(|_| {
                unreachable!("a slot of a node just built, no region yet, refuses no content")
            });
        }
    }
    let count = trees.len();
    // The slots of each node's regions, in the order of its tree, as `region_names` reads them.
    let mut slots: Vec<Vec<u32>> = vec![Vec::new(); count];
    let mut roots: Vec<usize> = Vec::with_capacity(columns.regions.of.len());
    for (k, &of) in columns.regions.of.iter().enumerate() {
        let of = of as usize;
        let root = if of < count { of } else { roots[of - count] };
        roots.push(root);
        slots[root].push(numbered(count + k));
    }
    for (i, ((divide, regions), slots)) in trees.iter().zip(&slots).enumerate() {
        if divide.is_none() || regions.is_empty() {
            continue;
        }
        let built = RegionSlots::Built {
            slots,
            marked: columns.is_container[i] == 1,
        };
        // Slots of nodes and regions just built, each region in what it divides, within the
        // world as `load_of` checked, which no division refuses.
        graph
            .divide(numbered(i), *divide, &parts_of(regions, &[]), built)
            .unwrap_or_else(|_| unreachable!("a load's checked regions in slots just built"));
    }
}

/// The world positions of the nodes of `batch` at `relative`, `x, y` per node, each relative to its
/// container by `nesting`, of `sizes`, `width, height` per node: the sums along each chain of
/// containers (ARCH-engine-edits-nested-graph), checked once every node is, before the edges, the
/// nesting checked by `check_containers`. A world position whose far side lies past the world's
/// limit is refused as `beyondWorld`, its field the one of a node's own position.
fn world_of(
    batch: &Batch,
    nesting: &Nesting,
    relative: &[f32],
    sizes: &[f32],
) -> Result<Vec<f32>, GraphDataProblem> {
    if nesting.containers.iter().all(|&c| c == CANVAS) {
        return Ok(relative.to_vec());
    }
    let world = nesting.world(relative);
    let mut positions = Vec::with_capacity(world.len());
    for (index, node) in batch.nodes.iter().enumerate() {
        let at = [world[index * 2], world[index * 2 + 1]];
        let size = [sizes[index * 2], sizes[index * 2 + 1]];
        positions.extend(within_world(node.id, at, size)?);
    }
    // A region at the top left corner of the node it divides, within the world as that node is;
    // `arrange` places it.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the world position of a node checked within the world above"
    )]
    positions.extend(world[positions.len()..].iter().map(|&v| v as f32));
    Ok(positions)
}

/// The world position `at` of the node `id` of `size`, `width, height`, narrowed to `f32`, or its
/// refusal as `beyondWorld` where it or its far side lies past the world's limit, its field the
/// one of a node's own position: a sum past `f32` is infinite.
fn within_world(id: &str, at: [f64; 2], size: [f32; 2]) -> Result<[f32; 2], GraphDataProblem> {
    #[expect(
        clippy::cast_possible_truncation,
        reason = "checked against the world's limit as f32 below, so that what f32 cannot hold is \
                  refused"
    )]
    let [x, y] = at.map(|v| v as f32);
    let [width, height] = size;
    let beyond = [
        ("x", x, 0.0),
        ("y", y, 0.0),
        ("width", x, width),
        ("height", y, height),
    ]
    .into_iter()
    .find(|&(_, at, size)| {
        !at.is_finite() || (f64::from(at) + f64::from(size)).abs() > WORLD_LIMIT
    });
    if let Some((field, ..)) = beyond {
        return Err(GraphDataProblem::BeyondWorld {
            list: GraphList::Nodes,
            id: id.to_owned(),
            field: field.to_owned(),
            limit: WORLD_LIMIT,
        });
    }
    Ok([x, y])
}

/// Checks the content of one node, as a load checks a node's, named `id`, of node shape `shape`
/// and `width` wide, its strings counted against the budget on from `held`, the code units of
/// content the graph holds besides it, and returns it with its texts mapped, the height it lays
/// out to in `fonts` in a rectangle, and its number of rows (REN-node-shapes-cover-uml).
pub(super) fn checked_content(
    id: &str,
    shape: NodeShape,
    content: &ContentData,
    fonts: &Fonts,
    held: u64,
) -> Result<(Checked, (f64, usize)), GraphDataProblem> {
    let rows = content.view().rows(0).len();
    content_fits_shape(id, shape, rows)?;
    let (checked, height) = Checked::of(id, content, fonts, held)?;
    Ok((checked, (height, rows)))
}

/// A node one crossing hands over, checked: its place, its width, its node shape, its content
/// with its texts mapped and the height it lays out to with its number of rows, the height the
/// node has, never less, the height its data gives, and whether it is resizable.
struct Single {
    x: f32,
    y: f32,
    width: f32,
    shape: NodeShape,
    outline: Outline,
    content: Checked,
    laid: (f64, usize),
    height: f32,
    given: Option<f32>,
    resizable: bool,
    is_container: bool,
    /// The direction its regions divide it in and its regions, read
    /// (ARCH-regions-are-container-slots).
    divide: Option<Axis>,
    regions: Vec<Region>,
    /// Its place where it is a border node (ARCH-border-nodes-ride-sides).
    border: Option<Border>,
}

/// Checks the node of `addNode` or `heightOf` as a load checks a node, the only one of its batch at
/// index 0: every field's type, its identifier's length, its place and width, its content, its
/// strings counted against the budget on from `held`, laid out in `fonts`, and its far side by that
/// height; the one sequence both crossings refuse by, so that their problems and their order stay
/// one (REN-node-content-and-hits).
fn single_of(input: &NodeInput, fonts: &Fonts, held: u64) -> Result<Single, GraphDataProblem> {
    let (node, content, (divide, regions)) = node_of(0, input)?;
    id_length("nodes", 0, "id", node.id)?;
    let ([x, y], width) = checked_node(&node)?;
    let given = given_height(node.id, node.height)?;
    let outline = node.outline;
    let shape = node.shape;
    let (content, laid) = checked_content(node.id, shape, content, fonts, held)?;
    let height = checked_height(node.id, shape, [y, width], laid, given)?;
    let mut taken = HashSet::from([node.id.to_owned()]);
    check_regions(node.id, 0, divide, &regions, &mut taken)?;
    // Its regions' names count against the budget of content beside its content.
    names_within(node.id, held + content.units, &regions)?;
    Ok(Single {
        x,
        y,
        width,
        shape,
        outline,
        content,
        laid,
        height,
        given,
        resizable: node.resizable,
        is_container: node.is_container,
        divide: divided(divide, &regions),
        regions,
        border: node.border,
    })
}

/// Checks the node `addNode` hands over as a load checks a node, the only one of its batch at
/// index 0, and adds it to `graph`, whose nodes in use stay within `MAX_ITEMS`, as high as its
/// content lays out to in `fonts`, its strings of content counted against the budget on from
/// `held`, the code units of content the graph holds, into the node in `container`, which `api`
/// resolved, or onto the canvas for none, at its position relative to that container; returns
/// what it added. A container is checked by the rule of a container, which refuses a slot that
/// holds no node, the slot `api` names for an identifier its map does not hold among them, as
/// `invalidContainer`; and a world position past the world's limit is refused as `beyondWorld`,
/// after every other check (ARCH-engine-edits-nested-graph). A refused node leaves the graph as it
/// was. That the graph holds no node of its identifier is `api`'s to check, against the map only
/// it keeps (ARCH-one-workspace-per-example).
pub(crate) fn add_node_to(
    graph: &mut Graph,
    node: &NodeInput,
    (container, attached_to): (Option<u32>, Option<u32>),
    fonts: &Fonts,
    held: u64,
) -> Result<Added, GraphDataProblem> {
    let single = single_of(node, fonts, held)?;
    // Each region takes a node slot, counted against the limit of a load.
    let nodes = f64::from(graph.nodes_in_use()) + 1.0 + single.regions.len() as f64;
    check_graph_size(nodes, 0.0)?;
    let ride = ridden(graph, node, &single, attached_to)?;
    let Single {
        x,
        y,
        width,
        shape,
        outline,
        content,
        laid,
        height,
        given,
        resizable,
        is_container,
        divide,
        regions,
        border,
        ..
    } = single;
    let id = node.id.0.as_deref().unwrap_or_default();
    let (container, [x, y]) = match container {
        None => (CANVAS, [x, y]),
        Some(slot) => {
            let holder = graph.holds_node(slot).then(|| Holder {
                divided: graph.holds_regions(slot),
                is_container: graph.is_container(slot),
            });
            check_container(id, holder, false)?;
            let at = &graph.positions()[slot as usize * 2..];
            let world = [
                f64::from(at[0]) + f64::from(x),
                f64::from(at[1]) + f64::from(y),
            ];
            (slot, within_world(id, world, [width, height])?)
        }
    };
    within_world_divided(
        id,
        divide,
        [[x, y], [width, height]],
        (shape, content_of(laid)),
        &regions,
    )?;
    let slot = graph
        .add_node_in(container, is_container, [x, y, width, height])
        .map_err(|error| match error {
            AddNodeError::TooManySlots(error) => GraphDataProblem::from(error),
            // The rule of a container refused every slot that holds no container, before its
            // position was read.
            AddNodeError::NoContainer { .. } => unreachable!("a container checked above"),
        })?;
    // A slot just added, which no node shape, no outline, and no sizing refuses.
    let added = |_| unreachable!("a slot just added refuses no shape, outline, or sizing");
    graph.set_shape(slot, shape).unwrap_or_else(added);
    graph.set_outline(slot, outline).unwrap_or_else(added);
    graph
        .set_sizing(slot, given, resizable)
        .unwrap_or_else(added);
    graph
        .set_content(slot, content_of(laid))
        .unwrap_or_else(|_| unreachable!("a slot just added, no region, refuses no content"));
    if let (Some(on), Some(border)) = (ride, &border) {
        attached(graph, slot, on, border)?;
    }
    if divide.is_some() {
        graph
            .divide(slot, divide, &parts_of(&regions, &[]), RegionSlots::Added)
            .map_err(division_problem)?;
    }
    Ok(Added {
        slot,
        content,
        names: regions.iter().map(Region::name_units).collect(),
    })
}

/// The slot of the node the border node `node`, read as `single`, rides, `attached_to` as `api`
/// resolved it, checked as a load checks a border node; none where it is no border node
/// (ARCH-border-nodes-ride-sides).
fn ridden(
    graph: &Graph,
    node: &NodeInput,
    single: &Single,
    attached_to: Option<u32>,
) -> Result<Option<u32>, GraphDataProblem> {
    let id = node.id.0.as_deref().unwrap_or_default();
    let given = Given {
        is_container: single.is_container,
        regions: single.divide.is_some(),
        resizable: single.resizable,
        ..given_of(node)
    };
    check_attachment(id, single.border.is_some(), given)?;
    let Some(border) = &single.border else {
        return Ok(None);
    };
    check_border(id, border)?;
    let named = node.attached_to.0.as_ref().and_then(Option::as_deref);
    let on = attached_to.filter(|&on| graph.holds_node(on));
    let on = check_target(id, CANVAS, on, named.unwrap_or_default(), |s| {
        graph.is_border(s)
    })?;
    Ok(Some(on))
}

/// The height the content of `node` lays out to at its width in `fonts`, checked as `add_node_to`
/// checks a node, its strings counted against the budget alone, and added to nothing: the node
/// `heightOf` hands over, named `""` and at the origin (REN-node-content-and-hits).
pub(crate) fn height_of(node: &NodeInput, fonts: &Fonts) -> Result<f32, GraphDataProblem> {
    let single = single_of(node, fonts, 0)?;
    // As the engine gives it without a height of its data, which `heightOf` hands over none of:
    // so `single_of` checked this very height against the world's limit already.
    checked_height(
        node.id.0.as_deref().unwrap_or_default(),
        single.shape,
        [single.y, single.width],
        single.laid,
        None,
    )
}

/// A load of `batch` as `loadGraph` checks one, its nodes and edges crossed as columns.
#[cfg(test)]
pub(crate) fn graph_of(batch: &GraphBatch) -> Result<Graph, GraphDataProblem> {
    let edges: Vec<EdgeCells> = batch.edges.iter().map(EdgeCells::from).collect();
    load_of(
        &OwnedColumns::of(batch.nodes.iter().map(Some)).view(),
        &OwnedEdgeColumns::of(edges.iter().map(Some)).view(),
        &Fonts::default(),
    )
    .map(|loaded| loaded.graph)
}

// The malformed-data tests of graph data verify API-bridge-columns-keep-no-size (see
// `graph_data::tests`). Verifies: API-bridge-columns-keep-no-size
#[cfg(test)]
mod tests {
    use super::super::node_columns::Refused;
    use super::super::problem::A_SHAPE;
    use super::super::tests::{
        a_and, add, added, badged, batch, beyond, content, invalid_text, labelled, load_columns,
        load_edges, metricked, titled,
    };
    use super::super::{ContentInput, NodeField, NodeShapeCode, OwnedColumns};
    use super::super::{
        Field, GraphList, ID_LIMIT, KindCode, MAX_ID, MAX_ITEMS, MAX_TEXT, RoleCode, TEXT_LIMIT,
        item::batch_of, problem::A_NUMBER, problem::AN_ARROW, problem::AN_ID,
    };
    use super::*;

    #[test]
    fn a_batch_flattens_into_slot_order() {
        // Each node of one title is as high as the least height of a node.
        let data = batch(&[("a", 1.0, 2.0), ("b", 3.0, 4.0)], &[]);
        let graph = graph_of(&data).unwrap();
        assert_eq!(graph.positions(), [1.0, 2.0, 3.0, 4.0]);
        assert_eq!(graph.sizes(), [100.0, 64.0, 100.0, 64.0]);
    }

    #[test]
    fn edges_resolve_to_the_slots_of_their_nodes() {
        let data = batch(
            &[("a", 0.0, 0.0), ("b", 300.0, 0.0), ("c", 600.0, 0.0)],
            &[("e", "c", "a")],
        );
        let columns = OwnedColumns::of(data.nodes.iter().map(Some));
        let data = batch_of(&data).unwrap();
        let fonts = Fonts::default();
        let nodes = nodes_of(&data, &columns.view().content, &fonts).unwrap();
        let edges = edges_of(&data, &nodes.slots).unwrap();
        assert_eq!(
            (edges[0].source, edges[0].target),
            (
                comb_engine::graph::End::Node(2),
                comb_engine::graph::End::Node(0)
            )
        );
    }

    #[test]
    fn an_added_node_takes_the_next_slot_where_it_was_placed() {
        // Verifies: ARCH-engine-edits-nested-graph
        let mut graph = graph_of(&batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[])).unwrap();
        assert_eq!(add(&mut graph, &added(40.0, 50.0, |_| {})), Ok(2));
        assert_eq!(&graph.positions()[4..], [40.0, 50.0]);
        // On an engine that never loaded a graph too.
        let mut empty = Graph::default();
        assert_eq!(add(&mut empty, &added(1.0, 2.0, |_| {})), Ok(0));
        assert_eq!(empty.positions(), [1.0, 2.0]);
    }

    #[test]
    fn an_added_node_is_refused_as_a_load_refuses_it_and_the_graph_kept() {
        // Verifies: ARCH-one-workspace-per-example, Q-7
        let named = || "n".to_owned();
        let cases: Vec<(NodeInput, GraphDataProblem)> = vec![
            (
                added(f64::INFINITY, 0.0, |_| {}),
                GraphDataProblem::NonFiniteCoordinate { node: named() },
            ),
            (
                added(0.0, 1e39, |_| {}),
                GraphDataProblem::NonFiniteCoordinate { node: named() },
            ),
            (
                added(0.0, 0.0, |n| n.width = (-1.0).into()),
                GraphDataProblem::InvalidSize { node: named() },
            ),
            (
                added(0.0, 0.0, |n| {
                    n.content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
                }),
                invalid_text("n", 0, 0),
            ),
            (
                added(0.0, 0.0, |n| n.content = titled(&"x".repeat(MAX_TEXT + 1))),
                GraphDataProblem::ContentTextTooLong {
                    node: named(),
                    row: 0,
                    column: 0,
                    field: "text".into(),
                    limit: TEXT_LIMIT,
                },
            ),
            (
                added(0.0, 0.0, |n| n.id = "x".repeat(MAX_ID + 1).into()),
                GraphDataProblem::IdTooLong {
                    list: "nodes".into(),
                    index: 0,
                    field: "id".into(),
                    limit: ID_LIMIT,
                },
            ),
            (
                added(0.0, 0.0, |n| n.x = Field(None)),
                GraphDataProblem::InvalidField {
                    list: GraphList::Nodes,
                    index: 0,
                    id: Some(named()),
                    field: "x".into(),
                    expected: A_NUMBER.into(),
                },
            ),
        ];
        for (node, problem) in cases {
            let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
            assert_eq!(add(&mut graph, &node), Err(problem));
            assert_eq!(graph.positions(), [0.0, 0.0]);
            assert_eq!(graph.nodes_in_use(), 1);
        }
    }

    #[test]
    fn the_height_of_content_is_the_one_an_added_node_of_it_takes_whatever_its_texts_and_width() {
        // Verifies: REN-node-content-and-hits
        let shapes = [
            |text: &str| titled(text),
            |text: &str| badged(Some(text), 0x22_a5_5b.into()).into(),
            |text: &str| metricked(0, 0x22_a5_5b.into(), [Some(text); 3]).into(),
        ];
        for shape in shapes {
            let asked = |text: &str, width: f64| {
                let node = added(0.0, 0.0, |n| {
                    n.id = String::new().into();
                    n.width = width.into();
                    n.content = shape(text);
                });
                height_of(&node, &Fonts::default()).unwrap()
            };
            let mut graph = Graph::default();
            let node = added(40.0, 50.0, |n| n.content = shape("Go"));
            let slot = add(&mut graph, &node).unwrap() as usize;
            assert_eq!(asked("Go", 100.0), graph.sizes()[slot * 2 + 1]);
            assert_eq!(asked(&"x".repeat(MAX_TEXT), 3.0), asked("Go", 100.0));
        }
    }

    #[test]
    fn the_height_of_content_is_refused_as_an_added_node_of_it_naming_no_node() {
        // Verifies: REN-node-content-and-hits
        let unnamed = |change: fn(&mut NodeInput)| {
            let node = added(0.0, 0.0, |n| {
                n.id = String::new().into();
                change(n);
            });
            height_of(&node, &Fonts::default())
        };
        assert_eq!(
            unnamed(|n| n.width = (-1.0).into()),
            Err(GraphDataProblem::InvalidSize {
                node: String::new()
            })
        );
        assert_eq!(
            unnamed(|n| {
                n.content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
            }),
            Err(invalid_text("", 0, 0))
        );
        assert_eq!(
            unnamed(|n| n.content = titled(&"x".repeat(MAX_TEXT + 1))),
            Err(GraphDataProblem::ContentTextTooLong {
                node: String::new(),
                row: 0,
                column: 0,
                field: "text".into(),
                limit: TEXT_LIMIT,
            })
        );
    }

    #[test]
    fn a_node_added_to_a_graph_at_the_limit_of_a_load_is_refused() {
        // Verifies: ARCH-one-workspace-per-example, Q-7
        let count = MAX_ITEMS as usize;
        let positions = (0..count).flat_map(|i| [i as f32, 0.0]).collect();
        let mut graph = Graph::new(positions, vec![1.0; count * 2], Vec::new()).unwrap();
        assert_eq!(
            add(&mut graph, &added(0.0, 0.0, |_| {})),
            Err(GraphDataProblem::TooMany {
                list: "nodes".into(),
                limit: MAX_ITEMS,
            })
        );
        assert_eq!(graph.nodes_in_use(), MAX_ITEMS);
        assert_eq!(graph.positions().len(), count * 2);
    }

    #[test]
    fn an_added_node_names_its_regions_of_another_type_before_its_content_as_a_load_does() {
        // Verifies: API-bridge-columns-keep-no-size, ARCH-regions-are-container-slots, Q-7
        // A load's first pass names the regions by their type before any rule of content; so does
        // `addNode`, the one sequence a node is refused by.
        use super::super::problem::A_REGION_LIST;
        let node = added(0.0, 0.0, |n| {
            n.content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
            n.regions = Field(None);
        });
        let problem = || GraphDataProblem::InvalidField {
            list: GraphList::Nodes,
            index: 0,
            id: Some("n".into()),
            field: "regions".into(),
            expected: A_REGION_LIST.into(),
        };
        let columns = OwnedColumns::of([Some(&node)]);
        assert_eq!(load_columns(&columns).map(drop), Err(problem()));
        let mut graph = graph_of(&batch(&[("a", 0.0, 0.0)], &[])).unwrap();
        assert_eq!(add(&mut graph, &node), Err(problem()));
        assert_eq!(graph.nodes_in_use(), 1);
    }

    #[test]
    fn a_coordinate_not_finite_in_an_early_node_is_named_before_a_title_in_a_later_one() {
        // Verifies: API-bridge-columns-keep-no-size
        // The first pass names only the values `Field<T>` reads; a title is checked at its rule,
        // in the second pass, after the nodes before it.
        let ids: Vec<String> = (0..6).map(|i| format!("n{i}")).collect();
        let nodes: Vec<_> = ids.iter().map(|id| (id.as_str(), 0.0, 0.0)).collect();
        let mut data = batch(&nodes, &[]);
        data.nodes[0].x = f64::INFINITY.into();
        // The title of node 5 holds a lone surrogate, which the snapshot hands over as no text.
        data.nodes[5].content = content(&[&[(KindCode::Text, 1.0, RoleCode::Title, None)]]).into();
        assert_eq!(
            graph_of(&data).unwrap_err(),
            GraphDataProblem::NonFiniteCoordinate { node: "n0".into() }
        );
        data.nodes[0].x = 0.0.into();
        assert_eq!(graph_of(&data).unwrap_err(), invalid_text("n5", 0, 0));
    }

    #[test]
    fn the_first_value_refused_by_its_type_is_named_across_nodes_and_edges() {
        // Verifies: API-bridge-columns-keep-no-size
        // A node's refused field is named before any edge's, and an earlier edge's arrowhead
        // that names nothing before a later edge's field the shell named.
        let mut nodes = batch(&[("a", 0.0, 0.0), ("b", 300.0, 0.0)], &[]).nodes;
        nodes[1].y = Field(None);
        let nodes = OwnedColumns::of(nodes.iter().map(Some));
        let mut d = labelled("d");
        d.arrow = Field(Some("start".to_owned()));
        let mut e = labelled("e");
        e.id = Field(None);
        let edges = OwnedEdgeColumns::of([Some(&d), Some(&e)]);
        let refused = |list, index, id: Option<&str>, field: &str, expected: &str| {
            GraphDataProblem::InvalidField {
                list,
                index,
                id: id.map(str::to_owned),
                field: field.into(),
                expected: expected.into(),
            }
        };
        assert_eq!(
            load_of(&nodes.view(), &edges.view(), &Fonts::default()).err(),
            Some(refused(GraphList::Nodes, 1, Some("b"), "y", A_NUMBER))
        );
        assert_eq!(
            load_edges(&edges).err(),
            Some(refused(GraphList::Edges, 0, Some("d"), "arrow", AN_ARROW))
        );
        d.arrow = Field(Some("none".to_owned()));
        let edges = OwnedEdgeColumns::of([Some(&d), Some(&e)]);
        assert_eq!(
            load_edges(&edges).err(),
            Some(refused(GraphList::Edges, 1, None, "id", AN_ID))
        );
    }

    /// Node `b` of the node shape `shape` and `change` made to it, beside a rectangle `a`.
    fn shaped_b(
        shape: crate::NodeShape,
        change: impl FnOnce(&mut NodeInput),
    ) -> Result<Graph, GraphDataProblem> {
        load_columns(&a_and(|n| {
            n.shape = shape.into();
            change(n);
        }))
    }

    #[test]
    fn a_node_lays_out_to_the_height_of_its_node_shape_loaded_added_and_asked_for() {
        // Verifies: REN-node-shapes-cover-uml
        use crate::NodeShape as S;
        // A node 100 wide of one title is 64 high as a rectangle, the least height of content.
        let empty = || ContentInput::new().into();
        let cases: [(S, f32, bool); 7] = [
            (S::Rectangle, 64.0, true),
            (S::RoundedRectangle, 64.0, true),
            (
                S::Ellipse,
                (64.0 / core::f64::consts::FRAC_1_SQRT_2) as f32,
                true,
            ),
            (S::Diamond, 128.0, true),
            (S::Circle, 100.0, false),
            (S::RingedCircle, 100.0, false),
            (S::Bar, 8.0, false),
        ];
        for (shape, height, holds) in cases {
            let change = |n: &mut NodeInput| {
                if !holds {
                    n.content = empty();
                }
            };
            let graph = shaped_b(shape, change).unwrap();
            assert_eq!(graph.sizes()[3], height, "{shape:?} loaded");
            assert_eq!(graph.shape(1), shape.into(), "{shape:?} loaded");
            let node = added(0.0, 0.0, |n| {
                n.shape = shape.into();
                change(n);
            });
            let mut graph = Graph::default();
            assert_eq!(add(&mut graph, &node), Ok(0));
            assert_eq!(graph.sizes()[1], height, "{shape:?} added");
            assert_eq!(graph.shape(0), shape.into(), "{shape:?} added");
            assert_eq!(height_of(&node, &Fonts::default()), Ok(height), "{shape:?}");
        }
    }

    #[test]
    fn a_pentagon_a_notch_a_note_and_a_frame_are_as_high_as_their_content_loaded_added_and_asked() {
        // Verifies: REN-node-shapes-cover-uml
        use crate::NodeShape as S;
        for shape in [S::Pentagon, S::NotchedRectangle, S::Note, S::Frame] {
            let graph = shaped_b(shape, |_| ()).unwrap();
            assert_eq!(graph.sizes()[3], 64.0, "{shape:?} loaded");
            assert_eq!(graph.shape(1), shape.into(), "{shape:?} loaded");
            let node = added(0.0, 0.0, |n| n.shape = shape.into());
            let mut graph = Graph::default();
            assert_eq!(add(&mut graph, &node), Ok(0));
            assert_eq!(graph.sizes()[1], 64.0, "{shape:?} added");
            assert_eq!(height_of(&node, &Fonts::default()), Ok(64.0), "{shape:?}");
        }
    }

    #[test]
    fn an_outline_loads_as_given_and_one_naming_none_or_dashed_as_no_edge_is_is_refused_by_its_field()
     {
        // Verifies: REN-node-shapes-cover-uml, API-bridge-columns-keep-no-size, Q-7
        use super::super::Outline as O;
        use super::super::problem::AN_OUTLINE;
        let dashed = |dash, gap| Some(O::Dashed(super::super::Pair([dash, gap])));
        let outlined =
            |outline: Option<Option<O>>| load_columns(&a_and(|n| n.outline = Field(outline)));
        // Left out, solid; `"none"` and a dash pattern as given.
        let kept = |outline| outlined(Some(outline)).map(|graph| graph.outline(1));
        assert_eq!(kept(None), Ok(comb_engine::shape::Outline::Solid));
        assert_eq!(kept(Some(O::None)), Ok(comb_engine::shape::Outline::None));
        assert_eq!(
            kept(dashed(6.0, 4.0)),
            Ok(comb_engine::shape::Outline::Dashed([6.0, 4.0]))
        );
        assert_eq!(
            kept(dashed(6.0, 0.0)),
            Ok(comb_engine::shape::Outline::Dashed([6.0, 0.0]))
        );
        // A value of another type, or a name of none, and a dash an edge's rule refuses.
        let refused = Err(GraphDataProblem::InvalidField {
            list: GraphList::Nodes,
            index: 1,
            id: Some("b".to_owned()),
            field: "outline".to_owned(),
            expected: AN_OUTLINE.to_owned(),
        });
        for outline in [
            None,
            Some(dashed(0.0, 4.0)),
            Some(dashed(6.0, -1.0)),
            Some(dashed(1e300, 4.0)),
            Some(dashed(f64::NAN, 4.0)),
        ] {
            assert_eq!(outlined(outline).map(|_| ()), refused, "{outline:?}");
        }
        // Read with its field, before a rule of any node: refused before node `a`'s width.
        let mut columns = a_and(|n| n.outline = Field(Some(dashed(0.0, 4.0))));
        columns.width[0] = f64::INFINITY;
        assert_eq!(load_columns(&columns).map(|_| ()), refused);
    }

    #[test]
    fn an_outline_of_add_node_is_refused_as_a_load_s_and_columns_of_no_outline_are_malformed() {
        // Verifies: REN-node-shapes-cover-uml, API-bridge-columns-keep-no-size, Q-7
        use super::super::Outline as O;
        use super::super::problem::AN_OUTLINE;
        let dashed = |dash, gap| Some(O::Dashed(super::super::Pair([dash, gap])));
        // The node of `addNode` alike, at index 0.
        let node = added(0.0, 0.0, |n| n.outline = Field(Some(dashed(0.0, 4.0))));
        let refused_added = Err(GraphDataProblem::InvalidField {
            list: GraphList::Nodes,
            index: 0,
            id: Some("n".to_owned()),
            field: "outline".to_owned(),
            expected: AN_OUTLINE.to_owned(),
        });
        let mut graph = Graph::default();
        assert_eq!(add(&mut graph, &node), refused_added);
        assert_eq!(graph.nodes_in_use(), 0);
        let node = added(0.0, 0.0, |n| n.outline = Field(Some(Some(O::None))));
        assert_eq!(add(&mut graph, &node), Ok(0));
        assert_eq!(graph.outline(0), comb_engine::shape::Outline::None);
        // Columns whose outline is no code, or does not fit the nodes, are malformed.
        let mut columns = a_and(|_| ());
        columns.outline[1] = super::super::OutlineCode::Unnamed as u8 + 1;
        assert!(matches!(
            load_columns(&columns),
            Err(GraphDataProblem::Malformed { .. })
        ));
        let mut columns = a_and(|_| ());
        columns.outline_gap.pop();
        assert!(matches!(
            load_columns(&columns),
            Err(GraphDataProblem::Malformed { .. })
        ));
    }

    #[test]
    fn a_separator_row_that_holds_elements_or_a_byte_past_one_is_malformed() {
        // Verifies: API-bridge-columns-keep-no-size
        let mut columns = a_and(|_| ());
        // Node `b`'s one row, its title, marked a separator.
        columns.content.separators[1] = 1;
        assert!(matches!(
            load_columns(&columns),
            Err(GraphDataProblem::Malformed { .. })
        ));
        columns.content.separators[1] = 2;
        assert!(matches!(
            load_columns(&columns),
            Err(GraphDataProblem::Malformed { .. })
        ));
        let mut columns = a_and(|_| ());
        columns.content.separators.pop();
        assert!(matches!(
            load_columns(&columns),
            Err(GraphDataProblem::Malformed { .. })
        ));
    }

    #[test]
    fn a_height_below_the_content_s_is_raised_a_greater_one_kept_and_content_s_asked_alone() {
        // Verifies: REN-node-shapes-cover-uml, REN-node-content-and-hits,
        // Verifies: API-bridge-columns-keep-no-size, REN-node-content-and-hits
        let given = |height: f64| move |n: &mut NodeInput| n.height = Some(height).into();
        // Of one title, 64 high: a height of 20 raised to it, one of 300 kept.
        for (height, drawn) in [(20.0, 64.0), (300.0, 300.0)] {
            let graph = load_columns(&a_and(given(height))).unwrap();
            assert_eq!(graph.sizes()[3], drawn, "{height} loaded");
            assert_eq!(graph.given_height(1), Some(height as f32));
            let node = added(0.0, 0.0, given(height));
            let mut graph = Graph::default();
            assert_eq!(add(&mut graph, &node), Ok(0));
            assert_eq!(graph.sizes()[1], drawn, "{height} added");
            // `heightOf` still answers the content's height alone.
            assert_eq!(height_of(&node, &Fonts::default()), Ok(64.0));
        }
        // Without content, as its data gives however small, or as wide.
        let empty = |n: &mut NodeInput| n.content = ContentInput::new().into();
        let graph = load_columns(&a_and(|n| {
            empty(n);
            n.height = Some(10.0).into();
        }))
        .unwrap();
        assert_eq!(graph.sizes()[3], 10.0);
        assert_eq!(load_columns(&a_and(empty)).unwrap().sizes()[3], 100.0);
        // `heightOf` answers what Comb draws of a node without content and without a height.
        let node = added(0.0, 0.0, empty);
        assert_eq!(height_of(&node, &Fonts::default()), Ok(100.0));
        // Resizable as its data says.
        let graph = load_columns(&a_and(|n| n.resizable = Some(true).into())).unwrap();
        assert!(graph.is_resizable(1) && !graph.is_resizable(0));
    }

    #[test]
    fn a_height_not_finite_or_not_above_0_as_f32_holds_it_is_refused_naming_the_node() {
        // Verifies: API-bridge-columns-keep-no-size, Q-7
        let refused = || GraphDataProblem::InvalidSize { node: "b".into() };
        for height in [0.0, -1.0, f64::NAN, f64::INFINITY, 1e300] {
            let columns = a_and(|n| n.height = Some(height).into());
            assert_eq!(load_columns(&columns).err(), Some(refused()), "{height}");
            let node = added(0.0, 0.0, |n| {
                n.id = "b".to_owned().into();
                n.height = Some(height).into();
            });
            assert_eq!(add(&mut Graph::default(), &node), Err(refused()));
        }
        // Of another type, named as a field.
        let columns = a_and(|n| n.height = Field(None));
        assert!(matches!(
            load_columns(&columns).err(),
            Some(GraphDataProblem::InvalidField { field, .. }) if field == "height"
        ));
        // A height whose far side lies past the world's limit, by the height the node has.
        let columns = a_and(|n| {
            n.y = 1e36.into();
            n.height = Some(1e36).into();
        });
        assert_eq!(
            load_columns(&columns).err(),
            Some(beyond(GraphList::Nodes, "b", "height"))
        );
    }

    #[test]
    fn content_in_a_filled_node_shape_is_refused_naming_the_node() {
        // Verifies: REN-node-shapes-cover-uml, Q-7
        use crate::NodeShape as S;
        let refused = || GraphDataProblem::ContentInFilledShape { node: "b".into() };
        for shape in [S::Circle, S::RingedCircle, S::Bar] {
            assert_eq!(shaped_b(shape, |_| {}).err(), Some(refused()), "{shape:?}");
            let node = added(0.0, 0.0, |n| {
                n.id = "b".to_owned().into();
                n.shape = shape.into();
            });
            assert_eq!(add(&mut Graph::default(), &node), Err(refused()));
            // Before the rules of the content it holds.
            let node = added(0.0, 0.0, |n| {
                n.id = "b".to_owned().into();
                n.shape = shape.into();
                n.content = titled(&"x".repeat(MAX_TEXT + 1));
            });
            assert_eq!(height_of(&node, &Fonts::default()), Err(refused()));
        }
    }

    #[test]
    fn content_in_a_crossed_circle_or_a_cross_is_refused_as_content_in_a_filled_node_shape() {
        // Verifies: REN-node-shapes-cover-uml, Q-7
        use crate::NodeShape as S;
        let refused = || GraphDataProblem::ContentInFilledShape { node: "b".into() };
        for shape in [S::CrossedCircle, S::Cross] {
            assert_eq!(shaped_b(shape, |_| {}).err(), Some(refused()), "{shape:?}");
            let node = added(0.0, 0.0, |n| {
                n.id = "b".to_owned().into();
                n.shape = shape.into();
            });
            assert_eq!(
                add(&mut Graph::default(), &node),
                Err(refused()),
                "{shape:?}"
            );
            assert_eq!(
                height_of(&node, &Fonts::default()),
                Err(refused()),
                "{shape:?}"
            );
        }
    }

    #[test]
    fn a_crossed_circle_a_cross_an_actor_and_an_hourglass_are_as_high_as_their_node_shape_loaded_added_and_asked()
     {
        // Verifies: REN-node-shapes-cover-uml, REN-node-content-and-hits
        use crate::NodeShape as S;
        let empty = || ContentInput::new().into();
        // A node 100 wide: a crossed circle and a cross without content as high as wide, an actor
        // and an hourglass of one title their drawing, 48 high, above the title and its padding,
        // 38: at least the least height of 64 as a whole node
        // (REN-node-shapes-cover-uml, *Height*).
        let cases: [(S, f32, bool); 4] = [
            (S::CrossedCircle, 100.0, false),
            (S::Cross, 100.0, false),
            (S::Actor, 86.0, true),
            (S::Hourglass, 86.0, true),
        ];
        for (shape, height, holds) in cases {
            let change = |n: &mut NodeInput| {
                if !holds {
                    n.content = empty();
                }
            };
            let graph = shaped_b(shape, change).unwrap();
            assert_eq!(graph.sizes()[3], height, "{shape:?} loaded");
            let node = added(0.0, 0.0, |n| {
                n.shape = shape.into();
                change(n);
            });
            let mut graph = Graph::default();
            assert_eq!(add(&mut graph, &node), Ok(0));
            assert_eq!(graph.sizes()[1], height, "{shape:?} added");
            assert_eq!(height_of(&node, &Fonts::default()), Ok(height), "{shape:?}");
        }
        // Small and without content: a crossed circle and a cross of width 12 and no height 12 by
        // 12, and a circle of width 12, a junction, too.
        for shape in [S::CrossedCircle, S::Cross, S::Circle] {
            let graph = shaped_b(shape, |n| {
                n.width = 12.0.into();
                n.content = empty();
            })
            .unwrap();
            assert_eq!(graph.sizes()[2..4], [12.0, 12.0], "{shape:?}");
        }
        // An actor without content and a height below its drawing's is as high as its drawing: 24
        // for 12 wide, 48 for 100 wide; a height above it is kept.
        for (width, given, height) in [(12.0, 10.0, 24.0), (100.0, 20.0, 48.0), (100.0, 90.0, 90.0)]
        {
            let graph = shaped_b(S::Actor, |n| {
                n.width = width.into();
                n.height = Some(given).into();
                n.content = empty();
            })
            .unwrap();
            assert_eq!(graph.sizes()[3], height, "{width} {given}");
        }
        // An hourglass without content or height is as high as its drawing, 1.5 times its width.
        let graph = shaped_b(S::Hourglass, |n| {
            n.width = 12.0.into();
            n.content = empty();
        })
        .unwrap();
        assert_eq!(graph.sizes()[3], 18.0);
    }

    #[test]
    fn a_node_shape_that_names_none_is_refused_naming_the_node_and_the_field() {
        // Verifies: REN-node-shapes-cover-uml, Q-7
        let shape = |index, id: &str| GraphDataProblem::InvalidField {
            list: GraphList::Nodes,
            index,
            id: Some(id.into()),
            field: "shape".into(),
            expected: A_SHAPE.into(),
        };
        // A load, its code naming none, as the snapshot hands over a node shape of another type
        // or naming none.
        let mut columns = a_and(|_| {});
        columns.shape[1] = NodeShapeCode::Unnamed as u8;
        assert_eq!(load_columns(&columns).err(), Some(shape(1, "b")));
        // Named before a field the shell refused after it, of its node or of a later one, and
        // after one before it.
        let refuse = |columns: &mut OwnedColumns, index, field| {
            columns.refused = Some(Refused {
                index,
                field,
                row: None,
                column: None,
            });
        };
        refuse(&mut columns, 1, NodeField::Content);
        assert_eq!(load_columns(&columns).err(), Some(shape(1, "b")));
        refuse(&mut columns, 1, NodeField::Width);
        assert!(matches!(
            load_columns(&columns),
            Err(GraphDataProblem::InvalidField { field, .. }) if field == "width"
        ));
        columns.shape = vec![NodeShapeCode::Unnamed as u8, 0];
        assert_eq!(load_columns(&columns).err(), Some(shape(0, "a")));
        // `addNode`, as serde reads a name of none.
        let node = added(0.0, 0.0, |n| n.shape = Field(None));
        assert_eq!(add(&mut Graph::default(), &node), Err(shape(0, "n")));
    }
}

/// The tests of a load's nesting (API-bridge-columns-keep-no-size,
/// ARCH-engine-edits-nested-graph).
#[cfg(test)]
mod nesting_tests {
    use super::super::node_columns::Refused;
    use super::super::problem::{
        A_FLAG, A_MARKED_CONTAINER, A_NODE_OF_THE_GRAPH, AN_ID_OR_NONE, NOT_IN_ITSELF,
    };
    use super::super::tests::{batch, beyond, load_columns, load_into};
    use super::super::{Field, NodeField, OwnedColumns, OwnedEdgeColumns};
    use super::*;

    /// Container `c` at (100, 200), and nodes `a` and `b` at (10, 20) and (300, 20), nested by
    /// `containers` and `marks`, with an edge from `a` to `b`.
    fn three(containers: &[Option<u32>], marks: &[bool]) -> (OwnedColumns, OwnedEdgeColumns) {
        let data = batch(
            &[("c", 100.0, 200.0), ("a", 10.0, 20.0), ("b", 300.0, 20.0)],
            &[("e", "a", "b")],
        );
        let edges: Vec<_> = data.edges.iter().map(EdgeCells::from).collect();
        let nodes = OwnedColumns::of(data.nodes.iter().map(Some)).nested(containers, marks);
        (nodes, OwnedEdgeColumns::of(edges.iter().map(Some)))
    }

    fn invalid(node: &str, expected: &str) -> GraphDataProblem {
        GraphDataProblem::InvalidContainer {
            node: node.to_owned(),
            field: "container".to_owned(),
            expected: expected.to_owned(),
        }
    }

    /// The graph of `three` loaded, `c` a container holding `a` and `b`.
    fn loaded_three() -> Graph {
        let (nodes, edges) = three(&[None, Some(0), Some(0)], &[true, false, false]);
        load_of(&nodes.view(), &edges.view(), &Fonts::default())
            .map(|loaded| loaded.graph)
            .unwrap()
    }

    /// Adds `node` to `graph` into the container in `container`, as `addNode` does.
    fn add_into(
        graph: &mut Graph,
        node: &NodeInput,
        container: Option<u32>,
    ) -> Result<u32, GraphDataProblem> {
        add_node_to(graph, node, (container, None), &Fonts::default(), 0).map(|added| added.slot)
    }

    #[test]
    fn a_node_added_into_a_container_lies_at_the_sum_of_its_position_and_the_container_s() {
        // Verifies: ARCH-engine-edits-nested-graph, API-edits-report-division-moves
        let mut graph = loaded_three();
        let node = batch(&[("n", 5.0, 7.0)], &[]).nodes.remove(0);
        let slot = add_into(&mut graph, &node, Some(0)).unwrap();
        assert_eq!(slot, 3);
        assert_eq!(&graph.positions()[6..8], [105.0, 207.0]);
        assert!(!graph.is_container(slot));
        // A container added into nothing, on the canvas, holds a node added into it.
        let mut marked = batch(&[("m", 1000.0, 0.0)], &[]).nodes.remove(0);
        marked.is_container = Some(true).into();
        let inner = add_into(&mut graph, &marked, None).unwrap();
        assert!(graph.is_container(inner));
        let held = add_into(&mut graph, &node, Some(inner)).unwrap();
        assert_eq!(&graph.positions()[held as usize * 2..][..2], [1005.0, 7.0]);
    }

    #[test]
    fn a_node_added_into_no_container_or_past_the_world_is_refused_and_the_graph_stays() {
        // Verifies: ARCH-engine-edits-nested-graph, API-edits-report-division-moves, Q-7
        let mut graph = loaded_three();
        let node = batch(&[("n", 5.0, 7.0)], &[]).nodes.remove(0);
        // A node that is no container, a slot that holds no node.
        assert_eq!(
            add_into(&mut graph, &node, Some(1)),
            Err(invalid("n", A_MARKED_CONTAINER))
        );
        assert_eq!(
            add_into(&mut graph, &node, Some(9)),
            Err(invalid("n", A_NODE_OF_THE_GRAPH))
        );
        // Its world position past the world's limit, by the sum along the container: each within
        // it, together past it.
        let mut away = batch(&[("m", WORLD_LIMIT * 0.6, 0.0)], &[]).nodes.remove(0);
        away.is_container = Some(true).into();
        let container = add_into(&mut graph, &away, None).unwrap();
        let far = batch(&[("n", WORLD_LIMIT * 0.6, 0.0)], &[]).nodes.remove(0);
        assert_eq!(
            add_into(&mut graph, &far, Some(container)),
            Err(beyond(GraphList::Nodes, "n", "x"))
        );
        // A container or a mark of another type.
        let mut named = batch(&[("n", 5.0, 7.0)], &[]).nodes.remove(0);
        named.container = Field(None);
        assert_eq!(
            add_into(&mut graph, &named, None),
            Err(GraphDataProblem::InvalidField {
                list: GraphList::Nodes,
                index: 0,
                id: Some("n".to_owned()),
                field: "container".to_owned(),
                expected: AN_ID_OR_NONE.to_owned(),
            })
        );
        let mut marked = batch(&[("n", 5.0, 7.0)], &[]).nodes.remove(0);
        marked.is_container = Field(None);
        assert_eq!(
            add_into(&mut graph, &marked, None),
            Err(GraphDataProblem::InvalidField {
                list: GraphList::Nodes,
                index: 0,
                id: Some("n".to_owned()),
                field: "isContainer".to_owned(),
                expected: A_FLAG.to_owned(),
            })
        );
        assert_eq!(graph.nodes_in_use(), 4);
    }

    #[test]
    fn a_container_s_nodes_load_at_the_sums_of_their_positions_and_its() {
        // Verifies: API-bridge-columns-keep-no-size, ARCH-engine-edits-nested-graph
        let (nodes, _) = three(&[None, Some(0), Some(0)], &[true, false, false]);
        let graph = load_columns(&nodes).unwrap();
        assert_eq!(
            graph.positions(),
            [100.0, 200.0, 110.0, 220.0, 400.0, 220.0]
        );
        assert!(graph.is_container(0) && !graph.is_container(1));
    }

    #[test]
    fn a_container_that_names_no_node_no_container_the_node_or_one_it_holds_is_refused() {
        // Verifies: API-bridge-columns-keep-no-size, ARCH-engine-edits-nested-graph
        let cases = [
            // Past the slots, as the snapshot writes an identifier that names no node.
            (
                [None, Some(u32::MAX), None],
                [true, false, false],
                invalid("a", A_NODE_OF_THE_GRAPH),
            ),
            (
                [None, Some(3), None],
                [true, false, false],
                invalid("a", A_NODE_OF_THE_GRAPH),
            ),
            (
                [None, Some(2), None],
                [true, false, false],
                invalid("a", A_MARKED_CONTAINER),
            ),
            (
                [Some(0), None, None],
                [true, false, false],
                invalid("c", NOT_IN_ITSELF),
            ),
            (
                [Some(1), Some(0), None],
                [true, true, false],
                invalid("c", NOT_IN_ITSELF),
            ),
        ];
        for (containers, marks, problem) in cases {
            let (nodes, edges) = three(&containers, &marks);
            let mut engine = crate::Engine::new();
            let (loaded, loaded_edges) = three(&[None, None, None], &[false; 3]);
            load_into(&mut engine, &loaded, &loaded_edges).unwrap();
            assert_eq!(
                load_into(&mut engine, &nodes, &edges),
                Err(problem),
                "{containers:?}"
            );
            // The graph stays as it was.
            assert_eq!(
                engine.graph.positions(),
                [100.0, 200.0, 10.0, 20.0, 300.0, 20.0]
            );
            assert!(!engine.graph.is_container(0));
        }
    }

    #[test]
    fn a_nesting_refused_comes_after_every_node_s_checks_and_before_the_edges() {
        // Verifies: API-bridge-columns-keep-no-size
        // A node after the nested one with a width that is negative, and an edge to no node.
        let mut data = batch(
            &[("c", 0.0, 0.0), ("a", 0.0, 0.0), ("b", 0.0, 0.0)],
            &[("e", "a", "nowhere")],
        );
        let edges: Vec<_> = data.edges.iter().map(EdgeCells::from).collect();
        let edges = OwnedEdgeColumns::of(edges.iter().map(Some));
        let fonts = Fonts::default();
        let nest = |data: &GraphBatch| {
            OwnedColumns::of(data.nodes.iter().map(Some))
                .nested(&[None, Some(2), None], &[true, false, false])
        };
        let nodes = nest(&data);
        let refused = load_of(&nodes.view(), &edges.view(), &fonts).err();
        assert_eq!(refused, Some(invalid("a", A_MARKED_CONTAINER)));
        data.nodes[2].width = Field(Some(-1.0));
        let nodes = nest(&data);
        let refused = load_of(&nodes.view(), &edges.view(), &fonts).err();
        assert_eq!(
            refused,
            Some(GraphDataProblem::InvalidSize { node: "b".into() })
        );
    }

    #[test]
    fn a_container_or_a_mark_of_another_type_is_refused_by_its_field_in_the_first_pass() {
        // Verifies: API-bridge-columns-keep-no-size
        for (field, name, expected) in [
            (NodeField::Container, "container", AN_ID_OR_NONE),
            (NodeField::IsContainer, "isContainer", A_FLAG),
        ] {
            let (mut nodes, _) = three(&[None; 3], &[false; 3]);
            nodes.refused = Some(Refused {
                index: 1,
                field,
                row: None,
                column: None,
            });
            assert_eq!(
                load_columns(&nodes).err(),
                Some(GraphDataProblem::InvalidField {
                    list: GraphList::Nodes,
                    index: 1,
                    id: Some("a".into()),
                    field: name.into(),
                    expected: expected.into(),
                })
            );
        }
        // A mark or a presence byte past 1 does not fit the columns.
        let (mut nodes, _) = three(&[None; 3], &[false; 3]);
        nodes.is_container[2] = 2;
        assert!(matches!(
            load_columns(&nodes),
            Err(GraphDataProblem::Malformed { .. })
        ));
    }

    #[test]
    fn a_world_position_past_the_world_s_limit_is_refused_by_the_field_it_passes_by() {
        // Verifies: API-bridge-columns-keep-no-size, Q-7
        // Each position within the limit, their sum past it.
        let far = WORLD_LIMIT * 0.75;
        let data = batch(&[("c", far, 0.0), ("a", far, 0.0)], &[]);
        let nodes =
            OwnedColumns::of(data.nodes.iter().map(Some)).nested(&[None, Some(0)], &[true, false]);
        assert_eq!(
            load_columns(&nodes).err(),
            Some(beyond(GraphList::Nodes, "a", "x"))
        );
    }
}
