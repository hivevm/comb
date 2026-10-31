//! A uniform grid over the bounds of items, for the spatial queries of culling (G-7, ADR-0027).
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

/// A grid of square cells, each holding the items whose bounds meet it. Every grid has at least
/// one column and one row, so that every bounds and every query falls into a cell.
#[derive(Debug)]
pub struct Grid {
    extent: Rect,
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

/// The grid of a graph that never loaded one: the grid an empty load builds, over the unit square,
/// for no items, so that a query and a hit on it find nothing as on an empty graph (Q-7).
impl Default for Grid {
    fn default() -> Self {
        Self::new(Rect::new(0.0, 0.0, 1.0, 1.0), 1.0, 0)
    }
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
                #[expect(
                    clippy::cast_possible_truncation,
                    reason = "a whole number of at least 1; the cast saturates and `most` caps it"
                )]
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
            extent,
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

    /// The column or row of `value`: before the first, beyond the last, or not a number, the
    /// border one, as the cast to `usize` saturates and takes NaN to 0.
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the cast saturates and takes NaN to 0 on purpose, and `count - 1` caps it, as \
                  every grid has a column and a row"
    )]
    fn index(&self, value: f64, origin: f64, count: usize) -> usize {
        (((value - origin) / self.cell).floor() as usize).min(count - 1)
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

    /// Puts `item` into the cells its `bounds` meet, out of those it was in, growing the grid's
    /// records of items to hold it where it lies beyond them, as a slot appended after the highest
    /// does (ADR-0022).
    pub fn set(&mut self, item: u32, bounds: &Rect) {
        let i = item as usize;
        if i >= self.places.len() {
            self.places.resize(i + 1, None);
            self.beyond.resize(i + 1, false);
            self.seen.resize(i + 1, 0);
        }
        let old = self.places[i];
        let beyond = !self.extent.contains_rect(bounds);
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

    /// Takes `items` out of the grid, so that no query finds them until they are set again; each
    /// cell they were in is filtered once, so that many items sharing cells cost each cell once,
    /// not once per item. An item not in the grid is ignored.
    pub fn take(&mut self, items: &[u32]) {
        let mut cells = Vec::new();
        let mut overflow = false;
        for &item in items {
            let i = item as usize;
            let Some(Some(place)) = self.places.get(i).copied() else {
                continue;
            };
            match place {
                Place::Overflow => overflow = true,
                Place::Cells(span) => {
                    for r in span.r0..=span.r1 {
                        cells.extend((span.c0..=span.c1).map(|c| r * self.cols + c));
                    }
                }
            }
            self.places[i] = None;
            if self.beyond[i] {
                self.beyond[i] = false;
                self.beyond_count -= 1;
            }
        }
        cells.sort_unstable();
        cells.dedup();
        let places = &self.places;
        let kept = |other: &u32| places[*other as usize].is_some();
        for cell in cells {
            self.cells[cell].retain(kept);
        }
        if overflow {
            self.overflow.retain(kept);
        }
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
    fn a_default_grid_answers_every_query_with_nothing() {
        // Verifies: Q-7
        let mut grid = Grid::default();
        let mut out = vec![7];
        for rect in [
            Rect::new(0.0, 0.0, 1.0, 1.0),
            Rect::new(-1e300, -1e300, 1e300, 1e300),
            Rect::new(f64::NAN, f64::NAN, f64::INFINITY, f64::INFINITY),
        ] {
            grid.candidates(&rect, &mut out);
            assert!(out.is_empty(), "{rect:?}");
        }
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
    fn an_item_taken_out_is_found_by_no_query_and_counts_no_more_beyond() {
        let mut grid = Grid::new(Rect::new(0.0, 0.0, 100.0, 100.0), 10.0, 3);
        grid.set(0, &Rect::new(5.0, 5.0, 8.0, 8.0));
        grid.set(1, &Rect::new(150.0, 5.0, 160.0, 8.0));
        grid.set(2, &Rect::new(-1e9, -1e9, 1e9, 1e9));
        assert_eq!(grid.beyond_extent(), 2);
        grid.take(&[0, 1]);
        grid.take(&[2, 1]);
        assert_eq!(grid.beyond_extent(), 0);
        let mut out = Vec::new();
        grid.candidates(&Rect::new(-1e10, -1e10, 1e10, 1e10), &mut out);
        assert!(out.is_empty());
        grid.set(1, &Rect::new(5.0, 5.0, 8.0, 8.0));
        grid.candidates(&Rect::new(0.0, 0.0, 10.0, 10.0), &mut out);
        assert_eq!(out, [1]);
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

    #[test]
    fn a_grid_has_at_most_four_cells_per_item_and_at_least_64() {
        // (extent side, cell side, items) and the cell side the grid ends with: doubled from
        // the one asked for until cols · rows <= max(4 · items, 64).
        let cases = [
            // 100 × 100 cells of 10 fit 4 · 2500 exactly; for 2499 the side doubles to 20.
            (1000.0, 10.0, 2500, 10.0, 100),
            (1000.0, 10.0, 2499, 20.0, 50),
            // One item may have 64 cells: sides 1, 2, 4, 8 give 64 · 64 = 4096 (100 per side,
            // capped at 64), 2500, 625, 169 cells, and 16 gives 7 · 7 = 49.
            (100.0, 1.0, 1, 16.0, 7),
            // 100 items may have 400 cells: side 8 gives 13 · 13 = 169.
            (100.0, 1.0, 100, 8.0, 13),
        ];
        for (side, cell, items, expected, per_side) in cases {
            let grid = Grid::new(Rect::new(0.0, 0.0, side, side), cell, items);
            assert_eq!(
                (grid.cell, grid.cols, grid.rows),
                (expected, per_side, per_side),
                "{items} items over {side} from cells of {cell}"
            );
        }
    }

    #[test]
    fn a_grid_away_from_the_origin_counts_its_cells_from_its_corner() {
        // Enough items that the grid keeps its 10 × 10 cells of side 10.
        let mut grid = Grid::new(Rect::new(100.0, 200.0, 200.0, 300.0), 10.0, 25);
        // Columns 1 and 2, rows 3 and 4.
        grid.set(0, &Rect::new(115.0, 235.0, 125.0, 245.0));
        let holding: Vec<usize> = (0..grid.cells.len())
            .filter(|&i| grid.cells[i].contains(&0))
            .collect();
        assert_eq!(holding, [31, 32, 41, 42]);
        // Before the first cell, beyond the last, and not a number: the border cells.
        assert_eq!(grid.index(-1e9, 100.0, 10), 0);
        assert_eq!(grid.index(99.0, 100.0, 10), 0);
        assert_eq!(grid.index(1e300, 100.0, 10), 9);
        assert_eq!(grid.index(f64::NAN, 100.0, 10), 0);
        assert_eq!(grid.index(f64::INFINITY, 100.0, 10), 9);
    }

    #[test]
    fn an_item_moved_from_a_lower_row_leaves_every_cell_it_was_in() {
        let mut grid = Grid::new(Rect::new(0.0, 0.0, 100.0, 100.0), 10.0, 25);
        grid.set(0, &Rect::new(32.0, 52.0, 48.0, 58.0));
        grid.set(0, &Rect::new(1.0, 1.0, 2.0, 2.0));
        let holding: Vec<usize> = (0..grid.cells.len())
            .filter(|&i| grid.cells[i].contains(&0))
            .collect();
        assert_eq!(holding, [0]);
    }

    #[test]
    fn a_span_counts_its_columns_times_its_rows() {
        let span = Span {
            c0: 2,
            r0: 5,
            c1: 10,
            r1: 12,
        };
        assert_eq!(span.cells(), 9 * 8);
    }

    #[test]
    fn an_item_over_more_than_64_cells_goes_to_the_overflow_list() {
        let mut grid = Grid::new(Rect::new(0.0, 0.0, 1000.0, 1000.0), 10.0, 2500);
        // Columns 0 to 63 of one row, 64 cells; then columns 0 to 64, 65 cells.
        grid.set(0, &Rect::new(0.0, 0.0, 635.0, 5.0));
        assert!(grid.overflow.is_empty());
        grid.set(0, &Rect::new(0.0, 0.0, 645.0, 5.0));
        assert_eq!(grid.overflow, [0]);
    }
}
