//! A uniform grid over the bounds of items, for the spatial queries of culling (G-7, ADR-0012).
//!
//! The grid covers the extent it is made for; bounds beyond it fall into its border cells, so a
//! query stays exact however far an item moves, and the grid counts the items that left its
//! extent so that its owner can rebuild it. An item that would cover more than `MAX_SPAN_CELLS`
//! cells, such as a long edge, is kept in an overflow list that every query scans instead. A
//! query returns every item whose cells meet the rectangle, each once; the caller tests the
//! item's own bounds.

use crate::geometry::Rect;

/// The most cells an item is put into; an item that would cover more goes to the overflow list.
const MAX_SPAN_CELLS: usize = 64;

/// The cells an item occupies, inclusive.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Span {
    c0: usize,
    r0: usize,
    c1: usize,
    r1: usize,
}

impl Span {
    fn cells(&self) -> usize {
        (self.c1 - self.c0 + 1) * (self.r1 - self.r0 + 1)
    }
}

/// Where the grid keeps an item.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Place {
    Cells(Span),
    Overflow,
}

/// A grid of square cells, each holding the items whose bounds meet it.
#[derive(Debug, Default)]
pub struct Grid {
    extent: Option<Rect>,
    origin_x: f64,
    origin_y: f64,
    cell: f64,
    cols: usize,
    rows: usize,
    cells: Vec<Vec<u32>>,
    overflow: Vec<u32>,
    places: Vec<Option<Place>>,
    /// Whether each item's bounds lie beyond the extent, and how many do.
    beyond: Vec<bool>,
    beyond_count: usize,
    /// The query that last returned each item, so that an item in several cells comes once.
    seen: Vec<u32>,
    query: u32,
}

impl Grid {
    /// A grid over `extent` with cells of side `cell`, for items `0..items`. A cell side that is
    /// not positive and finite becomes 1; a side so small that the grid would have more than four
    /// cells per item, and at least 64, is doubled until it has no more.
    pub fn new(extent: Rect, cell: f64, items: usize) -> Self {
        let mut cell = if cell.is_finite() && cell > 0.0 {
            cell
        } else {
            1.0
        };
        let most = (items * 4).max(64);
        let count = |span: f64, cell: f64| {
            let n = (span / cell).ceil();
            if n.is_finite() && n >= 1.0 {
                (n as usize).min(most)
            } else {
                1
            }
        };
        let (mut cols, mut rows);
        loop {
            cols = count(extent.max_x - extent.min_x, cell);
            rows = count(extent.max_y - extent.min_y, cell);
            if cols * rows <= most {
                break;
            }
            cell *= 2.0;
        }
        Self {
            extent: Some(extent),
            origin_x: extent.min_x,
            origin_y: extent.min_y,
            cell,
            cols,
            rows,
            cells: vec![Vec::new(); cols * rows],
            overflow: Vec::new(),
            places: vec![None; items],
            beyond: vec![false; items],
            beyond_count: 0,
            seen: vec![0; items],
            query: 0,
        }
    }

    /// How many items have bounds that reach beyond the extent the grid was made for.
    pub fn beyond_extent(&self) -> usize {
        self.beyond_count
    }

    fn index(&self, value: f64, origin: f64, count: usize) -> usize {
        let at = ((value - origin) / self.cell).floor();
        if at.is_nan() || at < 0.0 {
            0
        } else {
            (at as usize).min(count - 1)
        }
    }

    fn span(&self, bounds: &Rect) -> Span {
        Span {
            c0: self.index(bounds.min_x, self.origin_x, self.cols),
            r0: self.index(bounds.min_y, self.origin_y, self.rows),
            c1: self.index(bounds.max_x, self.origin_x, self.cols),
            r1: self.index(bounds.max_y, self.origin_y, self.rows),
        }
    }

    fn remove(&mut self, item: u32, place: Place) {
        match place {
            Place::Overflow => self.overflow.retain(|&other| other != item),
            Place::Cells(span) => {
                for r in span.r0..=span.r1 {
                    for c in span.c0..=span.c1 {
                        self.cells[r * self.cols + c].retain(|&other| other != item);
                    }
                }
            }
        }
    }

    fn insert(&mut self, item: u32, place: Place) {
        match place {
            Place::Overflow => self.overflow.push(item),
            Place::Cells(span) => {
                for r in span.r0..=span.r1 {
                    for c in span.c0..=span.c1 {
                        self.cells[r * self.cols + c].push(item);
                    }
                }
            }
        }
    }

    /// Puts `item` into the cells its `bounds` meet, out of those it was in. An item beyond the
    /// grid's items is ignored.
    pub fn set(&mut self, item: u32, bounds: &Rect) {
        let i = item as usize;
        let Some(&old) = self.places.get(i) else {
            return;
        };
        let beyond = self
            .extent
            .is_some_and(|extent| !(extent.contains_rect(bounds)));
        if beyond != self.beyond[i] {
            self.beyond[i] = beyond;
            if beyond {
                self.beyond_count += 1;
            } else {
                self.beyond_count -= 1;
            }
        }
        let span = self.span(bounds);
        let place = if span.cells() > MAX_SPAN_CELLS {
            Place::Overflow
        } else {
            Place::Cells(span)
        };
        if old == Some(place) {
            return;
        }
        if let Some(old) = old {
            self.remove(item, old);
        }
        self.insert(item, place);
        self.places[i] = Some(place);
    }

