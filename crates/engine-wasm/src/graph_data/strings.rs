//! The string columns of a load (ADR-0034): values concatenated and cut into pieces, each ending
//! where a value ends, with their boundaries in UTF-16 code units; whether they fit, the lengths
//! read off the boundaries, a value named before the column is mapped, and the mapping of the
//! values onto the strings Rust holds.

use super::{GraphDataProblem, malformed};

/// The length of a text in UTF-16 code units, as JavaScript counts it.
pub(crate) fn utf16_length(text: &str) -> usize {
    if text.is_ascii() {
        text.len()
    } else {
        text.encode_utf16().count()
    }
}

/// Whether `bounds` are the boundaries of `count` runs of a column `total` long: one more than
/// there are runs, from 0, never falling, ending at `total`.
pub(super) fn runs_fit(bounds: &[u32], count: usize, total: usize) -> bool {
    bounds.len() == count + 1
        && bounds.first() == Some(&0)
        && bounds.windows(2).all(|pair| pair[0] <= pair[1])
        && bounds.last().map(|&last| last as usize) == Some(total)
}

/// Whether `bounds` are the boundaries of `count` values of a string column in `pieces`: each
/// piece ending where a value ends, and the boundaries those of `count` runs as long as the
/// pieces together (`runs_fit`).
pub(super) fn bounds_fit(bounds: &[u32], count: usize, pieces: &[String]) -> bool {
    let mut end = 0;
    let pieces_end_values = pieces.iter().all(|piece| {
        end += utf16_length(piece);
        u32::try_from(end).is_ok_and(|end| bounds.binary_search(&end).is_ok())
    });
    pieces_end_values && runs_fit(bounds, count, end)
}

/// The lengths of the values of a string column, read off its boundaries.
pub(super) fn lengths(bounds: &[u32]) -> impl Iterator<Item = usize> + '_ {
    bounds.windows(2).map(|pair| (pair[1] - pair[0]) as usize)
}

/// The value at `index` of a string column in `pieces`, with a character a boundary cuts in two
/// given as U+FFFD at each side, as the shell's string of the value alone would have crossed: to
/// name a node before its column is mapped, which takes no boundary as falling between
/// characters. Called only on a column whose pieces fit its boundaries.
pub(super) fn value_at(pieces: &[String], bounds: &[u32], index: usize) -> String {
    let (start, end) = (bounds[index] as usize, bounds[index + 1] as usize);
    let mut value = String::new();
    if start == end {
        return value;
    }
    // The piece the value lies in: the first that ends at or after its end.
    let mut base = 0;
    let mut holding = None;
    for piece in pieces {
        let units = utf16_length(piece);
        if end <= base + units {
            holding = Some(piece);
            break;
        }
        base += units;
    }
    let Some(piece) = holding else {
        return value;
    };
    let (start, end) = (start - base, end - base);
    let mut units = 0;
    for character in piece.chars() {
        let next = units + character.len_utf16();
        if next > start && units < end {
            let whole = units >= start && next <= end;
            value.push(if whole { character } else { '\u{FFFD}' });
        }
        if next >= end {
            break;
        }
        units = next;
    }
    value
}

/// The values of a string column in `pieces` as slices of them, or a refusal as malformed where a
/// boundary falls inside a character, mapped piece by piece. Called only once the pieces fit the
/// boundaries and every value's length is checked: a value the shell cut one code unit beyond its
/// limit may end in half a surrogate pair, and two such values side by side in one piece make one
/// character across their boundary. With a small bound, a piece boundary between two lone
/// surrogates turns each into U+FFFD rather than joining them; at 2^28 the identifier column is
/// always one piece.
pub(super) fn values<'a>(
    pieces: &'a [String],
    bounds: &[u32],
) -> Result<Vec<&'a str>, GraphDataProblem> {
    let spans = spans(pieces, bounds, "an identifier ends inside a character")?;
    Ok(spans
        .into_iter()
        .map(|(piece, start, end)| match pieces.get(piece as usize) {
            Some(text) => &text[start as usize..end as usize],
            None => "",
        })
        .collect())
}

/// Where each value of a string column in `pieces` lies, its piece and its byte range there, as
/// `values` maps them; a value past the last piece, or in a column of no pieces, empty in a piece
/// beyond them.
pub(crate) fn spans(
    pieces: &[String],
    bounds: &[u32],
    inside: &str,
) -> Result<Vec<(u32, u32, u32)>, GraphDataProblem> {
    let mut spans = Vec::with_capacity(bounds.len() - 1);
    let (mut first, mut base) = (0, 0);
    for (index, piece) in pieces.iter().enumerate() {
        let end = base + utf16_length(piece);
        // The piece's values run from the boundary at its start to the last one at its end, so
        // that an empty value where two pieces meet is the earlier one's.
        let last = first + bounds[first..].partition_point(|&bound| bound as usize <= end) - 1;
        let at = (base, numbered(index));
        piece_values(piece, &bounds[first..=last], at, inside, &mut spans)?;
        (first, base) = (last, end);
    }
    let beyond = numbered(pieces.len());
    spans.resize(bounds.len() - 1, (beyond, 0, 0));
    Ok(spans)
}

