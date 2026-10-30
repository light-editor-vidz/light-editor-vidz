/** Taille de sortie demandée pour l'export : `null` = celle du projet. */
export interface ExportSize {
  width: number | null;
  height: number | null;
}

/**
 * Dimensions exportées pour une cible de résolution (« 1080p », « 720p »…). La cible s'applique
 * au plus petit côté, comme le veut la convention (une vidéo verticale 1080×1920 est du « 1080p ») :
 * appliquée à la hauteur, elle produisait du 608×1080. Jamais d'agrandissement ; dimensions paires
 * (exigence de l'encodage h264).
 */
export function exportDimensions(
  projectWidth: number,
  projectHeight: number,
  target: "original" | number,
): ExportSize & { effective: { width: number; height: number } } {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  if (target === "original") {
    return { width: null, height: null, effective: { width: even(projectWidth), height: even(projectHeight) } };
  }
  const shortSide = Math.min(projectWidth, projectHeight);
  const scale = Math.min(1, target / shortSide);
  const width = even(projectWidth * scale);
  const height = even(projectHeight * scale);
  return { width, height, effective: { width, height } };
}
