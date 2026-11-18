//! Node content as the engine's layout and hit test read it (REN-node-content-in-rows): each
//! element of a node with its text, laid out to a width in the fonts handed over, the height a node
//! lays out to, and the element a point hits.

use comb_engine::content::{self as layout, Cell, Element, Fonts, Placed, Role};
use comb_engine::graph::Level;
use comb_engine::shape::{Inner, NodeShape};
use serde::Serialize;
use tsify::Tsify;

use super::{ContentData, KindCode, numbered, role_of};

/// The kind of an element a click reports (REN-node-content-in-rows): one of the kinds the bridge
/// accepts.
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

/// The element of a node a press hits (REN-node-content-in-rows): its row and column, its kind, and
/// for an action its identifier.
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

    /// The inner rectangle of the node at `node`, of node shape `shape` and `[width, height]`,
    /// that its content is laid out in, in `fonts` (REN-node-shapes-cover-uml): a frame's tab as
    /// large as its content uncut. It fills `cells` and `rows`, the caller's to reuse, with the
    /// node's content as the layout reads it, each separator a row of one cell of its own.
    pub(crate) fn inner<'a>(
        &'a self,
        node: usize,
        (shape, [width, height]): (NodeShape, [f32; 2]),
        fonts: &Fonts,
        cells: &mut Vec<Cell<'a>>,
        rows: &mut Vec<u32>,
    ) -> Inner {
        cells.clear();
        rows.clear();
        // A slot of a graph built without content, as only the tests build one, holds none.
        if node + 1 < self.row_bounds.len() {
            let view = self.view();
            let mut elements = self.elements_of(node);
            for row in view.rows(node) {
                // A separator holds no element in the columns: a row of one cell of its own.
                if view.separator(row) {
                    rows.push(1);
                    cells.push(Cell {
                        weight: 1.0,
                        element: Element::Separator,
                    });
                    continue;
                }
                let count = view.elements(row).len();
                rows.push(numbered(count));
                for (_, _, element, at) in elements.by_ref().take(count) {
                    cells.push(Cell {
                        weight: self.weights[element],
                        element: self.element(element, at.text),
                    });
                }
            }
        }
        let tab = if shape == NodeShape::Frame {
            layout::natural(cells, rows, fonts)
        } else {
            [0.0; 2]
        };
        shape.inner(f64::from(width), f64::from(height), tab)
    }

    /// Lays out the content of the node at `node`, of the node shape and size of `frame`, in
    /// `fonts`, within its inner rectangle (`inner`), and pushes where its elements lie onto `out`,
    /// relative to the node's top-left corner, a separator's line among them; `cells` and `rows`
    /// are the caller's to reuse, each separator a row of one cell.
    pub(crate) fn lay_out<'a>(
        &'a self,
        node: usize,
        frame: (NodeShape, [f32; 2]),
        fonts: &Fonts,
        cells: &mut Vec<Cell<'a>>,
        rows: &mut Vec<u32>,
        out: &mut Vec<Placed>,
    ) {
        let inner = self.inner(node, frame, fonts, cells, rows);
        let start = out.len();
        // The inner rectangle moved left and up to whole world units, still within the node, so
        // that the layout's sums stay as exact in `f32` as they are at the node's corner.
        #[expect(
            clippy::cast_possible_truncation,
            reason = "a share of at most 1 of a width and a height f32 holds"
        )]
        let [x, y, inner_width] =
            [inner.x.floor(), inner.y.floor(), inner.width].map(|value| value as f32);
        layout::lay_out(cells, rows, inner_width, fonts, out);
        for placed in &mut out[start..] {
            placed.x += x;
            placed.y += y;
        }
    }

    /// The element of the node at `node`, of the node shape and size of `frame` and laid out in
    /// `fonts`, whose rectangle
    /// holds the point `(x, y)` relative to the node's top-left corner, of the elements drawn at
    /// `level` (`layout::drawn_at`, REN-node-content-in-rows); `cells`, `rows`, and `placed` are
    /// the caller's to reuse.
    #[expect(
        clippy::too_many_arguments,
        reason = "the node, its point, and the buffers the caller reuses, as `lay_out` takes them"
    )]
    pub(crate) fn element_at<'a>(
        &'a self,
        node: usize,
        frame: (NodeShape, [f32; 2]),
        fonts: &Fonts,
        (x, y): (f64, f64),
        level: Level,
        cells: &mut Vec<Cell<'a>>,
        rows: &mut Vec<u32>,
        placed: &mut Vec<Placed>,
    ) -> Option<ElementHit> {
        placed.clear();
        self.lay_out(node, frame, fonts, cells, rows, placed);
        let hit = layout::element_at(cells, placed, x, y, level)?;
        // Of the elements of the columns, which hold none for a separator before it.
        let separators = cells[..hit]
            .iter()
            .filter(|cell| matches!(cell.element, Element::Separator))
            .count();
        let (row, column, element, at) = self.elements_of(node).nth(hit - separators)?;
        let (kind, action) = match self.element(element, at.text) {
            Element::Action { .. } => (ElementKind::Action, Some(self.name(at.name).to_owned())),
            Element::Badge { .. } => (ElementKind::Badge, None),
            Element::Progress => (ElementKind::Progress, None),
            Element::Metric { .. } => (ElementKind::Metric, None),
            Element::Icon => (ElementKind::Icon, None),
            Element::Text { .. } | Element::Separator => (ElementKind::Text, None),
        };
        Some(ElementHit {
            row,
            column,
            kind,
            action,
        })
    }

    /// The height the content of the node at `node` lays out to in `fonts`, before its node shape
    /// (`node_height`); that of no rows for a node without content, as only the tests build one.
    pub(crate) fn height(&self, node: usize, fonts: &Fonts) -> f64 {
        let view = self.view();
        let rows = if node + 1 < self.row_bounds.len() {
            view.rows(node)
        } else {
            0..0
        };
        view.height(rows, fonts)
    }

    /// The height `height` gives of the node at `node`, and its number of rows.
    pub(crate) fn laid(&self, node: usize, fonts: &Fonts) -> (f64, usize) {
        let rows = if node + 1 < self.row_bounds.len() {
            self.view().rows(node).len()
        } else {
            0
        };
        (self.height(node, fonts), rows)
    }
}
