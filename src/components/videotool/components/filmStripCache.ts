const CACHE_SIZE = 8;

/** Les dernières frises : revenir à une largeur déjà vue ne relance pas ffmpeg. */
export const filmStripCache = new Map<string, string[]>();

export function rememberFilmStrip(key: string, thumbs: string[]) {
  if (thumbs.length === 0) return;
  filmStripCache.delete(key);
  filmStripCache.set(key, thumbs);
  while (filmStripCache.size > CACHE_SIZE) filmStripCache.delete(filmStripCache.keys().next().value as string);
}

/** Vide la mémoire des frises (tests). */
export function clearFilmStripCache() {
  filmStripCache.clear();
}
