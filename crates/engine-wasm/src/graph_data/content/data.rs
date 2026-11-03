//! The content the engine keeps (ADR-0010): the columns of a load or of one node, owned, and
//! once checked, where each text and each name lies in its piece and where each node's first
//! text and first name are, so that a node's strings are found without counting those before it.

use super::codes::filled;
use super::{ContentColumns, GraphDataProblem, numbered, string_at};

/// The content of one or more nodes as the engine keeps it, owned: the columns of a load, or the
/// content of one node `addNode` or `updateNode` handed over, as columns of one node; and once it
/// is checked, where each text and each name lies in its piece, and per node its first text and
/// its first name.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ContentData {
    pub(crate) row_bounds: Vec<u32>,
    pub(crate) element_bounds: Vec<u32>,
    pub(crate) kinds: Vec<u8>,
    pub(crate) weights: Vec<f64>,
    pub(crate) roles: Vec<u8>,
    pub(crate) directions: Vec<u8>,
    pub(crate) colors: Vec<f64>,
    pub(crate) segment_bounds: Vec<u32>,
    pub(crate) fractions: Vec<f64>,
    pub(crate) segment_colors: Vec<f64>,
    pub(crate) texts: Vec<String>,
    pub(crate) text_bounds: Vec<u32>,
    pub(crate) text_valid: Vec<u8>,
    pub(crate) names: Vec<String>,
    pub(crate) name_bounds: Vec<u32>,
    pub(crate) name_valid: Vec<u8>,
    /// Per text, its piece and the byte range it holds there, once mapped; none where every
    /// piece is ASCII, whose texts lie at their code units.
    pub(crate) spans: Vec<(u32, u32, u32)>,
    /// Per name, as `spans` per text.
    pub(crate) name_spans: Vec<(u32, u32, u32)>,
    /// Per node, the index of its first name, once indexed; none where no element names one.
    pub(crate) name_starts: Vec<u32>,
    /// Per node, the index of its first text, once indexed; none where every element fills one
    /// text, so that the text of an element is the one of its index.
    pub(crate) text_starts: Vec<u32>,
}

/// `value`, a colour the content's check found an integer from 0 to 0xFFFFFF, as a `u32`.
pub(crate) fn rgb_of(value: f64) -> u32 {
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "an integer from 0 to 0xFFFFFF, as the content's check made sure"
    )]
    let color = value as u32;
    color
}

/// Where the strings of an element lie: the index of its text, and of its name, where it fills
/// one.
#[derive(Clone, Copy, Debug)]
pub(crate) struct StringAt {
    pub(crate) text: usize,
    pub(crate) name: usize,
}

impl ContentData {
    /// The columns of the content.
    pub(crate) fn view(&self) -> ContentColumns<'_> {
        ContentColumns {
            row_bounds: &self.row_bounds,
            element_bounds: &self.element_bounds,
            kinds: &self.kinds,
            weights: &self.weights,
            roles: &self.roles,
            directions: &self.directions,
            colors: &self.colors,
            segment_bounds: &self.segment_bounds,
            fractions: &self.fractions,
            segment_colors: &self.segment_colors,
            texts: &self.texts,
            text_bounds: &self.text_bounds,
            text_valid: &self.text_valid,
            names: &self.names,
            name_bounds: &self.name_bounds,
            name_valid: &self.name_valid,
        }
    }

    /// Maps every text and every name onto the string Rust holds, or refuses as malformed where a
    /// boundary falls inside a character, and indexes the names. Called only once every string's
    /// length has been checked (ADR-0010).
    pub(crate) fn map(&mut self) -> Result<(), GraphDataProblem> {
        self.spans = super::text_spans(&self.texts, &self.text_bounds)?;
        self.name_spans = super::text_spans(&self.names, &self.name_bounds)?;
        self.index_strings();
        Ok(())
    }

    /// Notes the index of each node's first text and first name, so that a node's strings are
    /// found without counting those before it; no texts' where every element fills one text, and
    /// no names' where no element names one.
    pub(crate) fn index_strings(&mut self) {
        let one_text_each = self.kinds.iter().all(|&kind| filled(kind).0 == 1);
        self.text_starts = if one_text_each {
            Vec::new()
        } else {
            self.starts(|kind| filled(kind).0)
        };
        self.name_starts = if self.name_valid.is_empty() {
            Vec::new()
        } else {
            self.starts(|kind| filled(kind).1)
        };
    }

    /// Per node, how many strings the elements before it fill, each filling `of` its kind.
    fn starts(&self, of: impl Fn(u8) -> usize) -> Vec<u32> {
        let view = self.view();
        let mut count = 0;
        let mut starts = Vec::with_capacity(self.row_bounds.len());
        for node in 0..self.row_bounds.len().saturating_sub(1) {
            starts.push(numbered(count));
            let elements = view.rows(node).flat_map(|row| view.elements(row));
            count += elements
                .map(|element| of(self.kinds[element]))
                .sum::<usize>();
        }
        starts
    }

    /// The code units of the strings of content of the node at `node`, the texts and the names
    /// alike, as a check of it counts them against the budget; none for a slot it holds no
    /// content of.
    pub(crate) fn units_of(&self, node: usize) -> u64 {
        let length = |bounds: &[u32], index: usize| u64::from(bounds[index + 1] - bounds[index]);
        self.elements_of(node)
            .map(|(_, _, element, at)| {
                let (texts, names) = filled(self.kinds[element]);
                let texts = (at.text..at.text + texts).map(|t| length(&self.text_bounds, t));
                let names = (at.name..at.name + names).map(|n| length(&self.name_bounds, n));
                texts.chain(names).sum::<u64>()
            })
            .sum()
    }

    /// The text at `index`, once mapped.
    pub(crate) fn text(&self, index: usize) -> &str {
        string_at(&self.texts, &self.text_bounds, &self.spans, index)
    }

    /// The name at `index`, once mapped.
    pub(crate) fn name(&self, index: usize) -> &str {
        string_at(&self.names, &self.name_bounds, &self.name_spans, index)
    }

    /// The elements of the node at `node`, each with its row and column, its index, the index of
    /// its text, and the index of its name where it names one.
    pub(crate) fn elements_of(
        &self,
        node: usize,
    ) -> impl Iterator<Item = (u32, u32, usize, StringAt)> + '_ {
        let view = self.view();
        let rows = (node + 1 < self.row_bounds.len())
            .then(|| view.rows(node))
            .into_iter()
            .flatten();
        let first = |starts: &[u32]| starts.get(node).map(|&start| start as usize);
        // Where every element fills one text, the node's first is that of its first element.
        let mut text = first(&self.text_starts).unwrap_or_else(|| {
            rows.clone()
                .next()
                .map_or(0, |row| view.elements(row).start)
        });
        let mut name = first(&self.name_starts).unwrap_or(0);
        rows.enumerate()
            .flat_map(move |(r, row)| {
                view.elements(row)
                    .enumerate()
                    .map(move |(c, element)| (r, c, element))
            })
            .map(move |(r, c, element)| {
                let at = (numbered(r), numbered(c), element, StringAt { text, name });
                let (texts, names) = filled(self.kinds[element]);
                text += texts;
                name += names;
                at
            })
    }
}
