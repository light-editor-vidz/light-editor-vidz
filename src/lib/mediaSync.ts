/** Dérive au-delà de laquelle on saute à la bonne position pendant la lecture (secondes). */
export const HARD_SEEK_SECONDS = 0.25;
/** Dérive tolérée pendant la lecture avant de corriger en douceur (la voix ne « saute » pas). */
export const SOFT_DRIFT_SECONDS = 0.04;
/** En pause, la position doit être celle de l'image affichée : une demi-image à 30 i/s. */
export const PAUSED_TOLERANCE_SECONDS = 1 / 60;
/** Correction maximale de vitesse pour rattraper (ou laisser filer) la dérive. */
const MAX_RATE_NUDGE = 0.1;

interface MediaLike {
  currentTime: number;
  playbackRate: number;
  paused?: boolean;
  seeking?: boolean;
  /** 3 (`HAVE_FUTURE_DATA`) ou plus : assez de données pour jouer. */
  readyState?: number;
}

/**
 * Cale un élément `<video>`/`<audio>` sur l'horloge de l'éditeur.
 * - en pause : saut dès qu'on s'écarte d'une demi-image (le pas-à-pas ←/→ doit montrer la bonne
 *   image, pas celle d'il y a 0,2 s) ;
 * - en lecture, tant que l'élément n'est pas réellement parti (lecture demandée mais pas encore
 *   démarrée, saut ou chargement en cours) : rien — il serait « en retard » de tout le temps de
 *   démarrage, et le rattraper par des sauts successifs fait scintiller l'image ;
 * - en lecture : au-delà de 0,25 s, saut ; entre 40 ms et 0,25 s, la vitesse est légèrement
 *   ajustée pour rattraper sans saut brutal ; en dessous, vitesse normale.
 */
export function syncMedia(media: MediaLike, target: number, playing: boolean, baseRate: number): void {
  const drift = media.currentTime - target;
  if (!playing) {
    if (Math.abs(drift) > PAUSED_TOLERANCE_SECONDS) media.currentTime = Math.max(0, target);
    return;
  }
  if (media.paused || media.seeking || (media.readyState !== undefined && media.readyState < 3)) return;
  const size = Math.abs(drift);
  if (size > HARD_SEEK_SECONDS) {
    media.currentTime = Math.max(0, target);
    if (media.playbackRate !== baseRate) media.playbackRate = baseRate;
  } else if (size > SOFT_DRIFT_SECONDS) {
    // En avance (drift > 0) : ralentir ; en retard : accélérer.
    const nudge = Math.min(MAX_RATE_NUDGE, (size / HARD_SEEK_SECONDS) * MAX_RATE_NUDGE) * Math.sign(-drift);
    media.playbackRate = baseRate * (1 + nudge);
  } else if (media.playbackRate !== baseRate) {
    media.playbackRate = baseRate;
  }
}
