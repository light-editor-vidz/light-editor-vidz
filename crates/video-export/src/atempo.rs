//! Le filtre `atempo` de ffmpeg n'accepte que des vitesses dans [0,5 ; 2] : au-delà, on l'enchaîne.

/// Argument(s) de `atempo=` pour `speed` (une chaîne `2.0,atempo=…` hors de la plage native).
pub fn clamp_atempo(speed: f64) -> String {
    if (0.5..=2.0).contains(&speed) {
        format!("{speed:.4}")
    } else if speed > 2.0 {
        format!("2.0,atempo={:.4}", speed / 2.0)
    } else {
        format!("0.5,atempo={:.4}", speed * 2.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_speed_inside_the_native_range_is_used_as_is() {
        assert_eq!(clamp_atempo(1.0), "1.0000");
        assert_eq!(clamp_atempo(0.5), "0.5000");
        assert_eq!(clamp_atempo(2.0), "2.0000");
    }

    #[test]
    fn a_faster_speed_is_chained() {
        assert_eq!(clamp_atempo(4.0), "2.0,atempo=2.0000");
    }

    #[test]
    fn a_slower_speed_is_chained() {
        assert_eq!(clamp_atempo(0.25), "0.5,atempo=0.5000");
    }
}
