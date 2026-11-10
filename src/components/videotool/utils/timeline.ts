import type { TrimSegment } from "../types";

/** Merges overlapping or adjacent cut segments, sorted by start time. */
export function mergeSegments(segs: TrimSegment[]): TrimSegment[] {
  if (!segs.length) return [];
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const out: TrimSegment[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].start <= last.end) last.end = Math.max(last.end, sorted[i].end);
    else out.push({ ...sorted[i] });
  }
  return out;
}
