//! The limits of a load and of the graph (ADR-0009): how many nodes and edges, how long an
//! identifier and a text, and how many code units the identifiers of one load hold together, with
//! the checks behind the exports `checkIdBudget` and `checkGraphSize`.

use super::{GraphDataProblem, malformed};

/// The most UTF-16 code units, the length JavaScript gives a string, of a text of node content or
/// an edge label's text.
pub const MAX_TEXT: usize = TEXT_LIMIT as usize;

/// The most nodes, and the most edges, of one graph.
pub const MAX_ITEMS: u32 = 1_000_000;

/// The most UTF-16 code units of an identifier: a node's or an edge's, or an edge's source or
/// target.
pub const MAX_ID: usize = ID_LIMIT as usize;

/// The most UTF-16 code units of all identifiers of one load together, sources and targets
/// among them, so that the identifiers of a graph within its other limits cost a bounded copy.
pub const MAX_ID_UNITS: u32 = 64_000_000;

/// `MAX_TEXT` as the `u32` a refusal and `textLimit` name, declared in the narrower type so that
/// `MAX_TEXT` widens it.
pub(crate) const TEXT_LIMIT: u32 = 1_000;

/// `MAX_ID` as the `u32` a refusal and `idLimit` name, declared in the narrower type so that
/// `MAX_ID` widens it.
pub(crate) const ID_LIMIT: u32 = 256;

/// The check behind the export `checkIdBudget` of the crate root.
pub(crate) fn check_id_budget(units: f64) -> Result<(), GraphDataProblem> {
    if units.is_nan() || units < 0.0 {
        return Err(malformed("the count of identifier code units is no count"));
    }
    if units > f64::from(MAX_ID_UNITS) {
        return Err(GraphDataProblem::IdBudgetExceeded {
            limit: MAX_ID_UNITS,
        });
    }
    Ok(())
}

/// The check behind the export `checkGraphSize` of the crate root.
pub(crate) fn check_graph_size(nodes: f64, edges: f64) -> Result<(), GraphDataProblem> {
    for (list, count) in [("nodes", nodes), ("edges", edges)] {
        if !(count >= 0.0 && count.fract() == 0.0) {
            return Err(malformed(&format!("{list} is not a list")));
        }
        if count > f64::from(MAX_ITEMS) {
            return Err(GraphDataProblem::TooMany {
                list: list.to_owned(),
                limit: MAX_ITEMS,
            });
        }
    }
    Ok(())
}

// The malformed-data tests of graph data verify ADR-0010 (see `graph_data::tests`).
// Verifies: ADR-0010
#[cfg(test)]
mod tests {
    use super::*;
    // The export itself, as on the crate root, so that its tests go through it.
    use crate::check_graph_size;

    #[test]
    fn a_graph_beyond_a_million_nodes_or_edges_is_refused_naming_the_list() {
        assert_eq!(check_graph_size(1e6, 1e6), Ok(()));
        let too_many = |list: &str| GraphDataProblem::TooMany {
            list: list.into(),
            limit: 1_000_000,
        };
        assert_eq!(check_graph_size(1e6 + 1.0, 0.0), Err(too_many("nodes")));
        assert_eq!(
            check_graph_size(0.0, 4_294_967_295.0),
            Err(too_many("edges"))
        );
        for count in [f64::NAN, -1.0, 0.5] {
            assert!(matches!(
                check_graph_size(count, 0.0),
                Err(GraphDataProblem::Malformed { .. })
            ));
        }
    }
}
