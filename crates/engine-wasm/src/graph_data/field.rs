//! The lenient reading of a field the host application hands over: a value of another type is
//! kept as none, so that the bridge refuses it by name rather than as malformed data.

#[cfg(test)]
use std::cell::Cell;
#[cfg(test)]
use std::fmt;

#[cfg(test)]
use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer};

use super::utf16_length;

/// The length in UTF-16 code units of a field the engine does not keep, or none where it holds
/// no string. A value of another type is refused naming its node or edge and the field, not as
/// malformed data; serde-wasm-bindgen gives each value a deserializer of its own, so the refused
/// one leaves the rest to read. The text itself is not kept: the bridge only checks it.
pub(super) fn text_length<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<usize>, D::Error> {
    Ok(String::deserialize(deserializer)
        .ok()
        .map(|text| utf16_length(&text)))
}

/// A field the engine does not keep that holds a number or nothing: `None` for null or
/// undefined, NaN for a value of another type, a BigInt among them, so that the check refuses
/// it by name.
pub(super) fn optional_number<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<f64>, D::Error> {
    Ok(Option::<f64>::deserialize(deserializer).unwrap_or(Some(f64::NAN)))
}

/// A field of a node or an edge as the host application handed it over: its value, or none where
/// the field is missing or holds a value of another type, which the bridge refuses naming the
/// node or edge and the field (`invalidField`), not as malformed data. serde-wasm-bindgen gives
/// each value a deserializer of its own, so the refused one leaves the rest to read; the error
/// that refused it is dropped unread, and the value never reaches a message. Its TypeScript type
/// is that of the value, which each field names.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Field<T>(pub Option<T>);

impl<T> Default for Field<T> {
    fn default() -> Self {
        Self(None)
    }
}

#[cfg(test)]
thread_local! {
    /// Whether a field of the current `reading` of the tests was refused.
    static REFUSED: Cell<bool> = const { Cell::new(false) };
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Field<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = T::deserialize(deserializer).ok();
        #[cfg(test)]
        if value.is_none() {
            REFUSED.set(true);
        }
        Ok(Self(value))
    }
}

/// What `read` deserializes in the tests, with a refused field of an earlier reading forgotten:
/// the tests' batch of a load, its items after the first with a refused field left unread.
#[cfg(test)]
pub(crate) fn reading<T>(read: impl FnOnce() -> T) -> T {
    REFUSED.set(false);
    let value = read();
    REFUSED.set(false);
    value
}

/// The items of a list of the tests' graph data, each read in full until one holds a refused
/// field, and the rest left unread, as items without fields, so that the list keeps its length.
#[cfg(test)]
pub(super) fn items<'de, D: Deserializer<'de>, T: Deserialize<'de> + Default>(
    deserializer: D,
) -> Result<Vec<T>, D::Error> {
    deserializer.deserialize_seq(Items(std::marker::PhantomData))
}

#[cfg(test)]
struct Items<T>(std::marker::PhantomData<T>);

/// A value left unread.
#[cfg(test)]
struct Unread;

#[cfg(test)]
impl<'de> Deserialize<'de> for Unread {
    fn deserialize<D: Deserializer<'de>>(_deserializer: D) -> Result<Self, D::Error> {
        Ok(Self)
    }
}

#[cfg(test)]
impl<'de, T: Deserialize<'de> + Default> Visitor<'de> for Items<T> {
    type Value = Vec<T>;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a list")
    }

    fn visit_seq<A: de::SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<T>, A::Error> {
        let mut items = Vec::new();
        loop {
            let item = if REFUSED.get() {
                seq.next_element::<Unread>()?.map(|Unread| T::default())
            } else {
                seq.next_element::<T>()?
            };
            match item {
                Some(item) => items.push(item),
                None => return Ok(items),
            }
        }
    }
}

#[cfg(test)]
impl<T> From<T> for Field<T> {
    fn from(value: T) -> Self {
        Self(Some(value))
    }
}