/// A count of pieces or bytes as the `u32` a span holds: a string column's pieces and their bytes,
/// which WebAssembly's memory bounds below 2^32.
pub(crate) fn numbered(count: usize) -> u32 {
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// Pushes the spans of the values of one piece of a string column onto `spans`, its boundaries
/// `bounds` counted from the column's start and the piece, the `index`th, starting at `base`;
/// a boundary inside a character is refused as malformed with the message `inside`.
fn piece_values(
    text: &str,
    bounds: &[u32],
    (base, index): (usize, u32),
    inside: &str,
    spans: &mut Vec<(u32, u32, u32)>,
) -> Result<(), GraphDataProblem> {
    let units = bounds.iter().map(|&bound| bound as usize - base);
    let offsets: Vec<usize> = if text.is_ascii() {
        units.collect()
    } else {
        let mut offsets = Vec::with_capacity(bounds.len());
        let mut next = units.peekable();
        let mut units = 0;
        for (byte, character) in text.char_indices() {
            while next.next_if_eq(&units).is_some() {
                offsets.push(byte);
            }
            units += character.len_utf16();
            if next.peek().is_some_and(|&bound| bound < units) {
                return Err(malformed(inside));
            }
        }
        offsets.extend(next.map(|_| text.len()));
        offsets
    };
    spans.extend(
        offsets
            .windows(2)
            .map(|at| (index, numbered(at[0]), numbered(at[1]))),
    );
    Ok(())
}

/// Where each text of content lies in its piece, as `spans` maps them, or none where every piece
/// is ASCII, in which a text's code units are its bytes and no boundary falls inside a
/// character, so that a load of ASCII texts maps none of them.
pub(crate) fn text_spans(
    pieces: &[String],
    bounds: &[u32],
) -> Result<Vec<(u32, u32, u32)>, GraphDataProblem> {
    if pieces.iter().all(|piece| piece.is_ascii()) {
        return Ok(Vec::new());
    }
    spans(pieces, bounds, TEXT_INSIDE)
}

/// The refusal of a boundary of a text of content that falls inside a character.
pub(crate) const TEXT_INSIDE: &str = "a text of content ends inside a character";

/// The string at `index` of a column of `pieces` cut by `bounds`, by its span in `spans`, or
/// where they are none, of ASCII pieces at its code units.
pub(super) fn string_at<'a>(
    pieces: &'a [String],
    bounds: &[u32],
    spans: &[(u32, u32, u32)],
    index: usize,
) -> &'a str {
    if spans.is_empty() {
        return ascii_at(pieces, bounds, index);
    }
    let (piece, start, end) = spans[index];
    // An empty string past the last piece, or in a column of no pieces, lies in none.
    pieces
        .get(piece as usize)
        .map_or("", |piece| &piece[start as usize..end as usize])
}

/// The string at `index` of ASCII pieces, at its code units in the piece it lies in.
fn ascii_at<'a>(pieces: &'a [String], bounds: &[u32], index: usize) -> &'a str {
    let (start, end) = (bounds[index] as usize, bounds[index + 1] as usize);
    let mut base = 0;
    for piece in pieces {
        // A string no longer than nothing lies in no piece; any other lies whole in one.
        if start == end {
            break;
        }
        if end <= base + piece.len() {
            return &piece[start - base..end - base];
        }
        base += piece.len();
    }
    ""
}

// The malformed-data tests of graph data verify ADR-0034 (see `graph_data::tests`).
// Verifies: ADR-0034
#[cfg(test)]
mod tests {
    use super::super::tests::{
        TITLE, b_of, batch, cut, d_and, label_in, load_columns, load_edges, load_into,
    };
    use super::super::{
        ID_LIMIT, NodeField, OwnedColumns, OwnedEdgeColumns, edge_columns::unfit_edges,
        node_columns::unfit,
    };
    use super::*;

