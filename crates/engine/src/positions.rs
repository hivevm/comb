//! Node positions as one interleaved buffer, `x, y` per node slot (ADR-0010).

/// Why a buffer operation was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PositionError {
    /// A slot beyond the buffer.
    SlotOutOfRange { slot: u32 },
    /// A coordinate or delta that is NaN or infinite.
    NonFinite,
}

/// Moves the nodes in `slots` by `(dx, dy)` within `positions`. Nothing is written unless every
/// slot is in range and the delta is finite, so a refused move leaves the buffer as it was.
pub(crate) fn translate(
    positions: &mut [f32],
    slots: &[u32],
    dx: f32,
    dy: f32,
) -> Result<(), PositionError> {
    if !dx.is_finite() || !dy.is_finite() {
        return Err(PositionError::NonFinite);
    }
    let count = positions.len() / 2;
    if let Some(&slot) = slots.iter().find(|&&slot| slot as usize >= count) {
        return Err(PositionError::SlotOutOfRange { slot });
    }
    for &slot in slots {
        let i = slot as usize * 2;
        positions[i] += dx;
        positions[i + 1] += dy;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translate_moves_only_the_given_slots() {
        let mut positions = [0.0, 0.0, 10.0, 10.0, 20.0, 20.0];
        translate(&mut positions, &[0, 2], 5.0, -5.0).unwrap();
        assert_eq!(positions, [5.0, -5.0, 10.0, 10.0, 25.0, 15.0]);
    }

    #[test]
    fn a_slot_out_of_range_is_refused_and_nothing_moves() {
        let mut positions = [0.0, 0.0, 10.0, 10.0];
        let result = translate(&mut positions, &[0, 2], 1.0, 1.0);
        assert_eq!(result, Err(PositionError::SlotOutOfRange { slot: 2 }));
        assert_eq!(positions, [0.0, 0.0, 10.0, 10.0]);
    }

    #[test]
    fn a_non_finite_delta_is_refused() {
        let mut positions = [0.0, 0.0];
        assert_eq!(
            translate(&mut positions, &[0], f32::NAN, 0.0),
            Err(PositionError::NonFinite)
        );
        assert_eq!(
            translate(&mut positions, &[0], 0.0, f32::INFINITY),
            Err(PositionError::NonFinite)
        );
        assert_eq!(positions, [0.0, 0.0]);
    }
}
