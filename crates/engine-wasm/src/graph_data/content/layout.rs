//! Node content as the engine's layout and hit test read it (ADR-0013): each element of a node
//! with its text, laid out to a width in the fonts handed over, the height a node lays out to,
//! and the element a point hits.

use comb_engine::content::{self as layout, Cell, Element, Fonts, Placed, Role};
use comb_engine::graph::Level;
use serde::Serialize;
use tsify::Tsify;

use super::{ContentData, KindCode, numbered, role_of};

/// The kind of an element a click reports (ADR-0013): one of the kinds the bridge accepts.
#[derive(Tsify, Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ElementKind {
    Text,
    Action,
    Badge,
    Progress,
    Metric,
    Icon,
}

/// The element of a node a press hits (ADR-0013): its row and column, its kind, and for an
/// action its identifier.
#[derive(Tsify, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ElementHit {
    pub row: u32,
    pub column: u32,
    pub kind: ElementKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[tsify(optional)]
    pub action: Option<String>,
}

impl ContentData {
    /// The element at `element`, its text, where it shows one, the one at `text`, and a metric's
    /// three from there, as the layout reads it; a progress bar and an icon read no text.
    pub(crate) fn element(&self, element: usize, text: usize) -> Element<'_> {
        let kind = self.kinds[element];
        if kind == KindCode::Progress as u8 {
            return Element::Progress;
        }
        if kind == KindCode::Icon as u8 {
            return Element::Icon;
        }
        if kind == KindCode::Metric as u8 {
            return Element::Metric {
                caption: self.text(text),
                value: self.text(text + 1),
                trend: self.text(text + 2),
            };
        }
        self.element_with(element, self.text(text))
    }

    /// The element at `element` as the layout reads it, showing `text` where it shows one; of a
    /// kind other than `metric`, whose three texts `element` reads.
    fn element_with<'t>(&self, element: usize, text: &'t str) -> Element<'t> {
        let kind = self.kinds[element];
        if kind == KindCode::Progress as u8 {
            return Element::Progress;
        }
        if kind == KindCode::Icon as u8 {
            return Element::Icon;
        }
        if kind == KindCode::Action as u8 {
            return Element::Action { text };
        }
        if kind == KindCode::Badge as u8 {
            return Element::Badge { text };
        }
        let role = role_of(self.roles[element]).unwrap_or(Role::Body);
        Element::Text { role, text }
    }

    /// The fractions of the segments of the progress bar at `element`, none for another kind.
    pub(crate) fn fractions(&self, element: usize) -> &[f64] {
        &self.fractions[self.view().segments(element)]
    }

    /// Lays out the content of the node at `node`, `width` wide, in `fonts`, and pushes where its
    /// elements lie onto `out`; `cells` and `rows` are the caller's to reuse.
    pub(crate) fn lay_out<'a>(
        &'a self,
        node: usize,
        width: f32,
        fonts: &Fonts,
        cells: &mut Vec<Cell<'a>>,
        rows: &mut Vec<u32>,
        out: &mut Vec<Placed>,
    ) {
        cells.clear();
        rows.clear();
        // A slot of a graph built without content, as only the tests build one, holds none.
        if node + 1 >= self.row_bounds.len() {
            return;
        }
        let view = self.view();
        for row in view.rows(node) {
            rows.push(numbered(view.elements(row).len()));
        }
        for (_, _, element, at) in self.elements_of(node) {
            cells.push(Cell {
                weight: self.weights[element],
                element: self.element(element, at.text),
            });
        }
        layout::lay_out(cells, rows, width, fonts, out);
    }

    /// The element of the node at `node`, `width` wide and laid out in `fonts`, whose rectangle
    /// holds the point `(x, y)` relative to the node's top-left corner, of the elements drawn at
    /// `level` (`layout::drawn_at`, ADR-0013); `cells`, `rows`, and `placed` are the caller's to
    /// reuse.
    #[expect(
        clippy::too_many_arguments,
        reason = "the node, its point, and the buffers the caller reuses, as `lay_out` takes them"
    )]
    pub(crate) fn element_at<'a>(
        &'a self,
        node: usize,
        width: f32,
        fonts: &Fonts,
        (x, y): (f64, f64),
        level: Level,
        cells: &mut Vec<Cell<'a>>,
        rows: &mut Vec<u32>,
        placed: &mut Vec<Placed>,
    ) -> Option<ElementHit> {
        placed.clear();
        self.lay_out(node, width, fonts, cells, rows, placed);
        let hit = layout::element_at(cells, placed, x, y, level)?;
        let (row, column, element, at) = self.elements_of(node).nth(hit)?;
        let (kind, action) = match self.element(element, at.text) {
            Element::Action { .. } => (ElementKind::Action, Some(self.name(at.name).to_owned())),
            Element::Badge { .. } => (ElementKind::Badge, None),
            Element::Progress => (ElementKind::Progress, None),
            Element::Metric { .. } => (ElementKind::Metric, None),
            Element::Icon => (ElementKind::Icon, None),
            Element::Text { .. } => (ElementKind::Text, None),
        };
        Some(ElementHit {
            row,
            column,
            kind,
            action,
        })
    }

    /// The height the content of the node at `node` lays out to in `fonts`, as the `f32` the engine
    /// keeps; that of no rows for a node without content, as only the tests build one.
    pub(crate) fn height(&self, node: usize, fonts: &Fonts) -> f32 {
        let view = self.view();
        let rows = if node + 1 < self.row_bounds.len() {
            view.rows(node)
        } else {
            0..0
        };
        super::kept_height(view.height(rows, fonts))
    }
}