    /// Writes into `out`, after clearing it, every item in a cell that `rect` meets and every
    /// item in the overflow list, each once.
    pub fn candidates(&mut self, rect: &Rect, out: &mut Vec<u32>) {
        out.clear();
        self.query = self.query.wrapping_add(1);
        if self.query == 0 {
            self.seen.fill(0);
            self.query = 1;
        }
        let span = self.span(rect);
        let (cols, query) = (self.cols, self.query);
        let (cells, overflow, seen) = (&self.cells, &self.overflow, &mut self.seen);
        let rows = span.r0..=span.r1;
        let found = rows.flat_map(|r| (span.c0..=span.c1).map(move |c| &cells[r * cols + c]));
        for &item in found.chain([overflow]).flatten() {
            let last = &mut seen[item as usize];
            if *last != query {
                *last = query;
                out.push(item);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sorted(mut items: Vec<u32>) -> Vec<u32> {
        items.sort_unstable();
        items
    }

    #[test]
    fn an_item_in_several_cells_comes_once() {
        let mut grid = Grid::new(Rect::new(0.0, 0.0, 100.0, 100.0), 10.0, 2);
        grid.set(0, &Rect::new(5.0, 5.0, 45.0, 45.0));
        grid.set(1, &Rect::new(80.0, 80.0, 85.0, 85.0));
        let mut out = Vec::new();
        grid.candidates(&Rect::new(0.0, 0.0, 50.0, 50.0), &mut out);
        assert_eq!(out, [0]);
        grid.candidates(&Rect::new(0.0, 0.0, 100.0, 100.0), &mut out);
        assert_eq!(sorted(out), [0, 1]);
    }

    #[test]
    fn a_moved_item_leaves_its_old_cells() {
        let mut grid = Grid::new(Rect::new(0.0, 0.0, 100.0, 100.0), 10.0, 1);
        grid.set(0, &Rect::new(5.0, 5.0, 8.0, 8.0));
        grid.set(0, &Rect::new(95.0, 95.0, 98.0, 98.0));
        let mut out = Vec::new();
        grid.candidates(&Rect::new(0.0, 0.0, 10.0, 10.0), &mut out);
        assert!(out.is_empty());
        grid.candidates(&Rect::new(90.0, 90.0, 100.0, 100.0), &mut out);
        assert_eq!(out, [0]);
    }

    #[test]
    fn bounds_beyond_the_grid_fall_into_its_border_cells() {
        let mut grid = Grid::new(Rect::new(0.0, 0.0, 100.0, 100.0), 10.0, 1);
        grid.set(0, &Rect::new(-500.0, 1e9, -490.0, f64::INFINITY));
        let mut out = Vec::new();
        grid.candidates(&Rect::new(-600.0, 1e9, -400.0, 2e9), &mut out);
        assert_eq!(out, [0]);
    }

    #[test]
    fn an_item_over_many_cells_is_found_through_the_overflow_list() {
        // Enough items that the grid keeps its 100 × 100 cells of side 10.
        let mut grid = Grid::new(Rect::new(0.0, 0.0, 1000.0, 1000.0), 10.0, 2500);
        grid.set(0, &Rect::new(0.0, 0.0, 1000.0, 5.0));
        grid.set(1, &Rect::new(500.0, 500.0, 505.0, 505.0));
        assert_eq!(grid.overflow, [0]);
        assert!(grid.cells.iter().all(|cell| !cell.contains(&0)));
        let mut out = Vec::new();
        grid.candidates(&Rect::new(500.0, 500.0, 510.0, 510.0), &mut out);
        assert_eq!(sorted(out.clone()), [0, 1]);
        // Shrunk to one cell, it leaves the overflow list.
        grid.set(0, &Rect::new(1.0, 1.0, 2.0, 2.0));
        assert!(grid.overflow.is_empty());
        grid.candidates(&Rect::new(500.0, 500.0, 510.0, 510.0), &mut out);
        assert_eq!(out, [1]);
    }

    #[test]
    fn the_grid_counts_the_items_beyond_its_extent() {
        let mut grid = Grid::new(Rect::new(0.0, 0.0, 100.0, 100.0), 10.0, 2);
        grid.set(0, &Rect::new(10.0, 10.0, 20.0, 20.0));
        grid.set(1, &Rect::new(90.0, 90.0, 120.0, 95.0));
        assert_eq!(grid.beyond_extent(), 1);
        grid.set(1, &Rect::new(50.0, 50.0, 60.0, 60.0));
        assert_eq!(grid.beyond_extent(), 0);
    }

    #[test]
    fn a_cell_side_that_is_not_positive_becomes_one() {
        let mut grid = Grid::new(Rect::new(0.0, 0.0, 4.0, 4.0), f64::NAN, 1);
        grid.set(0, &Rect::new(3.5, 3.5, 3.6, 3.6));
        let mut out = Vec::new();
        grid.candidates(&Rect::new(3.0, 3.0, 4.0, 4.0), &mut out);
        assert_eq!(out, [0]);
    }
}
