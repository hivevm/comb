//! Node positions as one interleaved buffer, `x, y` per node slot (ADR-0010).

/// Why a buffer operation was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PositionError {
    /// A slot beyond the buffer.
    SlotOutOfRange { slot: u32 },
    /// A coordinate or delta that is NaN or infinite.
    NonFinite,
}

/// Moves the nodes in `slots` by `(dx, dy)` within `positions`, each as far as keeps it, of the
/// size `sizes` holds for it, within `limit` of the origin on each axis, as `f32` rounds it.
/// Nothing is written unless every slot is in range and the delta is finite, so a refused move
/// leaves the buffer as it was.
pub(crate) fn translate(
    positions: &mut [f32],
    sizes: &[f32],
    slots: &[u32],
    [dx, dy]: [f32; 2],
    limit: f64,
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
        for (axis, delta) in [(i, dx), (i + 1, dy)] {
            // In `f64`, so that a move past `f32` is cut rather than turned infinite.
            let moved = f64::from(positions[axis]) + f64::from(delta);
            let size = f64::from(sizes[axis]);
            #[expect(
                clippy::cast_possible_truncation,
                reason = "cut to within `limit`, far within f32, before it is rounded"
            )]
            let cut = moved.clamp(-limit, (limit - size).max(-limit)) as f32;
            positions[axis] = cut;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translate_moves_only_the_given_slots() {
        let mut positions = [0.0, 0.0, 10.0, 10.0, 20.0, 20.0];
        translate(&mut positions, &[0.0; 6], &[0, 2], [5.0, -5.0], 1e9).unwrap();
        assert_eq!(positions, [5.0, -5.0, 10.0, 10.0, 25.0, 15.0]);
    }

    #[test]
    fn a_slot_out_of_range_is_refused_and_nothing_moves() {
        let mut positions = [0.0, 0.0, 10.0, 10.0];
        let result = translate(&mut positions, &[0.0; 4], &[0, 2], [1.0, 1.0], 1e9);
        assert_eq!(result, Err(PositionError::SlotOutOfRange { slot: 2 }));
        assert_eq!(positions, [0.0, 0.0, 10.0, 10.0]);
    }

    #[test]
    fn a_non_finite_delta_is_refused() {
        let mut positions = [0.0, 0.0];
        assert_eq!(
            translate(&mut positions, &[0.0; 2], &[0], [f32::NAN, 0.0], 1e9),
            Err(PositionError::NonFinite)
        );
        assert_eq!(
            translate(&mut positions, &[0.0; 2], &[0], [0.0, f32::INFINITY], 1e9),
            Err(PositionError::NonFinite)
        );
        assert_eq!(positions, [0.0, 0.0]);
    }

    #[test]
    fn a_move_past_the_limit_stops_where_the_node_meets_it() {
        // A node of 20 × 10 at (90, -90) moved by 1e30 either way, within 100 of the origin.
        let mut positions = [90.0, -90.0];
        translate(&mut positions, &[20.0, 10.0], &[0], [1e30, -1e30], 100.0).unwrap();
        assert_eq!(positions, [80.0, -100.0]);
        translate(
            &mut positions,
            &[20.0, 10.0],
            &[0],
            [f32::MAX, f32::MAX],
            100.0,
        )
        .unwrap();
        assert_eq!(positions, [80.0, 90.0]);
    }
}