    #[test]
    fn texts_of_content_cut_inside_a_pair_are_refused_for_their_length_before_any_is_mapped() {
        // Verifies: ADR-0034
        // Two texts of 1,100 code units, cut to 1,001: the first ends in the high half of a pair
        // and the second begins with the low one.
        let texts = format!("{}\u{1F600}{}", "a".repeat(1_000), "b".repeat(1_000));
        let mut columns = b_of(&[&[TITLE]]);
        columns.content.texts = vec![texts];
        columns.content.text_bounds = vec![0, 1_001, 2_002];
        assert_eq!(
            load_columns(&columns).err(),
            Some(GraphDataProblem::ContentTextTooLong {
                node: "a".into(),
                row: 0,
                column: 0,
                field: "text".into(),
                limit: 1_000,
            })
        );
        // A boundary inside a character no length refuses is malformed, never mapped.
        let mut columns = b_of(&[&[TITLE]]);
        columns.content.texts = vec!["\u{1F600}".to_owned()];
        columns.content.text_bounds = vec![0, 1, 2];
        assert_eq!(load_columns(&columns).err(), Some(malformed(TEXT_INSIDE)));
    }

    #[test]
    fn identifiers_cut_inside_a_pair_are_refused_for_their_length_before_any_is_mapped() {
        // Verifies: ADR-0034
        // Two identifiers of 300 code units, cut to 257: the first ends in the high half of a
        // pair and the second begins with the low one, one character across their boundary.
        let ids = format!("{}\u{1F600}{}", "a".repeat(256), "b".repeat(256));
        assert_eq!(
            load_columns(&cut(&ids, &[0, 257, 514], None)).unwrap_err(),
            GraphDataProblem::IdTooLong {
                list: "nodes".into(),
                index: 0,
                field: "id".into(),
                limit: ID_LIMIT,
            }
        );
        // A boundary inside a character no length refuses is malformed, never mapped.
        assert_eq!(
            load_columns(&cut("\u{1F600}", &[0, 1, 2], None)).unwrap_err(),
            malformed("an identifier ends inside a character")
        );
        // A node refused by its type in the first pass is named by its identifier as the shell
        // read it, each half of a pair cut in two U+FFFD, as it crossed alone.
        let named = |at, id: String| {
            let columns = cut(&ids, &[0, 257, 514], Some((at, NodeField::X)));
            let problem = load_columns(&columns).unwrap_err();
            assert!(
                matches!(&problem, GraphDataProblem::InvalidField { id: Some(named), .. } if *named == id),
                "{problem:?}"
            );
        };
        named(0, format!("{}\u{FFFD}", "a".repeat(256)));
        named(1, format!("\u{FFFD}{}", "b".repeat(256)));
    }

    /// `values` as the pieces of a string column.
    fn pieces(values: &[&str]) -> Vec<String> {
        values.iter().map(|&value| value.to_owned()).collect()
    }

    #[test]
    fn pieces_that_miss_the_last_boundary_or_end_inside_a_value_are_refused_as_malformed() {
        // Verifies: ADR-0034
        // Nodes `ab` and `cd`, and edges `d` and `e` with label texts of 1 and 3 code units.
        let nodes = |ids: &[&str]| {
            let mut columns = cut("abcd", &[0, 2, 4], None);
            columns.ids = pieces(ids);
            columns
        };
        let edges = |labels: &[&str]| {
            let mut columns = d_and(|e| label_in(e).text_length = Some(3));
            columns.labels = pieces(labels);
            columns
        };
        let no_edges = OwnedEdgeColumns::of([]);
        let mut engine = crate::Engine::new();
        // Pieces that end where values end, an empty one among them, map piece by piece.
        for ids in [&["abcd"][..], &["ab", "cd"], &["ab", "", "cd"]] {
            assert_eq!(load_into(&mut engine, &nodes(ids), &no_edges), Ok(2));
        }
        assert_eq!(engine.positions_len(), 4);
        for labels in [&["xxxx"][..], &["x", "xxx"]] {
            assert!(load_edges(&edges(labels)).is_ok(), "{labels:?}");
        }
        // Lengths that sum short of the last boundary, or past it, or no piece at all.
        let short: [&[&str]; 3] = [&["ab"], &["ab", "cd", "x"], &[]];
        // A piece that ends inside a value, the lengths summing to the last boundary.
        let inside: [&[&str]; 3] = [&["a", "bcd"], &["abc", "d"], &["a", "b", "cd"]];
        for ids in short.into_iter().chain(inside) {
            let refused = load_into(&mut engine, &nodes(ids), &no_edges);
            assert_eq!(refused, Err(unfit()), "{ids:?}");
        }
        assert_eq!(load_edges(&edges(&["x"])).err(), Some(unfit_edges()));
        assert_eq!(load_edges(&edges(&["xx", "xx"])).err(), Some(unfit_edges()));
        // The engine keeps the graph it held, and takes the next load.
        assert_eq!(engine.positions_len(), 4);
        let one = OwnedColumns::of(batch(&[("a", 0.0, 0.0)], &[]).nodes.iter().map(Some));
        assert_eq!(load_into(&mut engine, &one, &no_edges), Ok(1));
        assert_eq!(engine.positions_len(), 2);
    }
}
