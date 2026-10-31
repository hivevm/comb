//! The string columns of a load (ADR-0034): values concatenated and cut into pieces, each ending
//! where a value ends, with their boundaries in UTF-16 code units; whether they fit, the lengths
//! read off the boundaries, a value named before the column is mapped, and the mapping of the
//! values onto the strings Rust holds.

use super::{GraphDataProblem, malformed};

/// The length of a text in UTF-16 code units, as JavaScript counts it.
pub(super) fn utf16_length(text: &str) -> usize {
    if text.is_ascii() {
        text.len()
    } else {
        text.encode_utf16().count()
    }
}

/// Whether `bounds` are the boundaries of `count` values of a string column in `pieces`: one more
/// than there are values, from 0, never falling, each piece ending where a value ends, and the
/// pieces' lengths summing to the last boundary.
pub(super) fn bounds_fit(bounds: &[u32], count: usize, pieces: &[String]) -> bool {
    if bounds.len() != count + 1
        || bounds.first() != Some(&0)
        || !bounds.windows(2).all(|pair| pair[0] <= pair[1])
    {
        return false;
    }
    let mut end = 0;
    for piece in pieces {
        end += utf16_length(piece);
        let ends_a_value = u32::try_from(end).is_ok_and(|end| bounds.binary_search(&end).is_ok());
        if !ends_a_value {
            return false;
        }
    }
    bounds.last().map(|&last| last as usize) == Some(end)
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
