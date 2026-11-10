export interface Segment {
  start: number;
  end: number;
}

/** Returns the segments of the video that are NOT cut (i.e. kept). */
export function getKeptSegments(cutSegments: { start: number; end: number }[], duration: number): Segment[] {
  if (!cutSegments.length || duration <= 0) return duration > 0 ? [{ start: 0, end: duration }] : [];
  const sorted = [...cutSegments].sort((a, b) => a.start - b.start);
  const kept: Segment[] = [];
  let pos = 0;
  for (const cut of sorted) {
    if (cut.start > pos) kept.push({ start: pos, end: cut.start });
    pos = Math.max(pos, cut.end);
  }
  if (pos < duration) kept.push({ start: pos, end: duration });
  return kept;
}

/** Total duration of kept segments. */
export function getVirtualDuration(kept: Segment[]): number {
  return kept.reduce((sum, s) => sum + (s.end - s.start), 0);
}

/** Convert real video time → virtual (user-facing) time within kept segments. */
export function realToVirtual(realTime: number, kept: Segment[]): number {
  let virtual = 0;
  for (const seg of kept) {
    if (realTime <= seg.start) break;
    if (realTime <= seg.end) {
      virtual += realTime - seg.start;
      break;
    }
    virtual += seg.end - seg.start;
  }
  return virtual;
}

/** Convert virtual (user-facing) time → real video time. */
export function virtualToReal(virtualTime: number, kept: Segment[]): number {
  let remaining = virtualTime;
  for (const seg of kept) {
    const len = seg.end - seg.start;
    if (remaining <= len) return seg.start + remaining;
    remaining -= len;
  }
  return kept.length > 0 ? kept[kept.length - 1].end : 0;
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Format with decimals for precise editing: "1:23.4"
export function formatTimePrecise(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00.0";
  // Round the total first: rounding the seconds alone lets them reach 60
  // without carrying into the minutes ("0:60.0" for 59.96).
  const tenths = Math.round(seconds * 10);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

// Parse "1:23.4" or "83.4" → seconds
export function parseTimeInput(value: string): number | null {
  const trimmed = value.trim();
  const parts = trimmed.split(":");
  try {
    if (parts.length === 1) {
      const n = parseFloat(parts[0]);
      return isNaN(n) ? null : n;
    }
    if (parts.length === 2) {
      const min = parseInt(parts[0]);
      const sec = parseFloat(parts[1]);
      if (isNaN(min) || isNaN(sec)) return null;
      return min * 60 + sec;
    }
    if (parts.length === 3) {
      const h = parseInt(parts[0]);
      const min = parseInt(parts[1]);
      const sec = parseFloat(parts[2]);
      if (isNaN(h) || isNaN(min) || isNaN(sec)) return null;
      return h * 3600 + min * 60 + sec;
    }
  } catch {
    /* invalid format */
  }
  return null;
}
