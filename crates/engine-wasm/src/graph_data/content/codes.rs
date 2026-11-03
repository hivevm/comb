//! The codes and limits of node content (ADR-0013, ADR-0010): the most rows, columns, and
//! segments, the code of each of the six kinds, `text`, `action`, `badge`, `progress`, `metric`,
//! and `icon`, of a text's role and of a trend's direction, and how many strings each kind fills.

use comb_engine::content::{Direction, Role};
use wasm_bindgen::prelude::wasm_bindgen;

/// The most rows of one node's content.
pub const MAX_ROWS: usize = ROW_LIMIT as usize;

/// The most columns of one row.
pub const MAX_COLUMNS: usize = COLUMN_LIMIT as usize;

/// The most UTF-16 code units of the strings of all content in one load together, the texts and
/// the names alike, and of all content the graph holds after every edit: at least the titles a
/// load held before content, 1,000 code units for each of 1,000,000 nodes, and below 2^32, so
/// that every boundary fits a `Uint32Array` (ADR-0010).
pub const MAX_CONTENT_UNITS: u32 = 1_000_000_000;

/// `MAX_ROWS` as the `u32` a refusal and `rowLimit` name.
pub(crate) const ROW_LIMIT: u32 = 8;

/// `MAX_COLUMNS` as the `u32` a refusal and `columnLimit` name.
pub(crate) const COLUMN_LIMIT: u32 = 6;

/// The most segments of one progress bar.
pub const MAX_SEGMENTS: usize = SEGMENT_LIMIT as usize;

/// `MAX_SEGMENTS` as the `u32` a refusal and `segmentLimit` name.
pub(crate) const SEGMENT_LIMIT: u32 = 8;

/// The code of an element's kind in its column (ADR-0010): `Unnamed` for an element whose kind
/// names none the snapshot codes, or that is no object, which its rule refuses.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KindCode {
    Text,
    Action,
    Badge,
    Progress,
    Metric,
    Icon,
    Unnamed,
}

/// The code of a text's role in its column: `Unnamed` for a role that names none, which its rule
/// refuses.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoleCode {
    Title,
    Body,
    Caption,
    Unnamed,
}

/// The code of a trend's direction in its column: `Unnamed` for a direction that names none, or a
/// trend that is no object, which its rule refuses; 0 for an element of another kind.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DirectionCode {
    Up,
    Down,
    Flat,
    Unnamed,
}

/// The kind of `name`, as the snapshot codes it, `Unnamed` for a string that names none.
pub(crate) fn kind_code(name: &str) -> KindCode {
    match name {
        "text" => KindCode::Text,
        "action" => KindCode::Action,
        "badge" => KindCode::Badge,
        "progress" => KindCode::Progress,
        "metric" => KindCode::Metric,
        "icon" => KindCode::Icon,
        _ => KindCode::Unnamed,
    }
}

/// The role of `name`, `Unnamed` for a string that names none.
pub(crate) fn role_code(name: &str) -> RoleCode {
    match name {
        "title" => RoleCode::Title,
        "body" => RoleCode::Body,
        "caption" => RoleCode::Caption,
        _ => RoleCode::Unnamed,
    }
}

/// The direction of `name`, `Unnamed` for a string that names none.
pub(crate) fn direction_code(name: &str) -> DirectionCode {
    match name {
        "up" => DirectionCode::Up,
        "down" => DirectionCode::Down,
        "flat" => DirectionCode::Flat,
        _ => DirectionCode::Unnamed,
    }
}

/// The direction of `code`, or none for `Unnamed` and a code no direction has.
pub(crate) fn direction_of(code: u8) -> Option<Direction> {
    [
        (DirectionCode::Up, Direction::Up),
        (DirectionCode::Down, Direction::Down),
        (DirectionCode::Flat, Direction::Flat),
    ]
    .into_iter()
    .find(|&(of, _)| of as u8 == code)
    .map(|(_, direction)| direction)
}

/// The role of `code`, or none for `Unnamed` and a code no role has.
pub(crate) fn role_of(code: u8) -> Option<Role> {
    [
        (RoleCode::Title, Role::Title),
        (RoleCode::Body, Role::Body),
        (RoleCode::Caption, Role::Caption),
    ]
    .into_iter()
    .find(|&(of, _)| of as u8 == code)
    .map(|(_, role)| role)
}

/// How many strings an element of `kind` fills of the texts and of the names (ADR-0010).
pub(super) fn filled(kind: u8) -> (usize, usize) {
    match kind {
        k if k == KindCode::Text as u8 => (1, 0),
        k if k == KindCode::Action as u8 => (1, 1),
        k if k == KindCode::Badge as u8 => (1, 0),
        k if k == KindCode::Metric as u8 => (3, 0),
        k if k == KindCode::Icon as u8 => (0, 1),
        _ => (0, 0),
    }
}
