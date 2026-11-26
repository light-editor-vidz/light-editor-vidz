//! Baisse automatique d'une musique sous la voix. Les réglages sont ceux de l'export ; l'aperçu
//! applique les mêmes (`src/lib/ducking.ts`).

/// Niveau (dBFS) au-dessus duquel les autres sons déclenchent la baisse.
pub const THRESHOLD_DB: f64 = -26.0206;
pub const ATTACK_MS: f64 = 20.0;
pub const RELEASE_MS: f64 = 400.0;
/// Baisse maximale acceptée (dB).
pub const MAX_AMOUNT_DB: f64 = 40.0;

/// La baisse demandée, ramenée dans la plage acceptée (0 si absurde).
pub fn amount(db: f64) -> f64 {
    if db.is_finite() {
        db.clamp(0.0, MAX_AMOUNT_DB)
    } else {
        0.0
    }
}

/// Les lignes du graphe qui baissent `[input]` de `db` décibels quand `[key]` se fait entendre,
/// jusqu'à `[output]`. Une porte pilotée par `key` ne laisse passer la musique que pendant la
/// voix ; cette partie, inversée, est retranchée de la musique. La baisse vaut donc exactement
/// `db`, quel que soit le niveau de la voix (un compresseur en donnerait plus ou moins).
/// Les `apad` empêchent la porte de s'arrêter à la fin de la plus courte de ses entrées. Le
/// décalage continu, très en dessous du seuil, évite qu'elle reste ouverte sur une clé nulle.
pub fn graph(input: &str, key: &str, output: &str, db: f64) -> String {
    let cut = 1.0 - 10f64.powf(-amount(db) / 20.0);
    let threshold = 10f64.powf(THRESHOLD_DB / 20.0);
    format!(
        "[{input}]asplit=2[{output}dry][{output}raw];[{output}raw]apad[{output}wet];\
         [{key}]dcshift=shift=0.000001,apad[{output}key];\
         [{output}wet][{output}key]sidechaingate=threshold={threshold:.6}:ratio=9000:range=0:knee=1\
         :attack={ATTACK_MS}:release={RELEASE_MS}[{output}voiced];\
         [{output}voiced]volume={:.6}[{output}cut];\
         [{output}dry][{output}cut]amix=inputs=2:duration=first:normalize=0[{output}]",
        -cut
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cut_is_the_share_of_the_music_to_remove() {
        // −6,02 dB : il reste la moitié, on retranche l'autre.
        let g = graph("a0", "k0", "d0", 6.0206);
        assert!(g.contains("[d0voiced]volume=-0.500000[d0cut]"), "{g}");
        assert!(g.contains("threshold=0.050000"), "{g}");
    }

    #[test]
    fn absurd_amounts_are_tamed() {
        assert_eq!(amount(f64::NAN), 0.0);
        assert_eq!(amount(-3.0), 0.0);
        assert_eq!(amount(500.0), MAX_AMOUNT_DB);
    }
}
