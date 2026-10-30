/** Timecode éditeur vidéo : MM:SS:FF (minutes:secondes:frames). */
export function formatTimecode(totalSeconds: number, fps: number): string {
  const safeFps = fps > 0 ? fps : 30;
  const totalFrames = Math.max(0, Math.round(totalSeconds * safeFps));
  const frames = totalFrames % safeFps;
  const totalSecondsInt = Math.floor(totalFrames / safeFps);
  const seconds = totalSecondsInt % 60;
  const minutes = Math.floor(totalSecondsInt / 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/** Nombre arrondi à `decimals` décimales, sans zéros inutiles ("" si non fini). */
export function formatNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(decimals)));
}
